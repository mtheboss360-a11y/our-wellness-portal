// Cut a clinic's map back to its researched batches.
//
//   npm run prune-map -- --clinic ethr-lab --file ./agency/ethr-lab-batch-1.json
//
// Pass --file once per batch the clinic should keep. Everything else cached for that clinic
// is removed: the businesses an earlier discovery pass found, competitors and public leisure
// centres included. Pair it with NETWORK_MAP_AUTO_DISCOVER=false, or the next map open will
// simply fill the gaps in again.
//
// A curated map lives or dies by the batch: cached Google content expires after 30 days, and
// with automatic discovery off nothing replaces it, so re-run the import before then.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { openStore } from '../server/store';
import { mapPlacesFeed } from '../server/validation';
if (existsSync('.env')) process.loadEnvFile('.env');
const { values } = parseArgs({ options: { clinic: { type: 'string' }, file: { type: 'string', multiple: true } } });
if (!values.clinic || !/^[a-z0-9-]{3,80}$/.test(values.clinic)) throw new Error('Provide --clinic clinic-slug');
if (!values.file?.length) throw new Error('Provide --file path/to/batch.json, once per batch to keep');
const keep = values.file.flatMap(file => mapPlacesFeed.parse(JSON.parse(readFileSync(file, 'utf8'))).map(row => row.placeId));
const store = openStore(resolve(process.env.DATABASE_PATH ?? 'var/portal.sqlite'), false);
try {
  const outcome = store.pruneDiscovery(values.clinic, keep);
  console.log(`${values.clinic}: ${outcome.kept} kept, ${outcome.removed} removed.`);
  if (outcome.kept < keep.length) console.log(`${keep.length - outcome.kept} of the batch is not on the map. Run import-map-places to put it there.`);
} finally { store.close(); }
