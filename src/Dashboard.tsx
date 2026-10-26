// THE FIRST SCREEN. It answers, in order: what should my team do next, who is worth
// approaching, what is booked, who is taking part, and what has actually been recorded.
//
// Every figure comes from rows the portal already holds. When a clinic has no field log, or
// Google Places is not configured, the tile says so plainly instead of showing a zero — a zero
// reads as "nothing happened", and "nothing recorded" is a different statement.
import { useEffect, useState } from 'react';
import { getField, getNetworkMap } from './lib/api';
import type { FieldLog } from '../data/field-data';
import type { NetworkMapPayload } from './lib/network-math';
import { mapsPlaceUrl } from './lib/network-math';
import { dayLabel, driverOf, timeLabel, CATEGORY_LABEL } from './lib/field-math';
import {
  followUps, monthLabel, nextAction, opportunities, participating, recentActivity,
  STATUS_TONE, thisMonth, type NextAction,
} from './lib/dashboard-math';

type View = 'report' | 'drivers' | 'network' | 'bakeries';
type Props = { clinicName: string; today: string; plan: 'a' | 'b'; onGo: (view: View) => void };

function Tile({ title, note, children, action }: { title: string; note?: string; children: React.ReactNode; action?: React.ReactNode }) {
  return <section className="dash-tile">
    <div className="dash-tile-head"><h3>{title}</h3>{action}</div>
    {note && <p className="dash-tile-note">{note}</p>}
    {children}
  </section>;
}

const Pill = ({ tone, children }: { tone: string; children: React.ReactNode }) =>
  <span className={`dash-pill dash-pill-${tone}`}>{children}</span>;

/** A figure with its own word. Never a bare number: the label is what stops it being misread. */
function Figure({ value, label, note, unknown }: { value: number; label: string; note?: string; unknown?: boolean }) {
  return <div className="dash-figure">
    <dt>{label}</dt>
    <dd>{unknown ? <span className="dash-unrecorded">Not recorded</span> : value}</dd>
    {note && !unknown && <p>{note}</p>}
  </div>;
}

export default function Dashboard({ clinicName, today, plan, onGo }: Props) {
  const [log, setLog] = useState<FieldLog | null>(null);
  const [map, setMap] = useState<NetworkMapPayload | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    let live = true;
    // Both are optional: a clinic can have a field log and no map, or a map and no log. One
    // failing must not blank the other, so each settles on its own.
    void Promise.allSettled([getField(), getNetworkMap()]).then(([field, network]) => {
      if (!live) return;
      if (field.status === 'fulfilled') setLog(field.value.field);
      if (network.status === 'fulfilled') setMap(network.value);
      setState(field.status === 'rejected' && network.status === 'rejected' ? 'error' : 'ready');
    });
    return () => { live = false; };
  }, []);

  const month = thisMonth(log, today);
  const due = followUps(log);
  const partners = participating(log);
  const picks = opportunities(map);
  const activity = recentActivity(log);
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

  return <div className="dash">
    <header className="dash-head">
      <div>
        <p className="dash-eyebrow">{monthLabel(today)}</p>
        <h2>{clinicName}</h2>
      </div>
      <nav className="dash-jump" aria-label="Go to">
        <button className="dash-btn" onClick={() => onGo('network')}>Referral network</button>
        <button className="dash-btn" onClick={() => onGo('drivers')}>Routes &amp; schedule</button>
        <button className="dash-btn" onClick={() => onGo('report')}>Campaign report</button>
      </nav>
    </header>

    <NextUp action={action} log={log} plan={plan} onGo={onGo}/>

    <dl className="dash-figures" aria-label={`This month: ${monthLabel(today)}`}>
      <Figure value={picks.length} label="New opportunities" note={placesOff ? undefined : 'Worth approaching'} unknown={placesOff}/>
      <Figure value={month.visits} label="Visits recorded" note="Completed stops" unknown={!month.hasLog}/>
      <Figure value={month.followUpsDue} label="Follow-ups due" note="Asked for another call" unknown={!month.hasLog}/>
      <Figure value={month.signups} label="Tap sign-ups" note={month.booked ? `${month.booked} booked by your desk` : 'Responses, not appointments'} unknown={!month.hasLog}/>
    </dl>

    <div className="dash-grid">
      <Tile
        title="Worth approaching"
        note="Recommended by the portal. None of these has agreed to anything yet."
        action={<button className="dash-link" onClick={() => onGo('network')}>Open the map</button>}>
        {placesOff
          ? <p className="dash-empty">Google Places isn’t configured on this server, so nothing nearby has been looked up. Nothing is invented here.</p>
          : !map?.clinic.location
            ? <p className="dash-empty">Your practice address hasn’t been set yet, so there’s nowhere to search from. We’ll add it for you.</p>
            : !picks.length
              ? <p className="dash-empty">No new businesses met the bar this month. A short list beats a padded one.</p>
              : <ul className="dash-list">{picks.map(business => <li key={business.placeId}>
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
                </li>)}</ul>}
      </Tile>

      <Tile
        title="Participating"
        note="Businesses a staff member recorded as having agreed to take part."
        action={partners.length ? <button className="dash-link" onClick={() => onGo('drivers')}>See all</button> : undefined}>
        {!month.hasLog
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

      <Tile
        title="Follow-ups due"
        note="Visits that ended with a reason to come back."
        action={due.length ? <button className="dash-link" onClick={() => onGo('drivers')}>Plan a round</button> : undefined}>
        {!month.hasLog
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
        title="Recent activity"
        note="Visits your staff recorded, and taps on partner cards. Kept apart."
        action={activity.length ? <button className="dash-link" onClick={() => onGo('drivers')}>Full log</button> : undefined}>
        {!activity.length
          ? <p className="dash-empty">Nothing recorded yet. Visits and tap sign-ups will appear here as they happen.</p>
          : <ol className="dash-feed">{activity.map(item => <li key={item.id}>
              <span className={`dash-dot dash-dot-${item.kind}`} aria-hidden="true"/>
              <div className="dash-row-main">
                <strong>{item.title}</strong>
                <span>{item.detail}</span>
              </div>
              <div className="dash-row-end">
                {item.kind === 'signup'
                  ? <Pill tone="info">Tap sign-up</Pill>
                  : item.outcome && <Pill tone={STATUS_TONE[item.outcome].tone}>{STATUS_TONE[item.outcome].label}</Pill>}
                <time dateTime={item.on}>{dayLabel(item.on)}</time>
              </div>
            </li>)}</ol>}
      </Tile>
    </div>
  </div>;
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
      // On the portal-only plan the practice's own staff go, so naming one of our drivers
      // on their round would be telling them someone is coming who is not.
      const driver = plan === 'a' && route && log ? driverOf(log, route) : null;
      return {
        title: `A round is booked for ${dayLabel(route!.date)}.`,
        note: `${route!.stops.length} ${route!.stops.length === 1 ? 'stop' : 'stops'}${driver ? ` · ${driver.name}` : ''}${route!.start ? ` · from ${timeLabel(route!.start)}` : ''}`,
        cta: 'See the round', go: 'drivers' as View,
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
      title: `${action.kind === 'choose' ? action.count : 0} businesses are worth approaching.`,
      note: 'Pick your stops and we’ll build the round.',
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
