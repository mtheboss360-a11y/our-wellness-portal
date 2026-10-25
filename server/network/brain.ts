// THE BRAIN. Which businesses a client is offered this month, and which previously contacted
// businesses come back round. Pure functions — no database, no network, no clock of their own —
// so every rule here can be read and tested on its own, the way network.ts is.
//
// WHAT IT NEVER DOES. It never invents a business, a distance or an ownership label; a row with
// no readable distance is held back and listed, not quietly included with a guess. It never
// reads a Google rating or review count — those are not inputs, here or in network.ts. It never
// calls a recommendation an agreed referral partner: a recommendation is a business worth a
// visit, and nothing about a listing says anyone has agreed to anything.
//
// WHERE THE DIALS ARE. config.ts, in the BRAIN block. Nothing in this file is a tuned number.

import { BRAIN, CATEGORY_RULES, DISTANCE_BANDS, OUTCOME_LABELS, OUTCOME_REASONS, RULES_VERSION, type OutreachOutcome } from './config';
import type { OwnershipState } from './network';

/** The largest category weight and distance band in the rules, so the score rescales itself. */
const MAX_CATEGORY_WEIGHT = Math.max(...CATEGORY_RULES.filter(rule => !rule.competitor).map(rule => rule.weight), 1);
const MAX_BAND_POINTS = Math.max(...DISTANCE_BANDS.map(band => band.points), 1);

const DAY = 86_400_000;

// ── Dates. ISO day strings in UTC throughout: a follow-up is a day, not an instant. ─────────

export const isoDay = (value: Date) => value.toISOString().slice(0, 10);
export const isDay = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && isoDay(new Date(`${value}T00:00:00Z`)) === value;
export const addDays = (day: string, days: number) => isoDay(new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY));
export const monthOf = (day: string) => day.slice(0, 7);
export const firstOfMonth = (day: string) => `${day.slice(0, 7)}-01`;

/** Months later, with the day of the month clamped: 31 January plus a month is 28 February. */
export function addMonths(day: string, months: number) {
  const [year, month, date] = day.split('-').map(Number);
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const lastOfTarget = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  return isoDay(new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), Math.min(date, lastOfTarget))));
}

/** The calendar month a set belongs to, as 'YYYY-MM'. One set per client per month. */
export const periodOf = (day: string) => monthOf(day);
export const periodLabel = (period: string) =>
  new Date(`${period}-01T00:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });

// ── The referral-fit score ───────────────────────────────────────────────────────────────────

export type ScorePart = { label: string; detail: string; points: number; outOf: number };
export type ScoreInputs = {
  rulesVersion: string;
  categoryId: string | null;
  categoryWeight: number;
  distanceMiles: number | null;
  distanceBand: string;
  networkStatus: string;
  ownership: OwnershipState;
  parts: ScorePart[];
};

export type BrainRow = {
  placeId: string;
  name: string | null;
  address: string | null;
  category: { id: string; label: string; weight: number; reason: string; competitor: boolean } | null;
  /** null when the coordinates were missing or unreadable. Never substituted with a guess. */
  distanceMiles: number | null;
  status: string;
  routable: boolean;
  ownership: OwnershipState;
  /** Normalised name + address, for spotting the same location listed twice. Empty if unknown. */
  dedupeKey: string;
};

const scaled = (points: number, outOf: number, max: number) => Math.round((points / outOf) * max);
const bandFor = (miles: number) => DISTANCE_BANDS.find(band => miles <= band.withinMiles) ?? DISTANCE_BANDS[DISTANCE_BANDS.length - 1];

/**
 * The referral-fit score, 0-100, and the parts that add up to it.
 *
 * Four parts, all from config: shared audience (the category's own weight), practical distance,
 * network compatibility (what the cross-reference already knows), and ownership. Unknown
 * ownership takes the neutral middle of its part — not zero, because not knowing is not a fault
 * of the business, and not full, because the network has not verified anything.
 */
export function referralFit(row: BrainRow): { score: number; components: ScorePart[]; inputs: ScoreInputs } {
  const weights = BRAIN.weights;
  const categoryPoints = row.category && !row.category.competitor ? scaled(row.category.weight, MAX_CATEGORY_WEIGHT, weights.sharedAudience) : 0;
  const band = row.distanceMiles === null ? null : bandFor(row.distanceMiles);
  const distancePoints = band ? scaled(band.points, MAX_BAND_POINTS, weights.distance) : 0;
  const networkPoints = Math.min(weights.network, BRAIN.networkPoints[row.status] ?? 0);
  const ownershipPoints = row.ownership === 'independent' ? weights.ownership : row.ownership === 'chain' ? 0 : Math.round(weights.ownership / 2);

  const components: ScorePart[] = [
    { label: row.category ? row.category.label : 'Uncategorised',
      detail: row.category?.reason ?? 'No category rule matches this business yet.',
      points: categoryPoints, outOf: weights.sharedAudience },
    { label: 'Distance',
      detail: band ? `${row.distanceMiles!.toFixed(1)} miles in a straight line — ${band.label}.` : 'No readable distance for this business yet.',
      points: distancePoints, outOf: weights.distance },
    { label: 'Network status',
      detail: networkPoints > 0 ? 'Nothing in the network conflicts with a visit here.' : 'The network has something to settle before outreach.',
      points: networkPoints, outOf: weights.network },
    { label: 'Ownership',
      detail: row.ownership === 'independent' ? 'Verified independent or owner-operated.'
        : row.ownership === 'chain' ? 'Part of a chain or franchise.'
        : 'Ownership unknown — scored neutrally, never guessed from the name.',
      points: ownershipPoints, outOf: weights.ownership },
  ];
  const score = components.reduce((total, part) => total + part.points, 0);
  return { score, components, inputs: {
    rulesVersion: RULES_VERSION, categoryId: row.category?.id ?? null, categoryWeight: row.category?.weight ?? 0,
    distanceMiles: row.distanceMiles, distanceBand: band?.label ?? 'unknown', networkStatus: row.status, ownership: row.ownership, parts: components } };
}

/** The one-line reason a business is on this month's list. Short, and true of the data. */
export function recommendationReason(row: BrainRow) {
  const band = row.distanceMiles === null ? null : bandFor(row.distanceMiles);
  const parts: string[] = [];
  parts.push(row.category
    ? `${row.category.label}, ${row.distanceMiles!.toFixed(1)} mi away — ${band!.label}.`
    : `${row.distanceMiles!.toFixed(1)} mi away — ${band!.label}.`);
  if (row.ownership === 'independent') parts.push('Verified independent.');
  if (row.status === 'in-network') parts.push('Already approved for your clinic.');
  if (row.status === 'review') parts.push('The team checks this one before outreach.');
  return parts.join(' ');
}

// ── This month's new recommendations ─────────────────────────────────────────────────────────

export type Pick = { placeId: string; rank: number; score: number; reason: string; components: ScorePart[]; inputs: ScoreInputs };
export type Held = { placeId: string; name: string | null; reason: string };
export type RankResult = { picks: Pick[]; held: Held[]; considered: number; qualified: number; note: string };

export type RankOptions = {
  /** Place IDs this client has already been shown, or has already contacted. Never shown as new. */
  exclude?: Set<string>;
  limit?: number;
  maxMiles?: number;
};

/**
 * This month's set: up to fifteen businesses, strongest first, and the reasons for the count.
 *
 * The order of the rules is the point. Anything the network refuses, anything Google lists as
 * closed and anything without a readable distance is out before a score is considered; a
 * business already shown or already contacted is never offered again as "new"; a second listing
 * of the same location is held back rather than shown twice. What survives is ranked by score,
 * then by distance, then by place ID so the same month always produces the same set. A category
 * ceiling is applied first so a batch is not fifteen gyms, then any slots still empty are filled
 * from the remaining qualifiers — a preference for variety, not a reason to hand over a short
 * list when the matches are real.
 */
export function rankRecommendations(rows: BrainRow[], options: RankOptions = {}): RankResult {
  const limit = options.limit ?? BRAIN.monthlyNewLimit;
  const maxMiles = options.maxMiles ?? BRAIN.maxRecommendationMiles;
  const exclude = options.exclude ?? new Set<string>();

  const held: Held[] = [];
  const seenKeys = new Set<string>();
  const qualifying: Array<{ row: BrainRow; fit: ReturnType<typeof referralFit> }> = [];

  for (const row of rows) {
    if (exclude.has(row.placeId)) continue;
    // The network's own refusal — competitor, do-not-approach, somebody's exclusivity, closed.
    if (!row.routable) continue;
    if (row.distanceMiles === null) {
      held.push({ placeId: row.placeId, name: row.name, reason: 'No readable distance for this business yet, so it is held back for review rather than counted in.' });
      continue;
    }
    if (row.distanceMiles > maxMiles) continue;
    if (row.dedupeKey && seenKeys.has(row.dedupeKey)) {
      held.push({ placeId: row.placeId, name: row.name, reason: 'Looks like the same location as another business on your map, so it is held back for review.' });
      continue;
    }
    const fit = referralFit(row);
    if (fit.score < BRAIN.minimumScore) continue;
    if (row.dedupeKey) seenKeys.add(row.dedupeKey);
    qualifying.push({ row, fit });
  }

  qualifying.sort((a, b) => b.fit.score - a.fit.score || a.row.distanceMiles! - b.row.distanceMiles! || a.row.placeId.localeCompare(b.row.placeId));

  const chosen: typeof qualifying = [];
  const perCategory = new Map<string, number>();
  for (const entry of qualifying) {
    if (chosen.length >= limit) break;
    const key = entry.row.category?.id ?? 'uncategorised';
    if ((perCategory.get(key) ?? 0) >= BRAIN.preferredPerCategory) continue;
    perCategory.set(key, (perCategory.get(key) ?? 0) + 1);
    chosen.push(entry);
  }
  for (const entry of qualifying) {
    if (chosen.length >= limit) break;
    if (!chosen.includes(entry)) chosen.push(entry);
  }

  const picks: Pick[] = chosen.map((entry, index) => ({
    placeId: entry.row.placeId, rank: index + 1, score: entry.fit.score,
    reason: recommendationReason(entry.row), components: entry.fit.components, inputs: entry.fit.inputs,
  }));

  return { picks, held, considered: rows.length, qualified: qualifying.length, note: countNote(picks.length, limit, held.length) };
}

/** The sentence under the heading: what the count means, said plainly and without padding. */
export function countNote(offered: number, limit: number, heldCount = 0) {
  const held = heldCount ? ` ${heldCount} ${heldCount === 1 ? 'business is' : 'businesses are'} held back for review.` : '';
  if (!offered) return `No new businesses qualified this month on your map.${held}`;
  if (offered >= limit) return `${offered} new businesses this month — the strongest matches on your map.${held}`;
  return `${offered} new ${offered === 1 ? 'business' : 'businesses'} this month: every match that qualified, rather than ${limit} padded out.${held}`;
}

// ── The follow-up rotation ───────────────────────────────────────────────────────────────────

export type OutreachEvent = { placeId: string; visitedOn: string; outcome: OutreachOutcome; note: string; recordedAt: number };

/**
 * When a business comes round again after an outcome is recorded.
 *
 * `null` parks it: a business marked not interested does not come back until the client
 * deliberately reopens it. Every interval is a dial in config, and "about two months" is the
 * default rather than a promise about any particular month's workload.
 */
export function nextDue(outcome: OutreachOutcome, fromDay: string): string | null {
  const rule = BRAIN.followUp.byOutcome[outcome];
  if (!rule) return null;
  if (typeof rule.months === 'number') return addMonths(fromDay, rule.months);
  return addDays(fromDay, rule.days ?? 0);
}

export type FollowUp = {
  placeId: string;
  lastVisitedOn: string;
  outcome: OutreachOutcome;
  outcomeLabel: string;
  dueOn: string;
  /** The staggered day inside the due month, so one cohort does not land in one week. */
  scheduledOn: string;
  week: number;
  reason: string;
  note: string;
};

/**
 * Spread a month's worth of due businesses across that month.
 *
 * Without this, a clinic that visited thirty businesses in one week gets all thirty back on one
 * day two months later. Everyone due in the same month is one cohort, ordered by due date and
 * then by place ID so the order never shuffles, and handed a week slot of `perWeek`: the first
 * four keep their own date, the next four wait a week, and so on. A business is only ever moved
 * later, never earlier than the date its own outcome set, and the next recorded visit measures
 * from that visit — so the wait does not compound from one round to the next.
 */
export function staggerQueue(entries: Array<Omit<FollowUp, 'scheduledOn' | 'week' | 'outcomeLabel' | 'reason'>>, perWeek: number = BRAIN.followUp.perWeek) {
  const cohorts = new Map<string, typeof entries>();
  for (const entry of entries) cohorts.set(monthOf(entry.dueOn), [...(cohorts.get(monthOf(entry.dueOn)) ?? []), entry]);
  const staggered: Array<(typeof entries)[number] & { scheduledOn: string; week: number }> = [];
  for (const cohort of cohorts.values()) {
    const ordered = [...cohort].sort((a, b) => a.dueOn.localeCompare(b.dueOn) || a.placeId.localeCompare(b.placeId));
    ordered.forEach((entry, index) => {
      const slot = Math.floor(index / Math.max(1, perWeek));
      staggered.push({ ...entry, scheduledOn: addDays(entry.dueOn, slot * 7), week: slot + 1 });
    });
  }
  return staggered.sort((a, b) => a.scheduledOn.localeCompare(b.scheduledOn) || a.placeId.localeCompare(b.placeId));
}

export type Queue = { due: FollowUp[]; upcoming: FollowUp[]; parked: FollowUp[]; note: string };

/**
 * The client-facing queue: what is due now, what is coming, and what is parked.
 *
 * `due` is capped at fifteen — the standing rule that nobody is handed more than fifteen
 * businesses at once — and the note says how many more are waiting rather than claiming a fixed
 * number of follow-ups a month.
 */
export function followUpQueue(events: OutreachEvent[], today: string, options: { perWeek?: number; limit?: number } = {}): Queue {
  const limit = options.limit ?? BRAIN.followUp.queueLimit;
  const latest = new Map<string, OutreachEvent>();
  for (const event of events) {
    const held = latest.get(event.placeId);
    if (!held || event.visitedOn > held.visitedOn || (event.visitedOn === held.visitedOn && event.recordedAt >= held.recordedAt)) latest.set(event.placeId, event);
  }

  const parked: FollowUp[] = [];
  const pending: Array<Omit<FollowUp, 'scheduledOn' | 'week' | 'outcomeLabel' | 'reason'>> = [];
  for (const event of latest.values()) {
    const due = nextDue(event.outcome, event.visitedOn);
    const base = { placeId: event.placeId, lastVisitedOn: event.visitedOn, outcome: event.outcome, note: event.note };
    if (!due) { parked.push({ ...base, dueOn: '', scheduledOn: '', week: 0, outcomeLabel: label(event.outcome), reason: OUTCOME_REASONS[event.outcome] }); continue; }
    pending.push({ ...base, dueOn: due });
  }

  const staggered = staggerQueue(pending, options.perWeek).map(entry => ({
    ...entry, outcomeLabel: label(entry.outcome), reason: OUTCOME_REASONS[entry.outcome],
  }));
  const ready = staggered.filter(entry => entry.scheduledOn <= today);
  const due = ready.slice(0, limit);
  const upcoming = [...ready.slice(limit), ...staggered.filter(entry => entry.scheduledOn > today)]
    .sort((a, b) => a.scheduledOn.localeCompare(b.scheduledOn) || a.placeId.localeCompare(b.placeId));

  return { due, upcoming, parked, note: queueNote(due.length, upcoming.length, parked.length) };
}

const label = (outcome: OutreachOutcome) => OUTCOME_LABELS[outcome];

export function queueNote(dueCount: number, upcomingCount: number, parkedCount: number) {
  const parked = parkedCount ? ` ${parkedCount} marked not interested ${parkedCount === 1 ? 'is' : 'are'} out of the queue until you reopen ${parkedCount === 1 ? 'it' : 'them'}.` : '';
  if (!dueCount && !upcomingCount) return `Nothing is due for a follow-up yet.${parked}`;
  if (!dueCount) return `Nothing due today. ${upcomingCount} ${upcomingCount === 1 ? 'business comes' : 'businesses come'} due later.${parked}`;
  const more = upcomingCount ? ` ${upcomingCount} more ${upcomingCount === 1 ? 'comes' : 'come'} due after these.` : '';
  return `${dueCount} ${dueCount === 1 ? 'business is' : 'businesses are'} due for another visit.${more}${parked}`;
}
