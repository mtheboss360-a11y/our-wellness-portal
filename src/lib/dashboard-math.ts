// THE DASHBOARD'S ARITHMETIC. Every figure on the first screen is derived here from rows the
// portal already holds: the field log (what staff recorded) and the network map (what Google
// returned). Nothing is estimated and nothing is carried forward from a previous month.
//
// The separation the product depends on lives in this file. A visit, a piece of material a
// staff member reported leaving, a sign-up from a tap card and an appointment the clinic booked
// are four different counts and are never added together. A recommendation is a business the
// portal suggests; a partner is one a staff member recorded as having agreed. Nothing here
// promotes the first into the second.
import type { FieldLog, FieldRoute, FieldStop } from '../../data/field-data';
import type { MapBusiness, NetworkMapPayload } from './network-math';

export const monthOf = (day: string) => day.slice(0, 7);

export const monthLabel = (day: string) =>
  new Date(`${day.slice(0, 7)}-01T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });

/** Completed stops only: a scheduled route has not happened yet and is never counted as one. */
export const doneStops = (log: FieldLog) =>
  log.routes.filter(route => route.status === 'done').flatMap(route => route.stops);

/**
 * This month, in four counts that stay apart.
 *
 * `materials` is what staff reported handing over, not what a business displayed or gave out:
 * the log records the handover and nothing after it. `signups` is taps on a partner's card,
 * which is a response and not an appointment. `booked` is only those sign-ups the clinic went
 * on to mark booked itself, so an appointment is never inferred from a scan.
 */
export function thisMonth(log: FieldLog | null, today: string) {
  const month = monthOf(today);
  if (!log) return { visits: 0, materials: 0, signups: 0, booked: 0, followUpsDue: 0, hasLog: false };
  const routes = log.routes.filter(route => route.status === 'done' && monthOf(route.date) === month);
  const stops = routes.flatMap(route => route.stops);
  const signups = log.signups.filter(signup => monthOf(signup.date) === month);
  return {
    visits: stops.length,
    materials: stops.reduce((total, stop) => total + stop.cards + stop.boxes, 0),
    signups: signups.length,
    booked: signups.filter(signup => signup.status === 'booked').length,
    followUpsDue: doneStops(log).filter(stop => stop.outcome === 'follow-up').length,
    hasLog: true,
  };
}

/** Businesses a staff member recorded as having agreed to take part. Not recommendations. */
export function participating(log: FieldLog | null) {
  if (!log) return [] as FieldStop[];
  const seen = new Map<string, FieldStop>();
  for (const stop of doneStops(log)) if (stop.outcome === 'joined') seen.set(stop.businessId, stop);
  return [...seen.values()];
}

/** Stops whose outcome asked for another call, newest first. */
export function followUps(log: FieldLog | null) {
  if (!log) return [] as Array<{ stop: FieldStop; route: FieldRoute }>;
  return log.routes
    .filter(route => route.status === 'done')
    .flatMap(route => route.stops.filter(stop => stop.outcome === 'follow-up').map(stop => ({ stop, route })))
    .sort((a, b) => b.route.date.localeCompare(a.route.date));
}

export const nextRoute = (log: FieldLog | null, today: string) =>
  log?.routes.filter(route => route.status === 'scheduled' && route.date >= today).sort((a, b) => a.date.localeCompare(b.date))[0] ?? null;

export type NextAction =
  | { kind: 'route'; route: FieldRoute }
  | { kind: 'request'; request: NetworkMapPayload['requests'][number] }
  | { kind: 'follow-up'; count: number }
  | { kind: 'choose'; count: number }
  | { kind: 'locate' }
  | { kind: 'none' };

/**
 * The single next thing, in the order the work actually happens: a booked route first, then a
 * route the client has asked for, then relationships already owed a second call, then choosing
 * stops. Everything here points at something the client can open; there is no branch that
 * invents work.
 */
export function nextAction(log: FieldLog | null, map: NetworkMapPayload | null, today: string): NextAction {
  const route = nextRoute(log, today);
  if (route) return { kind: 'route', route };
  const pending = map?.requests.find(request => !/declin|cancel/i.test(request.status));
  if (pending) return { kind: 'request', request: pending };
  const due = followUps(log).length;
  if (due) return { kind: 'follow-up', count: due };
  if (map && !map.clinic.location) return { kind: 'locate' };
  const open = map?.businesses.filter(business => business.status === 'fit' && business.routable).length ?? 0;
  if (open) return { kind: 'choose', count: open };
  return { kind: 'none' };
}

/** The businesses worth approaching: a good fit, routable, and not already on the roster. */
export function opportunities(map: NetworkMapPayload | null, limit = 6) {
  if (!map) return [] as MapBusiness[];
  return map.businesses
    .filter(business => business.status === 'fit' && business.routable)
    .sort((a, b) => b.fit.score - a.fit.score)
    .slice(0, limit);
}

export type ActivityItem = {
  id: string;
  on: string;
  kind: 'visit' | 'signup';
  title: string;
  detail: string;
  outcome?: FieldStop['outcome'];
};

/**
 * Visits and sign-ups on one timeline, newest first, each labelled with which it is. They are
 * never merged into a single "activity" number anywhere else in the portal.
 */
export function recentActivity(log: FieldLog | null, limit = 8): ActivityItem[] {
  if (!log) return [];
  const stops = log.routes
    .filter(route => route.status === 'done')
    .flatMap(route => route.stops.map(stop => ({
      id: `stop-${stop.id}`,
      on: route.date,
      kind: 'visit' as const,
      title: stop.name,
      detail: [stop.spokeWith && `Spoke with ${stop.spokeWith}`, stop.cards ? `${stop.cards} cards left` : null]
        .filter(Boolean).join(' · ') || stop.town,
      outcome: stop.outcome,
    })));
  const signups = log.signups.map(signup => {
    const stop = doneStops(log).find(candidate => candidate.id === signup.stopId);
    return {
      id: `signup-${signup.id}`,
      on: signup.date,
      kind: 'signup' as const,
      title: stop?.name ?? 'A partner business',
      detail: `Tap sign-up · ${signup.service}`,
    };
  });
  // A busy week of taps would otherwise push every visit off the list, and having both kinds
  // on one timeline is the point of this panel. Each kind keeps at least half the room; where
  // one has less to show, the other takes the slack.
  const half = Math.max(2, Math.floor(limit / 2));
  const newest = <T extends { on: string; id: string }>(rows: T[], take: number) =>
    [...rows].sort((a, b) => b.on.localeCompare(a.on) || a.id.localeCompare(b.id)).slice(0, take);
  return [...newest(stops, Math.max(half, limit - signups.length)), ...newest(signups, Math.max(half, limit - stops.length))]
    .sort((a, b) => b.on.localeCompare(a.on) || a.id.localeCompare(b.id))
    .slice(0, limit);
}

/** Status pills. The word carries the meaning; the colour only agrees with it. */
export const STATUS_TONE: Record<string, { tone: string; label: string }> = {
  joined: { tone: 'good', label: 'Participating' },
  'follow-up': { tone: 'warn', label: 'Follow-up due' },
  'not-now': { tone: 'off', label: 'Not right now' },
  pending: { tone: 'info', label: 'Scheduled' },
};
