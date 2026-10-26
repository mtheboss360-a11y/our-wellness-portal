// ROUTE NOTES. One row per business the practice's own staff has visited: what they wrote
// about it last time, and a box to put it on the next round.
//
// The notes are the staff member's own words and nothing reads them but this screen and the
// round list below it. Ticking a business does not book anything and does not tell the
// business anything — it adds it to the list the practice takes out next time.
import { useEffect, useMemo, useState } from 'react';
import { getField, getVisitNotes, saveVisitNote, type VisitNote } from './lib/api';
import type { FieldLog, FieldStop } from '../data/field-data';
import { CATEGORY_LABEL, OUTCOME_LABEL, dayLabel } from './lib/field-math';

type Row = { businessId: string; name: string; town: string; category: FieldStop['category']; lastVisit: string; outcome: FieldStop['outcome']; spokeWith: string };

/** Every business this clinic has actually visited, most recently visited first. */
function visited(log: FieldLog): Row[] {
  const rows = new Map<string, Row>();
  for (const route of log.routes.filter(r => r.status === 'done')) {
    for (const stop of route.stops) {
      const held = rows.get(stop.businessId);
      if (!held || route.date > held.lastVisit) {
        rows.set(stop.businessId, {
          businessId: stop.businessId, name: stop.name, town: stop.town, category: stop.category,
          lastVisit: route.date, outcome: stop.outcome, spokeWith: stop.spokeWith,
        });
      }
    }
  }
  return [...rows.values()].sort((a, b) => b.lastVisit.localeCompare(a.lastVisit) || a.name.localeCompare(b.name));
}

export default function RouteNotes({ onClose }: { onClose: () => void }) {
  const [log, setLog] = useState<FieldLog | null | undefined>(undefined);
  const [notes, setNotes] = useState<VisitNote[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    void Promise.all([getField(), getVisitNotes()])
      .then(([field, saved]) => { setLog(field.field); setNotes(saved.notes); })
      .catch(e => setError(e instanceof Error ? e.message : 'We couldn’t open your notes.'));
  }, []);

  const rows = useMemo(() => (log ? visited(log) : []), [log]);
  const noteFor = (businessId: string) => notes.find(n => n.businessId === businessId);
  const onNextRound = rows.filter(row => noteFor(row.businessId)?.nextRound);

  return <section className="network-page notes-page" aria-labelledby="notes-title">
    <div className="network-head">
      <h1 id="notes-title" className="sr-only">Route notes</h1>
      <button className="network-back" onClick={onClose}>Back to your dashboard</button>
    </div>

    {error && <div className="network-state" role="alert"><h2>We couldn’t open your notes.</h2><p>{error}</p></div>}
    {!error && log === undefined && <div className="network-state"><p role="status">Opening your notes…</p></div>}
    {!error && log !== undefined && !rows.length && <div className="network-state">
      <h2>Nothing visited yet.</h2>
      <p>Once your team records its first stop, every business you have been to appears here with a space for what they said.</p>
    </div>}

    {!error && !!rows.length && <>
      <div className="section-heading">
        <h2>Route notes</h2>
        <p className="section-subtitle">What you found last time, and who to go back to. Tick a business to put it on the next round.</p>
      </div>

      <div className="notes-round" aria-live="polite">
        <strong>Next round</strong>
        {onNextRound.length
          ? <span>{onNextRound.length} picked · {onNextRound.map(r => r.name).join(', ')}</span>
          : <span className="notes-round-empty">Nothing picked yet. Tick a business below and it lands here.</span>}
      </div>

      <ul className="notes-list">{rows.map(row => <NoteRow
        key={row.businessId}
        row={row}
        saved={noteFor(row.businessId)}
        onSaved={setNotes}
        onError={setError}
      />)}</ul>
    </>}
  </section>;
}

function NoteRow({ row, saved, onSaved, onError }: {
  row: Row; saved: VisitNote | undefined;
  onSaved: (notes: VisitNote[]) => void; onError: (message: string) => void;
}) {
  const [text, setText] = useState(saved?.note ?? '');
  const [ticked, setTicked] = useState(saved?.nextRound ?? false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const dirty = text !== (saved?.note ?? '');

  async function save(nextRound: boolean, note: string) {
    setBusy(true); setDone(false);
    try {
      const result = await saveVisitNote({ businessId: row.businessId, note, nextRound });
      onSaved(result.notes); setDone(true);
    } catch (e) {
      setTicked(saved?.nextRound ?? false);
      onError(e instanceof Error ? e.message : 'That note could not be saved.');
    } finally { setBusy(false); }
  }

  return <li className="notes-row">
    <div className="notes-row-head">
      <div className="notes-row-main">
        <strong>{row.name}</strong>
        <span>{CATEGORY_LABEL[row.category]} · {row.town} · last visited {dayLabel(row.lastVisit)}{row.spokeWith ? ` · ${row.spokeWith}` : ''}</span>
      </div>
      <span className={`dash-pill dash-pill-${row.outcome === 'joined' ? 'good' : row.outcome === 'follow-up' ? 'warn' : row.outcome === 'not-now' ? 'off' : 'info'}`}>
        {OUTCOME_LABEL[row.outcome]}
      </span>
    </div>

    <label className="sr-only" htmlFor={`note-${row.businessId}`}>Notes about {row.name}</label>
    <textarea
      id={`note-${row.businessId}`}
      className="notes-field"
      rows={2}
      placeholder="What they said, who to ask for, when to come back…"
      value={text}
      maxLength={2000}
      disabled={busy}
      onChange={event => { setText(event.target.value); setDone(false); }}
    />

    <div className="notes-row-foot">
      <label className="notes-check">
        <input
          type="checkbox"
          checked={ticked}
          disabled={busy}
          onChange={event => { setTicked(event.target.checked); void save(event.target.checked, text); }}
        />
        <span>Put on the next round</span>
      </label>
      <span className="notes-status" aria-live="polite">
        {busy ? 'Saving…' : done ? 'Saved' : dirty ? 'Not saved yet' : ''}
      </span>
      <button className="dash-btn" disabled={busy || !dirty} onClick={() => void save(ticked, text)}>Save note</button>
    </div>
  </li>;
}
