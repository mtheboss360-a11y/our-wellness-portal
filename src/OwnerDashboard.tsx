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
import { useCallback, useEffect, useMemo, useState } from 'react';
import { getRounds, getBusinesses, type Business, type Round, type Visit } from './lib/api';
import { planRound, clockOf, durationLabel, milesFrom } from './lib/round-math';
import { staffMonth } from './lib/staff-dashboard';
import { Icon, type IconName } from './Icons';
import ReferralBubbles from './ReferralBubbles';

type View = 'home' | 'network' | 'history' | 'performance' | 'businesses';
const RADII = [5, 10, 15] as const;
type Radius = (typeof RADII)[number];

const dayLabel = (iso: string) => new Date(`${iso}T12:00:00Z`)
  .toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });

export default function OwnerDashboard({ clinicName, today, ownerName, onGo }: {
  clinicName: string; today: string; ownerName?: string | null; onGo: (view: View) => void;
}) {
  const [data, setData] = useState<{ rounds: Round[]; visits: Visit[]; businesses: Business[]; clinic: { lat: number; lng: number } | null } | null>(null);
  const [error, setError] = useState('');
  const [radius, setRadius] = useState<Radius>(5);
  const [openRoute, setOpenRoute] = useState<string | null>(null);

  const load = useCallback(() => {
    setError('');
    return Promise.all([getRounds(), getBusinesses()])
      .then(([r, b]) => setData({ rounds: r.rounds, visits: r.visits, businesses: b.businesses, clinic: r.clinic }))
      .catch(e => setError(e instanceof Error ? e.message : 'We couldn’t open your dashboard.'));
  }, []);
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

    <section className="own-metrics" aria-label="Practice activity">
      <Metric label="Referral accounts" value={data.businesses.length} icon="people"
        note={data.businesses.length ? 'Curated for your practice' : 'None released yet'}/>
      <Metric label="Routes scheduled" value={scheduled.filter(r => r.date >= today).length} icon="route"
        note={scheduled.length ? `${scheduled.length} on record` : 'None scheduled'}/>
      <Metric label="Materials dropped" value={month.materials} icon="sparkle" tone="gold"
        note="This month, from recorded visits"/>
      <Metric label="Follow-ups due" value={month.followUpsDue} icon="clock" tone="blue"
        note={month.overdue ? `${month.overdue} overdue` : 'None overdue'}/>
    </section>

    <section className="own-panel own-network" aria-labelledby="own-net">
      <div className="own-panel-head">
        <div>
          <h2 id="own-net">Your referral network</h2>
          <p>Your practice at the centre · matched businesses around it</p>
        </div>
        <span className="own-kicker">Within {radius} miles</span>
      </div>
      <ReferralBubbles practice={clinicName}
        connections={connections.within.map(b => ({ id: b.id, name: b.name, demo: b.demo === 1 }))}/>
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
                </li>;
              })}
            </ul>}
      </section>
    </div>
  </div>;
}

function Metric({ label, value, icon, note, tone }: {
  label: string; value: number; icon: IconName; note: string; tone?: 'gold' | 'blue';
}) {
  return <article className="own-metric">
    <div className="own-metric-top">
      <span className="own-metric-label">{label}</span>
      <span className={`own-metric-icon ${tone ?? ''}`} aria-hidden="true"><Icon name={icon} size={14}/></span>
    </div>
    <p className="own-metric-value">{value}</p>
    <p className="own-metric-note">{note}</p>
  </article>;
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
