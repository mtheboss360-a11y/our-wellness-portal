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
