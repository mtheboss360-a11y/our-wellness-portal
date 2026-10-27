// THE ROUTE RUNNER'S ACCOUNT. Two questions are worth testing hardest here, because getting
// either wrong is a breach rather than a bug:
//
//   1. a runner reaches their own routes and nothing else — enforced on the server, not by
//      hiding navigation;
//   2. a runner may change the ORDER of a day and the pickups in it, and may not change what
//      the office promised: the businesses, the dates, or the allocation.
//
// After that: that two phones cannot overwrite each other, that a retried save cannot become
// two visits or count its materials twice, and that a pickup never becomes a business.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { openStore } from '../server/store.ts';
import type { Script } from '../server/outreach.ts';
import { createPortalServer, runnerMayCall } from '../server/http.ts';

const script = (): Script => ({
  opening: 'o', introduction: 'i', value: 'v', ask: 'a',
  objections: { busy: 'b', notInterested: 'n', alreadyPartnered: 'p' }, closing: 'c', followUp: 'f',
});
const at = (name: string, lat: number | null = null, lng: number | null = null) => ({
  name, category: 'Studio', address: `${name} Street, Naperville, IL`, script: script(), lat, lng,
});

const PICKUP = {
  kind: 'treats' as const, title: 'Bakery pickup', address: '120 Main Street, Naperville, IL 60540',
  windowStart: '09:30', windowEnd: '10:15', minutes: 10, items: '4 dozen cookies',
  reference: 'Order 4821', note: 'Ask at the counter', supplies: { flyers: 0, treats: 48, cards: 0 },
};

function world() {
  const store = openStore(':memory:', false);
  store.createClient('hyline', 'Hyline Dental', 'hylinedental', 'office-pw', 'b', false, {});
  store.createClient('hyline', 'Hyline Dental', 'alexis', 'runner-pw', 'b', false,
    { displayName: 'Alexis', role: 'route_runner' });
  store.createClient('hyline', 'Hyline Dental', 'jordan', 'runner-pw', 'b', false,
    { displayName: 'Jordan', role: 'route_runner' });
  store.createClient('other', 'Another Practice', 'other', 'pw', 'b');
  store.outreach.release('hyline', 'r1', 'Release 1', 'team', [
    at('Karve Pilates', 41.70, -88.16), at('Yoga Cave', 41.73, -88.19),
    at('Salon Fluxx', 41.76, -88.21), at('Upscale Male'),
  ], false);
  store.outreach.release('other', 'o1', 'Theirs', 'team', [at('Their Salon')], false);
  return store;
}

type Store = ReturnType<typeof openStore>;
const userId = (store: Store, username: string) =>
  (store.db.prepare('SELECT id FROM users WHERE email=?').get(username) as { id: string }).id;
const ids = (store: Store, clinic: string) =>
  Object.fromEntries(store.outreach.businesses(clinic).map(b => [b.name, b.id]));
const who = (store: Store, username: string, displayName: string) => ({ id: userId(store, username), displayName });

function booked(store: Store, names: string[], staff = 'Alexis', date = '2026-10-27',
  assignTo: string | null = 'alexis') {
  const id = ids(store, 'hyline');
  const round = store.outreach.planRound('hyline', {
    date, start: '09:00', staff, businessIds: names.map(n => id[n]),
  });
  if (assignTo) store.runner.assignRound('hyline', round.id, userId(store, assignTo));
  return round.id;
}

/** Record a visit the way the planner does: on a named round, by a named login. */
function recorded(store: Store, roundId: string, business: string, by: string, on: string,
  dropped?: { flyers: number; treats: number; cards: number }) {
  return store.outreach.recordVisit('hyline', {
    businessId: ids(store, 'hyline')[business], staff: by, visitedOn: on, spokeWith: '',
    contactRole: '', outcome: 'interested', materials: 0, note: '', nextAction: '',
    followUpOn: null, roundId, recordedBy: userId(store, by.toLowerCase()), dropped,
  });
}

test('a runner is allowed their own endpoints and refused everything else', () => {
  for (const [path, method] of [['/api/runner/routes', 'GET'], ['/api/runner/order', 'POST'],
    ['/api/portal', 'GET'], ['/api/logout', 'POST']] as const) {
    assert.equal(runnerMayCall(path, method), true, `${method} ${path}`);
  }
  for (const [path, method] of [['/api/outreach/businesses', 'GET'], ['/api/outreach/visit', 'PATCH'],
    ['/api/network/map', 'GET'], ['/api/network/route-request', 'POST'], ['/api/field', 'GET'],
    ['/api/field/notes', 'POST'], ['/api/outreach/script', 'POST'], ['/api/runner/routes', 'POST'],
    ['/api/network/bakeries', 'GET'], ['/api/runner/unknown', 'GET']] as const) {
    assert.equal(runnerMayCall(path, method), false, `${method} ${path}`);
  }
});

test('the server refuses a runner session on the office’s endpoints, and serves its own', async () => {
  const store = world();
  const roundId = booked(store, ['Karve Pilates', 'Yoga Cave']);
  store.runner.assignRound('hyline', roundId, userId(store, 'alexis'));
  const server = createPortalServer({ store, origin: 'http://portal.test', secure: false, root: process.cwd() });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const signIn = store.signIn('alexis', 'runner-pw', '127.0.0.1');
    assert.equal(signIn.ok, true);
    const cookie = `owo-local-session=${signIn.token}`;
    for (const path of ['/api/outreach/businesses', '/api/outreach/rounds', '/api/field',
      '/api/network/map', '/api/network/bakeries', '/api/outreach/visits']) {
      const refused = await fetch(base + path, { headers: { Cookie: cookie } });
      assert.equal(refused.status, 403, path);
    }
    const mine = await fetch(base + '/api/runner/routes', { headers: { Cookie: cookie } });
    assert.equal(mine.status, 200);
    const payload = await mine.json() as { routes: Array<{ id: string; items: unknown[] }>; visits: unknown[] };
    assert.equal(payload.routes.length, 1);
    assert.equal(payload.routes[0].id, roundId);
    assert.equal(payload.routes[0].items.length, 2);

    // The practice's own login keeps every screen it had.
    const office = store.signIn('hylinedental', 'office-pw', '127.0.0.1');
    const officeCookie = `owo-local-session=${office.token}`;
    assert.equal((await fetch(base + '/api/outreach/businesses', { headers: { Cookie: officeCookie } })).status, 200);
    assert.equal((await fetch(base + '/api/outreach/rounds', { headers: { Cookie: officeCookie } })).status, 200);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    store.close();
  }
});

test('the planner’s endpoints belong to runners, not to owners', async () => {
  const store = world();
  const round = booked(store, ['Karve Pilates'], 'Alexis');
  store.db.prepare("UPDATE users SET role='owner' WHERE email='hylinedental'").run();
  const server = createPortalServer({ store, origin: 'http://portal.test', secure: false, root: process.cwd() });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const owner = store.signIn('hylinedental', 'office-pw', '127.0.0.1');
    const cookie = `owo-local-session=${owner.token}`;
    for (const path of ['/api/runner/routes', '/api/runner/history']) {
      assert.equal((await fetch(base + path, { headers: { Cookie: cookie } })).status, 403, path);
    }
    // And an owner cannot reorder somebody's day by posting at it.
    const push = await fetch(base + '/api/runner/order', {
      method: 'POST', headers: { Cookie: cookie, Origin: 'http://portal.test', 'Content-Type': 'application/json' },
      body: JSON.stringify({ roundId: round, order: [], revision: 0 }),
    });
    assert.equal(push.status, 403);
    // The runner still reaches their own.
    const runner = store.signIn('alexis', 'runner-pw', '127.0.0.1');
    assert.equal((await fetch(base + '/api/runner/routes',
      { headers: { Cookie: `owo-local-session=${runner.token}` } })).status, 200);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    store.close();
  }
});

test('a runner sees the rounds assigned to them and nobody else’s', () => {
  const store = world();
  const mine = booked(store, ['Karve Pilates', 'Yoga Cave'], 'Alexis', '2026-10-27');
  const theirs = booked(store, ['Salon Fluxx'], 'Jordan', '2026-10-28');
  store.runner.assignRound('hyline', mine, userId(store, 'alexis'));
  store.runner.assignRound('hyline', theirs, userId(store, 'jordan'));

  const alexis = store.runner.assignedRounds('hyline', who(store, 'alexis', 'Alexis'));
  assert.deepEqual(alexis.map(r => r.id), [mine]);
  assert.equal(store.runner.mayRun('hyline', theirs, who(store, 'alexis', 'Alexis')), false);
  assert.throws(() => store.runner.reorder('hyline', theirs, [], who(store, 'alexis', 'Alexis')), /not assigned to you/);
  store.close();
});

test('a round booked under a matching name is nobody’s until it is claimed', () => {
  const store = world();
  // Two people called Alexis at the same practice. A name is not an identity, so neither of
  // them is handed a round booked under "Alexis" by the name alone.
  store.createClient('hyline', 'Hyline Dental', 'alexis2', 'runner-pw', 'b', false,
    { displayName: 'Alexis', role: 'route_runner' });
  const round = booked(store, ['Karve Pilates'], 'Alexis', '2026-10-27', null);
  for (const login of ['alexis', 'alexis2']) {
    assert.deepEqual(store.runner.assignedRounds('hyline', who(store, login, 'Alexis')), [],
      `${login} was handed a round by name`);
  }

  // It is offered to whoever is looking, and only assigning it hands it over.
  assert.deepEqual(store.runner.claimableRounds('hyline', 'Alexis').map(r => r.id), [round]);
  store.runner.assignRound('hyline', round, userId(store, 'alexis'));
  assert.deepEqual(store.runner.assignedRounds('hyline', who(store, 'alexis', 'Alexis')).map(r => r.id), [round]);
  assert.deepEqual(store.runner.assignedRounds('hyline', who(store, 'alexis2', 'Alexis')), [],
    'the other Alexis still has nothing');
  assert.deepEqual(store.runner.claimableRounds('hyline', 'Alexis'), [], 'and it is no longer claimable');
  store.close();
});

test('a visit belongs to the round it was recorded on, not to every round with that business', () => {
  const store = world();
  const tuesday = booked(store, ['Karve Pilates', 'Yoga Cave'], 'Alexis', '2026-10-27');
  const friday = booked(store, ['Karve Pilates'], 'Alexis', '2026-10-30');
  const visit = recorded(store, friday, 'Karve Pilates', 'Alexis', '2026-10-30',
    { flyers: 5, treats: 0, cards: 0 });

  assert.equal(visit.visit.roundId, friday);
  assert.equal(visit.visit.materials, 5, 'the total is the sum of the breakdown');
  assert.deepEqual(visit.visit.dropped, { flyers: 5, treats: 0, cards: 0 });
  // The materials went to Friday's round and to no other.
  assert.deepEqual(store.runner.droppedOnRound('hyline', friday), { flyers: 5, treats: 0, cards: 0 });
  assert.deepEqual(store.runner.droppedOnRound('hyline', tuesday), { flyers: 0, treats: 0, cards: 0 });
  store.close();
});

test('another practice’s round is not reachable by id', () => {
  const store = world();
  const theirs = store.outreach.planRound('other', {
    date: '2026-10-27', start: '09:00', staff: 'Alexis',
    businessIds: [ids(store, 'other')['Their Salon']],
  });
  assert.equal(store.runner.round('hyline', theirs.id), null);
  assert.throws(() => store.runner.addPickup('hyline', theirs.id, PICKUP, who(store, 'alexis', 'Alexis')),
    /not assigned to you/);
  store.close();
});

test('a runner reorders their own stops, and the order persists', () => {
  const store = world();
  const round = booked(store, ['Karve Pilates', 'Yoga Cave', 'Salon Fluxx']);
  const me = who(store, 'alexis', 'Alexis');
  const before = store.runner.round('hyline', round)!;
  const order = [before.items[2], before.items[0], before.items[1]].map(i => ({ kind: i.kind, id: i.id }));
  const after = store.runner.reorder('hyline', round, order, me, { revision: before.revision });
  assert.deepEqual(after.items.map(i => i.kind === 'business' ? i.business.name : i.pickup.title),
    ['Salon Fluxx', 'Karve Pilates', 'Yoga Cave']);
  assert.deepEqual(store.runner.round('hyline', round)!.items.map(i => i.id), after.items.map(i => i.id));
  assert.ok(after.revision > before.revision, 'the revision moved');
  store.close();
});

test('a reorder cannot add, drop or duplicate a stop', () => {
  const store = world();
  const round = booked(store, ['Karve Pilates', 'Yoga Cave']);
  const me = who(store, 'alexis', 'Alexis');
  const items = store.runner.round('hyline', round)!.items.map(i => ({ kind: i.kind, id: i.id }));
  const stranger = { kind: 'business' as const, id: ids(store, 'hyline')['Salon Fluxx'] };
  for (const bad of [[...items, stranger], [items[0]], [items[0], items[0]]]) {
    assert.throws(() => store.runner.reorder('hyline', round, bad, me), /exactly the stops/);
  }
  store.close();
});

test('two phones cannot overwrite each other: the later revision is refused', () => {
  const store = world();
  const round = booked(store, ['Karve Pilates', 'Yoga Cave']);
  const me = who(store, 'alexis', 'Alexis');
  const stale = store.runner.round('hyline', round)!;
  const order = [stale.items[1], stale.items[0]].map(i => ({ kind: i.kind, id: i.id }));
  store.runner.reorder('hyline', round, order, me, { revision: stale.revision });
  assert.throws(() => store.runner.reorder('hyline', round, order, me, { revision: stale.revision }),
    /changed somewhere else/);
  store.close();
});

test('a stop the office locked keeps its place', () => {
  const store = world();
  const round = booked(store, ['Karve Pilates', 'Yoga Cave', 'Salon Fluxx']);
  const me = who(store, 'alexis', 'Alexis');
  const first = store.runner.round('hyline', round)!.items[0];
  store.runner.lockStop('hyline', round, first.id, true);
  const items = store.runner.round('hyline', round)!.items.map(i => ({ kind: i.kind, id: i.id }));
  assert.throws(() => store.runner.reorder('hyline', round, [items[1], items[0], items[2]], me),
    /fixed in place/);
  // Everything around it still moves.
  const moved = store.runner.reorder('hyline', round, [items[0], items[2], items[1]], me);
  assert.equal(moved.items[0].id, first.id);
  store.close();
});

test('a visit already recorded cannot be reordered out of the sequence it happened in', () => {
  const store = world();
  const round = booked(store, ['Karve Pilates', 'Yoga Cave', 'Salon Fluxx']);
  const me = who(store, 'alexis', 'Alexis');
  const id = ids(store, 'hyline');
  store.outreach.recordVisit('hyline', {
    businessId: id['Karve Pilates'], staff: 'Alexis', visitedOn: '2026-10-27', spokeWith: 'Owner',
    contactRole: 'Owner', outcome: 'interested', materials: 0, note: '', nextAction: '', followUpOn: null,
  });
  store.outreach.recordVisit('hyline', {
    businessId: id['Yoga Cave'], staff: 'Alexis', visitedOn: '2026-10-27', spokeWith: '',
    contactRole: '', outcome: 'materials', materials: 0, note: '', nextAction: '', followUpOn: null,
  });
  const completed = new Set([id['Karve Pilates'], id['Yoga Cave']]);
  const items = store.runner.round('hyline', round)!.items.map(i => ({ kind: i.kind, id: i.id }));
  assert.throws(() => store.runner.reorder('hyline', round, [items[1], items[0], items[2]], me, { completed }),
    /already finished/);
  // Nor can an unvisited stop be put in front of ones already driven: the two finished stops
  // hold positions one and two, and the only stop still to do is the one that can move.
  assert.throws(() => store.runner.reorder('hyline', round, [items[2], items[0], items[1]], me, { completed }),
    /already finished/);
  // Where nothing on the round is finished, the same move is fine.
  const fresh = booked(store, ['Karve Pilates', 'Yoga Cave', 'Salon Fluxx'], 'Alexis', '2026-11-03');
  const open = store.runner.round('hyline', fresh)!.items.map(i => ({ kind: i.kind, id: i.id }));
  const moved = store.runner.reorder('hyline', fresh, [open[2], open[0], open[1]], me);
  assert.equal(moved.items[0].id, open[2].id);
  store.close();
});

test('a business visited on an earlier round can still be moved on a later one', async () => {
  // The reorder guard treated ANY visit to a business as a finished stop, on every round. A
  // follow-up round holding the same business was frozen before it had been visited at all.
  const store = world();
  const tuesday = booked(store, ['Karve Pilates', 'Yoga Cave'], 'Alexis', '2026-10-27');
  const friday = booked(store, ['Karve Pilates', 'Salon Fluxx'], 'Alexis', '2026-10-30');
  store.runner.assignRound('hyline', tuesday, userId(store, 'alexis'));
  store.runner.assignRound('hyline', friday, userId(store, 'alexis'));
  recorded(store, tuesday, 'Karve Pilates', 'Alexis', '2026-10-27');

  const server = createPortalServer({ store, origin: 'http://portal.test', secure: false, root: process.cwd() });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const signIn = store.signIn('alexis', 'runner-pw', '127.0.0.1');
  const headers = { Cookie: `owo-local-session=${signIn.token}`, Origin: 'http://portal.test', 'Content-Type': 'application/json' };
  try {
    const round = store.runner.round('hyline', friday)!;
    const order = [round.items[1], round.items[0]].map(item => ({ kind: item.kind, id: item.id }));
    const response = await fetch(base + '/api/runner/order', { method: 'POST', headers,
      body: JSON.stringify({ roundId: friday, order, revision: round.revision }) });
    assert.equal(response.status, 200, 'Friday has not been visited, so its stops still move');
    assert.deepEqual(store.runner.round('hyline', friday)!.items.map(i =>
      i.kind === 'business' ? i.business.name : ''), ['Salon Fluxx', 'Karve Pilates']);

    // Tuesday's own finished stop is still held in place.
    const tue = store.runner.round('hyline', tuesday)!;
    const swap = [tue.items[1], tue.items[0]].map(item => ({ kind: item.kind, id: item.id }));
    const refused = await fetch(base + '/api/runner/order', { method: 'POST', headers,
      body: JSON.stringify({ roundId: tuesday, order: swap, revision: tue.revision }) });
    assert.equal(refused.status, 403);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    store.close();
  }
});

test('a pickup goes onto a route, moves within it, and never becomes a business', () => {
  const store = world();
  const round = booked(store, ['Karve Pilates', 'Yoga Cave']);
  const me = who(store, 'alexis', 'Alexis');
  const withPickup = store.runner.addPickup('hyline', round, PICKUP, me);
  assert.equal(withPickup.items.length, 3);
  assert.equal(withPickup.items[2].kind, 'pickup');

  // The directory and the referral records are untouched: a pickup is not a referral business.
  assert.deepEqual(store.outreach.businesses('hyline').map(b => b.name).sort(),
    ['Karve Pilates', 'Salon Fluxx', 'Upscale Male', 'Yoga Cave']);
  assert.equal(store.outreach.rounds('hyline').find(r => r.id === round)!.stops.length, 2);

  const refs = withPickup.items.map(i => ({ kind: i.kind, id: i.id }));
  const moved = store.runner.reorder('hyline', round, [refs[0], refs[2], refs[1]], me, { revision: withPickup.revision });
  assert.deepEqual(moved.items.map(i => i.kind), ['business', 'pickup', 'business']);
  store.close();
});

test('a pickup can be edited and removed; a collected one stays on the record', () => {
  const store = world();
  const round = booked(store, ['Karve Pilates']);
  const me = who(store, 'alexis', 'Alexis');
  const added = store.runner.addPickup('hyline', round, PICKUP, me);
  const pickupId = added.items.find(i => i.kind === 'pickup')!.id;

  const edited = store.runner.updatePickup('hyline', round, pickupId,
    { ...PICKUP, title: 'Bakery on Main', minutes: 15 }, me, { revision: added.revision });
  const pickup = edited.items.find(i => i.kind === 'pickup');
  assert.equal(pickup?.kind === 'pickup' && pickup.pickup.title, 'Bakery on Main');
  assert.equal(pickup?.kind === 'pickup' && pickup.pickup.minutes, 15);

  const collected = store.runner.collectPickup('hyline', round, pickupId, me);
  const after = collected.items.find(i => i.kind === 'pickup');
  assert.equal(after?.kind === 'pickup' && after.pickup.status, 'collected');
  assert.throws(() => store.runner.updatePickup('hyline', round, pickupId, PICKUP, me), /collected/);
  assert.throws(() => store.runner.removePickup('hyline', round, pickupId, me), /collected/);
  // What it was carrying is now in the car.
  assert.equal(store.runner.collectedSupplies('hyline', round).treats, 48);
  store.close();
});

test('a pickup counts what was actually collected, not what was planned', () => {
  const store = world();
  const round = booked(store, ['Karve Pilates']);
  const me = who(store, 'alexis', 'Alexis');
  const added = store.runner.addPickup('hyline', round, PICKUP, me);
  const pickupId = added.items.find(i => i.kind === 'pickup')!.id;

  // Nothing is in the car until it has been collected, however much was planned.
  assert.deepEqual(store.runner.collectedSupplies('hyline', round), { flyers: 0, treats: 0, cards: 0 });

  // The bakery had three dozen, not four.
  const done = store.runner.collectPickup('hyline', round, pickupId, me,
    { collected: { flyers: 0, treats: 36, cards: 0 } });
  assert.deepEqual(store.runner.collectedSupplies('hyline', round), { flyers: 0, treats: 36, cards: 0 });
  const pickup = done.items.find(i => i.kind === 'pickup');
  assert.equal(pickup?.kind === 'pickup' && pickup.pickup.supplies.treats, 48, 'what was planned is kept');
  assert.equal(pickup?.kind === 'pickup' && pickup.pickup.collected?.treats, 36, 'beside what was collected');
  store.close();
});

test('a pickup is checked before it is written', () => {
  const store = world();
  const round = booked(store, ['Karve Pilates']);
  const me = who(store, 'alexis', 'Alexis');
  for (const [patch, pattern] of [
    [{ title: '' }, /location name/],
    [{ address: 'Main St' }, /street address/],
    [{ windowStart: '10:30', windowEnd: '09:30' }, /open before it closes/],
    [{ minutes: 0 }, /1 and 120/],
  ] as const) {
    assert.throws(() => store.runner.addPickup('hyline', round, { ...PICKUP, ...patch }, me), pattern);
  }
  assert.equal(store.runner.round('hyline', round)!.items.length, 1, 'nothing was written');
  store.close();
});

test('planned, packed and dropped are three different numbers', () => {
  const store = world();
  const round = booked(store, ['Karve Pilates']);
  const me = who(store, 'alexis', 'Alexis');
  store.runner.setPlannedSupplies('hyline', round, { flyers: 100, treats: 50, cards: 25 });
  const planned = store.runner.round('hyline', round)!;
  assert.deepEqual(planned.supplies.planned, { flyers: 100, treats: 50, cards: 25 });
  assert.equal(planned.supplies.packed, null, 'nothing is packed until the runner says so');

  // A short load is a fact, not an error.
  const packed = store.runner.confirmPacked('hyline', round, { flyers: 80, treats: 50, cards: 25 }, me,
    { revision: planned.revision });
  assert.deepEqual(packed.supplies.packed, { flyers: 80, treats: 50, cards: 25 });
  assert.deepEqual(packed.supplies.planned, { flyers: 100, treats: 50, cards: 25 }, 'the allocation did not move');
  assert.equal(packed.supplies.packedBy, 'Alexis');
  store.close();
});

test('what is left in the car is the confirmed load, plus pickups, less what was dropped', () => {
  const store = world();
  const round = booked(store, ['Karve Pilates', 'Yoga Cave']);
  const me = who(store, 'alexis', 'Alexis');
  store.runner.setPlannedSupplies('hyline', round, { flyers: 40, treats: 0, cards: 10 });
  store.runner.confirmPacked('hyline', round, { flyers: 40, treats: 0, cards: 10 }, me);
  const added = store.runner.addPickup('hyline', round, PICKUP, me);
  store.runner.collectPickup('hyline', round, added.items.find(i => i.kind === 'pickup')!.id, me);

  recorded(store, round, 'Karve Pilates', 'Alexis', '2026-10-27', { flyers: 10, treats: 4, cards: 0 });

  const packed = store.runner.round('hyline', round)!.supplies.packed;
  assert.deepEqual(store.runner.droppedOnRound('hyline', round), { flyers: 10, treats: 4, cards: 0 });
  assert.deepEqual(store.runner.remaining('hyline', round, packed), { flyers: 30, treats: 44, cards: 10 });
  store.close();
});

test('confirming fewer supplies than have already been dropped is refused', () => {
  const store = world();
  const round = booked(store, ['Karve Pilates']);
  const me = who(store, 'alexis', 'Alexis');
  store.runner.confirmPacked('hyline', round, { flyers: 40, treats: 0, cards: 0 }, me);
  recorded(store, round, 'Karve Pilates', 'Alexis', '2026-10-27', { flyers: 30, treats: 0, cards: 0 });
  assert.throws(() => store.runner.confirmPacked('hyline', round, { flyers: 5, treats: 0, cards: 0 }, me,
    { dropped: store.runner.droppedOnRound('hyline', round) }), /already recorded 30 flyers/);
  store.close();
});

test('the planner records one visit, with the total it adds up to, and a retry adds nothing', async () => {
  const store = world();
  const round = booked(store, ['Karve Pilates', 'Yoga Cave']);
  store.runner.assignRound('hyline', round, userId(store, 'alexis'));
  const me = who(store, 'alexis', 'Alexis');
  store.runner.confirmPacked('hyline', round, { flyers: 40, treats: 20, cards: 10 }, me);

  const server = createPortalServer({ store, origin: 'http://portal.test', secure: false, root: process.cwd() });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const signIn = store.signIn('alexis', 'runner-pw', '127.0.0.1');
  const headers = { Cookie: `owo-local-session=${signIn.token}`, Origin: 'http://portal.test', 'Content-Type': 'application/json' };
  const draft = {
    roundId: round,
    businessId: ids(store, 'hyline')['Karve Pilates'], visitedOn: '2026-10-27', spokeWith: 'Dana',
    contactRole: 'Manager', outcome: 'interested', dropped: { flyers: 6, treats: 2, cards: 1 },
    note: 'Keen on a card holder', nextAction: 'Drop more cards', followUpOn: null,
    clientRef: 'abcd1234efgh',
  };
  try {
    const first = await fetch(base + '/api/runner/visit', { method: 'POST', headers, body: JSON.stringify(draft) });
    assert.equal(first.status, 200);
    const saved = await first.json() as { visit: { id: string; materials: number }; dropped: unknown };
    assert.equal(saved.visit.materials, 9, 'the total is the sum of the three counts');
    assert.deepEqual(saved.dropped, { flyers: 6, treats: 2, cards: 1 });

    const again = await fetch(base + '/api/runner/visit', { method: 'POST', headers, body: JSON.stringify(draft) });
    assert.equal(again.status, 200);
    assert.equal(store.outreach.visits('hyline').length, 1, 'a second tap did not write a second visit');
    assert.deepEqual(store.runner.droppedOnRound('hyline', round), { flyers: 6, treats: 2, cards: 1 });

    // Dropping more than is in the car is refused, and the business is still only visited once.
    const greedy = await fetch(base + '/api/runner/visit', { method: 'POST', headers, body: JSON.stringify({
      ...draft, businessId: ids(store, 'hyline')['Yoga Cave'], clientRef: 'zzzz1111yyyy',
      dropped: { flyers: 400, treats: 0, cards: 0 } }) });
    assert.equal(greedy.status, 400);
    assert.match((await greedy.json() as { error: string }).error, /34 flyers left/);
    assert.equal(store.outreach.visits('hyline').length, 1);

    // A business that is not on the named route is refused outright, even though it is on this
    // practice's list and even though the route is the runner's own.
    const elsewhere = await fetch(base + '/api/runner/visit', { method: 'POST', headers, body: JSON.stringify({
      ...draft, businessId: ids(store, 'hyline')['Upscale Male'], clientRef: 'qqqq2222wwww',
      dropped: { flyers: 0, treats: 0, cards: 0 } }) });
    assert.equal(elsewhere.status, 403);

    // A round belonging to somebody else is refused whatever business is named.
    const theirs = store.outreach.planRound('hyline', {
      date: '2026-10-29', start: '09:00', staff: 'Jordan',
      businessIds: [ids(store, 'hyline')['Karve Pilates']],
    });
    store.runner.assignRound('hyline', theirs.id, userId(store, 'jordan'));
    const borrowed = await fetch(base + '/api/runner/visit', { method: 'POST', headers, body: JSON.stringify({
      ...draft, roundId: theirs.id, clientRef: 'mmmm3333nnnn',
      dropped: { flyers: 0, treats: 0, cards: 0 } }) });
    assert.equal(borrowed.status, 403);

    // And the history is what this login recorded, not what happened at businesses it visits.
    store.outreach.recordVisit('hyline', {
      businessId: ids(store, 'hyline')['Yoga Cave'], staff: 'Somebody else', visitedOn: '2026-10-27',
      spokeWith: '', contactRole: '', outcome: 'materials', materials: 0, note: '',
      nextAction: '', followUpOn: null, roundId: round, recordedBy: userId(store, 'jordan'),
    });
    const history = await (await fetch(base + '/api/runner/history', { headers })).json() as { visits: Array<{ businessName: string }> };
    assert.deepEqual(history.visits.map(v => v.businessName), ['Karve Pilates'],
      'only the visits this login recorded');
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    store.close();
  }
});

test('a reorder sent against an old revision comes back with the current route, not a merge', async () => {
  const store = world();
  const round = booked(store, ['Karve Pilates', 'Yoga Cave']);
  store.runner.assignRound('hyline', round, userId(store, 'alexis'));
  const me = who(store, 'alexis', 'Alexis');
  const server = createPortalServer({ store, origin: 'http://portal.test', secure: false, root: process.cwd() });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const signIn = store.signIn('alexis', 'runner-pw', '127.0.0.1');
  const headers = { Cookie: `owo-local-session=${signIn.token}`, Origin: 'http://portal.test', 'Content-Type': 'application/json' };
  try {
    const stale = store.runner.round('hyline', round)!;
    const order = [stale.items[1], stale.items[0]].map(i => ({ kind: i.kind, id: i.id }));
    store.runner.reorder('hyline', round, order, me, { revision: stale.revision });
    const late = await fetch(base + '/api/runner/order', { method: 'POST', headers,
      body: JSON.stringify({ roundId: round, order, revision: stale.revision }) });
    assert.equal(late.status, 409);
    const conflict = await late.json() as { route: { revision: number } | null };
    assert.equal(conflict.route?.revision, store.runner.round('hyline', round)!.revision);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    store.close();
  }
});
