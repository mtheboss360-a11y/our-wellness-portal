// Google Places (New) — the ONLY module in this portal that talks to Google.
//
// THE KEY. It is read from `process.env.Google_places_API`, the exact name configured on
// Render, case included. It is used in one place: the `X-Goog-Api-Key` header below. It is
// never logged, never put in an error message, never returned by an endpoint and never sent
// to the browser. `configured()` answers whether a key exists without disclosing it.
//
// WHAT MAY BE KEPT. Google Maps Platform terms allow a place ID to be stored indefinitely
// and coordinates for up to 30 consecutive days; there is no carve-out for names, addresses,
// ratings or review counts. So everything `normalizePlace` returns except `placeId` is
// TRANSIENT: server/store.ts holds it in a cache with an expiry and purges it. The map reuses
// that cache instead of searching again every time it opens.

import { discoveryQueries } from './config';
import { milesToMetres } from './geo';

const NEARBY_URL = 'https://places.googleapis.com/v1/places:searchNearby';
const SEARCH_TIMEOUT_MS = 15_000;
/** Discovery's field mask. Every field here is needed to classify or display a candidate. */
const DISCOVERY_FIELDS = ['places.id', 'places.displayName', 'places.formattedAddress', 'places.location', 'places.types', 'places.primaryType', 'places.businessStatus', 'places.rating', 'places.userRatingCount', 'places.googleMapsUri'];

export type DiscoveredPlace = {
  placeId: string;
  name: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  types: string[];
  primaryType: string | null;
  businessStatus: string | null;
  rating: number | null;
  reviewCount: number | null;
  googleMapsUri: string | null;
};

export const apiKey = () => (process.env.Google_places_API ?? '').trim();
export const configured = () => apiKey().length > 0;

export class PlacesError extends Error {
  constructor(message: string) { super(message); this.name = 'PlacesError'; }
}

/** Google's own message, with the key stripped in case it was echoed back in a URL. */
function readableFailure(status: number, body: unknown) {
  const message = (body as { error?: { message?: string } })?.error?.message ?? `Google Places returned ${status}.`;
  const safe = message.replace(apiKey() || '\0', '[key]');
  if (/API key not valid/i.test(safe)) return 'The Google Places key was refused. Check Google_places_API on the server.';
  if (/PERMISSION_DENIED|has not been used|disabled/i.test(safe)) return 'Enable "Places API (New)" for this Google Cloud project.';
  if (/referer|referrer/i.test(safe)) return 'This key is restricted to browser referrers. A server key needs an IP restriction or none.';
  if (/billing/i.test(safe)) return 'Enable billing on the Google Cloud project behind this key.';
  return safe;
}

export function normalizePlace(place: Record<string, any>): DiscoveredPlace | null {
  if (!place?.id) return null;
  return {
    placeId: place.id,
    name: place.displayName?.text ?? null,
    address: place.formattedAddress ?? null,
    lat: typeof place.location?.latitude === 'number' ? place.location.latitude : null,
    lng: typeof place.location?.longitude === 'number' ? place.location.longitude : null,
    types: Array.isArray(place.types) ? place.types : [],
    primaryType: place.primaryType ?? null,
    businessStatus: place.businessStatus ?? null,
    rating: typeof place.rating === 'number' ? place.rating : null,
    reviewCount: typeof place.userRatingCount === 'number' ? place.userRatingCount : null,
    googleMapsUri: place.googleMapsUri ?? null,
  };
}

async function nearby(body: Record<string, unknown>) {
  const key = apiKey();
  if (!key) throw new PlacesError('Google Places is not configured on this server.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);
  try {
    const response = await fetch(NEARBY_URL, { method: 'POST', signal: controller.signal,
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': DISCOVERY_FIELDS.join(',') },
      body: JSON.stringify(body) });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new PlacesError(readableFailure(response.status, payload));
    return (payload?.places ?? []) as Array<Record<string, any>>;
  } catch (error) {
    if (error instanceof PlacesError) throw error;
    if ((error as Error)?.name === 'AbortError') throw new PlacesError('Google Places did not answer in time.');
    throw new PlacesError('Google Places could not be reached.');
  } finally { clearTimeout(timer); }
}

/**
 * One pass of discovery around a clinic: one Nearby Search per category, merged by place ID.
 * That is one call per category per refresh window — not one per map open.
 *
 * `fetchImpl` exists so the tests can run the whole pipeline without a key or a network.
 */
export async function discoverNearby(
  options: { lat: number; lng: number; radiusMiles: number },
  search: (body: Record<string, unknown>) => Promise<Array<Record<string, any>>> = nearby,
) {
  const found = new Map<string, DiscoveredPlace>();
  for (const query of discoveryQueries()) {
    const places = await search({
      locationRestriction: { circle: { center: { latitude: options.lat, longitude: options.lng }, radius: Math.min(50_000, milesToMetres(options.radiusMiles)) } },
      maxResultCount: 20,
      regionCode: 'US',
      rankPreference: 'DISTANCE',
      includedTypes: query.includedTypes,
    });
    for (const raw of places) {
      const place = normalizePlace(raw);
      // A permanently closed business is not a referral partner.
      if (place && place.businessStatus !== 'CLOSED_PERMANENTLY' && !found.has(place.placeId)) found.set(place.placeId, place);
    }
  }
  return [...found.values()];
}
