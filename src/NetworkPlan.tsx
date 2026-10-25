// THIS MONTH, AND WHO IS DUE. The two lists the brain produces, side by side above the map:
// new businesses to consider this month, and previously contacted businesses that have come
// round again. They are deliberately separate — a first visit and a return visit are different
// jobs for the staff doing them.
//
// NOTHING HERE DECIDES ANYTHING. The rank, the score, the reason, the due date and whether a
// business may go on a route all arrive from the server with each entry, and are rendered as
// given. Recording a visit posts the date and the outcome and takes the whole refreshed map
// back; the next due date is the server's answer, never this component's arithmetic.
import { useState, type CSSProperties, type FormEvent } from 'react';
import { Icon, type IconName } from './Icons';
import { dateInputValue, dayLabel, joinPlan, milesLabel, type MapBusiness, type NetworkPlan as Plan, type PlanFollowUp, type PlanPick } from './lib/network-math';

type Props = {
  plan: Plan;
  businesses: MapBusiness[];
  selection: string[];
  maxStops: number;
  busy: boolean;
  onToggle: (business: MapBusiness) => void;
  onOpen: (placeId: string) => void;
  onRecord: (input: { placeId: string; visitedOn: string; outcome: string; note: string }) => Promise<void>;
  onReopen: (placeId: string) => Promise<void>;
};

export default function NetworkPlan({ plan, businesses, selection, maxStops, busy, onToggle, onOpen, onRecord, onReopen }: Props) {
  const [recording, setRecording] = useState<string | null>(null);
  const [showParked, setShowParked] = useState(false);
  const atCapacity = selection.length >= maxStops;
  // A business visited this month stays on this month's list — the list is the month's, not a
  // queue that empties — but it says when it was visited, so nobody calls on it twice.
  const visited = new Map<string, string>();
  for (const entry of plan.history) if (!visited.has(entry.placeId)) visited.set(entry.placeId, entry.visitedOn);
  const newRows = joinPlan<PlanPick>(plan.recommended, businesses);
  const dueRows = joinPlan<PlanFollowUp>(plan.followUps.due, businesses);

  const shared = { selection, atCapacity, busy, onToggle, onOpen, recording, setRecording, outcomes: plan.outcomes, onRecord };

  return <section className="plan-grid" aria-label="This month’s businesses">
    <section className="plan-panel" aria-labelledby="plan-new-title">
      <div className="plan-head">
        <div><p className="eyebrow">{plan.periodLabel}</p><h2 id="plan-new-title">New this month</h2></div>
        <span className="plan-count">{plan.recommended.length} of {plan.monthlyLimit}</span>
      </div>
      <p className="plan-note">{plan.recommendedNote}</p>
      {!newRows.length
        ? <p className="network-empty">No new businesses qualified this month. Nothing is padded out to reach fifteen.</p>
        : <ul className="plan-list">{newRows.map(({ entry, business }) => <li key={entry.placeId}>
            <Row business={business} score={entry.score} reason={entry.reason} visitedOn={visited.get(entry.placeId)} {...shared} placeId={entry.placeId}/>
          </li>)}</ul>}
      {plan.withdrawn.length > 0 && <p className="plan-footnote">{plan.withdrawn.length} {plan.withdrawn.length === 1 ? 'business has' : 'businesses have'} been withdrawn by the network since this list was made.</p>}
      {plan.heldBack.length > 0 && <div className="plan-held">
        <h3>Held back for review</h3>
        <ul>{plan.heldBack.map(held => <li key={held.placeId}><strong>{held.name ?? 'A business on your map'}</strong><span>{held.reason}</span></li>)}</ul>
      </div>}
    </section>

    <section className="plan-panel" aria-labelledby="plan-due-title">
      <div className="plan-head">
        <div><p className="eyebrow">Previously contacted</p><h2 id="plan-due-title">Follow-ups due</h2></div>
        <span className="plan-count">{plan.followUps.due.length} due</span>
      </div>
      <p className="plan-note">{plan.followUps.note}</p>
      {!dueRows.length
        ? <p className="network-empty">Nothing is due right now. Record a visit and the business comes back about every {plan.cadence.months} months.</p>
        : <ul className="plan-list">{dueRows.map(({ entry, business }) => <li key={entry.placeId}>
            <Row business={business} reason={entry.reason} due={entry.scheduledOn} overdue={entry.scheduledOn < plan.today} lastVisit={entry.lastVisitedOn} outcomeLabel={entry.outcomeLabel} {...shared} placeId={entry.placeId}/>
          </li>)}</ul>}
      {plan.followUps.upcoming.length > 0 && <details className="plan-more">
        <summary>{plan.followUps.upcoming.length} coming up</summary>
        <ul>{joinPlan<PlanFollowUp>(plan.followUps.upcoming, businesses).map(({ entry, business }) => <li key={entry.placeId}>
          <span>{business?.name ?? 'Details being looked up again'}</span><time dateTime={entry.scheduledOn}>{dayLabel(entry.scheduledOn)}</time>
        </li>)}</ul>
      </details>}
      {plan.followUps.parked.length > 0 && <div className="plan-more">
        <button type="button" className="network-inline-button" aria-expanded={showParked} onClick={() => setShowParked(!showParked)}>
          {plan.followUps.parked.length} marked not interested
        </button>
        {showParked && <ul className="plan-parked">{joinPlan<PlanFollowUp>(plan.followUps.parked, businesses).map(({ entry, business }) => <li key={entry.placeId}>
          <span>{business?.name ?? 'Details being looked up again'}<small>Last visited {dayLabel(entry.lastVisitedOn)}</small></span>
          <button type="button" className="network-secondary is-small" disabled={busy} onClick={() => void onReopen(entry.placeId)}>Reopen</button>
        </li>)}</ul>}
      </div>}
    </section>
  </section>;
}

type RowProps = {
  placeId: string;
  business: MapBusiness | null;
  reason: string;
  score?: number;
  due?: string;
  overdue?: boolean;
  lastVisit?: string;
  visitedOn?: string;
  outcomeLabel?: string;
  selection: string[];
  atCapacity: boolean;
  busy: boolean;
  recording: string | null;
  setRecording: (value: string | null) => void;
  outcomes: Array<{ id: string; label: string }>;
  onToggle: (business: MapBusiness) => void;
  onOpen: (placeId: string) => void;
  onRecord: (input: { placeId: string; visitedOn: string; outcome: string; note: string }) => Promise<void>;
};

function Row({ placeId, business, reason, score, due, overdue, lastVisit, visitedOn, outcomeLabel, selection, atCapacity, busy, recording, setRecording, outcomes, onToggle, onOpen, onRecord }: RowProps) {
  // The content behind a place ID expires at 30 days. When it has, the row says so: there is no
  // stored copy of a name or an address to fall back on, and inventing one is not an option.
  if (!business) return <div className="plan-row is-waiting">
    <span className="plan-row-body"><strong>Details being looked up again</strong><span className="plan-row-meta">This business is on your list; Google’s details for it have expired and are refreshed on the next lookup.</span></span>
  </div>;

  const chosen = selection.includes(placeId);
  const open = recording === placeId;
  return <div className="plan-row" style={{ '--marker': business.category?.color ?? '#6B7B70' } as CSSProperties}>
    <span className="plan-row-icon"><Icon name={(business.category?.icon ?? 'info') as IconName} size={16}/></span>
    <span className="plan-row-body">
      <span className="plan-row-head">
        <button type="button" className="plan-row-name" onClick={() => onOpen(placeId)}>{business.name ?? 'Unnamed business'}</button>
        {typeof score === 'number' ? <span className="plan-row-score">{score}<small>/100</small></span>
          : due ? <time className="plan-row-due" dateTime={due}>{overdue ? 'Due since' : 'Due'} {dayLabel(due)}</time> : null}
      </span>
      <span className="plan-row-meta">{business.category?.label ?? 'Uncategorised'} · {milesLabel(business.distanceMiles)}{business.address ? ` · ${business.address}` : ''}</span>
      <span className="plan-row-reason">{outcomeLabel ? `${outcomeLabel}. ${reason}` : reason}{lastVisit ? ` Last visited ${dayLabel(lastVisit)}.` : ''}</span>
      <span className="plan-row-tags">
        <span className={`network-status is-${business.status}`}>{business.statusLabel}</span>
        <span className="plan-ownership">{business.ownership.label}</span>
        {visitedOn && <span className="plan-visited">Visited {dayLabel(visitedOn)}</span>}
      </span>
      <span className="plan-row-actions">
        {business.routable
          ? <button type="button" className={chosen ? 'network-secondary is-small' : 'network-primary is-small'} disabled={busy || (!chosen && atCapacity)} onClick={() => onToggle(business)}>
              <Icon name={chosen ? 'minus' : 'plus'} size={14}/>{chosen ? 'On your route' : atCapacity ? 'Route is full' : 'Add to route'}
            </button>
          : <span className="network-blocked"><Icon name="info" size={14}/> Not routable</span>}
        <button type="button" className="network-inline-button" aria-expanded={open} onClick={() => setRecording(open ? null : placeId)}>Record a visit</button>
      </span>
      {open && <VisitForm placeId={placeId} outcomes={outcomes} busy={busy} onDone={() => setRecording(null)} onRecord={onRecord}/>}
    </span>
  </div>;
}

/** The staff's own record of a visit: the date they went, how it went, and anything to remember. */
function VisitForm({ placeId, outcomes, busy, onRecord, onDone }: { placeId: string; outcomes: Array<{ id: string; label: string }>; busy: boolean; onRecord: RowProps['onRecord']; onDone: () => void }) {
  const today = dateInputValue(new Date());
  const [visitedOn, setVisitedOn] = useState(today);
  const [outcome, setOutcome] = useState(outcomes[0]?.id ?? 'interested');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true); setError('');
    try { await onRecord({ placeId, visitedOn, outcome, note }); onDone(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'That visit could not be saved.'); }
    finally { setSaving(false); }
  }
  return <form className="plan-visit" onSubmit={submit}>
    <div className="plan-visit-fields">
      <div className="field"><label htmlFor={`visit-date-${placeId}`}>Date visited</label>
        <input id={`visit-date-${placeId}`} type="date" required max={today} value={visitedOn} onChange={event => setVisitedOn(event.target.value)} disabled={saving || busy}/></div>
      <div className="field"><label htmlFor={`visit-outcome-${placeId}`}>How did it go?</label>
        <select id={`visit-outcome-${placeId}`} value={outcome} onChange={event => setOutcome(event.target.value)} disabled={saving || busy}>
          {outcomes.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
        </select></div>
    </div>
    <div className="field"><label htmlFor={`visit-note-${placeId}`}>Note (optional)</label>
      <input id={`visit-note-${placeId}`} type="text" maxLength={600} value={note} onChange={event => setNote(event.target.value)} disabled={saving || busy} placeholder="Who you spoke to, what they said"/></div>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="plan-visit-actions">
      <button type="submit" className="network-primary is-small" disabled={saving || busy}>{saving ? 'Saving…' : 'Save visit'}</button>
      <button type="button" className="network-inline-button" onClick={onDone} disabled={saving}>Cancel</button>
    </div>
    <p className="plan-visit-note">The outcome sets when this business comes round again. “Not interested” keeps it out of the queue until you reopen it.</p>
  </form>;
}
