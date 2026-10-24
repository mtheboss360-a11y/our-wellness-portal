// Pure calculations for Drivers & routes. Every figure is a count of field-log rows — stops a
// driver logged, cards they wrote down, sign-ups the staff form received, bookings the clinic
// marked — so each number on screen can be traced back to a line in the Google Form sheet.
import type { Driver, FieldLog, FieldRoute, FieldStop } from '../../data/field-data';

export type Tally = { routes: number; stops: number; staff: number; cards: number; boxes: number; coffees: number; joined: number; signups: number; booked: number; minutes: number };
const empty = (): Tally => ({ routes: 0, stops: 0, staff: 0, cards: 0, boxes: 0, coffees: 0, joined: 0, signups: 0, booked: 0, minutes: 0 });
export const minutesBetween = (from: string | null, to: string | null) => {
  if (!from || !to) return 0;
  const [a, b] = [from, to].map(v => Number(v.slice(0, 2)) * 60 + Number(v.slice(3)));
  return Math.max(0, b - a);
};

/** Totals for a set of routes. Scheduled routes count toward nothing: no one has driven them yet. */
export function tally(log: FieldLog, routes: FieldRoute[] = log.routes): Tally {
  const done = routes.filter(r => r.status === 'done');
  const ids = new Set(done.map(r => r.id));
  const t = empty();
  t.routes = done.length;
  for (const stop of done.flatMap(r => r.stops)) {
    t.stops++; t.staff += stop.staffOnShift; t.cards += stop.cards; t.boxes += stop.boxes; t.coffees += stop.coffees;
    t.joined += stop.outcome === 'joined' ? 1 : 0; t.minutes += minutesBetween(stop.arrived, stop.left);
  }
  const signups = log.signups.filter(s => ids.has(s.routeId));
  t.signups = signups.length; t.booked = signups.filter(s => s.status === 'booked').length;
  return t;
}

export const signupsAt = (log: FieldLog, stop: FieldStop) => log.signups.filter(s => s.stopId === stop.id);
export const driverOf = (log: FieldLog, route: FieldRoute) => log.drivers.find(d => d.id === route.driverId) ?? null;
export const routesBy = (log: FieldLog, driver: Driver) => log.routes.filter(r => r.driverId === driver.id);

/** The next scheduled route on or after today, and the most recent one driven. */
export function nextAndLast(log: FieldLog, today: string) {
  const sorted = [...log.routes].sort((a, b) => a.date.localeCompare(b.date));
  return {
    next: sorted.find(r => r.status === 'scheduled' && r.date >= today) ?? null,
    last: [...sorted].reverse().find(r => r.status === 'done') ?? null,
  };
}

/** Drivers who have driven or are booked to drive this clinic's routes, most routes first. */
export function yourDrivers(log: FieldLog) {
  const counts = new Map<string, number>();
  log.routes.forEach(r => counts.set(r.driverId, (counts.get(r.driverId) ?? 0) + 1));
  const on = log.drivers.filter(d => counts.has(d.id)).sort((a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0) || a.name.localeCompare(b.name));
  return { on, area: log.drivers.filter(d => !counts.has(d.id)) };
}

/** Distinct partner businesses, with how many times they were visited and the latest outcome. */
export function partners(log: FieldLog) {
  const map = new Map<string, { stop: FieldStop; visits: number; signups: number; booked: number; last: string }>();
  for (const route of [...log.routes].filter(r => r.status === 'done').sort((a, b) => a.date.localeCompare(b.date))) for (const stop of route.stops) {
    const s = signupsAt(log, stop);
    const prior = map.get(stop.businessId);
    map.set(stop.businessId, { stop, visits: (prior?.visits ?? 0) + 1, signups: (prior?.signups ?? 0) + s.length, booked: (prior?.booked ?? 0) + s.filter(x => x.status === 'booked').length, last: route.date });
  }
  return [...map.values()].sort((a, b) => b.signups - a.signups || a.stop.name.localeCompare(b.stop.name));
}

/**
 * Where each stop sits inside the orb, as -1..1 offsets from the clinic.
 *
 * The stops go around the clinic in their real compass order, then are spaced evenly around
 * the ring — a real route usually leans to one side of town, and drawn to scale it would pile
 * every stop into one corner of the orb. Nearer stops sit closer in (0.42–0.84 of the radius),
 * and consecutive stops alternate slightly in and out so ten never form a flat circle. It is a
 * diagram of the route, not a scale map, and the screen says so.
 */
export function orbLayout(clinic: { lat: number; lng: number }, stops: FieldStop[]) {
  const k = Math.cos(clinic.lat * Math.PI / 180);
  const raw = stops.map((stop, index) => {
    const dx = (stop.lng - clinic.lng) * k, dy = -(stop.lat - clinic.lat);
    return { stop, index, bearing: Math.atan2(dy, dx), dist: Math.hypot(dx, dy) };
  });
  const far = Math.max(1e-6, ...raw.map(p => p.dist));
  const near = Math.min(...raw.map(p => p.dist));
  const byBearing = [...raw].sort((a, b) => a.bearing - b.bearing);
  const step = (Math.PI * 2) / Math.max(1, raw.length);
  const offset = byBearing.length ? byBearing[0].bearing : 0;
  const placed = new Map(byBearing.map((p, rank) => {
    const angle = offset + rank * step;
    const depth = far - near < 1e-6 ? 0.5 : (p.dist - near) / (far - near);
    const r = 0.46 + 0.32 * Math.sqrt(depth) + (rank % 2 ? 0.05 : -0.03);
    return [p.index, { x: Math.cos(angle) * r, y: Math.sin(angle) * r }];
  }));
  return raw.map(p => ({ stop: p.stop, ...placed.get(p.index)! }));
}

export const OUTCOME_LABEL: Record<FieldStop['outcome'], string> = { joined: 'Joined the network', 'follow-up': 'Follow-up booked', 'not-now': 'Not right now', pending: 'Scheduled' };
export const CATEGORY_LABEL: Record<FieldStop['category'], string> = { gym: 'Gym', yoga: 'Yoga studio', pilates: 'Pilates & barre', salon: 'Hair salon', nails: 'Nail salon', boutique: 'Boutique', physio: 'Physical therapy', cycle: 'Cycling studio', other: 'Local business' };
export const dayLabel = (value: string) => new Date(`${value}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
export const timeLabel = (value: string | null) => {
  if (!value) return '';
  const h = Number(value.slice(0, 2)), m = value.slice(3);
  return `${h % 12 || 12}:${m} ${h < 12 ? 'AM' : 'PM'}`;
};
export const monthsSince = (since: string, today: string) => Math.max(0, (Number(today.slice(0, 4)) - Number(since.slice(0, 4))) * 12 + Number(today.slice(5, 7)) - Number(since.slice(5, 7)));
