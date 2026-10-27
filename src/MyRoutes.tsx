// MY ROUTES — the route runner's week.
//
// This is the whole job on one screen: the days of the week, the day's stops in the order they
// will be driven, what to bring, and the way into each conversation. It is the standalone
// planner that was designed for it, rebuilt on the portal's own data: the stops are the
// businesses the office released and assigned, the scripts are the approved ones, and every
// change is saved to the database rather than to this browser.
//
// What a runner may change here, and nothing else:
//
//   - the ORDER of the stops on a day of theirs;
//   - the PICKUPS they put among them — treats, materials, supplies;
//   - what they CONFIRM they are carrying, and what they recorded DROPPING.
//
// What they cannot: add or remove an assigned business, move one to another date, change the
// start time the office set, raise their own allocation, or touch anybody else's route. The
// server refuses each of those whatever this screen sends; the screen simply does not offer them.
//
// Times here are arithmetic, not navigation. There is no routing provider behind this portal, so
// a leg between two known coordinates is estimated from the distance and everything else gets a
// flat allowance — and the screen says which, every time.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  collectPickup, confirmPacked, getRunnerBusiness, getRunnerRoutes, recordRunnerVisit,
  removePickup, reorderRoute, savePickup, RouteChanged,
  type PickupDraft, type PickupKind, type RunnerItem, type RunnerPayload, type RunnerRoute,
  type Supplies, type Visit,
} from './lib/api';
import {
  addDays, attributeVisits, clockOf, durationLabel, isoOf, itemAddress, itemName, longDate,
  minutesNowIn, mondayOf, planRoute, shortDate, weekLabel, WEEKDAY, TRAVEL_ALLOWANCE,
  type PlannedItem,
} from './lib/route-math';
import { Icon, type IconName } from './Icons';
import GuidedVisit, { type VisitSubmission } from './GuidedVisit';

const SUPPLIES: Array<{ key: keyof Supplies; label: string }> = [
  { key: 'flyers', label: 'Flyers' },
  { key: 'treats', label: 'Treats / food' },
  { key: 'cards', label: 'Referral cards' },
];

const PICKUP_LABEL: Record<PickupKind, string> = {
  treats: 'Treats / food', materials: 'Flyers / marketing materials', other: 'Other supplies',
};

const refOf = (item: RunnerItem) => `${item.kind}:${item.id}`;

const directionsTo = (item: RunnerItem) => {
  const destination = item.kind === 'business' && item.business.lat !== null && item.business.lng !== null
    ? `${item.business.lat},${item.business.lng}`
    : itemAddress(item);
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}&travelmode=driving`;
};

type Drawer =
  | { kind: 'pickup'; pickupId?: string }
  /** Collecting one, which is a different job from editing it. */
  | { kind: 'collect'; pickupId: string }
  | { kind: 'supplies' }
  | { kind: 'timing' };

export default function MyRoutes({ today, timezone }: { today: string; timezone: string }) {
  const [data, setData] = useState<RunnerPayload | null>(null);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(today);
  const [week, setWeek] = useState(() => mondayOf(today));
  const [picked, setPicked] = useState(false);
  const [chosenRound, setChosenRound] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<Drawer | null>(null);
  const [visiting, setVisiting] = useState<string | null>(null);
  const [toast, setToast] = useState('');
  const [confirming, setConfirming] = useState<{ title: string; text: string; run: () => void } | null>(null);
  // The order the runner has just dragged into place, held only until the server answers.
  const [pending, setPending] = useState<{ roundId: string; items: RunnerItem[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const toastTimer = useRef<number>(0);

  const say = useCallback((text: string) => {
    setToast(text);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(''), 3200);
  }, []);
  useEffect(() => () => window.clearTimeout(toastTimer.current), []);

  const load = useCallback(() => {
    setError('');
    return getRunnerRoutes().then(setData)
      .catch(e => setError(e instanceof Error ? e.message : 'We couldn’t open your routes.'));
  }, []);
  useEffect(() => { void load(); }, [load]);

  // The day that opens is the one with work on it: today where there is a route, else the next
  // one booked, else the most recent. Only once, so it never steals the day a runner picked.
  useEffect(() => {
    if (!data || picked) return;
    const dates = data.routes.map(r => r.date).sort();
    const day = dates.includes(today) ? today : dates.find(d => d > today) ?? dates.at(-1) ?? today;
    setSelected(day); setWeek(mondayOf(day)); setPicked(true); setChosenRound(null);
  }, [data, picked, today]);

  const onThisDay = useMemo(
    () => (data?.routes ?? []).filter(r => r.date === selected),
    [data, selected]);
  // Two rounds can be booked on one day. The first is opened, and the others are offered rather
  // than hidden — which is what taking routes.find() did.
  const route = onThisDay.find(r => r.id === chosenRound) ?? onThisDay[0] ?? null;
  const items = pending && route && pending.roundId === route.id ? pending.items : route?.items ?? [];

  // Which round each recorded visit belongs to. Worked out across every route at once, because
  // the same business can be on more than one of them and a visit belongs to exactly one.
  const attributed = useMemo(
    () => attributeVisits(data?.routes ?? [], data?.visits ?? []),
    [data]);

  const plan = useMemo(() => route
    ? planRoute({ ...route, items }, data?.visits ?? [], {
        clinic: data?.clinic ?? null, today, attributed,
        // The practice's clock. A phone set to another zone would otherwise mark the wrong
        // stop as the one somebody should be standing in front of.
        nowMinutes: minutesNowIn(timezone) ?? undefined,
      })
    : null, [route, items, data, today, attributed, timezone]);

  const done = useMemo(() => new Set((plan?.items ?? []).filter(i => i.done).map(i => refOf(i.item))), [plan]);

  /** Put a route the server has just returned back into the week, and drop any optimistic order. */
  const replace = useCallback((saved: RunnerRoute) => {
    setData(current => current && {
      ...current, routes: current.routes.map(r => r.id === saved.id ? saved : r),
    });
    setPending(null);
  }, []);

  /** Every write goes through here: optimistic where it has an order to show, rolled back on failure. */
  const write = useCallback(async (action: () => Promise<{ route: RunnerRoute }>, success: string) => {
    setBusy(true);
    try {
      const result = await action();
      replace(result.route);
      say(success);
      return true;
    } catch (e) {
      setPending(null);
      if (e instanceof RouteChanged) {
        if (e.route) replace(e.route); else await load();
        say(e.message);
      } else {
        say(e instanceof Error ? e.message : 'That change could not be saved.');
      }
      return false;
    } finally { setBusy(false); }
  }, [replace, say, load]);

  const commitOrder = useCallback(async (next: RunnerItem[]) => {
    if (!route) return;
    setPending({ roundId: route.id, items: next });
    await write(() => reorderRoute(route.id, next.map(item => ({ kind: item.kind, id: item.id })), route.revision),
      'Order saved. The times have been worked out again.');
  }, [route, write]);

  // ── The guided visit takes the whole screen, and comes back here ──────────
  if (visiting && route && plan) {
    const at = plan.items.findIndex(i => i.item.kind === 'business' && i.item.business.id === visiting);
    const after = plan.items.slice(at + 1).find(i => !i.done);
    const save = async (draft: VisitSubmission) => {
      const result = await recordRunnerVisit({
        roundId: route.id,
        businessId: draft.businessId, visitedOn: draft.visitedOn, spokeWith: draft.spokeWith,
        contactRole: draft.contactRole, outcome: draft.outcome,
        dropped: draft.dropped ?? { flyers: 0, treats: 0, cards: 0 },
        note: draft.note, nextAction: draft.nextAction, followUpOn: draft.followUpOn,
        clientRef: draft.clientRef,
      });
      if (result.route) replace(result.route);
      return { visit: result.visit, business: result.business };
    };
    return <main className="rr-wrap">
      <div className="plan-b rr-visit">
        <GuidedVisit
          businessId={visiting}
          today={today}
          staffName={data?.runner.name ?? null}
          load={id => getRunnerBusiness(route.id, id)}
          save={save}
          materials={{ remaining: route.remaining, confirmed: route.supplies.packed !== null }}
          onClose={() => { setVisiting(null); void load(); }}
          onNext={after ? () => {
            // Whatever is actually next: another door, or the bakery between here and it.
            if (after.item.kind === 'business') setVisiting(after.item.business.id);
            else { setVisiting(null); setDrawer({ kind: 'collect', pickupId: after.item.id }); }
          } : undefined}
          nextLabel={after ? `Next: ${itemName(after.item)}` : undefined}/>
      </div>
    </main>;
  }

  const days = Array.from({ length: 7 }, (_, index) => addDays(week, index));

  return <main className="rr-wrap">
    <p className="rr-eyebrow">Field operations / Weekly planner</p>
    <div className="rr-title">
      <div>
        <h1>My routes<span>.</span></h1>
        <p>Everything you need for your round. Arrange your stops, add a pickup, check your
          supplies, then get moving.</p>
      </div>
      <div className="rr-title-actions">
        <button className="rr-btn rr-btn-outline" onClick={() => window.print()}>
          <Icon name="notebook" size={15}/>Print
        </button>
        <button className="rr-btn rr-btn-outline" disabled={!plan || !route}
          onClick={() => void copyItinerary(route, plan, data, say)}>
          <Icon name="route" size={15}/>Copy route
        </button>
        <button className="rr-btn rr-btn-primary" disabled={!route}
          onClick={() => setDrawer({ kind: 'pickup' })}>
          <Icon name="plus" size={15}/>Add pickup
        </button>
      </div>
    </div>

    {error && <div className="rr-state" role="alert">
      <h2>We couldn’t open your routes.</h2>
      <p>{error}</p>
      <button className="rr-btn rr-btn-primary" onClick={() => void load()}>Try again</button>
    </div>}

    {!error && !data && <div aria-busy="true">
      <div className="rr-skel" style={{ maxWidth: 260 }}/>
      <div className="rr-skel rr-skel-big"/>
      <div className="rr-skel rr-skel-big"/>
      <p className="rr-sr" role="status">Opening your routes.</p>
    </div>}

    {!error && data && <>
      <section className="rr-strip" aria-label="This route at a glance">
        <Chip icon="calendar"
          label={selected === today ? 'Assigned today' : `Assigned ${shortDate(selected)}`}
          value={route ? `${items.length} ${items.length === 1 ? 'stop' : 'stops'}` : 'No route'}/>
        <Chip icon="clock" label="Estimated duration" value={plan ? durationLabel(plan.totalMinutes) : '—'}/>
        <Chip icon="truck" label="Travel allowance" value={plan ? durationLabel(plan.travelMinutes) : '—'}/>
        <Chip icon="check" label="Stops completed" value={plan ? `${plan.completed} / ${plan.items.length}` : '—'}/>
      </section>

      <section className="rr-week" aria-labelledby="rr-week-title">
        <div className="rr-week-head">
          <div>
            <h2 id="rr-week-title">{weekLabel(week)}</h2>
            <p>Pick a day to see the route assigned to it</p>
          </div>
          <div className="rr-week-nav">
            <button className="rr-btn rr-btn-outline rr-btn-sm" aria-label="The week before"
              onClick={() => { const back = addDays(week, -7); setWeek(back); setSelected(back); }}>
              <Icon name="back" size={15}/>
            </button>
            <button className="rr-btn rr-btn-outline rr-btn-sm"
              onClick={() => { setSelected(today); setWeek(mondayOf(today)); }}>Today</button>
            <button className="rr-btn rr-btn-outline rr-btn-sm" aria-label="The week after"
              onClick={() => { const on = addDays(week, 7); setWeek(on); setSelected(on); }}>
              <Icon name="arrow" size={15}/>
            </button>
          </div>
        </div>
        <div className="rr-week-grid">
          {days.map(day => <Day key={day} day={day} today={today} current={day === selected}
            routes={data.routes.filter(r => r.date === day)}
            visits={data.visits} attributed={attributed}
            onPick={() => { setSelected(day); setPicked(true); setChosenRound(null); }}/>)}
        </div>
      </section>

      <div className="rr-work">
        <section className="rr-panel" aria-labelledby="rr-route-title">
          <div className="rr-panel-head">
            <div>
              <p className="rr-eyebrow" style={{ color: 'var(--green)' }}>Assigned itinerary</p>
              <h2 id="rr-route-title" style={{ marginTop: 7 }}>{longDate(selected)}</h2>
              <p className="rr-sub">{route
                ? `${data.practice} · assigned to ${route.staff || data.runner.name || 'you'}`
                : 'No route is assigned for this day'}</p>
            </div>
            <span className={`rr-tag ${route ? 'rr-tag-green' : 'rr-tag-gray'}`}>
              {route ? (plan && plan.completed === plan.items.length && plan.items.length ? 'Finished' : route.status === 'done' ? 'Done' : 'Assigned') : 'No route'}
            </span>
          </div>

          {onThisDay.length > 1 && <div className="rr-round-pick" role="tablist" aria-label="Rounds booked for this day">
            {onThisDay.map((other, index) => <button key={other.id} role="tab"
              aria-selected={other.id === route?.id}
              className={other.id === route?.id ? 'is-current' : ''}
              onClick={() => setChosenRound(other.id)}>
              Round {index + 1}<small>{other.items.length} stops</small>
            </button>)}
          </div>}

          {!route || !plan ? <div className="rr-empty">
            <Icon name="calendar" size={35}/>
            <h3>Nothing assigned for this day</h3>
            <p>Your office assigns the businesses on a route. When a day is assigned to you it
              appears here, with the stops in order and the script for every conversation.</p>
          </div> : <>
            <div className="rr-headline">
              <ul className="rr-facts">
                <li><Icon name="clock" size={15}/>{clockOf(plan.startsAt)} – {clockOf(plan.endsAt)}</li>
                <li><Icon name="pin" size={15}/>{plan.items.length} {plan.items.length === 1 ? 'stop' : 'stops'}</li>
                <li><Icon name="truck" size={15}/>{durationLabel(plan.travelMinutes)} travel allowance</li>
              </ul>
              <div className="rr-actions">
                <button className="rr-btn rr-btn-subtle rr-btn-sm" onClick={() => setDrawer({ kind: 'timing' })}>
                  Route timing
                </button>
                <button className="rr-btn rr-btn-dark rr-btn-sm" onClick={() => setDrawer({ kind: 'pickup' })}>
                  <Icon name="plus" size={14}/>Pickup stop
                </button>
                {plan.next && <button className="rr-btn rr-btn-primary rr-btn-sm"
                  onClick={() => openStop(plan.next!, setVisiting, setDrawer)}>
                  {plan.completed ? 'Next stop' : 'Start the route'}<Icon name="arrow" size={14}/>
                </button>}
              </div>
            </div>

            <div className="rr-progress-wrap">
              <div className="rr-progress" role="img"
                aria-label={`${plan.completed} of ${plan.items.length} stops finished`}>
                <i style={{ width: `${plan.items.length ? (plan.completed / plan.items.length) * 100 : 0}%` }}/>
              </div>
              <div className="rr-progress-foot">
                <span>{plan.completed} of {plan.items.length} finished</span>
                <span>{Math.round((plan.completed / Math.max(1, plan.items.length)) * 100)}%</span>
              </div>
            </div>

            <Itinerary
              plan={plan} items={items} done={done} busy={busy}
              origin={data.clinic?.label ?? data.practice}
              onMove={commitOrder}
              onOpen={item => openStop(item, setVisiting, setDrawer)}
              onCollect={pickupId => setDrawer({ kind: 'collect', pickupId })}/>

            <p className="rr-footnote">
              Travel times are planning allowances, not live driving directions: a leg between two
              known map positions is worked out from the distance, and everything else is allowed
              {' '}{TRAVEL_ALLOWANCE} minutes. Check the road and the opening hours before you set off.
              Reordering your stops saves the new order and works the times out again. The businesses
              and the date are your office’s and stay as they are.
            </p>
          </>}
        </section>

        <aside className="rr-side">
          <section className="rr-panel" aria-labelledby="rr-supplies-title">
            <div className="rr-panel-head">
              <div>
                <h3 id="rr-supplies-title">What to bring</h3>
                <p className="rr-sub">Assigned quantities · confirm your load</p>
              </div>
              <span className="rr-tag rr-tag-gold">Supplies</span>
            </div>
            {!route ? <p className="rr-note-inline">Pick a day with a route to check its supplies.</p> : <>
              <div className="rr-supplies">
                {SUPPLIES.map(supply => <div className="rr-supply" key={supply.key}>
                  <div className="rr-supply-name">{supply.label}
                    <small>Assigned {route.supplies.planned[supply.key]}
                      {route.collected[supply.key] ? ` · +${route.collected[supply.key]} picked up` : ''}</small>
                  </div>
                  <div className="rr-supply-value">{route.supplies.planned[supply.key]}</div>
                  <div className="rr-supply-left">{route.supplies.packed
                    ? <><strong>{Math.max(0, route.remaining[supply.key])}</strong> left</>
                    : 'Not packed'}</div>
                </div>)}
              </div>
              <p className="rr-note-inline">{route.supplies.packed
                ? `What is left is your confirmed load, plus what you picked up, less what you recorded dropping. Confirmed by ${route.supplies.packedBy || 'you'}.`
                : 'Confirm what you actually have in the car before you record anything dropped. The assigned quantities are your office’s and you cannot change them.'}</p>
              <div className="rr-panel-actions">
                <button className="rr-btn rr-btn-dark" onClick={() => setDrawer({ kind: 'supplies' })}>
                  {route.supplies.packed ? 'Change what you packed' : 'Confirm what you packed'}
                </button>
              </div>
            </>}
          </section>

          <section className="rr-panel" aria-labelledby="rr-detail-title">
            <div className="rr-panel-head">
              <div>
                <h3 id="rr-detail-title">Round details</h3>
                <p className="rr-sub">Worked out again whenever a stop moves</p>
              </div>
            </div>
            {!plan ? <p className="rr-note-inline">No route for this day.</p> : <>
              <div className="rr-summary">
                {([
                  ['Leave at', clockOf(plan.startsAt)],
                  ['Estimated finish', clockOf(plan.endsAt)],
                  ['Business visits', String(plan.items.filter(i => i.item.kind === 'business').length)],
                  ['Pickup stops', String(plan.items.filter(i => i.item.kind === 'pickup').length)],
                  ['At stops', durationLabel(plan.onSiteMinutes)],
                  ['Travel allowance', durationLabel(plan.travelMinutes)],
                  ['Waiting for a pickup', durationLabel(plan.waitMinutes)],
                ] as const).map(([label, value]) => <div className="rr-summary-line" key={label}>
                  <span>{label}</span><b>{value}</b>
                </div>)}
              </div>
              {plan.warnings.map(warning => <p className="rr-warning" key={warning}>
                <Icon name="warn" size={15}/>{warning}
              </p>)}
              <div className="rr-panel-actions">
                <button className="rr-btn rr-btn-dark" onClick={() => setDrawer({ kind: 'pickup' })}>
                  <Icon name="plus" size={14}/>Add a pickup
                </button>
              </div>
            </>}
          </section>
        </aside>
      </div>

      <p className="rr-page-note">
        Your routes, your supplies and every visit you record are saved to your practice’s account,
        not to this phone, so they are the same on every device you sign in on. The quantities your
        office assigned, the businesses on a route and its date are theirs to set.
      </p>
    </>}

    {/* The drawer: one panel, whichever job is in hand. */}
    <div className={`rr-backdrop ${drawer ? 'is-open' : ''}`} onClick={() => setDrawer(null)}/>
    <aside className={`rr-drawer ${drawer ? 'is-open' : ''}`} role="dialog" aria-modal={drawer ? true : undefined}
      aria-hidden={drawer ? undefined : true} aria-labelledby="rr-drawer-title">
      {drawer && route && <>
        {drawer.kind === 'pickup' && <PickupPanel
          route={route}
          pickupId={drawer.pickupId}
          busy={busy}
          onClose={() => setDrawer(null)}
          onSave={async draft => {
            const saved = await write(() => savePickup(route.id, route.revision, draft),
              drawer.pickupId ? 'Pickup updated.' : 'Pickup added. Drag it into position.');
            if (saved) setDrawer(null);
          }}
          onRemove={() => setConfirming({
            title: 'Remove this pickup?',
            text: 'Only the pickup comes off the route. Your assigned businesses and every visit you have recorded stay exactly as they are.',
            run: () => {
              setConfirming(null); setDrawer(null);
              void write(() => removePickup(route.id, drawer.pickupId!, route.revision), 'Pickup removed.');
            },
          })}/>}
        {drawer.kind === 'collect' && <CollectPanel
          route={route}
          pickupId={drawer.pickupId}
          busy={busy}
          onClose={() => setDrawer(null)}
          onEdit={() => setDrawer({ kind: 'pickup', pickupId: drawer.pickupId })}
          onCollect={async collected => {
            const saved = await write(() => collectPickup(route.id, drawer.pickupId, route.revision, collected),
              'Picked up. Those supplies are in your car.');
            if (!saved) return;
            setDrawer(null);
            // On to whatever is actually next. Collecting is a stop like any other, and the
            // point of finishing one is being pointed at the following one.
            const at = plan?.items.findIndex(i => refOf(i.item) === `pickup:${drawer.pickupId}`) ?? -1;
            const after = at < 0 ? undefined : plan?.items.slice(at + 1).find(i => !i.done);
            if (after?.item.kind === 'business') setVisiting(after.item.business.id);
          }}/>}
        {drawer.kind === 'supplies' && <SuppliesPanel
          route={route} busy={busy} onClose={() => setDrawer(null)}
          onSave={async supplies => {
            const saved = await write(() => confirmPacked(route.id, supplies, route.revision),
              'Supplies confirmed.');
            if (saved) setDrawer(null);
          }}/>}
        {drawer.kind === 'timing' && plan && <TimingPanel
          route={route} plan={plan} onClose={() => setDrawer(null)}/>}
      </>}
    </aside>

    <div className={`rr-toast ${toast ? 'is-open' : ''}`} role="status">{toast}</div>

    {confirming && <div className="rr-modal-backdrop">
      <div className="rr-modal" role="alertdialog" aria-modal="true" aria-labelledby="rr-confirm-title">
        <h2 id="rr-confirm-title">{confirming.title}</h2>
        <p>{confirming.text}</p>
        <div className="rr-modal-actions">
          <button className="rr-btn rr-btn-white" onClick={() => setConfirming(null)}>Cancel</button>
          <button className="rr-btn rr-btn-dark" onClick={confirming.run}>Continue</button>
        </div>
      </div>
    </div>}
  </main>;
}

/**
 * A business opens into its guided visit; a pickup opens into collecting it. Editing a pickup
 * is a different button, because arriving at one and changing your mind about one are different
 * things to be doing on a pavement.
 */
function openStop(item: PlannedItem, visit: (id: string) => void, drawer: (value: Drawer) => void) {
  if (item.item.kind === 'business') visit(item.item.business.id);
  else drawer({ kind: item.item.pickup.status === 'collected' ? 'pickup' : 'collect', pickupId: item.item.id });
}

function Chip({ icon, label, value }: { icon: IconName; label: string; value: string }) {
  return <div className="rr-chip">
    <span className="rr-chip-icon"><Icon name={icon} size={17}/></span>
    <div><span>{label}</span><strong>{value}</strong></div>
  </div>;
}

/** One day in the week strip. Touch-friendly, and it says what is on the day without opening it. */
function Day({ day, today, current, routes, visits, attributed, onPick }: {
  day: string; today: string; current: boolean; routes: RunnerRoute[]; visits: Visit[];
  attributed: Map<string, string>; onPick: () => void;
}) {
  const plans = routes.map(route => planRoute(route, visits, { today, attributed }));
  const stops = routes.reduce((total, route) => total + route.items.length, 0);
  const done = plans.reduce((total, plan) => total + plan.completed, 0);
  const minutes = plans.reduce((total, plan) => total + plan.totalMinutes, 0);
  const shown = routes.flatMap(route => route.items).slice(0, 3);
  return <button type="button" className={`rr-day ${current ? 'is-current' : ''}`}
    aria-pressed={current} onClick={onPick}>
    <span className="rr-day-top">
      <strong>{shortDate(day).replace(',', '')}</strong>
      <b>{routes.length ? stops : '–'}</b>
    </span>
    <span className="rr-day-list">
      {!routes.length ? <span className="rr-day-empty">No route assigned</span> : <>
        {shown.map(item => <span key={refOf(item)}
          className={`rr-day-item ${item.kind === 'pickup' ? 'is-pickup' : ''}`}>
          {item.kind === 'pickup' ? `↳ ${item.pickup.title}` : item.business.name}
        </span>)}
        {stops > 3 && <span className="rr-day-more">+{stops - 3} more</span>}
      </>}
    </span>
    <span className="rr-day-foot">
      <span>{routes.length
        ? `${done} done${routes.length > 1 ? ` · ${routes.length} routes` : ''}`
        : day === today ? 'Today' : 'No route'}</span>
      <span>{routes.length ? durationLabel(minutes) : '—'}</span>
    </span>
  </button>;
}

/**
 * ARRIVING AT A PICKUP. What to collect, where, by when — and the counts confirmed as they go
 * in the car, because what was ordered and what the bakery actually had are different numbers.
 */
function CollectPanel({ route, pickupId, busy, onClose, onEdit, onCollect }: {
  route: RunnerRoute; pickupId: string; busy: boolean;
  onClose: () => void; onEdit: () => void; onCollect: (collected: Supplies) => void;
}) {
  const found = route.items.find(item => item.kind === 'pickup' && item.id === pickupId);
  const pickup = found?.kind === 'pickup' ? found.pickup : null;
  const [form, setForm] = useState<Record<keyof Supplies, string>>(() => ({
    flyers: String(pickup?.supplies.flyers ?? 0),
    treats: String(pickup?.supplies.treats ?? 0),
    cards: String(pickup?.supplies.cards ?? 0),
  }));
  const [failed, setFailed] = useState('');
  if (!pickup) return null;

  function submit() {
    const value: Supplies = {
      flyers: Number(form.flyers), treats: Number(form.treats), cards: Number(form.cards),
    };
    for (const supply of SUPPLIES) {
      const count = value[supply.key];
      if (!Number.isInteger(count) || count < 0 || count > 10000) {
        return setFailed(`${supply.label}: enter a whole number from 0 to 10000.`);
      }
    }
    setFailed('');
    onCollect(value);
  }

  return <>
    <div className="rr-drawer-head">
      <div>
        <p className="rr-eyebrow" style={{ color: '#6e8875' }}>Pickup stop</p>
        <h2 id="rr-drawer-title">{pickup.title}</h2>
        <small>{PICKUP_LABEL[pickup.kind]} · {pickup.windowStart}–{pickup.windowEnd}</small>
      </div>
      <button className="rr-btn rr-btn-white rr-btn-icon" aria-label="Close" onClick={onClose}>
        <Icon name="close" size={16}/>
      </button>
    </div>
    <div className="rr-drawer-scroll">
      <div className="rr-card">
        <h3>Where</h3>
        <p>{pickup.address}</p>
        <div className="rr-stop-actions">
          <a className="rr-btn rr-btn-sm rr-btn-white" target="_blank" rel="noreferrer noopener"
            href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(pickup.address)}&travelmode=driving`}>
            <Icon name="map" size={13}/>Directions
          </a>
        </div>
      </div>

      <div className="rr-card">
        <h3>What to collect</h3>
        <p>{pickup.items || 'Nothing was written down for this pickup.'}</p>
        {pickup.reference && <p>Under {pickup.reference}.</p>}
        {pickup.note && <p>{pickup.note}</p>}
      </div>

      {pickup.status === 'collected' ? <p className="rr-notice">
        Already collected. What you confirmed is counted in your supplies.
      </p> : <>
        <p className="rr-section-title">What you actually came away with</p>
        <div className="rr-grid">
          {SUPPLIES.map(supply => <div className="rr-field" key={supply.key}>
            <label htmlFor={`rr-got-${supply.key}`}>{supply.label}</label>
            <input id={`rr-got-${supply.key}`} type="number" inputMode="numeric" min={0} max={10000}
              value={form[supply.key]}
              onChange={event => setForm(current => ({ ...current, [supply.key]: event.target.value }))}/>
          </div>)}
        </div>
        <p className="rr-hint">These start at what you said you were collecting. Change them to
          what is really in the car — that is what your remaining supplies are counted from.</p>
      </>}
      {failed && <p className="rr-error" role="alert">{failed}</p>}
    </div>
    <div className="rr-drawer-foot">
      <button className="rr-btn rr-btn-white" onClick={onEdit} disabled={pickup.status === 'collected'}>
        Edit pickup
      </button>
      <button className="rr-btn rr-btn-primary" onClick={submit}
        disabled={busy || pickup.status === 'collected'}>
        {busy ? 'Saving…' : 'Mark picked up'}
      </button>
    </div>
  </>;
}

/**
 * THE ITINERARY, draggable. Pointer events rather than HTML5 drag-and-drop, because this is used
 * on a phone and HTML5 dragging does not exist there. Move up / Move down do the same job from a
 * keyboard, and a stop that is finished or fixed in place refuses to move either way.
 */
function Itinerary({ plan, items, done, busy, origin, onMove, onOpen, onCollect }: {
  plan: ReturnType<typeof planRoute>; items: RunnerItem[]; done: Set<string>; busy: boolean;
  origin: string;
  onMove: (next: RunnerItem[]) => void;
  onOpen: (item: PlannedItem) => void;
  onCollect: (pickupId: string) => void;
}) {
  const [dragging, setDragging] = useState<string | null>(null);
  const [target, setTarget] = useState<{ key: string; after: boolean } | null>(null);
  const drag = useRef<{ key: string; x: number; y: number; moved: boolean } | null>(null);

  const move = (key: string, to: number) => {
    const next = moveTo(items, done, key, to);
    if (next) onMove(next); 
  };

  const finish = () => {
    const current = drag.current;
    drag.current = null;
    setDragging(null);
    const landing = target;
    setTarget(null);
    if (!current?.moved || !landing) return;
    const from = items.findIndex(item => refOf(item) === current.key);
    const onto = items.findIndex(item => refOf(item) === landing.key);
    if (from < 0 || onto < 0) return;
    let to = onto + (landing.after ? 1 : 0);
    if (from < to) to--;
    move(current.key, to);
  };

  return <ol className="rr-stops"
    onPointerMove={event => {
      const current = drag.current;
      if (!current) return;
      if (Math.abs(event.clientY - current.y) + Math.abs(event.clientX - current.x) > 6) {
        current.moved = true;
        setDragging(current.key);
      }
      if (!current.moved) return;
      const under = document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-stop]');
      const key = under?.getAttribute('data-stop') ?? null;
      if (!key || key === current.key || done.has(key)) { setTarget(null); return; }
      const box = under!.getBoundingClientRect();
      setTarget({ key, after: event.clientY > box.top + box.height / 2 });
    }}
    onPointerUp={finish} onPointerCancel={finish}>
    <li className="rr-stop is-origin">
      <span className="rr-index"><Icon name="home" size={14}/></span>
      <div className="rr-stop-body">
        <div className="rr-stop-top"><strong>Leave the practice</strong>
          <span className="rr-time">{clockOf(plan.startsAt)}</span></div>
        <p className="rr-where">{origin}</p>
      </div>
    </li>
    {plan.items.map((entry, index) => {
      const key = refOf(entry.item);
      const fixed = entry.item.locked || entry.done;
      const pickup = entry.item.kind === 'pickup' ? entry.item.pickup : null;
      return <li key={key} data-stop={key}
        className={`rr-stop ${pickup ? 'is-pickup' : ''} ${entry.done ? 'is-done' : ''}
          ${dragging === key ? 'is-dragging' : ''} ${target?.key === key ? 'is-target' : ''}`}>
        <button type="button" className="rr-grip" disabled={fixed || busy}
          aria-label={`Drag ${itemName(entry.item)} to reorder it`}
          onPointerDown={event => {
            if (fixed || busy) return;
            event.preventDefault();
            (event.target as HTMLElement).setPointerCapture(event.pointerId);
            drag.current = { key, x: event.clientX, y: event.clientY, moved: false };
          }}>
          <Icon name="grip" size={16}/>
        </button>
        <span className="rr-index">
          {entry.done ? <Icon name="check" size={14}/> : pickup ? <Icon name="box" size={14}/> : index + 1}
        </span>
        <div className="rr-stop-body">
          <div className="rr-stop-top">
            <strong>{itemName(entry.item)}</strong>
            <span className="rr-time">{entry.item.kind === 'business' && !entry.measured && !entry.done
              ? `~${clockOf(entry.arriveAt)}` : clockOf(entry.arriveAt)}</span>
          </div>
          <p className="rr-where">{entry.item.kind === 'business'
            ? `${entry.item.business.category} · ${entry.item.business.address}`
            : `${PICKUP_LABEL[pickup!.kind]} · ${pickup!.address}`}</p>
          <div className="rr-meta">
            <span className={`rr-tag ${pickup ? 'rr-tag-gold' : entry.done ? 'rr-tag-green' : 'rr-tag-gray'}`}>
              {pickup ? (pickup.status === 'collected' ? 'Picked up' : 'Pickup') : entry.done ? 'Visited' : 'Business'}
            </span>
            <span className="rr-tiny">{entry.minutes} min on site</span>
            {entry.wait > 0 && <span className="rr-tiny">{entry.wait} min wait</span>}
            {entry.late > 0 && <span className="rr-tag rr-tag-red">Window missed</span>}
            {entry.item.locked && <span className="rr-tag rr-tag-gray">Fixed by your office</span>}
            {entry.item.kind === 'business' && entry.item.business.demo === 1 && <span className="rr-tag rr-tag-gray">Sample</span>}
            {pickup && <span className="rr-tiny">Window {pickup.windowStart}–{pickup.windowEnd}</span>}
            {entry.done && entry.visit && <span className="rr-tiny">{entry.visit.outcomeLabel}
              {entry.visit.materials ? ` · ${entry.visit.materials} materials dropped` : ''}</span>}
          </div>
          {pickup?.items && <p className="rr-where">To collect: {pickup.items}
            {pickup.reference ? ` · ${pickup.reference}` : ''}</p>}
          <div className="rr-stop-actions">
            <button className={`rr-btn rr-btn-sm ${entry.done ? 'rr-btn-white' : 'rr-btn-subtle'}`}
              onClick={() => onOpen(entry)}>
              {pickup ? 'Edit pickup' : entry.done ? 'Open the visit' : 'Start visit'}
              {!entry.done && !pickup && <Icon name="arrow" size={13}/>}
            </button>
            {pickup && <button className="rr-btn rr-btn-sm rr-btn-white" disabled={pickup.status === 'collected' || busy}
              onClick={() => onCollect(pickup.id)}>
              {pickup.status === 'collected' ? 'Picked up' : 'Mark picked up'}
            </button>}
            <a className="rr-btn rr-btn-sm rr-btn-white" href={directionsTo(entry.item)}
              target="_blank" rel="noreferrer noopener">
              <Icon name="map" size={13}/>Directions
            </a>
          </div>
        </div>
        <div className="rr-move">
          <button aria-label={`Move ${itemName(entry.item)} up`} disabled={index === 0 || fixed || busy}
            onClick={() => move(key, index - 1)}><Icon name="up" size={14}/></button>
          <button aria-label={`Move ${itemName(entry.item)} down`}
            disabled={index === plan.items.length - 1 || fixed || busy}
            onClick={() => move(key, index + 1)}><Icon name="down" size={14}/></button>
        </div>
      </li>;
    })}
  </ol>;
}

/** The same rules the server applies, so a move it would refuse is never offered. */
function moveTo(items: RunnerItem[], done: Set<string>, key: string, to: number) {
  const at = items.findIndex(item => refOf(item) === key);
  if (at < 0 || to < 0 || to >= items.length || at === to) return null;
  const blocked = (item: RunnerItem) => item.locked || done.has(refOf(item));
  if (blocked(items[at]) || blocked(items[to])) return null;
  const next = [...items];
  const [moved] = next.splice(at, 1);
  next.splice(to, 0, moved);
  for (let index = 0; index < items.length; index++) {
    if (items[index].locked && refOf(next[index]) !== refOf(items[index])) return null;
  }
  const was = items.filter(item => done.has(refOf(item))).map(refOf).join('|');
  if (was !== next.filter(item => done.has(refOf(item))).map(refOf).join('|')) return null;
  return next;
}

/** Add or change a pickup. The one place a runner puts something of their own on a route. */
function PickupPanel({ route, pickupId, busy, onClose, onSave, onRemove }: {
  route: RunnerRoute; pickupId?: string; busy: boolean;
  onClose: () => void; onSave: (draft: PickupDraft & { pickupId?: string }) => void; onRemove: () => void;
}) {
  const existing = pickupId
    ? route.items.find(item => item.kind === 'pickup' && item.id === pickupId)
    : undefined;
  const pickup = existing?.kind === 'pickup' ? existing.pickup : null;
  const [form, setForm] = useState<PickupDraft>(() => ({
    kind: pickup?.kind ?? 'treats',
    title: pickup?.title ?? '', address: pickup?.address ?? '',
    windowStart: pickup?.windowStart ?? '09:00', windowEnd: pickup?.windowEnd ?? '09:30',
    minutes: pickup?.minutes ?? 10, items: pickup?.items ?? '',
    reference: pickup?.reference ?? '', note: pickup?.note ?? '',
    supplies: pickup?.supplies ?? { flyers: 0, treats: 0, cards: 0 },
  }));
  const [failed, setFailed] = useState('');
  const collected = pickup?.status === 'collected';
  const set = <K extends keyof PickupDraft>(key: K, value: PickupDraft[K]) =>
    setForm(current => ({ ...current, [key]: value }));
  const supply = (key: keyof Supplies, value: string) => setForm(current => ({
    ...current, supplies: { ...(current.supplies as Supplies), [key]: Number(value) || 0 },
  }));

  function submit() {
    if (!form.title.trim()) return setFailed('Give the pickup a location name.');
    if (form.address.trim().length < 8) return setFailed('Give the pickup a full street address.');
    if (form.windowEnd <= form.windowStart) return setFailed('The pickup window has to open before it closes.');
    setFailed('');
    onSave({ ...form, pickupId });
  }

  return <>
    <div className="rr-drawer-head">
      <div>
        <p className="rr-eyebrow" style={{ color: '#6e8875' }}>Route logistics</p>
        <h2 id="rr-drawer-title">{pickup ? 'Edit pickup' : 'Add a pickup'}</h2>
        <small>Put a food or supply stop anywhere in your day</small>
      </div>
      <button className="rr-btn rr-btn-white rr-btn-icon" aria-label="Close" onClick={onClose}>
        <Icon name="close" size={16}/>
      </button>
    </div>
    <div className="rr-drawer-scroll">
      <p className="rr-notice">A pickup is yours: you add it, you move it, you mark it collected.
        It is not a referral business, it never joins your practice’s business list, and it changes
        nothing about who you were assigned to visit.</p>
      {collected && <p className="rr-notice is-warn">This pickup has been collected, so it stays as
        it is. What it was carrying is counted in your supplies.</p>}

      <div className="rr-field">
        <label htmlFor="rr-kind">What are you collecting?</label>
        <select id="rr-kind" value={form.kind} disabled={collected}
          onChange={event => set('kind', event.target.value as PickupKind)}>
          {(Object.keys(PICKUP_LABEL) as PickupKind[]).map(kind =>
            <option key={kind} value={kind}>{PICKUP_LABEL[kind]}</option>)}
        </select>
      </div>
      <div className="rr-field">
        <label htmlFor="rr-title">Location name</label>
        <input id="rr-title" maxLength={100} value={form.title} disabled={collected}
          placeholder="Bakery on Main" onChange={event => set('title', event.target.value)}/>
      </div>
      <div className="rr-field">
        <label htmlFor="rr-address">Street address</label>
        <input id="rr-address" maxLength={250} value={form.address} disabled={collected}
          placeholder="Street, city, state, ZIP" onChange={event => set('address', event.target.value)}/>
      </div>
      <div className="rr-grid">
        <div className="rr-field">
          <label htmlFor="rr-from">Window opens</label>
          <input id="rr-from" type="time" value={form.windowStart} disabled={collected}
            onChange={event => set('windowStart', event.target.value)}/>
        </div>
        <div className="rr-field">
          <label htmlFor="rr-to">Window closes</label>
          <input id="rr-to" type="time" value={form.windowEnd} disabled={collected}
            onChange={event => set('windowEnd', event.target.value)}/>
        </div>
      </div>
      <div className="rr-field">
        <label htmlFor="rr-minutes">Time at the pickup</label>
        <select id="rr-minutes" value={form.minutes} disabled={collected}
          onChange={event => set('minutes', Number(event.target.value))}>
          {[5, 10, 15, 20, 30, 45].map(minutes =>
            <option key={minutes} value={minutes}>{minutes} minutes</option>)}
        </select>
      </div>
      <div className="rr-field">
        <label htmlFor="rr-items">What to collect</label>
        <input id="rr-items" maxLength={400} value={form.items} disabled={collected}
          placeholder="4 dozen cookies" onChange={event => set('items', event.target.value)}/>
      </div>
      <div className="rr-field">
        <label htmlFor="rr-reference">Order name or reference</label>
        <input id="rr-reference" maxLength={120} value={form.reference} disabled={collected}
          placeholder="Under Alexis · order 4821" onChange={event => set('reference', event.target.value)}/>
      </div>

      <p className="rr-section-title">What it adds to your supplies</p>
      <div className="rr-grid">
        {SUPPLIES.map(item => <div className="rr-field" key={item.key}>
          <label htmlFor={`rr-supply-${item.key}`}>{item.label}</label>
          <input id={`rr-supply-${item.key}`} type="number" inputMode="numeric" min={0} max={10000}
            disabled={collected} value={(form.supplies as Supplies)[item.key]}
            onChange={event => supply(item.key, event.target.value)}/>
        </div>)}
      </div>
      <p className="rr-hint">Leave these at zero where the pickup is not flyers, treats or cards.
        They are added to what you are carrying once you mark it picked up.</p>

      <div className="rr-field">
        <label htmlFor="rr-note">Pickup instructions</label>
        <textarea id="rr-note" maxLength={900} value={form.note} disabled={collected}
          placeholder="Ask at the counter, park at the back" onChange={event => set('note', event.target.value)}/>
      </div>

      {failed && <p className="rr-error" role="alert">{failed}</p>}
      {pickup && !collected && <button className="rr-btn rr-btn-white" onClick={onRemove} disabled={busy}>
        Remove this pickup
      </button>}
    </div>
    <div className="rr-drawer-foot">
      <button className="rr-btn rr-btn-white" onClick={onClose}>Cancel</button>
      <button className="rr-btn rr-btn-primary" onClick={submit} disabled={busy || collected}>
        {busy ? 'Saving…' : pickup ? 'Save changes' : 'Add pickup'}
      </button>
    </div>
  </>;
}

/** Confirm the load. The runner's own count, which the office's allocation does not overwrite. */
function SuppliesPanel({ route, busy, onClose, onSave }: {
  route: RunnerRoute; busy: boolean; onClose: () => void; onSave: (supplies: Supplies) => void;
}) {
  const start = route.supplies.packed ?? route.supplies.planned;
  const [form, setForm] = useState<Record<keyof Supplies, string>>({
    flyers: String(start.flyers), treats: String(start.treats), cards: String(start.cards),
  });
  const [failed, setFailed] = useState('');

  function submit() {
    const value: Supplies = {
      flyers: Number(form.flyers), treats: Number(form.treats), cards: Number(form.cards),
    };
    for (const supply of SUPPLIES) {
      const count = value[supply.key];
      if (!Number.isInteger(count) || count < 0 || count > 10000) {
        return setFailed(`${supply.label}: enter a whole number from 0 to 10000.`);
      }
      if (count + route.collected[supply.key] < route.dropped[supply.key]) {
        return setFailed(`${supply.label}: you have already recorded ${route.dropped[supply.key]} dropped on this route, so you cannot confirm fewer than that.`);
      }
    }
    setFailed('');
    onSave(value);
  }

  return <>
    <div className="rr-drawer-head">
      <div>
        <p className="rr-eyebrow" style={{ color: '#6e8875' }}>What to bring</p>
        <h2 id="rr-drawer-title">Confirm your load</h2>
        <small>What you actually have in the car</small>
      </div>
      <button className="rr-btn rr-btn-white rr-btn-icon" aria-label="Close" onClick={onClose}>
        <Icon name="close" size={16}/>
      </button>
    </div>
    <div className="rr-drawer-scroll">
      <p className="rr-notice">The assigned quantities come from your office. Count what you are
        really carrying and confirm that — a short box is worth saying, and you can change this
        later. Never record materials you do not have.</p>
      {SUPPLIES.map(supply => <div className="rr-field" key={supply.key}>
        <label htmlFor={`rr-packed-${supply.key}`}>
          {supply.label} · assigned {route.supplies.planned[supply.key]}
        </label>
        <input id={`rr-packed-${supply.key}`} type="number" inputMode="numeric" min={0} max={10000}
          value={form[supply.key]}
          onChange={event => setForm(current => ({ ...current, [supply.key]: event.target.value }))}/>
        {route.dropped[supply.key] > 0 && <p className="rr-hint">
          {route.dropped[supply.key]} already recorded as dropped on this route.
        </p>}
      </div>)}
      {failed && <p className="rr-error" role="alert">{failed}</p>}
    </div>
    <div className="rr-drawer-foot">
      <button className="rr-btn rr-btn-white" onClick={onClose}>Cancel</button>
      <button className="rr-btn rr-btn-primary" onClick={submit} disabled={busy}>
        {busy ? 'Saving…' : 'Confirm packed'}
      </button>
    </div>
  </>;
}

/**
 * WHERE THE TIMES COME FROM. The standalone planner let a runner move the start time; here the
 * start is the office's commitment, so this panel explains the arithmetic instead of offering to
 * change it. Reordering the stops is how a runner changes their day.
 */
function TimingPanel({ route, plan, onClose }: {
  route: RunnerRoute; plan: NonNullable<ReturnType<typeof planRoute>>; onClose: () => void;
}) {
  return <>
    <div className="rr-drawer-head">
      <div>
        <p className="rr-eyebrow" style={{ color: '#6e8875' }}>Route timing</p>
        <h2 id="rr-drawer-title">Where these times come from</h2>
        <small>{longDate(route.date)}</small>
      </div>
      <button className="rr-btn rr-btn-white rr-btn-icon" aria-label="Close" onClick={onClose}>
        <Icon name="close" size={16}/>
      </button>
    </div>
    <div className="rr-drawer-scroll">
      <p className="rr-notice">Your start time and your stops are set by your office. You decide the
        order you drive them in and where your pickups go, and the times below are worked out again
        every time you move something.</p>
      <div className="rr-card">
        <h3>Leaving</h3>
        <p>Booked for {route.start}, and {plan.opening.closed
          ? `${WEEKDAY[plan.opening.weekday]} is a day the practice is closed, so nothing holds it later.`
          : plan.opening.heldBack
            ? `held to ${clockOf(plan.startsAt)} because the practice opens then.`
            : `that is when this route starts.`}</p>
      </div>
      <div className="rr-card">
        <h3>Travel</h3>
        <p>A leg between two stops we have map positions for is estimated from the distance between
          them, stretched for roads. Every other leg — a pickup, or a business with no map position
          — is allowed {TRAVEL_ALLOWANCE} minutes. Neither is a routed drive time: this portal has
          no navigation provider, so check the road before you set off.</p>
      </div>
      <div className="rr-card">
        <h3>At each stop</h3>
        <p>A business visit is allowed {plan.items.find(i => i.item.kind === 'business')?.minutes ?? 20} minutes.
          A pickup takes the time you gave it, plus any wait for its window to open.</p>
      </div>
      {plan.warnings.length > 0 && <>
        <p className="rr-section-title">Worth knowing</p>
        {plan.warnings.map(warning => <p className="rr-warning" key={warning}>
          <Icon name="warn" size={15}/>{warning}
        </p>)}
      </>}
    </div>
    <div className="rr-drawer-foot">
      <button className="rr-btn rr-btn-white" onClick={onClose}>Close</button>
    </div>
  </>;
}

/** The day as text, for a runner who would rather keep it in their own notes app. */
async function copyItinerary(route: RunnerRoute | null, plan: ReturnType<typeof planRoute> | null,
  data: RunnerPayload | null, say: (text: string) => void) {
  if (!route || !plan) return;
  const lines = [
    `Our Wellness Network · ${data?.practice ?? ''}`.trim(),
    `${longDate(route.date)} · ${route.staff || data?.runner.name || ''}`.trim(),
    `Leave ${clockOf(plan.startsAt)} · estimated finish ${clockOf(plan.endsAt)}`,
    `Travel allowance ${durationLabel(plan.travelMinutes)} (an estimate, not a routed drive)`,
    route.supplies.packed
      ? `Carrying: ${route.supplies.packed.flyers} flyers, ${route.supplies.packed.treats} treats, ${route.supplies.packed.cards} referral cards`
      : `Assigned: ${route.supplies.planned.flyers} flyers, ${route.supplies.planned.treats} treats, ${route.supplies.planned.cards} referral cards (not confirmed packed)`,
    '',
    ...plan.items.map((entry, index) => [
      `${index + 1}. ${clockOf(entry.arriveAt)} — ${itemName(entry.item)}`,
      `   ${itemAddress(entry.item)}`,
      `   ${entry.minutes} min${entry.item.kind === 'pickup' ? ` · window ${entry.item.pickup.windowStart}–${entry.item.pickup.windowEnd}` : ''}`,
    ].join('\n')),
  ];
  try {
    await navigator.clipboard.writeText(lines.join('\n'));
    say('Route copied.');
  } catch { say('This browser would not let us copy. Use Print instead.'); }
}

export { isoOf };
