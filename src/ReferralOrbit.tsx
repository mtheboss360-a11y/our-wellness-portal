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

/**
 * `group` is how the office has divided the network: the businesses on the round that is
 * coming, and the ones still waiting for a round after it. It is optional — a practice that
 * has booked nothing passes none, and the orbit lays out exactly as it did before.
 */
export type ConnectionGroup = 'routed' | 'waiting';
export type Connection = { id: string; name: string; demo: boolean; group?: ConnectionGroup };

/**
 * How many cards each ring carries, and how wide each ring is, as percentages of the stage.
 *
 * These are not taste. A card is 160px wide and the stage about 1050px, so half a card is
 * 7.6% — a ring wider than ~42% pushes its left and right cards off the edge. The
 * counts are the ellipse's perimeter divided by the width of a card, measured on the rendered
 * page. A network larger than the rings hold keeps the remainder in the list underneath:
 * shrinking the cards to fit more would make the names unreadable, and the name is the point.
 */
const RINGS = [
  { max: 6, rx: 21.5, ry: 25 },
  { max: 12, rx: 42, ry: 44 },
] as const;
const CAPACITY = RINGS.reduce((total, ring) => total + ring.max, 0);

type Placed = { connection: Connection; x: number; y: number; delay: number; ring: number };

/**
 * The SVG the lines are drawn in. It is stretched to the stage (preserveAspectRatio="none"),
 * so a ring given as a percentage of the stage becomes that percentage of these numbers —
 * which is what lets one set of constants place both the cards and the line under them.
 */
const VB = { w: 1000, h: 620 };
const svgRing = ({ rx, ry }: { rx: number; ry: number }, scale = 1) =>
  ({ rx: (rx / 100) * VB.w * scale, ry: (ry / 100) * VB.h * scale });

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

type Ring = { items: Connection[]; rx: number; ry: number; offset: number };

function lay(rings: Ring[]): Placed[] {
  const out: Placed[] = [];
  rings.forEach((ring, index) => {
    if (!ring.items.length) return;
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
        ring: index,
      });
    });
  });
  return out;
}

/**
 * Lay the connections out from the inside ring outwards, each ring starting at the top.
 * Exported for the tests: which ring a card lands on is the whole meaning of the split, and
 * that is worth holding still.
 */
export function place(shown: Connection[]): Placed[] {
  const routed = shown.filter(c => c.group === 'routed');
  const waiting = shown.filter(c => c.group === 'waiting');

  // When the office has split the network into the round that is coming and the rest, the two
  // ride their own rings — the round on the inside, nearer the practice, which is the whole
  // point of looking at this screen before walking out of the door. It only holds while the
  // round fits the inner ring; beyond that the split would lie about which card is which, so
  // the plain layout takes over and the legend is not drawn.
  if (routed.length && waiting.length && routed.length <= RINGS[0].max) {
    return lay([
      { items: routed, rx: RINGS[0].rx, ry: RINGS[0].ry, offset: 0 },
      { items: waiting.slice(0, RINGS[1].max), rx: RINGS[1].rx, ry: RINGS[1].ry, offset: 1 },
    ]);
  }

  // A small network looks lost on two rings, so it uses the outer one alone.
  return shown.length <= RINGS[1].max
    ? lay([{ items: shown, rx: shown.length <= 4 ? 33 : RINGS[1].rx, ry: shown.length <= 4 ? 30 : RINGS[1].ry, offset: 0 }])
    : lay([{ items: shown.slice(0, RINGS[0].max), ...RINGS[0], offset: 0 },
           { items: shown.slice(RINGS[0].max), ...RINGS[1], offset: 1 }]);
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

export default function ReferralOrbit({ practice, connections, routedLabel, waitingLabel }: {
  practice: string; connections: Connection[];
  /** What the two rings are called. Both are needed before the legend is drawn. */
  routedLabel?: string; waitingLabel?: string;
}) {
  const stillness = usePrefersReducedMotion();
  const shown = useMemo(() => connections.slice(0, CAPACITY), [connections]);
  const placed = useMemo(() => place(shown), [shown]);
  const hidden = connections.length - shown.length;
  const samples = shown.filter(c => c.demo).length;

  // The legend is drawn only when the layout actually split, so it can never name two rings
  // that are not there. `place` decides that, and this reads its answer rather than repeating
  // the condition and risking the two drifting apart.
  const onInner = placed.filter(p => p.ring === 0 && p.connection.group === 'routed').length;
  const onOuter = placed.filter(p => p.ring === 1 && p.connection.group === 'waiting').length;
  const split = Boolean(routedLabel && waitingLabel && onInner > 0 && onOuter > 0);

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

    {split && <p className="orb2-legend">
      <span className="orb2-key orb2-key-routed" aria-hidden="true"/>{routedLabel} ({onInner})
      <span className="orb2-key orb2-key-waiting" aria-hidden="true"/>{waitingLabel} ({onOuter})
    </p>}

    <div className="orb2-stage">
      {/* The path they ride. Decorative: every name is in the list beside it. */}
      {/* The loop: thin layered lines rather than one band, so it reads as a path the cards
          sit on and not as a container drawn around them.

          The radii come from RINGS rather than being typed in, because a line that does not
          pass through the cards is worse than no line. They were hand-set before and sat ten
          units inside the cards, with three more rings at radii nothing was on. */}
      <svg className="orb2-ring" viewBox={`0 0 ${VB.w} ${VB.h}`} preserveAspectRatio="none" aria-hidden="true">
        <ellipse className="orb2-ring-wash" cx={VB.w / 2} cy={VB.h / 2} {...svgRing(RINGS[1])}/>
        <ellipse className="orb2-ring-line" cx={VB.w / 2} cy={VB.h / 2} {...svgRing(RINGS[1])}/>
        <ellipse className="orb2-ring-sage" cx={VB.w / 2} cy={VB.h / 2} {...svgRing(RINGS[1], 0.955)}/>
        {/* The inner path exists only when there are cards on it. */}
        {placed.some(p => p.ring === 0) &&
          <ellipse className="orb2-ring-faint" cx={VB.w / 2} cy={VB.h / 2} {...svgRing(RINGS[0])}/>}
      </svg>

      <div className="orb2-hub">
        <span className="orb2-hub-name">{practice}</span>
      </div>

      <ul className="orb2-list">
        {placed.map(({ connection, x, y, delay }) => <li key={connection.id}
          className={`orb2-card${out ? ' is-out' : ''}${split && connection.group ? ` orb2-card-${connection.group}` : ''}`}
          // Until it travels out, a card sits on the practice in the middle of the stage.
          // The two positions are percentages of the same box, so the move scales with it.
          style={{ left: out ? `${x}%` : '50%', top: out ? `${y}%` : '50%',
            transitionDelay: stillness ? '0ms' : `${delay}s` }}>
          <span className="orb2-name" title={connection.name}>{connection.name}</span>
          {connection.demo && <span className="sr-only"> (sample)</span>}
          {/* The rings carry meaning once the layout splits, and a ring is not readable
              aloud. The same fact goes on the card as words. */}
          {split && connection.group && <span className="sr-only">
            {' '}({connection.group === 'routed' ? routedLabel : waitingLabel})
          </span>}
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
