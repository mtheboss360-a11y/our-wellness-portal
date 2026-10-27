// THE FIRST SCREEN AGREEING WITH THE REST OF THE PORTAL.
//
// These tests exist because the dashboard and the agenda contradicted each other on a live
// account: the dashboard announced a round on Wednesday while the agenda showed Tuesday, and
// the two visit counts differed. Both were reading real data — different real data. So what
// is tested here is agreement, not arithmetic.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openStore } from '../server/store.ts';
import type { Script } from '../server/outreach.ts';
import { nextRound, staffMonth, owedACall, notYetVisited } from '../src/lib/staff-dashboard.ts';
import { planRound } from '../src/lib/round-math.ts';

const script = (): Script => ({
  opening: 'o', introduction: 'i', value: 'v', ask: 'a',
  objections: { busy: 'b', notInterested: 'n', alreadyPartnered: 'p' }, closing: 'c', followUp: 'f',
});
const at = (name: string, lat: number, lng: number) => ({
  name, category: 'Studio', address: `${name} Street, Naperville, IL`, script: script(), lat, lng,
});

function world() {
  const store = openStore(':memory:', false);
  store.createClient('hyline', 'Hyline Dental', 'hyline', 'pw', 'b');
  store.outreach.release('hyline', 'r1', 'Release 1', 't', [
    at('Karve Pilates', 41.70, -88.16), at('Yoga Cave', 41.73, -88.19), at('Salon Fluxx', 41.76, -88.21),
  ], false);
  return store;
}
const ids = (store: ReturnType<typeof openStore>) =>
  Object.fromEntries(store.outreach.businesses('hyline').map(b => [b.name, b.id]));

test('the dashboard and the agenda pick the same round', () => {
  const store = world();
  const id = ids(store);
  store.outreach.planRound('hyline', { date: '2026-10-27', start: '09:00', staff: 'Alexis', businessIds: [id['Karve Pilates']] });
  store.outreach.planRound('hyline', { date: '2026-11-03', start: '09:00', staff: 'Alexis', businessIds: [id['Yoga Cave']] });

  const rounds = store.outreach.rounds('hyline');
  const chosen = nextRound(rounds, '2026-10-26');
  assert.equal(chosen!.date, '2026-10-27', 'the soonest round that has not passed');

  // The agenda picks the same way: first scheduled round on or after today.
  const agendaPick = [...rounds].filter(r => r.date >= '2026-10-26').sort((a, b) => a.date.localeCompare(b.date))[0];
  assert.equal(chosen!.id, agendaPick.id);
  store.close();
});

test('two rounds on one day: the fuller one is the one somebody meant', () => {
  const store = world();
  const id = ids(store);
  store.outreach.planRound('hyline', { date: '2026-10-27', start: '09:00', staff: 'Alexis', businessIds: [id['Karve Pilates']] });
  store.outreach.planRound('hyline', { date: '2026-10-27', start: '09:00', staff: 'Alexis',
    businessIds: [id['Karve Pilates'], id['Yoga Cave'], id['Salon Fluxx']] });

  const chosen = nextRound(store.outreach.rounds('hyline'), '2026-10-26');
  assert.equal(chosen!.stops.length, 3);
  store.close();
});

test('with every round in the past it shows the most recent rather than nothing', () => {
  const store = world();
  const id = ids(store);
  store.outreach.planRound('hyline', { date: '2026-09-01', start: '09:00', staff: 'Alexis', businessIds: [id['Karve Pilates']] });
  store.outreach.planRound('hyline', { date: '2026-10-01', start: '09:00', staff: 'Alexis', businessIds: [id['Yoga Cave']] });
  assert.equal(nextRound(store.outreach.rounds('hyline'), '2026-10-26')!.date, '2026-10-01');
  assert.equal(nextRound([], '2026-10-26'), null);
  store.close();
});

test('the dashboard month and the round both count the same recorded visits', () => {
  const store = world();
  const id = ids(store);
  const round = store.outreach.planRound('hyline', {
    date: '2026-10-27', start: '09:00', staff: 'Alexis',
    businessIds: [id['Karve Pilates'], id['Yoga Cave']],
  });
  store.outreach.recordVisit('hyline', {
    businessId: id['Karve Pilates'], staff: 'Alexis', visitedOn: '2026-10-27', spokeWith: 'Dana',
    contactRole: 'Owner', outcome: 'interested', materials: 20, note: '', nextAction: '', followUpOn: '2026-11-10',
  });

  const visits = store.outreach.visits('hyline');
  const month = staffMonth(visits, store.outreach.businesses('hyline'), '2026-10-27');
  const plan = planRound({ lat: 41.68, lng: -88.15 }, round, visits, { today: '2026-10-27' });

  assert.equal(month.visits, 1);
  assert.equal(month.materials, 20);
  assert.equal(plan.completed, 1, 'the agenda agrees one stop is done');
  assert.equal(month.notContacted, 2, 'the two nobody has been to');
  store.close();
});

test('a follow-up stops being due once somebody goes back', () => {
  const store = world();
  const id = ids(store);
  store.outreach.recordVisit('hyline', {
    businessId: id['Karve Pilates'], staff: 'Alexis', visitedOn: '2026-10-01', spokeWith: 'Dana',
    contactRole: 'Owner', outcome: 'follow-up', materials: 5, note: '', nextAction: '', followUpOn: '2026-10-15',
  });

  let visits = store.outreach.visits('hyline');
  assert.equal(staffMonth(visits, [], '2026-10-26').followUpsDue, 1);
  assert.equal(owedACall(visits, '2026-10-26')[0].businessName, 'Karve Pilates');

  store.outreach.recordVisit('hyline', {
    businessId: id['Karve Pilates'], staff: 'Alexis', visitedOn: '2026-10-20', spokeWith: 'Dana',
    contactRole: 'Owner', outcome: 'partner', materials: 10, note: '', nextAction: '', followUpOn: null,
  });
  visits = store.outreach.visits('hyline');
  assert.equal(staffMonth(visits, [], '2026-10-26').followUpsDue, 0, 'somebody went back');
  assert.deepEqual(owedACall(visits, '2026-10-26'), []);
  store.close();
});

test('a follow-up dated in the future is not due yet', () => {
  const store = world();
  const id = ids(store);
  store.outreach.recordVisit('hyline', {
    businessId: id['Karve Pilates'], staff: 'Alexis', visitedOn: '2026-10-26', spokeWith: 'Dana',
    contactRole: 'Owner', outcome: 'interested', materials: 5, note: '', nextAction: '', followUpOn: '2026-11-09',
  });
  assert.equal(staffMonth(store.outreach.visits('hyline'), [], '2026-10-26').followUpsDue, 0);
  store.close();
});

test('the not-contacted list only holds businesses nobody has visited', () => {
  const store = world();
  const id = ids(store);
  store.outreach.recordVisit('hyline', {
    businessId: id['Karve Pilates'], staff: 'Alexis', visitedOn: '2026-10-26', spokeWith: '',
    contactRole: '', outcome: 'materials', materials: 8, note: '', nextAction: '', followUpOn: null,
  });
  const left = notYetVisited(store.outreach.businesses('hyline'));
  assert.deepEqual(left.map(b => b.name).sort(), ['Salon Fluxx', 'Yoga Cave']);
  store.close();
});

test('the month comparison is a real count, and overdue is not the same as due', () => {
  const store = world();
  const id = ids(store);
  // Two visits last month, one this month.
  for (const [on, mats] of [['2026-09-05', 10], ['2026-09-19', 14], ['2026-10-02', 6]] as const) {
    store.outreach.recordVisit('hyline', {
      businessId: id['Karve Pilates'], staff: 'Alexis', visitedOn: on, spokeWith: 'Dana',
      contactRole: 'Owner', outcome: 'materials', materials: mats, note: '', nextAction: '',
      followUpOn: null, clientRef: `ref${on.replace(/-/g, '')}`,
    });
  }
  const month = staffMonth(store.outreach.visits('hyline'), [], '2026-10-20');
  assert.equal(month.visits, 1);
  assert.equal(month.visitsLastMonth, 2, 'September, not everything before October');
  assert.equal(month.materials, 6);
  assert.equal(month.materialsLastMonth, 24);
  store.close();
});

test('a follow-up due today is due but not yet overdue', () => {
  const store = world();
  const id = ids(store);
  store.outreach.recordVisit('hyline', {
    businessId: id['Karve Pilates'], staff: 'Alexis', visitedOn: '2026-10-01', spokeWith: 'Dana',
    contactRole: 'Owner', outcome: 'follow-up', materials: 0, note: '', nextAction: '',
    followUpOn: '2026-10-20',
  });
  store.outreach.recordVisit('hyline', {
    businessId: id['Yoga Cave'], staff: 'Alexis', visitedOn: '2026-10-01', spokeWith: 'Jo',
    contactRole: 'Owner', outcome: 'follow-up', materials: 0, note: '', nextAction: '',
    followUpOn: '2026-10-10',
  });
  const month = staffMonth(store.outreach.visits('hyline'), [], '2026-10-20');
  assert.equal(month.followUpsDue, 2, 'both have arrived');
  assert.equal(month.overdue, 1, 'only the one whose date has passed');
  store.close();
});

// ── THE ACTIVITY CHART ──────────────────────────────────────────────────────
// A chart is read as evidence. These are about what it must never imply.
import { activitySeries } from '../src/lib/staff-dashboard.ts';

const visitOn = (store: ReturnType<typeof openStore>, businessId: string, on: string, materials = 1) =>
  store.outreach.recordVisit('hyline', {
    businessId, staff: 'Alexis', visitedOn: on, spokeWith: 'Dana', contactRole: 'Owner',
    outcome: 'materials', materials, note: '', nextAction: '', followUpOn: null,
    clientRef: `c${on.replace(/-/g, '')}${businessId.slice(-6)}`,
  });

test('the chart draws the periods that exist and no others', () => {
  const store = world();
  const id = ids(store);
  visitOn(store, id['Karve Pilates'], '2026-10-05');
  visitOn(store, id['Yoga Cave'], '2026-10-07');

  const weeks = activitySeries(store.outreach.visits('hyline'), 'week', '2026-10-27');
  assert.equal(weeks.length, 1, 'one week of records is one column, not a padded run of zeroes');
  assert.equal(weeks[0].visits, 2);
  store.close();
});

test('a genuine gap between two active periods is shown, not closed up', () => {
  const store = world();
  const id = ids(store);
  visitOn(store, id['Karve Pilates'], '2026-10-05');
  visitOn(store, id['Yoga Cave'], '2026-10-26');

  const weeks = activitySeries(store.outreach.visits('hyline'), 'week', '2026-10-27');
  assert.equal(weeks.length, 4, 'four weeks span those two dates');
  assert.deepEqual(weeks.map(w => w.visits), [1, 0, 0, 1], 'the quiet fortnight is visible');
  store.close();
});

test('nothing recorded draws nothing at all', () => {
  assert.deepEqual(activitySeries([], 'week', '2026-10-27'), []);
  assert.deepEqual(activitySeries([], 'month', '2026-10-27'), []);
});

test('a visit dated in the future is not charted', () => {
  const store = world();
  const id = ids(store);
  visitOn(store, id['Karve Pilates'], '2026-10-05');
  visitOn(store, id['Yoga Cave'], '2026-12-01');
  const weeks = activitySeries(store.outreach.visits('hyline'), 'week', '2026-10-27');
  assert.equal(weeks.length, 1, 'only what has happened');
  store.close();
});

test('months bucket by calendar month and roll over a year end', () => {
  const store = world();
  const id = ids(store);
  visitOn(store, id['Karve Pilates'], '2026-11-20');
  visitOn(store, id['Yoga Cave'], '2027-01-04');
  const months = activitySeries(store.outreach.visits('hyline'), 'month', '2027-01-20');
  assert.deepEqual(months.map(m => m.key), ['2026-11', '2026-12', '2027-01']);
  assert.deepEqual(months.map(m => m.visits), [1, 0, 1]);
  store.close();
});

test('the Overview, Visit History and Performance count the same visits', () => {
  const store = world();
  const id = ids(store);
  visitOn(store, id['Karve Pilates'], '2026-10-05', 10);
  visitOn(store, id['Yoga Cave'], '2026-10-19', 12);
  visitOn(store, id['Salon Fluxx'], '2026-09-20', 7);

  const visits = store.outreach.visits('hyline');
  const month = staffMonth(visits, store.outreach.businesses('hyline'), '2026-10-27');

  // Visit History filters the same array by month; Performance sums the same field.
  const historyOctober = visits.filter(v => v.visitedOn.slice(0, 7) === '2026-10');
  assert.equal(month.visits, historyOctober.length);
  assert.equal(month.materials, historyOctober.reduce((n, v) => n + v.materials, 0));

  // And the chart's October bucket agrees with both.
  const october = activitySeries(visits, 'month', '2026-10-27').find(b => b.key === '2026-10')!;
  assert.equal(october.visits, month.visits);
  assert.equal(october.materials, month.materials);
  store.close();
});
