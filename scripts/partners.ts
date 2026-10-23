import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { openStore } from '../server/store';
// The clinic's view of its network, from the server terminal: who joined and when, and each partner's code.
//   npm run partners -- --clinic clinic-slug
//   npm run partners -- --clinic clinic-slug --pause AB23CD45     (the link shows "not active"; activity is kept)
//   npm run partners -- --clinic clinic-slug --resume AB23CD45
if (existsSync('.env')) process.loadEnvFile('.env');
const { values } = parseArgs({ options: { clinic: { type: 'string' }, pause: { type: 'string' }, resume: { type: 'string' } } });
if (!values.clinic || !/^[a-z0-9-]{3,80}$/.test(values.clinic)) { console.error('Provide --clinic clinic-slug'); process.exit(1); }
const store = openStore(resolve(process.env.DATABASE_PATH ?? 'var/portal.sqlite'), false);
try {
  const code = (values.pause ?? values.resume)?.toUpperCase();
  if (code) {
    const ok = store.partners.setPartnerStatus(values.clinic, code, values.pause ? 'paused' : 'active');
    console.log(ok ? `${values.pause ? 'Paused' : 'Resumed'} the partner with code ${code}.` : `No partner of this clinic has code ${code}.`);
    if (!ok) process.exitCode = 1;
  }
  const rows = store.partners.listPartners(values.clinic);
  if (!rows.length) console.log('No partners have joined yet.');
  for (const r of rows) console.log([r.business_name, r.contact_name, r.email, `joined ${new Date(r.joined_at).toISOString().slice(0, 10)}`, r.status, `code ${r.codes}`].join(' | '));
} finally { store.close(); }
