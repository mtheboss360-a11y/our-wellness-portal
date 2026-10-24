import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { openStore } from '../server/store';
import { fieldLogFeed } from '../server/validation';
if (existsSync('.env')) process.loadEnvFile('.env');
const { values } = parseArgs({ options: { clinic: { type: 'string' }, file: { type: 'string' } } });
if (!values.clinic || !values.file || !/^[a-z0-9-]{3,80}$/.test(values.clinic)) throw new Error('Provide --clinic clinic-slug --file path/to/field-log.json');
if (statSync(values.file).size > 20000000) throw new Error('Import is limited to 20 MB.');
const feed = fieldLogFeed.parse(JSON.parse(readFileSync(values.file,'utf8')));
const store = openStore(resolve(process.env.DATABASE_PATH ?? 'var/portal.sqlite'), false);
try { store.saveFieldLog(values.clinic,feed); console.log('Validated field log saved for the specified clinic.'); }
finally { store.close(); }
