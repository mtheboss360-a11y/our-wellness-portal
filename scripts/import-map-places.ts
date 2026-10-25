// Put a hand-researched shortlist of businesses on one clinic's Network Map.
//
//   npm run import-map-places -- --clinic ethr-lab --file ./agency/ethr-lab-batch-1.json
//
// Discovery (npm run refresh-network-map) answers the twenty NEAREST businesses per category,
// so a researched pick three miles out never appears however good a fit it is. This command
// fills that gap: one Place Details call per ID, straight into the same 30-day cache the map
// reads, classified and cross-referenced by the same rules as everything else on the map.
//
// The file holds place IDs, which the Maps terms allow to be kept indefinitely. The names and
// ratings are fetched here and expire with the rest of the cache, so re-run this command when
// a batch ages out. Agency data, never client input: terminal only, like the other admin jobs.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { openStore } from '../server/store';
import { fetchPlaces, configured } from '../server/network/places';
import { mapPlacesFeed } from '../server/validation';
if (existsSync('.env')) process.loadEnvFile('.env');
const { values } = parseArgs({ options: { clinic: { type: 'string' }, file: { type: 'string' } } });
if (!values.clinic || !/^[a-z0-9-]{3,80}$/.test(values.clinic)) throw new Error('Provide --clinic clinic-slug');
if (!values.file) throw new Error('Provide --file path/to/batch.json');
if (statSync(values.file).size > 2000000) throw new Error('Import is limited to 2 MB.');
if (!configured()) { console.error('Google_places_API is not set in this environment. Nothing was requested.'); process.exit(1); }
const batch = mapPlacesFeed.parse(JSON.parse(readFileSync(values.file, 'utf8')));
const store = openStore(resolve(process.env.DATABASE_PATH ?? 'var/portal.sqlite'), false);
try {
  if (!store.clinicLocation(values.clinic)) throw new Error('Set this clinic\'s map location first: npm run set-clinic-location.');
  const { found, missing } = await fetchPlaces(batch.map(row => row.placeId));
  store.saveDiscovery(values.clinic, found);
  const rows = new Map(store.businesses(values.clinic).map(row => [row.placeId, row]));
  for (const row of batch) {
    const live = rows.get(row.placeId);
    const label = live ? `${live.category?.label ?? 'Needs review'} · ${live.distanceMiles} mi · fit ${live.fit.score} · ${live.statusLabel}` : 'not on the map';
    console.log(`${live?.name ?? (row.name || row.placeId)}\n  ${label}${row.why ? `\n  why: ${row.why}` : ''}${row.source ? `\n  source: ${row.source}` : ''}`);
  }
  console.log(`\n${found.length} of ${batch.length} placed on ${values.clinic}'s map.`);
  if (missing.length) console.log(`Not found or permanently closed, so not placed: ${missing.join(', ')}`);
} finally { store.close(); }
