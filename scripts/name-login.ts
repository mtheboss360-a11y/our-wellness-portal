// WHOSE LOGIN IS THIS.
//
//   npm run name-login -- --username hylinedental --name "Alexis" [--staff "Alexis"]
//
// An account created as a practice has no person on it: the portal greets the practice, and
// every visit recorded through it saves with no staff name, so that person's work is invisible
// to the staff filter on the performance screen. This puts a name on the login.
//
// --staff ties them to a driver in the clinic's imported field log, where one exists. It is
// optional, and nothing is invented if it does not match.
import { parseArgs } from 'node:util';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { openStore } from '../server/store.ts';

if (existsSync('.env')) process.loadEnvFile('.env');

const { values } = parseArgs({ options: {
  username: { type: 'string' }, name: { type: 'string' }, staff: { type: 'string' },
} });

const username = (values.username ?? '').trim().toLowerCase();
const name = (values.name ?? '').trim();
const staffId = (values.staff ?? '').trim();

if (!username) throw new Error('Provide --username.');
if (!name) throw new Error('Provide --name "Alexis": the name the portal greets them by.');

const store = openStore(resolve(process.env.DATABASE_PATH ?? 'var/portal.sqlite'), false);
try {
  const user = store.db.prepare('SELECT clinic_id, display_name FROM users WHERE email=?')
    .get(username) as { clinic_id: string; display_name: string } | undefined;
  if (!user) throw new Error(`No login called "${username}".`);

  const changed = store.db.prepare('UPDATE users SET display_name=?, staff_id=? WHERE email=?')
    .run(name, staffId || null, username);
  if (!changed.changes) throw new Error('Nothing was changed.');

  const clinic = store.db.prepare('SELECT name FROM clinics WHERE id=?').get(user.clinic_id) as { name: string };
  console.log(`${username} is now ${name} at ${clinic.name}.`);
  if (user.display_name) console.log(`  (was "${user.display_name}")`);
  console.log(`  The portal greets them by name, and visits they record are saved under it.`);

  // Visits already recorded carry whatever name was on the account at the time. Saying so
  // beats quietly rewriting history to match.
  const orphans = store.db.prepare(
    `SELECT COUNT(*) AS n FROM visits WHERE clinic_id=? AND staff='' AND demo IS NOT 1`)
    .get(user.clinic_id) as { n: number };
  if (orphans.n) {
    console.log(`\n  ${orphans.n} real visits on this practice were recorded with no staff name.`);
    console.log(`  They are left as they are — this renames the login, not the past.`);
  }
} finally { store.close(); }
