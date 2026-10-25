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
import { BRAIN, CATEGORY_RULES, DEFAULT_COMPETITOR_CATEGORIES, DISTANCE_FILTERS, DEFAULT_RADIUS_MILES, GOOGLE_RETENTION_DAYS, MAX_ROUTE_STOPS, OUTCOME_LABELS, PROMISE, REFRESH_COOLDOWN_HOURS, RULES_VERSION, categoryForTypes, type OutreachOutcome } from './config';
import { haversineMiles, plotOffset } from './geo';
import { addressKey, crossReference, fitScore, nameKey, ownershipOf, type NetworkRecord, type RecordKind } from './network';
import { configured as placesConfigured, type DiscoveredPlace } from './places';
import { followUpQueue, isDay, isoDay, nextDue, periodLabel, periodOf, rankRecommendations, referralFit, type BrainRow, type OutreachEvent, type Pick as BrainPick, type ScoreInputs } from './brain';

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
    CREATE TABLE IF NOT EXISTS recommendation_sets (clinic_id TEXT NOT NULL, period TEXT NOT NULL, generated_at INTEGER NOT NULL, rules_version TEXT NOT NULL, considered INTEGER NOT NULL DEFAULT 0, offered INTEGER NOT NULL DEFAULT 0, qualified INTEGER NOT NULL DEFAULT 0, note TEXT NOT NULL DEFAULT '', PRIMARY KEY (clinic_id, period));
    CREATE TABLE IF NOT EXISTS recommendations (clinic_id TEXT NOT NULL, period TEXT NOT NULL, place_id TEXT NOT NULL, rank INTEGER NOT NULL, score INTEGER NOT NULL, reason TEXT NOT NULL, score_inputs TEXT NOT NULL, rules_version TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (clinic_id, period, place_id));
    CREATE TABLE IF NOT EXISTS outreach_records (id TEXT PRIMARY KEY, clinic_id TEXT NOT NULL REFERENCES clinics(id), place_id TEXT NOT NULL, visited_on TEXT NOT NULL, outcome TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', next_due_on TEXT, recorded_at INTEGER NOT NULL, source TEXT NOT NULL DEFAULT 'client');
    CREATE INDEX IF NOT EXISTS map_places_expiry ON map_places(expires_at);
    CREATE INDEX IF NOT EXISTS recommendations_clinic ON recommendations(clinic_id, place_id);
    CREATE INDEX IF NOT EXISTS outreach_clinic ON outreach_records(clinic_id, place_id, visited_on);
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
    return cachedDiscovery(clinicId, now).map(place => {
      const category = categoryForTypes(place.types, place.primaryType);
      const distanceMiles = haversineMiles(location.lat, location.lng, place.lat, place.lng);
      const known = Number.isFinite(distanceMiles);
      const distance = known ? distanceMiles : location.radiusMiles;
      const reference = crossReference(place, category, records, clinicId, location.competitorCategories);
      const fit = fitScore(category, distance);
      return {
        placeId: place.placeId,
        name: place.name,
        address: place.address,
        category: category ? { id: category.id, label: category.label, icon: category.icon, color: category.color } : null,
        distanceMiles: Number(distance.toFixed(2)),
        // A distance that could not be measured is SAID to be unmeasured. The figure above falls
        // back to the edge of the search radius so the list can still sort, and the brain holds
        // the business back for review rather than ranking it on a number nobody measured.
        distanceKnown: known,
        rating: place.rating, reviewCount: place.reviewCount,
        googleMapsUri: place.googleMapsUri,
        plot: place.lat !== null && place.lng !== null ? plotOffset(location.lat, location.lng, place.lat, place.lng, location.radiusMiles) : null,
        status: reference.status, statusLabel: reference.label, statusReason: reference.reason, routable: reference.routable,
        ownership: ownershipOf(place, records),
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

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // THE BRAIN'S STORED SIDE: this month's recommendation set, and the outreach history the
  // follow-up rotation is driven by.
  //
  // WHAT IS WRITTEN. A place ID, a rank, a score, the reason sentence and the versioned score
  // inputs — the audit trail of one decision, so a set made in August can still be explained in
  // November after the dials in config.ts have moved. NO Google names or addresses are written
  // here: those live only in the 30-day `map_places` cache, and a recommendation whose content
  // has expired is shown as being looked up again rather than from a stale copy.
  //
  // TENANCY. Every statement carries `WHERE clinic_id = ?`, and every place ID a client submits
  // is checked against `map_place_ids` for that clinic — so a borrowed ID from another clinic's
  // map is not found, exactly as it is not found for a route.
  // ───────────────────────────────────────────────────────────────────────────────────────────

  const today = () => isoDay(new Date());

  /** Is this place ID on this clinic's own map? The place IDs outlive the content cache. */
  const knownPlace = (clinicId: string, placeId: string) =>
    !!db.prepare('SELECT place_id FROM map_place_ids WHERE clinic_id=? AND place_id=?').get(clinicId, placeId);

  /** The business rows in the shape the brain reads: an unmeasured distance reads as null. */
  function brainRows(clinicId: string, now = Date.now()): BrainRow[] {
    return businesses(clinicId, now).map(row => ({
      placeId: row.placeId,
      name: row.name,
      address: row.address,
      category: row.category ? { id: row.category.id, label: row.category.label,
        weight: CATEGORY_RULES.find(rule => rule.id === row.category!.id)?.weight ?? 0,
        reason: CATEGORY_RULES.find(rule => rule.id === row.category!.id)?.reason ?? '',
        competitor: CATEGORY_RULES.find(rule => rule.id === row.category!.id)?.competitor === true } : null,
      distanceMiles: row.distanceKnown ? row.distanceMiles : null,
      status: row.status,
      routable: row.routable,
      ownership: row.ownership.state,
      dedupeKey: [nameKey(row.name), addressKey(row.address)].filter(Boolean).join('|'),
    }));
  }

  function outreachEvents(clinicId: string): OutreachEvent[] {
    return (db.prepare('SELECT place_id,visited_on,outcome,note,recorded_at FROM outreach_records WHERE clinic_id=? ORDER BY visited_on, recorded_at').all(clinicId) as Array<Record<string, any>>)
      .map(row => ({ placeId: row.place_id, visitedOn: row.visited_on, outcome: row.outcome as OutreachOutcome, note: row.note, recordedAt: row.recorded_at }));
  }

  /** Place IDs this clinic has already been offered, in any month, or has already visited. */
  function alreadySeen(clinicId: string) {
    const shown = (db.prepare('SELECT place_id FROM recommendations WHERE clinic_id=?').all(clinicId) as Array<{ place_id: string }>).map(row => row.place_id);
    const contacted = (db.prepare('SELECT DISTINCT place_id FROM outreach_records WHERE clinic_id=?').all(clinicId) as Array<{ place_id: string }>).map(row => row.place_id);
    return new Set([...shown, ...contacted]);
  }

  type StoredPick = { placeId: string; rank: number; score: number; reason: string; inputs: ScoreInputs };
  type StoredSet = { period: string; generatedAt: number; rulesVersion: string; considered: number; qualified: number; note: string; picks: StoredPick[] };

  function readSet(clinicId: string, period: string): StoredSet | null {
    const row = db.prepare('SELECT period,generated_at,rules_version,considered,qualified,note FROM recommendation_sets WHERE clinic_id=? AND period=?').get(clinicId, period) as Record<string, any> | undefined;
    if (!row) return null;
    const picks = (db.prepare('SELECT place_id,rank,score,reason,score_inputs FROM recommendations WHERE clinic_id=? AND period=? ORDER BY rank').all(clinicId, period) as Array<Record<string, any>>)
      .map(entry => ({ placeId: entry.place_id, rank: entry.rank, score: entry.score, reason: entry.reason, inputs: JSON.parse(entry.score_inputs) as ScoreInputs }));
    return { period: row.period, generatedAt: row.generated_at, rulesVersion: row.rules_version, considered: row.considered, qualified: row.qualified, note: row.note, picks };
  }

  /**
   * This month's set of new businesses, made once and then kept.
   *
   * A month that already has a set is never regenerated: the client opening the portal twice in
   * March sees the same March list, which is what stops an accidental second monthly set and
   * what makes "never shown as new twice" possible at all. The set is written in one
   * transaction, and a set row that another request has already written wins — the loser reads
   * that set back instead of writing a second one.
   */
  function monthlySet(clinicId: string, options: { day?: string; now?: number } = {}): StoredSet & { held: Array<{ placeId: string; name: string | null; reason: string }> } {
    const day = options.day ?? today();
    const now = options.now ?? Date.now();
    const period = periodOf(day);
    const existing = readSet(clinicId, period);
    const ranked = existing ? null : rankRecommendations(brainRows(clinicId, now), { exclude: alreadySeen(clinicId) });
    if (!existing && ranked) {
      db.exec('BEGIN IMMEDIATE');
      try {
        const inserted = db.prepare('INSERT OR IGNORE INTO recommendation_sets (clinic_id,period,generated_at,rules_version,considered,offered,qualified,note) VALUES (?,?,?,?,?,?,?,?)')
          .run(clinicId, period, now, RULES_VERSION, ranked.considered, ranked.picks.length, ranked.qualified, ranked.note);
        if (Number(inserted.changes) > 0)
          for (const pick of ranked.picks)
            db.prepare('INSERT OR IGNORE INTO recommendations (clinic_id,period,place_id,rank,score,reason,score_inputs,rules_version,created_at) VALUES (?,?,?,?,?,?,?,?,?)')
              .run(clinicId, period, pick.placeId, pick.rank, pick.score, pick.reason, JSON.stringify(pick.inputs), RULES_VERSION, now);
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    }
    const set = readSet(clinicId, period) ?? { period, generatedAt: now, rulesVersion: RULES_VERSION, considered: 0, qualified: 0, note: ranked?.note ?? '', picks: [] };
    return { ...set, held: ranked?.held ?? [] };
  }

  /**
   * Record what happened on a visit. The outcome sets the next due date, and nothing else does.
   *
   * The server decides what may be recorded: a place ID that is not on this clinic's own map is
   * refused, a business the network will not route to is refused, a date in the future is
   * refused, and the outcome has to be one of the five the portal offers.
   */
  function recordOutreach(clinicId: string, input: { placeId: string; visitedOn: string; outcome: OutreachOutcome; note?: string }, options: { day?: string; now?: number } = {}) {
    const day = options.day ?? today();
    const now = options.now ?? Date.now();
    if (!OUTCOME_LABELS[input.outcome]) return { ok: false as const, message: 'Choose one of the outcomes listed.' };
    if (!knownPlace(clinicId, input.placeId)) return { ok: false as const, message: 'This business is not on your map.' };
    if (!isDay(input.visitedOn)) return { ok: false as const, message: 'Use a valid visit date.' };
    if (input.visitedOn > day) return { ok: false as const, message: 'A visit date cannot be in the future.' };
    const row = businesses(clinicId, now).find(entry => entry.placeId === input.placeId);
    if (row && !row.routable) return { ok: false as const, message: row.statusReason };
    const due = nextDue(input.outcome, input.visitedOn);
    db.prepare('INSERT INTO outreach_records (id,clinic_id,place_id,visited_on,outcome,note,next_due_on,recorded_at,source) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(randomBytes(12).toString('hex'), clinicId, input.placeId, input.visitedOn, input.outcome, (input.note ?? '').slice(0, 600), due, now, 'client');
    return { ok: true as const, nextDueOn: due };
  }

  /** Put a business the clinic had marked "not interested" back in the queue, due now. */
  function reopenOutreach(clinicId: string, placeId: string, options: { day?: string; now?: number } = {}) {
    const day = options.day ?? today();
    const now = options.now ?? Date.now();
    if (!knownPlace(clinicId, placeId)) return { ok: false as const, message: 'This business is not on your map.' };
    const last = db.prepare('SELECT outcome FROM outreach_records WHERE clinic_id=? AND place_id=? ORDER BY visited_on DESC, recorded_at DESC LIMIT 1').get(clinicId, placeId) as { outcome: string } | undefined;
    if (!last) return { ok: false as const, message: 'There is no outreach recorded for this business yet.' };
    db.prepare('INSERT INTO outreach_records (id,clinic_id,place_id,visited_on,outcome,note,next_due_on,recorded_at,source) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(randomBytes(12).toString('hex'), clinicId, placeId, day, 'reopened', '', day, now, 'client');
    return { ok: true as const, nextDueOn: day };
  }

  function outreachHistory(clinicId: string, limit = 60) {
    return (db.prepare('SELECT place_id,visited_on,outcome,note,next_due_on FROM outreach_records WHERE clinic_id=? ORDER BY visited_on DESC, recorded_at DESC LIMIT ?').all(clinicId, limit) as Array<Record<string, any>>)
      .map(row => ({ placeId: row.place_id, visitedOn: row.visited_on, outcome: row.outcome as OutreachOutcome, outcomeLabel: OUTCOME_LABELS[row.outcome as OutreachOutcome] ?? row.outcome, note: row.note, nextDueOn: row.next_due_on as string | null }));
  }

  /**
   * The brain's whole answer for one clinic: this month's new businesses, and the follow-up
   * queue. Entries carry a place ID and the brain's own fields; the names, addresses, distances
   * and statuses on screen come from the live map rows in the same payload, so there is one
   * source of truth for what a business is and it is never a stored copy.
   *
   * A recommendation the network has since refused — a new exclusivity, a business that closed —
   * is moved out of the list into `withdrawn` with the reason, rather than left looking current.
   */
  function networkPlan(clinicId: string, options: { day?: string; now?: number } = {}) {
    const day = options.day ?? today();
    const now = options.now ?? Date.now();
    const set = monthlySet(clinicId, { day, now });
    const rows = new Map(businesses(clinicId, now).map(row => [row.placeId, row]));

    const recommended: Array<BrainPick & { period: string; present: boolean }> = [];
    const withdrawn: Array<{ placeId: string; reason: string }> = [];
    for (const pick of set.picks) {
      const row = rows.get(pick.placeId);
      if (row && !row.routable) { withdrawn.push({ placeId: pick.placeId, reason: row.statusReason }); continue; }
      recommended.push({ ...pick, components: pick.inputs.parts, inputs: pick.inputs, period: set.period, present: !!row });
    }

    const queue = followUpQueue(outreachEvents(clinicId), day);
    const withPresence = <T extends { placeId: string }>(entries: T[]) => entries.map(entry => ({ ...entry, present: rows.has(entry.placeId) }));

    return {
      promise: PROMISE,
      today: day,
      period: set.period,
      periodLabel: periodLabel(set.period),
      rulesVersion: set.rulesVersion,
      generatedAt: new Date(set.generatedAt).toISOString(),
      monthlyLimit: BRAIN.monthlyNewLimit,
      recommended,
      recommendedNote: withdrawn.length
        ? `${set.note} ${withdrawn.length} ${withdrawn.length === 1 ? 'has' : 'have'} since been withdrawn by the network.`
        : set.note,
      withdrawn,
      heldBack: set.held,
      followUps: { ...queue, due: withPresence(queue.due), upcoming: withPresence(queue.upcoming), parked: withPresence(queue.parked) },
      cadence: { months: BRAIN.followUp.defaultMonths, perWeek: BRAIN.followUp.perWeek, queueLimit: BRAIN.followUp.queueLimit },
      outcomes: (Object.keys(OUTCOME_LABELS) as OutreachOutcome[]).filter(outcome => outcome !== 'reopened').map(outcome => ({ id: outcome, label: OUTCOME_LABELS[outcome] })),
      history: outreachHistory(clinicId),
    };
  }

  /** The whole Network Map payload for one authenticated clinic. */
  function networkMap(clinicId: string, clinicName: string, options: { day?: string; now?: number } = {}) {
    const location = clinicLocation(clinicId);
    const rows = businesses(clinicId, options.now ?? Date.now());
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
      // The brain's answer travels with the map: one request, one set of business rows, and the
      // monthly list and follow-up queue pointing into them by place ID.
      plan: location ? networkPlan(clinicId, options) : null,
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

  return { setClinicLocation, clinicLocation, saveNetworkRecords, networkRecords, saveDiscovery, cachedDiscovery, markRefresh, lastRefresh, refreshDue, businesses, brainRows, selection, saveSelection, routeRequests, createRouteRequest, allRouteRequests, decideRouteRequest, networkMap, purgeExpired,
    monthlySet, recordOutreach, reopenOutreach, outreachEvents, outreachHistory, networkPlan };
}

export type NetworkStore = ReturnType<typeof openNetwork>;
