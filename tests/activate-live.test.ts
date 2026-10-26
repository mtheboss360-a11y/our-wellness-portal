// GOING LIVE. These tests exist because this is the one command in the portal that deletes
// customer records, so each is a thing that must never happen:
//
//   - a real record deleted,
//   - another clinic's record touched,
//   - an unlabelled record deleted because something guessed.
//
// The script itself is a CLI, so these drive it the way the Shell does — as a subprocess
// against a throwaway database — and then read the database back to see what survived.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../server/store.ts';
import type { Script } from '../server/outreach.ts';

const script = (): Script => ({
  opening: 'o', introduction: 'i', value: 'v', ask: 'a',
  objections: { busy: 'b', notInterested: 'n', alreadyPartnered: 'p' }, closing: 'c', followUp: 'f',
});
const entry = (name: string, address: string) => ({ name, category: 'Salon', address, script: script() });

/** A clinic with both kinds of record, plus a second clinic that must come out untouched. */
function world() {
  const dir = mkdtempSync(join(tmpdir(), 'owp-'));
  const file = join(dir, 'portal.sqlite');
  const store = openStore(file, false);

  store.createClient('hyline', 'Hyline Dental', 'hyline', 'pw', 'b', true);
  store.createClient('neighbour', 'Another Practice', 'neighbour', 'pw', 'b', true);

  // Real, on both clinics.
  store.outreach.release('hyline', 'real-1', 'Release 1', 't', [entry('Karve Pilates', '4827 S Route 59')], false);
  store.outreach.release('neighbour', 'their-1', 'Theirs', 't', [entry('Their Salon', '1 Their St')], false);
  // Illustrative, on Hyline only.
  store.outreach.release('hyline', 'demo-1', 'Sample data', 't', [entry('Sample Yoga', '9 Pretend Ave')], true);

  return { dir, file, store };
}

const run = (file: string, args: string[]) => execFileSync('npx', ['tsx', 'scripts/activate-live.ts', ...args], {
  env: { ...process.env, DATABASE_PATH: file, BACKUP_DIR: join(file, '..', 'backups') },
  encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
});

test('a dry run changes nothing and says what it would do', () => {
  const { dir, file, store } = world();
  store.close();
  const out = run(file, ['--clinic', 'hyline', '--dry-run']);

  assert.match(out, /DRY RUN/);
  assert.match(out, /Sample Yoga/, 'it names the demo business');
  assert.doesNotMatch(out.split('Would keep')[0], /Karve Pilates/, 'the real one is not on the deletion list');

  const after = openStore(file, false);
  assert.equal(after.outreach.businesses('hyline').length, 2, 'both still there');
  assert.equal((after.db.prepare('SELECT demo FROM clinics WHERE id=?').get('hyline') as { demo: number }).demo, 1, 'still a demo account');
  after.close(); rmSync(dir, { recursive: true, force: true });
});

test('activating deletes only what is labelled illustrative', () => {
  const { dir, file, store } = world();
  const realBusiness = store.outreach.businesses('hyline').find(b => b.name === 'Karve Pilates')!;
  store.outreach.recordVisit('hyline', {
    businessId: realBusiness.id, staff: 'Alexis', visitedOn: '2026-10-26', spokeWith: 'Dana',
    contactRole: 'Owner', outcome: 'interested', materials: 10, note: 'Real conversation.',
    nextAction: '', followUpOn: null,
  });
  store.close();

  run(file, ['--clinic', 'hyline', '--yes']);
  const after = openStore(file, false);

  const left = after.outreach.businesses('hyline');
  assert.deepEqual(left.map(b => b.name), ['Karve Pilates'], 'the real one survived, the sample did not');
  assert.equal(after.outreach.visits('hyline').length, 1, 'the real visit survived');
  assert.equal(after.outreach.script('hyline', left[0].id)!.script.opening, 'o', 'its script survived');
  assert.equal((after.db.prepare('SELECT demo FROM clinics WHERE id=?').get('hyline') as { demo: number }).demo, 0, 'the account is live');
  assert.equal((after.db.prepare('SELECT COUNT(*) AS n FROM users WHERE clinic_id=?').get('hyline') as { n: number }).n, 1, 'the login survived');
  after.close(); rmSync(dir, { recursive: true, force: true });
});

test('the other clinic is untouched, demo flag and all', () => {
  const { dir, file, store } = world();
  store.close();
  run(file, ['--clinic', 'hyline', '--yes']);

  const after = openStore(file, false);
  assert.deepEqual(after.outreach.businesses('neighbour').map(b => b.name), ['Their Salon']);
  assert.equal((after.db.prepare('SELECT demo FROM clinics WHERE id=?').get('neighbour') as { demo: number }).demo, 1,
    'the neighbour is still a demo account — this command touched one clinic');
  after.close(); rmSync(dir, { recursive: true, force: true });
});

test('an unlabelled record stops the whole thing', () => {
  const { dir, file, store } = world();
  // A row from before labels existed.
  store.db.prepare('UPDATE businesses SET demo=NULL WHERE clinic_id=? AND name=?').run('hyline', 'Karve Pilates');
  store.close();

  let failed = false, output = '';
  try { run(file, ['--clinic', 'hyline', '--yes']); }
  catch (error) { failed = true; output = String((error as { stdout?: string; stderr?: string }).stdout ?? '') + String((error as { stderr?: string }).stderr ?? ''); }

  assert.ok(failed, 'it refused');
  assert.match(output, /STOPPED/);
  assert.match(output, /not labelled demo or real/);

  const after = openStore(file, false);
  assert.equal(after.outreach.businesses('hyline').length, 2, 'nothing was deleted');
  assert.equal((after.db.prepare('SELECT demo FROM clinics WHERE id=?').get('hyline') as { demo: number }).demo, 1, 'still a demo account');
  after.close(); rmSync(dir, { recursive: true, force: true });
});

test('a real visit at a demo business stops the deletion rather than cascading into it', () => {
  const { dir, file, store } = world();
  const sample = store.outreach.businesses('hyline').find(b => b.name === 'Sample Yoga')!;
  store.outreach.recordVisit('hyline', {
    businessId: sample.id, staff: 'Alexis', visitedOn: '2026-10-26', spokeWith: 'Someone',
    contactRole: '', outcome: 'interested', materials: 0, note: '', nextAction: '', followUpOn: null,
  });
  store.close();

  let failed = false, output = '';
  try { run(file, ['--clinic', 'hyline', '--yes']); }
  catch (error) { failed = true; output = String((error as { stdout?: string }).stdout ?? '') + String((error as { stderr?: string }).stderr ?? ''); }

  assert.ok(failed, 'it refused');
  assert.match(output, /Real visits are recorded at demo businesses/);

  const after = openStore(file, false);
  assert.equal(after.outreach.businesses('hyline').length, 2, 'rolled back whole');
  assert.equal(after.outreach.visits('hyline').length, 1, 'the real visit is still there');
  after.close(); rmSync(dir, { recursive: true, force: true });
});

test('a backup is written before anything is deleted', () => {
  const { dir, file, store } = world();
  store.close();
  run(file, ['--clinic', 'hyline', '--yes']);

  const backups = readdirSync(join(dir, 'backups'));
  assert.equal(backups.length, 1);
  assert.match(backups[0], /^hyline-before-activate-/);
  rmSync(dir, { recursive: true, force: true });
});

test('running it twice is safe and says there is nothing to do', () => {
  const { dir, file, store } = world();
  store.close();
  run(file, ['--clinic', 'hyline', '--yes']);
  const second = run(file, ['--clinic', 'hyline', '--yes']);

  assert.match(second, /nothing labelled illustrative/);
  const after = openStore(file, false);
  assert.deepEqual(after.outreach.businesses('hyline').map(b => b.name), ['Karve Pilates']);
  after.close(); rmSync(dir, { recursive: true, force: true });
});

test('a clinic that does not exist changes nothing', () => {
  const { dir, file, store } = world();
  store.close();
  assert.throws(() => run(file, ['--clinic', 'not-a-clinic', '--yes']));
  const after = openStore(file, false);
  assert.equal(after.outreach.businesses('hyline').length, 2);
  after.close(); rmSync(dir, { recursive: true, force: true });
});
