// MY ROUTES — the week, and the day you are in.
//
// The study planner's shape: a compact bar, one heading with the week either side of it, seven
// columns, and the work as small cards inside the day it belongs to. A day opens full width
// when a runner is actually driving it. Everything else — the brief, the script, the pickup
// form, the supplies — is a drawer.
//
// What a runner may change is unchanged from the version this replaces: the ORDER of their
// stops, the PICKUPS among them, what they CONFIRM carrying, and the VISITS they record. The
// businesses, the date, the start time and the allocation are the office's. The server refuses
// the rest whatever this screen sends.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  collectPickup, confirmPacked, getRunnerBusiness, getRunnerRoutes, recordRunnerVisit,
  removePickup, reorderRoute, savePickup, RouteChanged,
  type PickupDraft, type RunnerItem, type RunnerPayload, type RunnerRoute, type Supplies,
} from './lib/api';
import {
  addDays, attributeVisits, clockOf, durationLabel, itemName, longDate, minutesNowIn, mondayOf,
  planRoute, weekLabel, type PlannedItem,
} from './lib/route-math';
import { Icon } from './Icons';
import GuidedVisit, { type VisitSubmission } from './GuidedVisit';
import RunnerWeek, { RoundStops, refOf, type DayPlan } from './RunnerWeek';
import { CollectDrawer, PickupDrawer, StopDrawer, SuppliesDrawer, QuickResultDrawer } from './RunnerDrawers';
import { useFocusTrap } from './lib/focus-trap';
import { runnerOutcomeLabel } from './lib/runner-outcomes';

type Drawer =
  | { kind: 'stop'; roundId: string; key: string }
  | { kind: 'quick'; roundId: string; key: string }
  | { kind: 'collect'; roundId: string; key: string }
  | { kind: 'pickup'; roundId: string; pickupId?: string }
  | { kind: 'supplies'; roundId: string };

export default function MyRoutes({ today, timezone }: { today: string; timezone: string }) {
  const [data, setData] = useState<RunnerPayload | null>(null);
  const [error, setError] = useState('');
  const [week, setWeek] = useState(() => mondayOf(today));
  const [focus, setFocus] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<Drawer | null>(null);
  const [visiting, setVisiting] = useState<{ roundId: string; businessId: string } | null>(null);
  const [toast, setToast] = useState('');
  const [confirming, setConfirming] = useState<{ title: string; text: string; run: () => void } | null>(null);
  const [pending, setPending] = useState<{ roundId: string; items: RunnerItem[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const toastTimer = useRef<number>(0);
  const sheetRef = useRef<HTMLElement>(null);
  const unsaved = useRef(false);

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

  const closeDrawer = useCallback(() => {
    if (!unsaved.current) { setDrawer(null); return; }
    setConfirming({
      title: 'Leave without saving?',
      text: 'What you have typed into this panel has not been saved. Leaving now discards it.',
      run: () => { unsaved.current = false; setConfirming(null); setDrawer(null); },
    });
  }, []);
  useFocusTrap(!!drawer, sheetRef, closeDrawer);
  useEffect(() => { unsaved.current = false; }, [drawer]);

  // Which round each visit belongs to, worked out across every route at once: the same business
  // can be on more than one, and a visit belongs to exactly one.
  const attributed = useMemo(
    () => attributeVisits(data?.routes ?? [], data?.visits ?? []),
    [data]);

  const itemsOf = useCallback((route: RunnerRoute) =>
    pending && pending.roundId === route.id ? pending.items : route.items, [pending]);

  const planOf = useCallback((route: RunnerRoute): DayPlan => {
    const plan = planRoute({ ...route, items: itemsOf(route) }, data?.visits ?? [], {
      clinic: data?.clinic ?? null, today, attributed,
      nowMinutes: minutesNowIn(timezone) ?? undefined,
    });
    return {
      route, items: plan.items, startsAt: plan.startsAt,
      totalMinutes: plan.totalMinutes, completed: plan.completed,
    };
  }, [data, today, attributed, timezone, itemsOf]);

  const fullPlanOf = useCallback((route: RunnerRoute) => planRoute(
    { ...route, items: itemsOf(route) }, data?.visits ?? [], {
      clinic: data?.clinic ?? null, today, attributed,
      nowMinutes: minutesNowIn(timezone) ?? undefined,
    }), [data, today, attributed, timezone, itemsOf]);

  const plansFor = useCallback((day: string) =>
    (data?.routes ?? []).filter(route => route.date === day).map(planOf), [data, planOf]);

  const days = useMemo(() => Array.from({ length: 7 }, (_, index) => addDays(week, index)), [week]);

  // The day a runner is most likely to want open: the one they focused, else today, else the
  // next day this week with work on it.
  const liveDay = useMemo(() => {
    if (focus) return focus;
    const withWork = days.filter(day => (data?.routes ?? []).some(route => route.date === day));
    return withWork.includes(today) ? today : withWork.find(day => day >= today) ?? withWork[0] ?? null;
  }, [focus, days, data, today]);

  const livePlans = liveDay ? plansFor(liveDay) : [];
  // The first round of that day with something still to do. That is where "next stop" goes.
  const runningPair = livePlans
    .map(plan => ({ route: plan.route, full: fullPlanOf(plan.route) }))
    .find(pair => pair.full.next) ?? null;
  const running = runningPair?.full ?? null;
  const runningRoute = runningPair?.route ?? null;

  const routeById = useCallback((id: string) => (data?.routes ?? []).find(route => route.id === id) ?? null, [data]);
  const entryOf = useCallback((roundId: string, key: string) => {
    const route = routeById(roundId);
    return route ? fullPlanOf(route).items.find(entry => refOf(entry.item) === key) ?? null : null;
  }, [routeById, fullPlanOf]);

  const replace = useCallback((saved: RunnerRoute) => {
    setData(current => current && {
      ...current, routes: current.routes.map(route => route.id === saved.id ? saved : route),
    });
    setPending(null);
  }, []);

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
      } else say(e instanceof Error ? e.message : 'That change could not be saved.');
      return false;
    } finally { setBusy(false); }
  }, [replace, say, load]);

  /** Put one stop at a new index in its round. The same call from a drag and from the menu. */
  const move = useCallback(async (roundId: string, key: string, toIndex: number) => {
    const route = routeById(roundId);
    if (!route) return;
    const items = itemsOf(route);
    const from = items.findIndex(item => refOf(item) === key);
    const to = Math.max(0, Math.min(items.length - 1, toIndex));
    if (from < 0 || to === from) return;
    const done = new Set(fullPlanOf(route).items.filter(entry => entry.done).map(entry => refOf(entry.item)));
    const blocked = (item: RunnerItem) => item.locked || done.has(refOf(item));
    if (blocked(items[from]) || blocked(items[to])) {
      say('A stop you have finished, or one your office fixed in place, stays where it is.');
      return;
    }
    const next = [...items];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    for (let index = 0; index < items.length; index++) {
      if (items[index].locked && refOf(next[index]) !== refOf(items[index])) return;
    }
    const was = items.filter(item => done.has(refOf(item))).map(refOf).join('|');
    if (was !== next.filter(item => done.has(refOf(item))).map(refOf).join('|')) return;

    setPending({ roundId, items: next });
    await write(() => reorderRoute(roundId, next.map(item => ({ kind: item.kind, id: item.id })), route.revision),
      'Order saved. The times have been worked out again.');
  }, [routeById, itemsOf, fullPlanOf, write, say]);

  /** Opening a stop: a business into its drawer, a pickup into collecting or editing it. */
  const openStop = useCallback((roundId: string, entry: PlannedItem) => {
    const key = refOf(entry.item);
    if (entry.item.kind === 'business') setDrawer({ kind: 'stop', roundId, key });
    else if (entry.item.pickup.status === 'collected') setDrawer({ kind: 'pickup', roundId, pickupId: entry.item.id });
    else setDrawer({ kind: 'collect', roundId, key });
  }, []);

  /** The checkmark saves a real visit outcome; a pickup keeps its collection workflow. */
  const checkStop = useCallback((roundId: string, entry: PlannedItem) => {
    if (entry.done) return;
    if (entry.item.kind === 'pickup') { openStop(roundId, entry); return; }
    setDrawer({ kind: 'quick', roundId, key: refOf(entry.item) });
  }, [openStop]);

  /** Where to go now: the next unfinished stop of the day being run. */
  const goNext = useCallback(() => {
    if (!running || !runningRoute) return;
    const next = running.next!;
    if (next.item.kind === 'business') setVisiting({ roundId: runningRoute.id, businessId: next.item.business.id });
    else openStop(runningRoute.id, next);
  }, [running, runningRoute, openStop]);

  // ── The guided visit takes the screen, and comes back to the day ──────────
  if (visiting) {
    const route = routeById(visiting.roundId);
    const plan = route ? fullPlanOf(route) : null;
    if (route && plan) {
      const at = plan.items.findIndex(i => i.item.kind === 'business' && i.item.business.id === visiting.businessId);
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
      return <main className="rr-main">
        <div className="plan-b rr-visit">
          <GuidedVisit
            businessId={visiting.businessId}
            today={today}
            staffName={data?.runner.name ?? null}
            load={id => getRunnerBusiness(route.id, id)}
            save={save}
            materials={{ remaining: route.remaining, confirmed: route.supplies.packed !== null }}
            onClose={() => { setVisiting(null); setFocus(route.date); void load(); }}
            onNext={after ? () => {
              if (after.item.kind === 'business') setVisiting({ roundId: route.id, businessId: after.item.business.id });
              else { setVisiting(null); setFocus(route.date); openStop(route.id, after); }
            } : undefined}
            nextLabel={after ? `Next: ${itemName(after.item)}` : undefined}/>
        </div>
      </main>;
    }
  }

  const drawerRoute = drawer ? routeById(drawer.roundId) : null;

  return <>
    <main className="rr-main">
      {error && <div className="rr-state" role="alert">
        <h2>We couldn’t open your routes.</h2>
        <p>{error}</p>
        <button className="rr-btn rr-btn-primary" onClick={() => void load()}>Try again</button>
      </div>}

      {!error && !data && <div aria-busy="true" style={{ display: 'grid', gap: 11 }}>
        <div className="rr-skel" style={{ maxWidth: 260, height: 38 }}/>
        <div className="rr-skel rr-skel-day"/>
        <p className="rr-sr" role="status">Opening your routes.</p>
      </div>}

      {!error && data && focus === null && <>
        <div className="rr-week-head">
          <div className="rr-week-row">
            <div className="rr-week-nav">
              <button className="rr-nav-btn" aria-label="The week before"
                onClick={() => setWeek(addDays(week, -7))}><Icon name="back" size={19}/></button>
              <h1 className="rr-week-title">{weekLabel(week)}</h1>
              <button className="rr-nav-btn" aria-label="The week after"
                onClick={() => setWeek(addDays(week, 7))}><Icon name="arrow" size={19}/></button>
            </div>
            <div className="rr-today-btn" style={{ display: 'flex', gap: 7 }}>
              <button className="rr-btn rr-btn-outline" style={{ height: 34, fontSize: 13 }}
                onClick={() => setWeek(mondayOf(today))}>Today</button>
              {/* The one Add pickup on the week: it goes on the day being run. */}
              <button className="rr-btn rr-btn-primary" style={{ height: 34, fontSize: 13 }}
                disabled={!livePlans.length}
                onClick={() => livePlans[0] && setDrawer({ kind: 'pickup', roundId: livePlans[0].route.id })}>
                <Icon name="plus" size={15}/>Add pickup
              </button>
            </div>
          </div>
          <p className="rr-hint">{liveDay && livePlans.length
            ? <>{liveDay === today ? 'Today' : longDate(liveDay)}: <b>{livePlans.reduce((n, p) => n + p.items.length, 0)}</b> stops
                {' · '}<b>{livePlans.reduce((n, p) => n + p.completed, 0)}</b> completed
                {' · '}<b>{durationLabel(livePlans.reduce((n, p) => n + p.totalMinutes, 0))}</b> estimated</>
            : 'Nothing assigned this week. Pick a day to look at another one.'}</p>
        </div>

        <RunnerWeek days={days} today={today} liveDay={liveDay} plansFor={plansFor} busy={busy}
          practice={data.practice}
          onOpenDay={day => setFocus(day)}
          onOpen={openStop}
          onQuick={checkStop}
          onMove={(roundId, key, index) => void move(roundId, key, index)}/>
      </>}

      {!error && data && focus !== null && <FocusedDay
        day={focus} today={today} practice={data.practice} busy={busy}
        plans={plansFor(focus)} fullPlanOf={fullPlanOf}
        onBack={() => setFocus(null)}
        onOpen={openStop}
        onQuick={checkStop}
        onMove={(roundId, key, index) => void move(roundId, key, index)}
        onSupplies={roundId => setDrawer({ kind: 'supplies', roundId })}
        onAddPickup={roundId => setDrawer({ kind: 'pickup', roundId })}
        onNext={goNext}/>}
    </main>

    {/* On a phone the next stop follows you down the page. */}
    {running && !drawer && !visiting && <div className="rr-next">
      <button className="rr-btn rr-btn-primary" onClick={goNext}>
        {running.completed ? `Next: ${itemName(running.next!.item)}` : 'Start the route'}
        <Icon name="arrow" size={17}/>
      </button>
    </div>}

    <div className={`rr-backdrop ${drawer ? 'is-open' : ''}`} onClick={closeDrawer}/>
    <aside ref={sheetRef} tabIndex={-1} aria-labelledby="rr-sheet-title"
      className={`rr-sheet ${drawer ? 'is-open' : ''}`} role="dialog"
      aria-modal={drawer ? true : undefined} aria-hidden={drawer ? undefined : true}>
      {drawer && drawerRoute && <>
        {drawer.kind === 'stop' && (() => {
          const entry = entryOf(drawer.roundId, drawer.key);
          return entry ? <StopDrawer roundId={drawer.roundId} entry={entry}
            materials={drawerRoute.supplies.packed ?? drawerRoute.supplies.planned}
            onClose={closeDrawer}
            onQuick={() => { if (!entry.done) setDrawer({ kind: 'quick', roundId: drawer.roundId, key: drawer.key }); }}
            onStart={() => {
              if (entry.item.kind !== 'business') return;
              setDrawer(null);
              setVisiting({ roundId: drawer.roundId, businessId: entry.item.business.id });
            }}/> : null;
        })()}

        {drawer.kind === 'quick' && (() => {
          const entry = entryOf(drawer.roundId, drawer.key);
          if (!entry || entry.item.kind !== 'business' || entry.done) return null;
          const routeId = drawer.roundId;
          const businessId = entry.item.business.id;
          return <QuickResultDrawer entry={entry} today={today} busy={busy}
            remaining={drawerRoute.remaining} packed={drawerRoute.supplies.packed !== null}
            onDirty={() => { unsaved.current = true; }} onClose={closeDrawer}
            onSave={async quick => {
              setBusy(true);
              try {
                const saved = await recordRunnerVisit({
                  roundId: routeId, businessId, visitedOn: today,
                  spokeWith: quick.spokeWith, contactRole: '', outcome: quick.outcome,
                  dropped: quick.dropped, note: quick.note, nextAction: quick.nextAction,
                  followUpOn: quick.followUpOn, clientRef: quick.clientRef,
                });
                setData(current => current && ({
                  ...current,
                  routes: saved.route ? current.routes.map(route => route.id === saved.route!.id ? saved.route! : route) : current.routes,
                  visits: current.visits.some(visit => visit.id === saved.visit.id)
                    ? current.visits : [saved.visit, ...current.visits],
                }));
                unsaved.current = false;
                setDrawer(null);
                say(`Checked off: ${runnerOutcomeLabel(saved.visit.outcome, saved.visit.outcomeLabel)}.`);
              } finally { setBusy(false); }
            }}/>
        })()}

        {drawer.kind === 'collect' && (() => {
          const entry = entryOf(drawer.roundId, drawer.key);
          if (!entry || entry.item.kind !== 'pickup') return null;
          const pickupId = entry.item.id;
          return <CollectDrawer entry={entry} busy={busy}
            onClose={closeDrawer}
            onEdit={() => setDrawer({ kind: 'pickup', roundId: drawer.roundId, pickupId })}
            onCollect={async collected => {
              const saved = await write(
                () => collectPickup(drawer.roundId, pickupId, drawerRoute.revision, collected),
                'Picked up. Those supplies are in your car.');
              if (!saved) return;
              setDrawer(null);
              const plan = fullPlanOf(drawerRoute);
              const at = plan.items.findIndex(entryAt => refOf(entryAt.item) === refOf(entry.item));
              const after = at < 0 ? undefined : plan.items.slice(at + 1).find(entryAt => !entryAt.done);
              if (after?.item.kind === 'business') {
                setVisiting({ roundId: drawer.roundId, businessId: after.item.business.id });
              }
            }}/>;
        })()}

        {drawer.kind === 'pickup' && <PickupDrawer
          route={drawerRoute} pickupId={drawer.pickupId} busy={busy}
          onClose={closeDrawer}
          onDirty={() => { unsaved.current = true; }}
          onSave={async draft => {
            const saved = await write(() => savePickup(drawerRoute.id, drawerRoute.revision, draft),
              drawer.pickupId ? 'Pickup updated.' : 'Pickup added. Drag it into position.');
            if (saved) { unsaved.current = false; setDrawer(null); }
          }}
          onRemove={() => setConfirming({
            title: 'Remove this pickup?',
            text: 'Only the pickup comes off the route. Your assigned businesses and every visit you have recorded stay as they are.',
            run: () => {
              setConfirming(null); unsaved.current = false; setDrawer(null);
              void write(() => removePickup(drawerRoute.id, drawer.pickupId!, drawerRoute.revision), 'Pickup removed.');
            },
          })}/>}

        {drawer.kind === 'supplies' && <SuppliesDrawer
          route={drawerRoute} busy={busy}
          onClose={closeDrawer}
          onDirty={() => { unsaved.current = true; }}
          onSave={async packed => {
            const saved = await write(() => confirmPacked(drawerRoute.id, packed, drawerRoute.revision),
              'Supplies confirmed.');
            if (saved) { unsaved.current = false; setDrawer(null); }
          }}/>}
      </>}
    </aside>

    <div className={`rr-toast ${toast ? 'is-open' : ''}`} role="status">{toast}</div>

    {confirming && <div className="rr-dialog-backdrop">
      <div className="rr-dialog" role="alertdialog" aria-modal="true" aria-labelledby="rr-confirm">
        <h2 id="rr-confirm">{confirming.title}</h2>
        <p>{confirming.text}</p>
        <div className="rr-dialog-actions">
          <button className="rr-btn rr-btn-outline" onClick={() => setConfirming(null)}>Cancel</button>
          <button className="rr-btn rr-btn-primary" onClick={confirming.run}>Continue</button>
        </div>
      </div>
    </div>}
  </>;
}

/** ONE DAY, FULL WIDTH — the same cards, bigger, for a runner who is actually out. */
function FocusedDay({ day, today, practice, busy, plans, fullPlanOf, onBack, onOpen, onQuick, onMove,
  onSupplies, onAddPickup, onNext }: {
  day: string; today: string; practice: string; busy: boolean;
  plans: DayPlan[];
  fullPlanOf: (route: RunnerRoute) => ReturnType<typeof planRoute>;
  onBack: () => void;
  onOpen: (roundId: string, entry: PlannedItem) => void;
  onQuick: (roundId: string, entry: PlannedItem) => void;
  onMove: (roundId: string, key: string, index: number) => void;
  onSupplies: (roundId: string) => void;
  onAddPickup: (roundId: string) => void;
  onNext: () => void;
}) {
  const stops = plans.reduce((total, plan) => total + plan.items.length, 0);
  const done = plans.reduce((total, plan) => total + plan.completed, 0);
  const minutes = plans.reduce((total, plan) => total + plan.totalMinutes, 0);
  const first = plans[0];
  const full = first ? fullPlanOf(first.route) : null;

  return <>
    <div className="rr-focus-head">
      <div>
        <button className="rr-btn rr-btn-ghost" style={{ paddingLeft: 0, height: 28 }} onClick={onBack}>
          <Icon name="back" size={15}/>Back to the week
        </button>
        <h1 className="rr-focus-title">{day === today ? 'Today' : longDate(day)}</h1>
        <p className="rr-focus-sub">{plans.length
          ? `${practice} · assigned to ${first.route.staff || 'you'}`
          : 'Nothing assigned for this day'}</p>
      </div>
      {plans.length > 0 && <div className="rr-focus-actions">
        <button className="rr-btn rr-btn-outline" onClick={() => onSupplies(first.route.id)}>
          <Icon name="box" size={15}/>Supplies
        </button>
        <button className="rr-btn rr-btn-outline" onClick={() => onAddPickup(first.route.id)}>
          <Icon name="plus" size={15}/>Add pickup
        </button>
        {full?.next && <button className="rr-btn rr-btn-primary" onClick={onNext}>
          {full.completed ? 'Next stop' : 'Start the route'}<Icon name="arrow" size={16}/>
        </button>}
      </div>}
    </div>

    {plans.length === 0
      ? <div className="rr-state">
          <h2>No route for this day.</h2>
          <p>Your office assigns the businesses on a route. When a day is assigned to you it
            appears here, with the stops in order and the script for every conversation.</p>
        </div>
      : <>
          <p className="rr-hint">
            <b>{stops}</b> stops · <b>{done}</b> completed · <b>{durationLabel(minutes)}</b> estimated
            {full && <> · leave at <b>{clockOf(full.startsAt)}</b></>}
          </p>
          <div className="rr-progress" role="img" aria-label={`${done} of ${stops} stops finished`}>
            <i style={{ width: `${stops ? (done / stops) * 100 : 0}%` }}/>
          </div>

          {full?.warnings.map(warning => <p className="rr-warn" key={warning}>
            <Icon name="warn" size={15}/>{warning}
          </p>)}

          <div className="rr-focus-list">
            {plans.map((plan, index) => <RoundStops key={plan.route.id} plan={plan} large
              label={plans.length > 1 ? `Round ${index + 1} · ${clockOf(plan.startsAt)}` : null}
              dragKey={null} dropAt={null} busy={busy}
              onOpen={entry => onOpen(plan.route.id, entry)}
              onQuick={entry => onQuick(plan.route.id, entry)}
              onMove={onMove}/>)}
          </div>
        </>}
  </>;
}
