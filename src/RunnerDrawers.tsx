// THE DRAWERS. Everything that is not "where am I going next" lives in one of these, so the
// week stays a week. They are the study planner's sheet: a panel from the right on the same
// ground as the page, a title, a scrolling body, and the action at the foot.
//
// Four of them: a business stop, a pickup being written, a pickup being collected, and the
// supplies. Each is a leaf — it holds its own form state and hands finished values back.
import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icons';
import {
  getRunnerBusiness, type Business, type PickupDraft, type PickupKind, type RunnerRoute,
  type Script, type Supplies, type Visit,
} from './lib/api';
import { QUICK_RESULTS, quickOutcomeFor, defaultReturnDate, runnerOutcomeLabel, type QuickResult } from './lib/runner-outcomes';
import type { Outcome } from './lib/api';
import { clockOf, itemAddress, itemName, type PlannedItem } from './lib/route-math';

export const SUPPLIES: Array<{ key: keyof Supplies; label: string }> = [
  { key: 'flyers', label: 'Flyers' },
  { key: 'treats', label: 'Treats' },
  { key: 'cards', label: 'Referral cards' },
];

export const PICKUP_LABEL: Record<PickupKind, string> = {
  treats: 'Treats / food', materials: 'Flyers / marketing materials', other: 'Other supplies',
};

const STAGE_LABEL: Record<Business['stage'], string> = {
  new: 'New · not contacted', visited: 'Visited', interested: 'Interested',
  partner: 'Active partner', 'follow-up': 'Follow-up due', declined: 'Declined',
};

const directionsTo = (destination: string) =>
  `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}&travelmode=driving`;

const dayLabel = (iso: string) => new Date(`${iso}T12:00:00Z`)
  .toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

export function SheetHead({ kicker, title, onClose }: { kicker: string; title: string; onClose: () => void }) {
  return <div className="rr-sheet-head">
    <div>
      <p className="rr-sheet-kicker">{kicker}</p>
      <h2 className="rr-sheet-title" id="rr-sheet-title">{title}</h2>
    </div>
    <button className="rr-sheet-close" aria-label="Close" onClick={onClose}><Icon name="close" size={18}/></button>
  </div>;
}

/** A BUSINESS STOP. What it is, then the way in. Everything else is folded away. */
export function StopDrawer({ roundId, entry, materials, onClose, onStart, onQuick }: {
  roundId: string; entry: PlannedItem;
  /** What the office assigned to this route, for the "what am I carrying" line. */
  materials: Supplies;
  onClose: () => void; onStart: () => void; onQuick: () => void;
}) {
  const business = entry.item.kind === 'business' ? entry.item.business : null;
  const [detail, setDetail] = useState<{ script: Script | null; visits: Visit[] } | null>(null);

  useEffect(() => {
    if (!business) return;
    let live = true;
    void getRunnerBusiness(roundId, business.id)
      .then(r => { if (live) setDetail({ script: r.script?.script ?? null, visits: r.visits }); })
      .catch(() => { if (live) setDetail({ script: null, visits: [] }); });
    return () => { live = false; };
  }, [roundId, business]);

  if (!business) return null;
  const last = detail?.visits[0];

  return <>
    <SheetHead kicker="Business stop" title={business.name} onClose={onClose}/>
    <div className="rr-sheet-body">
      <dl className="rr-dl">
        <dt>Address</dt><dd>{business.address}</dd>
        <dt>{entry.done ? 'Visited' : 'Arrive about'}</dt><dd>{clockOf(entry.arriveAt)}</dd>
        <dt>Relationship</dt><dd>{STAGE_LABEL[business.stage]}</dd>
        <dt>Carrying</dt><dd>{materials.flyers} flyers · {materials.treats} treats · {materials.cards} cards</dd>
      </dl>

      <p className="rr-sheet-note">
        {business.talkingPoint || 'No objective has been written for this business yet.'}
      </p>

      <details className="rr-fold">
        <summary>Brief and script</summary>
        <div className="rr-fold-body">
          {detail === null ? <p>Opening…</p> : <>
            {business.phone && <p>{business.phone}</p>}
            {detail.script
              ? <>
                  <p className="rr-quote">{detail.visits.length ? detail.script.followUp : detail.script.opening}</p>
                  <p>{detail.script.value}</p>
                  <p><b>The ask.</b> {detail.script.ask}</p>
                </>
              : <p>No script on file. Introduce the practice in your own words and ask whether the
                  owner or manager has a minute.</p>}
          </>}
        </div>
      </details>

      <details className="rr-fold">
        <summary>What has happened so far</summary>
        <div className="rr-fold-body">
          {detail === null ? <p>Opening…</p>
            : !detail.visits.length ? <p>Nobody has visited yet. This is the first conversation.</p>
            : detail.visits.slice(0, 5).map(visit => <p key={visit.id}>
                <b>{runnerOutcomeLabel(visit.outcome, visit.outcomeLabel)}</b> · {dayLabel(visit.visitedOn)}
                {visit.spokeWith ? ` · spoke with ${visit.spokeWith}` : ''}
                {visit.materials ? ` · ${visit.materials} materials dropped` : ''}
                {visit.note ? ` — “${visit.note}”` : ''}
              </p>)}
          {last?.spokeWith && <p>Ask for <b>{last.spokeWith}</b>.</p>}
        </div>
      </details>

      {entry.attribution === 'inferred' && <p className="rr-sheet-note">
        The visit on this stop does not say which route it was recorded on. It has been matched
        to this one because it is the last route before it that had this business on it.
      </p>}
    </div>
    <div className="rr-sheet-foot">
      <a className="rr-btn rr-btn-outline" href={directionsTo(business.lat !== null && business.lng !== null
        ? `${business.lat},${business.lng}` : business.address)} target="_blank" rel="noreferrer noopener">
        <Icon name="map" size={16}/>Directions
      </a>
      {!entry.done && <button className="rr-btn rr-btn-primary" onClick={onQuick}>
        <Icon name="check" size={16}/>Check off stop
      </button>}
      <button className="rr-btn rr-btn-outline" onClick={onStart}>
        {entry.done ? 'Open the visit' : 'Guided visit'}<Icon name="arrow" size={16}/>
      </button>
    </div>
  </>;
}

/** ARRIVING AT A PICKUP. Confirming it is not the same job as editing it. */
export function CollectDrawer({ entry, busy, onClose, onEdit, onCollect }: {
  entry: PlannedItem; busy: boolean;
  onClose: () => void; onEdit: () => void; onCollect: (collected: Supplies) => void;
}) {
  const pickup = entry.item.kind === 'pickup' ? entry.item.pickup : null;
  const [form, setForm] = useState<Record<keyof Supplies, string>>(() => ({
    flyers: String(pickup?.collected?.flyers ?? pickup?.supplies.flyers ?? 0),
    treats: String(pickup?.collected?.treats ?? pickup?.supplies.treats ?? 0),
    cards: String(pickup?.collected?.cards ?? pickup?.supplies.cards ?? 0),
  }));
  const [failed, setFailed] = useState('');
  if (!pickup) return null;
  const collected = pickup.status === 'collected';

  function submit() {
    const value: Supplies = {
      flyers: Number(form.flyers), treats: Number(form.treats), cards: Number(form.cards),
    };
    for (const supply of SUPPLIES) {
      const count = value[supply.key];
      if (!Number.isInteger(count) || count < 0 || count > 10000) {
        return setFailed(`${supply.label}: a whole number from 0 to 10000.`);
      }
    }
    setFailed('');
    onCollect(value);
  }

  return <>
    <SheetHead kicker="Pickup stop" title={pickup.title} onClose={onClose}/>
    <div className="rr-sheet-body">
      <dl className="rr-dl">
        <dt>Address</dt><dd>{pickup.address}</dd>
        <dt>Window</dt><dd>{pickup.windowStart}–{pickup.windowEnd}</dd>
        <dt>Arrive about</dt><dd>{clockOf(entry.arriveAt)}</dd>
        <dt>To collect</dt><dd>{pickup.items || 'Not written down'}</dd>
        {pickup.reference && <><dt>Under</dt><dd>{pickup.reference}</dd></>}
      </dl>
      {pickup.note && <p className="rr-sheet-note">{pickup.note}</p>}
      {entry.late > 0 && <p className="rr-sheet-note">
        This order reaches the window about {entry.late} minutes after it closes. Move it earlier
        in the day, or call them.
      </p>}

      {collected ? <p className="rr-sheet-note">
        Already collected — {pickup.collected?.flyers ?? 0} flyers, {pickup.collected?.treats ?? 0} treats,
        {' '}{pickup.collected?.cards ?? 0} cards are counted in your supplies.
      </p> : <>
        <span className="rr-field-label">What you actually came away with</span>
        <div className="rr-row" style={{ gridTemplateColumns: 'repeat(3,minmax(0,1fr))' }}>
          {SUPPLIES.map(supply => <div className="rr-field" key={supply.key}>
            <label htmlFor={`rr-got-${supply.key}`}>{supply.label}</label>
            <input className="rr-input" id={`rr-got-${supply.key}`} type="number" inputMode="numeric"
              min={0} max={10000} value={form[supply.key]}
              onChange={event => setForm(current => ({ ...current, [supply.key]: event.target.value }))}/>
          </div>)}
        </div>
        <p className="rr-sheet-note">These start at what you said you were collecting. Change them
          to what is really in the car — your remaining supplies are counted from this.</p>
      </>}
      {failed && <p className="rr-sheet-error" role="alert">{failed}</p>}
    </div>
    <div className="rr-sheet-foot">
      <button className="rr-btn rr-btn-outline" onClick={onEdit} disabled={collected}>Edit pickup</button>
      <button className="rr-btn rr-btn-primary" onClick={submit} disabled={busy || collected}>
        {busy ? 'Saving…' : 'Confirm pickup'}
      </button>
    </div>
  </>;
}

/** WRITING A PICKUP. The study planner's add sheet, with a pickup's own fields. */
export function PickupDrawer({ route, pickupId, busy, onClose, onSave, onRemove, onDirty }: {
  route: RunnerRoute; pickupId?: string; busy: boolean;
  onClose: () => void; onSave: (draft: PickupDraft & { pickupId?: string }) => void;
  onRemove: () => void; onDirty: () => void;
}) {
  const found = pickupId ? route.items.find(item => item.kind === 'pickup' && item.id === pickupId) : undefined;
  const pickup = found?.kind === 'pickup' ? found.pickup : null;
  const [form, setForm] = useState<PickupDraft>(() => ({
    kind: pickup?.kind ?? 'treats', title: pickup?.title ?? '', address: pickup?.address ?? '',
    windowStart: pickup?.windowStart ?? '09:00', windowEnd: pickup?.windowEnd ?? '09:30',
    minutes: pickup?.minutes ?? 10, items: pickup?.items ?? '',
    reference: pickup?.reference ?? '', note: pickup?.note ?? '',
    supplies: pickup?.supplies ?? { flyers: 0, treats: 0, cards: 0 },
  }));
  const [failed, setFailed] = useState('');
  const set = <K extends keyof PickupDraft>(key: K, value: PickupDraft[K]) => {
    onDirty(); setForm(current => ({ ...current, [key]: value }));
  };
  const supply = (key: keyof Supplies, value: string) => {
    onDirty();
    setForm(current => ({ ...current, supplies: { ...(current.supplies as Supplies), [key]: Number(value) || 0 } }));
  };

  function submit() {
    if (!form.title.trim()) return setFailed('Give the pickup a location name.');
    if (form.address.trim().length < 8) return setFailed('Give the pickup a full street address.');
    if (form.windowEnd <= form.windowStart) return setFailed('The window has to open before it closes.');
    setFailed('');
    onSave({ ...form, pickupId });
  }

  return <>
    <SheetHead kicker="Route logistics" title={pickup ? 'Edit pickup' : 'Add pickup'} onClose={onClose}/>
    <div className="rr-sheet-body">
      <div className="rr-field">
        <span className="rr-field-label">What are you collecting?</span>
        <div className="rr-chips">
          {(Object.keys(PICKUP_LABEL) as PickupKind[]).map(kind => <button key={kind}
            className={`rr-chip ${form.kind === kind ? 'is-on' : ''}`} onClick={() => set('kind', kind)}>
            {PICKUP_LABEL[kind]}
          </button>)}
        </div>
      </div>
      <div className="rr-field">
        <label htmlFor="rr-p-title">Location name</label>
        <input className="rr-input" id="rr-p-title" maxLength={100} value={form.title}
          placeholder="Bakery on Main" onChange={event => set('title', event.target.value)}/>
      </div>
      <div className="rr-field">
        <label htmlFor="rr-p-address">Address</label>
        <input className="rr-input" id="rr-p-address" maxLength={250} value={form.address}
          placeholder="Street, city, state, ZIP" onChange={event => set('address', event.target.value)}/>
      </div>
      <div className="rr-row">
        <div className="rr-field">
          <label htmlFor="rr-p-from">Window opens</label>
          <input className="rr-input" id="rr-p-from" type="time" value={form.windowStart}
            onChange={event => set('windowStart', event.target.value)}/>
        </div>
        <div className="rr-field">
          <label htmlFor="rr-p-to">Window closes</label>
          <input className="rr-input" id="rr-p-to" type="time" value={form.windowEnd}
            onChange={event => set('windowEnd', event.target.value)}/>
        </div>
      </div>
      <div className="rr-field">
        <span className="rr-field-label">Time at the pickup</span>
        <div className="rr-chips">
          {[5, 10, 15, 20, 30, 45].map(minutes => <button key={minutes}
            className={`rr-chip ${form.minutes === minutes ? 'is-on' : ''}`}
            onClick={() => set('minutes', minutes)}>{minutes} min</button>)}
        </div>
      </div>
      <div className="rr-field">
        <label htmlFor="rr-p-items">Items to collect</label>
        <input className="rr-input" id="rr-p-items" maxLength={400} value={form.items}
          placeholder="4 dozen cookies" onChange={event => set('items', event.target.value)}/>
      </div>
      <div className="rr-field">
        <span className="rr-field-label">What it adds to your supplies</span>
        <div className="rr-row" style={{ gridTemplateColumns: 'repeat(3,minmax(0,1fr))' }}>
          {SUPPLIES.map(item => <div className="rr-field" key={item.key}>
            <label htmlFor={`rr-p-${item.key}`}>{item.label}</label>
            <input className="rr-input" id={`rr-p-${item.key}`} type="number" inputMode="numeric"
              min={0} max={10000} value={(form.supplies as Supplies)[item.key]}
              onChange={event => supply(item.key, event.target.value)}/>
          </div>)}
        </div>
      </div>
      <div className="rr-field">
        <label htmlFor="rr-p-ref">Order name or reference</label>
        <input className="rr-input" id="rr-p-ref" maxLength={120} value={form.reference}
          placeholder="Under Alexis · order 4821" onChange={event => set('reference', event.target.value)}/>
      </div>
      <div className="rr-field">
        <label htmlFor="rr-p-note">Instructions</label>
        <textarea className="rr-input" id="rr-p-note" maxLength={900} value={form.note}
          placeholder="Ask at the counter, park at the back" onChange={event => set('note', event.target.value)}/>
      </div>
      <p className="rr-sheet-note">A pickup is yours: you add it, you move it, you confirm it. It
        is not a referral business and never joins your practice’s list.</p>
      {failed && <p className="rr-sheet-error" role="alert">{failed}</p>}
      {pickup && pickup.status !== 'collected' && <button className="rr-btn rr-btn-ghost"
        style={{ alignSelf: 'flex-start', paddingLeft: 0 }} onClick={onRemove}>Remove this pickup</button>}
    </div>
    <div className="rr-sheet-foot">
      <button className="rr-btn rr-btn-outline" onClick={onClose}>Cancel</button>
      <button className="rr-btn rr-btn-primary" onClick={submit} disabled={busy}>
        {busy ? 'Saving…' : pickup ? 'Save pickup' : 'Add pickup'}
      </button>
    </div>
  </>;
}

/** SUPPLIES. Four numbers per material, and the one of them a runner writes. */
export function SuppliesDrawer({ route, busy, onClose, onSave, onDirty }: {
  route: RunnerRoute; busy: boolean; onClose: () => void;
  onSave: (packed: Supplies) => void; onDirty: () => void;
}) {
  const start = route.supplies.packed ?? route.supplies.planned;
  const [form, setForm] = useState<Record<keyof Supplies, string>>({
    flyers: String(start.flyers), treats: String(start.treats), cards: String(start.cards),
  });
  const [failed, setFailed] = useState('');

  function submit() {
    const value: Supplies = {
      flyers: Number(form.flyers), treats: Number(form.treats), cards: Number(form.cards),
    };
    for (const supply of SUPPLIES) {
      const count = value[supply.key];
      if (!Number.isInteger(count) || count < 0 || count > 10000) {
        return setFailed(`${supply.label}: a whole number from 0 to 10000.`);
      }
      if (count + route.collected[supply.key] < route.dropped[supply.key]) {
        return setFailed(`${supply.label}: ${route.dropped[supply.key]} are already recorded as dropped on this route.`);
      }
    }
    setFailed('');
    onSave(value);
  }

  return <>
    <SheetHead kicker="What to bring" title="Supplies" onClose={onClose}/>
    <div className="rr-sheet-body">
      <table className="rr-table">
        <thead>
          <tr><th scope="col"><span className="rr-sr">Material</span></th>
            <th scope="col">Assigned</th><th scope="col">Picked up</th>
            <th scope="col">Dropped</th><th scope="col">Remaining</th></tr>
        </thead>
        <tbody>
          {SUPPLIES.map(supply => <tr key={supply.key}>
            <th scope="row">{supply.label}</th>
            <td>{route.supplies.planned[supply.key]}</td>
            <td>{route.collected[supply.key] || '—'}</td>
            <td>{route.dropped[supply.key] || '—'}</td>
            <td className="rr-left">{route.supplies.packed ? Math.max(0, route.remaining[supply.key]) : '—'}</td>
          </tr>)}
        </tbody>
      </table>
      <p className="rr-sheet-note">
        Assigned is your office’s and you cannot change it. Materials Dropped is what you recorded
        at the door. Remaining is your confirmed load, plus what you picked up, less what you dropped.
      </p>

      <span className="rr-field-label">What you are actually carrying</span>
      <div className="rr-row" style={{ gridTemplateColumns: 'repeat(3,minmax(0,1fr))' }}>
        {SUPPLIES.map(supply => <div className="rr-field" key={supply.key}>
          <label htmlFor={`rr-packed-${supply.key}`}>{supply.label}</label>
          <input className="rr-input" id={`rr-packed-${supply.key}`} type="number" inputMode="numeric"
            min={0} max={10000} value={form[supply.key]}
            onChange={event => { onDirty(); setForm(current => ({ ...current, [supply.key]: event.target.value })); }}/>
        </div>)}
      </div>
      <p className="rr-sheet-note">A short box is worth saying. Never record materials you do not have.</p>
      {failed && <p className="rr-sheet-error" role="alert">{failed}</p>}
    </div>
    <div className="rr-sheet-foot">
      <button className="rr-btn rr-btn-outline" onClick={onClose}>Cancel</button>
      <button className="rr-btn rr-btn-primary" onClick={submit} disabled={busy}>
        {busy ? 'Saving…' : route.supplies.packed ? 'Update what you packed' : 'Confirm packed'}
      </button>
    </div>
  </>;
}

export { itemName, itemAddress };

/**
 * CHECK OFF A BUSINESS IN ONE SHORT FORM. These are three outcomes of a real visit, not a
 * separate local checkbox or a change of the business's stage without a visit record.
 * The caller writes through the normal /api/runner/visit endpoint; the resulting saved visit
 * is the authority that turns the stop green across every device.
 */
export function QuickResultDrawer({ entry, today, remaining, packed, busy, onDirty, onClose, onSave }: {
  entry: PlannedItem; today: string; remaining: Supplies; packed: boolean; busy: boolean;
  onDirty: () => void; onClose: () => void;
  onSave: (draft: {
    outcome: Outcome; spokeWith: string; note: string; nextAction: string;
    followUpOn: string | null; dropped: Supplies; clientRef: string;
  }) => Promise<void>;
}) {
  const business = entry.item.kind === 'business' ? entry.item.business : null;
  const [picked, setPicked] = useState<QuickResult | null>(null);
  const [spokeWith, setSpokeWith] = useState('');
  const [note, setNote] = useState('');
  const [followUpOn, setFollowUpOn] = useState(() => defaultReturnDate(today));
  const [dropped, setDropped] = useState<Record<keyof Supplies, string>>({ flyers: '0', treats: '0', cards: '0' });
  const [error, setError] = useState('');
  const ref = useRef(`quick_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 11)}`);
  if (!business) return null;
  const selected = picked ? quickOutcomeFor(picked) : null;

  const save = async () => {
    if (!selected || busy) return;
    if (selected === 'follow-up' && (!/^\d{4}-\d{2}-\d{2}$/.test(followUpOn) || followUpOn < today)) {
      setError('Choose a return date on or after today.'); return;
    }
    const quantities = { flyers: Number(dropped.flyers), treats: Number(dropped.treats), cards: Number(dropped.cards) };
    for (const item of SUPPLIES) {
      const amount = quantities[item.key];
      if (!Number.isSafeInteger(amount) || amount < 0 || (packed && amount > remaining[item.key])) {
        setError(`Please enter a valid ${item.label.toLowerCase()} count within what you have.`);
        return;
      }
      if (!packed && amount > 0) {
        setError('Confirm your supplies before recording any materials dropped.'); return;
      }
    }
    setError('');
    try {
      await onSave({
        outcome: selected, spokeWith: spokeWith.trim(), note: note.trim(),
        nextAction: selected === 'follow-up' ? 'Return for another conversation' : '',
        followUpOn: selected === 'follow-up' ? followUpOn : null,
        dropped: quantities, clientRef: ref.current,
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save. Your answers are still here.');
    }
  };

  return <>
    <SheetHead kicker="Check off stop" title={business.name} onClose={onClose}/>
    <div className="rr-sheet-body">
      <p className="rr-sheet-note">Choose what actually happened. Saving records your visit and checks this stop off the route.</p>
      <div className="rr-quick-results" role="group" aria-label="Visit result">
        {QUICK_RESULTS.map(result => <button key={result.key} type="button"
          className={`rr-quick-choice ${picked === result.key ? 'is-picked' : ''}`}
          aria-pressed={picked === result.key}
          onClick={() => { setPicked(result.key); setError(''); onDirty(); }}>
          <span className="rr-quick-dot"><Icon name={picked === result.key ? 'check' : 'shop'} size={15}/></span>
          <span><strong>{result.label}</strong><small>{result.detail}</small></span>
        </button>)}
      </div>
      {selected === 'follow-up' && <div className="rr-field">
        <label htmlFor="rr-quick-date">Come back on</label>
        <input id="rr-quick-date" type="date" className="rr-input" value={followUpOn} min={today}
          onChange={e => { setFollowUpOn(e.target.value); onDirty(); }}/>
      </div>}
      <div className="rr-field">
        <label htmlFor="rr-quick-person">Spoke with (optional)</label>
        <input id="rr-quick-person" className="rr-input" autoComplete="off" maxLength={120}
          placeholder="Owner, manager, front desk name" value={spokeWith}
          onChange={e => { setSpokeWith(e.target.value); onDirty(); }}/>
      </div>
      <div className="rr-field">
        <label htmlFor="rr-quick-notes">Notes (optional)</label>
        <textarea id="rr-quick-notes" className="rr-input" maxLength={4000}
          placeholder="What happened, or what to remember next time" value={note}
          onChange={e => { setNote(e.target.value); onDirty(); }}/>
      </div>
      <details className="rr-fold">
        <summary>Materials Dropped (optional)</summary>
        <div className="rr-quick-supplies">
          {SUPPLIES.map(field => <label key={field.key} className="rr-field">
            <span className="rr-field-label">{field.label} · {packed ? `${remaining[field.key]} available` : 'load not confirmed'}</span>
            <input className="rr-input" type="number" inputMode="numeric" min={0}
              max={packed ? remaining[field.key] : 0} disabled={!packed}
              value={dropped[field.key]}
              onChange={e => { setDropped(prev => ({ ...prev, [field.key]: e.target.value })); onDirty(); }}/>
          </label>)}
        </div>
        {!packed && <p className="rr-sheet-note">Confirm your load in Supplies before entering materials dropped.</p>}
      </details>
      {error && <p className="rr-sheet-error" role="alert">{error}</p>}
    </div>
    <div className="rr-sheet-foot">
      <button className="rr-btn rr-btn-outline" onClick={onClose} disabled={busy}>Cancel</button>
      <button className="rr-btn rr-btn-primary" onClick={() => void save()} disabled={busy || !selected}>
        {busy ? 'Saving…' : 'Save & check off'}<Icon name="check" size={16}/>
      </button>
    </div>
  </>;
}
