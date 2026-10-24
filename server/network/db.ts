// The Network Map's tables and every query that touches them.
//
// MIGRATIONS ARE ADDITIVE. Every statement is CREATE TABLE IF NOT EXISTS. Nothing here drops,
// renames or rewrites a table, so an existing database — clinics, users, campaigns, sessions —
// opens unchanged and keeps its records.
//
// TENANCY. Every function takes `clinicId` as its first argument, and the only caller that
// supplies it is server/http.ts, from the authenticated session. No function reads a clinic
// from a request parameter, and every statement that reads clinic data carries
// `WHERE clinic_id = ?`. A request cannot name another clinic because nothing accepts one.
//
// GOOGLE CONTENT. `map_place_ids` holds place IDs, which the Maps terms allow to be stored
// indefinitely. `map_places` holds the transient content — name, address, coordinates, rating —
// with an `expires_at` 30 days out, and `purgeExpired()` deletes it. The map reads this cache;
// it does not search Google again every time it opens.

import { randomBytes } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { CATEGORY_RULES, DEFAULT_COMPETITOR_CATEGORIES, DISTANCE_FILTERS, DEFAULT_RADIUS_MILES, GOOGLE_RETENTION_DAYS, MAX_ROUTE_STOPS, REFRESH_COOLDOWN_HOURS, categoryForTypes } from './config';
import { haversineMiles, plotOffset } from './geo';
import { addressKey, crossReference, fitScore, nameKey, type NetworkRecord, type RecordKind } from './network';
import { configured as placesConfigured, type DiscoveredPlace } from './places';
import { privateOnly } from './chains';

const DAY = 86_400_000;

export type ClinicLocation = { clinicId: string; label: string; lat: number; lng: number; radiusMiles: number; placeId: string | null; competitorCategories: string[] };
export type RouteStop = { placeId: string; name: string | null; address: string | null; category: string | null };
export type RouteRequestRow = { id: string; status: RequestStatus; statusLabel: string; createdAt: string; preferredFrom: string; preferredTo: string; contactName: string; contactPhone: string; notes: string; teamNote: string; stops: RouteStop[]; needsReview: boolean };
export type RequestStatus = 'requested' | 'scheduled' | 'declined' | 'completed';

/** A request is "requested" until the team accepts it. The portal never calls it scheduled before then. */
export const REQUEST_LABELS: Record<RequestStatus, string> = {
  requested: 'Requested — not scheduled yet',
  scheduled: 'Scheduled by the team',
  declined: 'Not scheduled',
  completed: 'Completed',
};

export function openNetwork(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS clinic_locations (clinic_id TEXT PRIMARY KEY REFERENCES clinics(id), label TEXT NOT NULL, lat REAL NOT NULL, lng REAL NOT NULL, radius_miles REAL NOT NULL, place_id TEXT, competitor_categories TEXT NOT NULL DEFAULT '[]');
    CREATE TABLE IF NOT EXISTS network_records (id TEXT PRIMARY KEY, kind TEXT NOT NULL, owner_clinic_id TEXT, place_id TEXT, name_key TEXT, address_key TEXT, note TEXT NOT NULL DEFAULT '', updated_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS map_place_ids (clinic_id TEXT NOT NULL, place_id TEXT NOT NULL, first_seen INTEGER NOT NULL, PRIMARY KEY (clinic_id, place_id));
    CREATE TABLE IF NOT EXISTS map_places (clinic_id TEXT NOT NULL, place_id TEXT NOT NULL, payload TEXT NOT NULL, fetched_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, PRIMARY KEY (clinic_id, place_id));
    CREATE TABLE IF NOT EXISTS map_refreshes (clinic_id TEXT PRIMARY KEY, attempted_at INTEGER NOT NULL, status TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '', found INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS route_selections (clinic_id TEXT NOT NULL, place_id TEXT NOT NULL, position INTEGER NOT NULL, PRIMARY KEY (clinic_id, place_id));
    CREATE TABLE IF NOT EXISTS route_requests (id TEXT PRIMARY KEY, clinic_id TEXT NOT NULL REFERENCES clinics(id), contact_name TEXT NOT NULL, contact_phone TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '', preferred_from TEXT NOT NULL, preferred_to TEXT NOT NULL, stops TEXT NOT NULL, status TEXT NOT NULL, created_at INTEGER NOT NULL, decided_at INTEGER, team_note TEXT NOT NULL DEFAULT '');
    CREATE INDEX IF NOT EXISTS map_places_expiry ON map_places(expires_at);
    CREATE INDEX IF NOT EXISTS route_requests_clinic ON route_requests(clinic_id, created_at);
    CREATE INDEX IF NOT EXISTS network_records_place ON network_records(place_id);
  `);

  /** Google content past its retention window is deleted, not served stale. */
  function purgeExpired(now = Date.now()) { db.prepare('DELETE FROM map_places WHERE expires_at<=?').run(now); }

  function setClinicLocation(value: ClinicLocation) {
    if (!db.prepare('SELECT id FROM clinics WHERE id=?').get(value.clinicId)) throw new Error('Create this clinic first.');
    db.prepare(`INSERT INTO clinic_locations (clinic_id,label,lat,lng,radius_miles,place_id,competitor_categories) VALUES (?,?,?,?,?,?,?)
      ON CONFLICT(clinic_id) DO UPDATE SET label=excluded.label,lat=excluded.lat,lng=excluded.lng,radius_miles=excluded.radius_miles,place_id=excluded.place_id,competitor_categories=excluded.competitor_categories`)
      .run(value.clinicId, value.label, value.lat, value.lng, value.radiusMiles, value.placeId, JSON.stringify(value.competitorCategories));
  }

  function clinicLocation(clinicId: string): ClinicLocation | null {
    const row = db.prepare('SELECT clinic_id,label,lat,lng,radius_miles,place_id,competitor_categories FROM clinic_locations WHERE clinic_id=?').get(clinicId) as
      { clinic_id: string; label: string; lat: number; lng: number; radius_miles: number; place_id: string | null; competitor_categories: string } | undefined;
    if (!row) return null;
    const configured = JSON.parse(row.competitor_categories) as string[];
    return { clinicId: row.clinic_id, label: row.label, lat: row.lat, lng: row.lng, radiusMiles: row.radius_miles || DEFAULT_RADIUS_MILES, placeId: row.place_id,
      competitorCategories: configured.length ? configured : DEFAULT_COMPETITOR_CATEGORIES };
  }

  /** Network records are agency data, written only from the trusted server CLI. */
  function saveNetworkRecords(values: Array<{ id: string; kind: RecordKind; ownerClinicId?: string | null; placeId?: string | null; name?: string | null; address?: string | null; note?: string }>) {
    db.exec('BEGIN IMMEDIATE');
    try {
      for (const value of values) {
        db.prepare(`INSERT INTO network_records (id,kind,owner_clinic_id,place_id,name_key,address_key,note,updated_at) VALUES (?,?,?,?,?,?,?,?)
          ON CONFLICT(id) DO UPDATE SET kind=excluded.kind,owner_clinic_id=excluded.owner_clinic_id,place_id=excluded.place_id,name_key=excluded.name_key,address_key=excluded.address_key,note=excluded.note,updated_at=excluded.updated_at`)
          .run(value.id, value.kind, value.ownerClinicId ?? null, value.placeId ?? null, nameKey(value.name) || null, addressKey(value.address) || null, value.note ?? '', Date.now());
      }
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }

  function networkRecords(): NetworkRecord[] {
    return (db.prepare('SELECT id,kind,owner_clinic_id,place_id,name_key,address_key,note FROM network_records').all() as Array<Record<string, any>>)
      .map(row => ({ id: row.id, kind: row.kind as RecordKind, ownerClinicId: row.owner_clinic_id, placeId: row.place_id, nameKey: row.name_key, addressKey: row.address_key, note: row.note }));
  }

  function saveDiscovery(clinicId: string, places: DiscoveredPlace[], now = Date.now()) {
    const expires = now + GOOGLE_RETENTION_DAYS * DAY;
    db.exec('BEGIN IMMEDIATE');
    try {
      for (const place of places) {
        db.prepare('INSERT OR IGNORE INTO map_place_ids (clinic_id,place_id,first_seen) VALUES (?,?,?)').run(clinicId, place.placeId, now);
        db.prepare(`INSERT INTO map_places (clinic_id,place_id,payload,fetched_at,expires_at) VALUES (?,?,?,?,?)
          ON CONFLICT(clinic_id,place_id) DO UPDATE SET payload=excluded.payload,fetched_at=excluded.fetched_at,expires_at=excluded.expires_at`)
          .run(clinicId, place.placeId, JSON.stringify(place), now, expires);
      }
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }

  /** Drop every cached business for a clinic (the sample clinic, before its fixed set is loaded). */
  function clearDiscovery(clinicId: string) { db.prepare('DELETE FROM map_places WHERE clinic_id=?').run(clinicId); }

  function cachedDiscovery(clinicId: string, now = Date.now()): DiscoveredPlace[] {
    purgeExpired(now);
    return (db.prepare('SELECT payload FROM map_places WHERE clinic_id=? AND expires_at>?').all(clinicId, now) as Array<{ payload: string }>)
      .map(row => JSON.parse(row.payload) as DiscoveredPlace);
  }

  function markRefresh(clinicId: string, status: 'ok' | 'failed' | 'skipped', detail: string, found: number, now = Date.now()) {
    db.prepare(`INSERT INTO map_refreshes (clinic_id,attempted_at,status,detail,found) VALUES (?,?,?,?,?)
      ON CONFLICT(clinic_id) DO UPDATE SET attempted_at=excluded.attempted_at,status=excluded.status,detail=excluded.detail,found=excluded.found`)
      .run(clinicId, now, status, detail, found);
  }

  function lastRefresh(clinicId: string) {
    const row = db.prepare('SELECT attempted_at,status,detail,found FROM map_refreshes WHERE clinic_id=?').get(clinicId) as { attempted_at: number; status: string; detail: string; found: number } | undefined;
    return row ? { at: new Date(row.attempted_at).toISOString(), status: row.status, detail: row.detail, found: row.found } : null;
  }

  /** True when a fresh Places pass is allowed: nothing cached, or the cooldown has passed. */
  function refreshDue(clinicId: string, now = Date.now()) {
    if (!cachedDiscovery(clinicId, now).length) {
      const row = db.prepare('SELECT attempted_at FROM map_refreshes WHERE clinic_id=?').get(clinicId) as { attempted_at: number } | undefined;
      // An empty map retries, but a failing key does not get asked once per page view.
      return !row || now - row.attempted_at > 60 * 60 * 1000;
    }
    const row = db.prepare('SELECT attempted_at FROM map_refreshes WHERE clinic_id=?').get(clinicId) as { attempted_at: number } | undefined;
    return !row || now - row.attempted_at > REFRESH_COOLDOWN_HOURS * 60 * 60 * 1000;
  }

  /**
   * Every nearby business for one clinic, classified, cross-referenced and scored.
   * The returned rows are what a client is allowed to see: no owner clinic, no record note.
   */
  function businesses(clinicId: string, now = Date.now()) {
    const location = clinicLocation(clinicId);
    if (!location) return [];
    const records = networkRecords();
    const places = cachedDiscovery(clinicId, now);
    const keep = privateOnly(places);
    return places.filter(keep).map(place => {
      const category = categoryForTypes(place.types, place.primaryType);
      const distanceMiles = haversineMiles(location.lat, location.lng, place.lat, place.lng);
      const distance = Number.isFinite(distanceMiles) ? distanceMiles : location.radiusMiles;
      const reference = crossReference(place, category, records, clinicId, location.competitorCategories);
      const fit = fitScore(category, distance);
      return {
        placeId: place.placeId,
        name: place.name,
        address: place.address,
        category: category ? { id: category.id, label: category.label, icon: category.icon, color: category.color } : null,
        distanceMiles: Number(distance.toFixed(2)),
        rating: place.rating, reviewCount: place.reviewCount,
        googleMapsUri: place.googleMapsUri,
        plot: place.lat !== null && place.lng !== null ? plotOffset(location.lat, location.lng, place.lat, place.lng, location.radiusMiles) : null,
        status: reference.status, statusLabel: reference.label, statusReason: reference.reason, routable: reference.routable,
        fit,
      };
    }).sort((a, b) => b.fit.score - a.fit.score || a.distanceMiles - b.distanceMiles);
  }

  const selection = (clinicId: string) =>
    (db.prepare('SELECT place_id FROM route_selections WHERE clinic_id=? ORDER BY position').all(clinicId) as Array<{ place_id: string }>).map(row => row.place_id);

  /**
   * Replace a clinic's route selection.
   *
   * The server decides what is allowed, not the browser: unknown place IDs are dropped, a
   * business the cross-reference refuses is dropped, and the list is cut to MAX_ROUTE_STOPS.
   * The answer says what was dropped so the UI can say so too.
   */
  function saveSelection(clinicId: string, placeIds: string[]) {
    const allowed = new Map(businesses(clinicId).map(row => [row.placeId, row]));
    const kept: string[] = [];
    const refused: Array<{ placeId: string; reason: string }> = [];
    for (const placeId of placeIds) {
      if (kept.includes(placeId)) continue;
      const row = allowed.get(placeId);
      if (!row) { refused.push({ placeId, reason: 'This business is no longer on your map.' }); continue; }
      if (!row.routable) { refused.push({ placeId, reason: row.statusReason }); continue; }
      if (kept.length >= MAX_ROUTE_STOPS) { refused.push({ placeId, reason: `A route takes up to ${MAX_ROUTE_STOPS} stops.` }); continue; }
      kept.push(placeId);
    }
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('DELETE FROM route_selections WHERE clinic_id=?').run(clinicId);
      kept.forEach((placeId, position) => db.prepare('INSERT INTO route_selections (clinic_id,place_id,position) VALUES (?,?,?)').run(clinicId, placeId, position));
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    return { selection: kept, refused };
  }

  function requestRow(row: Record<string, any>): RouteRequestRow {
    const stops = JSON.parse(row.stops) as RouteStop[];
    const status = row.status as RequestStatus;
    return { id: row.id, status, statusLabel: REQUEST_LABELS[status] ?? row.status, createdAt: new Date(row.created_at).toISOString(),
      preferredFrom: row.preferred_from, preferredTo: row.preferred_to, contactName: row.contact_name, contactPhone: row.contact_phone,
      notes: row.notes, teamNote: row.team_note, stops, needsReview: stops.some(stop => stop.category === 'review') };
  }

  function routeRequests(clinicId: string) {
    return (db.prepare('SELECT * FROM route_requests WHERE clinic_id=? ORDER BY created_at DESC LIMIT 50').all(clinicId) as Array<Record<string, any>>).map(requestRow);
  }

  /**
   * Create a route visit request. Status is always 'requested': the portal does not schedule
   * anything, it asks, and only the team's own acceptance moves it on.
   */
  function createRouteRequest(clinicId: string, input: { contactName: string; contactPhone: string; notes: string; preferredFrom: string; preferredTo: string }) {
    const rows = businesses(clinicId);
    const chosen = selection(clinicId).map(placeId => rows.find(row => row.placeId === placeId)).filter(row => row && row.routable) as Array<ReturnType<typeof businesses>[number]>;
    if (!chosen.length) return { ok: false as const, message: 'Choose at least one business on the map before asking for a visit.' };
    // The stop's name and address are Google content: kept in the same 30-day cache the map
    // reads, and re-resolved from the place ID after that, so an old request shows its links.
    const stops: RouteStop[] = chosen.slice(0, MAX_ROUTE_STOPS).map(row => ({ placeId: row.placeId, name: row.name, address: row.address, category: row.status === 'review' ? 'review' : row.category?.id ?? null }));
    const id = randomBytes(12).toString('hex');
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('INSERT INTO route_requests (id,clinic_id,contact_name,contact_phone,notes,preferred_from,preferred_to,stops,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
        .run(id, clinicId, input.contactName, input.contactPhone, input.notes, input.preferredFrom, input.preferredTo, JSON.stringify(stops), 'requested', Date.now());
      db.prepare('DELETE FROM route_selections WHERE clinic_id=?').run(clinicId);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    return { ok: true as const, request: requestRow(db.prepare('SELECT * FROM route_requests WHERE id=?').get(id) as Record<string, any>) };
  }

  /** Operations side, CLI only: every clinic's requests, and the decision on one. */
  function allRouteRequests(status?: RequestStatus) {
    const sql = `SELECT r.*, c.name AS clinic_name FROM route_requests r JOIN clinics c ON c.id=r.clinic_id${status ? ' WHERE r.status=?' : ''} ORDER BY r.created_at DESC LIMIT 200`;
    const rows = (status ? db.prepare(sql).all(status) : db.prepare(sql).all()) as Array<Record<string, any>>;
    return rows.map(row => ({ ...requestRow(row), clinicId: row.clinic_id, clinicName: row.clinic_name }));
  }

  function decideRouteRequest(id: string, status: RequestStatus, teamNote = '') {
    const changed = db.prepare('UPDATE route_requests SET status=?,decided_at=?,team_note=? WHERE id=?').run(status, Date.now(), teamNote, id);
    return Number(changed.changes) > 0;
  }

  /** The whole Network Map payload for one authenticated clinic. */
  function networkMap(clinicId: string, clinicName: string) {
    const location = clinicLocation(clinicId);
    const rows = businesses(clinicId);
    const counts = new Map<string, number>();
    for (const row of rows) if (row.category) counts.set(row.category.id, (counts.get(row.category.id) ?? 0) + 1);
    return {
      clinic: { name: clinicName, location: location ? { label: location.label, lat: location.lat, lng: location.lng, radiusMiles: location.radiusMiles } : null },
      categories: CATEGORY_RULES.map(rule => ({ id: rule.id, label: rule.label, icon: rule.icon, color: rule.color, competitor: rule.competitor === true, count: counts.get(rule.id) ?? 0 })),
      distanceFilters: [...DISTANCE_FILTERS],
      businesses: rows,
      selection: selection(clinicId),
      maxStops: MAX_ROUTE_STOPS,
      requests: routeRequests(clinicId),
      data: {
        placesConfigured: placesConfigured(),
        // No referrer-restricted browser key is configured in this project; the server key is
        // never sent to the browser, so the map is drawn from coordinates, not Google tiles.
        browserMapKeyConfigured: false,
        retentionDays: GOOGLE_RETENTION_DAYS,
        lastRefresh: lastRefresh(clinicId),
      },
    };
  }

  return { setClinicLocation, clinicLocation, saveNetworkRecords, networkRecords, saveDiscovery, clearDiscovery, cachedDiscovery, markRefresh, lastRefresh, refreshDue, businesses, selection, saveSelection, routeRequests, createRouteRequest, allRouteRequests, decideRouteRequest, networkMap, purgeExpired };
}

export type NetworkStore = ReturnType<typeof openNetwork>;
