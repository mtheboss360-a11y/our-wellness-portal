import type { Campaign, Lead, Location } from '../../data/portal-data';
export const number = (n: number) => new Intl.NumberFormat('en-US').format(n);
export function summarize(campaign: Campaign) {
  const flyers = campaign.locations.reduce((sum, l) => sum + l.flyers, 0);
  const leadCount = campaign.leads.length;
  const rows = campaign.locations.map((location, index) => ({ ...location, colorIndex: index, leads: campaign.leads.filter(lead => lead.locationId === location.id).length }));
  const ranked = [...rows].sort((a, b) => b.leads - a.leads || a.colorIndex - b.colorIndex);
  return { flyers, leadCount, response: flyers ? (leadCount / flyers * 100).toFixed(2) : '0.00', rows, ranked, top: leadCount ? ranked[0] : undefined };
}
// A field day is a day the team went out. Two locations dropped on the same date
// were one trip, so distinct drop dates — not locations — is the honest count.
export const fieldDays = (campaign: Campaign) => new Set(campaign.locations.map(l => l.dropDate)).size;
export function monthly(campaigns: Campaign[]) {
  const rows = campaigns.map(campaign => {
    const { flyers, leadCount, response } = summarize(campaign);
    return { id: campaign.id, name: campaign.name, fieldDays: fieldDays(campaign), flyers, leads: leadCount, response };
  }).sort((a, b) => a.id.localeCompare(b.id));
  const best = Math.max(1, ...rows.map(r => r.leads));
  return { rows, best, flyers: rows.reduce((s, r) => s + r.flyers, 0), leads: rows.reduce((s, r) => s + r.leads, 0) };
}
export function filterLeads(leads: Lead[], locationId: string | null) {
  return leads.filter(lead => !locationId || lead.locationId === locationId).sort((a, b) => b.receivedDate.localeCompare(a.receivedDate) || a.id.localeCompare(b.id));
}
export function isNew(receivedDate: string, today: string) {
  const age = (Date.parse(today) - Date.parse(receivedDate)) / 86400000;
  return age >= 0 && age < 7;
}
export function dateLabel(value: string, uppercase = false) {
  const label = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}T12:00:00Z`));
  return uppercase ? label.toUpperCase() : label;
}
export function phoneLabel(phone: string) { return phone.replace(/^\+1(\d{3})(\d{3})(\d{4})$/, '($1) $2-$3'); }
export function accumulation(leads: Lead[], locations: Location[]) {
  if (!leads.length) return '';
  const dates = [...new Set([...locations.map(l => l.dropDate), ...leads.map(l => l.receivedDate)])].sort();
  const start = Date.parse(dates[0]);
  const span = Math.max(1, Date.parse(dates[dates.length - 1]) - start);
  return dates.map(date => `${((Date.parse(date) - start) / span * 300).toFixed(2)},${(37 - leads.filter(l => l.receivedDate <= date).length / leads.length * 32).toFixed(2)}`).join(' ');
}
