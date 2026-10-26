// The dashboard's arithmetic. The point of these is the separations: a scheduled route is not
// a visit, a card handed over is not a card used, a tap sign-up is not an appointment, and a
// recommendation is not a partner. Each one is a claim the portal would otherwise make for a
// practice, so each one gets a test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { FieldLog, FieldStop } from '../data/field-data';
import type { NetworkMapPayload, MapBusiness } from '../src/lib/network-math';
import {
  followUps, monthLabel, nextAction, opportunities, participating, recentActivity, thisMonth,
} from '../src/lib/dashboard-math';

const stop = (over: Partial<FieldStop> & { id: string; businessId: string }): FieldStop => ({
  name: 'A business', category: 'gym', town: 'Naperville', lat: 0, lng: 0,
  arrived: '09:00', left: '09:20', spokeWith: 'Sam', staffOnShift: 3,
  boxes: 1, coffees: 6, cards: 6, display: false, outcome: 'pending', note: '', photo: null,
  crossRef: { theirClients: '', yourServices: [], score: 0 }, ...over,
});

const log = (over: Partial<FieldLog> = {}): FieldLog => ({
  clinic: { label: '100 Main St', lat: 41.77, lng: -88.15 },
  drivers: [{ id: 'd1', name: 'Marcus Reed', photo: '', homeBase: 'Naperville', since: '2026-01', vehicle: 'van', languages: [], bio: '' }],
  routes: [], signups: [], ...over,
});

const business = (over: Partial<MapBusiness> & { placeId: string }): MapBusiness => ({
  name: 'Nearby gym', address: '1 Main St', category: { id: 'gym', label: 'Fitness studio', icon: 'gym', color: '#1C3A2C' },
  distanceMiles: 1.2, rating: 4.6, reviewCount: 80, googleMapsUri: null, plot: null,
  status: 'fit', statusLabel: 'Worth approaching', statusReason: '', routable: true,
  fit: { score: 70, components: [] }, ...over,
});

const map = (over: Partial<NetworkMapPayload> = {}): NetworkMapPayload => ({
  clinic: { name: 'Hyline Dental', location: { label: '100 Main St', lat: 41.77, lng: -88.15, radiusMiles: 5 } },
  categories: [], distanceFilters: [5], businesses: [], selection: [], maxStops: 5, requests: [],
  data: { placesConfigured: true, browserMapKeyConfigured: false, retentionDays: 30, lastRefresh: null },
  ...over,
});

test('a scheduled route is not counted as a visit', () => {
  const l = log({ routes: [
    { id: 'r1', date: '2026-10-05', start: '09:00', driverId: 'd1', status: 'done', stops: [stop({ id: 's1', businessId: 'b1' })] },
    { id: 'r2', date: '2026-10-28', start: '09:00', driverId: 'd1', status: 'scheduled', stops: [stop({ id: 's2', businessId: 'b2' }), stop({ id: 's3', businessId: 'b3' })] },
  ] });
  assert.equal(thisMonth(l, '2026-10-24').visits, 1);
});

test('only this month counts, and a clinic with no log reads "not recorded", never zero', () => {
  const l = log({ routes: [
    { id: 'r1', date: '2026-09-30', start: '09:00', driverId: 'd1', status: 'done', stops: [stop({ id: 's1', businessId: 'b1' })] },
    { id: 'r2', date: '2026-10-02', start: '09:00', driverId: 'd1', status: 'done', stops: [stop({ id: 's2', businessId: 'b2' })] },
  ] });
  assert.equal(thisMonth(l, '2026-10-24').visits, 1);
  const none = thisMonth(null, '2026-10-24');
  assert.equal(none.hasLog, false, 'the screen must be able to tell nothing-recorded from zero');
});

test('a tap sign-up is never counted as an appointment', () => {
  const l = log({
    routes: [{ id: 'r1', date: '2026-10-05', start: '09:00', driverId: 'd1', status: 'done', stops: [stop({ id: 's1', businessId: 'b1' })] }],
    signups: [
      { id: 'u1', firstName: 'A', routeId: 'r1', stopId: 's1', date: '2026-10-08', service: 'Cleaning', status: 'new' },
      { id: 'u2', firstName: 'B', routeId: 'r1', stopId: 's1', date: '2026-10-09', service: 'Cleaning', status: 'booked' },
    ],
  });
  const month = thisMonth(l, '2026-10-24');
  assert.equal(month.signups, 2);
  assert.equal(month.booked, 1, 'only a sign-up the clinic marked booked is an appointment');
});

test('materials counts what staff handed over, not what a business used', () => {
  const l = log({ routes: [{ id: 'r1', date: '2026-10-05', start: '09:00', driverId: 'd1', status: 'done',
    stops: [stop({ id: 's1', businessId: 'b1', cards: 6, boxes: 1, display: false })] }] });
  assert.equal(thisMonth(l, '2026-10-24').materials, 7);
});

test('a business is participating only once staff recorded that it agreed', () => {
  const l = log({ routes: [{ id: 'r1', date: '2026-10-05', start: '09:00', driverId: 'd1', status: 'done', stops: [
    stop({ id: 's1', businessId: 'b1', outcome: 'joined' }),
    stop({ id: 's2', businessId: 'b2', outcome: 'follow-up' }),
    stop({ id: 's3', businessId: 'b3', outcome: 'pending' }),
  ] }] });
  assert.deepEqual(participating(l).map(s => s.businessId), ['b1']);
  assert.deepEqual(followUps(l).map(f => f.stop.businessId), ['b2']);
});

test('a recommendation is never promoted to a partner', () => {
  const m = map({ businesses: [business({ placeId: 'p1' }), business({ placeId: 'p2', status: 'in-network' })] });
  const picked = opportunities(m);
  assert.deepEqual(picked.map(b => b.placeId), ['p1'], 'only businesses still worth approaching');
  assert.deepEqual(participating(null), [], 'nothing on the map can make a partner');
});

test('opportunities skip anything the network cannot route to, best fit first', () => {
  const m = map({ businesses: [
    business({ placeId: 'p1', fit: { score: 55, components: [] } }),
    business({ placeId: 'p2', fit: { score: 90, components: [] } }),
    business({ placeId: 'p3', routable: false, fit: { score: 99, components: [] } }),
  ] });
  assert.deepEqual(opportunities(m).map(b => b.placeId), ['p2', 'p1']);
});

test('next action follows the real order of the work', () => {
  const booked = log({ routes: [{ id: 'r1', date: '2026-10-28', start: '09:00', driverId: 'd1', status: 'scheduled', stops: [] }] });
  assert.equal(nextAction(booked, map(), '2026-10-24').kind, 'route');

  const owed = log({ routes: [{ id: 'r1', date: '2026-10-05', start: '09:00', driverId: 'd1', status: 'done',
    stops: [stop({ id: 's1', businessId: 'b1', outcome: 'follow-up' })] }] });
  assert.equal(nextAction(owed, map(), '2026-10-24').kind, 'follow-up');

  const fresh = map({ businesses: [business({ placeId: 'p1' })] });
  assert.equal(nextAction(null, fresh, '2026-10-24').kind, 'choose');

  assert.equal(nextAction(null, map({ clinic: { name: 'X', location: null } }), '2026-10-24').kind, 'locate');
  assert.equal(nextAction(null, map(), '2026-10-24').kind, 'none', 'nothing to do must say so, not invent a task');
});

test('a past scheduled route is not offered as the next thing', () => {
  const stale = log({ routes: [{ id: 'r1', date: '2026-10-01', start: '09:00', driverId: 'd1', status: 'scheduled', stops: [] }] });
  assert.equal(nextAction(stale, map(), '2026-10-24').kind, 'none');
});

test('recent activity keeps visits and sign-ups apart, newest first', () => {
  const l = log({
    routes: [{ id: 'r1', date: '2026-10-05', start: '09:00', driverId: 'd1', status: 'done', stops: [stop({ id: 's1', businessId: 'b1', name: 'Ridgeline' })] }],
    signups: [{ id: 'u1', firstName: 'A', routeId: 'r1', stopId: 's1', date: '2026-10-09', service: 'Cleaning', status: 'new' }],
  });
  const feed = recentActivity(l);
  assert.deepEqual(feed.map(i => i.kind), ['signup', 'visit']);
  assert.equal(feed.filter(i => i.kind === 'visit').length, 1);
  assert.equal(recentActivity(null).length, 0);
});

test('the month label reads as a person would say it', () => {
  assert.equal(monthLabel('2026-10-24'), 'October 2026');
});

test('a busy week of taps does not push every visit off the activity feed', () => {
  const stops = Array.from({ length: 6 }, (_, n) => stop({ id: `s${n}`, businessId: `b${n}`, name: `Business ${n}` }));
  const l = log({
    routes: [{ id: 'r1', date: '2026-10-01', start: '09:00', driverId: 'd1', status: 'done', stops }],
    // every tap lands after every visit, which is the normal shape of a month
    signups: Array.from({ length: 20 }, (_, n) => ({ id: `u${n}`, firstName: 'A', routeId: 'r1', stopId: 's0', date: '2026-10-24', service: 'Cleaning', status: 'new' as const })),
  });
  const feed = recentActivity(l, 8);
  assert.equal(feed.length, 8);
  assert.ok(feed.some(i => i.kind === 'visit'), 'visits must still be visible');
  assert.ok(feed.some(i => i.kind === 'signup'), 'sign-ups must still be visible');
});
