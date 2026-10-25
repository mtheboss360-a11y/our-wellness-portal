// Pure calculations for the Network Map — the browser half of the feature, with no fetching
// and no React in it, so the arithmetic can be tested on its own the way portal-math.ts is.
//
// The payload shapes below are the contract the server builds. Every judgement — status,
// reason, fit score, routability — is already decided on the server; nothing here re-decides
// any of it, because a browser is not where a conflict rule belongs.

export type MapCategory = { id: string; label: string; icon: string; color: string; competitor: boolean; count: number };
export type FitComponent = { label: string; detail: string; points: number; outOf: number };
export type MapBusiness = {
  placeId: string;
  name: string | null;
  address: string | null;
  category: { id: string; label: string; icon: string; color: string } | null;
  distanceMiles: number;
  rating: number | null;
  reviewCount: number | null;
  googleMapsUri: string | null;
  plot: { x: number; y: number } | null;
  status: 'fit' | 'review' | 'competitor' | 'in-network' | 'unavailable';
  statusLabel: string;
  statusReason: string;
  routable: boolean;
  /** False when the coordinates were missing: the distance above is the search radius, not a measurement. */
  distanceKnown: boolean;
  ownership: { state: 'independent' | 'chain' | 'unknown'; label: string };
  fit: { score: number; components: FitComponent[] };
};
export type RouteStop = { placeId: string; name: string | null; address: string | null; category: string | null };
export type RouteRequest = { id: string; status: string; statusLabel: string; createdAt: string; preferredFrom: string; preferredTo: string; contactName: string; contactPhone: string; notes: string; teamNote: string; stops: RouteStop[]; needsReview: boolean };
// THE BRAIN'S PAYLOAD. Entries carry a place ID and the brain's own fields — score, reason,
// dates — and point into `businesses` in the same payload for everything else, so a name,
// address, distance or status on screen has exactly one source. `present: false` means the
// business's Google content has aged out of the 30-day cache and is being looked up again: the
// row says so rather than showing a stale copy or a guess.
export type PlanPick = { placeId: string; rank: number; score: number; reason: string; components: FitComponent[]; period: string; present: boolean };
export type PlanFollowUp = { placeId: string; lastVisitedOn: string; outcome: string; outcomeLabel: string; dueOn: string; scheduledOn: string; week: number; reason: string; note: string; present: boolean };
export type PlanHistory = { placeId: string; visitedOn: string; outcome: string; outcomeLabel: string; note: string; nextDueOn: string | null };
export type NetworkPlan = {
  promise: string;
  /** The server's own day, so "due since" is never the browser's idea of today. */
  today: string;
  period: string;
  periodLabel: string;
  rulesVersion: string;
  generatedAt: string;
  monthlyLimit: number;
  recommended: PlanPick[];
  recommendedNote: string;
  withdrawn: Array<{ placeId: string; reason: string }>;
  heldBack: Array<{ placeId: string; name: string | null; reason: string }>;
  followUps: { due: PlanFollowUp[]; upcoming: PlanFollowUp[]; parked: PlanFollowUp[]; note: string };
  cadence: { months: number; perWeek: number; queueLimit: number };
  outcomes: Array<{ id: string; label: string }>;
  history: PlanHistory[];
};

export type NetworkMapPayload = {
  clinic: { name: string; location: { label: string; lat: number; lng: number; radiusMiles: number } | null };
  categories: MapCategory[];
  distanceFilters: number[];
  businesses: MapBusiness[];
  selection: string[];
  maxStops: number;
  requests: RouteRequest[];
  plan: NetworkPlan | null;
  data: { placesConfigured: boolean; browserMapKeyConfigured: boolean; retentionDays: number; lastRefresh: { at: string; status: string; detail: string; found: number } | null };
  refresh?: { ran: boolean; status: string; detail: string; found: number };
};

export const STATUS_ORDER: MapBusiness['status'][] = ['fit', 'in-network', 'review', 'unavailable', 'competitor'];

/** One business on Google Maps. Built from the place ID, which is the stable identifier. */
export function mapsPlaceUrl(business: Pick<MapBusiness, 'placeId' | 'name' | 'googleMapsUri'>) {
  if (business.googleMapsUri) return business.googleMapsUri;
  const query = encodeURIComponent(business.name ?? 'business');
  return `https://www.google.com/maps/search/?api=1&query=${query}&query_place_id=${encodeURIComponent(business.placeId)}`;
}

/**
 * A Google Maps directions link for the chosen stops, in the order shown.
 *
 * This is the documented Maps URLs API — a plain link, no API key, no billing and no route
 * optimisation. Google drives in the order given; the clinic reorders the stops itself. The
 * clinic is both the origin and, with `return_to_start`, nothing special: the last stop is the
 * destination, which is what a walk-in round actually looks like.
 */
export function directionsUrl(origin: { lat: number; lng: number }, stops: Array<Pick<MapBusiness, 'placeId' | 'name' | 'address'>>) {
  if (!stops.length) return '';
  const text = (stop: Pick<MapBusiness, 'placeId' | 'name' | 'address'>) => stop.address || stop.name || stop.placeId;
  const destination = stops[stops.length - 1];
  const waypoints = stops.slice(0, -1);
  const parameters = new URLSearchParams({ api: '1', origin: `${origin.lat},${origin.lng}`, destination: text(destination), destination_place_id: destination.placeId, travelmode: 'driving' });
  if (waypoints.length) {
    parameters.set('waypoints', waypoints.map(text).join('|'));
    parameters.set('waypoint_place_ids', waypoints.map(stop => stop.placeId).join('|'));
  }
  return `https://www.google.com/maps/dir/?${parameters.toString()}`;
}

export type Filters = { query: string; categories: string[]; withinMiles: number; onlyRoutable: boolean };

export function filterBusinesses(businesses: MapBusiness[], filters: Filters) {
  const needle = filters.query.trim().toLowerCase();
  return businesses.filter(business => {
    if (business.distanceMiles > filters.withinMiles) return false;
    if (filters.categories.length && !filters.categories.includes(business.category?.id ?? 'uncategorised')) return false;
    if (filters.onlyRoutable && !business.routable) return false;
    if (needle && !`${business.name ?? ''} ${business.address ?? ''} ${business.category?.label ?? ''}`.toLowerCase().includes(needle)) return false;
    return true;
  });
}

export type Marker = { key: string; x: number; y: number; members: MapBusiness[] };

/**
 * Markers for the plot, with crowded areas gathered into one.
 *
 * Positions arrive as -1..1 offsets from the clinic. Businesses are gathered greedily: each
 * one joins the first cluster whose centre is within `cell` of it, which is a marker's own
 * width, or starts a cluster of its own. A grid would have been simpler and wrong — two
 * businesses either side of a cell boundary are neighbours on screen and would still be drawn
 * on top of each other. Opening a cluster spreads its members around it rather than leaving
 * them stacked, which is the one thing a cluster must not do.
 */
export function markers(businesses: MapBusiness[], cell = 0.15): Marker[] {
  const clusters: Array<{ x: number; y: number; members: MapBusiness[] }> = [];
  for (const business of [...businesses].sort((a, b) => b.fit.score - a.fit.score)) {
    if (!business.plot) continue;
    const { x, y } = business.plot;
    const near = clusters.find(cluster => Math.hypot(cluster.x - x, cluster.y - y) <= cell);
    if (!near) { clusters.push({ x, y, members: [business] }); continue; }
    near.members.push(business);
    near.x = near.members.reduce((sum, member) => sum + (member.plot?.x ?? 0), 0) / near.members.length;
    near.y = near.members.reduce((sum, member) => sum + (member.plot?.y ?? 0), 0) / near.members.length;
  }
  return clusters
    .map(cluster => ({ key: cluster.members.map(member => member.placeId).join('+'), x: cluster.x, y: cluster.y, members: cluster.members }))
    .sort((a, b) => a.members.length - b.members.length);
}

/** Where an opened cluster's members sit: a ring around the cluster, biggest ring for most members. */
export function spread(marker: Marker, radius = 0.09) {
  const step = (Math.PI * 2) / marker.members.length;
  const ring = radius * Math.max(1, Math.min(2.2, marker.members.length / 3));
  return marker.members.map((business, index) => ({ business, x: marker.x + Math.cos(index * step - Math.PI / 2) * ring, y: marker.y + Math.sin(index * step - Math.PI / 2) * ring }));
}

export const milesLabel = (miles: number) => (miles < 0.1 ? 'on the doorstep' : `${miles.toFixed(miles < 10 ? 1 : 0)} mi`);
export const dateInputValue = (date: Date) => date.toISOString().slice(0, 10);

/** The town in a Google formatted address: "12 Main St, Hinsdale, IL 60521, USA" gives "Hinsdale". */
export function townOf(address: string | null): string | null {
  if (!address) return null;
  const parts = address.split(',').map(part => part.trim()).filter(Boolean);
  const state = parts.findIndex(part => /^[A-Z]{2}(\s+\d{5}(-\d{4})?)?$/.test(part));
  const town = state > 0 ? parts[state - 1] : parts.length >= 3 ? parts[parts.length - 3] : null;
  return town && !/\d/.test(town) ? town : null;
}

export type TownGroup = { town: string; businesses: MapBusiness[] };

/**
 * The orb's picks: the towns around the clinic with the most businesses we can route to, and in
 * each, the best matches by fit score (then the nearest). Five a town and three towns is fifteen
 * businesses: three routes of five. Competitors and businesses the network can't route to are
 * never picked; a town with fewer than five shows what it has.
 */
export function townPicks(businesses: MapBusiness[], perTown = 5, towns = 3): TownGroup[] {
  const byTown = new Map<string, MapBusiness[]>();
  for (const business of businesses) {
    if (!business.routable || business.status === 'competitor') continue;
    const town = townOf(business.address);
    if (!town) continue;
    byTown.set(town, [...(byTown.get(town) ?? []), business]);
  }
  const best = (list: MapBusiness[]) => [...list].sort((a, b) => b.fit.score - a.fit.score || a.distanceMiles - b.distanceMiles);
  return [...byTown.entries()]
    .map(([town, list]) => ({ town, businesses: best(list).slice(0, perTown), depth: list.length, nearest: Math.min(...list.map(b => b.distanceMiles)) }))
    .sort((a, b) => b.depth - a.depth || a.nearest - b.nearest || a.town.localeCompare(b.town))
    .slice(0, towns)
    .map(({ town, businesses: picked }) => ({ town, businesses: picked }));
}

/** Plan entries beside the business row they describe, in the order the server ranked them. */
export function joinPlan<T extends { placeId: string }>(entries: T[], businesses: MapBusiness[]) {
  const rows = new Map(businesses.map(business => [business.placeId, business]));
  return entries.map(entry => ({ entry, business: rows.get(entry.placeId) ?? null }));
}

/** "12 Nov 2026" — a due date a client reads, from the ISO day the server sent. */
export const dayLabel = (day: string) =>
  day ? new Date(`${day}T00:00:00Z`).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '';
