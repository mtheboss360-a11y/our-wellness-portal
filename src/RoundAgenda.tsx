// TODAY'S ROUND, built from the businesses this practice has actually been released.
//
// This is the screen a field rep lives in for a day. It answers, from the top: which round,
// how far through, where am I going now, and what time should I be there. Every stop opens
// straight into the guided visit, and finishing one comes back here with the progress moved
// on — so a day is a loop through this screen, never a trip back to the dashboard.
//
// Times for a round that has not happened are arithmetic and the screen says so. A stop with
// no coordinate gets no drive estimate, and says that too rather than printing a confident
// wrong number.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { getRounds, type Business, type Round, type Visit } from './lib/api';
import { planRound, clockOf, durationLabel, WEEKDAY, type RoundPlan, type PlannedStop } from './lib/round-math';
import { Icon } from './Icons';
import GuidedVisit from './GuidedVisit';

const dayLabel = (iso: string) => new Date(`${iso}T12:00:00Z`)
  .toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });

const directionsTo = (b: Business) => b.lat !== null && b.lng !== null
  ? `https://www.google.com/maps/dir/?api=1&destination=${b.lat},${b.lng}&travelmode=driving`
  : `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(b.address)}&travelmode=driving`;

export default function RoundAgenda({ today, staffName, onClose }: {
  today: string; staffName?: string | null; onClose: () => void;
}) {
  const [data, setData] = useState<{ rounds: Round[]; visits: Visit[]; clinic: { lat: number; lng: number; label: string } | null } | null>(null);
  const [error, setError] = useState('');
  const [chosen, setChosen] = useState<string>('');
  const [visiting, setVisiting] = useState<string | null>(null);

  const load = useCallback(() => {
    setError('');
    return getRounds().then(setData).catch(e => setError(e instanceof Error ? e.message : 'We couldn’t open your round.'));
  }, []);
  useEffect(() => { void load(); }, [load]);

  const round = useMemo(() => {
    if (!data?.rounds.length) return null;
    const upcoming = data.rounds.filter(r => r.date >= today).sort((a, b) => a.date.localeCompare(b.date));
    return data.rounds.find(r => r.id === chosen) ?? upcoming[0] ?? data.rounds[0];
  }, [data, chosen, today]);

  const plan = useMemo(() => {
    if (!round || !data) return null;
    const nowMinutes = new Date().getHours() * 60 + new Date().getMinutes();
    return planRound(data.clinic, round, data.visits, { today, nowMinutes });
  }, [round, data, today]);

  // A finished visit comes back here, not to the dashboard: the round is the workflow.
  if (visiting && plan) {
    const at = plan.stops.findIndex(s => s.business.id === visiting);
    const after = plan.stops.slice(at + 1).find(s => !s.done);
    return <section className="network-page">
      <GuidedVisit
        businessId={visiting}
        today={today}
        staffName={staffName}
        onClose={() => { setVisiting(null); void load(); }}
        onNext={after ? () => { setVisiting(after.business.id); void load(); } : undefined}
        nextLabel={after ? `Next: ${after.business.name}` : undefined}/>
    </section>;
  }

  return <section className="network-page" aria-labelledby="ra-title">
    <div className="network-head">
      <h1 id="ra-title">Today’s round</h1>
      <button className="network-back" onClick={onClose}>Back to your dashboard</button>
    </div>

    {error && <div className="network-state" role="alert">
      <h2>We couldn’t open your round.</h2><p>{error}</p>
      <button className="dash-btn" onClick={() => void load()}>Try again</button>
    </div>}

    {!error && !data && <div className="ra" aria-busy="true">
      <div className="dash-skel dash-skel-title"/>
      {[0, 1, 2, 3].map(n => <div className="dash-skel dash-skel-big" key={n}/>)}
      <p className="sr-only" role="status">Loading your round.</p>
    </div>}

    {!error && data && !round && <div className="network-state">
      <h2>No round booked.</h2>
      <p>When a round is scheduled it appears here: the stops in order, when to be at each one,
        and the script for every conversation.</p>
    </div>}

    {!error && data && round && plan && <Plan
      plan={plan}
      rounds={data.rounds}
      current={round.id}
      onPick={setChosen}
      onOpen={setVisiting}/>}
  </section>;
}

function Plan({ plan, rounds, current, onPick, onOpen }: {
  plan: RoundPlan; rounds: Round[]; current: string;
  onPick: (id: string) => void; onOpen: (businessId: string) => void;
}) {
  const { round, stops, completed, next, opening } = plan;
  const total = stops.length;
  const through = total ? Math.round((completed / total) * 100) : 0;

  return <div className="ra">
    {rounds.length > 1 && <div className="ra-days" role="tablist" aria-label="Rounds">
      {rounds.map(r => <button key={r.id} role="tab" aria-selected={r.id === current}
        className={r.id === current ? 'is-current' : ''} onClick={() => onPick(r.id)}>
        {dayLabel(r.date)}<small>{r.stops.length} stops</small>
      </button>)}
    </div>}

    <header className="ra-head">
      <div>
        <p className="dash-eyebrow">{round.status === 'done' ? 'Round' : 'Next round'}</p>
        <h2>{dayLabel(round.date)}</h2>
        <p className="ra-sub">{round.staff ? `${round.staff} · ` : ''}{total} {total === 1 ? 'stop' : 'stops'} · from {clockOf(plan.startsAt)}</p>
      </div>
      {next && <button className="gv-go" onClick={() => onOpen(next.business.id)}>
        {completed ? 'Next stop' : 'Start the round'}<Icon name="arrow" size={17}/>
      </button>}
    </header>

    {/* How far through, counted from visits actually recorded — not from anything this screen holds. */}
    <div className="ra-progress">
      <div className="ra-bar" role="img" aria-label={`${completed} of ${total} stops completed`}>
        <span style={{ width: `${through}%` }}/>
      </div>
      <p>{completed} of {total} stops completed{completed === total && total > 0 ? ' — the round is done.' : ''}</p>
    </div>

    <p className={`agenda-hours ${opening.closed ? 'is-shut' : ''}`}>
      <Icon name="calendar" size={15}/>
      {opening.closed
        ? `The practice is closed on ${WEEKDAY[opening.weekday]}. This round is booked on a day nobody is in.`
        : opening.heldBack
          ? `${WEEKDAY[opening.weekday]} opening is ${clockOf(plan.startsAt)}, so the round starts then rather than earlier.`
          : `${WEEKDAY[opening.weekday]}. The round starts at ${clockOf(plan.startsAt)}.`}
    </p>

    <dl className="agenda-totals">
      <div><dt>Expected</dt><dd>{clockOf(plan.startsAt)} – {clockOf(plan.endsAt)}</dd></div>
      <div><dt>Total</dt><dd>{durationLabel(plan.totalMinutes)}</dd></div>
      <div><dt>At stops</dt><dd>{durationLabel(plan.visitingMinutes)}</dd></div>
      <div><dt>Driving</dt><dd>{durationLabel(plan.drivingMinutes)}</dd></div>
    </dl>

    <p className="agenda-basis">
      <strong>Times are estimates.</strong>{' '}
      A stop is allowed {stops[0]?.visitLength ?? 20} minutes. Drive times come from the distance
      between stops, not from a routed journey, so treat them as a way to plan a morning rather
      than a promise.
      {plan.unlocated.length > 0 && <>{' '}
        <strong>{plan.unlocated.join(', ')}</strong> {plan.unlocated.length === 1 ? 'has' : 'have'} no
        map position, so no drive time could be worked out for {plan.unlocated.length === 1 ? 'it' : 'them'}.
      </>}
    </p>

    <ol className="ra-stops">
      <li className="agenda-origin">
        <span className="agenda-n">—</span>
        <div><strong>Leave the practice</strong><span>{clockOf(plan.startsAt)}</span></div>
      </li>
      {stops.map(stop => <Stop key={stop.business.id} stop={stop} onOpen={() => onOpen(stop.business.id)}/>)}
    </ol>
  </div>;
}

function Stop({ stop, onOpen }: { stop: PlannedStop; onOpen: () => void }) {
  const { business, visit } = stop;
  return <li className={`ra-stop is-${stop.status}`}>
    <span className="agenda-n">{stop.done ? <Icon name="check" size={15}/> : stop.index + 1}</span>
    <div className="ra-body">
      <div className="ra-top">
        <strong>{business.name}</strong>
        <span className={`dash-pill dash-pill-${stop.done ? 'good' : stop.status === 'in-progress' ? 'warn' : 'neutral'}`}>
          {stop.done ? visit!.outcomeLabel : stop.status === 'in-progress' ? 'You should be here' : 'Upcoming'}
        </span>
      </div>
      <p className="ra-where">{business.category} · {business.address}</p>

      <p className="ra-times">
        {stop.done
          ? <>Recorded{visit!.spokeWith ? ` · spoke with ${visit!.spokeWith}` : ''}{visit!.materials ? ` · ${visit!.materials} materials dropped` : ''}</>
          : <>
              <b>{stop.located ? clockOf(stop.arriveAt) : '—'}</b>
              <span>{stop.located ? 'planned arrival' : 'no map position, so no arrival time'}</span>
              <i aria-hidden="true">·</i>
              <span>{durationLabel(stop.visitLength)} at the stop</span>
              {stop.driveFromPrevious !== null && <>
                <i aria-hidden="true">·</i><span>{durationLabel(stop.driveFromPrevious)} drive</span>
              </>}
            </>}
      </p>

      <div className="agenda-actions">
        <a className="dash-btn" href={directionsTo(business)} target="_blank" rel="noreferrer noopener">
          <Icon name="map" size={15}/>Directions
        </a>
        <button className={stop.done ? 'dash-btn' : 'gv-go gv-go-small'} onClick={onOpen}>
          {stop.done ? 'Open the visit' : 'Start visit'}{!stop.done && <Icon name="arrow" size={15}/>}
        </button>
      </div>
    </div>
  </li>;
}
