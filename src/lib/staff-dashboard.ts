// THE FIRST SCREEN'S FIGURES, from the same records every other screen reads.
//
// The dashboard used to count the imported field log while the agenda counted the rounds
// table. Both were true and they disagreed on screen: the dashboard announced a round on
// Wednesday while the agenda showed one on Tuesday, and its visit count did not match the
// performance page. A practice cannot be asked to work out which of its own screens to trust.
//
// So where a practice has released businesses, every figure on the dashboard comes from here,
// and here reads exactly what the agenda, the history and the performance pages read.
import type { Business, Visit } from '../../server/outreach';
import type { Round } from './round-math';

/**
 * The round to put in front of somebody: the next one not yet in the past, or failing that
 * the most recent one. Ties on date go to the one with more stops — a five-stop round and a
 * fifteen-stop round on the same day is a planning mistake, not a choice, and the fuller one
 * is the one somebody meant.
 */
export function nextRound(rounds: Round[], today: string): Round | null {
  if (!rounds.length) return null;
  const upcoming = rounds
    .filter(round => round.date >= today)
    .sort((a, b) => a.date === b.date ? b.stops.length - a.stops.length : a.date.localeCompare(b.date));
  if (upcoming.length) return upcoming[0];
  return [...rounds].sort((a, b) => b.date.localeCompare(a.date))[0];
}

const monthOf = (iso: string) => iso.slice(0, 7);

/** The calendar month before this one, as YYYY-MM. */
const monthBefore = (ym: string) => {
  const [y, m] = ym.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
};

/**
 * What happened this calendar month, and what is waiting. Counted from saved visits and the
 * stage each business has reached — never from a round, because a booked stop is an intention.
 */
export function staffMonth(visits: Visit[], businesses: Business[], today: string) {
  const month = monthOf(today);
  const mine = visits.filter(visit => monthOf(visit.visitedOn) === month);

  // A follow-up is outstanding when somebody named a date that has arrived and nobody has been
  // back to that business since.
  const due = visits.filter(visit =>
    visit.followUpOn !== null &&
    visit.followUpOn <= today &&
    !visits.some(later => later.businessId === visit.businessId && later.id !== visit.id && later.visitedOn >= visit.followUpOn!));

  // Last month, for the one comparison a rep actually makes. Absolute, not a percentage:
  // three visits against one is "two more", and calling it "+200%" would be theatre.
  const previous = visits.filter(visit => monthOf(visit.visitedOn) === monthBefore(month));

  // Overdue is not the same as due: a follow-up dated today has not been missed yet.
  const overdue = due.filter(visit => visit.followUpOn! < today);

  return {
    visits: mine.length,
    visitsLastMonth: previous.length,
    materials: mine.reduce((total, visit) => total + visit.materials, 0),
    materialsLastMonth: previous.reduce((total, visit) => total + visit.materials, 0),
    overdue: overdue.length,
    conversations: mine.filter(visit => visit.spokeWith.trim() !== '').length,
    followUpsDue: due.length,
    due,
    notContacted: businesses.filter(business => business.stage === 'new').length,
    partners: businesses.filter(business => business.stage === 'partner').length,
    assigned: businesses.length,
  };
}

/** Businesses owed a second call, most overdue first, for the dashboard's short list. */
export function owedACall(visits: Visit[], today: string, limit = 5) {
  const seen = new Set<string>();
  return visits
    .filter(visit => visit.followUpOn !== null && visit.followUpOn <= today)
    .filter(visit => !visits.some(later =>
      later.businessId === visit.businessId && later.id !== visit.id && later.visitedOn >= visit.followUpOn!))
    .sort((a, b) => a.followUpOn!.localeCompare(b.followUpOn!))
    .filter(visit => { if (seen.has(visit.businessId)) return false; seen.add(visit.businessId); return true; })
    .slice(0, limit);
}

/** The businesses nobody has been to, for the "worth approaching" list. */
export const notYetVisited = (businesses: Business[], limit = 6) =>
  businesses.filter(business => business.stage === 'new').slice(0, limit);

/** One bucket of the activity chart: a period, what it covers, and what happened in it. */
export type Bucket = { key: string; label: string; from: string; to: string; visits: number; materials: number };

const addDays = (iso: string, days: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
/** The Monday on or before a date. Weeks start on Monday because rounds do. */
const mondayOf = (iso: string) => {
  const day = new Date(`${iso}T12:00:00Z`).getUTCDay();
  return addDays(iso, day === 0 ? -6 : 1 - day);
};

/**
 * Visits over time, for the chart on the Overview.
 *
 * It returns the periods that exist and no others. A practice with three weeks of records gets
 * three columns, not twelve with nine zeroes — padding a chart out to a tidy length invents a
 * flat run that never happened, and a reader takes that as evidence of a quiet month.
 *
 * The only zeroes here are genuine gaps BETWEEN two periods that do have activity, because
 * leaving those out would show a continuous climb where there was a break.
 */
export function activitySeries(visits: Visit[], period: 'week' | 'month', today: string): Bucket[] {
  if (!visits.length) return [];

  const keyOf = (iso: string) => period === 'week' ? mondayOf(iso) : iso.slice(0, 7);
  const counted = new Map<string, { visits: number; materials: number }>();
  for (const visit of visits) {
    if (visit.visitedOn > today) continue;
    const key = keyOf(visit.visitedOn);
    const row = counted.get(key) ?? { visits: 0, materials: 0 };
    row.visits += 1; row.materials += visit.materials;
    counted.set(key, row);
  }
  if (!counted.size) return [];

  const keys = [...counted.keys()].sort();
  const first = keys[0], last = keys[keys.length - 1];

  // Walk from the first period with activity to the last, so a genuine gap shows as a gap.
  const all: string[] = [];
  if (period === 'week') {
    for (let at = first; at <= last; at = addDays(at, 7)) all.push(at);
  } else {
    let [y, m] = first.split('-').map(Number);
    const [ly, lm] = last.split('-').map(Number);
    while (y < ly || (y === ly && m <= lm)) {
      all.push(`${y}-${String(m).padStart(2, '0')}`);
      m += 1; if (m > 12) { m = 1; y += 1; }
    }
  }

  return all.map(key => {
    const row = counted.get(key) ?? { visits: 0, materials: 0 };
    const from = period === 'week' ? key : `${key}-01`;
    const to = period === 'week' ? addDays(key, 6) : key;
    return {
      key, from, to, visits: row.visits, materials: row.materials,
      label: period === 'week'
        ? new Date(`${key}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
        : new Date(`${key}-01T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' }),
    };
  });
}
