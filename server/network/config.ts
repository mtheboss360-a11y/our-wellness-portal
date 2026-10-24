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
    googleTypes: ['gym', 'fitness_center'], // sports clubs and activity locations are mostly park fields, courts and school clubs
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
