// The sample clinic's Network Map. A demo account never spends a Google Places call: its map is
// a fixed set of fictional businesses (samples/network-places.sample.json), loaded on open.
// Which clinics are samples: SAMPLE_CLINICS (comma-separated slugs), default orchard-lantern.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { DiscoveredPlace } from './places';

type SampleMap = { clinic: { label: string; lat: number; lng: number }; places: DiscoveredPlace[] };

export const sampleClinicIds = () => (process.env.SAMPLE_CLINICS ?? 'orchard-lantern').split(',').map(id => id.trim()).filter(Boolean);
export const isSampleClinic = (clinicId: string) => sampleClinicIds().includes(clinicId);

let cached: SampleMap | null = null;
export function sampleMap(): SampleMap {
  cached ??= JSON.parse(readFileSync(fileURLToPath(new URL('../../samples/network-places.sample.json', import.meta.url)), 'utf8')) as SampleMap;
  return cached;
}
