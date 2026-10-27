// ASSIGNED BUSINESSES. Everything this practice has been given, and the way into a visit.
//
// The list only ever holds businesses released to the signed-in practice — the server will not
// return another's, so there is nothing here to filter out. What this screen adds is finding
// one quickly: a search, the six relationship stages as filters, and fifteen at a time.
//
// Fifteen is deliberate. A field rep looking for one business does not want a wall of them.
import { useEffect, useMemo, useState } from 'react';
import { getBusinesses, getVisits, type Business, type Visit } from './lib/api';
import { Icon } from './Icons';
import GuidedVisit from './GuidedVisit';

const PAGE = 15;

const dayLabel = (iso: string) => new Date(`${iso}T12:00:00Z`)
  .toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

const STAGES: Array<{ id: Business['stage'] | 'all'; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'new', label: 'New' },
  { id: 'visited', label: 'Visited' },
  { id: 'interested', label: 'Interested' },
  { id: 'partner', label: 'Active partner' },
  { id: 'follow-up', label: 'Follow-up due' },
  { id: 'declined', label: 'Declined' },
];

const TONE: Record<Business['stage'], string> = {
  new: 'neutral', visited: 'neutral', interested: 'warn',
  partner: 'good', 'follow-up': 'warn', declined: 'quiet',
};

const LABEL: Record<Business['stage'], string> = {
  new: 'New · not contacted', visited: 'Visited', interested: 'Interested',
  partner: 'Active partner', 'follow-up': 'Follow-up due', declined: 'Declined',
};

export default function AssignedBusinesses({ today, staffName, onClose }: {
  today: string; staffName?: string | null; onClose: () => void;
}) {
  const [list, setList] = useState<Business[] | null>(null);
  const [visits, setVisits] = useState<Visit[]>([]);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [stage, setStage] = useState<Business['stage'] | 'all'>('all');
  const [shown, setShown] = useState(PAGE);
  const [open, setOpen] = useState<string | null>(null);

  const load = () => {
    setError('');
    void Promise.all([getBusinesses(), getVisits()])
      .then(([b, v]) => { setList(b.businesses); setVisits(v.visits); })
      .catch(e => setError(e instanceof Error ? e.message : 'We couldn’t open your businesses.'));
  };
  useEffect(load, []);

  const matching = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (list ?? []).filter(b =>
      (stage === 'all' || b.stage === stage) &&
      (!q || b.name.toLowerCase().includes(q) || b.category.toLowerCase().includes(q) || b.address.toLowerCase().includes(q)));
  }, [list, query, stage]);

  // A new search starts at the first page of its own results.
  useEffect(() => { setShown(PAGE); }, [query, stage]);

  // The last visit at each business, and what it said to do next. The columns said
  // "Recorded" for everything, which is true and tells nobody anything.
  const latest = useMemo(() => {
    const byBusiness = new Map<string, Visit>();
    for (const visit of [...visits].sort((a, b) => b.visitedOn.localeCompare(a.visitedOn))) {
      if (!byBusiness.has(visit.businessId)) byBusiness.set(visit.businessId, visit);
    }
    return byBusiness;
  }, [visits]);

  // A visit, opened from here, comes back to the list when it is finished.
  if (open) return <section className="network-page">
    <GuidedVisit businessId={open} today={today} staffName={staffName}
      onClose={() => { setOpen(null); load(); }}/>
  </section>;

  return <section className="network-page" aria-labelledby="ab-title">
    <div className="network-head">
      <h1 id="ab-title">Your businesses</h1>
      <button className="network-back" onClick={onClose}>Back to your dashboard</button>
    </div>

    {error && <div className="network-state" role="alert">
      <h2>We couldn’t open your businesses.</h2><p>{error}</p>
      <button className="dash-btn" onClick={load}>Try again</button>
    </div>}

    {!error && list === null && <div className="ab" aria-busy="true">
      <div className="dash-skel dash-skel-line"/>
      {[0, 1, 2, 3, 4].map(n => <div className="dash-skel dash-skel-big" key={n}/>)}
      <p className="sr-only" role="status">Loading your businesses.</p>
    </div>}

    {!error && list?.length === 0 && <div className="network-state">
      <h2>No businesses yet.</h2>
      <p>When a batch is released to your practice it appears here, each with its own brief and script.</p>
    </div>}

    {!error && list && list.length > 0 && <div className="ab">
      <div className="ab-controls">
        <label className="network-search">
          <Icon name="search" size={16}/>
          <input value={query} onChange={e => setQuery(e.target.value)}
            placeholder="Search by name, category or street" aria-label="Search your businesses"/>
        </label>
        <div className="ab-filters" role="group" aria-label="Filter by relationship">
          {STAGES.map(s => {
            const count = s.id === 'all' ? list.length : list.filter(b => b.stage === s.id).length;
            return <button key={s.id} className={stage === s.id ? 'is-picked' : ''}
              aria-pressed={stage === s.id} onClick={() => setStage(s.id)}>
              {s.label}<span>{count}</span>
            </button>;
          })}
        </div>
      </div>

      {list.some(b => b.demo === 1) && <p className="ab-sample-note">
        Businesses marked <span className="sample-tag">Sample</span> are illustrative — invented
        names used to show the portal working. Everything else is a real business released to
        this practice.
      </p>}
      <p className="ab-count" role="status">
        {matching.length === list.length
          ? `${list.length} ${list.length === 1 ? 'business' : 'businesses'}`
          : `${matching.length} of ${list.length}`}
      </p>

      {matching.length === 0
        ? <p className="dash-empty">Nothing matches that. Clear the search or pick another filter.</p>
        : <>
            {/* A table on a desktop, cards on a phone. The same rows either way: the markup
                is one list and the layout changes, so nothing is rendered twice. */}
            <div className="ab-table" role="table" aria-label="Your businesses">
              <div className="ab-head" role="row">
                <span role="columnheader">Business</span>
                <span role="columnheader">Category</span>
                <span role="columnheader">Location</span>
                <span role="columnheader">Status</span>
                <span role="columnheader">Last visit</span>
                <span role="columnheader">Next</span>
                <span role="columnheader" className="sr-only">Action</span>
              </div>
              {matching.slice(0, shown).map(b => <div className="ab-row" role="row" key={b.id}>
                <span className="ab-cell ab-name" role="cell">
                  <strong>{b.name}{b.demo === 1 && <span className="sample-tag">Sample</span>}</strong>
                  {b.talkingPoint && <small>{b.talkingPoint}</small>}
                </span>
                <span className="ab-cell ab-cat" role="cell" data-label="Category">{b.category}</span>
                <span className="ab-cell ab-loc" role="cell" data-label="Location">{b.address}</span>
                <span className="ab-cell ab-status" role="cell" data-label="Status">
                  <span className={`dash-pill dash-pill-${TONE[b.stage]}`}>{LABEL[b.stage]}</span>
                </span>
                <span className="ab-cell ab-last" role="cell" data-label="Last visit">
                  {latest.get(b.id) ? dayLabel(latest.get(b.id)!.visitedOn) : '—'}
                </span>
                <span className="ab-cell ab-next" role="cell" data-label="Next">
                  {latest.get(b.id)?.followUpOn
                    ? `Back ${dayLabel(latest.get(b.id)!.followUpOn!)}`
                    : latest.get(b.id)?.nextAction || (b.stage === 'new' ? 'First visit' : '—')}
                </span>
                <span className="ab-cell ab-act" role="cell">
                  <button className={b.stage === 'new' ? 'gv-go gv-go-small' : 'dash-btn'}
                    onClick={() => setOpen(b.id)}>
                    {b.stage === 'new' ? 'Start visit' : 'Open'}<Icon name="arrow" size={14}/>
                  </button>
                </span>
              </div>)}
            </div>
            {shown < matching.length && <button className="dash-btn ab-more" onClick={() => setShown(n => n + PAGE)}>
              Show {Math.min(PAGE, matching.length - shown)} more
            </button>}
          </>}
    </div>}
  </section>;
}
