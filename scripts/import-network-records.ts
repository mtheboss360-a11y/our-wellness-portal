// The network's own client, partner, exclusivity, competitor and do-not-approach records —
// the data every cross-reference status is decided against. Agency data, never client input.
//
//   npm run import-network-records -- --file ./network-records.json
//
// Each record: { id, kind, ownerClinicId, placeId, name, address, note }. `kind` is one of
// client, partner, exclusive, competitor, blocked. `ownerClinicId` is the clinic that holds
// the arrangement — it decides whether another clinic sees "Already in network" or
// "Unavailable", and it is never sent to a browser. Existing IDs are updated; records left
// out of the file are retained, not deleted.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { openStore } from '../server/store';
import { networkRecordsFeed } from '../server/validation';
if (existsSync('.env')) process.loadEnvFile('.env');
const { values } = parseArgs({ options: { file: { type: 'string' } } });
if (!values.file) throw new Error('Provide --file path/to/network-records.json');
if (statSync(values.file).size > 20000000) throw new Error('Import is limited to 20 MB.');
const records = networkRecordsFeed.parse(JSON.parse(readFileSync(values.file, 'utf8')));
const store = openStore(resolve(process.env.DATABASE_PATH ?? 'var/portal.sqlite'), false);
try { store.saveNetworkRecords(records); console.log(`${records.length} network record${records.length === 1 ? '' : 's'} saved.`); }
finally { store.close(); }
