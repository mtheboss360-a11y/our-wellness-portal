import { z } from 'zod';
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => { const parsed = new Date(value); return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0,10) === value; }, 'Use a valid ISO date.');
const location = z.object({ id: z.string().min(1).max(100), name: z.string().min(1).max(160), area: z.string().min(1).max(100), dropDate: day, flyers: z.number().int().min(0).max(100000000) }).strict();
const lead = z.object({ id: z.string().min(1).max(100), name: z.string().min(1).max(160), phone: z.string().regex(/^\+[1-9]\d{7,14}$/), email: z.email().max(254), locationId: z.string().min(1).max(100), receivedDate: day, service: z.string().min(1).max(80) }).strict();
export const campaignFeed = z.array(z.object({ id: z.string().min(1).max(100), name: z.string().min(1).max(160), period: z.string().max(100), locations: z.array(location).max(1000), leads: z.array(lead).max(100000) }).strict().superRefine((campaign, ctx) => {
  if (new Set(campaign.locations.map(l => l.id)).size !== campaign.locations.length) ctx.addIssue({ code: 'custom', message: 'Location IDs must be unique within a campaign.' });
  if (new Set(campaign.leads.map(l => l.id)).size !== campaign.leads.length) ctx.addIssue({ code: 'custom', message: 'Lead IDs must be unique within a campaign.' });
  campaign.leads.forEach((lead, index) => { const target = campaign.locations.find(l => l.id === lead.locationId); if (!target) ctx.addIssue({ code: 'custom', path: ['leads',index,'locationId'], message: 'Lead refers to a missing location.' }); else if (lead.receivedDate < target.dropDate) ctx.addIssue({ code:'custom',path:['leads',index,'receivedDate'],message:'A lead cannot precede its drop.' }); });
})).max(1000).refine(values => new Set(values.map(v => v.id)).size === values.length, 'Campaign IDs must be unique.');

// Network Map inputs. The route selection is a list of Google place IDs and nothing else: the
// server looks every one up in that clinic's own cached map, so a made-up or borrowed ID simply
// is not found. Names, addresses and statuses are never accepted from the browser.
export const selectionInput = z.object({ placeIds: z.array(z.string().min(1).max(255)).max(40) }).strict();
export const itemsRequestInput = z.object({
  placeId: z.string().min(1).max(255),
  items: z.string().trim().min(1, 'Tell us what to bring.').max(600),
  people: z.coerce.number().int().min(1).max(500),
  neededBy: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a date.'),
  contactName: z.string().trim().min(1, 'Add your name.').max(120),
  contactPhone: z.string().trim().max(40).default(''),
  notes: z.string().trim().max(600).default(''),
}).strict();
export const bakeryRemoveInput = z.object({ placeId: z.string().min(1).max(255).nullable() }).strict();
export const bakeryChoiceInput = z.object({ placeId: z.string().min(1).max(255).nullable() }).strict();
export const routeRequestInput = z.object({
  contactName: z.string().trim().min(1).max(120),
  contactPhone: z.string().trim().max(40).default(''),
  notes: z.string().trim().max(600).default(''),
  preferredFrom: day,
  preferredTo: day,
}).strict().refine(value => value.preferredTo >= value.preferredFrom, { message: 'The end of the date range cannot fall before its start.', path: ['preferredTo'] });
export const networkRecordsFeed = z.array(z.object({
  id: z.string().min(1).max(100),
  kind: z.enum(['client', 'partner', 'exclusive', 'competitor', 'blocked']),
  ownerClinicId: z.string().regex(/^[a-z0-9-]{3,80}$/).nullable().default(null),
  placeId: z.string().min(1).max(255).nullable().default(null),
  name: z.string().max(200).nullable().default(null),
  address: z.string().max(300).nullable().default(null),
  note: z.string().max(400).default(''),
}).strict().refine(value => value.placeId || value.name || value.address, 'A record needs a place ID, a name or an address to match on.'))
  .max(20000).refine(values => new Set(values.map(value => value.id)).size === values.length, 'Record IDs must be unique.');
export const clinicLocationInput = z.object({
  clinic: z.string().regex(/^[a-z0-9-]{3,80}$/),
  label: z.string().trim().min(1).max(200),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  radiusMiles: z.number().min(0.25).max(30),
  placeId: z.string().min(1).max(255).nullable().default(null),
  competitorCategories: z.array(z.string().min(1).max(60)).max(20).default([]),
});

// The field log: drivers, routes, stops and staff sign-ups, as the Google Form rows record them.
// Photos are paths under /assets/field/ only, so a feed cannot point the portal at another site.
const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const photo = z.string().regex(/^\/assets\/field\/[a-z0-9-]+\.(jpg|png|webp)$/);
const slug = z.string().regex(/^[a-z0-9@-]{1,120}$/);
const count = z.number().int().min(0).max(10000);
const fieldStop = z.object({
  id: slug, businessId: slug, name: z.string().min(1).max(160),
  category: z.enum(['gym', 'yoga', 'pilates', 'salon', 'nails', 'boutique', 'physio', 'cycle', 'other']),
  town: z.string().min(1).max(100), lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180),
  arrived: clock.nullable(), left: clock.nullable(), spokeWith: z.string().max(60),
  staffOnShift: count, boxes: count, coffees: count, cards: count, display: z.boolean(),
  outcome: z.enum(['joined', 'follow-up', 'not-now', 'pending']), note: z.string().max(400), photo: photo.nullable(),
  crossRef: z.object({ theirClients: z.string().max(240), yourServices: z.array(z.string().min(1).max(80)).max(8), score: z.number().int().min(0).max(100) }).strict(),
}).strict();
export const fieldLogFeed = z.object({
  clinic: z.object({ label: z.string().min(1).max(200), lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }).strict(),
  drivers: z.array(z.object({ id: slug, name: z.string().min(1).max(120), photo, homeBase: z.string().max(100), since: day, vehicle: z.string().max(80), languages: z.array(z.string().min(1).max(40)).max(8), bio: z.string().max(400) }).strict()).max(200),
  routes: z.array(z.object({ id: slug, date: day, start: clock, driverId: slug, status: z.enum(['done', 'scheduled']), stops: z.array(fieldStop).min(1).max(10) }).strict()).max(2000),
  signups: z.array(z.object({ id: slug, firstName: z.string().min(1).max(60), routeId: slug, stopId: slug, date: day, service: z.string().min(1).max(80), status: z.enum(['new', 'called', 'booked']) }).strict()).max(100000),
}).strict().superRefine((feed, ctx) => {
  const drivers = new Set(feed.drivers.map(d => d.id));
  const stops = new Map(feed.routes.flatMap(r => r.stops.map(s => [s.id, r.id] as const)));
  if (drivers.size !== feed.drivers.length) ctx.addIssue({ code: 'custom', message: 'Driver IDs must be unique.' });
  if (new Set(feed.routes.map(r => r.id)).size !== feed.routes.length) ctx.addIssue({ code: 'custom', message: 'Route IDs must be unique.' });
  feed.routes.forEach((route, i) => { if (!drivers.has(route.driverId)) ctx.addIssue({ code: 'custom', path: ['routes', i, 'driverId'], message: 'Route refers to a missing driver.' }); });
  feed.signups.forEach((signup, i) => { if (stops.get(signup.stopId) !== signup.routeId) ctx.addIssue({ code: 'custom', path: ['signups', i, 'stopId'], message: 'Sign-up refers to a stop that is not on its route.' }); });
});

// A clinic's location from its own device, used once, when the team has not saved one yet.
export const deviceLocationInput = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracy: z.number().min(0).max(100000).optional(),
}).strict();

/** One note a staff member wrote about a business they visited. */
export const visitNoteInput = z.object({
  businessId: z.string().min(1).max(100),
  note: z.string().max(2000),
  nextRound: z.boolean(),
}).strict();

// THE STAFF'S OWN WRITES. Each one is checked here and the clinic is never among the fields:
// it is resolved from the session cookie, so a borrowed business id on another practice's
// account is simply not found.
export const recordVisitInput = z.object({
  businessId: z.string().min(1).max(80),
  visitedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  spokeWith: z.string().trim().max(120).default(''),
  contactRole: z.string().trim().max(120).default(''),
  outcome: z.enum(['interested', 'partner', 'follow-up', 'declined', 'unavailable', 'closed', 'materials']),
  materials: z.number().int().min(0).max(5000).default(0),
  note: z.string().trim().max(4000).default(''),
  nextAction: z.string().trim().max(400).default(''),
  followUpOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
  // The caller's own id for this submission, so a double tap or a retry on a bad signal
  // returns the visit already saved instead of writing a second one.
  clientRef: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/).optional(),
}).strict();

export const editVisitInput = z.object({
  visitId: z.string().min(1).max(80),
  spokeWith: z.string().trim().max(120).optional(),
  contactRole: z.string().trim().max(120).optional(),
  outcome: z.enum(['interested', 'partner', 'follow-up', 'declined', 'unavailable', 'closed', 'materials']).optional(),
  materials: z.number().int().min(0).max(5000).optional(),
  note: z.string().trim().max(4000).optional(),
  nextAction: z.string().trim().max(400).optional(),
  followUpOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
}).strict();

export const saveScriptInput = z.object({
  businessId: z.string().min(1).max(80),
  script: z.object({
    opening: z.string().max(2000), introduction: z.string().max(2000), value: z.string().max(2000),
    ask: z.string().max(2000),
    objections: z.object({
      busy: z.string().max(2000), notInterested: z.string().max(2000), alreadyPartnered: z.string().max(2000),
    }).strict(),
    closing: z.string().max(2000), followUp: z.string().max(2000),
  }).strict(),
}).strict();

// ── THE ROUTE RUNNER'S OWN WRITES ───────────────────────────────────────────
//
// A runner may change the ORDER of their day, the pickups they put into it, what they confirm
// they are carrying and what they recorded dropping. Nothing here accepts a clinic, a user, a
// business name, an address for a business, a date or an allocation: the round comes from the
// session's own assigned rounds, and the quantities the office allocated are not in any of
// these shapes, so a runner cannot raise their own allocation by posting a bigger number.
//
// `revision` is what the runner's screen was showing when they acted. The server refuses a
// write against an older revision rather than letting the second phone win silently.
const supplyCount = z.number().int().min(0).max(10000);
export const supplyInput = z.object({
  flyers: supplyCount.default(0), treats: supplyCount.default(0), cards: supplyCount.default(0),
}).strict();
const roundId = z.string().min(1).max(80);
const revision = z.number().int().min(0).max(1_000_000_000);

export const reorderRouteInput = z.object({
  roundId,
  order: z.array(z.object({
    kind: z.enum(['business', 'pickup']), id: z.string().min(1).max(80),
  }).strict()).min(1).max(100),
  revision,
}).strict();

export const pickupInput = z.object({
  roundId,
  /** Absent when this is a new pickup. */
  pickupId: z.string().min(1).max(80).optional(),
  kind: z.enum(['treats', 'materials', 'other']),
  title: z.string().trim().min(1, 'Give the pickup a location name.').max(100),
  address: z.string().trim().min(8, 'Give the pickup a full street address.').max(250),
  windowStart: clock,
  windowEnd: clock,
  minutes: z.number().int().min(1).max(120),
  items: z.string().trim().max(400).default(''),
  reference: z.string().trim().max(120).default(''),
  note: z.string().trim().max(900).default(''),
  supplies: supplyInput.default({ flyers: 0, treats: 0, cards: 0 }),
  revision,
}).strict().refine(value => value.windowEnd > value.windowStart, {
  message: 'The pickup window has to open before it closes.', path: ['windowEnd'],
});

export const pickupActionInput = z.object({
  roundId, pickupId: z.string().min(1).max(80), revision,
  /** What was actually collected, where the runner confirmed it. Absent on a removal. */
  collected: supplyInput.optional(),
}).strict();

export const packedInput = z.object({
  roundId, supplies: supplyInput, revision,
}).strict();

/**
 * A visit recorded from the planner. The same shape the portal already records, plus the
 * breakdown of what was dropped. The TOTAL is not taken from the browser: the server adds the
 * three counts up, so `visits.materials` and the breakdown behind it cannot disagree.
 */
export const runnerVisitInput = z.object({
  /** The round the screen opened this visit from. Checked against the caller's own rounds. */
  roundId: z.string().min(1).max(80),
  businessId: z.string().min(1).max(80),
  visitedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  spokeWith: z.string().trim().max(120).default(''),
  contactRole: z.string().trim().max(120).default(''),
  outcome: z.enum(['interested', 'partner', 'follow-up', 'declined', 'unavailable', 'closed', 'materials']),
  dropped: supplyInput.default({ flyers: 0, treats: 0, cards: 0 }),
  note: z.string().trim().max(4000).default(''),
  nextAction: z.string().trim().max(400).default(''),
  followUpOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
  clientRef: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/).optional(),
}).strict();
