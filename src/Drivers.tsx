// DRIVERS & ROUTES. Who is driving the clinic's routes, where they stopped, what they handed out
// and what came back — read from the field log, which is the drivers' stop form and the staff
// sign-up form. Nothing on this screen is estimated: an empty log shows an empty screen.
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { getField } from './lib/api';
import type { Driver, FieldLog, FieldRoute, FieldStop } from '../data/field-data';
import { CATEGORY_LABEL, OUTCOME_LABEL, dayLabel, driverOf, minutesBetween, monthsSince, nextAndLast, partners, routesBy, signupsAt, tally, timeLabel, yourDrivers } from './lib/field-math';
import { number } from './lib/portal-math';
import RouteOrb from './RouteOrb';

export default function Drivers({ today, onClose }: { today: string; onClose: () => void }) {
  const [log, setLog] = useState<FieldLog | null | undefined>(undefined);
  const [error, setError] = useState('');
  useEffect(() => { getField().then(r => setLog(r.field)).catch(e => setError(e instanceof Error ? e.message : 'We couldn’t open your routes.')); }, []);
  if (error) return <Shell onClose={onClose}><div className="network-state" role="alert"><h2>We couldn’t open your routes.</h2><p>{error}</p></div></Shell>;
  if (log === undefined) return <Shell onClose={onClose}><div className="network-state"><p role="status">Opening your routes…</p></div></Shell>;
  if (!log || !log.routes.length) return <Shell onClose={onClose}><div className="network-state"><h2>Your first route hasn’t been driven yet.</h2>
    <p>When a driver finishes their first stop for you, you’ll see who drove, where they went and what they handed out — straight from their stop log.</p></div></Shell>;
  return <Shell onClose={onClose}><Field log={log} today={today}/></Shell>;
}

function Shell({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return <section className="network-page drivers-page" aria-labelledby="drivers-title">
    <div className="network-head">
      <div><p className="eyebrow">In your community</p><h1 id="drivers-title">Drivers &amp; routes</h1>
        <p className="network-subtitle">The people out on your route, and everything they logged at each stop.</p></div>
      <button className="network-back" onClick={onClose}>Back to your report</button>
    </div>
    {children}
  </section>;
}

function Field({ log, today }: { log: FieldLog; today: string }) {
  const all = tally(log);
  const { next, last } = nextAndLast(log, today);
  const ordered = useMemo(() => [...log.routes].sort((a, b) => b.date.localeCompare(a.date)), [log]);
  const [routeId, setRouteId] = useState((last ?? next ?? ordered[0]).id);
  const route = log.routes.find(r => r.id === routeId) ?? ordered[0];
  return <>
    <section className="field-stats" aria-label="Every route so far">
      <Stat value={all.stops} label="Stops visited" note={`${all.routes} routes driven`}/>
      <Stat value={all.staff} label="Staff reached" note="on shift when we arrived"/>
      <Stat value={all.cards} label="Referral cards handed out" note={`${all.boxes} boxes · ${all.coffees} coffees`}/>
      <Stat value={all.signups} label="Staff sign-ups" note="from the tap card and QR form" accent/>
      <Stat value={all.booked} label="Booked by your front desk" note={all.signups ? `${Math.round(all.booked / all.signups * 100)}% of sign-ups` : 'none yet'} accent/>
      <Stat value={all.joined} label="Partner visits that joined" note={`of ${all.stops} stops`}/>
    </section>

    {next && <NextRoute log={log} route={next} onShow={() => setRouteId(next.id)}/>}

    <RouteExplorer log={log} route={route} routes={ordered} onPick={setRouteId}/>

    <Roster log={log} today={today}/>

    <div className="field-columns">
      <Signups log={log}/>
      <Partners log={log}/>
    </div>
    <p className="network-data-note">Every number on this page is counted from two forms: the stop log each driver fills in before leaving a business, and the sign-up form behind each tap card and QR code. Bookings are the sign-ups your front desk marked as booked. Positions in the orb follow each stop’s real direction from your clinic; distances are drawn closer together so every stop fits.</p>
  </>;
}

function Stat({ value, label, note, accent = false }: { value: number; label: string; note: string; accent?: boolean }) {
  return <article className={`field-stat ${accent ? 'is-accent' : ''}`}><p className="field-stat-value">{number(value)}</p><h2>{label}</h2><p className="field-stat-note">{note}</p></article>;
}

function Avatar({ driver, size = 44 }: { driver: Driver | null; size?: number }) {
  if (!driver) return <span className="field-avatar is-empty" style={{ width: size, height: size }} aria-hidden="true"/>;
  return <img className="field-avatar" src={driver.photo} alt="" width={size} height={size} loading="lazy"/>;
}

function NextRoute({ log, route, onShow }: { log: FieldLog; route: FieldRoute; onShow: () => void }) {
  const driver = driverOf(log, route);
  return <section className="field-next" aria-labelledby="next-title">
    <img className="field-next-photo" src={driver?.photo} alt={driver ? `${driver.name}, your driver` : ''} width="640" height="640"/>
    <div className="field-next-body">
      <p className="eyebrow">Who’s driving your next route</p>
      <h2 id="next-title">{driver?.name ?? 'Driver to be confirmed'}</h2>
      <p className="field-next-when"><strong>{dayLabel(route.date)}</strong> · starts {timeLabel(route.start)} · {route.stops.length} stops</p>
      {driver && <p className="field-next-bio">{driver.bio}</p>}
      <ol className="field-next-stops">{route.stops.map((stop, i) => <li key={stop.id}><span>{i + 1}</span><strong>{stop.name}</strong><small>{CATEGORY_LABEL[stop.category]} · {stop.town}</small></li>)}</ol>
      <div className="field-next-actions"><button className="network-secondary" onClick={onShow}>See it on the orb</button>
        {driver && <span className="field-chip">{driver.vehicle} · {driver.languages.join(', ')}</span>}</div>
    </div>
  </section>;
}

function RouteExplorer({ log, route, routes, onPick }: { log: FieldLog; route: FieldRoute; routes: FieldRoute[]; onPick: (id: string) => void }) {
  const [hover, setHover] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  useEffect(() => { setPicked(null); setHover(null); }, [route.id]);
  const activeId = hover ?? picked;
  const stop = route.stops.find(s => s.id === activeId) ?? null;
  const driver = driverOf(log, route);
  const t = tally(log, [route]);
  return <section className="field-explorer" aria-labelledby="explorer-title">
    <div className="section-heading"><h2 id="explorer-title">Your route, stop by stop</h2>
      <p className="section-subtitle">Pick a route. Hover a stop on the orb, or choose it from the list, to see what happened there.</p></div>
    <div className="field-route-picker" role="tablist" aria-label="Routes">
      {routes.map(r => { const d = driverOf(log, r); return <button key={r.id} role="tab" aria-selected={r.id === route.id} className={`field-route-tab ${r.id === route.id ? 'is-current' : ''}`} onClick={() => onPick(r.id)}>
        <Avatar driver={d} size={28}/><span><strong>{dayLabel(r.date)}</strong><small>{d?.name.split(' ')[0] ?? 'TBC'} · {r.stops.length} stops{r.status === 'scheduled' ? ' · scheduled' : ''}</small></span></button>; })}
    </div>
    <div className="field-explorer-grid">
      <div className="field-orb-wrap">
        <RouteOrb clinic={log.clinic} stops={route.stops} activeId={activeId} onHover={setHover} onSelect={id => setPicked(picked === id ? null : id)}
          label={`${route.stops.length}-stop route on ${dayLabel(route.date)} around ${log.clinic.label}`}/>
        <div className="field-orb-legend"><span><i className="lg-clinic"/>Your clinic</span><span><i className="lg-joined"/>Joined</span><span><i className="lg-follow"/>Follow-up</span><span><i className="lg-pending"/>Scheduled</span></div>
      </div>
      <div className="field-side">
        {stop ? <StopCard log={log} stop={stop} index={route.stops.indexOf(stop)} route={route}/> : <>
          <div className="field-route-head"><Avatar driver={driver} size={52}/><div><h3>{dayLabel(route.date)} with {driver?.name ?? 'a driver to be confirmed'}</h3>
            <p>{route.status === 'done' ? `${t.stops} stops · ${t.staff} staff met · ${t.cards} cards · ${t.signups} sign-ups so far` : `Starts ${timeLabel(route.start)}. Stops are planned; nothing is logged until the driver arrives.`}</p></div></div>
          <ol className="field-stop-list">{route.stops.map((s, i) => { const n = signupsAt(log, s).length; return <li key={s.id}>
            <button onClick={() => setPicked(s.id)} onMouseEnter={() => setHover(s.id)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(s.id)} onBlur={() => setHover(null)}>
              <span className={`field-stop-num is-${s.outcome}`}>{i + 1}</span>
              <span className="field-stop-body"><strong>{s.name}</strong><small>{CATEGORY_LABEL[s.category]} · {s.town}{s.arrived ? ` · ${timeLabel(s.arrived)}` : ''}</small></span>
              <span className="field-stop-meta">{route.status === 'done' ? <>{n} <small>{n === 1 ? 'sign-up' : 'sign-ups'}</small></> : <small>planned</small>}</span>
            </button></li>; })}</ol></>}
      </div>
    </div>
  </section>;
}

function StopCard({ log, stop, index, route }: { log: FieldLog; stop: FieldStop; index: number; route: FieldRoute }) {
  const s = signupsAt(log, stop);
  const booked = s.filter(x => x.status === 'booked').length;
  const done = route.status === 'done';
  return <article className="field-stop-card" aria-live="polite">
    <p className="eyebrow">Stop {index + 1} of {route.stops.length}</p>
    <h3>{stop.name}</h3>
    <p className="field-stop-sub">{CATEGORY_LABEL[stop.category]} · {stop.town}</p>
    <span className={`field-outcome is-${stop.outcome}`}>{OUTCOME_LABEL[stop.outcome]}</span>
    {stop.photo && <img className="field-stop-photo" src={stop.photo} alt={`Delivery at ${stop.name}`} loading="lazy"/>}
    {done && <dl className="field-facts">
      <div><dt>On site</dt><dd>{timeLabel(stop.arrived)} – {timeLabel(stop.left)} <small>({minutesBetween(stop.arrived, stop.left)} min)</small></dd></div>
      <div><dt>Spoke with</dt><dd>{stop.spokeWith}</dd></div>
      <div><dt>Staff on shift</dt><dd>{stop.staffOnShift}</dd></div>
      <div><dt>Handed out</dt><dd>{stop.boxes} {stop.boxes === 1 ? 'box' : 'boxes'} · {stop.coffees} coffees · {stop.cards} cards</dd></div>
      <div><dt>Counter card</dt><dd>{stop.display ? 'Placed' : 'Not placed'}</dd></div>
      <div><dt>Came back</dt><dd><strong>{s.length}</strong> sign-ups · <strong>{booked}</strong> booked</dd></div>
    </dl>}
    {stop.note && <p className="field-note">“{stop.note}”</p>}
    <div className="field-xref">
      <h4>Why they send you clients</h4>
      <p>{stop.crossRef.theirClients}</p>
      <div className="field-xref-services">{stop.crossRef.yourServices.map(v => <span key={v}>{v}</span>)}</div>
      <div className="network-fit" aria-label={`Match ${stop.crossRef.score} out of 100`}><span className="network-fit-bar"><span style={{ width: `${stop.crossRef.score}%` }}/></span><strong>{stop.crossRef.score}<small>/100</small></strong></div>
    </div>
  </article>;
}

function Roster({ log, today }: { log: FieldLog; today: string }) {
  const { on, area } = yourDrivers(log);
  return <section className="field-roster" aria-labelledby="roster-title">
    <div className="section-heading"><h2 id="roster-title">Your drivers</h2><p className="section-subtitle">Everyone who has driven, or is booked to drive, a route for you.</p></div>
    <div className="field-driver-grid">{on.map(driver => {
      const mine = routesBy(log, driver), t = tally(log, mine), up = mine.filter(r => r.status === 'scheduled' && r.date >= today).sort((a, b) => a.date.localeCompare(b.date))[0];
      const months = monthsSince(driver.since, today);
      return <article key={driver.id} className="field-driver">
        <img src={driver.photo} alt={driver.name} width="640" height="640" loading="lazy"/>
        <div className="field-driver-body">
          <h3>{driver.name}</h3>
          <p className="field-driver-meta">{driver.homeBase} · with the network {months < 1 ? 'this month' : `${months} ${months === 1 ? 'month' : 'months'}`}</p>
          <p className="field-driver-bio">{driver.bio}</p>
          <dl className="field-driver-stats"><div><dt>Routes</dt><dd>{t.routes}</dd></div><div><dt>Stops</dt><dd>{t.stops}</dd></div><div><dt>Staff met</dt><dd>{t.staff}</dd></div><div><dt>Sign-ups</dt><dd>{t.signups}</dd></div></dl>
          <p className="field-driver-next" style={{ '--tone': up ? '#1F6A52' : '#6B7B70' } as CSSProperties}>{up ? `Next on your route ${dayLabel(up.date)}` : `Last drove for you ${dayLabel(mine.filter(r => r.status === 'done').at(-1)?.date ?? mine[0].date)}`}</p>
        </div>
      </article>;
    })}</div>
    {area.length > 0 && <div className="field-area"><h3>Also covering your area</h3><ul>{area.map(d => <li key={d.id}><img src={d.photo} alt="" width="40" height="40" loading="lazy"/><span><strong>{d.name}</strong><small>{d.homeBase} · {d.languages.join(', ')}</small></span></li>)}</ul></div>}
  </section>;
}

function Signups({ log }: { log: FieldLog }) {
  const rows = [...log.signups].sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id)).slice(0, 8);
  const where = new Map(log.routes.flatMap(r => r.stops.map(s => [s.id, s.name] as const)));
  return <section className="report-panel field-signups" aria-labelledby="signups-title"><h2 id="signups-title">Latest staff sign-ups</h2><p className="section-subtitle">Who tapped a card, and where your front desk is with them.</p>
    {!rows.length ? <p className="empty-state">No one has signed up yet.</p> : <ul>{rows.map(s => <li key={s.id}><span><strong>{s.firstName}</strong><small>{where.get(s.stopId)} · {s.service}</small></span><span className={`field-pill is-${s.status}`}>{s.status === 'booked' ? 'Booked' : s.status === 'called' ? 'Called' : 'New'}</span></li>)}</ul>}
  </section>;
}

function Partners({ log }: { log: FieldLog }) {
  const rows = partners(log);
  return <section className="report-panel field-partners" aria-labelledby="partners-title"><h2 id="partners-title">Businesses sending you clients</h2><p className="section-subtitle">Ranked by staff sign-ups.</p>
    {!rows.length ? <p className="empty-state">No visits logged yet.</p> : <ol>{rows.slice(0, 8).map(p => <li key={p.stop.businessId}><span><strong>{p.stop.name}</strong><small>{CATEGORY_LABEL[p.stop.category]} · {p.stop.town} · {p.visits} {p.visits === 1 ? 'visit' : 'visits'}</small></span><span className="field-partner-n"><strong>{p.signups}</strong><small>{p.booked} booked</small></span></li>)}</ol>}
  </section>;
}
