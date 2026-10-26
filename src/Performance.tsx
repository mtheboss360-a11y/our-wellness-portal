// PERFORMANCE. What the staff actually did, counted from saved records and from nothing else.
//
// WHAT THIS SCREEN WILL NOT SHOW, and why each is deliberate:
//
//   - No conversions, revenue or appointments. Nothing in this database knows whether anybody
//     booked, so any number here claiming they did would be invented.
//   - No patient information. A field rep's screen has no business holding any.
//   - No percentage of a thing that was not counted. "Response rate" needs a denominator the
//     records do not have.
//   - Nothing from a round that was planned but not done. A booked stop is an intention.
//
// What is left is small and true: visits recorded, businesses reached, materials dropped,
// follow-ups set and kept, and where each relationship has got to.
import { useEffect, useMemo, useState } from 'react';
import { getVisits, getBusinesses, type Visit, type Business } from './lib/api';
import { Icon } from './Icons';

type Span = 'month' | 'quarter' | 'all';

const monthOf = (iso: string) => iso.slice(0, 7);
const monthLabel = (ym: string) => new Date(`${ym}-01T12:00:00Z`)
  .toLocaleDateString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' });
const dayLabel = (iso: string) => new Date(`${iso}T12:00:00Z`)
  .toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

const STAGE_LABEL: Record<Business['stage'], string> = {
  new: 'Not contacted', visited: 'Visited', interested: 'Interested',
  partner: 'Active partner', 'follow-up': 'Follow-up due', declined: 'Declined',
};

const since = (span: Span, today: string) => {
  if (span === 'all') return '0000-00-00';
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - (span === 'month' ? 1 : 3));
  return d.toISOString().slice(0, 10);
};

export default function Performance({ today, staffName, onClose }: {
  today: string; staffName?: string | null; onClose: () => void;
}) {
  const [visits, setVisits] = useState<Visit[] | null>(null);
  const [list, setList] = useState<Business[] | null>(null);
  const [error, setError] = useState('');
  const [span, setSpan] = useState<Span>('quarter');
  const [who, setWho] = useState('all');

  const load = () => {
    setError('');
    void Promise.all([getVisits(), getBusinesses()])
      .then(([v, b]) => { setVisits(v.visits); setList(b.businesses); })
      .catch(e => setError(e instanceof Error ? e.message : 'We couldn’t open your performance.'));
  };
  useEffect(load, []);

  const people = useMemo(() => [...new Set((visits ?? []).map(v => v.staff).filter(Boolean))].sort(), [visits]);

  const inSpan = useMemo(() => {
    const from = since(span, today);
    return (visits ?? []).filter(v => v.visitedOn >= from && (who === 'all' || v.staff === who));
  }, [visits, span, who, today]);

  const figures = useMemo(() => {
    const reached = new Set(inSpan.map(v => v.businessId));
    const followUpsSet = inSpan.filter(v => v.followUpOn);
    // A follow-up is "kept" when a later visit happened at that business on or after the date
    // somebody said they would come back. Counted from the records, not from a status field.
    const kept = followUpsSet.filter(f =>
      (visits ?? []).some(v => v.businessId === f.businessId && v.id !== f.id && v.visitedOn >= f.followUpOn!));
    return {
      visits: inSpan.length,
      reached: reached.size,
      materials: inSpan.reduce((n, v) => n + v.materials, 0),
      conversations: inSpan.filter(v => v.spokeWith.trim() !== '').length,
      followUpsSet: followUpsSet.length,
      followUpsKept: kept.length,
      due: followUpsSet.filter(f => f.followUpOn! <= today && !kept.includes(f)),
    };
  }, [inSpan, visits, today]);

  const byMonth = useMemo(() => {
    const months = new Map<string, { visits: number; materials: number }>();
    for (const v of inSpan) {
      const key = monthOf(v.visitedOn);
      const row = months.get(key) ?? { visits: 0, materials: 0 };
      row.visits += 1; row.materials += v.materials;
      months.set(key, row);
    }
    return [...months.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [inSpan]);

  const stages = useMemo(() => {
    const counts = new Map<Business['stage'], number>();
    for (const b of list ?? []) counts.set(b.stage, (counts.get(b.stage) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [list]);

  return <section className="network-page" aria-labelledby="pf-title">
    <div className="network-head">
      <h1 id="pf-title">Performance</h1>
      <button className="network-back" onClick={onClose}>Back to your dashboard</button>
    </div>

    {error && <div className="network-state" role="alert">
      <h2>We couldn’t open your performance.</h2><p>{error}</p>
      <button className="dash-btn" onClick={load}>Try again</button>
    </div>}

    {!error && (visits === null || list === null) && <div className="pf" aria-busy="true">
      <div className="dash-skel dash-skel-line"/><div className="dash-skel dash-skel-big"/>
      <p className="sr-only" role="status">Loading your performance.</p>
    </div>}

    {!error && visits && list && <div className="pf">
      <div className="pf-controls">
        <div className="ab-filters" role="group" aria-label="Period">
          {([['month', 'Last month'], ['quarter', 'Last 3 months'], ['all', 'All time']] as Array<[Span, string]>)
            .map(([id, label]) => <button key={id} className={span === id ? 'is-picked' : ''}
              aria-pressed={span === id} onClick={() => setSpan(id)}>{label}</button>)}
        </div>
        {people.length > 1 && <label className="vh-filters">Staff
          <select value={who} onChange={e => setWho(e.target.value)}>
            <option value="all">Everyone</option>
            {people.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </label>}
      </div>

      {!visits.length
        ? <div className="network-state">
            <h2>Nothing recorded yet.</h2>
            <p>These figures are counted from visits your staff save. None of them is estimated,
              so until the first visit is recorded there is nothing to show.</p>
          </div>
        : <>
            <dl className="pf-figures">
              <Fig value={figures.visits} label="Visits recorded" note={staffName && who !== 'all' ? who : 'All staff'}/>
              <Fig value={figures.reached} label="Businesses reached" note={`of ${list.length} assigned`}/>
              <Fig value={figures.conversations} label="Conversations" note="A person was named"/>
              <Fig value={figures.materials} label="Materials dropped" note="Counted at the stop"/>
            </dl>

            <div className="pf-grid">
              <section className="dash-tile">
                <div className="dash-tile-head"><h3>Visits by month</h3></div>
                {byMonth.length === 0
                  ? <p className="dash-empty">Nothing in this period.</p>
                  : <ul className="pf-bars">
                      {byMonth.map(([ym, row]) => {
                        const most = Math.max(...byMonth.map(([, r]) => r.visits));
                        return <li key={ym}>
                          <span className="pf-bar-label">{monthLabel(ym)}</span>
                          <span className="pf-bar"><i style={{ width: `${Math.round((row.visits / most) * 100)}%` }}/></span>
                          <span className="pf-bar-value">{row.visits} {row.visits === 1 ? 'visit' : 'visits'}</span>
                        </li>;
                      })}
                    </ul>}
                <p className="panel-footnote">Each bar is counted against the tallest month, not a shared scale.</p>
              </section>

              <section className="dash-tile">
                <div className="dash-tile-head"><h3>Where the relationships stand</h3></div>
                {!stages.length
                  ? <p className="dash-empty">No businesses assigned yet.</p>
                  : <ul className="pf-stages">
                      {stages.map(([stage, n]) => <li key={stage}>
                        <span>{STAGE_LABEL[stage]}</span>
                        <span className="pf-bar"><i className={`is-${stage}`} style={{ width: `${Math.round((n / list.length) * 100)}%` }}/></span>
                        <b>{n}</b>
                      </li>)}
                    </ul>}
                <p className="panel-footnote">Every business assigned to this practice, by the last outcome recorded.</p>
              </section>

              <section className="dash-tile">
                <div className="dash-tile-head"><h3>Follow-ups</h3></div>
                <dl className="pf-pairs">
                  <div><dt>Set in this period</dt><dd>{figures.followUpsSet}</dd></div>
                  <div><dt>Gone back since</dt><dd>{figures.followUpsKept}</dd></div>
                </dl>
                {figures.due.length > 0 && <>
                  <p className="dash-tile-note">{figures.due.length} {figures.due.length === 1 ? 'is' : 'are'} due and nobody has been back:</p>
                  <ul className="pf-due">
                    {figures.due.slice(0, 6).map(f => <li key={f.id}>
                      <strong>{f.businessName}</strong><span>since {dayLabel(f.followUpOn!)}</span>
                    </li>)}
                  </ul>
                </>}
                <p className="panel-footnote">A follow-up counts as kept when a later visit is recorded at that business.</p>
              </section>
            </div>

            <p className="pf-basis">
              <Icon name="info" size={15}/>
              Every figure here is counted from visits your staff saved. There is nothing
              estimated, nothing projected, and no appointment or revenue figure — this database
              does not know whether anybody booked, so it does not say.
            </p>
          </>}
    </div>}
  </section>;
}

function Fig({ value, label, note }: { value: number; label: string; note?: string | null }) {
  return <div className="dash-figure">
    <dt>{label}</dt>
    <dd>{value}</dd>
    {note && <p>{note}</p>}
  </div>;
}
