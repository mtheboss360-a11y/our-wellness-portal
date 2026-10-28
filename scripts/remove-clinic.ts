// REMOVE A PRACTICE AND EVERYTHING THAT BELONGS TO IT.
//
//   npm run remove-clinic -- --clinic <clinic-id> --dry-run   # look, change nothing
//   npm run remove-clinic -- --clinic <clinic-id>             # then type the clinic id
//
// This is the one command here that destroys real records. It exists because starting an
// account over otherwise means hand-written SQL against a live database, which is worse.
//
// WHAT IT TOUCHES. Every statement is scoped to one clinic: `clinic_id = ?` on the
// twenty-six tables that carry it, `owner_clinic_id = ?` on network_records, the sessions
// belonging to that clinic's own logins, and finally the clinic row. Another practice's
// records are not merely spared, they are unreachable from here — there is no statement in
// this file that can match a row belonging to anybody else.
//
// WHAT IT WILL NOT DO. It will not run without naming an existing clinic. It will not act on
// a typed confirmation that is anything other than the clinic's own id, so a mistyped slug
// deletes nothing. It never guesses which rows are illustrative and which are real: it takes
// all of them, which is the point, and that is why the backup is written first and is not
// optional.
//
// THE BACKUP is a JSON file under var/backups (override with BACKUP_DIR), written before a
// single row is deleted and left behind whether the delete succeeds or fails. On Render,
// var/ is inside the container — copy the file out if you want to keep it.
import { parseArgs } from 'node:util';
import { createInterface } from 'node:readline/promises';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { openStore } from '../server/store.ts';

if (existsSync('.env')) process.loadEnvFile('.env');

const { values } = parseArgs({ options: {
  clinic: { type: 'string' }, 'dry-run': { type: 'boolean' }, yes: { type: 'boolean' },
} });

const clinicId = values.clinic ?? '';
const dryRun = values['dry-run'] === true;
if (!/^[a-z0-9-]{3,80}$/.test(clinicId)) throw new Error('Provide --clinic clinic-slug.');

/**
 * Every table scoped by `clinic_id`, child before parent. The order is what lets the delete
 * run as one transaction: a row is gone before the row it points at. `defer_foreign_keys`
 * below is the belt to this braces — if the order is ever wrong, COMMIT fails and the whole
 * thing rolls back rather than leaving half an account behind.
 */
const CLINIC_TABLES = [
  'visit_edits', 'visit_materials', 'visit_notes', 'visit_scripts', 'visits',
  'round_changes', 'round_pickups', 'round_stops', 'round_supplies', 'rounds',
  'businesses', 'releases',
  'campaigns', 'field_logs', 'route_requests', 'route_selections',
  'bakery_choices', 'bakery_hidden', 'bakery_places', 'bakery_refreshes', 'bakery_requests',
  'map_place_ids', 'map_places', 'map_refreshes',
  'clinic_locations', 'users',
] as const;

const store = openStore(resolve(process.env.DATABASE_PATH ?? 'var/portal.sqlite'), false);

try {
  const clinic = store.db.prepare('SELECT id,name,plan,demo FROM clinics WHERE id=?').get(clinicId) as
    { id: string; name: string; plan: string; demo: number } | undefined;
  if (!clinic) throw new Error(`No clinic "${clinicId}". Nothing has been changed.`);

  console.log(`\nClinic:  ${clinic.name}`);
  console.log(`Id:      ${clinic.id}`);
  console.log(`Plan:    ${clinic.plan}`);
  console.log(`Status:  ${clinic.demo === 1 ? 'DEMO' : 'LIVE'}\n`);

  // ── 1. Everything that would go ─────────────────────────────────────────────
  const counts = CLINIC_TABLES.map(table => ({
    table,
    n: (store.db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE clinic_id=?`).get(clinicId) as { n: number }).n,
  }));
  const networkRecords = (store.db.prepare(
    'SELECT COUNT(*) AS n FROM network_records WHERE owner_clinic_id=?').get(clinicId) as { n: number }).n;
  const sessions = (store.db.prepare(
    'SELECT COUNT(*) AS n FROM sessions WHERE user_id IN (SELECT id FROM users WHERE clinic_id=?)')
    .get(clinicId) as { n: number }).n;

  console.log('Would delete');
  let total = 0;
  for (const { table, n } of counts) {
    total += n;
    if (n) console.log(`  ${String(n).padStart(5)}  ${table}`);
  }
  if (networkRecords) console.log(`  ${String(networkRecords).padStart(5)}  network_records (owned by this clinic)`);
  if (sessions) console.log(`  ${String(sessions).padStart(5)}  sessions (this clinic's logins are signed out)`);
  console.log(`  ${String(1).padStart(5)}  the clinic record itself`);
  total += networkRecords + sessions + 1;

  // The people are worth naming. A count does not tell you whose account is about to go.
  const logins = store.db.prepare('SELECT email FROM users WHERE clinic_id=? ORDER BY email').all(clinicId) as Array<{ email: string }>;
  if (logins.length) console.log(`\nLogins that stop working: ${logins.map(l => l.email).join(', ')}`);

  const businesses = store.db.prepare('SELECT name FROM businesses WHERE clinic_id=? ORDER BY name LIMIT 8').all(clinicId) as Array<{ name: string }>;
  const businessCount = counts.find(c => c.table === 'businesses')?.n ?? 0;
  if (businesses.length) {
    console.log(`Businesses released to it: ${businesses.map(b => b.name).join(', ')}${businessCount > businesses.length ? ` and ${businessCount - businesses.length} more` : ''}`);
  }
  const visitCount = counts.find(c => c.table === 'visits')?.n ?? 0;
  if (visitCount) console.log(`\nWARNING: ${visitCount} recorded visits go with it. That is field history somebody walked for.`);

  console.log(`\n${total} rows in all. Every other practice on this database is untouched.`);

  if (dryRun) { console.log('\nDRY RUN — nothing was changed.\n'); process.exit(0); }

  // ── 2. Say its name ─────────────────────────────────────────────────────────
  // The clinic's own id, not a fixed word: typing the wrong slug then deletes nothing,
  // which is the mistake most worth catching.
  if (!values.yes) {
    const ask = createInterface({ input: process.stdin, output: process.stdout });
    const typed = (await ask.question(`\nType the clinic id "${clinicId}" to delete it and everything above: `)).trim();
    ask.close();
    if (typed !== clinicId) { console.log('Not deleted. Nothing has been changed.'); process.exit(1); }
  }

  // ── 3. A copy of everything first ───────────────────────────────────────────
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = resolve(process.env.BACKUP_DIR ?? join(process.cwd(), 'var', 'backups'));
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const backupPath = join(dir, `${clinicId}-before-remove-${stamp}.json`);

  const backup: Record<string, unknown> = { clinicId, clinic, takenAt: new Date().toISOString() };
  for (const table of CLINIC_TABLES) {
    backup[table] = store.db.prepare(`SELECT * FROM ${table} WHERE clinic_id=?`).all(clinicId);
  }
  backup.network_records = store.db.prepare('SELECT * FROM network_records WHERE owner_clinic_id=?').all(clinicId);
  writeFileSync(backupPath, JSON.stringify(backup, null, 2), { mode: 0o600 });
  console.log(`\nBackup written: ${backupPath}`);
  console.log('Password hashes are in it. Treat it as a credential and delete it when you no longer want it.');

  // ── 4. Delete, all of it or none of it ──────────────────────────────────────
  const removed: Record<string, number> = {};
  store.db.prepare('BEGIN IMMEDIATE').run();
  try {
    // Deferred, so the order below is checked once at COMMIT instead of statement by
    // statement. A dangling reference fails the whole transaction rather than half of it.
    store.db.prepare('PRAGMA defer_foreign_keys=ON').run();

    removed.sessions = store.db.prepare(
      'DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE clinic_id=?)').run(clinicId).changes as number;
    for (const table of CLINIC_TABLES) {
      removed[table] = store.db.prepare(`DELETE FROM ${table} WHERE clinic_id=?`).run(clinicId).changes as number;
    }
    removed.network_records = store.db.prepare(
      'DELETE FROM network_records WHERE owner_clinic_id=?').run(clinicId).changes as number;
    removed.clinic = store.db.prepare('DELETE FROM clinics WHERE id=?').run(clinicId).changes as number;

    store.db.prepare('COMMIT').run();
  } catch (error) {
    store.db.prepare('ROLLBACK').run();
    console.error(`\nFAILED — nothing was deleted. ${(error as Error).message}`);
    console.error(`Your backup is still at ${backupPath}.`);
    process.exit(3);
  }

  // ── 5. What is left ─────────────────────────────────────────────────────────
  const deleted = Object.values(removed).reduce((a, b) => a + b, 0);
  console.log(`\n${clinic.name} is gone. ${deleted} rows deleted.`);

  const gone = store.db.prepare('SELECT COUNT(*) AS n FROM clinics WHERE id=?').get(clinicId) as { n: number };
  if (gone.n !== 0) { console.error('The clinic row is still there. Something is wrong — check the backup.'); process.exit(4); }

  const rest = store.db.prepare('SELECT id,name FROM clinics ORDER BY name').all() as Array<{ id: string; name: string }>;
  console.log(rest.length
    ? `\nStill on this database: ${rest.map(c => `${c.name} (${c.id})`).join(', ')}`
    : '\nNo practices left on this database.');
  console.log(`\nTo put it back, the backup is at ${backupPath}.\n`);
} finally { store.close(); }
