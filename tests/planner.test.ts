// THE ROUTE PLANNER. Two things worth holding: a round never offers a business from outside
// this clinic's own log, and the drive it produces starts at the practice and visits the stops
// in the order the person put them in — not an order the portal decided was better.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { FieldLog, FieldStop } from '../data/field-data';
import { candidates, driveUrl, MAX_STOPS } from '../src/RoutePlanner';

const stop = (over: Partial<FieldStop> & { id: string; businessId: string }): FieldStop => ({
  name: 'A business', category: 'gym', town: 'Naperville', lat: 41.7, lng: -88.1,
  arrived: '09:00', left: '09:20', spokeWith: 'Sam', staffOnShift: 2,
  boxes: 0, coffees: 0, cards: 4, display: false, outcome: 'joined', note: '', photo: null,
  crossRef: { theirClients: '', yourServices: [], score: 0 }, ...over,
});

const log = (stops: FieldStop[], status: 'done' | 'scheduled' = 'done'): FieldLog => ({
  clinic: { label: '100 Main St', lat: 41.77, lng: -88.15 },
  drivers: [{ id: 'd1', name: 'Alexis', photo: '', homeBase: '', since: '2026-01', vehicle: '', languages: [], bio: '' }],
  routes: [{ id: 'r1', date: '2026-10-07', start: '09:00', driverId: 'd1', status, stops }],
  signups: [],
});

test('only businesses from this clinic’s own log are offered', () => {
  const l = log([stop({ id: 's1', businessId: 'ours', name: 'Ours', outcome: 'follow-up' })]);
  const rows = candidates(l, [{ businessId: 'somewhere-else', note: '', nextRound: true }]);
  assert.deepEqual(rows.map(r => r.businessId), ['ours'], 'a ticked id that is not on the log cannot appear');
});

test('a business is offered because it was ticked, or because it is owed a call — and says which', () => {
  const l = log([
    stop({ id: 's1', businessId: 'ticked', name: 'Ticked', outcome: 'joined' }),
    stop({ id: 's2', businessId: 'owed', name: 'Owed', outcome: 'follow-up' }),
    stop({ id: 's3', businessId: 'quiet', name: 'Quiet', outcome: 'joined' }),
  ]);
  const rows = candidates(l, [{ businessId: 'ticked', note: '', nextRound: true }]);
  assert.deepEqual(rows.map(r => r.businessId).sort(), ['owed', 'ticked']);
  assert.equal(rows.find(r => r.businessId === 'ticked')!.why, 'Picked on Route notes');
  assert.equal(rows.find(r => r.businessId === 'owed')!.why, 'Owed a second call');
  assert.ok(!rows.some(r => r.businessId === 'quiet'), 'a business with no reason is not padding');
});

test('a scheduled round contributes nobody: they have not been visited yet', () => {
  const l = log([stop({ id: 's1', businessId: 'later', outcome: 'follow-up' })], 'scheduled');
  assert.deepEqual(candidates(l, []), []);
});

test('the drive starts at the practice and keeps the order it was given', () => {
  const stops = [
    { businessId: 'a', name: 'A', town: '', category: 'gym' as const, lat: 1, lng: 2, why: '' },
    { businessId: 'b', name: 'B', town: '', category: 'gym' as const, lat: 3, lng: 4, why: '' },
    { businessId: 'c', name: 'C', town: '', category: 'gym' as const, lat: 5, lng: 6, why: '' },
  ];
  const url = driveUrl({ lat: 41.77, lng: -88.15 }, stops);
  assert.match(url, /origin=41\.77,-88\.15/, 'the practice is the origin');
  assert.match(url, /destination=5,6/, 'the last stop is the destination');
  assert.match(url, /waypoints=1%2C2%7C3%2C4/, 'the ones between keep their order');
  assert.match(url, /travelmode=driving/);
});

test('one stop needs no waypoints, and no stops produces no link', () => {
  const one = driveUrl({ lat: 1, lng: 1 }, [{ businessId: 'a', name: 'A', town: '', category: 'gym', lat: 2, lng: 2, why: '' }]);
  assert.match(one, /destination=2,2/);
  assert.ok(!one.includes('waypoints'));
  assert.equal(driveUrl({ lat: 1, lng: 1 }, []), '');
});

test('a round is five stops', () => {
  assert.equal(MAX_STOPS, 5);
});
