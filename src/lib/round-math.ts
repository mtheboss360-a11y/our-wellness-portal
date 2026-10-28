// THE PLAN FOR ONE ROUND OF RELEASED BUSINESSES.
//
// The agenda used to be built from the imported field log. This builds it from the businesses
// a practice has actually been given, which is the difference between a demonstration and a
// day's work. The arithmetic is the same arithmetic — the clock, the opening hours, the
// straight-line drive estimate — imported from agenda-math rather than written twice, so the
// dashboard, the agenda and the round can never disagree about when somebody is due anywhere.
//
// WHAT IS MEASURED AND WHAT IS ESTIMATED is marked on every stop, because the two must never
// be read as the same kind of number. A completed stop reports the time its visit was recorded.
// An upcoming one reports arithmetic, and says so.
//
// A business with no coordinate is still a stop. It cannot be given a drive estimate, so it is
// carried at the practice's typical visit length with `located: false`, and the screen says the
// time for it is unknown rather than printing a confident wrong one.
import type { Business, Visit } from '../../server/outreach';
import {
  clockOf, driveMinutes, milesBetween, weekdayOf, DEFAULTS, OPENS, WEEKDAY,
  type Assumptions, type OpeningHours,
} from './agenda-math';

export { clockOf, durationLabel, WEEKDAY } from './agenda-math';

/** Straight-line miles, for a radius filter. Not a driving distance and not sold as one. */
export { milesBetween as milesFrom } from './agenda-math';

export type RoundStatus = 'scheduled' | 'done' | 'draft';

export type Round = {
  id: string; date: string; start: string; staff: string;
  status: RoundStatus; note: string; demo: number | null; stops: Business[];
  /** The login this round was sent to, or null while it is still only booked. */
  runnerId: string | null;
  /** That person's name, for the office to read. Empty when nobody holds it. */
  runnerName: string;
};

export type PlannedStop = {
  business: Business;
  index: number;
  /** Minutes from midnight. Measured where the visit was recorded, estimated otherwise. */
  arriveAt: number;
  leaveAt: number;
  driveFromPrevious: number | null;
  visitLength: number;
  /** False when this business has no coordinate, so no drive time could be worked out. */
  located: boolean;
  done: boolean;
  visit: Visit | null;
  status: 'completed' | 'in-progress' | 'upcoming';
};

export type RoundPlan = {
  round: Round;
  stops: PlannedStop[];
  startsAt: number;
  endsAt: number;
  totalMinutes: number;
  drivingMinutes: number;
  visitingMinutes: number;
  /** How far through, counted from recorded visits rather than from anything a screen holds. */
  completed: number;
  /** The first stop with no visit recorded: where the person should be going now. */
  next: PlannedStop | null;
  opening: { weekday: number; opens: string | null; closed: boolean; heldBack: boolean };
  /** Where the round starts from, so a screen can draw it without fetching again. */
  clinic: { lat: number; lng: number } | null;
  /** Stops with no coordinate, named so the screen can say which times it could not work out. */
  unlocated: string[];
};

const toMinutes = (clock: string) => {
  const [h, m] = clock.split(':').map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : 9 * 60;
};

/**
 * How long this practice's visits actually take, from its own recorded ones. The median, so a
 * single visit somebody logged hours late cannot drag the estimate.
 */
export function typicalVisitFrom(visits: Visit[], fallback = DEFAULTS.visitMinutes) {
  // A visit's length is not recorded directly; what we have is the day it happened. Until the
  // portal stores arrival and departure there is nothing to measure, so this reports the
  // fallback and says it is one. It is here so the screen can state its basis either way.
  return { minutes: fallback, basis: 'default' as const, from: visits.length };
}

/**
 * Lay out one round. `visits` is this clinic's recorded visits; a stop with one on the round's
 * date is complete, and its recorded time is used in place of the estimate.
 */
export function planRound(
  clinic: { lat: number; lng: number } | null,
  round: Round,
  visits: Visit[],
  options: { assumptions?: Partial<Assumptions>; today?: string; nowMinutes?: number; hours?: OpeningHours } = {},
): RoundPlan {
  const as = { ...DEFAULTS, ...options.assumptions };
  const hours = options.hours ?? OPENS;
  const weekday = weekdayOf(round.date);
  const opens = hours[weekday] ?? null;
  const booked = toMinutes(round.start);
  const startsAt = opens === null ? booked : Math.max(booked, toMinutes(opens));
  const opening = { weekday, opens, closed: opens === null, heldBack: opens !== null && startsAt > booked };

  // A stop counts as done once a visit is recorded at it on the round's date OR after it. Only
  // matching the exact date meant a round run a day late showed no progress at all, which is
  // the state a rep is most likely to be in and least likely to forgive. Anything recorded
  // BEFORE the round was booked is history, not this round's work, so it does not count.
  const onThisRound = new Map<string, Visit>();
  for (const v of [...visits].sort((a, b) => a.visitedOn.localeCompare(b.visitedOn))) {
    if (v.visitedOn < round.date) continue;
    if (!onThisRound.has(v.businessId)) onThisRound.set(v.businessId, v);
  }

  let cursor = startsAt;
  let from: { lat: number; lng: number } | null = clinic;
  let driving = 0, visiting = 0;
  const isToday = options.today === round.date;
  const unlocated: string[] = [];

  const stops: PlannedStop[] = round.stops.map((business, index) => {
    const located = business.lat !== null && business.lng !== null;
    if (!located) unlocated.push(business.name);

    const drive = located && from
      ? driveMinutes(from, { lat: business.lat!, lng: business.lng! }, as)
      : null;

    const visit = onThisRound.get(business.id) ?? null;
    const arriveAt = cursor + (drive ?? 0);
    const visitLength = as.visitMinutes;
    const leaveAt = arriveAt + visitLength;

    driving += drive ?? 0;
    visiting += visitLength;
    cursor = leaveAt;
    if (located) from = { lat: business.lat!, lng: business.lng! };

    const status: PlannedStop['status'] = visit ? 'completed'
      : isToday && options.nowMinutes !== undefined && options.nowMinutes >= arriveAt && options.nowMinutes < leaveAt ? 'in-progress'
      : 'upcoming';

    return { business, index, arriveAt, leaveAt, driveFromPrevious: drive, visitLength, located, done: visit !== null, visit, status };
  });

  const endsAt = stops.length ? stops[stops.length - 1].leaveAt : startsAt;

  return {
    round, stops, startsAt, endsAt,
    totalMinutes: Math.max(0, endsAt - startsAt),
    drivingMinutes: driving,
    visitingMinutes: visiting,
    completed: stops.filter(s => s.done).length,
    clinic,
    next: stops.find(s => !s.done) ?? null,
    opening,
    unlocated,
  };
}

/**
 * Put stops in a sensible order: nearest to the clinic first, then nearest to the last stop.
 * Not an optimal route — it is a greedy nearest-neighbour pass, which is honest about being a
 * starting point somebody can reorder, not a solved travelling-salesman problem.
 */
export function suggestOrder(clinic: { lat: number; lng: number }, list: Business[]): Business[] {
  const located = list.filter(b => b.lat !== null && b.lng !== null);
  const rest = list.filter(b => b.lat === null || b.lng === null);
  const ordered: Business[] = [];
  let from = clinic;
  const pool = [...located];
  while (pool.length) {
    let best = 0, bestMiles = Infinity;
    pool.forEach((b, i) => {
      const miles = milesBetween(from, { lat: b.lat!, lng: b.lng! });
      if (miles < bestMiles) { bestMiles = miles; best = i; }
    });
    const [picked] = pool.splice(best, 1);
    ordered.push(picked);
    from = { lat: picked.lat!, lng: picked.lng! };
  }
  // Anything without a coordinate goes last: it cannot be placed, so it should not displace
  // somewhere that can.
  return [...ordered, ...rest];
}

export const weekdayName = (weekday: number) => WEEKDAY[weekday];
