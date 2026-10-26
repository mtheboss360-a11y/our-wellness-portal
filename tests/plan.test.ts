// WHICH SERVICE A PRACTICE BUYS. 'a' is the full service, where our drivers run the rounds;
// 'b' is the portal on its own, where the practice's own staff visit. It is a column on the
// clinic, so the browser cannot ask for a plan it does not pay for, and an account created
// before the column existed keeps everything it had.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { openStore } from '../server/store';

const sign = (store: ReturnType<typeof openStore>, username: string, password: string) => {
  const result = store.signIn(username, password, 'test');
  assert.equal(result.ok, true, result.message);
  return result.token!;
};

test('a clinic is on the full service unless it is created as portal-only', () => {
  const store = openStore(':memory:');
  try {
    store.createClient('full', 'Full Service', 'full-user', 'pw');
    assert.equal(store.snapshot(sign(store, 'full-user', 'pw')).clinic?.plan, 'a');
  } finally { store.close(); }
});

test('a portal-only clinic reports plan b', () => {
  const store = openStore(':memory:');
  try {
    store.createClient('hyline', 'Hyline Dental', 'hyline-user', 'pw', 'b');
    assert.equal(store.snapshot(sign(store, 'hyline-user', 'pw')).clinic?.plan, 'b');
  } finally { store.close(); }
});

test('two practices on one server never see each other’s plan', () => {
  const store = openStore(':memory:');
  try {
    store.createClient('full', 'Full Service', 'full-user', 'pw');
    store.createClient('hyline', 'Hyline Dental', 'hyline-user', 'pw', 'b');
    assert.equal(store.snapshot(sign(store, 'full-user', 'pw')).clinic?.plan, 'a');
    assert.equal(store.snapshot(sign(store, 'hyline-user', 'pw')).clinic?.plan, 'b');
  } finally { store.close(); }
});

test('a second account on a clinic does not change what that clinic buys', () => {
  const store = openStore(':memory:');
  try {
    store.createClient('hyline', 'Hyline Dental', 'first', 'pw', 'b');
    store.createClient('hyline', 'Hyline Dental', 'second', 'pw', 'a');
    assert.equal(store.snapshot(sign(store, 'second', 'pw')).clinic?.plan, 'b', 'the clinic keeps the plan it was created with');
  } finally { store.close(); }
});

test('a database written before the plan column keeps its clinics and reads as full service', () => {
  // The shape the live database had before this change, built by hand so the migration runs
  // against a real older table rather than one this build created.
  const file = `/tmp/plan-migration-${process.pid}.sqlite`;
  rmSync(file, { force: true });
  const old = new DatabaseSync(file);
  old.prepare('CREATE TABLE clinics (id TEXT PRIMARY KEY, name TEXT NOT NULL)').run();
  old.prepare('CREATE TABLE users (id TEXT PRIMARY KEY, clinic_id TEXT NOT NULL REFERENCES clinics(id), email TEXT NOT NULL UNIQUE, hash TEXT NOT NULL, salt TEXT NOT NULL)').run();
  old.prepare('INSERT INTO clinics (id,name) VALUES (?,?)').run('legacy', 'Legacy Clinic');
  old.close();

  const store = openStore(file);
  try {
    const row = store.db.prepare('SELECT name,plan FROM clinics WHERE id=?').get('legacy') as { name: string; plan: string };
    assert.equal(row.name, 'Legacy Clinic', 'the existing row survives');
    assert.equal(row.plan, 'a', 'and reads as the full service it was');
  } finally {
    store.close();
    rmSync(file, { force: true });
  }
});

test('a demo account is flagged on the clinic, and a real one is not', () => {
  const store = openStore(':memory:');
  try {
    store.createClient('demo-co', 'Demo Practice', 'demo-user', 'pw', 'b', true);
    store.createClient('real-co', 'Real Practice', 'real-user', 'pw', 'b');
    assert.equal(store.snapshot(sign(store, 'demo-user', 'pw')).clinic?.demo, true);
    assert.equal(store.snapshot(sign(store, 'real-user', 'pw')).clinic?.demo, false);
    assert.equal(store.isDemoClinic('demo-co'), true);
    assert.equal(store.isDemoClinic('real-co'), false);
  } finally { store.close(); }
});

test('clinics that existed before the demo column read as real, not illustrative', () => {
  const file = `/tmp/demo-migration-${process.pid}.sqlite`;
  rmSync(file, { force: true });
  const old = new DatabaseSync(file);
  old.prepare('CREATE TABLE clinics (id TEXT PRIMARY KEY, name TEXT NOT NULL)').run();
  old.prepare('CREATE TABLE users (id TEXT PRIMARY KEY, clinic_id TEXT NOT NULL REFERENCES clinics(id), email TEXT NOT NULL UNIQUE, hash TEXT NOT NULL, salt TEXT NOT NULL)').run();
  old.prepare('INSERT INTO clinics (id,name) VALUES (?,?)').run('legacy', 'Legacy Clinic');
  old.close();
  const store = openStore(file);
  try {
    assert.equal(store.isDemoClinic('legacy'), false, 'a paying client must never be marked illustrative by a migration');
  } finally { store.close(); rmSync(file, { force: true }); }
});

test('a staff login is a person at a practice, not another practice', () => {
  const store = openStore(':memory:');
  try {
    store.createClient('hyline', 'Hyline Dental', 'hyline', 'pw', 'b', true);
    store.createClient('hyline', 'Hyline Dental', 'alexis', 'pw', 'a', false, { displayName: 'Alexis', staffId: 'd1' });

    const asStaff = store.snapshot(sign(store, 'alexis', 'pw'));
    assert.equal(asStaff.clinic?.id, 'hyline', 'same practice');
    assert.equal(asStaff.user?.name, 'Alexis');
    assert.equal(asStaff.user?.staffId, 'd1');

    // the clinic keeps what it was created with: a second account cannot change the plan,
    // and must not turn a demo practice into a real one or the other way round
    assert.equal(asStaff.clinic?.plan, 'b');
    assert.equal(asStaff.clinic?.demo, true);

    const asPractice = store.snapshot(sign(store, 'hyline', 'pw'));
    assert.equal(asPractice.user?.name, null, 'the practice account is nobody in particular');
  } finally { store.close(); }
});

test('an account made before names existed reads as the practice', () => {
  const store = openStore(':memory:');
  try {
    store.createClient('old', 'Old Practice', 'old-user', 'pw');
    const snap = store.snapshot(sign(store, 'old-user', 'pw'));
    assert.equal(snap.user?.name, null);
    assert.equal(snap.user?.staffId, null);
    assert.equal(snap.clinic?.name, 'Old Practice');
  } finally { store.close(); }
});
