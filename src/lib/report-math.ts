// THE OUTREACH REPORT'S ARITHMETIC.
//
// Five measures, and the whole point of this file is that they never merge. A visit is not a
// piece of material. A piece of material a staff member reported leaving is not one a business
// displayed. A tap on a card is interest and is not an appointment. An appointment exists only
// where the practice recorded one itself. Added together they would make a number that means
// nothing, and the one most likely to be repeated.
//
// Every measure carries `recorded`. False does not mean zero — it means the portal has no rows
// of that kind for this practice, which is a different sentence and has to read differently on
// screen. A practice that has never logged a walk-in has not had none.
import type { Campaign } from '../../data/portal-data';
import type { FieldLog } from '../../data/field-data';

export type Measure = {
  key: string;
  label: string;
  value: number;
  recorded: boolean;
  note: string;
};

const monthOf = (day: string) => day.slice(0, 7);

export const monthName = (month: string) =>
  new Date(`${month}-01T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' });

const doneStops = (log: FieldLog) => log.routes.filter(r => r.status === 'done').flatMap(r => r.stops);
const doneRouteDate = (log: FieldLog, routeId: string) => log.routes.find(r => r.id === routeId)?.date ?? '';

export function measures(log: FieldLog | null, campaigns: Campaign[]): Measure[] {
  const stops = log ? doneStops(log) : [];
  const signups = log?.signups ?? [];
  const leads = campaigns.flatMap(campaign => campaign.leads);
  const materialsFromLog = stops.reduce((total, stop) => total + stop.cards + stop.boxes, 0);
  const materialsFromCampaigns = campaigns.flatMap(c => c.locations).reduce((total, l) => total + l.flyers, 0);

  return [
    {
      key: 'visits', label: 'Outreach visits', value: stops.length, recorded: !!log,
      note: 'Stops your team recorded as completed.',
    },
    {
      key: 'materials', label: 'Materials dropped', value: materialsFromLog + materialsFromCampaigns,
      recorded: !!log || !!campaigns.length,
      note: 'As reported by the person who went.',
    },
    {
      key: 'scans', label: 'QR/NFC scans', value: signups.length, recorded: !!log,
      note: 'Taps on a partner card.',
    },
    {
      key: 'inquiries', label: 'Inquiries with a known source', value: leads.length, recorded: !!campaigns.length,
      note: 'People who came in and said where they heard of you.',
    },
    {
      key: 'appointments', label: 'Appointments', value: signups.filter(s => s.status === 'booked').length,
      recorded: !!log,
      note: 'Only those your front desk marked booked.',
    },
  ];
}

export type MonthRow = { month: string; visits: number; materials: number; scans: number; inquiries: number };

/** The same five kept apart, by month, oldest first. Only months with something in them. */
export function byMonth(log: FieldLog | null, campaigns: Campaign[]): MonthRow[] {
  const rows = new Map<string, MonthRow>();
  const at = (month: string) => {
    let row = rows.get(month);
    if (!row) { row = { month, visits: 0, materials: 0, scans: 0, inquiries: 0 }; rows.set(month, row); }
    return row;
  };
  if (log) {
    for (const route of log.routes.filter(r => r.status === 'done')) {
      const row = at(monthOf(route.date));
      row.visits += route.stops.length;
      row.materials += route.stops.reduce((total, stop) => total + stop.cards + stop.boxes, 0);
    }
    for (const signup of log.signups) at(monthOf(signup.date)).scans += 1;
  }
  for (const campaign of campaigns) {
    for (const location of campaign.locations) at(monthOf(location.dropDate)).materials += location.flyers;
    for (const lead of campaign.leads) at(monthOf(lead.receivedDate)).inquiries += 1;
  }
  return [...rows.values()].sort((a, b) => a.month.localeCompare(b.month));
}

export type SourceRow = { id: string; name: string; inquiries: number; scans: number };

/**
 * Where the people who said something came from. A business appears here only because somebody
 * named it; nothing is apportioned, estimated or spread across the ones that said nothing.
 */
export function bySource(log: FieldLog | null, campaigns: Campaign[]): SourceRow[] {
  const rows = new Map<string, SourceRow>();
  const at = (id: string, name: string) => {
    let row = rows.get(id);
    if (!row) { row = { id, name, inquiries: 0, scans: 0 }; rows.set(id, row); }
    return row;
  };
  for (const campaign of campaigns) {
    for (const location of campaign.locations) at(location.id, location.name);
    for (const lead of campaign.leads) {
      const location = campaign.locations.find(l => l.id === lead.locationId);
      if (location) at(location.id, location.name).inquiries += 1;
    }
  }
  if (log) {
    const stops = doneStops(log);
    for (const signup of log.signups) {
      const stop = stops.find(s => s.id === signup.stopId);
      if (stop) at(stop.businessId, stop.name).scans += 1;
    }
  }
  return [...rows.values()]
    .filter(row => row.inquiries || row.scans)
    .sort((a, b) => (b.inquiries + b.scans) - (a.inquiries + a.scans) || a.name.localeCompare(b.name));
}

export type ActivityRow = { id: string; on: string; place: string; kind: 'visit' | 'materials' | 'scan'; detail: string };

/**
 * The log itself, newest first, each row saying which kind of thing it is.
 *
 * Scans outnumber visits many times over in a good month, so a plain sort by date shows a
 * column of nothing but scans and the practice cannot see its own rounds. Each kind keeps a
 * share of the room and gives up what it does not use.
 */
export function activity(log: FieldLog | null, limit = 12): ActivityRow[] {
  if (!log) return [];
  const stops = log.routes.filter(r => r.status === 'done').flatMap(route => route.stops.map(stop => ({ stop, date: route.date })));
  const rows: ActivityRow[] = [];
  for (const { stop, date } of stops) {
    rows.push({ id: `v-${stop.id}`, on: date, place: stop.name, kind: 'visit',
      detail: stop.spokeWith ? `Spoke with ${stop.spokeWith}` : 'Visit recorded' });
    if (stop.cards || stop.boxes) rows.push({ id: `m-${stop.id}`, on: date, place: stop.name, kind: 'materials',
      detail: [
        stop.cards && `${stop.cards} ${stop.cards === 1 ? 'card' : 'cards'}`,
        stop.boxes && `${stop.boxes} ${stop.boxes === 1 ? 'box' : 'boxes'}`,
      ].filter(Boolean).join(' · ') });
  }
  for (const signup of log.signups) {
    const stop = doneStops(log).find(s => s.id === signup.stopId);
    rows.push({ id: `s-${signup.id}`, on: signup.date || doneRouteDate(log, signup.routeId),
      place: stop?.name ?? 'A partner business', kind: 'scan', detail: signup.service });
  }
  const newest = (kind: ActivityRow['kind']) =>
    rows.filter(row => row.kind === kind).sort((a, b) => b.on.localeCompare(a.on) || a.id.localeCompare(b.id));
  const kinds = (['visit', 'materials', 'scan'] as const).map(newest).filter(group => group.length);
  if (!kinds.length) return [];
  const picked: ActivityRow[] = [];
  // round-robin until the page is full or every kind is exhausted
  for (let depth = 0; picked.length < limit; depth += 1) {
    const before = picked.length;
    for (const group of kinds) if (group[depth] && picked.length < limit) picked.push(group[depth]);
    if (picked.length === before) break;
  }
  return picked.sort((a, b) => b.on.localeCompare(a.on) || a.id.localeCompare(b.id));
}
