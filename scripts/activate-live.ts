// TURN A DEMO ACCOUNT INTO A LIVE ONE.
//
//   npm run activate-live -- --clinic <clinic-id> --dry-run     # look, change nothing
//   npm run activate-live -- --clinic <clinic-id>               # then type ACTIVATE
//
// THE RULE THIS WHOLE SCRIPT IS BUILT AROUND: it never decides for itself which records are
// fictional. Every table that can hold illustrative data carries a `demo` column that is
// deliberately nullable — 1 means somebody marked this illustrative when they created it, 0
// means somebody marked it real, and NULL means nobody said. NULL is not treated as either.
// If a clinic has any unlabelled rows the command stops and lists them, because the one thing
// worse than leaving a demo record behind is deleting a real one.
//
// Everything it does is scoped to one clinic. No statement here touches a row without
// `clinic_id = ?`, so another practice's records are not merely spared, they are unreachable.
//
// Running it on an account that is already live is a no-op that says so.
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
 * The tables that can hold illustrative records, and how a row of each is described in the
 * preview. Anything not on this list is never deleted by this command — real businesses, their
 * scripts, recorded visits, staff accounts, sessions, permissions and the clinic itself.
 */
const DEMO_TABLES = [
  { table: 'campaigns', label: 'campaigns', describe: 'name' },
  { table: 'field_logs', label: 'field logs', describe: null },
  { table: 'visit_notes', label: 'route notes', describe: 'business_id' },
  { table: 'businesses', label: 'businesses', describe: 'name' },
  { table: 'visits', label: 'recorded visits', describe: 'business_id' },
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

  // ── 1. What is labelled what ────────────────────────────────────────────────
  const counted = DEMO_TABLES.map(spec => {
    const row = store.db.prepare(
      `SELECT SUM(CASE WHEN demo=1 THEN 1 ELSE 0 END) AS demo,
              SUM(CASE WHEN demo=0 THEN 1 ELSE 0 END) AS real,
              SUM(CASE WHEN demo IS NULL THEN 1 ELSE 0 END) AS unlabelled
       FROM ${spec.table} WHERE clinic_id=?`).get(clinicId) as
      { demo: number | null; real: number | null; unlabelled: number | null };
    return { ...spec, demo: row.demo ?? 0, real: row.real ?? 0, unlabelled: row.unlabelled ?? 0 };
  });

  const unlabelled = counted.filter(c => c.unlabelled > 0);
  const toDelete = counted.filter(c => c.demo > 0);

  console.log('What this account holds');
  for (const c of counted) {
    if (!c.demo && !c.real && !c.unlabelled) continue;
    console.log(`  ${c.label.padEnd(16)} ${String(c.demo).padStart(4)} demo  ${String(c.real).padStart(4)} real  ${String(c.unlabelled).padStart(4)} unlabelled`);
  }

  // ── 2. Stop on anything nobody has labelled ─────────────────────────────────
  if (unlabelled.length) {
    console.error(`\nSTOPPED. ${unlabelled.reduce((n, c) => n + c.unlabelled, 0)} rows are not labelled demo or real:`);
    for (const c of unlabelled) console.error(`  ${c.unlabelled} in ${c.label}`);
    console.error(`
These were written before records carried a label, so nothing here knows whether they are
illustrative or real. This command will not guess. Label them first — in SQL, for example:

  UPDATE field_logs SET demo=1 WHERE clinic_id='${clinicId}';   -- it IS illustrative
  UPDATE campaigns  SET demo=0 WHERE clinic_id='${clinicId}';   -- it IS real

Nothing has been changed.`);
    process.exit(2);
  }

  // ── 3. The preview ──────────────────────────────────────────────────────────
  const kept = {
    businesses: store.db.prepare('SELECT COUNT(*) AS n FROM businesses WHERE clinic_id=? AND demo=0').get(clinicId) as { n: number },
    visits: store.db.prepare('SELECT COUNT(*) AS n FROM visits WHERE clinic_id=? AND demo=0').get(clinicId) as { n: number },
    users: store.db.prepare('SELECT COUNT(*) AS n FROM users WHERE clinic_id=?').get(clinicId) as { n: number },
  };
  const keptScripts = store.db.prepare(
    'SELECT COUNT(*) AS n FROM visit_scripts s JOIN businesses b ON b.id=s.business_id WHERE s.clinic_id=? AND b.demo=0')
    .get(clinicId) as { n: number };

  if (!toDelete.length) {
    console.log('\nThere is nothing labelled illustrative on this account.');
    if (clinic.demo === 0) { console.log('It is already live. Nothing to do.'); process.exit(0); }
  } else {
    console.log('\nWould delete');
    for (const c of toDelete) {
      const names = c.describe
        ? (store.db.prepare(`SELECT ${c.describe} AS d FROM ${c.table} WHERE clinic_id=? AND demo=1 LIMIT 6`).all(clinicId) as Array<{ d: string }>).map(r => r.d)
        : [];
      console.log(`  ${c.demo} ${c.label}${names.length ? `: ${names.join(', ')}${c.demo > names.length ? ` and ${c.demo - names.length} more` : ''}` : ''}`);
    }
    // Scripts and edit history belong to the business they describe, so a demo business takes
    // its own with it. Nothing attached to a real business is touched.
    const demoScripts = store.db.prepare(
      'SELECT COUNT(*) AS n FROM visit_scripts s JOIN businesses b ON b.id=s.business_id WHERE s.clinic_id=? AND b.demo=1').get(clinicId) as { n: number };
    if (demoScripts.n) console.log(`  ${demoScripts.n} scripts belonging to those businesses`);
  }

  console.log('\nWould keep');
  console.log(`  ${kept.businesses.n} real businesses and ${keptScripts.n} of their scripts`);
  console.log(`  ${kept.visits.n} recorded visits`);
  console.log(`  ${kept.users.n} staff and client logins, and every permission`);
  console.log('  the clinic record, its address and its plan');

  console.log('\nThe cached Google places for this clinic are cleared too. That is a cache the');
  console.log('Referral Network rebuilds on its next refresh, not a record of anything.');

  if (dryRun) { console.log('\nDRY RUN — nothing was changed.\n'); process.exit(0); }

  // ── 4. Say the word ─────────────────────────────────────────────────────────
  if (!values.yes) {
    const ask = createInterface({ input: process.stdin, output: process.stdout });
    const typed = (await ask.question(`\nType ACTIVATE to do this to ${clinic.name}: `)).trim();
    ask.close();
    if (typed !== 'ACTIVATE') { console.log('Not activated. Nothing has been changed.'); process.exit(1); }
  }

  // ── 5. A copy of everything first ───────────────────────────────────────────
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = resolve(process.env.BACKUP_DIR ?? join(process.cwd(), 'var', 'backups'));
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const backupPath = join(dir, `${clinicId}-before-activate-${stamp}.json`);

  const backup: Record<string, unknown> = { clinicId, clinic, takenAt: new Date().toISOString() };
  for (const spec of DEMO_TABLES) {
    backup[spec.table] = store.db.prepare(`SELECT * FROM ${spec.table} WHERE clinic_id=?`).all(clinicId);
  }
  backup.visit_scripts = store.db.prepare('SELECT * FROM visit_scripts WHERE clinic_id=?').all(clinicId);
  backup.map_place_ids = store.db.prepare('SELECT * FROM map_place_ids WHERE clinic_id=?').all(clinicId);
  writeFileSync(backupPath, JSON.stringify(backup, null, 2), { mode: 0o600 });
  console.log(`\nBackup written: ${backupPath}`);

  // ── 6. Delete, all of it or none of it ──────────────────────────────────────
  const removed: Record<string, number> = {};
  store.db.prepare('BEGIN IMMEDIATE').run();
  try {
    // Scripts first: they point at the businesses about to go.
    removed.scripts = store.db.prepare(
      `DELETE FROM visit_scripts WHERE clinic_id=? AND business_id IN
         (SELECT id FROM businesses WHERE clinic_id=? AND demo=1)`).run(clinicId, clinicId).changes as number;
    removed.visit_edits = store.db.prepare(
      `DELETE FROM visit_edits WHERE clinic_id=? AND visit_id IN
         (SELECT id FROM visits WHERE clinic_id=? AND demo=1)`).run(clinicId, clinicId).changes as number;
    // Visits before businesses: a visit references the business it happened at.
    removed.visits = store.db.prepare('DELETE FROM visits WHERE clinic_id=? AND demo=1').run(clinicId).changes as number;

    // A demo business with a real visit against it is a mixed dependency. Stop rather than
    // orphan or cascade into something real.
    const mixed = store.db.prepare(
      `SELECT b.name FROM businesses b WHERE b.clinic_id=? AND b.demo=1
         AND EXISTS (SELECT 1 FROM visits v WHERE v.business_id=b.id AND v.demo=0)`).all(clinicId) as Array<{ name: string }>;
    if (mixed.length) throw new Error(`Real visits are recorded at demo businesses: ${mixed.map(m => m.name).join(', ')}. Nothing deleted.`);

    removed.businesses = store.db.prepare('DELETE FROM businesses WHERE clinic_id=? AND demo=1').run(clinicId).changes as number;
    removed.visit_notes = store.db.prepare('DELETE FROM visit_notes WHERE clinic_id=? AND demo=1').run(clinicId).changes as number;
    removed.field_logs = store.db.prepare('DELETE FROM field_logs WHERE clinic_id=? AND demo=1').run(clinicId).changes as number;
    removed.campaigns = store.db.prepare('DELETE FROM campaigns WHERE clinic_id=? AND demo=1').run(clinicId).changes as number;
    // A release with nothing left in it is not a release.
    removed.releases = store.db.prepare(
      `DELETE FROM releases WHERE clinic_id=? AND id NOT IN (SELECT release_id FROM businesses WHERE clinic_id=?)`)
      .run(clinicId, clinicId).changes as number;

    store.db.prepare('UPDATE clinics SET demo=0 WHERE id=?').run(clinicId);
    store.db.prepare('COMMIT').run();
  } catch (error) {
    store.db.prepare('ROLLBACK').run();
    console.error(`\nFAILED — nothing was deleted. ${(error as Error).message}`);
    console.error(`Your backup is still at ${backupPath}.`);
    process.exit(3);
  }

  // The Google cache is regenerable and belongs to no record, so it goes last and outside the
  // transaction that protects the records.
  store.clearDiscovery(clinicId);
  store.db.prepare('DELETE FROM map_place_ids WHERE clinic_id=?').run(clinicId);

  // ── 7. What the account looks like now ──────────────────────────────────────
  const now = {
    businesses: (store.db.prepare('SELECT COUNT(*) AS n FROM businesses WHERE clinic_id=?').get(clinicId) as { n: number }).n,
    visits: (store.db.prepare('SELECT COUNT(*) AS n FROM visits WHERE clinic_id=?').get(clinicId) as { n: number }).n,
    campaigns: (store.db.prepare('SELECT COUNT(*) AS n FROM campaigns WHERE clinic_id=?').get(clinicId) as { n: number }).n,
    fieldLog: (store.db.prepare('SELECT COUNT(*) AS n FROM field_logs WHERE clinic_id=?').get(clinicId) as { n: number }).n,
  };

  console.log(`\n${clinic.name} is now LIVE.\n`);
  console.log('Deleted');
  for (const [what, n] of Object.entries(removed)) if (n) console.log(`  ${n} ${what.replace(/_/g, ' ')}`);
  console.log('\nRemaining, all real');
  console.log(`  ${now.businesses} businesses`);
  console.log(`  ${now.visits} recorded visits`);
  console.log(`  ${now.campaigns} campaigns`);
  console.log(`  ${now.fieldLog ? 'a field log' : 'no field log'}`);
  console.log(`\nEvery dashboard figure is counted from these rows at read time, so the portal`);
  console.log(`already shows the real numbers — there is no cached total to rebuild.`);
  console.log(`\nBackup: ${backupPath}`);
  if (!now.businesses) console.log('\nThis account now has no businesses. Release a batch before anybody goes out.');
} finally { store.close(); }
