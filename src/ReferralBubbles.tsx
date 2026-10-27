// THE PRACTICE AND ITS REFERRAL CONNECTIONS, as bubbles.
//
// This is the owner-facing picture of their curated network. It is separate from the staff
// Referral Network orb: no ranking, discovery pool, or other practice's businesses appear here.
//
// Partners have equal-size bubbles because the owner gets names, not a comparison of businesses.
// The practice is the only larger bubble. On opening, partners gather at the practice and fan out
// to their positions. The motion runs once when this graph mounts and respects reduced motion.
import { useEffect, useMemo, useState } from 'react';

/**
 * Whether this reader has asked for less motion.
 *
 * The CSS rule beside this hides the <animateTransform> elements, which works in Chromium but
 * is not a specified way to stop a SMIL animation and is not dependable across browsers. So
 * the animation is not rendered at all: nothing to stop, nothing to hide.
 */
function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(() => {
    try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
  });
  useEffect(() => {
    let query: MediaQueryList;
    try { query = window.matchMedia('(prefers-reduced-motion: reduce)'); } catch { return; }
    const onChange = () => setReduced(query.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

export type Connection = { id: string; name: string; demo: boolean };

const BOX = { w: 1200, h: 800 };
const HUB = 76;
const NODE = 48;
const MAX_NODES = 25;

/** Two letters from a name, for the middle of a bubble. */
const initials = (name: string) => name.split(/\s+/).filter(Boolean)
  .map(part => part[0]).join('').slice(0, 2).toUpperCase();

/** A name too long for its bubble is split across two lines rather than clipped. */
function twoLines(name: string, perLine = 13): [string, string | null] {
  if (name.length <= perLine) return [name, null];
  const words = name.split(/\s+/);
  if (words.length === 1) return [name.slice(0, perLine), name.slice(perLine)];
  let first = '';
  for (const word of words) {
    if (first && (`${first} ${word}`).length > perLine) break;
    first = first ? `${first} ${word}` : word;
  }
  const rest = name.slice(first.length).trim();
  if (!rest) return [first, null];
  // A second line longer than the bubble is wider than the circle it sits in. The whole name
  // is in the connections list underneath, so the bubble shows as much as fits and stops.
  return [first, rest.length > perLine + 5 ? `${rest.slice(0, perLine + 4).trimEnd()}…` : rest];
}

export default function ReferralBubbles({ practice, connections }: {
  practice: string; connections: Connection[];
}) {
  const stillness = usePrefersReducedMotion();
  // Give the full practice network room to breathe. Up to 18 accounts use one broad ring;
  // larger networks use a staggered inner and outer ring. Every partner stays the same size.
  const shown = useMemo(() => connections.slice(0, MAX_NODES), [connections]);
  const hidden = connections.length - shown.length;
  const placed = useMemo(() => {
    const n = shown.length;
    if (!n) return [];

    const innerCount = n > 18 ? Math.ceil(n / 3) : 0;
    const rings = innerCount
      ? [
          { items: shown.slice(0, innerCount), rx: 255, ry: 172, offset: 0 },
          { items: shown.slice(innerCount), rx: 468, ry: 302, offset: 1 },
        ]
      : [{ items: shown, rx: n <= 8 ? 360 : 468, ry: n <= 8 ? 230 : 302, offset: 0 }];

    const out: Array<{ connection: Connection; x: number; y: number; delay: number }> = [];
    for (const ring of rings) {
      ring.items.forEach((connection, i) => {
        // Begin at the top. The outer ring is half a step out of phase with the inner ring.
        const angle = -Math.PI / 2 + (i * 2 * Math.PI) / ring.items.length
          + (ring.offset ? Math.PI / ring.items.length : 0);
        out.push({
          connection,
          x: BOX.w / 2 + Math.cos(angle) * ring.rx,
          y: BOX.h / 2 + Math.sin(angle) * ring.ry,
          delay: 0.22 + out.length * 0.032,
        });
      });
    }
    return out;
  }, [shown]);

  if (!connections.length) return <div className="bub-none">
    <strong>No referral connections yet.</strong>
    <p>Businesses matched to this practice appear here once they are released.</p>
  </div>;

  return <div className="bub">
    <svg viewBox={`0 0 ${BOX.w} ${BOX.h}`} role="img"
      aria-label={`${practice} at the centre, with ${connections.length} referral ${connections.length === 1 ? 'connection' : 'connections'}: ${connections.map(c => c.name).join(', ')}`}>
      <g aria-hidden="true">
        {placed.map(({ connection, x, y, delay }) => <line key={`l-${connection.id}`}
          className="bub-link" x1={BOX.w / 2} y1={BOX.h / 2} x2={x} y2={y}
          style={{ animationDelay: `${delay}s` }}/>) }
      </g>

      {placed.map(({ connection, x, y, delay }, index) => {
        const [one, two] = twoLines(connection.name);
        const tone = index % 5 === 2 ? ' tone-gold' : index % 5 === 4 ? ' tone-sage' : '';
        return <g key={connection.id} className={`bub-node${tone}`} transform={`translate(${x} ${y})`}>
          <title>{connection.name}</title>
          <g className="bub-fan">
            {/* The gather-and-fan: starts at the practice and settles where it belongs. */}
            {!stillness && (
            <animateTransform attributeName="transform" type="translate"
              from={`${BOX.w / 2 - x} ${BOX.h / 2 - y}`} to="0 0" dur="0.9s"
              begin={`${delay}s`} fill="freeze" calcMode="spline"
              keyTimes="0;1" keySplines=".16 1 .3 1"/>
            )}
            <circle r={NODE}/>
            <g className="bub-copy" style={{ animationDelay: `${delay + 0.18}s` }}>
              <text className="bub-initials" textAnchor="middle" y={two ? -13 : -7}>{initials(connection.name)}</text>
              <text className="bub-name" textAnchor="middle" y={two ? 6 : 12}>{one}</text>
              {two && <text className="bub-name" textAnchor="middle" y={20}>{two}</text>}
            </g>
          </g>
        </g>;
      })}

      <g className="bub-node is-hub" transform={`translate(${BOX.w / 2} ${BOX.h / 2})`}>
        <circle r={HUB}/>
        <text className="bub-hub-name" textAnchor="middle" y={-2}>{twoLines(practice, 15)[0]}</text>
        <text className="bub-hub-sub" textAnchor="middle" y={18}>Your practice</text>
      </g>
    </svg>
    {hidden > 0 && <p className="bub-note">Showing {shown.length} of {connections.length} connections. See Your businesses for the full list.</p>}
  </div>;
}
