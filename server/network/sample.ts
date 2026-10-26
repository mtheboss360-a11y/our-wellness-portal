// The sample clinic's Network Map. A demo account never spends a Google Places call: its map is
// a fixed set of fictional businesses (samples/network-places.sample.json), loaded on open.
// Which clinics are samples: SAMPLE_CLINICS (comma-separated slugs), default orchard-lantern.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { DiscoveredPlace } from './places';

type SampleMap = { clinic: { label: string; lat: number; lng: number }; places: DiscoveredPlace[] };

export const sampleClinicIds = () => (process.env.SAMPLE_CLINICS ?? 'orchard-lantern').split(',').map(id => id.trim()).filter(Boolean);
export const isSampleClinic = (clinicId: string) => sampleClinicIds().includes(clinicId);

/**
 * The same fictional businesses, carried over to a demo account's own address.
 *
 * A demo practice is set up with a real address and that address is not ours to change, so the
 * places are shifted by the difference between the sample clinic's spot and theirs. Every
 * distance and bearing from the practice is preserved, which is what the map and the route
 * builder read; only the absolute coordinates move. The names stay fictional and the place IDs
 * keep their "sample-" prefix, so nothing here can be mistaken for a Google result.
 */
export function sampleMapAt(origin: { lat: number; lng: number }): SampleMap['places'] {
  const sample = sampleMap();
  const dLat = origin.lat - sample.clinic.lat;
  const dLng = origin.lng - sample.clinic.lng;
  return sample.places.map(place => ({
    ...place,
    lat: place.lat === null ? null : place.lat + dLat,
    lng: place.lng === null ? null : place.lng + dLng,
  }));
}

let cached: SampleMap | null = null;
export function sampleMap(): SampleMap {
  cached ??= JSON.parse(readFileSync(fileURLToPath(new URL('../../samples/network-places.sample.json', import.meta.url)), 'utf8')) as SampleMap;
  return cached;
}
