// Distance maths for the Network Map. Ported from the FleetFinder geo helpers so the two
// products measure distance the same way, with the same guard against the trap that made
// that port necessary: `Number(null)`, `Number('')` and `Number([])` are all 0, so a MISSING
// coordinate silently became a real one off the coast of Africa and the distance came back
// confident and wrong. A missing coordinate has to read as missing.

const EARTH_RADIUS_MILES = 3958.7613;
const toRad = (degrees: number) => (degrees * Math.PI) / 180;

/** A coordinate, or null when the value is not one. */
export function coord(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null; }
  return null;
}

/** Great-circle distance in statute miles, or NaN when any coordinate is missing. */
export function haversineMiles(aLat: unknown, aLng: unknown, bLat: unknown, bLng: unknown) {
  const a1 = coord(aLat), a2 = coord(aLng), b1 = coord(bLat), b2 = coord(bLng);
  if (a1 === null || a2 === null || b1 === null || b2 === null) return NaN;
  const dLat = toRad(b1 - a1), dLng = toRad(b2 - a2);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a1)) * Math.cos(toRad(b1)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** True when the point is inside the circle. A missing coordinate is NOT inside. */
export function withinRadius(lat: unknown, lng: unknown, centerLat: number, centerLng: number, radiusMiles: number) {
  const distance = haversineMiles(centerLat, centerLng, lat, lng);
  return Number.isFinite(distance) && distance <= radiusMiles;
}

export const milesToMetres = (miles: number) => Math.round(miles * 1609.344);

/**
 * Where a point sits on the map plot: -1..1 east/west and -1..1 north/south, relative to a
 * circle of `radiusMiles` about the centre. Longitude degrees shrink as latitude rises, so
 * the cosine correction is what keeps the plot from stretching east-west.
 */
export function plotOffset(centerLat: number, centerLng: number, lat: number, lng: number, radiusMiles: number) {
  const latMiles = (lat - centerLat) * 69.055;
  const lngMiles = (lng - centerLng) * 69.055 * Math.cos(toRad(centerLat));
  const span = Math.max(0.01, radiusMiles);
  return { x: lngMiles / span, y: -latMiles / span };
}
