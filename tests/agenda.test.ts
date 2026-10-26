// THE AGENDA. The risk here is dressing a guess up as a schedule, so these tests are mostly
// about where each number came from: a time read back from the log, or one this code worked
// out. The second kind must be reachable, adjustable, and never silently mixed with the first.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { FieldLog, FieldStop } from '../data/field-data';
import { agenda, clockOf, driveMinutes, durationLabel, milesBetween, typicalVisit, DEFAULTS } from '../src/lib/agenda-math';

const stop = (over: Partial<FieldStop> & { id: string; businessId: string }): FieldStop => ({
  name: 'A business', category: 'gym', town: 'Naperville', lat: 41.78, lng: -88.15,
  arrived: null, left: null, spokeWith: '', staffOnShift: 0,
  boxes: 0, coffees: 0, cards: 6, display: false, outcome: 'pending', note: '', photo: null,
  crossRef: { theirClients: '', yourServices: [], score: 0 }, ...over,
});

const log = (routes: FieldLog['routes']): FieldLog => ({
  clinic: { label: '100 Main St', lat: 41.77, lng: -88.15 },
  drivers: [{ id: 'd1', name: 'Alexis', photo: '', homeBase: '', since: '2026-01', vehicle: '', languages: [], bio: '' }],
  routes, signups: [],
});

test('a stop is as long as their own stops have actually been', () => {
  const l = log([{ id: 'r1', date: '2026-10-07', start: '09:00', driverId: 'd1', status: 'done', stops: [
    stop({ id: 's1', businessId: 'b1', arrived: '09:00', left: '09:20' }),
    stop({ id: 's2', businessId: 'b2', arrived: '10:00', left: '10:30' }),
    stop({ id: 's3', businessId: 'b3', arrived: '11:00', left: '11:40' }),
  ] }]);
  const v = typicalVisit(l);
  assert.equal(v.minutes, 30, 'the middle of 20, 30 and 40');
  assert.equal(v.basis, 'their-own-visits');
  assert.equal(v.from, 3);
});

test('with nothing logged it falls back, and says it fell back', () => {
  const v = typicalVisit(null);
  assert.equal(v.minutes, DEFAULTS.visitMinutes);
  assert.equal(v.basis, 'default');
  assert.equal(v.from, 0, 'no visits stand behind it');
});

test('one stop that was never closed out cannot drag the estimate', () => {
  const l = log([{ id: 'r1', date: '2026-10-07', start: '09:00', driverId: 'd1', status: 'done', stops: [
    stop({ id: 's1', businessId: 'b1', arrived: '09:00', left: '09:20' }),
    stop({ id: 's2', businessId: 'b2', arrived: '10:00', left: '10:20' }),
    stop({ id: 's3', businessId: 'b3', arrived: '11:00', left: '19:00' }), // forgot to log leaving
  ] }]);
  assert.equal(typicalVisit(l).minutes, 20, 'the median holds where a mean would not');
});

test('a completed round reads its times back from the log rather than estimating them', () => {
  const l = log([{ id: 'r1', date: '2026-10-07', start: '09:00', driverId: 'd1', status: 'done', stops: [
    stop({ id: 's1', businessId: 'b1', arrived: '09:12', left: '09:41', outcome: 'joined' }),
  ] }]);
  const plan = agenda(l, l.routes[0]);
  assert.equal(plan.stops[0].measured, true);
  assert.equal(clockOf(plan.stops[0].arriveAt), '9:12 AM');
  assert.equal(plan.stops[0].visitLength, 29);
  assert.equal(plan.estimated, false, 'nothing on this round is a guess');
  assert.equal(plan.stops[0].status, 'completed');
});

test('a booked round is marked as estimated throughout', () => {
  const l = log([{ id: 'r1', date: '2026-10-28', start: '09:00', driverId: 'd1', status: 'scheduled', stops: [
    stop({ id: 's1', businessId: 'b1' }), stop({ id: 's2', businessId: 'b2', lat: 41.83, lng: -88.21 }),
  ] }]);
  const plan = agenda(l, l.routes[0]);
  assert.equal(plan.estimated, true);
  assert.ok(plan.stops.every(s => !s.measured));
  assert.ok(plan.stops[0].arriveAt > plan.startsAt, 'the first stop is after the drive to it');
  assert.ok(plan.stops[1].arriveAt > plan.stops[0].leaveAt, 'each stop follows the one before');
  assert.equal(plan.totalMinutes, plan.endsAt - plan.startsAt);
});

test('the assumptions change the plan, which is the point of them being on screen', () => {
  const l = log([{ id: 'r1', date: '2026-10-28', start: '09:00', driverId: 'd1', status: 'scheduled', stops: [
    stop({ id: 's1', businessId: 'b1' }), stop({ id: 's2', businessId: 'b2', lat: 41.9, lng: -88.3 }),
  ] }]);
  const quick = agenda(l, l.routes[0], { assumptions: { visitMinutes: 10 } });
  const slow = agenda(l, l.routes[0], { assumptions: { visitMinutes: 45 } });
  assert.ok(slow.totalMinutes > quick.totalMinutes);
  assert.equal(slow.visitingMinutes - quick.visitingMinutes, 70, 'two stops, 35 minutes longer each');

  const crawling = agenda(l, l.routes[0], { assumptions: { mph: 8 } });
  assert.ok(crawling.drivingMinutes > quick.drivingMinutes, 'a slower speed means more driving');
});

test('a stop is only in progress on the day, and only inside its own window', () => {
  const l = log([{ id: 'r1', date: '2026-10-28', start: '09:00', driverId: 'd1', status: 'scheduled', stops: [
    stop({ id: 's1', businessId: 'b1' }),
  ] }]);
  const inside = agenda(l, l.routes[0], { today: '2026-10-28', nowMinutes: 9 * 60 + 10 });
  assert.equal(inside.stops[0].status, 'in-progress');

  const before = agenda(l, l.routes[0], { today: '2026-10-28', nowMinutes: 7 * 60 });
  assert.equal(before.stops[0].status, 'upcoming');

  const anotherDay = agenda(l, l.routes[0], { today: '2026-10-27', nowMinutes: 9 * 60 + 10 });
  assert.equal(anotherDay.stops[0].status, 'upcoming', 'the clock does not apply to another day');
});

test('distance and drive time are plausible, and never zero', () => {
  const a = { lat: 41.77, lng: -88.15 }, b = { lat: 41.83, lng: -88.21 };
  const miles = milesBetween(a, b);
  assert.ok(miles > 4 && miles < 6, `about five miles, got ${miles.toFixed(2)}`);
  assert.ok(driveMinutes(a, b, DEFAULTS) > 10);
  assert.equal(driveMinutes(a, a, DEFAULTS), 1, 'the same place still takes a minute, never zero');
});

test('clock and duration read the way a person says them', () => {
  assert.equal(clockOf(9 * 60), '9:00 AM');
  assert.equal(clockOf(12 * 60 + 5), '12:05 PM');
  assert.equal(clockOf(0), '12:00 AM');
  assert.equal(durationLabel(45), '45 min');
  assert.equal(durationLabel(60), '1 hr');
  assert.equal(durationLabel(135), '2 hr 15 min');
});

test('a round with no stops does not produce a negative day', () => {
  const l = log([{ id: 'r1', date: '2026-10-28', start: '09:00', driverId: 'd1', status: 'scheduled', stops: [] }]);
  const plan = agenda(l, l.routes[0]);
  assert.equal(plan.totalMinutes, 0);
  assert.equal(plan.endsAt, plan.startsAt);
});
