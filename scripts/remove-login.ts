// DELETE A LOGIN.
//
//   npm run remove-login -- --username <username> [--dry-run]
//
// A login nobody uses is still a way into a practice's records. This removes one, and nothing
// else: no clinic, no business, no script, no visit. A visit already recorded keeps the name
// it was saved under, because who did the work does not change when their account goes.
//
// It refuses to remove the last login on a clinic — an account nobody can sign in to is not
// something to do by accident.
import { parseArgs } from 'node:util';
import { createInterface } from 'node:readline/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { openStore } from '../server/store.ts';

if (existsSync('.env')) process.loadEnvFile('.env');

const { values } = parseArgs({ options: {
  username: { type: 'string' }, 'dry-run': { type: 'boolean' }, yes: { type: 'boolean' },
  // Removing the last login does not delete the clinic — it leaves its records with nobody
  // able to reach them. That is a different decision, so it takes a different flag.
  'orphan-clinic': { type: 'boolean' },
} });

const username = (values.username ?? '').trim().toLowerCase();
if (!username) throw new Error('Provide --username.');

const store = openStore(resolve(process.env.DATABASE_PATH ?? 'var/portal.sqlite'), false);
try {
  const user = store.db.prepare('SELECT id, clinic_id, display_name FROM users WHERE email=?')
    .get(username) as { id: string; clinic_id: string; display_name: string } | undefined;
  if (!user) throw new Error(`No login called "${username}". Nothing has been changed.`);

  const clinic = store.db.prepare('SELECT name, demo FROM clinics WHERE id=?')
    .get(user.clinic_id) as { name: string; demo: number };
  const siblings = store.db.prepare('SELECT COUNT(*) AS n FROM users WHERE clinic_id=?')
    .get(user.clinic_id) as { n: number };

  console.log(`\n${username} — ${user.display_name || 'no person named'} at ${clinic.name} (${user.clinic_id}, ${clinic.demo === 1 ? 'demo' : 'LIVE'})`);
  console.log(`${siblings.n} ${siblings.n === 1 ? 'login reaches' : 'logins reach'} this practice.`);

  const last = siblings.n <= 1;
  if (last) {
    // What would become unreachable. Shown as counts rather than asked about blind: "is this
    // clinic empty" is the question, and nobody should have to guess at the answer.
    const count = (sql: string) => (store.db.prepare(sql).get(user.clinic_id) as { n: number }).n;
    const holds = {
      businesses: count('SELECT COUNT(*) AS n FROM businesses WHERE clinic_id=?'),
      visits: count('SELECT COUNT(*) AS n FROM visits WHERE clinic_id=?'),
      campaigns: count('SELECT COUNT(*) AS n FROM campaigns WHERE clinic_id=?'),
      fieldLog: count('SELECT COUNT(*) AS n FROM field_logs WHERE clinic_id=?'),
      rounds: count('SELECT COUNT(*) AS n FROM rounds WHERE clinic_id=?'),
      notes: count('SELECT COUNT(*) AS n FROM visit_notes WHERE clinic_id=?'),
    };
    const total = Object.values(holds).reduce((a, b) => a + b, 0);

    console.log(`\nThis is the only login for ${clinic.name}. That clinic holds:`);
    console.log(`  ${holds.businesses} businesses, ${holds.visits} visits, ${holds.rounds} rounds`);
    console.log(`  ${holds.campaigns} campaigns, ${holds.notes} route notes, ${holds.fieldLog ? 'a field log' : 'no field log'}`);

    if (!values['orphan-clinic']) {
      console.error(total === 0
        ? `\nSTOPPED. The clinic is empty, so nothing would be lost — but removing its only login still leaves it with no way in. Repeat with --orphan-clinic if that is what you want.`
        : `\nSTOPPED. Removing the only login leaves these records with nobody able to reach them. They are not deleted, just unreachable. Create a replacement login first, or repeat with --orphan-clinic if you are sure.`);
      process.exit(2);
    }
    console.log(`\n--orphan-clinic given. The records above stay in the database, reachable by nobody.`);
  }

  const visits = store.db.prepare('SELECT COUNT(*) AS n FROM visits WHERE clinic_id=? AND staff=?')
    .get(user.clinic_id, user.display_name) as { n: number };
  console.log(`\nWould delete: this login and its sessions.`);
  console.log(`Would keep:   the clinic, its businesses, scripts and every visit.`);
  if (user.display_name && visits.n) {
    console.log(`              ${visits.n} visits recorded under "${user.display_name}" keep that name.`);
  }

  if (values['dry-run']) { console.log('\nDRY RUN — nothing was changed.\n'); process.exit(0); }

  if (!values.yes) {
    const ask = createInterface({ input: process.stdin, output: process.stdout });
    const typed = (await ask.question(`\nType the username again to remove it: `)).trim().toLowerCase();
    ask.close();
    if (typed !== username) { console.log('Not removed. Nothing has been changed.'); process.exit(1); }
  }

  store.db.prepare('BEGIN IMMEDIATE').run();
  try {
    store.db.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id);
    store.db.prepare('DELETE FROM users WHERE id=?').run(user.id);
    store.db.prepare('COMMIT').run();
  } catch (error) { store.db.prepare('ROLLBACK').run(); throw error; }

  console.log(`\n${username} removed. ${siblings.n - 1} ${siblings.n - 1 === 1 ? 'login' : 'logins'} left on ${clinic.name}.`);
  if (last) console.log(`${clinic.name} (${user.clinic_id}) now has no logins. Its records are still there if you ever need them back.`);
} finally { store.close(); }
