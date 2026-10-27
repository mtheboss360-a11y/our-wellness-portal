// THE PRACTICE AND ITS REFERRAL CONNECTIONS, as an orbit.
//
// The practice sits in the middle and its connections ride a path around it. This replaced the
// bubble graph: a circle big enough to hold a business name is a large circle, and twenty-five
// of them crowd. A name card is the shape the name actually wants.
//
// It is built as positioned HTML over one SVG ring rather than as SVG text. A card then gets
// real text layout — wrapping, ellipsis, the font stack everything else uses — and a screen
// reader gets a list of business names instead of a picture it has to be told about.
//
// Positions are percentages of the stage, so the whole thing scales with its container and
// nothing has to be recomputed on resize.
import { useEffect, useMemo, useRef, useState } from 'react';

export type Connection = { id: string; name: string; demo: boolean };

/** Two letters from a name, for the chip on the card. */
const initials = (name: string) => name.split(/\s+/).filter(Boolean)
  .map(part => part[0]).join('').slice(0, 2).toUpperCase();

/**
 * How many cards each ring carries, and how wide each ring is, as percentages of the stage.
 *
 * These are not taste. A card is about 180px wide and the stage is about 1050px, so half a
 * card is 8.5% — a ring wider than ~41% pushes its left and right cards off the edge. The
 * counts are the ellipse's perimeter divided by the width of a card, measured on the rendered
 * page. A network larger than the rings hold keeps the remainder in the list underneath:
 * shrinking the cards to fit more would make the names unreadable, and the name is the point.
 */
const RINGS = [
  { max: 5, rx: 23, ry: 25 },
  { max: 9, rx: 39.5, ry: 44 },
] as const;
const CAPACITY = RINGS.reduce((total, ring) => total + ring.max, 0);

type Placed = { connection: Connection; x: number; y: number; delay: number };

/**
 * Angles at which an ellipse is cut into `count` pieces of EQUAL ARC LENGTH.
 *
 * Even angles are not even spacing on an ellipse — they bunch the cards at the two ends,
 * which is exactly where the first overlap appeared. So the perimeter is walked once and the
 * cuts are taken at equal distances along it.
 */
function evenlySpaced(count: number, rx: number, ry: number, from: number): number[] {
  const STEPS = 2048;
  const lengths = [0];
  for (let i = 1; i <= STEPS; i++) {
    const a = (i - 1) * 2 * Math.PI / STEPS, b = i * 2 * Math.PI / STEPS;
    lengths.push(lengths[i - 1] + Math.hypot(rx * (Math.cos(b) - Math.cos(a)), ry * (Math.sin(b) - Math.sin(a))));
  }
  const total = lengths[STEPS];
  const out: number[] = [];
  let at = 0;
  for (let i = 0; i < count; i++) {
    const target = (i * total) / count;
    while (at < STEPS && lengths[at + 1] < target) at++;
    out.push(from + (at * 2 * Math.PI) / STEPS);
  }
  return out;
}

/** Lay the connections out from the inside ring outwards, each ring starting at the top. */
function place(shown: Connection[]): Placed[] {
  // A small network looks lost on two rings, so it uses the outer one alone.
  const rings = shown.length <= RINGS[1].max
    ? [{ items: shown, rx: shown.length <= 4 ? 32 : RINGS[1].rx, ry: shown.length <= 4 ? 30 : RINGS[1].ry, offset: 0 }]
    : [{ items: shown.slice(0, RINGS[0].max), ...RINGS[0], offset: 0 },
       { items: shown.slice(RINGS[0].max), ...RINGS[1], offset: 1 }];

  const out: Placed[] = [];
  for (const ring of rings) {
    // Start at the top, and put the outer ring half a step out of phase with the inner one
    // so a card never sits directly outside another.
    const from = -Math.PI / 2 + (ring.offset ? Math.PI / ring.items.length : 0);
    const angles = evenlySpaced(ring.items.length, ring.rx, ring.ry, from);
    ring.items.forEach((connection, i) => {
      out.push({
        connection,
        x: 50 + Math.cos(angles[i]) * ring.rx,
        y: 50 + Math.sin(angles[i]) * ring.ry,
        delay: 0.1 + out.length * 0.03,
      });
    });
  }
  return out;
}

/** Whether this reader has asked for less motion. Read once, then kept in step with the setting. */
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

export default function ReferralOrbit({ practice, connections }: {
  practice: string; connections: Connection[];
}) {
  const stillness = usePrefersReducedMotion();
  const shown = useMemo(() => connections.slice(0, CAPACITY), [connections]);
  const placed = useMemo(() => place(shown), [shown]);
  const hidden = connections.length - shown.length;
  const samples = shown.filter(c => c.demo).length;

  // The cards begin gathered at the practice and travel out to their places. The flag flips
  // one frame after mount, so the browser has a start position to animate away from.
  //
  // A frame is not guaranteed to arrive: requestAnimationFrame does not run while the tab is
  // in the background, and the cards start invisible — so on a dashboard opened in a
  // background tab they stayed stacked on the practice and never appeared. A timer runs
  // alongside it as the safety net. Whichever fires first puts them in place; the animation
  // is the nicety, being visible is not.
  const [out, setOut] = useState(false);
  const frame = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    if (stillness) { setOut(true); return; }
    setOut(false);
    frame.current = requestAnimationFrame(() => { frame.current = requestAnimationFrame(() => setOut(true)); });
    timer.current = setTimeout(() => setOut(true), 250);
    return () => { cancelAnimationFrame(frame.current); clearTimeout(timer.current); };
  }, [stillness, placed]);

  if (!connections.length) return <div className="orb2-none">
    <strong>No referral connections yet.</strong>
    <p>Businesses matched to this practice appear here once they are released.</p>
  </div>;

  return <div className="orb2">
    <p className="orb2-eyebrow">Referral connections{samples > 0 && ' · includes sample data'}</p>

    <div className="orb2-stage">
      {/* The path they ride. Decorative: every name is in the list beside it. */}
      <svg className="orb2-ring" viewBox="0 0 1000 620" preserveAspectRatio="none" aria-hidden="true">
        <ellipse className="orb2-ring-halo" cx="500" cy="310" rx="410" ry="273"/>
        <ellipse className="orb2-ring-line" cx="500" cy="310" rx="410" ry="273"/>
        <ellipse className="orb2-ring-inner" cx="500" cy="310" rx="230" ry="155"/>
      </svg>

      <div className="orb2-hub">
        <span className="orb2-hub-mark" aria-hidden="true"/>
        <span className="orb2-hub-name">{practice}</span>
        <span className="orb2-hub-sub">Your starting point</span>
      </div>

      <ul className="orb2-list">
        {placed.map(({ connection, x, y, delay }) => <li key={connection.id}
          className={`orb2-card${out ? ' is-out' : ''}`}
          // Until it travels out, a card sits on the practice in the middle of the stage.
          // The two positions are percentages of the same box, so the move scales with it.
          style={{ left: out ? `${x}%` : '50%', top: out ? `${y}%` : '50%',
            transitionDelay: stillness ? '0ms' : `${delay}s` }}>
          <span className="orb2-chip" aria-hidden="true">{initials(connection.name)}</span>
          <span className="orb2-name" title={connection.name}>{connection.name}</span>
          {connection.demo && <span className="sr-only"> (sample)</span>}
        </li>)}
      </ul>
    </div>

    <p className="orb2-note">
      {hidden > 0
        ? `Showing ${shown.length} of ${connections.length} connections — the full list is below.`
        : `${connections.length} ${connections.length === 1 ? 'connection' : 'connections'} released to your practice.`}
      {samples > 0 && ` ${samples} of those shown ${samples === 1 ? 'is' : 'are'} sample data.`}
    </p>
  </div>;
}
