// THE SHAPE OF A ROUND. The stops, in order, with the practice at the start.
//
// NOT A MAP, and it does not pretend to be one. There is no basemap, no streets and no tiles:
// the portal's Places key is a server key and is never sent to a browser, so there is nothing
// here but our own coordinates plotted in a box. What it is good for is the question a rep
// actually asks before setting off — am I going in a sensible loop, or doubling back — and
// the caption says as much rather than letting the picture imply more than it knows.
//
// This is deliberately NOT the Referral Network orb. That component, its ranking and its
// matching engine are untouched; this draws a different thing for a different screen.
//
// A stop without a coordinate cannot be drawn. It is listed under the plot by name instead of
// being dropped silently or given a position somebody invented.
import { useMemo } from 'react';
import type { PlannedStop } from './lib/round-math';

const BOX = { w: 320, h: 300, pad: 34 };

export default function RoutePlot({ stops, clinic, onPick }: {
  stops: PlannedStop[];
  clinic: { lat: number; lng: number } | null;
  onPick?: (businessId: string) => void;
}) {
  const plot = useMemo(() => {
    const placed = stops.filter(stop => stop.located);
    if (!placed.length || !clinic) return null;

    const points = [
      { lat: clinic.lat, lng: clinic.lng },
      ...placed.map(stop => ({ lat: stop.business.lat!, lng: stop.business.lng! })),
    ];
    const lats = points.map(p => p.lat), lngs = points.map(p => p.lng);
    const minLat = Math.min(...lats), maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);

    // Longitude degrees are shorter than latitude degrees this far north. Correcting for it is
    // the difference between a route that looks like the drive and one stretched sideways.
    const squash = Math.cos((minLat + maxLat) / 2 * Math.PI / 180);
    const spanLat = Math.max(maxLat - minLat, 1e-4);
    const spanLng = Math.max((maxLng - minLng) * squash, 1e-4);
    const scale = Math.min((BOX.w - BOX.pad * 2) / spanLng, (BOX.h - BOX.pad * 2) / spanLat);

    const at = (lat: number, lng: number) => ({
      x: BOX.w / 2 + ((lng - (minLng + maxLng) / 2) * squash) * scale,
      // Screen y grows downward; latitude grows north. Flip it, or the route is upside down.
      y: BOX.h / 2 - (lat - (minLat + maxLat) / 2) * scale,
    });

    return {
      start: at(clinic.lat, clinic.lng),
      stops: placed.map(stop => ({ stop, ...at(stop.business.lat!, stop.business.lng!) })),
    };
  }, [stops, clinic]);

  const missing = stops.filter(stop => !stop.located).map(stop => stop.business.name);

  if (!plot) return <div className="plot-none">
    <p>No map positions yet, so the shape of this round can’t be drawn. Every stop still routes
      by its street address.</p>
  </div>;

  const path = [plot.start, ...plot.stops].map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`).join(' ');

  return <div className="plot">
    <svg viewBox={`0 0 ${BOX.w} ${BOX.h}`} role="img"
      aria-label={`The round's shape: ${plot.stops.length} stops from the practice`}>
      <path d={path} className="plot-line"/>
      <g className="plot-home">
        <circle cx={plot.start.x} cy={plot.start.y} r="9"/>
        <circle cx={plot.start.x} cy={plot.start.y} r="3.5" className="plot-home-dot"/>
      </g>
      {plot.stops.map(({ stop, x, y }) => <g key={stop.business.id}
        className={`plot-stop ${stop.done ? 'is-done' : ''} ${onPick ? 'is-live' : ''}`}
        onClick={onPick ? () => onPick(stop.business.id) : undefined}
        role={onPick ? 'button' : undefined} tabIndex={onPick ? 0 : undefined}
        onKeyDown={onPick ? event => { if (event.key === 'Enter') onPick(stop.business.id); } : undefined}>
        <title>{stop.business.name}</title>
        <circle cx={x} cy={y} r="13"/>
        <text x={x} y={y + 4} textAnchor="middle">{stop.index + 1}</text>
      </g>)}
    </svg>

    <p className="plot-note">
      Straight lines between stops, not a driven route — it shows the shape of the round, not
      the roads.
    </p>
    {missing.length > 0 && <p className="plot-note">
      Not drawn, no map position: {missing.join(', ')}.
    </p>}
  </div>;
}
