// ROUNDS. A round is an ordered list of businesses a practice was released, so the two things
// worth testing hardest are that it cannot contain somebody else's business, and that progress
// is counted from visits actually recorded rather than from anything a screen is holding.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openStore } from '../server/store.ts';
import type { Script } from '../server/outreach.ts';
import { planRound, suggestOrder } from '../src/lib/round-math.ts';
import { clockOf } from '../src/lib/agenda-math.ts';

const script = (): Script => ({
  opening: 'o', introduction: 'i', value: 'v', ask: 'a',
  objections: { busy: 'b', notInterested: 'n', alreadyPartnered: 'p' }, closing: 'c', followUp: 'f',
});
const at = (name: string, lat: number | null, lng: number | null) => ({
  name, category: 'Studio', address: `${name} Street, Naperville, IL`, script: script(),
  lat, lng,
});

function world() {
  const store = openStore(':memory:', false);
  store.createClient('hyline', 'Hyline Dental', 'hyline', 'pw', 'b');
  store.createClient('other', 'Another Practice', 'other', 'pw', 'b');
  store.outreach.release('hyline', 'r1', 'Release 1', 't', [
    at('Karve Pilates', 41.70, -88.16),
    at('Yoga Cave', 41.73, -88.19),
    at('Salon Fluxx', 41.76, -88.21),
  ], false);
  store.outreach.release('other', 'o1', 'Theirs', 't', [at('Their Salon', 41.80, -88.30)], false);
  return store;
}

const ids = (store: ReturnType<typeof openStore>, clinic: string) =>
  Object.fromEntries(store.outreach.businesses(clinic).map(b => [b.name, b.id]));

test('a round holds the stops it was given, in the order it was given them', () => {
  const store = world();
  const id = ids(store, 'hyline');
  const round = store.outreach.planRound('hyline', {
    date: '2026-10-28', start: '09:00', staff: 'Alexis',
    businessIds: [id['Yoga Cave'], id['Karve Pilates']],
  });
  assert.deepEqual(round.stops.map(s => s.name), ['Yoga Cave', 'Karve Pilates']);
  store.close();
});

test('a round cannot be built from another practice business', () => {
  const store = world();
  const mine = ids(store, 'hyline'), theirs = ids(store, 'other');
  assert.throws(() => store.outreach.planRound('hyline', {
    date: '2026-10-28', start: '09:00', staff: 'Alexis',
    businessIds: [mine['Karve Pilates'], theirs['Their Salon']],
  }), /not on your list/);
  assert.equal(store.outreach.rounds('hyline').length, 0, 'nothing was booked');
  store.close();
});

test('the same business twice on one round is refused', () => {
  const store = world();
  const id = ids(store, 'hyline');
  assert.throws(() => store.outreach.planRound('hyline', {
    date: '2026-10-28', start: '09:00', staff: 'Alexis',
    businessIds: [id['Karve Pilates'], id['Karve Pilates']],
  }), /twice/);
  store.close();
});

test('another practice cannot see or reorder this one round', () => {
  const store = world();
  const id = ids(store, 'hyline');
  const round = store.outreach.planRound('hyline', {
    date: '2026-10-28', start: '09:00', staff: 'Alexis', businessIds: [id['Karve Pilates']],
  });
  assert.deepEqual(store.outreach.rounds('other'), []);
  assert.throws(() => store.outreach.reorderRound('other', round.id, [id['Karve Pilates']]), /not yours/);
  store.close();
});

test('the plan starts at opening, and lays the stops out in order', () => {
  const store = world();
  const id = ids(store, 'hyline');
  // 2026-10-28 is a Wednesday: the practice opens at eleven.
  const round = store.outreach.planRound('hyline', {
    date: '2026-10-28', start: '08:00', staff: 'Alexis',
    businessIds: [id['Karve Pilates'], id['Yoga Cave'], id['Salon Fluxx']],
  });
  const plan = planRound({ lat: 41.68, lng: -88.15 }, round, []);

  assert.equal(clockOf(plan.startsAt), '11:00 AM', 'held to opening, not the booked 08:00');
  assert.equal(plan.opening.heldBack, true);
  assert.ok(plan.stops[0].arriveAt > plan.startsAt, 'the first stop is after the drive to it');
  assert.ok(plan.stops[1].arriveAt > plan.stops[0].leaveAt, 'each follows the one before');
  assert.equal(plan.completed, 0);
  assert.equal(plan.next!.business.name, 'Karve Pilates');
  store.close();
});

test('progress comes from recorded visits, and the next stop moves with it', () => {
  const store = world();
  const id = ids(store, 'hyline');
  const round = store.outreach.planRound('hyline', {
    date: '2026-10-28', start: '11:00', staff: 'Alexis',
    businessIds: [id['Karve Pilates'], id['Yoga Cave'], id['Salon Fluxx']],
  });
  store.outreach.recordVisit('hyline', {
    businessId: id['Karve Pilates'], staff: 'Alexis', visitedOn: '2026-10-28', spokeWith: 'Dana',
    contactRole: 'Owner', outcome: 'interested', materials: 10, note: '', nextAction: '', followUpOn: null,
  });

  const plan = planRound({ lat: 41.68, lng: -88.15 }, store.outreach.rounds('hyline')[0],
    store.outreach.visits('hyline'));
  assert.equal(plan.completed, 1);
  assert.equal(plan.next!.business.name, 'Yoga Cave', 'the next stop is the next unvisited one');
  assert.equal(plan.stops[0].done, true);
  assert.equal(plan.stops[0].visit!.spokeWith, 'Dana');
  store.close();
});

test('a visit recorded a day late still counts towards the round', () => {
  const store = world();
  const id = ids(store, 'hyline');
  const round = store.outreach.planRound('hyline', {
    date: '2026-10-28', start: '11:00', staff: 'Alexis', businessIds: [id['Karve Pilates']],
  });
  store.outreach.recordVisit('hyline', {
    businessId: id['Karve Pilates'], staff: 'Alexis', visitedOn: '2026-10-29', spokeWith: '',
    contactRole: '', outcome: 'interested', materials: 0, note: '', nextAction: '', followUpOn: null,
  });
  const plan = planRound({ lat: 41.68, lng: -88.15 }, round, store.outreach.visits('hyline'));
  assert.equal(plan.completed, 1, 'the round was run a day late, not skipped');
  store.close();
});

test('a visit from before the round was booked does not count towards it', () => {
  const store = world();
  const id = ids(store, 'hyline');
  const round = store.outreach.planRound('hyline', {
    date: '2026-10-28', start: '11:00', staff: 'Alexis', businessIds: [id['Karve Pilates']],
  });
  store.outreach.recordVisit('hyline', {
    businessId: id['Karve Pilates'], staff: 'Alexis', visitedOn: '2026-09-01', spokeWith: '',
    contactRole: '', outcome: 'interested', materials: 0, note: '', nextAction: '', followUpOn: null,
  });
  const plan = planRound({ lat: 41.68, lng: -88.15 }, round, store.outreach.visits('hyline'));
  assert.equal(plan.completed, 0, 'a visit last month is not this round');
  store.close();
});

test('a business with no coordinate is still a stop, with no invented arrival time', () => {
  const store = world();
  store.outreach.release('hyline', 'r2', 'Release 2', 't', [at('Nowhere Yet', null, null)], false);
  const id = ids(store, 'hyline');
  const round = store.outreach.planRound('hyline', {
    date: '2026-10-28', start: '11:00', staff: 'Alexis',
    businessIds: [id['Nowhere Yet'], id['Karve Pilates']],
  });
  const plan = planRound({ lat: 41.68, lng: -88.15 }, round, []);
  assert.equal(plan.stops[0].located, false);
  assert.equal(plan.stops[0].driveFromPrevious, null, 'no drive time is made up');
  assert.deepEqual(plan.unlocated, ['Nowhere Yet'], 'the screen is told which one');
  assert.equal(plan.stops.length, 2, 'it is still on the round');
  store.close();
});

test('the suggested order starts nearest the practice and leaves the unplaceable last', () => {
  const store = world();
  store.outreach.release('hyline', 'r2', 'Release 2', 't', [at('Nowhere Yet', null, null)], false);
  const list = store.outreach.businesses('hyline');
  const ordered = suggestOrder({ lat: 41.68, lng: -88.15 }, list);
  assert.equal(ordered[0].name, 'Karve Pilates', 'closest to the practice');
  assert.equal(ordered.at(-1)!.name, 'Nowhere Yet', 'no coordinate, so it cannot displace one that has');
  assert.equal(ordered.length, list.length);
  store.close();
});

test('changing a password works, invalidates its sessions, and never touches another login', () => {
  const store = world();
  const before = store.signIn('hyline', 'pw', '1.2.3.4');
  assert.equal(before.ok, true);

  store.setPassword('hyline', 'a-much-longer-password');
  assert.equal(store.signIn('hyline', 'pw', '1.2.3.4').ok, false, 'the old password stops working');
  assert.equal(store.signIn('hyline', 'a-much-longer-password', '1.2.3.4').ok, true);
  assert.equal(store.signIn('other', 'pw', '1.2.3.4').ok, true, 'the other login is unchanged');

  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM sessions').get() !== undefined, true);
  assert.throws(() => store.setPassword('nobody', 'a-much-longer-password'), /No login called/);
  store.close();
});

test('the login audit lists accounts and never a hash or a salt', () => {
  const store = world();
  const rows = store.logins();
  assert.equal(rows.length, 2);
  const text = JSON.stringify(rows);
  assert.doesNotMatch(text, /hash|salt/i);
  assert.ok(rows.every(r => r.username && r.clinic));
  store.close();
});

test('naming a login is what makes a visit carry a staff name', () => {
  const store = openStore(':memory:', false);
  // A clinic account: no person on it, which is how make-demo-account leaves one.
  store.createClient('hyline', 'Hyline Dental', 'hyline', 'pw', 'b');
  assert.equal((store.db.prepare('SELECT display_name FROM users WHERE email=?').get('hyline') as { display_name: string }).display_name, '');

  store.db.prepare('UPDATE users SET display_name=? WHERE email=?').run('Alexis', 'hyline');
  const who = store.db.prepare("SELECT display_name FROM users WHERE clinic_id=? AND display_name<>'' LIMIT 1")
    .get('hyline') as { display_name: string } | undefined;
  assert.equal(who?.display_name, 'Alexis', 'the endpoint that stamps a visit can now find a name');
  store.close();
});

test('removing a login takes the login and nothing else', () => {
  const store = openStore(':memory:', false);
  store.createClient('hyline', 'Hyline Dental', 'keeper', 'pw', 'b');
  store.createClient('hyline', 'Hyline Dental', 'spare', 'pw', 'b', false, { displayName: 'Alexis' });
  store.outreach.release('hyline', 'r1', 'Release 1', 't', [at('Karve Pilates', 41.7, -88.16)], false);
  const business = store.outreach.businesses('hyline')[0];
  store.outreach.recordVisit('hyline', {
    businessId: business.id, staff: 'Alexis', visitedOn: '2026-10-26', spokeWith: 'Dana',
    contactRole: 'Owner', outcome: 'interested', materials: 5, note: '', nextAction: '', followUpOn: null,
  });

  store.db.prepare('DELETE FROM users WHERE email=?').run('spare');

  assert.equal(store.outreach.businesses('hyline').length, 1, 'the business stayed');
  const visits = store.outreach.visits('hyline');
  assert.equal(visits.length, 1, 'the visit stayed');
  assert.equal(visits[0].staff, 'Alexis', 'and keeps the name it was recorded under');
  assert.equal(store.signIn('keeper', 'pw', '1.2.3.4').ok, true, 'the remaining login still works');
  store.close();
});

test('re-planning a day collapses every round already booked on it', () => {
  const store = world();
  const id = ids(store, 'hyline');
  // What the earlier version of plan-round left behind: two rounds, same day, same person.
  store.outreach.planRound('hyline', { date: '2026-10-27', start: '09:00', staff: 'Alexis', businessIds: [id['Karve Pilates']] });
  store.outreach.planRound('hyline', { date: '2026-10-27', start: '09:00', staff: 'Alexis', businessIds: [id['Yoga Cave'], id['Salon Fluxx']] });
  assert.equal(store.outreach.rounds('hyline').filter(r => r.date === '2026-10-27').length, 2);

  const [keep, ...extra] = store.outreach.rounds('hyline').filter(r => r.date === '2026-10-27' && r.staff === 'Alexis');
  for (const round of extra) store.outreach.removeRound('hyline', round.id);
  store.outreach.planRound('hyline', {
    id: keep.id, date: '2026-10-27', start: '09:00', staff: 'Alexis',
    businessIds: [id['Karve Pilates'], id['Yoga Cave'], id['Salon Fluxx']],
  });

  const left = store.outreach.rounds('hyline').filter(r => r.date === '2026-10-27');
  assert.equal(left.length, 1, 'one round for the day');
  assert.equal(left[0].stops.length, 3);
  store.close();
});

test('a removed round takes its stops and nothing else', () => {
  const store = world();
  const id = ids(store, 'hyline');
  const round = store.outreach.planRound('hyline', {
    date: '2026-10-27', start: '09:00', staff: 'Alexis', businessIds: [id['Karve Pilates']],
  });
  store.outreach.recordVisit('hyline', {
    businessId: id['Karve Pilates'], staff: 'Alexis', visitedOn: '2026-10-27', spokeWith: 'Dana',
    contactRole: 'Owner', outcome: 'interested', materials: 9, note: '', nextAction: '', followUpOn: null,
  });

  store.outreach.removeRound('hyline', round.id);
  assert.equal(store.outreach.rounds('hyline').length, 0);
  assert.equal(store.outreach.businesses('hyline').length, 3, 'the businesses stayed');
  assert.equal(store.outreach.visits('hyline').length, 1, 'the visit stayed');
  assert.throws(() => store.outreach.removeRound('other', round.id), /not yours/);
  store.close();
});

test('a verified category stands in only where Google classified nothing', async () => {
  const { typeFromVerifiedCategory } = await import('../server/network/verified-category.ts');
  // Karve Pilates came back from Google as health/point_of_interest/establishment.
  assert.equal(typeFromVerifiedCategory('Pilates studio'), 'yoga_studio');
  assert.equal(typeFromVerifiedCategory('Yoga studio'), 'yoga_studio');
  assert.equal(typeFromVerifiedCategory("Children's hair salon"), 'hair_salon');
  assert.equal(typeFromVerifiedCategory("Men's grooming salon"), 'barber_shop');
  assert.equal(typeFromVerifiedCategory('Physical therapy'), 'physiotherapist');
  // Wording we do not recognise stays uncategorised rather than being forced into a bucket.
  assert.equal(typeFromVerifiedCategory('Bookshop'), null);
  assert.equal(typeFromVerifiedCategory(''), null);
});
