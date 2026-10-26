// TODAY'S ROUND — the agenda for one booked round, built for someone standing outside a gym.
//
// The times on a round that has not happened are this screen's arithmetic, not a commitment
// anybody made, and it says so plainly. The assumptions behind them are on the screen and can
// be changed; a number that cannot be checked or corrected is worse than no number.
import { useEffect, useMemo, useState } from 'react';
import type { FieldLog, FieldRoute } from '../data/field-data';
import { CATEGORY_LABEL, OUTCOME_LABEL, dayLabel, driverOf, signupsAt } from './lib/field-math';
import {
  agenda, clockOf, durationLabel, typicalVisit, DEFAULTS, type Assumptions, type AgendaStop,
} from './lib/agenda-math';
import { Icon } from './Icons';

const directionsTo = (s: { lat: number; lng: number }) =>
  `https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lng}&travelmode=driving`;

const STATUS = {
  completed: { label: 'Completed', tone: 'good' },
  'in-progress': { label: 'In progress', tone: 'warn' },
  upcoming: { label: 'Upcoming', tone: 'neutral' },
} as const;

export default function Agenda({ log, today, routeId, onPickRoute, onOpenStop }: {
  log: FieldLog;
  today: string;
  routeId?: string;
  onPickRoute?: (id: string) => void;
  onOpenStop?: (routeId: string, stopId: string) => void;
}) {
  const rounds = useMemo(
    () => [...log.routes].sort((a, b) => (a.status === b.status ? a.date.localeCompare(b.date) : a.status === 'scheduled' ? -1 : 1)),
    [log],
  );
  const next = rounds.find(r => r.status === 'scheduled' && r.date >= today) ?? rounds[0];
  const [chosen, setChosen] = useState<string>(routeId ?? next?.id ?? '');
  useEffect(() => { if (routeId) setChosen(routeId); }, [routeId]);

  // Start from what their own visits actually take. Seeding this with the library default
  // overrode the measured median and made the stops disagree with the line explaining them.
  const measured = useMemo(() => typicalVisit(log), [log]);
  const [as, setAs] = useState<Assumptions>({ ...DEFAULTS, visitMinutes: measured.minutes });
  const [tuning, setTuning] = useState(false);

  const route: FieldRoute | undefined = log.routes.find(r => r.id === chosen) ?? next;
  if (!route) return <div className="network-state">
    <h2>No round booked.</h2>
    <p>When a round is scheduled it appears here with the stops in order and the times to expect.</p>
  </div>;

  const nowMinutes = new Date().getHours() * 60 + new Date().getMinutes();
  const plan = agenda(log, route, { assumptions: as, today, nowMinutes });
  const driver = driverOf(log, route);

  return <section className="agenda" aria-labelledby="agenda-title">
    <div className="agenda-head">
      <div>
        <p className="dash-eyebrow">{route.status === 'scheduled' ? 'Next round' : 'Round'}</p>
        <h2 id="agenda-title">{dayLabel(route.date)}</h2>
        <p className="agenda-sub">
          {driver ? `${driver.name} · ` : ''}{route.stops.length} {route.stops.length === 1 ? 'stop' : 'stops'}
          {' · '}from {clockOf(plan.startsAt)}
        </p>
      </div>
      <a className="dash-primary" href={directionsTo(route.stops[0] ?? log.clinic)} target="_blank" rel="noreferrer noopener">
        <Icon name="route" size={16}/>Start the drive
      </a>
    </div>

    <dl className="agenda-totals">
      <div><dt>Expected</dt><dd>{clockOf(plan.startsAt)} – {clockOf(plan.endsAt)}</dd></div>
      <div><dt>Total</dt><dd>{durationLabel(plan.totalMinutes)}</dd></div>
      <div><dt>At stops</dt><dd>{durationLabel(plan.visitingMinutes)}</dd></div>
      <div><dt>Driving</dt><dd>{durationLabel(plan.drivingMinutes)}</dd></div>
    </dl>

    <p className="agenda-basis">
      <strong>Times are estimates.</strong>{' '}
      {plan.visit.basis === 'their-own-visits'
        ? `A stop is set at ${plan.visit.minutes} minutes, the middle of your own ${plan.visit.from} logged visits.`
        : `A stop is set at ${as.visitMinutes} minutes — you have no completed visits yet to measure against.`}{' '}
      Drive times come from the distance between stops, not from a live route.
      <button className="dash-link" onClick={() => setTuning(t => !t)}>{tuning ? 'Done' : 'Change these'}</button>
    </p>

    {tuning && <div className="agenda-tune">
      <label>Minutes per stop
        <input type="number" min={5} max={180} value={as.visitMinutes}
          onChange={e => setAs({ ...as, visitMinutes: Math.max(5, Number(e.target.value) || 5) })}/>
      </label>
      <label>Driving mph
        <input type="number" min={5} max={70} value={as.mph}
          onChange={e => setAs({ ...as, mph: Math.max(5, Number(e.target.value) || 5) })}/>
      </label>
      <button className="dash-btn" onClick={() => setAs({ ...DEFAULTS, visitMinutes: measured.minutes })}>Reset</button>
    </div>}

    {rounds.length > 1 && <div className="agenda-picker" role="tablist" aria-label="Rounds">
      {rounds.map(r => <button key={r.id} role="tab" aria-selected={r.id === route.id}
        className={r.id === route.id ? 'is-current' : ''}
        onClick={() => { setChosen(r.id); onPickRoute?.(r.id); }}>
        {dayLabel(r.date)}<small>{r.stops.length} stops{r.status === 'scheduled' ? ' · booked' : ''}</small>
      </button>)}
    </div>}

    <ol className="agenda-list">
      <li className="agenda-origin">
        <span className="agenda-n">—</span>
        <div><strong>{log.clinic.label}</strong><span>Leave at {clockOf(plan.startsAt)}</span></div>
      </li>
      {plan.stops.map(item => <AgendaRow key={item.stop.id} item={item} log={log}
        onOpen={onOpenStop ? () => onOpenStop(route.id, item.stop.id) : undefined}/>)}
    </ol>

    <p className="agenda-gap">
      The log holds each stop's town and its position on the map, but not a street address, and
      nothing records what a particular visit is for. Both would need a new field before the
      agenda could show them.
    </p>
  </section>;
}

function AgendaRow({ item, log, onOpen }: { item: AgendaStop; log: FieldLog; onOpen?: () => void }) {
  const { stop, status } = item;
  const signups = signupsAt(log, stop).length;
  const s = STATUS[status];
  return <li className={`agenda-stop is-${status}`}>
    <span className="agenda-n">{item.index + 1}</span>
    <div className="agenda-body">
      <div className="agenda-row-top">
        <strong>{stop.name}</strong>
        <span className={`dash-pill dash-pill-${s.tone}`}>{s.label}</span>
      </div>
      <p className="agenda-where">{CATEGORY_LABEL[stop.category]} · {stop.town}</p>
      <p className="agenda-times">
        <b>{clockOf(item.arriveAt)}</b>
        <span>{item.measured ? 'arrived' : 'planned arrival'}</span>
        <i aria-hidden="true">·</i>
        <span>{durationLabel(item.visitLength)} at the stop</span>
        <i aria-hidden="true">·</i>
        <span>{durationLabel(item.driveFromPrevious)} drive</span>
      </p>
      {status === 'completed' && <p className="agenda-done">
        {OUTCOME_LABEL[stop.outcome]} · {stop.cards} materials dropped
        {signups ? ` · ${signups} ${signups === 1 ? 'sign-up' : 'sign-ups'} since` : ''}
      </p>}
      <div className="agenda-actions">
        <a className="dash-btn" href={directionsTo(stop)} target="_blank" rel="noreferrer noopener">Directions</a>
        {onOpen && <button className="dash-btn" onClick={onOpen}>
          {status === 'completed' ? 'Open the visit' : 'Record the visit'}
        </button>}
      </div>
    </div>
  </li>;
}
