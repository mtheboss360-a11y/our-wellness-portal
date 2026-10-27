// THE PRACTICE AND ITS REFERRAL CONNECTIONS, as bubbles.
//
// NOT THE REFERRAL NETWORK ORB. That component, its ranking and its matching engine are
// untouched and share no code with this. This is a different drawing for a different reader:
// the orb ranks businesses for a staff member choosing where to go, while this shows a
// practice owner who is in their network, and nothing else.
//
// BUBBLE SIZE CARRIES NO MEANING. Every partner is the same size, deliberately. A bubble
// larger than its neighbour reads as "this one is worth more", and we do not publish a
// per-business figure to an owner — so the drawing must not imply one. Only the practice at
// the centre is bigger, because it is the practice.
//
// On opening, the partners gather at the centre and fan out to where they belong. Once per
// opening, and not at all for a reader who has asked for less motion.
import { useMemo } from 'react';

export type Connection = { id: string; name: string; demo: boolean };

const BOX = { w: 900, h: 460 };
const HUB = 76;
const NODE = 50;

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
  return [first, name.slice(first.length).trim() || null];
}

export default function ReferralBubbles({ practice, connections }: {
  practice: string; connections: Connection[];
}) {
  // HOW MANY FIT. One ring reads well up to eight; past that the names collide and the point
  // of the drawing — being able to read who is in the network — is lost. So it goes to two
  // rings, and past sixteen it stops and says how many are not drawn rather than shrinking
  // every bubble until none of them can be read.
  const MOST = 16;
  const shown = connections.slice(0, MOST);
  const hidden = connections.length - shown.length;

  const placed = useMemo(() => {
    const n = shown.length;
    if (!n) return [];
    // Two rings once there are more than eight, the inner one holding the first third.
    const rings = n > 8
      ? [{ take: Math.ceil(n / 3), rx: 196, ry: 96 }, { take: n, rx: 352, ry: 168 }]
      : [{ take: n, rx: Math.min(330, 150 + n * 26), ry: Math.min(150, 74 + n * 14) }];

    const out: Array<{ connection: Connection; x: number; y: number; delay: number }> = [];
    let from = 0;
    for (const ring of rings) {
      const slice = shown.slice(from, ring.take);
      slice.forEach((connection, i) => {
        // Start at the top; offset the outer ring so it does not sit behind the inner one.
        const angle = (-Math.PI / 2) + (i * 2 * Math.PI) / slice.length
          + (from ? Math.PI / slice.length : 0);
        out.push({
          connection,
          x: BOX.w / 2 + Math.cos(angle) * ring.rx,
          y: BOX.h / 2 + Math.sin(angle) * ring.ry,
          delay: 0.26 + out.length * 0.05,
        });
      });
      from = ring.take;
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
          style={{ animationDelay: `${delay}s` }}/>)}
      </g>

      {placed.map(({ connection, x, y, delay }) => {
        const [one, two] = twoLines(connection.name);
        return <g key={connection.id} className="bub-node" transform={`translate(${x} ${y})`}>
          <g className="bub-fan">
            {/* The gather-and-fan: starts at the practice, settles where it belongs. */}
            <animateTransform attributeName="transform" type="translate"
              from={`${BOX.w / 2 - x} ${BOX.h / 2 - y}`} to="0 0" dur="0.9s"
              begin={`${delay}s`} fill="freeze" calcMode="spline"
              keyTimes="0;1" keySplines=".16 1 .3 1"/>
            <circle r={NODE}/>
            <g className="bub-copy" style={{ animationDelay: `${delay + 0.22}s` }}>
              <text className="bub-initials" textAnchor="middle" y={two ? -14 : -8}>{initials(connection.name)}</text>
              <text className="bub-name" textAnchor="middle" y={two ? 6 : 12}>{one}</text>
              {two && <text className="bub-name" textAnchor="middle" y={21}>{two}</text>}
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

    <p className="bub-note">
      <span className="bub-key" aria-hidden="true"/>
      Each bubble is a business in your referral network. Bubble size carries no figure.
      {hidden > 0 && ` ${hidden} more ${hidden === 1 ? 'is' : 'are'} in the list below.`}
    </p>
  </div>;
}
