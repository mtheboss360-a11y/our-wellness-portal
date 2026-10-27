// THE FIRST SCREEN. It answers, in order: what should my team do next, who is worth
// approaching, what is booked, who is taking part, and what has actually been recorded.
//
// Every figure comes from rows the portal already holds. When a clinic has no field log, or
// Google Places is not configured, the tile says so plainly instead of showing a zero — a zero
// reads as "nothing happened", and "nothing recorded" is a different statement.
import { useEffect, useState } from 'react';
import { getField, getNetworkMap, getRounds, getBusinesses, type Business, type Visit } from './lib/api';
import type { FieldLog } from '../data/field-data';
import type { NetworkMapPayload } from './lib/network-math';
import { mapsPlaceUrl } from './lib/network-math';
import { dayLabel, driverOf, timeLabel, CATEGORY_LABEL } from './lib/field-math';
import { Icon, type IconName } from './Icons';
import { agenda, clockOf, durationLabel } from './lib/agenda-math';
import { planRound as layOutRound, type Round } from './lib/round-math';
import { nextRound, staffMonth, owedACall, notYetVisited } from './lib/staff-dashboard';
import {
  followUps, monthLabel, nextAction, opportunities, participating, thisMonth, type NextAction,
} from './lib/dashboard-math';

type View = 'home' | 'agenda' | 'businesses' | 'history' | 'performance' | 'report' | 'drivers' | 'notes' | 'network' | 'bakeries';
type Props = { clinicName: string; today: string; plan: 'a' | 'b'; userName?: string | null; onGo: (view: View) => void };

function Tile({ title, note, children, action }: { title: string; note?: string; children: React.ReactNode; action?: React.ReactNode }) {
  return <section className="dash-tile">
    <div className="dash-tile-head"><h3>{title}</h3>{action}</div>
    {note && <p className="dash-tile-note">{note}</p>}
    {children}
  </section>;
}

const Pill = ({ tone, children }: { tone: string; children: React.ReactNode }) =>
  <span className={`dash-pill dash-pill-${tone}`}>{children}</span>;

/**
 * A figure with its own word. Never a bare number: the label is what stops it being misread.
 *
 * Where there are records behind it, the whole tile is the way to them — a count you cannot
 * open is a claim you cannot check.
 */
function Figure({ value, label, note, unknown, go, goLabel, icon, lead }: {
  value: number; label: string; note?: string; unknown?: boolean;
  go?: () => void; goLabel?: string; icon?: IconName; lead?: boolean;
}) {
  const body = <>
    {icon && <span className="dash-figure-icon" aria-hidden="true"><Icon name={icon} size={19}/></span>}
    <dt>{label}</dt>
    <dd>{unknown ? <span className="dash-unrecorded">Not recorded</span> : value}</dd>
    {note && !unknown && <p>{note}</p>}
  </>;
  const klass = `dash-figure ${lead ? 'is-lead' : ''}`;
  if (unknown || !go) return <div className={klass}>{body}</div>;
  return <div className={klass}>
    <button type="button" className="dash-figure-go" onClick={go}>
      {body}
      <span className="dash-figure-cue" aria-hidden="true">{goLabel ?? 'Open'} →</span>
      <span className="sr-only">{goLabel ?? 'Open the records behind this'}</span>
    </button>
  </div>;
}

export default function Dashboard({ clinicName, today, plan, userName, onGo }: Props) {
  const [log, setLog] = useState<FieldLog | null>(null);
  const [map, setMap] = useState<NetworkMapPayload | null>(null);
  // The released businesses, the rounds booked from them and the visits recorded against them.
  // Where a practice has these, they are what the dashboard counts — the same records the
  // agenda, the history and the performance pages read.
  const [work, setWork] = useState<{ rounds: Round[]; visits: Visit[]; businesses: Business[]; clinic: { lat: number; lng: number } | null } | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    let live = true;
    // Both are optional: a clinic can have a field log and no map, or a map and no log. One
    // failing must not blank the other, so each settles on its own.
    // THE OUTREACH DATA FIRST, and the older sources only if there is no outreach data to
    // show. The dashboard was asking for five endpoints every time it opened, two of which it
    // then ignored — and one of those, /api/network/map, runs the discovery refresh. Opening
    // the first screen of the portal should not be able to spend a Google call.
    void Promise.allSettled([getRounds(), getBusinesses()]).then(async ([rounds, businesses]) => {
      if (!live) return;
      const released = businesses.status === 'fulfilled' ? businesses.value.businesses : [];
      if (rounds.status === 'fulfilled' && businesses.status === 'fulfilled') {
        setWork({ rounds: rounds.value.rounds, visits: rounds.value.visits,
          businesses: released, clinic: rounds.value.clinic });
      }

      if (released.length) { setState('ready'); return; }

      // No businesses released: this clinic is still on the imported field log and the map.
      const [field, network] = await Promise.allSettled([getField(), getNetworkMap()]);
      if (!live) return;
      if (field.status === 'fulfilled') setLog(field.value.field);
      if (network.status === 'fulfilled') setMap(network.value);
      setState(field.status === 'rejected' && network.status === 'rejected'
        && rounds.status === 'rejected' ? 'error' : 'ready');
    });
    return () => { live = false; };
  }, []);

  const onOutreach = (work?.businesses.length ?? 0) > 0;
  const staff6 = work ? staffMonth(work.visits, work.businesses, today) : null;
  const booked = work ? nextRound(work.rounds, today) : null;
  const month = thisMonth(log, today);
  const due = followUps(log);
  const partners = participating(log);
  const picks = opportunities(map);
  const action = nextAction(log, map, today);
  const placesOff = map ? !map.data.placesConfigured : false;

  if (state === 'loading') return <div className="dash" aria-busy="true">
    <div className="dash-head"><div className="dash-skel dash-skel-title"/><div className="dash-skel dash-skel-line"/></div>
    <div className="dash-grid">{[0, 1, 2, 3].map(n => <div className="dash-tile dash-tile-skel" key={n}><div className="dash-skel dash-skel-line"/><div className="dash-skel dash-skel-big"/></div>)}</div>
    <p className="sr-only">Loading your dashboard.</p>
  </div>;

  if (state === 'error') return <div className="dash">
    <div className="dash-empty-page" role="alert">
      <h2>We couldn’t load your dashboard.</h2>
      <p>Your records are safe. Reload the page, and call us on (331) 271-6851 if it keeps happening.</p>
      <button className="dash-btn" onClick={() => location.reload()}>Reload</button>
    </div>
  </div>;

  // Who the practice sends out, taken from their own log. No log, no name: the header greets
  // the practice instead of inventing a person.
  // The person signed in, when the account is a person's. Otherwise whoever the log says goes
  // out, and failing that nobody: the header greets the practice rather than inventing a name.
  const staff = userName ?? log?.drivers[0]?.name ?? null;
  const todayLabel = new Date(`${today}T12:00:00Z`)
    .toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

  // The greeting reads the clock. A rep opening this at seven in the morning and a rep opening
  // it after lunch are in different parts of their day, and the screen can say so for free.
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  return <div className={`dash ${plan === 'b' ? 'dash-lean' : ''}`}>
    <header className="dash-welcome">
      <div>
        <p className="dash-welcome-eyebrow">{greeting},</p>
        <h1>{staff ?? clinicName}</h1>
        {staff && <p className="dash-welcome-sub">{clinicName}</p>}
      </div>
      <div className="dash-welcome-actions">
        <span className="dash-datepill"><Icon name="calendar" size={15}/>{todayLabel}</span>
      </div>
    </header>
    <div className="dash-hero">
    {plan === 'a' && <header className="dash-head">
      <div>
        <p className="dash-eyebrow">{monthLabel(today)}</p>
        <h2>{clinicName}</h2>
      </div>
      <nav className="dash-jump" aria-label="Go to">
        <button className="dash-btn" onClick={() => onGo('network')}>Referral network</button>
        <button className="dash-btn" onClick={() => onGo('drivers')}>Routes &amp; schedule</button>
        <button className="dash-btn" onClick={() => onGo('report')}>Campaign report</button>
      </nav>
    </header>}

    {onOutreach && booked
      ? <BookedRound round={booked} visits={work!.visits} clinic={work!.clinic} today={today} onGo={onGo}/>
      : <NextUp action={action} log={log} plan={plan} onGo={onGo}/>}
    </div>

    {onOutreach && staff6
      ? <dl className="dash-figures" aria-label={`This month: ${monthLabel(today)}`}>
          <Figure value={staff6.notContacted} label="Not contacted" note={`of ${staff6.assigned} assigned`} icon="clinic" lead
            go={() => onGo('businesses')} goLabel="See them"/>
          <Figure value={staff6.visits} label="Visits recorded" note="This month" icon="check"
            go={() => onGo('history')} goLabel="See the history"/>
          <Figure value={staff6.followUpsDue} label="Follow-ups due" note="Nobody has been back" icon="calendar"
            go={() => onGo('history')} goLabel="See who is owed a call"/>
          <Figure value={staff6.materials} label="Materials dropped" note="This month" icon="sparkle"
            go={() => onGo('performance')} goLabel="See performance"/>
        </dl>
      : <dl className="dash-figures" aria-label={`This month: ${monthLabel(today)}`}>
          <Figure value={picks.length} label="New businesses" note={picks.length ? 'Worth approaching' : undefined} icon="clinic" lead
            unknown={!picks.length && placesOff} go={() => onGo('network')} goLabel="See them on the map"/>
          <Figure value={month.visits} label="Visits recorded" note="Completed stops" icon="check"
            unknown={!month.hasLog} go={() => onGo('drivers')} goLabel="See the rounds"/>
          <Figure value={month.followUpsDue} label="Follow-ups due" note="Asked for another call" icon="calendar"
            unknown={!month.hasLog} go={() => onGo(plan === 'b' ? 'notes' : 'drivers')} goLabel="See who is owed a call"/>
          <Figure value={month.signups} label="Tap sign-ups" note={month.booked ? `${month.booked} booked by your desk` : 'Responses, not appointments'} icon="sparkle"
            unknown={!month.hasLog} go={() => onGo('report')} goLabel="See the report"/>
        </dl>}

    <div className="dash-grid">
      {onOutreach && booked && <Tile
        title="Next stops"
        note="The order Alexis is going in."
        action={<button className="dash-link" onClick={() => onGo('agenda')}>View all</button>}>
        <NextStops round={booked} visits={work!.visits} clinic={work!.clinic} today={today} onGo={onGo}/>
      </Tile>}

      {!(onOutreach && booked) && <Tile
        title={onOutreach ? 'Not contacted yet' : 'New businesses'}
        note={onOutreach
          ? 'Assigned to you, and nobody has been yet.'
          : 'Recommended by the portal. None of these has agreed to anything yet.'}
        action={<button className="dash-link" onClick={() => onGo(onOutreach ? 'businesses' : 'network')}>
          {onOutreach ? 'See them all' : 'Open the map'}</button>}>
        {/* What the tile has comes first. A demo account is served a fixed fictional map, so it
            has businesses to show even where Google Places is not configured; asking about the
            key before looking at the list told it there was nothing when there was. */}
        {onOutreach
          ? (notYetVisited(work!.businesses).length
              ? <ul className="dash-list">{notYetVisited(work!.businesses).map(business => <li key={business.id}>
                  <div className="dash-row">
                    <div className="dash-row-main">
                      <strong>{business.name}</strong>
                      <span>{business.category} · {business.address}</span>
                    </div>
                    <Pill tone="neutral">Not contacted</Pill>
                  </div>
                </li>)}</ul>
              : <p className="dash-empty">Every business assigned to you has been visited at least once.</p>)
          : picks.length
          ? <ul className="dash-list">{picks.map(business => <li key={business.placeId}>
                  <div className="dash-row">
                    <div className="dash-row-main">
                      <strong>{business.name ?? 'Unnamed business'}</strong>
                      <span>{business.category?.label ?? 'Local business'} · {business.distanceMiles.toFixed(1)} mi</span>
                    </div>
                    <div className="dash-row-end">
                      <Pill tone="neutral">Recommended</Pill>
                      <a className="dash-link" href={mapsPlaceUrl(business)} target="_blank" rel="noreferrer noopener">Map</a>
                    </div>
                  </div>
                </li>)}</ul>
          : !map?.clinic.location
            ? <p className="dash-empty">Your practice address hasn’t been set yet, so there’s nowhere to search from. We’ll add it for you.</p>
            : placesOff
              ? <p className="dash-empty">Google Places isn’t configured on this server, so nothing nearby has been looked up. Nothing is invented here.</p>
              : <p className="dash-empty">No new businesses met the bar this month. A short list beats a padded one.</p>}
      </Tile>}


      <Tile
        title="Follow-ups due"
        note="Visits that ended with a reason to come back."
        action={<button className="dash-link" onClick={() => onGo(onOutreach ? 'history' : 'drivers')}>
          {onOutreach ? 'See the history' : 'Plan a round'}</button>}>
        {onOutreach
          ? (owedACall(work!.visits, today).length
              ? <ul className="dash-list">{owedACall(work!.visits, today).map(visit => <li key={visit.id}>
                  <div className="dash-row">
                    <div className="dash-row-main">
                      <strong>{visit.businessName}</strong>
                      <span>Due {dayLabel(visit.followUpOn!)}{visit.spokeWith ? ` · ask for ${visit.spokeWith}` : ''}</span>
                    </div>
                    <Pill tone="warn">Follow-up due</Pill>
                  </div>
                </li>)}</ul>
              : <p className="dash-empty">Nothing is owed a second call right now.</p>)
          : !month.hasLog
          ? <p className="dash-empty">No field log yet.</p>
          : !due.length
            ? <p className="dash-empty">Nothing owed a second call right now.</p>
            : <ul className="dash-list">{due.slice(0, 5).map(({ stop, route }) => <li key={stop.id}>
                <div className="dash-row">
                  <div className="dash-row-main">
                    <strong>{stop.name}</strong>
                    <span>Last visited {dayLabel(route.date)}{stop.spokeWith ? ` · ${stop.spokeWith}` : ''}</span>
                  </div>
                  <Pill tone="warn">Follow-up due</Pill>
                </div>
              </li>)}</ul>}
      </Tile>

      <Tile
        title="Participating"
        note="Businesses a staff member recorded as having agreed to take part."
        action={<button className="dash-link" onClick={() => onGo(onOutreach ? 'businesses' : 'drivers')}>See all</button>}>
        {onOutreach
          ? (work!.businesses.filter(b => b.stage === 'partner').length
              ? <ul className="dash-list">{work!.businesses.filter(b => b.stage === 'partner').slice(0, 6).map(business => <li key={business.id}>
                  <div className="dash-row">
                    <div className="dash-row-main">
                      <strong>{business.name}{business.demo === 1 && <span className="sample-tag">Sample</span>}</strong>
                      <span>{business.category}</span>
                    </div>
                    <Pill tone="good">Partner</Pill>
                  </div>
                </li>)}</ul>
              : <p className="dash-empty">Nobody has agreed to take part yet. A business appears here when a visit records that it said yes.</p>)
          : !month.hasLog
          ? <p className="dash-empty">No field log yet. Visits appear here once your team starts recording them.</p>
          : !partners.length
            ? <p className="dash-empty">Nobody has agreed yet. A business only appears here when your staff records that it said yes.</p>
            : <ul className="dash-list">{partners.slice(0, 6).map(stop => <li key={stop.businessId}>
                <div className="dash-row">
                  <div className="dash-row-main">
                    <strong>{stop.name}</strong>
                    <span>{CATEGORY_LABEL[stop.category]} · {stop.town}</span>
                  </div>
                  <Pill tone="good">Participating</Pill>
                </div>
              </li>)}</ul>}
      </Tile>
    </div>
  </div>;
}

/** The next three stops, in order, each one a way straight into the visit. */
function NextStops({ round, visits, clinic, today, onGo }: {
  round: Round; visits: Visit[]; clinic: { lat: number; lng: number } | null;
  today: string; onGo: (view: View) => void;
}) {
  const plan = layOutRound(clinic, round, visits, { today });
  const next = plan.stops.filter(stop => !stop.done).slice(0, 3);
  if (!next.length) return <p className="dash-empty">Every stop on this round has been recorded.</p>;

  return <ol className="dash-stops">
    {next.map(stop => <li key={stop.business.id}>
      <span className="dash-stop-n">{stop.index + 1}</span>
      <span className="dash-stop-body">
        <strong>{stop.business.name}</strong>
        <span>{stop.business.category}
          {stop.located ? ` · ${clockOf(stop.arriveAt)}` : ''}</span>
      </span>
      <button className="dash-btn" onClick={() => onGo('agenda')}>Start visit</button>
    </li>)}
  </ol>;
}

/**
 * The round that is actually booked. Laid out by the same function the agenda uses, so the
 * two screens cannot report different days, different stop counts or different durations.
 */
function BookedRound({ round, visits, clinic, today, onGo }: {
  round: Round; visits: Visit[]; clinic: { lat: number; lng: number } | null;
  today: string; onGo: (view: View) => void;
}) {
  const plan = layOutRound(clinic, round, visits, { today });
  const total = plan.stops.length;
  const done = plan.completed === total && total > 0;
  const through = total ? Math.round((plan.completed / total) * 100) : 0;

  return <section className="dash-next" aria-labelledby="next-title">
    <div className="dash-next-body">
      <p className="dash-next-tag">{round.date === today ? 'Today’s round' : 'Next round'}</p>
      <h3 id="next-title">{dayLabel(round.date)}</h3>

      <ul className="dash-next-facts">
        <li><Icon name="pin" size={15}/>{total} {total === 1 ? 'stop' : 'stops'}</li>
        <li><Icon name="clock" size={15}/>{durationLabel(plan.totalMinutes)}</li>
        <li><Icon name="calendar" size={15}/>{clockOf(plan.startsAt)} – {clockOf(plan.endsAt)}</li>
      </ul>

      <div className="dash-next-progress">
        <span className="dash-next-bar"><i style={{ width: `${through}%` }}/></span>
        <span>{plan.completed} of {total} completed</span>
      </div>
    </div>

    <div className="dash-next-actions">
      <button className="dash-next-go" onClick={() => onGo('agenda')}>
        {done ? 'See the round' : plan.completed ? 'Continue round' : 'Start round'}
        <Icon name="arrow" size={17}/>
      </button>
    </div>
  </section>;
}

/** The one panel that tells a client what to do, pointing at a screen that exists. */
function NextUp({ action, log, plan, onGo }: { action: NextAction; log: FieldLog | null; plan: 'a' | 'b'; onGo: (view: View) => void }) {
  if (action.kind === 'none') return <section className="dash-next dash-next-quiet">
    <div><p className="dash-eyebrow">Next</p><h3>Nothing is waiting on you.</h3>
      <p className="dash-next-note">When a round is booked or a business is recommended, it shows up here.</p></div>
  </section>;

  const content = {
    route: () => {
      const route = action.kind === 'route' ? action.route : null;
      // The name on a round is whoever the log says went. On the full service that is one of
      // our drivers; on the portal-only plan it is the practice's own staff member. Either way
      // it comes from their log, so it is never us claiming to send somebody.
      const driver = route && log ? driverOf(log, route) : null;
      // How long the round should take, from the same arithmetic the agenda uses, so the two
      // screens never disagree. Estimated, and the agenda is where that is explained.
      const plan = route && log ? agenda(log, route) : null;
      return {
        title: `A round is booked for ${dayLabel(route!.date)}.`,
        note: [
          `${route!.stops.length} ${route!.stops.length === 1 ? 'stop' : 'stops'}`,
          driver?.name,
          route!.start ? `from ${timeLabel(route!.start)}` : null,
          plan ? `about ${durationLabel(plan.totalMinutes)}` : null,
        ].filter(Boolean).join(' · '),
        cta: 'Open the agenda', go: 'agenda' as View,
      };
    },
    request: () => ({
      title: 'Your route request is with us.',
      note: action.kind === 'request' ? `${action.request.stops.length} stops · ${action.request.statusLabel}` : '',
      cta: 'See the request', go: 'network' as View,
    }),
    'follow-up': () => ({
      title: `${action.kind === 'follow-up' ? action.count : 0} ${action.kind === 'follow-up' && action.count === 1 ? 'business is' : 'businesses are'} owed a second call.`,
      note: 'They asked your team to come back.',
      cta: 'Plan a round', go: 'drivers' as View,
    }),
    choose: () => ({
      title: 'Pick the stops for your next round.',
      note: 'The map ranks the businesses nearby that share your patients.',
      cta: 'Choose stops', go: 'network' as View,
    }),
    locate: () => ({
      title: 'We need your practice address.',
      note: 'The map searches outward from it. Call us and we’ll set it.',
      cta: 'Open the map', go: 'network' as View,
    }),
  }[action.kind]();

  return <section className="dash-next" aria-labelledby="next-title">
    <div>
      <p className="dash-eyebrow">Next</p>
      <h3 id="next-title">{content.title}</h3>
      {content.note && <p className="dash-next-note">{content.note}</p>}
    </div>
    <button className="dash-btn dash-btn-solid" onClick={() => onGo(content.go)}>{content.cta}</button>
  </section>;
}
