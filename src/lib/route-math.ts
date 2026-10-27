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
 * Minutes allowed for a leg we cannot measure — a pickup, or a business with no usable
 * coordinate. Suburban hop with parking. It is an allowance and every screen that shows it
 * says so.
 */
export const TRAVEL_ALLOWANCE = 8;

/**
 * HOW LONG A COORDINATE MAY BE USED. Google's terms let a place id be kept indefinitely and a
 * coordinate for thirty days, which is the rule the network cache already follows. A stop whose
 * coordinates are older than that is treated as having none: it still routes by street address,
 * and its leg becomes an allowance rather than a measurement from a figure we may no longer
 * hold. `geoAt` is null for a coordinate that came from the practice's own release file rather
 * than from Google, and those do not expire.
 */
export const COORDINATE_DAYS = 30;
const COORDINATE_LIFETIME = COORDINATE_DAYS * 24 * 60 * 60 * 1000;

/** Where a business is, if we may still say. */
export function positionOf(business: { lat: number | null; lng: number | null; geoAt: number | null },
  at = Date.now()): { lat: number; lng: number } | null {
  if (business.lat === null || business.lng === null) return null;
  if (business.geoAt !== null && at - business.geoAt > COORDINATE_LIFETIME) return null;
  return { lat: business.lat, lng: business.lng };
}

/**
 * THE TIME OF DAY WHERE THE PRACTICE IS, in minutes from midnight. A runner's phone may be set
 * to another zone — or simply be wrong — and "you should be here now" read off the wrong clock
 * is worse than no mark at all.
 */
export function minutesNowIn(timeZone: string, at = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone, hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(at);
    const hour = Number(parts.find(p => p.type === 'hour')?.value ?? NaN);
    const minute = Number(parts.find(p => p.type === 'minute')?.value ?? NaN);
    return Number.isFinite(hour) && Number.isFinite(minute) ? (hour % 24) * 60 + minute : null;
  } catch {
    // A zone this runtime does not know. No mark on the itinerary beats a mark in the wrong
    // place, so the caller gets nothing rather than the device's own clock.
    return null;
  }
}

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
  /** How this stop came to be done: recorded against this round, or matched to it afterwards. */
  attribution: Attribution['basis'] | null;
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

/**
 * WHICH ROUND EACH VISIT BELONGS TO.
 *
 * A visit recorded from the planner names its round, so it belongs to that one and to no other:
 * the same business can sit on a round this week and a follow-up round next week, and a
 * conversation at one is not progress on the other.
 *
 * A visit with no round on it was recorded before the planner could say which — or away from a
 * round altogether. Those are attributed to the LAST round on or before the day they happened
 * that had that business on it, which is the only round that could have produced them. Before
 * this, any visit on or after a round's date counted toward it, so one conversation next Friday
 * marked this Tuesday's round complete as well.
 */
export type Attribution = {
  roundId: string;
  /**
   * `recorded` — the visit itself names this round, because the planner said so at the time.
   * `inferred` — nobody said. It is the round this visit most likely belongs to, and a screen
   * showing it as progress has to say that it was matched rather than recorded.
   */
  basis: 'recorded' | 'inferred';
};

export function attributeVisits(
  rounds: Array<{ id: string; date: string; items: RunnerItem[] }>,
  visits: Visit[],
): Map<string, Attribution> {
  const known = new Set(rounds.map(r => r.id));
  const byBusiness = new Map<string, Array<{ id: string; date: string }>>();
  for (const round of rounds) {
    for (const item of round.items) {
      if (item.kind !== 'business') continue;
      const list = byBusiness.get(item.business.id) ?? [];
      list.push({ id: round.id, date: round.date });
      byBusiness.set(item.business.id, list);
    }
  }
  for (const list of byBusiness.values()) list.sort((a, b) => a.date.localeCompare(b.date));

  const attributed = new Map<string, Attribution>();
  for (const visit of visits) {
    if (visit.roundId) {
      if (known.has(visit.roundId)) attributed.set(visit.id, { roundId: visit.roundId, basis: 'recorded' });
      continue; // a visit that names a round we are not showing belongs to that one, not to these
    }
    const candidates = (byBusiness.get(visit.businessId) ?? []).filter(r => r.date <= visit.visitedOn);
    const latest = candidates.at(-1);
    // A GUESS, AND MARKED AS ONE. The record itself is not touched: `visits.round_id` stays
    // null, nothing is written back, and the screen says the visit was matched to this round
    // rather than recorded on it. Two rounds that could both explain one conversation is a
    // question for a person, not something to settle quietly in a map.
    if (latest) attributed.set(visit.id, { roundId: latest.id, basis: 'inferred' });
  }
  return attributed;
}

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
    /** Which round each visit belongs to, from `attributeVisits`. */
    attributed?: Map<string, Attribution>;
    /** Now, for judging how old a coordinate is. Only tests pass it. */
    now?: number;
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

  // A visit counts toward THIS round and no other. `attributeVisits` decides which round each
  // one belongs to; without that map — a caller laying out a single round in isolation — the
  // older rule applies, where a visit on or after the round's date counts toward it.
  const onThisRound = new Map<string, { visit: Visit; basis: Attribution['basis'] }>();
  for (const visit of [...visits].sort((a, b) => a.visitedOn.localeCompare(b.visitedOn))) {
    let basis: Attribution['basis'] = 'recorded';
    if (options.attributed) {
      const where = options.attributed.get(visit.id);
      if (where?.roundId !== round.id) continue;
      basis = where.basis;
    } else if (visit.visitedOn < round.date) continue;
    if (!onThisRound.has(visit.businessId)) onThisRound.set(visit.businessId, { visit, basis });
  }

  const warnings: string[] = [];
  const unlocated: string[] = [];
  const isToday = options.today === round.date;

  let cursor = startsAt;
  let from: Where = options.clinic ?? null;
  let travelTotal = 0, onSite = 0, waitTotal = 0;

  const items = round.items.map((item, index) => {
    // A pickup has an address and no coordinate, so it cannot be placed on a map. What matters
    // is that the NEXT leg starts from here all the same: measuring the leg after a pickup from
    // the business before it would quietly pretend the pickup was not driven to.
    const here: Where = item.kind === 'business' ? positionOf(item.business, options.now ?? Date.now()) : null;
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
    const found = item.kind === 'business' ? onThisRound.get(item.business.id) ?? null : null;
    const visit = found?.visit ?? null;
    const done = item.kind === 'business' ? visit !== null : item.pickup.status === 'collected';

    travelTotal += travel; onSite += minutes; waitTotal += wait;
    cursor = departAt;
    // Always the stop we have just left, known or not. Where it is not known the next leg is an
    // allowance too, which is the honest answer: we cannot measure from a place we cannot place.
    from = here;

    const status: PlannedItem['status'] = done ? 'completed'
      : isToday && options.nowMinutes !== undefined && options.nowMinutes >= arriveAt && options.nowMinutes < departAt
        ? 'in-progress' : 'upcoming';

    return { item, index, arriveAt, departAt, travel, measured, wait, late, minutes, done, visit,
      attribution: found?.basis ?? null, status };
  });

  if (opening.closed) {
    warnings.push(`This route is booked on a day the practice is closed, so nothing holds its start time.`);
  }
  if (unlocated.length) {
    warnings.push(`${unlocated.join(', ')} ${unlocated.length === 1 ? 'has' : 'have'} no map position we can use, so ${unlocated.length === 1 ? 'its' : 'their'} travel time is an allowance rather than an estimate from the distance.`);
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
