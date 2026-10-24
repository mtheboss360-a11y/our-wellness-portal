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
