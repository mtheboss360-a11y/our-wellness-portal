// THE PLANNER'S ARITHMETIC. What is tested here is the difference between an estimate and a
// promise: that a measured leg and an allowance are never mixed up, that a pickup window that
// cannot be met is said out loud, and that the moves the screen offers are exactly the moves
// the server will accept.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planRoute, moveItem, mondayOf, addDays, weekLabel, TRAVEL_ALLOWANCE } from '../src/lib/route-math.ts';
import type { RunnerItem } from '../server/runner.ts';
import type { Business, Visit } from '../server/outreach.ts';

const business = (id: string, lat: number | null = null, lng: number | null = null): Business => ({
  id, name: id, category: 'Studio', address: `${id} Street`, phone: '', website: '',
  talkingPoint: '', stage: 'new', releaseId: 'r1', releasedAt: 0, lat, lng,
  placeId: null, geoAt: null, types: [], primaryType: null, demo: null,
});
const stop = (id: string, lat: number | null = null, lng: number | null = null, locked = false): RunnerItem =>
  ({ kind: 'business', id, position: 0, locked, business: business(id, lat, lng) });
const pickup = (id: string, windowStart: string, windowEnd: string, minutes = 10,
  status: 'planned' | 'collected' = 'planned'): RunnerItem => ({
  kind: 'pickup', id, position: 0, locked: false,
  pickup: { id, roundId: 'r', kind: 'treats', title: id, address: `${id} Road`,
    windowStart, windowEnd, minutes, items: '', reference: '', note: '',
    supplies: { flyers: 0, treats: 0, cards: 0 }, status, collectedAt: null, position: 0 },
});
const visit = (businessId: string, visitedOn: string): Visit => ({
  id: `v_${businessId}`, businessId, businessName: businessId, staff: 'Alexis', visitedOn,
  spokeWith: '', contactRole: '', outcome: 'interested', outcomeLabel: 'Interested',
  materials: 0, note: '', nextAction: '', followUpOn: null, createdAt: 0, edited: false,
});
// A Tuesday, when the practice opens at 09:00.
const round = (items: RunnerItem[], start = '09:00', date = '2026-10-27') => ({ id: 'r', date, start, items });

test('a leg between two known positions is measured; everything else gets the allowance', () => {
  const plan = planRoute(round([stop('A', 41.70, -88.16), stop('B', 41.73, -88.19), stop('C')]), [], {
    clinic: { lat: 41.68, lng: -88.14 },
  });
  assert.equal(plan.items[0].measured, true);
  assert.equal(plan.items[1].measured, true);
  assert.equal(plan.items[2].measured, false, 'a business with no coordinate cannot be measured');
  assert.equal(plan.items[2].travel, TRAVEL_ALLOWANCE);
  assert.deepEqual(plan.unlocated, ['C']);
  assert.match(plan.warnings.join(' '), /no map position/);
});

test('with no coordinates at all every leg is an allowance, and the day still adds up', () => {
  const plan = planRoute(round([stop('A'), stop('B')]), []);
  assert.equal(plan.travelMinutes, TRAVEL_ALLOWANCE * 2);
  assert.equal(plan.onSiteMinutes, 40);
  assert.equal(plan.startsAt, 9 * 60);
  assert.equal(plan.endsAt, plan.startsAt + TRAVEL_ALLOWANCE + 20 + TRAVEL_ALLOWANCE + 20);
  assert.equal(plan.totalMinutes, plan.endsAt - plan.startsAt);
});

test('a pickup reached before it opens waits, and one reached after it closes is a warning', () => {
  const early = planRoute(round([pickup('Bakery', '10:00', '10:30')]), []);
  assert.equal(early.items[0].wait, 52, 'arrives 09:08, waits until 10:00');
  assert.equal(early.items[0].arriveAt, 10 * 60);
  assert.equal(early.waitMinutes, 52);
  assert.equal(early.warnings.length, 0);

  const late = planRoute(round([stop('A'), stop('B'), pickup('Bakery', '09:00', '09:30')]), []);
  assert.ok(late.items[2].late > 0);
  assert.match(late.warnings.join(' '), /Bakery closes at 09:30/);
  assert.match(late.warnings.join(' '), /Move it earlier/);
});

test('the round starts when the practice opens, never before it', () => {
  const held = planRoute(round([stop('A')], '08:00'), []);
  assert.equal(held.startsAt, 9 * 60);
  assert.equal(held.opening.heldBack, true);
  const closed = planRoute(round([stop('A')], '09:00', '2026-10-25'), []); // a Sunday
  assert.equal(closed.opening.closed, true);
  assert.match(closed.warnings.join(' '), /day the practice is closed/);
});

test('a stop is finished by a visit recorded on the day or after it, never before', () => {
  const items = [stop('A'), stop('B'), pickup('Bakery', '09:00', '17:00', 10, 'collected')];
  const plan = planRoute(round(items), [visit('A', '2026-10-28'), visit('B', '2026-10-26')]);
  assert.equal(plan.items[0].done, true, 'recorded the day after the round still counts');
  assert.equal(plan.items[1].done, false, 'recorded before the round was booked is history');
  assert.equal(plan.items[2].done, true, 'a collected pickup is finished');
  assert.equal(plan.completed, 2);
  assert.equal(plan.next?.item.id, 'B');
});

test('a move the server would refuse is never offered', () => {
  const items = [stop('A'), stop('B'), stop('C')];
  const none = new Set<string>();
  assert.deepEqual(moveItem(items, none, 'business:C', 0)?.map(i => i.id), ['C', 'A', 'B']);
  assert.equal(moveItem(items, none, 'business:A', 3), null, 'past the end');
  assert.equal(moveItem(items, none, 'business:A', 0), null, 'nowhere');
  assert.equal(moveItem(items, new Set(['business:A']), 'business:A', 1), null, 'a finished stop stays');
  assert.equal(moveItem(items, new Set(['business:B']), 'business:C', 1), null, 'and is not displaced');

  const locked = [stop('A', null, null, true), stop('B'), stop('C')];
  assert.equal(moveItem(locked, none, 'business:C', 0), null, 'a fixed stop keeps its place');
  assert.deepEqual(moveItem(locked, none, 'business:C', 1)?.map(i => i.id), ['A', 'C', 'B']);
});

test('the week runs Monday to Sunday, whatever day is open', () => {
  assert.equal(mondayOf('2026-10-27'), '2026-10-26');
  assert.equal(mondayOf('2026-10-26'), '2026-10-26');
  assert.equal(mondayOf('2026-11-01'), '2026-10-26', 'Sunday belongs to the week it ends');
  assert.equal(addDays('2026-10-31', 1), '2026-11-01');
  assert.equal(weekLabel('2026-10-26'), 'Oct 26 – Nov 1');
  assert.equal(weekLabel('2026-11-02'), 'Nov 2–8');
});
