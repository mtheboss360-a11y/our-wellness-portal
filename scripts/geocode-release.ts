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

/** Does Google's answer describe the place we asked about? Both checks, or we do not take it. */
function agrees(asked: string, got: string | null) {
  if (!got) return false;
  const wantedNumber = streetNumber(asked);
  if (wantedNumber && streetNumber(got) !== wantedNumber) return false;
  const wantedTown = town(asked);
  return !wantedTown || got.toLowerCase().includes(wantedTown);
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
    const found = results.map(normalizePlace).find(p => p && agrees(wanted, p.address)) ?? null;
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

  const all = store.outreach.businesses(clinicId);
  const fresh = (b: typeof all[number]) => b.placeId && b.lat !== null && b.geoAt !== null && Date.now() - b.geoAt < window;
  const todo = values.force ? all : all.filter(b => !fresh(b));

  console.log(`${clinic.name} (${clinicId}) — ${all.length} businesses, ${todo.length} to look up.`);
  if (!all.length) { console.log('This account has no businesses yet. Release a batch first, then run this again.'); process.exit(0); }
  if (!todo.length) { console.log('Every one already has a current coordinate. Nothing to do.'); process.exit(0); }
  if (dryRun) console.log('DRY RUN: Google will be asked, but nothing will be written.\n');

  const located: string[] = [], refused: string[] = [];

  for (const b of todo) {
    const query = `${b.name}, ${b.address}`;
    let found;
    try {
      const results = await nearby({ textQuery: query, maxResultCount: 3 }, TEXT_URL);
      found = results.map(normalizePlace).find(p => p && agrees(b.address, p.address)) ?? null;
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
      store.outreach.setLocation(clinicId, b.id, { placeId: found.placeId, lat: found.lat, lng: found.lng });
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
