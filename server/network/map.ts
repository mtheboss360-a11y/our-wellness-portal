// Discovery orchestration: the one place that decides whether to spend a Google Places call.
//
// THE RULE THE SPEC ASKS FOR. A map open does not search Google. It reads the cache. A search
// runs only when the cache is empty or when the clinic's refresh cooldown has passed, and the
// result is written back under the 30-day retention window. A clinic with a working key
// therefore costs a handful of Places calls per cooldown window, not per page view.
//
// `NETWORK_MAP_AUTO_DISCOVER=false` turns the automatic pass off entirely, for an operator who
// would rather spend Places calls only from `npm run refresh-network-map`.

import type { PortalStore } from '../store';
import { discoverNearby, configured, PlacesError } from './places';
import { isSampleClinic, sampleMap } from './sample';
import { DEFAULT_RADIUS_MILES } from './config';

export const autoDiscoverEnabled = () => process.env.NETWORK_MAP_AUTO_DISCOVER !== 'false';

export type RefreshOutcome = { ran: boolean; status: 'ok' | 'failed' | 'skipped'; detail: string; found: number };

/**
 * Bring a clinic's cached map up to date if it is due. Never throws: a Google failure is
 * recorded and reported as an empty map with an explanation, not a broken portal.
 *
 * @param force a terminal refresh, which ignores the cooldown but not a missing key
 */
export async function ensureDiscovery(store: PortalStore, clinicId: string, { force = false, auto = true } = {}): Promise<RefreshOutcome> {
  // The sample clinic: its fixed, fictional map, its own spot, and never a Google call.
  if (isSampleClinic(clinicId)) {
    const sample = sampleMap();
    const here = store.clinicLocation(clinicId);
    if (!here || here.lat !== sample.clinic.lat || here.lng !== sample.clinic.lng)
      store.setClinicLocation({ clinicId, label: sample.clinic.label, lat: sample.clinic.lat, lng: sample.clinic.lng, radiusMiles: DEFAULT_RADIUS_MILES, placeId: null, competitorCategories: [] });
    const held = store.cachedDiscovery(clinicId);
    if (held.length !== sample.places.length || held.some(place => !place.placeId.startsWith('sample-'))) {
      store.clearDiscovery(clinicId);
      store.saveDiscovery(clinicId, sample.places);
      store.markRefresh(clinicId, 'ok', '', sample.places.length);
    }
    return { ran: false, status: 'skipped', detail: '', found: sample.places.length };
  }
  const location = store.clinicLocation(clinicId);
  if (!location) return { ran: false, status: 'skipped', detail: 'This clinic has no saved map location yet.', found: 0 };
  if (!configured()) {
    store.markRefresh(clinicId, 'skipped', 'Google Places is not configured on this server.', 0);
    return { ran: false, status: 'skipped', detail: 'Google Places is not configured on this server.', found: 0 };
  }
  if (auto && !force && !autoDiscoverEnabled()) return { ran: false, status: 'skipped', detail: 'Automatic discovery is switched off on this server.', found: 0 };
  if (!force && !store.refreshDue(clinicId)) return { ran: false, status: 'skipped', detail: 'The saved map is current.', found: 0 };
  try {
    const places = await discoverNearby({ lat: location.lat, lng: location.lng, radiusMiles: location.radiusMiles });
    store.saveDiscovery(clinicId, places);
    const detail = places.length ? `${places.length} nearby businesses found.` : 'Google returned no nearby businesses in these categories.';
    store.markRefresh(clinicId, 'ok', detail, places.length);
    return { ran: true, status: 'ok', detail, found: places.length };
  } catch (error) {
    const detail = error instanceof PlacesError ? error.message : 'Google Places could not be reached.';
    store.markRefresh(clinicId, 'failed', detail, 0);
    return { ran: true, status: 'failed', detail, found: 0 };
  }
}
