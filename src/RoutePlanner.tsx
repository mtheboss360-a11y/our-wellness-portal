// THE ROUTE PLANNER. Pick up to five businesses and get the drive, clinic first.
//
// The order is the order you put them in; nothing here reorders a round behind the person
// doing it. The result is a Google Maps directions link built from the coordinates the field
// log already holds — the documented Maps URLs API, no key and no billing — so it opens in
// whatever maps app the phone already uses and gives real turn-by-turn.
//
// It does not borrow the Referral network's orb. That screen draws the whole network; this one
// is a list and a link, which is what someone about to drive actually needs.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { FieldLog, FieldStop } from '../data/field-data';
import type { VisitNote } from './lib/api';
import { CATEGORY_LABEL } from './lib/field-math';

export const MAX_STOPS = 5;

export type Candidate = { businessId: string; name: string; town: string; category: FieldStop['category']; lat: number; lng: number; why: string };

/**
 * Who is worth putting on a round, and why, from this clinic's own log: the ones ticked on
 * Route notes first, then the ones owed a second call. Nothing from the wider business pool.
 */
export function candidates(log: FieldLog, notes: VisitNote[]): Candidate[] {
  const latest = new Map<string, { stop: FieldStop; on: string }>();
  for (const route of log.routes.filter(r => r.status === 'done')) {
    for (const stop of route.stops) {
      const held = latest.get(stop.businessId);
      if (!held || route.date > held.on) latest.set(stop.businessId, { stop, on: route.date });
    }
  }
  const picked = new Set(notes.filter(n => n.nextRound).map(n => n.businessId));
  const rows: Candidate[] = [];
  for (const [businessId, { stop }] of latest) {
    const why = picked.has(businessId) ? 'Picked on Route notes'
      : stop.outcome === 'follow-up' ? 'Owed a second call'
      : '';
    if (!why) continue;
    rows.push({ businessId, name: stop.name, town: stop.town, category: stop.category, lat: stop.lat, lng: stop.lng, why });
  }
  // ticked first, then the follow-ups, each alphabetical so the list does not shuffle
  return rows.sort((a, b) => (a.why === b.why ? a.name.localeCompare(b.name) : a.why < b.why ? -1 : 1));
}

/** The drive: clinic, then each stop in the order given. */
export function driveUrl(clinic: { lat: number; lng: number }, stops: Candidate[]) {
  if (!stops.length) return '';
  const last = stops[stops.length - 1];
  const between = stops.slice(0, -1).map(s => `${s.lat},${s.lng}`).join('|');
  const parts = [
    'https://www.google.com/maps/dir/?api=1',
    `origin=${clinic.lat},${clinic.lng}`,
    `destination=${last.lat},${last.lng}`,
    between ? `waypoints=${encodeURIComponent(between)}` : '',
    'travelmode=driving',
  ].filter(Boolean);
  return parts.join('&');
}

export default function RoutePlanner({ log, notes }: { log: FieldLog; notes: VisitNote[] }) {
  const options = useMemo(() => candidates(log, notes), [log, notes]);
  const [order, setOrder] = useState<string[]>([]);
  // The notes arrive after the first render, so the round is seeded when they land rather than
  // from the empty list that exists at mount. Seeded once: after that the order is the
  // person's, and a later refresh must not reshuffle what they have arranged.
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || !options.length) return;
    const ticked = options.filter(o => o.why === 'Picked on Route notes').slice(0, MAX_STOPS);
    if (!ticked.length) return;
    seeded.current = true;
    setOrder(ticked.map(o => o.businessId));
  }, [options]);

  if (!options.length) return null;

  const chosen = order.map(id => options.find(o => o.businessId === id)).filter((o): o is Candidate => !!o);
  const full = chosen.length >= MAX_STOPS;
  const toggle = (id: string) => setOrder(now =>
    now.includes(id) ? now.filter(x => x !== id) : now.length >= MAX_STOPS ? now : [...now, id]);
  const move = (index: number, by: number) => setOrder(now => {
    const next = [...now]; const to = index + by;
    if (to < 0 || to >= next.length) return now;
    [next[index], next[to]] = [next[to], next[index]];
    return next;
  });

  return <section className="planner" aria-labelledby="planner-title">
    <div className="planner-head">
      <div>
        <h2 id="planner-title">Plan a round</h2>
        <p>Up to {MAX_STOPS} stops, in the order you want to drive them. Starts at your practice.</p>
      </div>
      <a className={`dash-primary ${chosen.length ? '' : 'is-off'}`}
        href={chosen.length ? driveUrl(log.clinic, chosen) : undefined}
        target="_blank" rel="noreferrer noopener"
        aria-disabled={chosen.length ? undefined : true}>
        Open the drive{chosen.length ? ` · ${chosen.length}` : ''}
      </a>
    </div>

    {chosen.length > 0 && <ol className="planner-order">
      <li className="planner-origin"><span className="planner-n">—</span><b>{log.clinic.label}</b><em>Start</em></li>
      {chosen.map((stop, index) => <li key={stop.businessId}>
        <span className="planner-n">{index + 1}</span>
        <span className="planner-main"><b>{stop.name}</b><em>{CATEGORY_LABEL[stop.category]} · {stop.town}</em></span>
        <span className="planner-move">
          <button type="button" onClick={() => move(index, -1)} disabled={index === 0} aria-label={`Move ${stop.name} earlier`}>↑</button>
          <button type="button" onClick={() => move(index, 1)} disabled={index === chosen.length - 1} aria-label={`Move ${stop.name} later`}>↓</button>
          <button type="button" onClick={() => toggle(stop.businessId)} aria-label={`Take ${stop.name} off the round`}>✕</button>
        </span>
      </li>)}
    </ol>}

    <p className="planner-sub">{full
      ? `That is ${MAX_STOPS} stops — take one off to add another.`
      : 'Tick a business to add it.'}</p>

    <ul className="planner-pool">{options.map(option => {
      const on = order.includes(option.businessId);
      return <li key={option.businessId}>
        <label className={`planner-pick ${on ? 'is-on' : ''}`}>
          <input type="checkbox" checked={on} disabled={!on && full} onChange={() => toggle(option.businessId)}/>
          <span><b>{option.name}</b><em>{option.town} · {option.why}</em></span>
        </label>
      </li>;
    })}</ul>
  </section>;
}
