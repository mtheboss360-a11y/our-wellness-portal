// WHERE THE RELEASED BUSINESSES ACTUALLY ARE.
//
//   npm run geocode-release -- --clinic <clinic-id> [--dry-run] [--force]
//
// Turns each verified street address into Google's own place id and a coordinate, through the
// portal's existing Places integration — the same module and the same key the Network Map uses.
// Nothing else talks to Google.
//
// WHAT IT WILL NOT DO. It does not accept a match it cannot justify: the result has to agree
// with the address we were given on both the street number and the town, or the business is
// left without a coordinate and reported. A wrong pin sends somebody to the wrong door, which
// is worse than no pin at all — without one the portal routes by the street address.
//
// RETENTION. A place id may be kept indefinitely under the Maps terms; a coordinate may not,
// so each is stamped and anything past the window is fetched again rather than served stale.
import { parseArgs } from 'node:util';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { openStore } from '../server/store.ts';
import { nearby, normalizePlace, configured, TEXT_URL } from '../server/network/places.ts';
import { GOOGLE_RETENTION_DAYS } from '../server/network/config.ts';

if (existsSync('.env')) process.loadEnvFile('.env');

const { values } = parseArgs({ options: {
  clinic: { type: 'string' }, 'dry-run': { type: 'boolean' }, force: { type: 'boolean' },
  // The practice's own address, when its pin has not been set. Looked up the same way and held
  // to the same standard: if the answer does not agree with the address, nothing is written.
  'clinic-address': { type: 'string' }, radius: { type: 'string' },
} });

const clinicId = values.clinic ?? '';
const dryRun = values['dry-run'] === true;
if (!/^[a-z0-9-]{3,80}$/.test(clinicId)) throw new Error('Provide --clinic clinic-slug.');
if (!configured()) throw new Error('Google Places is not configured here. Set Google_places_API and run this on the server.');

/** The digits at the front of a street address — the part a wrong match almost always gets wrong. */
const streetNumber = (address: string) => address.trim().match(/^\s*(\d+)/)?.[1] ?? '';
/** The town, taken from the part before the state. */
const town = (address: string) => {
  const parts = address.split(',').map(p => p.trim());
  const index = parts.findIndex(p => /^[A-Z]{2}\b/.test(p));
  return (index > 0 ? parts[index - 1] : parts.at(-2) ?? '').toLowerCase();
};

/** Words that identify nothing. Two businesses sharing only these share nothing. */
const EMPTY = new Set(['the', 'and', 'of', 'at', 'studio', 'salon', 'spa', 'clinic', 'center',
  'centre', 'co', 'inc', 'llc', 'ltd', 'naperville', 'il', 'chicago']);
const words = (value: string) => value.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/)
  .filter(word => word.length > 2 && !EMPTY.has(word));

/**
 * Does Google's answer describe the place we asked about? The address has to agree on street
 * number and town — AND the name has to share a real word with ours.
 *
 * The name check is not fussiness. Without it, asking about a business at a real street
 * address returns whatever actually trades there, and that answer passes an address-only test
 * perfectly. Run over invented sample businesses placed on real streets, it quietly gave eight
 * of them the place ID and coordinates of real, unrelated businesses.
 */
function agrees(askedName: string, asked: string, gotName: string | null, got: string | null) {
  if (!got) return false;
  const wantedNumber = streetNumber(asked);
  if (wantedNumber && streetNumber(got) !== wantedNumber) return false;
  const wantedTown = town(asked);
  if (wantedTown && !got.toLowerCase().includes(wantedTown)) return false;

  const ours = words(askedName);
  const theirs = words(gotName ?? '');
  if (!ours.length) return true;
  return ours.some(word => theirs.some(other => other === word || other.includes(word) || word.includes(other)));
}

const store = openStore(resolve(process.env.DATABASE_PATH ?? 'var/portal.sqlite'), false);
const window = GOOGLE_RETENTION_DAYS * 86_400_000;

try {
  const clinic = store.db.prepare('SELECT name FROM clinics WHERE id=?').get(clinicId) as { name: string } | undefined;
  if (!clinic) throw new Error(`No clinic "${clinicId}".`);

  // The practice's own pin first: the map searches outward from it, and a release is not much
  // use without somewhere to start.
  const wanted = values['clinic-address']?.trim();
  if (wanted) {
    const results = await nearby({ textQuery: wanted, maxResultCount: 3 }, TEXT_URL);
    // The practice's own address has no business name to check, so only the address is matched.
    const found = results.map(normalizePlace).find(p => p && agrees('', wanted, '', p.address)) ?? null;
    if (!found || found.lat === null || found.lng === null) {
      throw new Error(`No result agreed with "${wanted}". The clinic pin was not set, and nothing else has been written.`);
    }
    console.log(`Clinic → ${found.address}`);
    if (!dryRun) {
      store.setClinicLocation({
        clinicId, label: wanted, lat: found.lat, lng: found.lng,
        radiusMiles: Number(values.radius ?? 5), placeId: found.placeId, competitorCategories: [],
      });
    }
  }

  // ILLUSTRATIVE BUSINESSES ARE NEVER LOOKED UP. They are invented names, and placing them on
  // real streets means a lookup returns whatever genuinely trades there — which is how eight
  // sample records were handed the place ID of a real, unrelated business. Any geocode they
  // have already been given is cleared here, because leaving it would send somebody to a
  // stranger's door.
  const everything = store.outreach.businesses(clinicId);
  const invented = everything.filter(b => b.demo === 1 && b.placeId);
  if (invented.length) {
    for (const b of invented) {
      store.db.prepare('UPDATE businesses SET place_id=NULL, geo_at=NULL, types=NULL WHERE id=? AND clinic_id=?')
        .run(b.id, clinicId);
      store.db.prepare('DELETE FROM map_places WHERE clinic_id=? AND place_id=?').run(clinicId, b.placeId);
      store.db.prepare('DELETE FROM map_place_ids WHERE clinic_id=? AND place_id=?').run(clinicId, b.placeId);
    }
    console.log(`Cleared a real-world lookup from ${invented.length} illustrative ${invented.length === 1 ? 'business' : 'businesses'}: ${invented.map(b => b.name).join(', ')}.`);
    console.log('Those are invented names. They keep their own made-up positions and are never looked up.\n');
  }

  const all = everything.filter(b => b.demo !== 1);
  const fresh = (b: typeof all[number]) => b.placeId && b.lat !== null && b.geoAt !== null && Date.now() - b.geoAt < window;
  const todo = values.force ? all : all.filter(b => !fresh(b));

  const skipped = everything.length - all.length;
  console.log(`${clinic.name} (${clinicId}) — ${all.length} real ${all.length === 1 ? 'business' : 'businesses'}, ${todo.length} to look up.`);
  if (skipped) console.log(`  ${skipped} illustrative ${skipped === 1 ? 'business is' : 'businesses are'} left alone.`);
  if (!all.length) { console.log('This account has no businesses yet. Release a batch first, then run this again.'); process.exit(0); }
  if (!todo.length) { console.log('Every one already has a current coordinate. Nothing to do.'); process.exit(0); }
  if (dryRun) console.log('DRY RUN: Google will be asked, but nothing will be written.\n');

  const located: string[] = [], refused: string[] = [];

  for (const b of todo) {
    const query = `${b.name}, ${b.address}`;
    let found;
    try {
      const results = await nearby({ textQuery: query, maxResultCount: 3 }, TEXT_URL);
      found = results.map(normalizePlace).find(p => p && agrees(b.name, b.address, p.name, p.address)) ?? null;
    } catch (error) {
      console.log(`  ✗ ${b.name}: ${(error as Error).message}`);
      refused.push(b.name);
      continue;
    }

    if (!found || found.lat === null || found.lng === null) {
      // Google answered with something, but not something we can stand behind.
      console.log(`  ✗ ${b.name}: no result agreed with "${b.address}". Left without a coordinate.`);
      refused.push(b.name);
      continue;
    }

    console.log(`  ✓ ${b.name} → ${found.address}`);
    if (!dryRun) {
      store.outreach.setLocation(clinicId, b.id, {
        placeId: found.placeId, lat: found.lat, lng: found.lng,
        types: found.types, primaryType: found.primaryType,
      });
      // The orb reads the network's own cache. Writing through the same function a discovery
      // refresh uses puts these on the map without touching the orb or its matching engine.
      store.saveDiscovery(clinicId, [found]);
    }
    located.push(b.name);
  }

  console.log(`\n${dryRun ? 'Would locate' : 'Located'}: ${located.length}`);
  if (refused.length) console.log(`Left alone: ${refused.join(', ')} — these route by street address and stay off the orb.`);
  if (!dryRun && located.length) console.log('These now appear on the Referral Network orb through its existing cache.');
} finally { store.close(); }
