// THE OUTREACH REPORT. These tests exist because the five measures are the product's honesty,
// and every one of them is a sentence the practice could repeat to a patient or an accountant.
// A scan becoming an appointment, or "nobody asked" becoming "nobody came", is the failure that
// matters here — not a layout bug.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Campaign } from '../data/portal-data';
import type { FieldLog, FieldStop } from '../data/field-data';
import { activity, byMonth, bySource, measures } from '../src/lib/report-math';

const stop = (over: Partial<FieldStop> & { id: string; businessId: string }): FieldStop => ({
  name: 'Ridgeline Strength', category: 'gym', town: 'Naperville', lat: 0, lng: 0,
  arrived: '09:00', left: '09:20', spokeWith: 'Sam', staffOnShift: 3,
  boxes: 1, coffees: 6, cards: 6, display: false, outcome: 'joined', note: '', photo: null,
  crossRef: { theirClients: '', yourServices: [], score: 0 }, ...over,
});

const log = (over: Partial<FieldLog> = {}): FieldLog => ({
  clinic: { label: '100 Main St', lat: 0, lng: 0 },
  drivers: [{ id: 'd1', name: 'Alexis', photo: '', homeBase: '', since: '2026-01', vehicle: '', languages: [], bio: '' }],
  routes: [], signups: [], ...over,
});

const campaign = (over: Partial<Campaign> = {}): Campaign => ({
  id: 'c1', name: 'October 2026', period: '',
  locations: [{ id: 'ridgeline', name: 'Ridgeline Strength', area: 'Oak Brook', dropDate: '2026-10-06', flyers: 100 }],
  leads: [], ...over,
});

const find = (rows: ReturnType<typeof measures>, key: string) => rows.find(r => r.key === key)!;

test('a measure with no rows reads not-recorded, which is not zero', () => {
  const rows = measures(null, []);
  for (const row of rows) assert.equal(row.recorded, false, `${row.key} must not claim to be recorded`);
  assert.equal(find(rows, 'scans').value, 0, 'the value is still zero underneath');
  assert.equal(find(rows, 'scans').recorded, false, 'but the screen must be able to say so differently');
});

test('a scan is never counted as an appointment', () => {
  const l = log({
    routes: [{ id: 'r1', date: '2026-10-06', start: '09:00', driverId: 'd1', status: 'done', stops: [stop({ id: 's1', businessId: 'b1' })] }],
    signups: [
      { id: 'u1', firstName: 'A', routeId: 'r1', stopId: 's1', date: '2026-10-08', service: 'Cleaning', status: 'new' },
      { id: 'u2', firstName: 'B', routeId: 'r1', stopId: 's1', date: '2026-10-09', service: 'Cleaning', status: 'called' },
      { id: 'u3', firstName: 'C', routeId: 'r1', stopId: 's1', date: '2026-10-10', service: 'Cleaning', status: 'booked' },
    ],
  });
  const rows = measures(l, []);
  assert.equal(find(rows, 'scans').value, 3);
  assert.equal(find(rows, 'appointments').value, 1, 'only the one the practice marked booked');
});

test('a scheduled round contributes no visits and no materials', () => {
  const l = log({ routes: [
    { id: 'r1', date: '2026-10-06', start: '09:00', driverId: 'd1', status: 'done', stops: [stop({ id: 's1', businessId: 'b1', cards: 6, boxes: 1 })] },
    { id: 'r2', date: '2026-10-28', start: '09:00', driverId: 'd1', status: 'scheduled', stops: [stop({ id: 's2', businessId: 'b2', cards: 99, boxes: 9 })] },
  ] });
  const rows = measures(l, []);
  assert.equal(find(rows, 'visits').value, 1);
  assert.equal(find(rows, 'materials').value, 7, 'the planned round’s materials have not been handed to anyone');
});

test('materials counts what was handed over', () => {
  const rows = measures(null, [campaign()]);
  assert.equal(find(rows, 'materials').value, 100);
});

test('inquiries count only the people who said where they heard of you', () => {
  const rows = measures(null, [campaign({ leads: [
    { id: 'l1', name: 'A', phone: '+16305550100', email: 'a@example.invalid', locationId: 'ridgeline', receivedDate: '2026-10-09', service: 'Cleaning' },
  ] })]);
  assert.equal(find(rows, 'inquiries').value, 1);
});

test('by month keeps the four apart and skips months with nothing in them', () => {
  const l = log({
    routes: [{ id: 'r1', date: '2026-09-02', start: '09:00', driverId: 'd1', status: 'done', stops: [stop({ id: 's1', businessId: 'b1', cards: 4, boxes: 0 })] }],
    signups: [{ id: 'u1', firstName: 'A', routeId: 'r1', stopId: 's1', date: '2026-10-03', service: 'Cleaning', status: 'new' }],
  });
  const rows = byMonth(l, []);
  assert.deepEqual(rows.map(r => r.month), ['2026-09', '2026-10']);
  assert.deepEqual(rows[0], { month: '2026-09', visits: 1, materials: 4, scans: 0, inquiries: 0 });
  assert.deepEqual(rows[1], { month: '2026-10', visits: 0, materials: 0, scans: 1, inquiries: 0 });
});

test('a source appears only because somebody named it', () => {
  const rows = bySource(null, [campaign({
    locations: [
      { id: 'ridgeline', name: 'Ridgeline Strength', area: 'Oak Brook', dropDate: '2026-10-06', flyers: 100 },
      { id: 'quiet', name: 'Quiet Place', area: 'Hinsdale', dropDate: '2026-10-06', flyers: 100 },
    ],
    leads: [{ id: 'l1', name: 'A', phone: '+16305550100', email: 'a@example.invalid', locationId: 'ridgeline', receivedDate: '2026-10-09', service: 'Cleaning' }],
  })]);
  assert.deepEqual(rows.map(r => r.name), ['Ridgeline Strength'], 'a business nobody named is not listed with a zero');
});

test('activity labels every row with which kind of thing it is', () => {
  const l = log({
    routes: [{ id: 'r1', date: '2026-10-06', start: '09:00', driverId: 'd1', status: 'done', stops: [stop({ id: 's1', businessId: 'b1', cards: 6, boxes: 1 })] }],
    signups: [{ id: 'u1', firstName: 'A', routeId: 'r1', stopId: 's1', date: '2026-10-09', service: 'Cleaning', status: 'new' }],
  });
  const kinds = activity(l).map(row => row.kind).sort();
  assert.deepEqual(kinds, ['materials', 'scan', 'visit']);
  assert.equal(activity(null).length, 0);
});

test('a month of scans does not push every visit out of the activity feed', () => {
  const stops = Array.from({ length: 4 }, (_, n) => stop({ id: `s${n}`, businessId: `b${n}`, name: `Business ${n}`, cards: 2, boxes: 0 }));
  const l = log({
    routes: [{ id: 'r1', date: '2026-10-01', start: '09:00', driverId: 'd1', status: 'done', stops }],
    signups: Array.from({ length: 40 }, (_, n) => ({ id: `u${n}`, firstName: 'A', routeId: 'r1', stopId: 's0', date: '2026-10-24', service: 'Cleaning', status: 'new' as const })),
  });
  const kinds = new Set(activity(l, 12).map(row => row.kind));
  assert.ok(kinds.has('visit'), 'visits must survive a busy month of scans');
  assert.ok(kinds.has('scan'));
  assert.ok(kinds.has('materials'));
  assert.equal(activity(l, 12).length, 12);
});
