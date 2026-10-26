// VISIT HISTORY. Every conversation this practice has recorded, and nothing it has not.
//
// The thing this replaces is a long flat list nobody reads. What makes it useful is narrowing:
// a business, a month, an outcome, a person. All four filter at once, the count says what is
// being shown out of what exists, and the figures underneath are of the filtered set — so
// "how did Alexis do in October at the salons" is four clicks, not a spreadsheet.
//
// Everything here is a saved record. Nothing is derived into a conversion, a revenue figure or
// a percentage of anything that was not counted.
import { useEffect, useMemo, useState } from 'react';
import { getVisits, type Visit } from './lib/api';
import { Icon } from './Icons';

const PAGE = 15;

const monthOf = (iso: string) => iso.slice(0, 7);
const monthLabel = (ym: string) => new Date(`${ym}-01T12:00:00Z`)
  .toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const dayLabel = (iso: string) => new Date(`${iso}T12:00:00Z`)
  .toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });

const TONE: Record<string, string> = {
  'Partnership established': 'good', Interested: 'warn', 'Follow-up required': 'warn',
  'Decision-maker unavailable': 'neutral', 'Materials dropped only': 'neutral',
  'Not interested': 'quiet', 'Business closed': 'quiet',
};

export default function VisitHistory({ onClose }: { onClose: () => void }) {
  const [visits, setVisits] = useState<Visit[] | null>(null);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [business, setBusiness] = useState('all');
  const [month, setMonth] = useState('all');
  const [outcome, setOutcome] = useState('all');
  const [staff, setStaff] = useState('all');
  const [shown, setShown] = useState(PAGE);
  const [open, setOpen] = useState<string | null>(null);

  const load = () => {
    setError('');
    void getVisits().then(r => setVisits(r.visits))
      .catch(e => setError(e instanceof Error ? e.message : 'We couldn’t open your visit history.'));
  };
  useEffect(load, []);

  // Each list is built from what is actually in the records: no filter offers a value that
  // would return nothing.
  const options = useMemo(() => {
    const all = visits ?? [];
    return {
      businesses: [...new Set(all.map(v => v.businessName))].sort(),
      months: [...new Set(all.map(v => monthOf(v.visitedOn)))].sort().reverse(),
      outcomes: [...new Set(all.map(v => v.outcomeLabel))].sort(),
      staff: [...new Set(all.map(v => v.staff).filter(Boolean))].sort(),
    };
  }, [visits]);

  const matching = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (visits ?? []).filter(v =>
      (business === 'all' || v.businessName === business) &&
      (month === 'all' || monthOf(v.visitedOn) === month) &&
      (outcome === 'all' || v.outcomeLabel === outcome) &&
      (staff === 'all' || v.staff === staff) &&
      (!q || v.businessName.toLowerCase().includes(q) || v.note.toLowerCase().includes(q)
        || v.spokeWith.toLowerCase().includes(q) || v.nextAction.toLowerCase().includes(q)));
  }, [visits, query, business, month, outcome, staff]);

  useEffect(() => { setShown(PAGE); }, [query, business, month, outcome, staff]);

  // Of what is on screen, not of everything — a total that ignores the filters is a total
  // nobody asked for.
  const totals = useMemo(() => ({
    visits: matching.length,
    materials: matching.reduce((n, v) => n + v.materials, 0),
    businesses: new Set(matching.map(v => v.businessId)).size,
    followUps: matching.filter(v => v.followUpOn).length,
  }), [matching]);

  const filtered = business !== 'all' || month !== 'all' || outcome !== 'all' || staff !== 'all' || query.trim() !== '';
  const clear = () => { setQuery(''); setBusiness('all'); setMonth('all'); setOutcome('all'); setStaff('all'); };

  return <section className="network-page" aria-labelledby="vh-title">
    <div className="network-head">
      <h1 id="vh-title">Visit history</h1>
      <button className="network-back" onClick={onClose}>Back to your dashboard</button>
    </div>

    {error && <div className="network-state" role="alert">
      <h2>We couldn’t open your visit history.</h2><p>{error}</p>
      <button className="dash-btn" onClick={load}>Try again</button>
    </div>}

    {!error && visits === null && <div className="vh" aria-busy="true">
      <div className="dash-skel dash-skel-line"/>
      {[0, 1, 2, 3].map(n => <div className="dash-skel dash-skel-big" key={n}/>)}
      <p className="sr-only" role="status">Loading your visit history.</p>
    </div>}

    {!error && visits?.length === 0 && <div className="network-state">
      <h2>No visits recorded yet.</h2>
      <p>Every conversation your staff record appears here, with who they spoke to, what was
        dropped and what happens next.</p>
    </div>}

    {!error && visits && visits.length > 0 && <div className="vh">
      <div className="ab-controls">
        <label className="network-search">
          <Icon name="search" size={16}/>
          <input value={query} onChange={e => setQuery(e.target.value)}
            placeholder="Search notes, contacts and businesses" aria-label="Search your visit history"/>
        </label>
        <div className="vh-filters">
          <label>Business
            <select value={business} onChange={e => setBusiness(e.target.value)}>
              <option value="all">All businesses</option>
              {options.businesses.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
          </label>
          <label>Month
            <select value={month} onChange={e => setMonth(e.target.value)}>
              <option value="all">All months</option>
              {options.months.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
            </select>
          </label>
          <label>Outcome
            <select value={outcome} onChange={e => setOutcome(e.target.value)}>
              <option value="all">All outcomes</option>
              {options.outcomes.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          </label>
          {options.staff.length > 1 && <label>Staff
            <select value={staff} onChange={e => setStaff(e.target.value)}>
              <option value="all">Everyone</option>
              {options.staff.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>}
        </div>
      </div>

      <div className="vh-summary">
        <p role="status">
          {filtered ? `${matching.length} of ${visits.length} visits` : `${visits.length} ${visits.length === 1 ? 'visit' : 'visits'}`}
          {filtered && <button className="dash-link" onClick={clear}>Clear filters</button>}
        </p>
        {matching.length > 0 && <dl className="vh-totals">
          <div><dt>Visits</dt><dd>{totals.visits}</dd></div>
          <div><dt>Businesses</dt><dd>{totals.businesses}</dd></div>
          <div><dt>Materials dropped</dt><dd>{totals.materials}</dd></div>
          <div><dt>Follow-ups set</dt><dd>{totals.followUps}</dd></div>
        </dl>}
      </div>

      {matching.length === 0
        ? <p className="dash-empty">No visit matches that. <button className="dash-link" onClick={clear}>Clear the filters</button></p>
        : <>
            <ul className="vh-list">
              {matching.slice(0, shown).map(v => <li key={v.id}>
                <button className={`vh-row ${open === v.id ? 'is-open' : ''}`}
                  aria-expanded={open === v.id}
                  onClick={() => setOpen(open === v.id ? null : v.id)}>
                  <span className="vh-when"><b>{dayLabel(v.visitedOn)}</b></span>
                  <span className="vh-what">
                    <strong>{v.businessName}</strong>
                    <small>{v.spokeWith ? `${v.spokeWith}${v.contactRole ? ` · ${v.contactRole}` : ''}` : 'No contact recorded'}
                      {v.staff ? ` · ${v.staff}` : ''}</small>
                  </span>
                  <span className={`dash-pill dash-pill-${TONE[v.outcomeLabel] ?? 'neutral'}`}>{v.outcomeLabel}</span>
                  <span className="vh-mats">{v.materials ? `${v.materials} dropped` : '—'}</span>
                  <Icon name={open === v.id ? 'up' : 'down'} size={15}/>
                </button>
                {open === v.id && <div className="vh-detail">
                  {v.note ? <p className="vh-note">“{v.note}”</p> : <p className="gv-meta">No notes were written.</p>}
                  <dl className="vh-pairs">
                    {v.nextAction && <div><dt>Next action</dt><dd>{v.nextAction}</dd></div>}
                    {v.followUpOn && <div><dt>Follow up on</dt><dd>{dayLabel(v.followUpOn)}</dd></div>}
                    <div><dt>Materials dropped</dt><dd>{v.materials}</dd></div>
                    {v.edited && <div><dt>Corrected</dt><dd>This record has been edited since it was saved.</dd></div>}
                  </dl>
                </div>}
              </li>)}
            </ul>
            {shown < matching.length && <button className="dash-btn ab-more" onClick={() => setShown(n => n + PAGE)}>
              Show {Math.min(PAGE, matching.length - shown)} more
            </button>}
          </>}
    </div>}
  </section>;
}
