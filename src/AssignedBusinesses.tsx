// ASSIGNED BUSINESSES. Everything this practice has been given, and the way into a visit.
//
// The list only ever holds businesses released to the signed-in practice — the server will not
// return another's, so there is nothing here to filter out. What this screen adds is finding
// one quickly: a search, the six relationship stages as filters, and fifteen at a time.
//
// Fifteen is deliberate. A field rep looking for one business does not want a wall of them.
import { useEffect, useMemo, useState } from 'react';
import { getBusinesses, type Business } from './lib/api';
import { Icon } from './Icons';
import GuidedVisit from './GuidedVisit';

const PAGE = 15;

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
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [stage, setStage] = useState<Business['stage'] | 'all'>('all');
  const [shown, setShown] = useState(PAGE);
  const [open, setOpen] = useState<string | null>(null);

  const load = () => {
    setError('');
    void getBusinesses()
      .then(r => setList(r.businesses))
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

      <p className="ab-count" role="status">
        {matching.length === list.length
          ? `${list.length} ${list.length === 1 ? 'business' : 'businesses'}`
          : `${matching.length} of ${list.length}`}
      </p>

      {matching.length === 0
        ? <p className="dash-empty">Nothing matches that. Clear the search or pick another filter.</p>
        : <>
            <ul className="ab-list">
              {matching.slice(0, shown).map(b => <li key={b.id}>
                <div className="ab-row">
                  <div className="ab-main">
                    <strong>{b.name}</strong>
                    <span>{b.category} · {b.address}</span>
                    {b.talkingPoint && <p className="ab-why">{b.talkingPoint}</p>}
                  </div>
                  <div className="ab-end">
                    <span className={`dash-pill dash-pill-${TONE[b.stage]}`}>{LABEL[b.stage]}</span>
                    <button className="gv-go gv-go-small" onClick={() => setOpen(b.id)}>
                      {b.stage === 'new' ? 'Start visit' : 'Open'}<Icon name="arrow" size={15}/>
                    </button>
                  </div>
                </div>
              </li>)}
            </ul>
            {shown < matching.length && <button className="dash-btn ab-more" onClick={() => setShown(n => n + PAGE)}>
              Show {Math.min(PAGE, matching.length - shown)} more
            </button>}
          </>}
    </div>}
  </section>;
}
