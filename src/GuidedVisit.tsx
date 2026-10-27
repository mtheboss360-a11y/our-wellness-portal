// GUIDED VISIT. One business, four steps, on a phone, standing outside the door.
//
//   Brief → Script → Record → Next
//
// The constraint that shaped this screen: the person using it is about to walk into somebody
// else's business and talk to a stranger. They are not browsing. So each step is one thing,
// the next action is always the biggest button on the screen, and nothing asks them to
// remember what they read on the step before — the business name and what they are there for
// stay in the header the whole way through.
//
// Two rules about what it will not do:
//   - It never invents a contact, a history or a reason. Where the record is empty it says so.
//   - It never turns a conversation into a promise. The scripts ask for an introduction and
//     nothing else; no referral, no payment, no claim about anyone's treatment.
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  getBusiness, recordVisit, type Business, type Script, type Visit, type Outcome, type VisitDraft,
} from './lib/api';
import { Icon } from './Icons';

/** Mirrors the server's list. The server is the authority; this is only what to call them. */
const OUTCOMES: Array<{ id: Outcome; label: string; hint: string }> = [
  { id: 'interested', label: 'Interested', hint: 'They want to hear more.' },
  { id: 'partner', label: 'Partnership established', hint: 'They agreed to take part.' },
  { id: 'follow-up', label: 'Follow-up required', hint: 'Come back another day.' },
  { id: 'unavailable', label: 'Decision-maker unavailable', hint: 'The right person was out.' },
  { id: 'materials', label: 'Materials dropped only', hint: 'Left cards, no conversation.' },
  { id: 'declined', label: 'Not interested', hint: 'They said no.' },
  { id: 'closed', label: 'Business closed', hint: 'Gone, or shut for good.' },
];

const directionsTo = (b: Business) => b.lat !== null && b.lng !== null
  ? `https://www.google.com/maps/dir/?api=1&destination=${b.lat},${b.lng}&travelmode=driving`
  : `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(b.address)}&travelmode=driving`;

const dayLabel = (iso: string) => new Date(`${iso}T12:00:00Z`)
  .toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

type Step = 'brief' | 'script' | 'record' | 'done';

export default function GuidedVisit({ businessId, today, staffName, onClose, onNext, nextLabel }: {
  businessId: string;
  today: string;
  staffName?: string | null;
  onClose: () => void;
  /** Where "Continue route" goes. Absent when this business was opened on its own. */
  onNext?: () => void;
  nextLabel?: string;
}) {
  const [data, setData] = useState<{ business: Business; script: Script | null; visits: Visit[] } | null>(null);
  const [error, setError] = useState('');
  const [step, setStep] = useState<Step>('brief');
  const [saved, setSaved] = useState<Visit | null>(null);

  useEffect(() => {
    let live = true;
    setData(null); setError(''); setStep('brief'); setSaved(null);
    void getBusiness(businessId)
      .then(r => { if (live) setData({ business: r.business, script: r.script?.script ?? null, visits: r.visits }); })
      .catch(e => { if (live) setError(e instanceof Error ? e.message : 'We couldn’t open this business.'); });
    return () => { live = false; };
  }, [businessId]);

  // Each step starts at its own top. On a phone the steps are long enough that landing halfway
  // down the next one is disorienting.
  useEffect(() => { window.scrollTo({ top: 0, behavior: 'auto' }); }, [step]);

  if (error) return <section className="network-state" role="alert">
    <h2>We couldn’t open this business.</h2><p>{error}</p>
    <button className="dash-btn" onClick={onClose}>Back</button>
  </section>;

  if (!data) return <section className="gv" aria-busy="true">
    <div className="gv-head"><div className="dash-skel dash-skel-line"/><div className="dash-skel dash-skel-title"/></div>
    <div className="dash-skel dash-skel-big"/>
    <p className="sr-only" role="status">Opening this business.</p>
  </section>;

  const { business, script, visits } = data;

  return <section className="gv" aria-labelledby="gv-title">
    <div className="gv-head">
      <button className="network-back" onClick={onClose}>
        <Icon name="back" size={16}/>Back to the round
      </button>
      <ol className="gv-steps" aria-label="Where you are">
        {(['brief', 'script', 'record'] as Step[]).map((s, i) => <li key={s}
          className={step === s ? 'is-here' : (['brief', 'script', 'record'] as Step[]).indexOf(step) > i || step === 'done' ? 'is-done' : ''}>
          <span>{i + 1}</span>{s === 'brief' ? 'Brief' : s === 'script' ? 'What to say' : 'Record it'}
        </li>)}
      </ol>
    </div>

    <header className="gv-who">
      <h2 id="gv-title">{business.name}{business.demo === 1 && <span className="sample-tag">Sample</span>}</h2>
      <p>{business.category} · {business.address}</p>
      <div className="gv-who-actions">
        <a className="dash-btn" href={directionsTo(business)} target="_blank" rel="noreferrer noopener">
          <Icon name="map" size={15}/>Directions
        </a>
        {business.phone && <a className="dash-btn" href={`tel:${business.phone.replace(/[^\d+]/g, '')}`}>{business.phone}</a>}
        <span className={`gv-stage is-${business.stage}`}>{STAGE_LABEL[business.stage]}</span>
      </div>
    </header>

    {step === 'brief' && <Brief business={business} visits={visits} onNext={() => setStep('script')}/>}
    {step === 'script' && <ScriptView script={script} visits={visits} onBack={() => setStep('brief')} onNext={() => setStep('record')}/>}
    {step === 'record' && <Record business={business} today={today} staffName={staffName}
      onBack={() => setStep('script')}
      onSaved={(visit, moved) => {
        setSaved(visit);
        setData(d => d && { ...d, business: moved, visits: [visit, ...d.visits] });
        setStep('done');
      }}/>}
    {step === 'done' && saved && <Done business={business} visit={saved} onNext={onNext} nextLabel={nextLabel} onClose={onClose}/>}
  </section>;
}

const STAGE_LABEL: Record<Business['stage'], string> = {
  new: 'New · not contacted', visited: 'Visited', interested: 'Interested',
  partner: 'Active partner', 'follow-up': 'Follow-up due', declined: 'Declined',
};

/** STEP 1. Who they are, why them, and everything already on record. */
function Brief({ business, visits, onNext }: { business: Business; visits: Visit[]; onNext: () => void }) {
  const last = visits[0];
  return <>
    {business.demo === 1 && <p className="gv-returning">
      This is an illustrative business. The name is invented and nobody is expecting you —
      it is here to show how a visit is recorded.
    </p>}

    <div className="gv-panel">
      <h3>Why this business</h3>
      <p className="gv-prose">{business.talkingPoint || 'No reason has been recorded for this business yet.'}</p>
      {business.website && <p className="gv-meta">
        <a href={business.website} target="_blank" rel="noreferrer noopener">{business.website.replace(/^https?:\/\//, '')}</a>
      </p>}
    </div>

    <div className="gv-panel">
      <h3>What has happened so far</h3>
      {!visits.length
        ? <p className="gv-empty">Nobody has visited yet. This is the first conversation.</p>
        : <ul className="gv-history">
            {visits.map(v => <li key={v.id}>
              <div className="gv-history-top">
                <strong>{v.outcomeLabel}</strong>
                <time>{dayLabel(v.visitedOn)}</time>
              </div>
              <p className="gv-meta">
                {v.spokeWith ? `Spoke with ${v.spokeWith}${v.contactRole ? ` · ${v.contactRole}` : ''}` : 'No contact recorded'}
                {v.materials ? ` · ${v.materials} materials dropped` : ''}
                {v.staff ? ` · ${v.staff}` : ''}
              </p>
              {v.note && <p className="gv-note">“{v.note}”</p>}
              {v.nextAction && <p className="gv-meta">Next: {v.nextAction}</p>}
            </li>)}
          </ul>}
      {last?.spokeWith && <p className="gv-ask-for">Ask for <strong>{last.spokeWith}</strong>.</p>}
    </div>

    <div className="gv-foot">
      <button className="gv-go" onClick={onNext}>What to say<Icon name="arrow" size={17}/></button>
    </div>
  </>;
}

/** STEP 2. The script, in the order it gets said. */
function ScriptView({ script, visits, onBack, onNext }: {
  script: Script | null; visits: Visit[]; onBack: () => void; onNext: () => void;
}) {
  // A business somebody has already spoken to gets the follow-up opening, not the cold one.
  const returning = visits.length > 0;
  if (!script) return <>
    <div className="gv-panel">
      <h3>No script yet</h3>
      <p className="gv-empty">
        This business has no script on file. Introduce the practice in your own words — who they
        are, where they are, and ask whether the owner or manager has a minute.
      </p>
    </div>
    <div className="gv-foot">
      <button className="dash-btn" onClick={onBack}>Back</button>
      <button className="gv-go" onClick={onNext}>Record the visit<Icon name="arrow" size={17}/></button>
    </div>
  </>;

  return <>
    {returning && <p className="gv-returning">
      You have been here before, so this starts with the follow-up line.
    </p>}

    <div className="gv-panel gv-say">
      <h3>{returning ? 'Opening — returning' : 'Opening'}</h3>
      <p className="gv-quote">{returning ? script.followUp : script.opening}</p>
    </div>

    <div className="gv-panel"><h3>Introducing the practice</h3><p className="gv-prose">{script.introduction}</p></div>
    <div className="gv-panel"><h3>Why it helps them</h3><p className="gv-prose">{script.value}</p></div>
    <div className="gv-panel gv-say"><h3>The ask</h3><p className="gv-quote">{script.ask}</p></div>

    <div className="gv-panel">
      <h3>If they say…</h3>
      <dl className="gv-objections">
        <div><dt>“I’m busy”</dt><dd>{script.objections.busy}</dd></div>
        <div><dt>“Not interested”</dt><dd>{script.objections.notInterested}</dd></div>
        <div><dt>“We already work with someone”</dt><dd>{script.objections.alreadyPartnered}</dd></div>
      </dl>
    </div>

    <div className="gv-panel"><h3>Closing</h3><p className="gv-prose">{script.closing}</p></div>

    <div className="gv-foot">
      <button className="dash-btn" onClick={onBack}>Back</button>
      <button className="gv-go" onClick={onNext}>Record the visit<Icon name="arrow" size={17}/></button>
    </div>
  </>;
}

/** STEP 3. The whole record, on one screen, with one button at the bottom. */
function Record({ business, today, staffName, onBack, onSaved }: {
  business: Business; today: string; staffName?: string | null;
  onBack: () => void; onSaved: (visit: Visit, business: Business) => void;
}) {
  const [spokeWith, setSpokeWith] = useState('');
  const [contactRole, setContactRole] = useState('');
  const [outcome, setOutcome] = useState<Outcome | ''>('');
  const [materials, setMaterials] = useState('');
  const [note, setNote] = useState('');
  const [nextAction, setNextAction] = useState('');
  const [followUpOn, setFollowUpOn] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState('');

  // One id for this submission, made once. A second tap sends the same one, and the server
  // returns the visit it already saved rather than writing another.
  const ref = useRef(`${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`);

  // Outcomes that mean "come back" want a date. Suggesting one beats an empty field somebody
  // skips, and it stays editable.
  const wantsFollowUp = outcome === 'follow-up' || outcome === 'unavailable' || outcome === 'interested';
  useEffect(() => {
    if (!wantsFollowUp || followUpOn) return;
    const d = new Date(`${today}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 14);
    setFollowUpOn(d.toISOString().slice(0, 10));
  }, [wantsFollowUp, followUpOn, today]);

  async function submit() {
    if (!outcome || busy) return;
    setBusy(true); setFailed('');
    const draft: VisitDraft = {
      businessId: business.id, visitedOn: today, spokeWith: spokeWith.trim(),
      contactRole: contactRole.trim(), outcome, materials: Number(materials) || 0,
      note: note.trim(), nextAction: nextAction.trim(),
      followUpOn: wantsFollowUp && followUpOn ? followUpOn : null,
      clientRef: ref.current,
    };
    try { const done = await recordVisit(draft); onSaved(done.visit, done.business); }
    catch (e) {
      // Nothing typed is thrown away. The form stays exactly as it was, and the same clientRef
      // goes with the retry, so a save that actually landed cannot become two visits.
      setFailed(e instanceof Error ? e.message : 'That visit could not be saved. Your answers are still here — try again.');
      setBusy(false);
    }
  }

  return <>
    <div className="gv-panel">
      <h3>Who did you speak with?</h3>
      <div className="gv-pair">
        <label>Name<input value={spokeWith} onChange={e => setSpokeWith(e.target.value)}
          placeholder="Leave blank if nobody" autoComplete="off"/></label>
        <label>Their role<input value={contactRole} onChange={e => setContactRole(e.target.value)}
          placeholder="Owner, manager, front desk" autoComplete="off"/></label>
      </div>
    </div>

    <div className="gv-panel">
      <h3>How did it go?</h3>
      <div className="gv-outcomes" role="radiogroup" aria-label="Outcome">
        {OUTCOMES.map(o => <button key={o.id} type="button" role="radio" aria-checked={outcome === o.id}
          className={outcome === o.id ? 'is-picked' : ''} onClick={() => setOutcome(o.id)}>
          <strong>{o.label}</strong><span>{o.hint}</span>
        </button>)}
      </div>
    </div>

    <div className="gv-panel">
      <h3>Materials dropped</h3>
      <label className="gv-count">How many
        <input type="number" inputMode="numeric" min={0} max={5000} value={materials}
          onChange={e => setMaterials(e.target.value)} placeholder="0"/>
      </label>
      <p className="gv-meta">Leave it at zero if you left nothing.</p>
    </div>

    <div className="gv-panel">
      <h3>Notes</h3>
      <textarea className="notes-field" rows={4} value={note} onChange={e => setNote(e.target.value)}
        placeholder="What was said, and anything worth knowing next time."/>
      <label className="gv-line">Next action
        <input value={nextAction} onChange={e => setNextAction(e.target.value)}
          placeholder="Drop back and ask for the owner" autoComplete="off"/>
      </label>
      {wantsFollowUp && <label className="gv-line">Follow up on
        <input type="date" value={followUpOn} onChange={e => setFollowUpOn(e.target.value)}/>
      </label>}
    </div>

    {failed && <p className="form-error" role="alert">{failed}</p>}

    <div className="gv-foot">
      <button className="dash-btn" onClick={onBack} disabled={busy}>Back</button>
      <button className="gv-go" onClick={submit} disabled={!outcome || busy}>
        {busy ? 'Saving…' : 'Save the visit'}{!busy && <Icon name="check" size={17}/>}
      </button>
    </div>
    {!outcome && <p className="gv-meta gv-centred">Pick an outcome to save.</p>}
    {staffName && <p className="gv-meta gv-centred">Saving as {staffName}.</p>}
  </>;
}

/** STEP 4. Confirmation, then straight on to the next stop. Never back to the dashboard. */
function Done({ business, visit, onNext, nextLabel, onClose }: {
  business: Business; visit: Visit; onNext?: () => void; nextLabel?: string; onClose: () => void;
}) {
  const summary = useMemo(() => [
    visit.spokeWith ? `Spoke with ${visit.spokeWith}` : null,
    visit.materials ? `${visit.materials} materials dropped` : null,
    visit.followUpOn ? `Follow-up ${dayLabel(visit.followUpOn)}` : null,
  ].filter(Boolean) as string[], [visit]);

  return <div className="gv-done" role="status">
    <span className="gv-tick" aria-hidden="true"><Icon name="check" size={26}/></span>
    <h3>{business.name} saved.</h3>
    <p className="gv-done-out">{visit.outcomeLabel}</p>
    {summary.length > 0 && <ul className="gv-done-list">{summary.map(line => <li key={line}>{line}</li>)}</ul>}
    <div className="gv-foot gv-foot-done">
      {onNext
        ? <button className="gv-go" onClick={onNext}>{nextLabel ?? 'Continue route'}<Icon name="arrow" size={17}/></button>
        : <button className="gv-go" onClick={onClose}>Done<Icon name="check" size={17}/></button>}
      {onNext && <button className="dash-btn" onClick={onClose}>Back to the round</button>}
    </div>
  </div>;
}
