// THE AGENDA'S ARITHMETIC — the plan for one booked round.
//
// Nothing in the field log says when a staff member is due anywhere. It records when they
// arrived and when they left, afterwards. So an agenda for a round that has not happened has
// to be worked out, and the whole risk of this file is dressing a guess up as a schedule.
//
// Two rules hold it honest:
//
//   1. Every estimate is derived from the practice's own completed visits where there are any.
//      A stop is as long as their stops have actually been, not as long as we assume.
//   2. Every estimate is labelled as one and is editable. `basis` says where each number came
//      from so the screen can tell the person, rather than printing a time that looks measured.
//
// What the data cannot give us is recorded in MISSING at the foot of this file.
import type { FieldLog, FieldRoute, FieldStop } from '../../data/field-data';
import { minutesBetween } from './field-math';

/** Assumptions a person can change. Minutes, and miles per hour. */
export type Assumptions = { visitMinutes: number; mph: number; roadFactor: number };

export const DEFAULTS: Assumptions = {
  visitMinutes: 20,
  mph: 24,         // suburban driving with parking, not motorway speed
  roadFactor: 1.3, // roads are longer than the straight line between two points
};

export type Basis = 'their-own-visits' | 'default';

const median = (values: number[]) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
};

/**
 * How long a stop takes this practice, from its own completed visits. The median rather than
 * the mean: one stop where somebody forgot to log leaving would drag an average anywhere.
 */
export function typicalVisit(log: FieldLog | null): { minutes: number; basis: Basis; from: number } {
  const lengths = (log?.routes ?? [])
    .filter(route => route.status === 'done')
    .flatMap(route => route.stops)
    .map(stop => minutesBetween(stop.arrived, stop.left))
    .filter(minutes => minutes > 0 && minutes < 240);
  const m = median(lengths);
  return m === null
    ? { minutes: DEFAULTS.visitMinutes, basis: 'default', from: 0 }
    : { minutes: m, basis: 'their-own-visits', from: lengths.length };
}

/** Straight-line miles between two points. */
export function milesBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 3958.8, toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Minutes to drive between two points. Straight-line distance stretched by a road factor, at a
 * suburban speed. It is not a routed drive time and the screen must not imply it is.
 */
export const driveMinutes = (a: { lat: number; lng: number }, b: { lat: number; lng: number }, as: Assumptions) =>
  Math.max(1, Math.round(((milesBetween(a, b) * as.roadFactor) / as.mph) * 60));

const toMinutes = (clock: string) => {
  const [h, m] = clock.split(':').map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : 9 * 60;
};
export const clockOf = (minutes: number) => {
  const wrapped = ((minutes % 1440) + 1440) % 1440;
  const h = Math.floor(wrapped / 60), m = wrapped % 60;
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};

export type StopStatus = 'completed' | 'in-progress' | 'upcoming';

export type AgendaStop = {
  stop: FieldStop;
  index: number;
  /** Minutes from midnight. Planned where the round has not happened; actual where it has. */
  arriveAt: number;
  leaveAt: number;
  driveFromPrevious: number;
  visitLength: number;
  /** True when these times came from the log rather than from the estimate. */
  measured: boolean;
  status: StopStatus;
};

export type Agenda = {
  route: FieldRoute;
  stops: AgendaStop[];
  startsAt: number;
  endsAt: number;
  totalMinutes: number;
  drivingMinutes: number;
  visitingMinutes: number;
  /** Where the visit length came from, so the screen can say so. */
  visit: ReturnType<typeof typicalVisit>;
  estimated: boolean;
};

/**
 * The plan for one round. For a completed round this is mostly the log read back; for a booked
 * one it is built from the practice's own typical visit and the distance between stops.
 *
 * `nowMinutes` is only used to mark a stop in progress, and only on the day itself.
 */
export function agenda(
  log: FieldLog,
  route: FieldRoute,
  options: { assumptions?: Partial<Assumptions>; today?: string; nowMinutes?: number } = {},
): Agenda {
  const as = { ...DEFAULTS, ...options.assumptions };
  const visit = typicalVisit(log);
  const base = options.assumptions?.visitMinutes ?? visit.minutes;

  let cursor = toMinutes(route.start);
  let from: { lat: number; lng: number } = log.clinic;
  let driving = 0, visiting = 0;
  const isToday = options.today === route.date;

  const stops = route.stops.map((stop, index) => {
    const drive = driveMinutes(from, stop, as);
    const actualArrive = stop.arrived ? toMinutes(stop.arrived) : null;
    const actualLength = minutesBetween(stop.arrived, stop.left);
    const measured = actualArrive !== null && actualLength > 0;

    const arriveAt = measured ? actualArrive! : cursor + drive;
    const visitLength = measured ? actualLength : base;
    const leaveAt = arriveAt + visitLength;

    driving += drive;
    visiting += visitLength;
    cursor = leaveAt;
    from = stop;

    const status: StopStatus =
      stop.outcome !== 'pending' && route.status === 'done' ? 'completed'
      : isToday && options.nowMinutes !== undefined && options.nowMinutes >= arriveAt && options.nowMinutes < leaveAt ? 'in-progress'
      : 'upcoming';

    return { stop, index, arriveAt, leaveAt, driveFromPrevious: drive, visitLength, measured, status };
  });

  const startsAt = toMinutes(route.start);
  const endsAt = stops.length ? stops[stops.length - 1].leaveAt : startsAt;
  return {
    route, stops, startsAt, endsAt,
    totalMinutes: Math.max(0, endsAt - startsAt),
    drivingMinutes: driving,
    visitingMinutes: visiting,
    visit,
    estimated: stops.some(s => !s.measured),
  };
}

export const durationLabel = (minutes: number) => {
  const h = Math.floor(minutes / 60), m = minutes % 60;
  if (!h) return `${m} min`;
  return m ? `${h} hr ${m} min` : `${h} hr`;
};

/**
 * WHAT THE DATA CANNOT GIVE US. Shown on screen rather than filled in with something invented.
 *
 * - **A street address per stop.** The log holds a name, a town and coordinates. The agenda can
 *   map and route to a stop, but it cannot print the address a person would read out.
 * - **The task at a stop.** Nothing records what this particular visit is for. Every stop is
 *   treated the same, and a planned task would need a new field on the stop.
 * - **A routed drive time.** There is no Directions call, so drive times are straight-line
 *   distance stretched by a road factor. Good enough to plan a morning, not a promise.
 * - **A planned arrival time.** The log records arrival after the fact. Times on a booked round
 *   are this file's arithmetic, never something somebody committed to.
 */
export const MISSING = ['stop.address', 'stop.plannedTask', 'routed drive times', 'stop.plannedArrival'] as const;
