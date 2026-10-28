// THE PRACTICE OWNER'S FIRST SCREEN.
//
// A different reader from the staff portal. An owner is not going anywhere today — they want
// to know who is in their network, what is scheduled, and what came of it. So this screen has
// no scripts, no "record a visit", and no round to start.
//
// WHAT IT WILL NOT SHOW, and each of these is a rule rather than an oversight:
//   - No money. No revenue, no appointments, no conversions. The database does not know them.
//   - No patient-identifying anything.
//   - No per-business figures beside a name in the connections list. A practice sees who is
//     in its network, not a league table of them.
//   - No visit script. The API does not even send one to this role.
//   - Nothing invented. No route, no QR code, no NFC link. A missing field reads "Not added".
//   - No bubble graph. A circle big enough to hold a business name is a large circle, and
//     twenty-five of them crowd. The network here is an orbit of name cards instead.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { getRounds, getBusinesses, assignRound, type Business, type Round, type Runner, type Visit } from './lib/api';
import { planRound, clockOf, durationLabel, milesFrom } from './lib/round-math';
import { staffMonth, owedACall, activitySeries } from './lib/staff-dashboard';
import { Icon, type IconName } from './Icons';
import ReferralOrbit from './ReferralOrbit';

type View = 'home' | 'network' | 'history' | 'performance' | 'businesses';

// The four cards are a tablist: each one opens its own supporting panel underneath. The panel
// is the only thing that changes — the network and everything below it stay where they are,
// because an owner uses this screen by glancing at the same places twice a day.
const METRICS = ['accounts', 'routes', 'materials', 'followups'] as const;
type MetricKey = (typeof METRICS)[number];
const RADII = [5, 10, 15] as const;
type Radius = (typeof RADII)[number];

const dayLabel = (iso: string) => new Date(`${iso}T12:00:00Z`)
  .toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });

export default function OwnerDashboard({ clinicName, today, ownerName, onGo }: {
  clinicName: string; today: string; ownerName?: string | null; onGo: (view: View) => void;
}) {
  const [data, setData] = useState<{ rounds: Round[]; visits: Visit[]; businesses: Business[]; clinic: { lat: number; lng: number } | null; runners: Runner[] } | null>(null);
  const [error, setError] = useState('');
  const [radius, setRadius] = useState<Radius>(5);
  const [openRoute, setOpenRoute] = useState<string | null>(null);
  const [focus, setFocus] = useState<MetricKey>('accounts');
  // The round currently being sent, so its own button says so rather than the whole list
  // going quiet, and a second tap cannot send it twice.
  const [sending, setSending] = useState<string | null>(null);
  const [sendError, setSendError] = useState('');
  // Which runner is chosen per round, only used when a practice has more than one.
  const [pick, setPick] = useState<Record<string, string>>({});

  const load = useCallback(() => {
    setError('');
    return Promise.all([getRounds(), getBusinesses()])
      .then(([r, b]) => setData({ rounds: r.rounds, visits: r.visits, businesses: b.businesses, clinic: r.clinic, runners: r.runners }))
      .catch(e => setError(e instanceof Error ? e.message : 'We couldn’t open your dashboard.'));
  }, []);

  // Send a booked round to a runner, or take it back. The server decides whether this account
  // may do it; this only asks and then reloads from the server rather than guessing the result.
  const send = useCallback(async (roundId: string, runnerId: string | null) => {
    setSending(roundId);
    setSendError('');
    try { await assignRound(roundId, runnerId); await load(); }
    catch (e) { setSendError(e instanceof Error ? e.message : 'That round could not be sent.'); }
    finally { setSending(null); }
  }, [load]);
  useEffect(() => { void load(); }, [load]);

  // Within the radius, by straight-line distance from the practice. A business with no map
  // position cannot be measured, so it is listed under its own heading rather than silently
  // dropped or counted as nearby.
  const connections = useMemo(() => {
    if (!data) return { within: [], unplaced: [] as Business[] };
    const here = data.clinic;
    const within: Business[] = [], unplaced: Business[] = [];
    for (const business of data.businesses) {
      if (!here || business.lat === null || business.lng === null) { unplaced.push(business); continue; }
      if (milesFrom(here, { lat: business.lat, lng: business.lng }) <= radius) within.push(business);
    }
    return { within: within.sort((a, b) => a.name.localeCompare(b.name)), unplaced };
  }, [data, radius]);

  const month = useMemo(() => data ? staffMonth(data.visits, data.businesses, today) : null, [data, today]);
  const scheduled = useMemo(() => data
    ? [...data.rounds].sort((a, b) => b.date.localeCompare(a.date))
    : [], [data]);

  // Arrow keys move between the cards, as a tablist is expected to. The card that opens is the
  // one that is focused, so a keyboard reader and a mouse reader see the same thing.
  const onTabKey = (event: React.KeyboardEvent<HTMLElement>) => {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    const to = step ? (METRICS.indexOf(focus) + step + METRICS.length) % METRICS.length
      : event.key === 'Home' ? 0 : event.key === 'End' ? METRICS.length - 1 : -1;
    if (to < 0) return;
    event.preventDefault();
    setFocus(METRICS[to]);
    (event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')[to])?.focus();
  };

  if (error) return <div className="own"><div className="own-state" role="alert">
    <h2>We couldn’t open your dashboard.</h2><p>{error}</p>
    <button className="dash-btn" onClick={() => void load()}>Try again</button>
  </div></div>;

  if (!data || !month) return <div className="own" aria-busy="true">
    <div className="own-head"><div><p className="own-eyebrow">Practice owner dashboard</p><h1>{clinicName}</h1></div></div>
    <div className="own-metrics">{[0, 1, 2, 3].map(n => <div className="own-metric ov-skel" key={n}/>)}</div>
    <div className="own-panel ov-skel" style={{ minHeight: 300 }}/>
    <p className="sr-only" role="status">Loading your dashboard.</p>
  </div>;

  const route = openRoute ? data.rounds.find(r => r.id === openRoute) ?? null : null;
  if (route) return <RouteDetail route={route} visits={data.visits} clinic={data.clinic}
    practice={clinicName} today={today} onBack={() => setOpenRoute(null)}/>;

  return <div className="own">
    <header className="own-head">
      <div>
        <p className="own-eyebrow">Practice owner dashboard</p>
        <h1>{clinicName}</h1>
        <p className="own-sub">Your referral connections, outreach routes, and activity in one place.</p>
      </div>
      {ownerName && <span className="own-chip">{ownerName} · Practice owner</span>}
    </header>

    <section className="own-metrics" role="tablist" aria-label="Practice activity" onKeyDown={onTabKey}>
      <Metric id="accounts" selected={focus === 'accounts'} onSelect={setFocus}
        label="Referral accounts" value={data.businesses.length} icon="people"
        note={data.businesses.length ? 'Curated for your practice' : 'None released yet'}/>
      <Metric id="routes" selected={focus === 'routes'} onSelect={setFocus}
        label="Routes scheduled" value={scheduled.filter(r => r.date >= today).length} icon="route"
        note={scheduled.length ? `${scheduled.length} on record` : 'None scheduled'}/>
      <Metric id="materials" selected={focus === 'materials'} onSelect={setFocus}
        label="Materials dropped" value={month.materials} icon="sparkle" tone="gold"
        note="This month, from recorded visits"/>
      <Metric id="followups" selected={focus === 'followups'} onSelect={setFocus}
        label="Follow-ups due" value={month.followUpsDue} icon="clock" tone="blue"
        note={month.overdue ? `${month.overdue} overdue` : 'None overdue'}/>
    </section>

    <StatSwap which={focus} businesses={data.businesses} visits={data.visits}
      rounds={scheduled} clinic={data.clinic} month={month} today={today}/>

    <section className="own-panel own-network" aria-labelledby="own-net">
      <div className="own-panel-head">
        <div>
          <h2 id="own-net">Your referral network</h2>
          <p>A clear path through the local businesses connected to your practice</p>
        </div>
        <span className="own-kicker">Within {radius} miles</span>
      </div>
      <div className="orb2-wrap">
        <ReferralOrbit practice={clinicName}
          connections={connections.within.map(b => ({ id: b.id, name: b.name, demo: b.demo === 1 }))}/>
      </div>
    </section>

    <div className="own-two">
      <section className="own-panel" aria-labelledby="own-conn">
        <div className="own-panel-head">
          <div>
            <h2 id="own-conn">Referral connections</h2>
            <p>Businesses matched for {clinicName}</p>
          </div>
          <label className="own-radius">
            <span className="sr-only">Referral radius</span>
            <select value={radius} onChange={e => setRadius(Number(e.target.value) as Radius)}>
              {RADII.map(r => <option key={r} value={r}>Within {r} miles</option>)}
            </select>
          </label>
        </div>

        {connections.within.length === 0
          ? <p className="own-empty">
              No matched businesses within {radius} miles.
              {connections.unplaced.length > 0 && ' Some have no map position yet — see below.'}
            </p>
          : <ul className="own-conns">
              {connections.within.slice(0, 15).map(business => <li key={business.id}>
                <span className="own-mark" aria-hidden="true">
                  {business.name.split(/\s+/).map(p => p[0]).join('').slice(0, 2).toUpperCase()}
                </span>
                <span className="own-conn-name">{business.name}</span>
                {business.demo === 1 && <span className="sample-tag">Sample</span>}
              </li>)}
            </ul>}

        {connections.within.length > 15 && <p className="own-caption">
          Showing 15 of {connections.within.length}.
        </p>}
        {connections.unplaced.length > 0 && <p className="own-caption">
          {connections.unplaced.length} {connections.unplaced.length === 1 ? 'business has' : 'businesses have'} no
          map position yet, so {connections.unplaced.length === 1 ? 'it is' : 'they are'} not measured
          against the radius: {connections.unplaced.map(b => b.name).join(', ')}.
        </p>}
        <p className="own-caption">Business names only. Your practice sees its own assigned connections.</p>
      </section>

      <section className="own-panel" aria-labelledby="own-routes">
        <div className="own-panel-head">
          <div>
            <h2 id="own-routes">Route watchlist</h2>
            <p>Routes scheduled or already run</p>
          </div>
        </div>

        {sendError && <p className="own-send-error" role="alert">{sendError}</p>}

        {scheduled.length === 0
          ? <p className="own-empty">No route is scheduled. When one is booked it appears here, and
              selecting it opens the full route.</p>
          : <ul className="own-routes">
              {scheduled.slice(0, 6).map(r => {
                const plan = planRound(data.clinic, r, data.visits, { today });
                const state = plan.completed === plan.stops.length && plan.stops.length
                  ? 'Completed'
                  : plan.completed > 0 ? 'In progress'
                  : r.date < today ? 'Not recorded' : 'Scheduled';
                const runners = data.runners;
                const chosen = pick[r.id] ?? runners[0]?.id ?? '';
                const busy = sending === r.id;
                return <li key={r.id}>
                  <button className="own-route" onClick={() => setOpenRoute(r.id)}>
                    <span className="own-route-icon" aria-hidden="true"><Icon name="route" size={15}/></span>
                    <span className="own-route-main">
                      <strong>{dayLabel(r.date)}</strong>
                      <span>{r.stops.length} {r.stops.length === 1 ? 'stop' : 'stops'}
                        {r.staff ? ` · ${r.staff}` : ''} · {plan.completed} of {r.stops.length} recorded</span>
                    </span>
                    <span className={`dash-pill dash-pill-${state === 'Completed' ? 'good' : state === 'In progress' ? 'warn' : 'neutral'}`}>{state}</span>
                  </button>

                  {/* Sending is its own control beside the route, not inside it: a button
                      within a button is neither valid nor reachable by keyboard. */}
                  <div className="own-route-send">
                    {r.runnerId
                      ? <>
                          <span className="own-route-with">
                            <Icon name="check" size={13}/> On {r.runnerName || 'a runner'}’s planner
                          </span>
                          <button type="button" className="own-send-undo" disabled={busy}
                            onClick={() => void send(r.id, null)}>
                            {busy ? 'Taking back…' : 'Take back'}
                          </button>
                        </>
                      : runners.length === 0
                        ? <span className="own-route-with own-route-none">
                            Nobody to send it to yet — this practice has no route runner login.
                          </span>
                        : <>
                            {runners.length > 1 && <label className="own-send-pick">
                              <span className="sr-only">Who walks {dayLabel(r.date)}</span>
                              <select value={chosen} disabled={busy}
                                onChange={e => setPick(p => ({ ...p, [r.id]: e.target.value }))}>
                                {runners.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                              </select>
                            </label>}
                            <button type="button" className="own-send" disabled={busy || !chosen}
                              onClick={() => void send(r.id, chosen)}>
                              {busy ? 'Sending…' : runners.length > 1
                                ? 'Send to planner'
                                : `Send to ${runners[0].name}`}
                            </button>
                          </>}
                  </div>
                </li>;
              })}
            </ul>}
      </section>
    </div>
  </div>;
}

/**
 * THE PANEL UNDER THE CARDS. Whichever card is selected, this says what is behind its number.
 *
 * Every figure here is counted from records the practice already has — released businesses,
 * saved visits and planned rounds. Nothing is estimated and nothing is carried over from
 * another practice. The rules the rest of this screen keeps apply here too: no money, no
 * appointments, nobody's name but a business's, and no league table of businesses.
 */
function StatSwap({ which, businesses, visits, rounds, clinic, month, today }: {
  which: MetricKey; businesses: Business[]; visits: Visit[]; rounds: Round[];
  clinic: { lat: number; lng: number } | null;
  month: ReturnType<typeof staffMonth>; today: string;
}) {
  const body = useMemo(() => {
    if (which === 'accounts') return accountsPanel(businesses);
    if (which === 'routes') return routesPanel(rounds, visits, clinic, today);
    if (which === 'materials') return materialsPanel(visits, month, today);
    return followUpsPanel(visits, month, today);
  }, [which, businesses, visits, rounds, clinic, month, today]);

  return <section className="own-panel own-swap" id="own-swap" role="tabpanel"
    aria-labelledby={`own-tab-${which}`} tabIndex={-1}>
    <div className="own-panel-head">
      <div><h2>{body.title}</h2><p>{body.caption}</p></div>
    </div>
    <div className="own-swap-body" key={which}>{body.content}</div>
  </section>;
}

/** A figure and what it counts. Not a card — these sit in a row inside the panel. */
const Stat = ({ label, value, note }: { label: string; value: string | number; note?: string }) =>
  <div className="own-swap-stat">
    <dt>{label}</dt>
    <dd>{value}</dd>
    {note && <p>{note}</p>}
  </div>;

const STAGE_LABEL: Record<string, string> = {
  new: 'Not contacted yet', visited: 'Visited', interested: 'Interested',
  partner: 'Partnered', 'follow-up': 'Follow-up agreed', declined: 'Not interested',
};

/** Where the released businesses have got to, and how many can be put on the map. */
function accountsPanel(businesses: Business[]) {
  const byStage = new Map<string, number>();
  for (const business of businesses) byStage.set(business.stage, (byStage.get(business.stage) ?? 0) + 1);
  const stages = [...byStage.entries()].sort((a, b) => b[1] - a[1]);
  const placed = businesses.filter(b => b.lat !== null && b.lng !== null).length;
  const sample = businesses.filter(b => b.demo === 1).length;

  return {
    title: 'Referral accounts',
    caption: 'Where each released business has got to',
    content: !businesses.length
      ? <p className="own-empty">No businesses have been released to your practice yet.</p>
      : <>
          <dl className="own-swap-grid">
            {stages.map(([stage, count]) =>
              <Stat key={stage} label={STAGE_LABEL[stage] ?? stage} value={count}/>)}
          </dl>
          <p className="own-caption">
            {placed === businesses.length
              ? `All ${businesses.length} can be shown on the map.`
              : `${placed} of ${businesses.length} can be shown on the map; the ${businesses.length - placed} others have no position yet.`}
            {sample > 0 && ` ${sample} ${sample === 1 ? 'is' : 'are'} sample data, marked as such wherever ${sample === 1 ? 'it appears' : 'they appear'}.`}
          </p>
        </>,
  };
}

/** The next round, and what the rounds on record add up to. */
function routesPanel(rounds: Round[], visits: Visit[], clinic: { lat: number; lng: number } | null, today: string) {
  const upcoming = rounds.filter(r => r.date >= today).sort((a, b) => a.date.localeCompare(b.date));
  const next = upcoming[0] ?? rounds[0] ?? null;
  const plan = next ? planRound(clinic, next, visits, { today }) : null;
  const stops = rounds.reduce((total, r) => total + r.stops.length, 0);
  const recorded = rounds.reduce((total, r) => total + planRound(clinic, r, visits, { today }).completed, 0);

  return {
    title: next && next.date >= today ? 'Next route' : 'Routes on record',
    caption: next ? `${rounds.length} ${rounds.length === 1 ? 'route' : 'routes'} on record for your practice` : 'Nothing booked yet',
    content: !next || !plan
      ? <p className="own-empty">No route is scheduled. When one is booked it appears here.</p>
      : <>
          <dl className="own-swap-grid">
            <Stat label={next.date >= today ? 'Next route' : 'Most recent'} value={dayLabel(next.date)}
              note={next.staff ? next.staff : undefined}/>
            <Stat label="Stops on it" value={next.stops.length}
              note={plan.stops.length ? `${plan.completed} recorded so far` : undefined}/>
            <Stat label="Routes ahead" value={upcoming.length}
              note={upcoming.length ? undefined : 'None booked'}/>
            <Stat label="Stops recorded" value={`${recorded} of ${stops}`} note="Across every route"/>
          </dl>
          <p className="own-caption">
            A booked stop is an intention. Only a visit somebody has recorded counts as done.
          </p>
        </>,
  };
}

/** What was dropped this month, against last month, and by kind where that was counted. */
function materialsPanel(visits: Visit[], month: ReturnType<typeof staffMonth>, today: string) {
  const here = today.slice(0, 7);
  const mine = visits.filter(v => v.visitedOn.slice(0, 7) === here);
  const carrying = mine.filter(v => v.materials > 0).length;
  const kinds = mine.reduce((total, v) => v.dropped
    ? { flyers: total.flyers + v.dropped.flyers, treats: total.treats + v.dropped.treats,
        cards: total.cards + v.dropped.cards, counted: total.counted + 1 }
    : total, { flyers: 0, treats: 0, cards: 0, counted: 0 });
  const change = month.materials - month.materialsLastMonth;
  const weeks = activitySeries(mine, 'week', today);

  return {
    title: 'Materials dropped',
    caption: 'This calendar month, from visits somebody recorded',
    content: !mine.length
      ? <p className="own-empty">No visits have been recorded this month, so nothing has been counted.</p>
      : <>
          <dl className="own-swap-grid">
            <Stat label="This month" value={month.materials} note={`Across ${carrying} ${carrying === 1 ? 'visit' : 'visits'}`}/>
            <Stat label="Last month" value={month.materialsLastMonth}
              note={change === 0 ? 'The same' : `${Math.abs(change)} ${change > 0 ? 'more' : 'fewer'} this month`}/>
            {kinds.counted > 0 && <Stat label="Flyers" value={kinds.flyers}/>}
            {kinds.counted > 0 && <Stat label="Treats and cards" value={kinds.treats + kinds.cards}/>}
          </dl>
          {weeks.length > 1 && <ul className="own-swap-weeks">
            {weeks.map(week => <li key={week.key}>
              <span>{week.label}</span><strong>{week.materials}</strong>
            </li>)}
          </ul>}
          {kinds.counted > 0 && kinds.counted < carrying && <p className="own-caption">
            {carrying - kinds.counted} of these {carrying} visits recorded a total only, so the
            split by kind covers {kinds.counted} of them.
          </p>}
        </>,
  };
}

/** The businesses somebody said they would go back to, and has not. */
function followUpsPanel(visits: Visit[], month: ReturnType<typeof staffMonth>, today: string) {
  const owed = owedACall(visits, today, 15);
  return {
    title: 'Follow-ups due',
    caption: 'A date was agreed, and nobody has been back since',
    content: !owed.length
      ? <p className="own-empty">Nothing is waiting. Every follow-up that has come due has been answered.</p>
      : <>
          <dl className="own-swap-grid">
            <Stat label="Due" value={month.followUpsDue}/>
            <Stat label="Overdue" value={month.overdue} note={month.overdue ? 'Past the agreed date' : 'None past its date'}/>
          </dl>
          <ul className="own-swap-list">
            {owed.map(visit => <li key={visit.id}>
              <span className="own-conn-name">{visit.businessName}</span>
              <span className={visit.followUpOn! < today ? 'own-swap-late' : 'own-swap-when'}>
                {visit.followUpOn! < today ? 'Overdue since ' : 'Due '}{dayLabel(visit.followUpOn!)}
              </span>
            </li>)}
          </ul>
          <p className="own-caption">Business names only, newest date last. Showing up to 15.</p>
        </>,
  };
}

/**
 * One card, and the control that opens its panel.
 *
 * It is a button rather than a card with a click handler, so it is reachable by keyboard and
 * announced as a control without any of it being bolted on afterwards. Only the selected card
 * is in the tab order; the arrow keys move between them from there.
 */
function Metric({ id, label, value, icon, note, tone, selected, onSelect }: {
  id: MetricKey; label: string; value: number; icon: IconName; note: string;
  tone?: 'gold' | 'blue'; selected: boolean; onSelect: (id: MetricKey) => void;
}) {
  return <button type="button" className="own-metric" role="tab" id={`own-tab-${id}`}
    aria-selected={selected} aria-controls="own-swap" tabIndex={selected ? 0 : -1}
    onClick={() => onSelect(id)}>
    <span className="own-metric-top">
      <span className="own-metric-label">{label}</span>
      <span className={`own-metric-icon ${tone ?? ''}`} aria-hidden="true"><Icon name={icon} size={14}/></span>
    </span>
    <span className="own-metric-value">{value}</span>
    <span className="own-metric-note">{note}</span>
  </button>;
}

/**
 * ONE ROUTE, FULL SCREEN. The stops in order with what was recorded at each.
 *
 * QR and NFC are real fields on a business that nothing populates yet. They read "Not added"
 * rather than being hidden, because an owner asking "where is the QR code for this stop" is
 * owed an answer, and the honest answer today is that nobody has added one.
 */
function RouteDetail({ route, visits, clinic, practice, today, onBack }: {
  route: Round; visits: Visit[]; clinic: { lat: number; lng: number } | null;
  practice: string; today: string; onBack: () => void;
}) {
  const plan = planRound(clinic, route, visits, { today });
  const state = plan.completed === plan.stops.length && plan.stops.length
    ? 'Completed' : plan.completed > 0 ? 'In progress' : route.date < today ? 'Not recorded' : 'Scheduled';

  return <div className="own own-detail">
    <div className="own-detail-head">
      <button className="own-back" onClick={onBack} aria-label="Back to the dashboard">
        <Icon name="back" size={16}/>
      </button>
      <div>
        <h1>{dayLabel(route.date)}</h1>
        <p>{practice} · full route details</p>
      </div>
      <span className={`dash-pill dash-pill-${state === 'Completed' ? 'good' : state === 'In progress' ? 'warn' : 'neutral'}`}>{state}</span>
    </div>

    <div className="own-summary">
      <Cell label="Scheduled date" value={dayLabel(route.date)}/>
      <Cell label="Assigned staff" value={route.staff || 'Not assigned'}/>
      <Cell label="Stops" value={String(route.stops.length)}/>
      <Cell label="Expected" value={plan.stops.length
        ? `${clockOf(plan.startsAt)} – ${clockOf(plan.endsAt)} · ${durationLabel(plan.totalMinutes)}`
        : '—'}/>
    </div>

    <section className="own-panel">
      <div className="own-panel-head">
        <div>
          <h2>Stops and visit records</h2>
          <p>Ordered stops, with materials dropped and the QR and NFC details for each</p>
        </div>
      </div>

      {!plan.stops.length
        ? <p className="own-empty">This route has no stops on record.</p>
        : <ol className="own-stops">
            {plan.stops.map(stop => {
              const visit = stop.visit;
              return <li key={stop.business.id}>
                <div className="own-stop-head">
                  <span className="own-stop-n">{stop.index + 1}</span>
                  <div>
                    <strong>{stop.business.name}
                      {stop.business.demo === 1 && <span className="sample-tag">Sample</span>}</strong>
                    <small>{stop.business.address || 'Address not added'}</small>
                  </div>
                </div>

                <div className="own-stop-grid">
                  <dl className="own-facts">
                    <div><dt>Visit status</dt><dd>{visit ? visit.outcomeLabel : 'Not recorded'}</dd></div>
                    <div><dt>Visit date</dt><dd>{visit ? dayLabel(visit.visitedOn) : '—'}</dd></div>
                    <div><dt>Materials dropped</dt><dd>{visit ? visit.materials : 'Not recorded'}</dd></div>
                    <div><dt>Follow-up</dt><dd>{visit?.followUpOn ? dayLabel(visit.followUpOn) : 'Not scheduled'}</dd></div>
                  </dl>

                  <div className="own-codes">
                    <div className="own-code">
                      <strong>Stop QR code</strong>
                      <span className="own-code-none">Not added</span>
                    </div>
                    <div className="own-code">
                      <strong>NFC destination</strong>
                      <span className="own-code-none">Not added</span>
                    </div>
                  </div>
                </div>

                {visit?.note && <p className="own-stop-note">“{visit.note}”</p>}
              </li>;
            })}
          </ol>}
    </section>

    <p className="own-caption">
      QR codes and NFC destinations are not recorded for any stop yet. When they are added they
      appear here against the stop they belong to.
    </p>
  </div>;
}

const Cell = ({ label, value }: { label: string; value: string }) =>
  <div className="own-cell"><label>{label}</label><span>{value}</span></div>;
