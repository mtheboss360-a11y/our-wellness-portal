// THE PLAN FOR ONE RUNNER'S DAY: the stops in the order they are in, when they are due at each
// one, and what cannot be made to work.
//
// It is the round arithmetic that already exists (`agenda-math.ts` — the clock, the practice's
// opening hours, the straight-line drive estimate) extended with the two things a route runner
// has that nobody else did: PICKUPS, which have a window that can be missed or waited for, and
// stops with no coordinate, which cannot be given a drive estimate at all.
//
// The whole risk of this file is dressing arithmetic up as a schedule. Three rules hold it:
//
//   1. A leg between two known coordinates is estimated from the distance. Anything else — a
//      pickup, a business with no map position — gets a flat TRAVEL ALLOWANCE and is labelled
//      an allowance, never a drive time.
//   2. Nothing here is a routed journey. There is no Directions call anywhere in this portal, so
//      no number from this file may be presented as road navigation.
//   3. Where a window cannot be met the plan says so out loud rather than quietly arriving late.
import type { RunnerItem, Supplies } from '../../server/runner';
import type { Visit } from '../../server/outreach';
import { DEFAULTS, OPENS, driveMinutes, weekdayOf, type Assumptions, type OpeningHours } from './agenda-math';

export { clockOf, durationLabel, WEEKDAY } from './agenda-math';

/**
 * Minutes allowed for a leg we cannot measure — a pickup, or a business with no coordinate.
 * Suburban hop with parking. It is an allowance and every screen that shows it says so.
 */
export const TRAVEL_ALLOWANCE = 8;

/** How long a pickup takes when the runner did not say. Their own figure is used where given. */
export const PICKUP_MINUTES = 10;

export type Where = { lat: number; lng: number } | null;

export type PlannedItem = {
  item: RunnerItem;
  index: number;
  /** Minutes from midnight. */
  arriveAt: number;
  departAt: number;
  /** Minutes allowed to get here from the stop before it. */
  travel: number;
  /** True when that travel came from two real coordinates rather than from the allowance. */
  measured: boolean;
  /** Minutes stood waiting for a pickup window to open. */
  wait: number;
  /** Minutes past the end of a pickup window. Anything above zero is a warning. */
  late: number;
  minutes: number;
  done: boolean;
  visit: Visit | null;
  status: 'completed' | 'in-progress' | 'upcoming';
};

export type RoutePlan = {
  items: PlannedItem[];
  startsAt: number;
  endsAt: number;
  totalMinutes: number;
  travelMinutes: number;
  onSiteMinutes: number;
  waitMinutes: number;
  completed: number;
  /** The first thing not finished: where the runner should be going now. */
  next: PlannedItem | null;
  opening: { weekday: number; opens: string | null; closed: boolean; heldBack: boolean };
  /** What cannot be made to work, in the runner's own words. */
  warnings: string[];
  /** Stops with no map position, named, so a screen can say which times it could not work out. */
  unlocated: string[];
};

const toMinutes = (clock: string) => {
  const [h, m] = clock.split(':').map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : 9 * 60;
};

export const itemName = (item: RunnerItem) =>
  item.kind === 'business' ? item.business.name : item.pickup.title;
export const itemAddress = (item: RunnerItem) =>
  item.kind === 'business' ? item.business.address : item.pickup.address;

/** A whole-day total of what has been recorded as dropped, by kind. */
export const sumSupplies = (values: Supplies[]): Supplies => values.reduce((total, value) => ({
  flyers: total.flyers + value.flyers, treats: total.treats + value.treats, cards: total.cards + value.cards,
}), { flyers: 0, treats: 0, cards: 0 });

/**
 * Lay out one route. `visits` is this practice's recorded visits; a business with one recorded
 * on the round's date or after it is done, and a collected pickup is done.
 *
 * `nowMinutes` only marks where somebody should be, and only on the day itself.
 */
export function planRoute(
  round: { id: string; date: string; start: string; items: RunnerItem[] },
  visits: Visit[],
  options: {
    clinic?: Where; today?: string; nowMinutes?: number;
    assumptions?: Partial<Assumptions>; hours?: OpeningHours; allowance?: number;
  } = {},
): RoutePlan {
  const as = { ...DEFAULTS, ...options.assumptions };
  const allowance = options.allowance ?? TRAVEL_ALLOWANCE;
  const hours = options.hours ?? OPENS;
  const weekday = weekdayOf(round.date);
  const opens = hours[weekday] ?? null;
  const booked = toMinutes(round.start);
  const startsAt = opens === null ? booked : Math.max(booked, toMinutes(opens));
  const opening = { weekday, opens, closed: opens === null, heldBack: opens !== null && startsAt > booked };

  // A visit counts toward this round if it was recorded on its date or after — a round run a day
  // late still shows its progress. Anything recorded before the round was booked is history.
  const onThisRound = new Map<string, Visit>();
  for (const visit of [...visits].sort((a, b) => a.visitedOn.localeCompare(b.visitedOn))) {
    if (visit.visitedOn < round.date) continue;
    if (!onThisRound.has(visit.businessId)) onThisRound.set(visit.businessId, visit);
  }

  const warnings: string[] = [];
  const unlocated: string[] = [];
  const isToday = options.today === round.date;

  let cursor = startsAt;
  let from: Where = options.clinic ?? null;
  let travelTotal = 0, onSite = 0, waitTotal = 0;

  const items = round.items.map((item, index) => {
    const here: Where = item.kind === 'business' && item.business.lat !== null && item.business.lng !== null
      ? { lat: item.business.lat, lng: item.business.lng } : null;
    if (item.kind === 'business' && !here) unlocated.push(item.business.name);

    const measured = !!(here && from);
    const travel = measured ? driveMinutes(from!, here!, as) : allowance;
    let arriveAt = cursor + travel;
    let wait = 0, late = 0;

    if (item.kind === 'pickup') {
      const from_ = toMinutes(item.pickup.windowStart), to = toMinutes(item.pickup.windowEnd);
      if (arriveAt < from_) { wait = from_ - arriveAt; arriveAt = from_; }
      if (arriveAt > to) {
        late = arriveAt - to;
        warnings.push(`${item.pickup.title} closes at ${item.pickup.windowEnd} and this order reaches it about ${late} minutes later. Move it earlier in the day.`);
      }
    }

    const minutes = item.kind === 'business' ? as.visitMinutes : (item.pickup.minutes || PICKUP_MINUTES);
    const departAt = arriveAt + minutes;
    const visit = item.kind === 'business' ? onThisRound.get(item.business.id) ?? null : null;
    const done = item.kind === 'business' ? visit !== null : item.pickup.status === 'collected';

    travelTotal += travel; onSite += minutes; waitTotal += wait;
    cursor = departAt;
    if (here) from = here;

    const status: PlannedItem['status'] = done ? 'completed'
      : isToday && options.nowMinutes !== undefined && options.nowMinutes >= arriveAt && options.nowMinutes < departAt
        ? 'in-progress' : 'upcoming';

    return { item, index, arriveAt, departAt, travel, measured, wait, late, minutes, done, visit, status };
  });

  if (opening.closed) {
    warnings.push(`This route is booked on a day the practice is closed, so nothing holds its start time.`);
  }
  if (unlocated.length) {
    warnings.push(`${unlocated.join(', ')} ${unlocated.length === 1 ? 'has' : 'have'} no map position, so ${unlocated.length === 1 ? 'its' : 'their'} travel time is an allowance rather than an estimate from the distance.`);
  }

  const endsAt = items.length ? items[items.length - 1].departAt : startsAt;
  return {
    items, startsAt, endsAt,
    totalMinutes: Math.max(0, endsAt - startsAt),
    travelMinutes: travelTotal, onSiteMinutes: onSite, waitMinutes: waitTotal,
    completed: items.filter(i => i.done).length,
    next: items.find(i => !i.done) ?? null,
    opening, warnings, unlocated,
  };
}

/**
 * MOVE one item to a new place in the order, as a drag or a Move up / Move down does.
 * Returns the new order of refs, or null where the move is not allowed: a finished stop and a
 * stop the office has fixed in place both stay where they are.
 */
export function moveItem(items: RunnerItem[], done: Set<string>, fromId: string, toIndex: number) {
  const key = (item: RunnerItem) => `${item.kind}:${item.id}`;
  const at = items.findIndex(item => key(item) === fromId);
  if (at < 0 || toIndex < 0 || toIndex >= items.length || at === toIndex) return null;
  const blocked = (item: RunnerItem) => item.locked || done.has(key(item));
  if (blocked(items[at]) || blocked(items[toIndex])) return null;
  const next = [...items];
  const [moved] = next.splice(at, 1);
  next.splice(toIndex, 0, moved);
  // A move that would carry a fixed or finished stop out of its place is not a move we make.
  for (let index = 0; index < items.length; index++) {
    if (items[index].locked && key(next[index]) !== key(items[index])) return null;
  }
  const order = items.filter(item => done.has(key(item))).map(key);
  if (order.join('|') !== next.filter(item => done.has(key(item))).map(key).join('|')) return null;
  return next;
}

/** The weekday, month and day of an ISO date, read at local noon so no zone can shift it. */
export const longDate = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1, 12)
    .toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
};
export const shortDate = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1, 12)
    .toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
};
/** The Monday of the week an ISO date falls in. */
export const mondayOf = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(y, (m || 1) - 1, d || 1, 12);
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return isoOf(date);
};
export const addDays = (iso: string, days: number) => {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(y, (m || 1) - 1, d || 1, 12);
  date.setDate(date.getDate() + days);
  return isoOf(date);
};
export const isoOf = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
export const weekLabel = (monday: string) => {
  const end = addDays(monday, 6);
  const [, m1, d1] = monday.split('-').map(Number);
  const [, m2, d2] = end.split('-').map(Number);
  const month = (n: number) => ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][n - 1];
  return m1 === m2 ? `${month(m1)} ${d1}–${d2}` : `${month(m1)} ${d1} – ${month(m2)} ${d2}`;
};
