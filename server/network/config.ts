// THE ONE PLACE THE CATEGORY RULES LIVE.
//
// Every judgement the Network Map makes about a nearby business — which ones are worth
// showing at all, which share a wellness clinic's clientele, which are direct competitors,
// and how a fit score is reached — is a value in this file. Nothing is hard-coded in the
// discovery code, the cross-reference engine or the UI, so the rules can be re-tuned
// without touching logic. Edit this file, not the components.
//
// `googleTypes` are Google Places (New) Table A place types. A type that Google renames or
// retires simply stops matching; it never breaks a request. Discovery sends the union of
// every `googleTypes` entry below as `includedTypes`, which is also how irrelevant
// categories — restaurants, bars, fuel, car repair — are excluded: they are never asked for.

export type CategoryRule = {
  id: string;
  label: string;
  icon: 'dumbbell' | 'lotus' | 'scissors' | 'hand' | 'spine' | 'basket' | 'sparkle';
  /** Marker colour. Taken from the portal palette so the map matches the report. */
  color: string;
  googleTypes: string[];
  /** Plain-language reason this category tends to share a wellness clinic's clientele. */
  reason: string;
  /** Share-of-clientele weight, 0-60. The larger half of the fit score. */
  weight: number;
  /** A category the clinic competes with rather than refers to. Never routable. */
  competitor?: true;
};

export const CATEGORY_RULES: CategoryRule[] = [
  { id: 'fitness', label: 'Fitness studios', icon: 'dumbbell', color: '#1F4D3A', weight: 60,
    googleTypes: ['gym', 'fitness_center', 'sports_club', 'sports_activity_location'],
    reason: 'People training several times a week book recovery and wellness services more than any other group nearby.' },
  { id: 'yoga', label: 'Yoga & Pilates', icon: 'lotus', color: '#2E8B7A', weight: 58,
    googleTypes: ['yoga_studio'], // Google has no pilates type; pilates studios are listed as yoga studios or gyms
    reason: 'A yoga or Pilates membership is already a recurring spend on the body; wellness sessions read as the same decision.' },
  { id: 'physical-therapy', label: 'Physical therapy', icon: 'hand', color: '#7FA96A', weight: 55,
    googleTypes: ['physiotherapist'],
    reason: 'Patients finishing a course of therapy are looking for somewhere to keep the progress going.' },
  { id: 'chiropractic', label: 'Chiropractic', icon: 'spine', color: '#D4A53A', weight: 52,
    googleTypes: ['chiropractor'],
    reason: 'Chiropractic patients come in for pain and mobility — the same reasons they book wellness work.' },
  { id: 'salon', label: 'Salons & barbers', icon: 'scissors', color: '#C2663C', weight: 44,
    googleTypes: ['hair_salon', 'beauty_salon', 'nail_salon', 'barber_shop', 'hair_care', 'makeup_artist'],
    reason: 'A standing appointment every few weeks, with time to talk, and a clientele that already pays for how it feels to look after itself.' },
  { id: 'wellness-retail', label: 'Wellness retail', icon: 'basket', color: '#9B3B3B', weight: 38,
    googleTypes: ['health_food_store', 'juice_shop', 'sporting_goods_store'],
    reason: 'Someone buying supplements or sports nutrition is spending on their own health that same week.' },
  // Competitors are still discovered and still shown — that is the point of the status — but
  // the server refuses to put one on a route. Which categories compete is per-clinic: the
  // list below is only the default, and a clinic record may override it.
  { id: 'med-spa', label: 'Med spas & wellness centers', icon: 'sparkle', color: '#BD7189', weight: 0, competitor: true,
    googleTypes: ['wellness_center', 'spa', 'skin_care_clinic', 'sauna', 'massage', 'tanning_studio'],
    reason: 'Sells the same sessions to the same neighborhood.' },
];

/** Clinics whose own services make a normally-referrable category a competitor instead. */
export const DEFAULT_COMPETITOR_CATEGORIES = CATEGORY_RULES.filter(rule => rule.competitor).map(rule => rule.id);

/**
 * Distance half of the fit score, 0-40. Nearer is worth more because a referral a client
 * can walk to is a referral that actually happens.
 */
export const DISTANCE_BANDS: Array<{ withinMiles: number; points: number; label: string }> = [
  { withinMiles: 0.5, points: 40, label: 'walking distance' },
  { withinMiles: 1.5, points: 32, label: 'a few minutes away' },
  { withinMiles: 3, points: 22, label: 'a short drive' },
  { withinMiles: 6, points: 12, label: 'across town' },
  { withinMiles: Infinity, points: 4, label: 'at the edge of the area' },
];

/** The filter presets the side panel offers. The first is the default. */
export const DISTANCE_FILTERS = [1, 3, 5, 10] as const;

/** How long a discovered business may be held before it is re-fetched or dropped. */
export const GOOGLE_RETENTION_DAYS = 30;
/** A clinic's map will not spend a second round of Places calls inside this window. */
export const REFRESH_COOLDOWN_HOURS = 20;
/** Stops one client may put on one route. */
export const MAX_ROUTE_STOPS = 5;
/** Default search radius for a clinic with no radius of its own, in miles. */
export const DEFAULT_RADIUS_MILES = 5;

export const categoryById = (id: string) => CATEGORY_RULES.find(rule => rule.id === id) ?? null;

/** Google type -> our category. First rule that claims a type wins, in file order. */
export function categoryForTypes(types: string[], primaryType: string | null): CategoryRule | null {
  const ordered = primaryType ? [primaryType, ...types.filter(type => type !== primaryType)] : types;
  for (const type of ordered) { const rule = CATEGORY_RULES.find(candidate => candidate.googleTypes.includes(type)); if (rule) return rule; }
  return null;
}

/**
 * The searches one discovery pass makes: one per category, not one big query.
 *
 * Nearby Search (New) answers at most 20 places and has NO pagination, so a single request
 * for every type at once would come back as 20 of whichever category happens to be densest
 * and nothing else. One request per category gives each kind of business its own 20.
 */
export const discoveryQueries = () => CATEGORY_RULES.map(rule => ({ categoryId: rule.id, includedTypes: rule.googleTypes.slice(0, 50) }));

// ───────────────────────────────────────────────────────────────────────────────────────────
// THE BRAIN'S OWN DIALS. Everything the monthly recommendation and the follow-up rotation
// decide is a value here: how many businesses a client is offered, how good a match has to be
// to be offered at all, how far is practical, what each part of the referral score is worth,
// and how long after a visit a business comes back round. Edit this block, not brain.ts.
//
// `RULES_VERSION` is stored with every recommendation, next to its score inputs, so a set made
// last month can still be explained after these dials change. Bump it when a dial moves.
// ───────────────────────────────────────────────────────────────────────────────────────────

export const RULES_VERSION = 'brain-2026-10-1';

/** What a client is told the portal does. One sentence, used on screen and nowhere else. */
export const PROMISE = 'Up to 15 new businesses to consider each month, plus previously contacted businesses as they come due.';

export type OutreachOutcome = 'interested' | 'follow-up-later' | 'not-interested' | 'unable-to-reach' | 'reopened';

export const BRAIN = {
  /** New businesses a client may be offered in one month. Fifteen, never more. */
  monthlyNewLimit: 15,
  /** Below this a business is not offered at all: a short list beats a padded one. */
  minimumScore: 50,
  /** Preferred ceiling per category in one month's set, so a batch is not fifteen gyms. */
  preferredPerCategory: 5,
  /** Practical distance for a walk-in. Beyond this a business is not recommended. */
  maxRecommendationMiles: 6,
  /** The referral-fit score, out of 100. Google ratings and review counts are not in it. */
  weights: {
    /** Shared audience: the category's own share-of-clientele weight, rescaled. */
    sharedAudience: 45,
    /** Practical distance, rescaled from DISTANCE_BANDS. */
    distance: 30,
    /** Network compatibility: what the cross-reference already knows about the business. */
    network: 15,
    /** Verified independent or owner-operated. Unknown ownership scores the neutral middle. */
    ownership: 10,
  },
  /** Network compatibility points by cross-reference status. A refused status is not scored. */
  networkPoints: { fit: 15, 'in-network': 12, review: 6 } as Record<string, number>,
  followUp: {
    /** The default cadence: about every other month. */
    defaultMonths: 2,
    /**
     * What a recorded outcome does to the next due date. `null` parks the business: it does
     * not come back until the client deliberately reopens it.
     */
    byOutcome: {
      interested: { months: 1 },
      'follow-up-later': { months: 2 },
      'unable-to-reach': { days: 21 },
      'not-interested': null,
      reopened: { days: 0 },
    } as Record<OutreachOutcome, { months?: number; days?: number } | null>,
    /** How many follow-ups land in one week, so a month's cohort is spread across the month. */
    perWeek: 4,
    /** Never put more than fifteen businesses in front of a client at once. */
    queueLimit: 15,
  },
} as const;

/** The plain-language outcome names the portal shows and stores. */
export const OUTCOME_LABELS: Record<OutreachOutcome, string> = {
  interested: 'Interested',
  'follow-up-later': 'Follow up later',
  'not-interested': 'Not interested',
  'unable-to-reach': 'Unable to reach',
  reopened: 'Reopened by your clinic',
};

/** Why a business is back in the follow-up queue, said in the client's own terms. */
export const OUTCOME_REASONS: Record<OutreachOutcome, string> = {
  interested: 'Said they were interested last time, so this is the check-in.',
  'follow-up-later': 'Asked you to come back later, and later has arrived.',
  'not-interested': 'Not interested, so it stays out of the queue until you reopen it.',
  'unable-to-reach': 'Nobody was available last time — worth another try.',
  reopened: 'You reopened this one, so it is back in the queue now.',
};

/** Google business statuses that take a business off the map for good. */
export const CLOSED_STATUSES = ['CLOSED_PERMANENTLY', 'CLOSED_TEMPORARILY'];
