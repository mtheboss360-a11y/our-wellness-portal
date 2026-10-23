import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { openStore } from '../server/store';
import { dayOf } from '../server/partner-store';
// The clinic's view of its network, from the server terminal: who joined and when, and each partner's code.
//   npm run partners -- --clinic clinic-slug
//   npm run partners -- --clinic clinic-slug --pause AB23CD45     (the link shows "not active"; activity is kept)
//   npm run partners -- --clinic clinic-slug --resume AB23CD45
//   npm run partners -- --clinic clinic-slug --remove AB23CD45    (the partner leaves: sign-in and contact name are
//                                                                 deleted, the link stops; business name and counts stay)
if (existsSync('.env')) process.loadEnvFile('.env');
const { values } = parseArgs({ options: { clinic: { type: 'string' }, pause: { type: 'string' }, resume: { type: 'string' }, remove: { type: 'string' } } });
if (!values.clinic || !/^[a-z0-9-]{3,80}$/.test(values.clinic)) { console.error('Provide --clinic clinic-slug'); process.exit(1); }
const store = openStore(resolve(process.env.DATABASE_PATH ?? 'var/portal.sqlite'), false);
store.db.exec('PRAGMA busy_timeout = 10000');
try {
  if (values.remove) {
    const code = values.remove.toUpperCase();
    const ok = store.partners.removePartner(values.clinic, code);
    console.log(ok ? `Removed the partner with code ${code}: their sign-in and contact name are deleted and the link no longer works.` : `No current partner of this clinic has code ${code}.`);
    if (!ok) process.exitCode = 1;
  } else if (values.pause || values.resume) {
    const code = (values.pause ?? values.resume)!.toUpperCase();
    const ok = store.partners.setPartnerStatus(values.clinic, code, values.pause ? 'paused' : 'active');
    console.log(ok ? `${values.pause ? 'Paused' : 'Resumed'} the partner with code ${code}.` : `No current partner of this clinic has code ${code}.`);
    if (!ok) process.exitCode = 1;
  }
  const rows = store.partners.listPartners(values.clinic);
  if (!rows.length) console.log('No partners have joined yet.');
  for (const r of rows) console.log([r.business_name, r.contact_name || '(left)', r.email ?? '(no sign-in)', `joined ${dayOf(r.joined_at)}`, r.status, `code ${r.codes}`].join(' | '));
} finally { store.close(); }
