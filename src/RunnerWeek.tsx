// THE WEEK. Seven columns, and the stops of each day inside the day itself.
//
// This is the study planner's layout: a column per day, small cards stacked in it, a total at
// the foot. A route is not an agenda somewhere below a calendar — it is what the day column
// holds. A card carries a time, a name and an icon, and nothing else; an address is something
// you want in your hand at the door, which is what the drawer is for.
//
// Dragging is the reference's behaviour on pointer events rather than HTML5 drag-and-drop,
// because this is used on a phone, where HTML5 dragging does not exist: the card you are moving
// fades, a gold line shows where it would land, and the grip appears under the cursor.
//
// One rule the study planner does not have: a stop cannot leave its round. The office decides
// which businesses are on which day; a runner decides the order they are driven in.
import { useEffect, useRef, useState } from 'react';
import { Icon, type IconName } from './Icons';
import { clockOf, durationLabel, itemName, type PlannedItem } from './lib/route-math';
import type { RunnerItem, RunnerRoute } from './lib/api';
import { runnerOutcomeLabel } from './lib/runner-outcomes';

export type DayPlan = {
  route: RunnerRoute;
  items: PlannedItem[];
  startsAt: number;
  totalMinutes: number;
  completed: number;
};

export const refOf = (item: RunnerItem) => `${item.kind}:${item.id}`;

// The tile says what KIND of stop this is and nothing else. Whether it is finished is said
// once, on the right — a tick on both sides of the same card says the same thing twice.
const tileFor = (entry: PlannedItem): IconName =>
  entry.item.kind === 'pickup' ? 'box' : 'shop';

/** What a card says under its name — the one thing worth knowing at a glance, or nothing. */
function noteFor(entry: PlannedItem) {
  if (entry.item.kind === 'pickup') {
    if (entry.late > 0) return 'After the window closes';
    if (entry.item.pickup.status === 'collected') return 'Picked up';
    return `Window ${entry.item.pickup.windowStart}–${entry.item.pickup.windowEnd}`;
  }
  if (entry.done) return entry.visit ? runnerOutcomeLabel(entry.visit.outcome, entry.visit.outcomeLabel) : 'Visited';
  if (entry.item.locked) return 'Fixed by your office';
  return null;
}

export function StopCard({ entry, roundId, dragging, busy, onOpen, onQuick, onMove, large }: {
  entry: PlannedItem;
  roundId: string;
  dragging: boolean;
  busy: boolean;
  onOpen: () => void;
  onQuick: () => void;
  /** Where to put it: one place up, one place down, or anywhere a drag lands. */
  onMove: (by: -1 | 1) => void;
  large?: boolean;
}) {
  const fixed = entry.done || entry.item.locked;
  const name = itemName(entry.item);
  // The time, the tile and the "fixed by your office" line are deliberately not on the card.
  // A runner reads this column while walking: the name is what they are looking for and the
  // tick is what they came to press. Everything else is one tap away inside the stop, and is
  // still said here to a screen reader, where it costs no room at all.
  const note = noteFor(entry);
  const spoken = `${name}. ${clockOf(entry.arriveAt)}${note ? `. ${note}` : ''}`;

  // The whole card is the drag target — there is no handle to find. `data-fixed` is how the
  // container knows a finished or locked stop stays put without reaching into React state.
  return <article
    className={`rr-card ${entry.item.kind === 'pickup' ? 'is-pickup' : ''} ${entry.done ? 'is-done' : ''} ${dragging ? 'is-source' : ''} ${fixed || busy ? 'is-fixed' : 'is-movable'}`}
    data-stop={refOf(entry.item)} data-round={roundId}
    data-fixed={fixed || busy ? 'true' : undefined}>

    <button className="rr-card-main" onClick={onOpen} aria-label={`Open ${spoken}`}
      // Press and hold moves a stop, which a keyboard cannot do. The arrow keys are the same
      // move without the holding, and they are the only way left since the menu went.
      onKeyDown={event => {
        if (fixed || busy) return;
        if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
        event.preventDefault();
        onMove(event.key === 'ArrowUp' ? -1 : 1);
      }}>
      <span className="rr-card-title">{name}</span>
    </button>

    <div className="rr-card-actions">
      {entry.done
        ? <span className="rr-card-done" role="img" aria-label={`${name}: completed`} title="Checked off">
            <Icon name="check" size={16}/>
          </span>
        : <button type="button" className="rr-card-check" onClick={onQuick}
            disabled={busy} aria-label={`Check off ${name}`} title={`Check off ${name}`}>
            <Icon name="check" size={16}/>
          </button>}
    </div>
  </article>;
}

/** The stops of one round, with the line that shows where a dragged card would land. */
export function RoundStops({ plan, label, dragKey, dropAt, busy, onOpen, onQuick, onMove, large }: {
  plan: DayPlan;
  label: string | null;
  dragKey: string | null;
  dropAt: number | null;
  busy: boolean;
  onOpen: (entry: PlannedItem) => void;
  onQuick: (entry: PlannedItem) => void;
  /** Put this stop at that index within its round. */
  onMove: (roundId: string, key: string, toIndex: number) => void;
  large?: boolean;
}) {
  return <>
    {label && <p className="rr-round-label">{label}</p>}
    {plan.items.map((entry, index) => <div key={refOf(entry.item)}>
      {dropAt === index && <div className="rr-drop-line"/>}
      <StopCard entry={entry} roundId={plan.route.id} large={large}
        dragging={dragKey === refOf(entry.item)} busy={busy}
        onOpen={() => onOpen(entry)}
        onQuick={() => onQuick(entry)}
        onMove={by => onMove(plan.route.id, refOf(entry.item), index + by)}/>
    </div>)}
    {dropAt === plan.items.length && <div className="rr-drop-line"/>}
  </>;
}

/**
 * The seven columns. Everything about a drag lives here: which card is held, and where it would
 * land. Dropping is refused across rounds, so a stop cannot change the day it was assigned to.
 */
export default function RunnerWeek({ days, today, liveDay, plansFor, busy, onOpenDay, onOpen, onQuick, onMove, practice }: {
  days: string[];
  today: string;
  /** The day worth looking at. Where the columns scroll sideways, this is the one in view. */
  liveDay: string | null;
  plansFor: (day: string) => DayPlan[];
  busy: boolean;
  onOpenDay: (day: string) => void;
  onOpen: (roundId: string, entry: PlannedItem) => void;
  onQuick: (roundId: string, entry: PlannedItem) => void;
  /** Put this stop at that index within its round. The page writes it. */
  onMove: (roundId: string, key: string, toIndex: number) => void;
  practice: string;
}) {
  const [drag, setDrag] = useState<{ key: string; roundId: string } | null>(null);
  const [drop, setDrop] = useState<{ roundId: string; index: number } | null>(null);
  const held = useRef<{ key: string; roundId: string; x: number; y: number; moved: boolean;
    armed: boolean; pointerId: number; target: HTMLElement } | null>(null);
  const grid = useRef<HTMLDivElement>(null);
  /** A drag ends with a click the browser still intends to deliver. This swallows that one. */
  const swallowClick = useRef(false);
  /**
   * Where the card would land, kept beside the state rather than only in it. `finish` runs on
   * pointerup, which can arrive in the same task as the move that set the landing — before
   * React has re-rendered and given `finish` a closure that can see it. Reading state there
   * drops fast drags on the floor; reading this does not.
   */
  const landingRef = useRef<{ roundId: string; index: number } | null>(null);
  const setLanding = (next: { roundId: string; index: number } | null) => {
    landingRef.current = next;
    setDrop(next);
  };
  const holdTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(holdTimer.current), []);

  // On a phone the seven columns scroll sideways, and the one that matters is rarely Monday.
  useEffect(() => {
    const box = grid.current;
    if (!box || !liveDay || box.scrollWidth <= box.clientWidth + 4) return;
    const column = box.querySelector<HTMLElement>(`[data-day="${liveDay}"]`);
    if (column) box.scrollTo({ left: column.offsetLeft - box.offsetLeft, behavior: 'auto' });
  }, [liveDay, days]);

  function finish() {
    const current = held.current;
    const landing = landingRef.current;
    clearTimeout(holdTimer.current);
    held.current = null;
    setDrag(null);
    setLanding(null);
    // A press that never completed its hold is a click: let it through so the stop opens.
    // Once the card has been picked up the click belongs to the pick-up and is swallowed,
    // whether or not it then travelled — holding and letting go puts the stop back, it does
    // not open it.
    if (current?.armed) swallowClick.current = true;
    if (!current?.moved || !landing || landing.roundId !== current.roundId) return;
    // The line sits BETWEEN cards, so an index past the card it came from counts one too many
    // once the card is lifted out.
    const plan = days.flatMap(plansFor).find(p => p.route.id === current.roundId);
    const from = plan?.items.findIndex(entry => refOf(entry.item) === current.key) ?? -1;
    if (from < 0) return;
    const to = from < landing.index ? landing.index - 1 : landing.index;
    if (to !== from) onMove(current.roundId, current.key, to);
  }

  return <div className="rr-grid" ref={grid}
    onClickCapture={event => {
      if (!swallowClick.current) return;
      swallowClick.current = false;
      event.preventDefault();
      event.stopPropagation();
    }}
    onPointerMove={event => {
      const current = held.current;
      if (!current) return;
      const travelled = Math.abs(event.clientY - current.y) + Math.abs(event.clientX - current.x);

      // BEFORE THE HOLD IS UP, movement means this was never a press-and-hold — a finger
      // scrolling the week, or a hand that drifted on the way to a click. Let go of it
      // entirely rather than stealing the gesture.
      if (!current.armed) {
        if (travelled >= 8) { clearTimeout(holdTimer.current); held.current = null; }
        return;
      }
      current.moved = true;
      setDrag({ key: current.key, roundId: current.roundId });
      const under = document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-stop]');
      const group = under?.getAttribute('data-round');
      if (!under || group !== current.roundId) { setLanding(null); return; }
      const siblings = Array.from(document.querySelectorAll(`[data-round="${CSS.escape(current.roundId)}"]`));
      const index = siblings.indexOf(under as Element);
      const box = under.getBoundingClientRect();
      setLanding({ roundId: current.roundId, index: event.clientY > box.top + box.height / 2 ? index + 1 : index });
    }}
    onPointerUp={finish} onPointerCancel={finish}
    onPointerDownCapture={event => {
      if (event.button !== 0 && event.pointerType === 'mouse') return;
      const from = event.target as HTMLElement;
      // The check mark is a small target that has to answer a tap every time, so a press
      // that starts on it is never the beginning of a drag.
      if (from.closest('.rr-card-actions')) return;

      // A drag's click does not always arrive — a touch drag often ends without one — and a
      // flag left standing would swallow the next real click instead, which reads as a stop
      // that refuses to open. Every press starts from nothing owed.
      swallowClick.current = false;

      const card = from.closest<HTMLElement>('[data-stop]');
      const roundId = card?.getAttribute('data-round');
      const key = card?.getAttribute('data-stop');
      if (!card || !roundId || !key || card.dataset.fixed === 'true') return;

      // CLICK OPENS, PRESS AND HOLD MOVES. The same rule for a finger and for a mouse, so
      // there is one thing to learn rather than two. Nothing is taken from the browser until
      // the hold completes: until then the press is still an ordinary click on its way to
      // opening the stop, and a swipe across the card still scrolls the week.
      held.current = { key, roundId, x: event.clientX, y: event.clientY,
        moved: false, armed: false, pointerId: event.pointerId, target: card };
      clearTimeout(holdTimer.current);
      holdTimer.current = setTimeout(() => {
        const current = held.current;
        if (!current) return;
        current.armed = true;
        // Picked up. Say so: the card lifts, and a phone taps the hand back, because a hold
        // that does nothing visible reads as a hold that did not work.
        setDrag({ key: current.key, roundId: current.roundId });
        try { current.target.setPointerCapture(current.pointerId); } catch { /* let go already */ }
        try { navigator.vibrate?.(8); } catch { /* not every device, and never required */ }
      }, 220);
    }}>
    {days.map(day => {
      const plans = plansFor(day);
      const stops = plans.reduce((total, plan) => total + plan.items.length, 0);
      const done = plans.reduce((total, plan) => total + plan.completed, 0);
      const minutes = plans.reduce((total, plan) => total + plan.totalMinutes, 0);
      const [, , date] = day.split('-');
      const weekday = new Date(`${day}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
      return <section className={`rr-day ${day === today ? 'is-today' : ''}`} key={day} data-day={day}>
        <button className="rr-day-head" onClick={() => onOpenDay(day)}
          aria-label={`Open ${weekday} ${Number(date)}`}>
          {day === today && <span className="rr-dot" aria-hidden="true"/>}
          <span className={`rr-day-name ${day === today ? 'is-today' : ''}`}>{weekday} {Number(date)}</span>
          {stops > 0 && <span className="rr-day-count">{done}/{stops}</span>}
        </button>

        <div className="rr-day-body">
          {!plans.length
            ? <p className="rr-day-empty">No route</p>
            : plans.map((plan, index) => <RoundStops key={plan.route.id} plan={plan}
                label={plans.length > 1 ? `Round ${index + 1} · ${clockOf(plan.startsAt)}` : null}
                dragKey={drag?.roundId === plan.route.id ? drag.key : null}
                dropAt={drop?.roundId === plan.route.id ? drop.index : null}
                busy={busy}
                onOpen={entry => onOpen(plan.route.id, entry)}
                onQuick={entry => onQuick(plan.route.id, entry)}
                onMove={onMove}/>)}
        </div>

        <div className="rr-day-foot">
          <div className="rr-day-sep"/>
          <p className="rr-day-total">{stops
            ? `${stops} stop${stops === 1 ? '' : 's'} · ${done} done · ${durationLabel(minutes)} est.`
            : practice ? 'Nothing assigned' : ''}</p>
        </div>
      </section>;
    })}
  </div>;
}
