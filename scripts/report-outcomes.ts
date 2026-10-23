import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { openStore } from '../server/store';
import { outcomeReport } from '../server/partner-validation';
// The clinic reports back what its partners' referrals became, as counts per code per day. No names, no contact
// details, no treatments: the file is rejected if any entry has a field other than code, day, received and booked.
//   npm run report-outcomes -- --clinic clinic-slug --file october.json
// {
//   "from": "2026-10-01", "to": "2026-10-31",
//   "reports": ["received", "booked"],
//   "entries": [ { "code": "AB23CD45", "day": "2026-10-03", "received": 2, "booked": 1 } ]
// }
// "reports" says which counts this file covers for every day from..to: a day in range with no entry is a real zero.
// Re-importing the same dates replaces what was reported before. Days never reported show as "Not reported".
if (existsSync('.env')) process.loadEnvFile('.env');
const { values } = parseArgs({ options: { clinic: { type: 'string' }, file: { type: 'string' } } });
if (!values.clinic || !values.file || !/^[a-z0-9-]{3,80}$/.test(values.clinic)) { console.error('Provide --clinic clinic-slug --file path/to/outcomes.json'); process.exit(1); }
if (statSync(values.file).size > 5000000) { console.error('Reports are limited to 5 MB.'); process.exit(1); }
const parsed = outcomeReport.safeParse(JSON.parse(readFileSync(values.file, 'utf8')));
if (!parsed.success) { console.error(parsed.error.issues.slice(0, 20).map(i => `${i.path.join('.')}: ${i.message}`).join('\n')); process.exit(1); }
const store = openStore(resolve(process.env.DATABASE_PATH ?? 'var/portal.sqlite'), false);
try { const rows = store.partners.reportOutcomes(values.clinic, parsed.data); console.log(`Saved ${rows} count${rows === 1 ? '' : 's'} covering ${parsed.data.from} to ${parsed.data.to} (${parsed.data.reports.join(' and ')}).`); }
catch (error) { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }
finally { store.close(); }
