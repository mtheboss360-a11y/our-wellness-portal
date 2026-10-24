// THE BAKERY NETWORK. Where a clinic's monthly treats come from: the bakeries in the towns around it.
// Local, owner-run bakeries first, plus Panera Bread and Krispy Kreme where there is one nearby. Every
// other chain is left out (grocery bakeries, Dunkin', Crumbl and the like), and so is any name that shows
// up at two or more places nearby. The clinic picks one; the team buys the treats there.
//
// Same rules as the partner map: one Google pass per cooldown, results held for 30 days, the key never
// leaves the server, and the sample clinic gets a fixed fictional list instead of a Google call.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { DatabaseSync } from 'node:sqlite';
import type { PortalStore } from '../store';
import { GOOGLE_RETENTION_DAYS, REFRESH_COOLDOWN_HOURS } from './config';
import { haversineMiles, milesToMetres } from './geo';
import { nameKey } from './network';
import { configured, nearby, normalizePlace, PlacesError, TEXT_URL, type DiscoveredPlace } from './places';
import { isSampleClinic } from './sample';
import { ensureDiscovery } from './map';

const DAY = 24 * 60 * 60 * 1000;
/** Searched one type at a time, so a type Google doesn't know only costs that one search. */
const BAKERY_TYPES = ['bakery', 'donut_shop', 'bagel_shop'];
/** Plain-words searches that turn up the small bakeries a type search ranks below the chains. */
const LOCAL_QUERIES = ['bakery', 'donut shop', 'bagel shop'];
/** The two chains a clinic may pick, found by name. */
export const BRANDS = [
  { id: 'panera', label: 'Panera Bread', query: 'Panera Bread', key: 'panera', color: '#7FA96A' },
  { id: 'krispy-kreme', label: 'Krispy Kreme', query: 'Krispy Kreme', key: 'krispykreme', color: '#9B3B3B' },
] as const;
const LOCAL = { id: 'local', label: 'Local bakery', color: '#C2663C' };

const OTHER_CHAINS = ['dunkin', 'starbucks', 'timhortons', 'nothingbundt', 'crumbl', 'insomniacookies', 'greatamericancookies', 'cinnabon',
  'auntieanne', 'einstein', 'bruegger', 'cornerbakery', 'aubonpain', 'lamadeleine', 'parisbaguette', 'tousles', '85c', 'kolachefactory',
  'shipley', 'duckdonuts', 'sprinkles', 'jewelosco', 'marianos', 'wholefoods', 'traderjoe', 'costco', 'target', 'walmart', 'aldi', 'meijer',
  'kroger', 'dairyqueen', 'baskinrobbins', 'coldstone', 'jamba', 'smoothieking', 'mcdonald', 'subway', 'portillo', 'potbelly', 'jimmyjohn',
  'freshthyme', 'sprouts', 'wetzel', 'mochii', 'hotelchocolat', 'stans', 'oberweis', 'greatamericanbagel', 'mollyscupcakes', 'purplepig', 'thorntons', 'hyvee', 'caribou', 'peet', 'dutchbros', 'scooters', 'biggby', 'mrsfields', 'cheesecakefactory', 'baskin'];
const NOT_A_BAKERY = /\b(gas|fuel|mobil|shell|bp|marathon|speedway|7-eleven|7 eleven|circle k|pharmacy|grocery|supermarket|market|foods|restaurant|grill|pizza|bar)\b/i;

export type Bakery = { placeId: string; name: string | null; address: string | null; town: string | null; kind: 'local' | 'panera' | 'krispy-kreme';
  label: string; category: { color: string }; distanceMiles: number; rating: number | null; reviewCount: number | null; googleMapsUri: string | null };

function brandOf(name: string | null) { const key = nameKey(name); return BRANDS.find(brand => key.startsWith(brand.key)) ?? null; }

/** Keep Panera, Krispy Kreme and the local bakeries; drop every other chain and anything that isn't a bakery. */
export function bakeriesOnly(places: DiscoveredPlace[]) {
  const counts = new Map<string, number>();
  for (const place of places) { const key = nameKey(place.name); if (key) counts.set(key, (counts.get(key) ?? 0) + 1); }
  return places.filter(place => {
    const key = nameKey(place.name);
    if (!key) return false;
    if (brandOf(place.name)) return true;
    if ((counts.get(key) ?? 0) > 1) return false;
    if (OTHER_CHAINS.some(chain => key.includes(chain))) return false;
    if (NOT_A_BAKERY.test(place.name ?? '')) return false;
    // A bakery by Google's own type, not an ice-cream counter or a burger place that sells cookies.
    if (![place.primaryType, ...place.types].some(type => type && BAKERY_TYPES.includes(type))) return false;
    // Mall and food-court counters are almost always chains.
    if (/\b(oakbrook center|yorktown|food court|shopping center|mall)\b/i.test(place.address ?? '')) return false;
    return true;
  });
}

export function townOf(address: string | null) {
  const parts = (address ?? '').split(',').map(part => part.trim()).filter(Boolean);
  const state = parts.findIndex(part => /^[A-Z]{2}(\s+\d{5}(-\d{4})?)?$/.test(part));
  const town = state > 0 ? parts[state - 1] : null;
  return town && !/\d/.test(town) ? town : null;
}

export async function discoverBakeries(options: { lat: number; lng: number; radiusMiles: number }, search = nearby) {
  const found = new Map<string, DiscoveredPlace>();
  const add = (raw: Record<string, any>) => { const place = normalizePlace(raw); if (place && place.businessStatus !== 'CLOSED_PERMANENTLY' && !found.has(place.placeId)) found.set(place.placeId, place); };
  const circle = { center: { latitude: options.lat, longitude: options.lng }, radius: Math.min(50_000, milesToMetres(options.radiusMiles)) };
  for (const type of BAKERY_TYPES) {
    try { (await search({ locationRestriction: { circle }, maxResultCount: 20, regionCode: 'US', rankPreference: 'DISTANCE', includedTypes: [type] })).forEach(add); }
    catch (error) { if (!(error instanceof PlacesError) || !/type/i.test(error.message)) throw error; }
  }
  for (const query of LOCAL_QUERIES) {
    (await search({ textQuery: query, locationBias: { circle }, maxResultCount: 20, regionCode: 'US' }, TEXT_URL)).forEach(add);
  }
  for (const brand of BRANDS) {
    const places = await search({ textQuery: brand.query, locationBias: { circle }, maxResultCount: 10, regionCode: 'US' }, TEXT_URL);
    places.filter(raw => brandOf(raw?.displayName?.text ?? null)).forEach(add);
  }
  // A brand search can reach past the radius; keep only what is inside it.
  return [...found.values()].filter(place => place.lat === null || place.lng === null || haversineMiles(options.lat, options.lng, place.lat, place.lng) <= options.radiusMiles);
}

type SampleBakeries = { places: DiscoveredPlace[] };
let sample: SampleBakeries | null = null;
const sampleBakeries = () => (sample ??= JSON.parse(readFileSync(fileURLToPath(new URL('../../samples/bakeries.sample.json', import.meta.url)), 'utf8')) as SampleBakeries);

export function openBakeries(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS bakery_places (clinic_id TEXT NOT NULL, place_id TEXT NOT NULL, payload TEXT NOT NULL, expires_at INTEGER NOT NULL, PRIMARY KEY(clinic_id,place_id));
    CREATE TABLE IF NOT EXISTS bakery_refreshes (clinic_id TEXT PRIMARY KEY, attempted_at INTEGER NOT NULL, status TEXT NOT NULL, detail TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS bakery_choices (clinic_id TEXT PRIMARY KEY, place_id TEXT NOT NULL, chosen_at INTEGER NOT NULL);
  `);
  const held = (clinicId: string, now = Date.now()) => {
    db.prepare('DELETE FROM bakery_places WHERE expires_at<=?').run(now);
    return (db.prepare('SELECT payload FROM bakery_places WHERE clinic_id=?').all(clinicId) as Array<{ payload: string }>).map(row => JSON.parse(row.payload) as DiscoveredPlace);
  };
  function saveBakeries(clinicId: string, places: DiscoveredPlace[], now = Date.now()) {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('DELETE FROM bakery_places WHERE clinic_id=?').run(clinicId);
      for (const place of places) db.prepare('INSERT INTO bakery_places (clinic_id,place_id,payload,expires_at) VALUES (?,?,?,?)').run(clinicId, place.placeId, JSON.stringify(place), now + GOOGLE_RETENTION_DAYS * DAY);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  const markBakeries = (clinicId: string, status: string, detail: string, now = Date.now()) =>
    db.prepare(`INSERT INTO bakery_refreshes (clinic_id,attempted_at,status,detail) VALUES (?,?,?,?)
      ON CONFLICT(clinic_id) DO UPDATE SET attempted_at=excluded.attempted_at,status=excluded.status,detail=excluded.detail`).run(clinicId, now, status, detail);
  function bakeriesDue(clinicId: string, now = Date.now()) {
    const row = db.prepare('SELECT attempted_at FROM bakery_refreshes WHERE clinic_id=?').get(clinicId) as { attempted_at: number } | undefined;
    if (!row) return true;
    return now - row.attempted_at > (held(clinicId, now).length ? REFRESH_COOLDOWN_HOURS : 1) * 60 * 60 * 1000;
  }
  const bakeryChoice = (clinicId: string) => (db.prepare('SELECT place_id FROM bakery_choices WHERE clinic_id=?').get(clinicId) as { place_id: string } | undefined)?.place_id ?? null;
  function chooseBakery(clinicId: string, placeId: string | null) {
    if (placeId === null) { db.prepare('DELETE FROM bakery_choices WHERE clinic_id=?').run(clinicId); return true; }
    if (!held(clinicId).some(place => place.placeId === placeId)) return false;
    db.prepare(`INSERT INTO bakery_choices (clinic_id,place_id,chosen_at) VALUES (?,?,?) ON CONFLICT(clinic_id) DO UPDATE SET place_id=excluded.place_id,chosen_at=excluded.chosen_at`).run(clinicId, placeId, Date.now());
    return true;
  }
  return { heldBakeries: held, saveBakeries, markBakeries, bakeriesDue, bakeryChoice, chooseBakery };
}

/** Bring a clinic's bakery list up to date if it is due. Never throws. */
export async function ensureBakeries(store: PortalStore, clinicId: string) {
  if (isSampleClinic(clinicId)) {
    await ensureDiscovery(store, clinicId);   // sets the sample clinic's spot; never calls Google
    const places = sampleBakeries().places;
    if (store.heldBakeries(clinicId).length !== places.length) { store.saveBakeries(clinicId, places); store.markBakeries(clinicId, 'ok', ''); }
    return;
  }
  const location = store.clinicLocation(clinicId);
  if (!location || !configured() || !store.bakeriesDue(clinicId)) return;
  try {
    const places = bakeriesOnly(await discoverBakeries({ lat: location.lat, lng: location.lng, radiusMiles: location.radiusMiles }));
    store.saveBakeries(clinicId, places);
    store.markBakeries(clinicId, 'ok', '');
  } catch (error) { store.markBakeries(clinicId, 'failed', error instanceof PlacesError ? error.message : 'Google Places could not be reached.'); }
}

/** What the clinic sees: every bakery kept, nearest first, with its kind. */
export function bakeryPayload(store: PortalStore, clinicId: string, clinicName: string) {
  const location = store.clinicLocation(clinicId);
  const bakeries: Bakery[] = location ? bakeriesOnly(store.heldBakeries(clinicId)).map(place => {
    const brand = brandOf(place.name);
    const miles = place.lat !== null && place.lng !== null ? haversineMiles(location.lat, location.lng, place.lat, place.lng) : location.radiusMiles;
    return { placeId: place.placeId, name: place.name, address: place.address, town: townOf(place.address), kind: (brand?.id ?? 'local') as Bakery['kind'], label: brand?.label ?? LOCAL.label,
      category: { color: brand?.color ?? LOCAL.color }, distanceMiles: Number(miles.toFixed(2)), rating: place.rating, reviewCount: place.reviewCount, googleMapsUri: place.googleMapsUri };
  }).sort((a, b) => a.distanceMiles - b.distanceMiles) : [];
  return { clinic: { name: clinicName, location: location ? { label: location.label } : null }, bakeries, choice: store.bakeryChoice(clinicId), placesConfigured: configured() };
}
export type BakeryPayload = ReturnType<typeof bakeryPayload>;
