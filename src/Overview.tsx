// THE OVERVIEW. A command centre for one person's day, on a deep forest canvas.
//
// The shape is fixed and deliberate: two dominant panels, four figures, two lists. Everything
// a field rep needs before setting off is in the first screen, and nothing on it is decoration.
//
// WHAT THIS SCREEN WILL NOT DO:
//   - It will not invent a round. No round booked means an empty state that says so.
//   - It will not pad the chart. Three weeks of records draw three columns, not twelve with
//     nine zeroes — a padded chart shows a flat run that never happened.
//   - It counts from the same records Visit History and Performance count from, so the same
//     filter gives the same number on all three screens.
//   - No revenue, no appointments, no conversions. This database does not know them.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { getRounds, getBusinesses, type Business, type Round, type Visit } from './lib/api';
import { planRound, clockOf, durationLabel, type RoundPlan } from './lib/round-math';
import { nextRound, staffMonth, owedACall, activitySeries, type Bucket } from './lib/staff-dashboard';
import { Icon, type IconName } from './Icons';

type View = 'home' | 'agenda' | 'businesses' | 'history' | 'performance' | 'network' | 'notes';
type Period = 'week' | 'month';

const dayLabel = (iso: string) => new Date(`${iso}T12:00:00Z`)
  .toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
const shortDay = (iso: string) => new Date(`${iso}T12:00:00Z`)
  .toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

const STAGE_LABEL: Record<Business['stage'], string> = {
  new: 'Not contacted', visited: 'Visited', interested: 'Interested',
  partner: 'Active partner', 'follow-up': 'Follow-up due', declined: 'Declined',
};
const STAGE_TONE: Record<Business['stage'], string> = {
  new: 'neutral', visited: 'neutral', interested: 'warn',
  partner: 'good', 'follow-up': 'warn', declined: 'quiet',
};

export default function Overview({ clinicName, today, staffName, onGo }: {
  clinicName: string; today: string; staffName?: string | null; onGo: (view: View) => void;
}) {
  const [data, setData] = useState<{ rounds: Round[]; visits: Visit[]; businesses: Business[]; clinic: { lat: number; lng: number } | null } | null>(null);
  const [error, setError] = useState('');
  const [period, setPeriod] = useState<Period>('week');

  const load = useCallback(() => {
    setError('');
    return Promise.all([getRounds(), getBusinesses()])
      .then(([r, b]) => setData({ rounds: r.rounds, visits: r.visits, businesses: b.businesses, clinic: r.clinic }))
      .catch(e => setError(e instanceof Error ? e.message : 'We couldn’t open your overview.'));
  }, []);
  useEffect(() => { void load(); }, [load]);

  const booked = useMemo(() => data ? nextRound(data.rounds, today) : null, [data, today]);
  const plan = useMemo(() => booked && data ? planRound(data.clinic, booked, data.visits, { today }) : null, [booked, data, today]);
  const month = useMemo(() => data ? staffMonth(data.visits, data.businesses, today) : null, [data, today]);
  const series = useMemo(() => data ? activitySeries(data.visits, period, today) : [], [data, period, today]);
  const owed = useMemo(() => data ? owedACall(data.visits, today, 4) : [], [data, today]);

  const todayLabel = new Date(`${today}T12:00:00Z`)
    .toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });

  if (error) return <div className="ov"><div className="ov-state" role="alert">
    <h2>We couldn’t open your overview.</h2><p>{error}</p>
    <button className="dash-btn" onClick={() => void load()}>Try again</button>
  </div></div>;

  if (!data || !month) return <div className="ov" aria-busy="true">
    <Head name={staffName} clinic={clinicName} date={todayLabel}/>
    <div className="ov-top">
      <div className="ov-panel ov-skel"/><div className="ov-panel ov-skel"/>
    </div>
    <div className="ov-kpis">{[0, 1, 2, 3].map(n => <div className="ov-kpi ov-skel" key={n}/>)}</div>
    <p className="sr-only" role="status">Loading your overview.</p>
  </div>;

  return <div className="ov">
    <Head name={staffName} clinic={clinicName} date={todayLabel}/>

    <div className="ov-top">
      <RoundPanel plan={plan} round={booked} today={today} onGo={onGo}/>
      <ActivityPanel series={series} period={period} onPeriod={setPeriod}/>
    </div>

    <div className="ov-kpis">
      <Kpi label="Visits this month" value={month.visits} icon="check"
        foot={<Trend now={month.visits} before={month.visitsLastMonth}/>}
        onOpen={() => onGo('history')}/>
      <Kpi label="Active relationships" value={month.partners} icon="people"
        foot={<span className="ov-foot">of {month.assigned} assigned</span>}
        bar={month.assigned ? month.partners / month.assigned : 0}
        onOpen={() => onGo('businesses')}/>
      <Kpi label="Materials this month" value={month.materials} icon="sparkle"
        foot={<Trend now={month.materials} before={month.materialsLastMonth}/>}
        onOpen={() => onGo('performance')}/>
      <Kpi label="Follow-ups due" value={month.followUpsDue} icon="calendar" alert={month.overdue > 0}
        foot={month.overdue
          ? <span className="ov-foot is-alert">{month.overdue} overdue</span>
          : <span className="ov-foot">None overdue</span>}
        onOpen={() => onGo('history')}/>
    </div>

    <div className="ov-lower">
      <Panel title="Assigned businesses" action={{ label: 'View all', go: () => onGo('businesses') }}>
        {data.businesses.length === 0
          ? <p className="ov-empty">No businesses have been released to this practice yet.</p>
          : <ul className="ov-rows">
              {[...data.businesses]
                .sort((a, b) => (a.stage === 'new' ? 0 : 1) - (b.stage === 'new' ? 0 : 1))
                .slice(0, 5).map(business => <li key={business.id}>
                  <button className="ov-row" onClick={() => onGo('businesses')}>
                    <span className="ov-row-main">
                      <strong>{business.name}{business.demo === 1 && <span className="sample-tag">Sample</span>}</strong>
                      <span>{business.category}</span>
                    </span>
                    <span className={`dash-pill dash-pill-${STAGE_TONE[business.stage]}`}>{STAGE_LABEL[business.stage]}</span>
                    <Icon name="arrow" size={15}/>
                  </button>
                </li>)}
            </ul>}
      </Panel>

      <Panel title="Follow-ups & attention needed"
        action={{ label: 'Visit history', go: () => onGo('history') }}>
        {owed.length === 0
          ? <p className="ov-empty">Nothing is owed a second call. Every follow-up on record has been kept.</p>
          : <ul className="ov-rows">
              {owed.map(visit => <li key={visit.id}>
                <button className="ov-row" onClick={() => onGo('history')}>
                  <span className="ov-row-main">
                    <strong>{visit.businessName}</strong>
                    <span>{visit.outcomeLabel}{visit.nextAction ? ` · ${visit.nextAction}` : ''}</span>
                  </span>
                  <span className={`dash-pill dash-pill-${visit.followUpOn! < today ? 'warn' : 'neutral'}`}>
                    {visit.followUpOn! < today ? 'Overdue' : 'Due'} {shortDay(visit.followUpOn!)}
                  </span>
                  <Icon name="arrow" size={15}/>
                </button>
              </li>)}
            </ul>}
      </Panel>
    </div>
  </div>;
}

/** A compact bar: who, where, when. No greeting banner eating the first screen. */
function Head({ name, clinic, date }: { name?: string | null; clinic: string; date: string }) {
  return <header className="ov-head">
    <div>
      <h1>Overview</h1>
      {/* A login with nobody named on it is the practice, not a person. Printing the clinic
          twice is what happens when that is not said. */}
      <p>{name ? `${name} · ${clinic}` : clinic}</p>
    </div>
    <span className="ov-date"><Icon name="calendar" size={15}/>{date}</span>
  </header>;
}

/** THE OPERATIONAL CENTREPIECE. The round, and the way into it. */
function RoundPanel({ plan, round, today, onGo }: {
  plan: RoundPlan | null; round: Round | null; today: string; onGo: (view: View) => void;
}) {
  if (!plan || !round) return <section className="ov-panel ov-round">
    <p className="ov-tag">Today’s round</p>
    <div className="ov-none">
      <h2>No round booked.</h2>
      <p>When a round is scheduled it appears here with the stops in order, when to be at each
        one, and the script for every conversation.</p>
    </div>
  </section>;

  const total = plan.stops.length;
  const through = total ? Math.round((plan.completed / total) * 100) : 0;
  const done = plan.completed === total && total > 0;

  return <section className="ov-panel ov-round" aria-labelledby="ov-round-title">
    <div className="ov-panel-head">
      <p className="ov-tag">{round.date === today ? 'Today’s round' : 'Next round'}</p>
      <button className="ov-link" onClick={() => onGo('agenda')}>View agenda</button>
    </div>

    <h2 id="ov-round-title">{dayLabel(round.date)}</h2>
    <ul className="ov-facts">
      <li><Icon name="people" size={14}/>{round.staff || 'Unassigned'}</li>
      <li><Icon name="pin" size={14}/>{total} {total === 1 ? 'business' : 'businesses'}</li>
      <li><Icon name="clock" size={14}/>{clockOf(plan.startsAt)} – {clockOf(plan.endsAt)}</li>
      <li><Icon name="chart" size={14}/>{durationLabel(plan.totalMinutes)}</li>
    </ul>

    <div className="ov-progress">
      <span className="ov-bar"><i style={{ width: `${through}%` }}/></span>
      <span>{plan.completed} of {total} stops completed</span>
    </div>

    {/* The route itself, not a decorative graph: the actual stops, in the actual order. */}
    <ol className="ov-route" aria-label="The stops on this round">
      {plan.stops.map(stop => <li key={stop.business.id} className={stop.done ? 'is-done' : ''}>
        <span className="ov-route-node">{stop.done ? <Icon name="check" size={11}/> : stop.index + 1}</span>
        <span className="ov-route-name">{stop.business.name}</span>
        <span className="ov-route-time">{stop.located ? clockOf(stop.arriveAt) : '—'}</span>
      </li>)}
    </ol>

    <button className="ov-go" onClick={() => onGo('agenda')}>
      {done ? 'See the round' : plan.completed ? 'Continue round' : 'Start round'}
      <Icon name="arrow" size={16}/>
    </button>
  </section>;
}

/** Visits over time, from the records and only the records. */
function ActivityPanel({ series, period, onPeriod }: {
  series: Bucket[]; period: Period; onPeriod: (p: Period) => void;
}) {
  const most = Math.max(1, ...series.map(b => b.visits));
  const total = series.reduce((n, b) => n + b.visits, 0);

  return <section className="ov-panel ov-activity" aria-labelledby="ov-activity-title">
    <div className="ov-panel-head">
      <p className="ov-tag" id="ov-activity-title">Field activity</p>
      <div className="ov-period" role="group" aria-label="Period">
        {(['week', 'month'] as Period[]).map(p => <button key={p}
          className={period === p ? 'is-on' : ''} aria-pressed={period === p}
          onClick={() => onPeriod(p)}>{p === 'week' ? 'Weekly' : 'Monthly'}</button>)}
      </div>
    </div>

    {!series.length
      ? <div className="ov-none">
          <h2>Nothing recorded yet.</h2>
          <p>Visits appear here as your staff save them. Until the first one there is nothing
            to chart, and nothing is estimated in its place.</p>
        </div>
      : <>
          <p className="ov-activity-total">{total}<small>{total === 1 ? 'visit' : 'visits'} in all, across {series.length} {period === 'week' ? (series.length === 1 ? 'week' : 'weeks') : (series.length === 1 ? 'month' : 'months')}</small></p>

          <div className="ov-chart">
            {/* Three grid lines, labelled, so a bar can be read without hovering. */}
            <div className="ov-grid" aria-hidden="true">
              {[most, Math.round(most / 2), 0].map((v, i) => <span key={i}><i>{v}</i></span>)}
            </div>
            <ol className="ov-bars">
              {series.map(bucket => <li key={bucket.key}>
                <span className="ov-bar-col"
                  title={`${bucket.visits} ${bucket.visits === 1 ? 'visit' : 'visits'} · ${bucket.label}`}>
                  <i style={{ height: `${Math.max(2, (bucket.visits / most) * 100)}%` }}/>
                </span>
                <span className="ov-bar-label">{bucket.label}</span>
                <span className="sr-only">{bucket.visits} visits in the period beginning {bucket.label}</span>
              </li>)}
            </ol>
          </div>
        </>}
  </section>;
}

function Kpi({ label, value, icon, foot, bar, alert, onOpen }: {
  label: string; value: number; icon: IconName; foot: React.ReactNode;
  bar?: number; alert?: boolean; onOpen: () => void;
}) {
  return <button className={`ov-kpi ${alert ? 'is-alert' : ''}`} onClick={onOpen}>
    <span className="ov-kpi-top">
      <span className="ov-kpi-label">{label}</span>
      <span className="ov-kpi-icon" aria-hidden="true"><Icon name={icon} size={15}/></span>
    </span>
    <span className="ov-kpi-value">{value}</span>
    {bar !== undefined && <span className="ov-kpi-bar"><i style={{ width: `${Math.round(bar * 100)}%` }}/></span>}
    {foot}
  </button>;
}

/** A real difference against the period before, never a percentage of a small number. */
function Trend({ now, before }: { now: number; before: number }) {
  const change = now - before;
  if (change === 0) return <span className="ov-foot">Same as last month</span>;
  return <span className={`ov-foot ${change > 0 ? 'is-up' : 'is-down'}`}>
    <Icon name={change > 0 ? 'up' : 'down'} size={13}/>
    {Math.abs(change)} {change > 0 ? 'more' : 'fewer'} than last month
  </span>;
}

function Panel({ title, action, children }: {
  title: string; action?: { label: string; go: () => void }; children: React.ReactNode;
}) {
  return <section className="ov-panel">
    <div className="ov-panel-head">
      <p className="ov-tag">{title}</p>
      {action && <button className="ov-link" onClick={action.go}>{action.label}</button>}
    </div>
    {children}
  </section>;
}
