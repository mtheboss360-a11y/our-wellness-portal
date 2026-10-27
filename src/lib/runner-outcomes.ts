/**
 * A runner's three quick decisions map to the existing, authoritative outreach outcomes.
 * "Accepted" means they agreed to participate as a referral partner, NOT that a patient referral occurred.
 * A quick check-off creates the same auditable visit as Guided Visit; it is never a cosmetic toggle.
 */
import type { Outcome } from '../../server/outreach';

export const QUICK_RESULTS = [
  { key: 'accepted', label: 'Accepted', detail: 'Agreed to participate in the referral network', outcome: 'partner' },
  { key: 'declined', label: 'Declined', detail: 'Did not want to participate', outcome: 'declined' },
  { key: 'come-back', label: 'Asked to come back', detail: 'Requested another visit or conversation', outcome: 'follow-up' },
] as const satisfies ReadonlyArray<{ key: string; label: string; detail: string; outcome: Outcome }>;
export type QuickResult = typeof QUICK_RESULTS[number]['key'];
export function quickOutcomeFor(key: QuickResult): Outcome {
  return QUICK_RESULTS.find(option => option.key === key)!.outcome;
}
export function defaultReturnDate(today: string): string {
  const date = new Date(`${today}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) throw new Error('Invalid route date');
  date.setUTCDate(date.getUTCDate() + 7);
  return date.toISOString().slice(0, 10);
}

/** Human-friendly route-runner labels. Database outcome ids are unchanged. */
export function runnerOutcomeLabel(outcome: Outcome, fallback: string): string {
  switch (outcome) {
    case 'partner': return 'Accepted';
    case 'declined': return 'Declined';
    case 'follow-up': return 'Asked to come back';
    default: return fallback;
  }
}
