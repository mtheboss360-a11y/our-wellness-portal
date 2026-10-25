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
