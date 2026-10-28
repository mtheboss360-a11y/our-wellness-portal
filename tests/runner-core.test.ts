// Core datastore tests do not need the HTTP or React dependencies. These guard release
// safety even in a minimal Node environment; runner.test.ts covers the HTTP handlers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openStore } from '../server/store.ts';

function fixture() {
  const store = openStore(':memory:', false);
  store.createClient('hyline', 'Hyline Dental', 'office', 'password', 'b', false, {});
  store.createClient('hyline', 'Hyline Dental', 'alexis', 'password', 'b', false,
    { displayName: 'Alexis', role: 'route_runner' });
  const script = { opening: '', introduction: '', value: '', ask: '',
    objections: { busy: '', notInterested: '', alreadyPartnered: '' }, closing: '', followUp: '' };
  store.outreach.release('hyline', 'release', 'Release', 'office',
    ['A', 'B', 'C', 'D'].map(name => ({ name, address: `${name} Street, Naperville, IL`,
      category: 'Studio', script })), false);
  const ids = Object.fromEntries(store.outreach.businesses('hyline').map(b => [b.name, b.id]));
  const round = store.outreach.planRound('hyline', { date: '2026-10-27', start: '09:00',
    staff: 'Alexis', businessIds: ['A', 'B', 'C', 'D'].map(name => ids[name]) });
  const id = (store.db.prepare("SELECT id FROM users WHERE email='alexis'").get() as { id: string }).id;
  const who = { id, displayName: 'Alexis' };
  store.runner.assignRound('hyline', round.id, id);
  return { store, ids, roundId: round.id, who };
}

test('completed business stops cannot be displaced by a pending stop', () => {
  const { store, ids, roundId, who } = fixture();
  try {
    const current = store.runner.round('hyline', roundId)!;
    const refs = current.items.map(item => ({ kind: item.kind, id: item.id }));
    assert.throws(() => store.runner.reorder('hyline', roundId,
      [refs[1], refs[0], refs[2], refs[3]], who, { completed: new Set([ids.A]) }),
      /already finished/);
    assert.deepEqual(store.runner.reorder('hyline', roundId,
      [refs[0], refs[2], refs[1], refs[3]], who, { completed: new Set([ids.A]) })
      .items.map(item => item.id), [refs[0].id, refs[2].id, refs[1].id, refs[3].id]);
  } finally { store.close(); }
});

test('completed pickup retries do not double-add collected supplies', () => {
  const { store, roundId, who } = fixture();
  try {
    const draft = { kind: 'treats' as const, title: 'Bakery', address: '100 Main Street, Naperville, IL',
      windowStart: '09:30', windowEnd: '10:00', minutes: 10, items: 'Cookies',
      reference: '', note: '', supplies: { flyers: 0, treats: 48, cards: 0 } };
    const added = store.runner.addPickup('hyline', roundId, draft, who);
    const id = added.items.find(item => item.kind === 'pickup')!.id;
    const actual = { flyers: 0, treats: 36, cards: 0 };
    const saved = store.runner.collectPickup('hyline', roundId, id, who,
      { revision: added.revision, collected: actual });
    const retried = store.runner.collectPickup('hyline', roundId, id, who,
      { revision: added.revision, collected: actual });
    assert.equal(retried.revision, saved.revision);
    assert.deepEqual(store.runner.collectedSupplies('hyline', roundId), actual);
  } finally { store.close(); }
});

test('a visit submission reference cannot be reused for another round or employee', () => {
  const { store, ids, roundId, who } = fixture();
  try {
    const draft = { businessId: ids.A, staff: 'Alexis', visitedOn: '2026-10-27',
      spokeWith: '', contactRole: '', outcome: 'partner' as const, materials: 0,
      note: '', nextAction: '', followUpOn: null, clientRef: 'uniquecheck001',
      roundId, recordedBy: who.id };
    const first = store.outreach.recordVisit('hyline', draft);
    assert.equal(store.outreach.recordVisit('hyline', draft).visit.id, first.visit.id);
    assert.throws(() => store.outreach.recordVisit('hyline', { ...draft, businessId: ids.B }),
      /already been used for another visit/);
    assert.throws(() => store.outreach.recordVisit('hyline', { ...draft, recordedBy: 'not-alexis' }),
      /already been used for another visit/);
  } finally { store.close(); }
});
