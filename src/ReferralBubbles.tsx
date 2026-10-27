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

const BOX = { w: 1280, h: 960 };
const HUB = 84;
const NODE = 62;
const MAX_NODES = 25;

/** Two letters from a name, for the middle of a bubble. */
const initials = (name: string) => name.split(/\s+/).filter(Boolean)
  .map(part => part[0]).join('').slice(0, 2).toUpperCase();

/** A name too long for its bubble is split across two lines rather than clipped. */
function twoLines(name: string, perLine = 13): [string, string | null] {
  if (name.length <= perLine) return [name, null];
  // A name with no spaces cannot be split on one, so it is cut at the same width as any other
  // second line — without this it ran wider than the circle it sits in.
  const words = name.split(/\s+/);
  if (words.length === 1) return [name.slice(0, perLine), cap(name.slice(perLine), perLine)];
  let first = '';
  for (const word of words) {
    if (first && (`${first} ${word}`).length > perLine) break;
    first = first ? `${first} ${word}` : word;
  }
  const rest = name.slice(first.length).trim();
  if (!rest) return [first, null];
  return [first, cap(rest, perLine)];
}

/** A second line wider than the bubble is cut; the whole name is in the list underneath. */
const cap = (line: string, perLine: number) =>
  line.length > perLine + 5 ? `${line.slice(0, perLine + 4).trimEnd()}…` : line;

export default function ReferralBubbles({ practice, connections }: {
  practice: string; connections: Connection[];
}) {
  const stillness = usePrefersReducedMotion();
  // Keep the nodes large enough to read at normal dashboard width. Larger networks use a
  // second, staggered ring rather than shrinking every bubble to fit. The ring radii and the
  // height of the box are the ones measured to keep every count from 1 to 25 clear of its
  // neighbours, of the hub and of the edge of the box — at 25 the margin is thinnest, and the
  // live practice is at 25.
  const shown = useMemo(() => connections.slice(0, MAX_NODES), [connections]);
  const hidden = connections.length - shown.length;
  const placed = useMemo(() => {
    const n = shown.length;
    if (!n) return [];

    const innerCount = n > 14 ? Math.ceil(n / 3) : 0;
    const rings = innerCount
      ? [
          { items: shown.slice(0, innerCount), rx: 310, ry: 215, offset: 0 },
          { items: shown.slice(innerCount), rx: 566, ry: 400, offset: 1 },
        ]
      : [{ items: shown, rx: n <= 8 ? 390 : 566, ry: n <= 8 ? 225 : 400, offset: 0 }];

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
        const tone = ['tone-blue', '', 'tone-gold', 'tone-peach', 'tone-sage'][index % 5];
        return <g key={connection.id} className={`bub-node ${tone}`} transform={`translate(${x} ${y})`}>
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
              <text className="bub-initials" textAnchor="middle" y={two ? -16 : -8}>{initials(connection.name)}</text>
              <text className="bub-name" textAnchor="middle" y={two ? 8 : 15}>{one}</text>
              {two && <text className="bub-name" textAnchor="middle" y={25}>{two}</text>}
            </g>
          </g>
        </g>;
      })}

      <g className="bub-node is-hub" transform={`translate(${BOX.w / 2} ${BOX.h / 2})`}>
        <circle r={HUB}/>
        <text className="bub-hub-name" textAnchor="middle" y={-10}>{twoLines(practice, 15)[0]}</text>
        {twoLines(practice, 15)[1] && <text className="bub-hub-name" textAnchor="middle" y={9}>{twoLines(practice, 15)[1]}</text>}
        <text className="bub-hub-sub" textAnchor="middle" y={34}>Your practice</text>
      </g>
    </svg>
    {hidden > 0 && <p className="bub-note">Showing {shown.length} of {connections.length} connections. See Your businesses for the full list.</p>}
  </div>;
}
