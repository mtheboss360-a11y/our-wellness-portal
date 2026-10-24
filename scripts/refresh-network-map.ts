// Spend a round of Google Places calls for one clinic, now, from the terminal.
//
//   npm run refresh-network-map -- --clinic ethr-lab
//
// This is the forced pass: it ignores the cooldown the portal itself obeys. The key comes
// from Google_places_API in the environment and is never printed. One Nearby Search per
// category, results cached for 30 days.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { openStore } from '../server/store';
import { ensureDiscovery } from '../server/network/map';
import { configured } from '../server/network/places';
if (existsSync('.env')) process.loadEnvFile('.env');
const { values } = parseArgs({ options: { clinic: { type: 'string' } } });
if (!values.clinic || !/^[a-z0-9-]{3,80}$/.test(values.clinic)) throw new Error('Provide --clinic clinic-slug');
if (!configured()) { console.error('Google_places_API is not set in this environment. Nothing was requested.'); process.exit(1); }
const store = openStore(resolve(process.env.DATABASE_PATH ?? 'var/portal.sqlite'), false);
try {
  const outcome = await ensureDiscovery(store, values.clinic, { force: true, auto: false });
  console.log(`${outcome.status}: ${outcome.detail}`);
  process.exitCode = outcome.status === 'failed' ? 1 : 0;
} finally { store.close(); }
