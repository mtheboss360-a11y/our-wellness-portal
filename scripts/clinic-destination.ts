import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { openStore } from '../server/store';
import { destinationInput } from '../server/partner-validation';
// Where a partner's referral link sends people: the clinic's own booking page, or its phone if it has none.
// Prefer the booking page: the person books with the clinic directly, and this app collects nothing about them.
//   npm run clinic-destination -- --clinic clinic-slug --booking-url https://book.example.com/clinic [--phone +16305550100] [--ref-param ref]
// --ref-param adds the partner's code to the booking link (for example ?ref=AB23CD45) so the clinic's booking tool can
// show which partner sent each booking. Only the code is added, nothing about the person.
if (existsSync('.env')) process.loadEnvFile('.env');
const { values } = parseArgs({ options: { clinic: { type: 'string' }, 'booking-url': { type: 'string' }, phone: { type: 'string' }, 'ref-param': { type: 'string' } } });
if (!values.clinic || !/^[a-z0-9-]{3,80}$/.test(values.clinic)) { console.error('Provide --clinic clinic-slug'); process.exit(1); }
const input = destinationInput.safeParse({ bookingUrl: values['booking-url'], phone: values.phone, refParam: values['ref-param'] });
if (!input.success) { console.error(input.error.issues.map(i => i.message).join('\n')); process.exit(1); }
const store = openStore(resolve(process.env.DATABASE_PATH ?? 'var/portal.sqlite'), false);
store.db.exec('PRAGMA busy_timeout = 10000');
try { store.partners.setDestination(values.clinic, input.data); console.log('Saved. Partner links for this clinic now go to', input.data.bookingUrl ?? `a call page for ${input.data.phone}`); }
catch (error) { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }
finally { store.close(); }
