import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { openStore } from '../server/store';
import { campaignFeed } from '../server/validation';
if (existsSync('.env')) process.loadEnvFile('.env');
const { values } = parseArgs({ options: { clinic: { type: 'string' }, file: { type: 'string' } } });
if (!values.clinic || !values.file || !/^[a-z0-9-]{3,80}$/.test(values.clinic)) throw new Error('Provide --clinic clinic-slug --file path/to/campaigns.json');
if (statSync(values.file).size > 20000000) throw new Error('Import is limited to 20 MB.');
const campaigns = campaignFeed.parse(JSON.parse(readFileSync(values.file,'utf8')));
const store = openStore(resolve(process.env.DATABASE_PATH ?? 'var/portal.sqlite'), false);
try { store.saveCampaigns(values.clinic,campaigns); console.log('Validated campaigns saved for the specified clinic.'); }
finally { store.close(); }
