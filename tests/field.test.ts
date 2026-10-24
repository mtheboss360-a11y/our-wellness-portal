import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import type { FieldLog, FieldStop } from '../data/field-data';
import { fieldLogFeed } from '../server/validation';
import { openStore } from '../server/store';
import { createPortalServer } from '../server/http';
import { minutesBetween, nextAndLast, orbLayout, partners, tally, yourDrivers } from '../src/lib/field-math';

// A small fixture, so the maths is checked against numbers worked out by hand.
const stop = (id: string, over: Partial<FieldStop> = {}): FieldStop => ({ id, businessId: id.split('@')[0], name: id, category: 'gym', town: 'Oak Brook', lat: 41.84, lng: -87.95,
  arrived: '09:10', left: '09:25', spokeWith: 'Owner', staffOnShift: 6, boxes: 1, coffees: 6, cards: 7, display: true, outcome: 'joined', note: '', photo: null,
  crossRef: { theirClients: 'Members', yourServices: ['Infrared sauna'], score: 80 }, ...over });
const LOG: FieldLog = {
  clinic: { label: 'Test Clinic', lat: 41.8328, lng: -87.929 },
  drivers: [
    { id: 'ana', name: 'Ana Test', photo: '/assets/field/ana.jpg', homeBase: 'Lisle', since: '2026-06-01', vehicle: 'Sedan', languages: ['English'], bio: '' },
    { id: 'ben', name: 'Ben Test', photo: '/assets/field/ben.jpg', homeBase: 'Lisle', since: '2026-06-01', vehicle: 'Sedan', languages: ['English'], bio: '' },
    { id: 'cy', name: 'Cy Test', photo: '/assets/field/cy.jpg', homeBase: 'Lisle', since: '2026-06-01', vehicle: 'Sedan', languages: ['English'], bio: '' },
  ],
  routes: [
    { id: 'r1', date: '2026-10-01', start: '09:00', driverId: 'ana', status: 'done', stops: [stop('a@1'), stop('b@1', { outcome: 'follow-up', staffOnShift: 4, cards: 4, arrived: '10:00', left: '10:20' })] },
    { id: 'r2', date: '2026-10-15', start: '09:00', driverId: 'ana', status: 'done', stops: [stop('a@2', { staffOnShift: 3, cards: 3 })] },
    { id: 'r3', date: '2026-10-30', start: '09:00', driverId: 'ben', status: 'scheduled', stops: [stop('a@3', { arrived: null, left: null, staffOnShift: 0, cards: 0, boxes: 0, coffees: 0, outcome: 'pending' })] },
  ],
  signups: [
    { id: 's1', firstName: 'Kim', routeId: 'r1', stopId: 'a@1', date: '2026-10-03', service: 'Infrared sauna', status: 'booked' },
    { id: 's2', firstName: 'Lee', routeId: 'r1', stopId: 'b@1', date: '2026-10-04', service: 'Infrared sauna', status: 'new' },
    { id: 's3', firstName: 'Mo', routeId: 'r2', stopId: 'a@2', date: '2026-10-16', service: 'Infrared sauna', status: 'booked' },
  ],
};

test('totals count only driven routes, straight from the logged rows', () => {
  const t = tally(LOG);
  assert.deepEqual([t.routes, t.stops, t.staff, t.cards, t.joined, t.signups, t.booked, t.minutes], [2, 3, 13, 14, 2, 3, 2, 50]);
  const scheduled = tally(LOG, [LOG.routes[2]]);
  assert.deepEqual([scheduled.routes, scheduled.stops, scheduled.signups], [0, 0, 0], 'a route nobody has driven contributes nothing');
});
test('minutes on site never go negative and need both times', () => {
  assert.equal(minutesBetween('09:10', '09:25'), 15);
  assert.equal(minutesBetween('09:25', '09:10'), 0);
  assert.equal(minutesBetween(null, '09:10'), 0);
});
test('next route is the first scheduled one from today; last is the latest driven', () => {
  const { next, last } = nextAndLast(LOG, '2026-10-24');
  assert.equal(next?.id, 'r3'); assert.equal(last?.id, 'r2');
  assert.equal(nextAndLast(LOG, '2026-10-31').next, null, 'a past scheduled route is not "next"');
});
test('your drivers are the ones on your routes; the rest only cover the area', () => {
  const { on, area } = yourDrivers(LOG);
  assert.deepEqual(on.map(d => d.id), ['ana', 'ben']); assert.deepEqual(area.map(d => d.id), ['cy']);
});
test('partners roll repeat visits into one business', () => {
  const rows = partners(LOG);
  assert.deepEqual(rows.map(r => [r.stop.businessId, r.visits, r.signups, r.booked]), [['a', 2, 2, 2], ['b', 1, 1, 0]]);
});
test('orb layout keeps every stop inside the orb, clear of the clinic, and apart', () => {
  const points = [-88.01, -87.94, -87.87, -87.97, -87.94, -87.95, -87.97, -87.95, -87.94, -88.01].map((lng, i) =>
    stop(`s${i}@x`, { lat: 41.78 + (i % 4) * 0.035, lng }));
  for (const count of [5, 10]) {
    const laid = orbLayout(LOG.clinic, points.slice(0, count));
    assert.equal(laid.length, count);
    for (const p of laid) { const r = Math.hypot(p.x, p.y); assert.ok(r > 0.4 && r < 0.9, `radius ${r} for ${count} stops`); }
    for (let i = 0; i < laid.length; i++) for (let j = i + 1; j < laid.length; j++) assert.ok(Math.hypot(laid[i].x - laid[j].x, laid[i].y - laid[j].y) > 0.2, 'stops do not sit on each other');
  }
});
test('the shipped sample field log passes the feed contract', () => {
  const sample = fieldLogFeed.parse(JSON.parse(readFileSync('samples/field-log.sample.json', 'utf8')));
  assert.ok(sample.routes.every(r => r.stops.length === 5 || r.stops.length === 10), 'sample routes are 5 or 10 stops');
});
test('the feed contract refuses broken references and outside photo links', () => {
  assert.equal(fieldLogFeed.safeParse(LOG).success, true);
  assert.equal(fieldLogFeed.safeParse({ ...LOG, routes: [{ ...LOG.routes[0], driverId: 'nobody' }] }).success, false);
  assert.equal(fieldLogFeed.safeParse({ ...LOG, signups: [{ ...LOG.signups[0], stopId: 'a@2' }] }).success, false, 'sign-up on a stop from another route');
  assert.equal(fieldLogFeed.safeParse({ ...LOG, drivers: [{ ...LOG.drivers[0], photo: 'https://evil.invalid/x.jpg' }, ...LOG.drivers.slice(1)] }).success, false);
  assert.equal(fieldLogFeed.safeParse({ ...LOG, routes: [{ ...LOG.routes[0], stops: Array.from({ length: 11 }, (_, i) => stop(`z${i}@1`)) }] }).success, false, 'a route is at most ten stops');
});
test('the field API needs a session and only ever returns the signed-in clinic’s log', async () => {
  const store = openStore(':memory:');
  store.createClient('clinic-a', 'Clinic A', 'clinica', 'password-a-123');
  store.createClient('clinic-b', 'Clinic B', 'clinicb', 'password-b-123');
  store.saveFieldLog('clinic-a', LOG);
  const server = createPortalServer({ store, origin: 'http://portal.test', secure: false, root: process.cwd() });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const signIn = async (username: string, password: string) => (await fetch(base + '/api/login', { method: 'POST', headers: { Origin: 'http://portal.test', 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) })).headers.get('set-cookie')!.split(';')[0];
  try {
    assert.equal((await fetch(base + '/api/field')).status, 401);
    const a = await (await fetch(base + '/api/field', { headers: { Cookie: await signIn('clinica', 'password-a-123') } })).json();
    assert.equal(a.field.routes.length, 3);
    const b = await (await fetch(base + '/api/field?clinicId=clinic-a', { headers: { Cookie: await signIn('clinicb', 'password-b-123') } })).json();
    assert.equal(b.field, null, 'another clinic sees an empty log, not clinic A’s');
  } finally { server.close(); store.close(); }
});
