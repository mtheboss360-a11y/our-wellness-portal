// ROUTE NOTES. What a practice's own staff wrote about a business they visited, and whether
// they want it on the next round. The things worth pinning down: a note belongs to one clinic
// and is unreachable from another's session, a business that is not on this clinic's field log
// cannot be written against, and ticking a business records an intention and nothing more.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openStore } from '../server/store';
import type { FieldLog, FieldStop } from '../data/field-data';

const stop = (over: Partial<FieldStop> & { id: string; businessId: string }): FieldStop => ({
  name: 'Ridgeline Strength', category: 'gym', town: 'Naperville', lat: 41.77, lng: -88.15,
  arrived: '09:00', left: '09:20', spokeWith: 'Sam', staffOnShift: 3,
  boxes: 1, coffees: 6, cards: 6, display: false, outcome: 'follow-up', note: '', photo: null,
  crossRef: { theirClients: '', yourServices: [], score: 0 }, ...over,
});

const log = (businessIds: string[]): FieldLog => ({
  clinic: { label: '100 Main St', lat: 41.77, lng: -88.15 },
  drivers: [{ id: 'd1', name: 'Alexis', photo: '', homeBase: 'Naperville', since: '2026-01', vehicle: '', languages: [], bio: '' }],
  routes: [{ id: 'r1', date: '2026-10-07', start: '09:00', driverId: 'd1', status: 'done',
    stops: businessIds.map((businessId, n) => stop({ id: `s${n}`, businessId })) }],
  signups: [],
});

const withClinic = (store: ReturnType<typeof openStore>, id: string, businessIds: string[]) => {
  store.createClient(id, `${id} Practice`, `${id}-user`, 'pw', 'b');
  store.saveFieldLog(id, log(businessIds));
};

test('a note is saved against a business the clinic actually visited', () => {
  const store = openStore(':memory:');
  try {
    withClinic(store, 'alpha', ['ridgeline']);
    const notes = store.saveVisitNote('alpha', 'ridgeline', 'Ask for Sam, back in two weeks.', false);
    assert.deepEqual(notes, [{ businessId: 'ridgeline', note: 'Ask for Sam, back in two weeks.', nextRound: false }]);
  } finally { store.close(); }
});

test('a business that is not on this clinic’s log cannot be written against', () => {
  const store = openStore(':memory:');
  try {
    withClinic(store, 'alpha', ['ridgeline']);
    assert.throws(() => store.saveVisitNote('alpha', 'somewhere-else', 'anything', true), /field log/);
    assert.deepEqual(store.visitNotes('alpha'), [], 'and nothing is written');
  } finally { store.close(); }
});

test('one practice never sees or reaches another’s notes', () => {
  const store = openStore(':memory:');
  try {
    withClinic(store, 'alpha', ['ridgeline']);
    withClinic(store, 'beta', ['harbor']);
    store.saveVisitNote('alpha', 'ridgeline', 'Alpha’s private note.', true);
    assert.deepEqual(store.visitNotes('beta'), [], 'beta sees nothing of alpha’s');
    // beta cannot write against alpha's business either, even knowing its id
    assert.throws(() => store.saveVisitNote('beta', 'ridgeline', 'peeking', true), /field log/);
    assert.equal(store.visitNotes('alpha')[0].note, 'Alpha’s private note.', 'and alpha’s is untouched');
  } finally { store.close(); }
});

test('saving the same business again replaces the note rather than adding a second', () => {
  const store = openStore(':memory:');
  try {
    withClinic(store, 'alpha', ['ridgeline']);
    store.saveVisitNote('alpha', 'ridgeline', 'First pass.', false);
    const notes = store.saveVisitNote('alpha', 'ridgeline', 'Second pass.', true);
    assert.equal(notes.length, 1);
    assert.deepEqual(notes[0], { businessId: 'ridgeline', note: 'Second pass.', nextRound: true });
  } finally { store.close(); }
});

test('ticking a business records the intention and changes nothing else', () => {
  const store = openStore(':memory:');
  try {
    withClinic(store, 'alpha', ['ridgeline', 'harbor']);
    store.saveVisitNote('alpha', 'ridgeline', '', true);
    const picked = store.visitNotes('alpha').filter(note => note.nextRound).map(note => note.businessId);
    assert.deepEqual(picked, ['ridgeline']);
    // the visit log itself is untouched: a tick is a plan, not a visit
    const after = store.fieldLog('alpha')!;
    assert.equal(after.routes.length, 1);
    assert.equal(after.routes[0].stops.length, 2);
    assert.equal(after.routes[0].status, 'done');
  } finally { store.close(); }
});

test('a very long note is cut rather than refused, so nothing a staff member typed is lost silently', () => {
  const store = openStore(':memory:');
  try {
    withClinic(store, 'alpha', ['ridgeline']);
    const notes = store.saveVisitNote('alpha', 'ridgeline', 'x'.repeat(5000), false);
    assert.equal(notes[0].note.length, 2000);
  } finally { store.close(); }
});
