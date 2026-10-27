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

  return {
    visits: mine.length,
    materials: mine.reduce((total, visit) => total + visit.materials, 0),
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
