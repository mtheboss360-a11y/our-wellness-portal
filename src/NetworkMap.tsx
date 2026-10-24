// THE NETWORK MAP. The client-facing screen: explore the businesses around your clinic, read
// what the network already knows about each one, and put up to five of them on a route.
//
// WHAT THIS COMPONENT DOES NOT DO. It does not decide a status, a conflict or whether a
// business may be routed to. Those come from the server with every row and are rendered as
// given; the Add button is simply absent where `routable` is false, and the server refuses
// such a stop again when a selection is saved. It also never says a route is scheduled: a new
// request reads "Requested — not scheduled yet" until the team accepts it.
//
// THE PLOT. No Google basemap: the portal's server-side Places key is never sent to a browser
// and no referrer-restricted browser key is configured, so the map is drawn from coordinates —
// the clinic at the centre, distance rings, one circular marker per business, crowded areas
// gathered into clusters. Every business also carries its own Google Maps link, and the route
// opens in Google Maps itself.
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { getNetworkMap, refreshNetworkMap, requestRoute, saveSelection } from './lib/api';
import { Icon, type IconName } from './Icons';
import { dateInputValue, directionsUrl, filterBusinesses, mapsPlaceUrl, milesLabel, townPicks, type Filters, type MapBusiness, type NetworkMapPayload } from './lib/network-math';
import NetworkOrb from './NetworkOrb';


export default function NetworkMap({ onClose }: { onClose: () => void }) {
  const [data, setData] = useState<NetworkMapPayload | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [focus, setFocus] = useState<number | null>(null);
  // The orb always pulses for a moment before the network builds, even when the businesses come back
  // from the cache in a few milliseconds: the search is the part people should see.
  const [warm, setWarm] = useState(false);
  useEffect(() => { const timer = window.setTimeout(() => setWarm(true), 1600); return () => window.clearTimeout(timer); }, []);
  const [filters, setFilters] = useState<Filters>({ query: '', categories: [], withinMiles: 5, onlyRoutable: false });
  const schedule = useRef<HTMLDialogElement>(null);

  const load = useCallback(async () => {
    try {
      const value = await getNetworkMap();
      setData(value);
      setFilters(current => ({ ...current, withinMiles: value.clinic.location?.radiusMiles ?? current.withinMiles }));
      setError('');
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'We couldn’t open your network map.'); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const businesses = data?.businesses ?? [];
  const location = data?.clinic.location ?? null;
  const visible = useMemo(() => filterBusinesses(businesses, filters), [businesses, filters]);
  // The orb's fifteen: the best five matches in each of the three towns with the most businesses we can
  // route to around the clinic. Three towns of five is three routes.
  const groups = useMemo(() => townPicks(businesses), [businesses]);
  const selected = useMemo(() => (data?.selection ?? []).map(id => businesses.find(row => row.placeId === id)).filter(Boolean) as MapBusiness[], [data?.selection, businesses]);
  const detail = open ? businesses.find(row => row.placeId === open) ?? null : null;

  async function commit(placeIds: string[]) {
    if (!data) return;
    setBusy(true); setNotice('');
    try {
      const result = await saveSelection(placeIds);
      setData({ ...data, selection: result.selection });
      if (result.refused.length) setNotice(result.refused[0].reason);
    } catch (failure) { setNotice(failure instanceof Error ? failure.message : 'That change could not be saved.'); }
    finally { setBusy(false); }
  }
  const toggle = (business: MapBusiness) => {
    const current = data?.selection ?? [];
    void commit(current.includes(business.placeId) ? current.filter(id => id !== business.placeId) : [...current, business.placeId]);
  };
  const move = (index: number, by: number) => {
    const next = [...(data?.selection ?? [])];
    const target = index + by;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    void commit(next);
  };
  async function refresh() {
    setBusy(true); setNotice('');
    try { const value = await refreshNetworkMap(); setData(value); setNotice(value.refresh?.detail ?? ''); }
    catch (failure) { setNotice(failure instanceof Error ? failure.message : 'We couldn’t check for new businesses.'); }
    finally { setBusy(false); }
  }

  if (error) return <Shell onClose={onClose}><div className="network-state" role="alert"><h2>We couldn’t open your network map.</h2><p>{error}</p><button className="network-primary" onClick={() => void load()}>Try again</button></div></Shell>;
  if (!data) return <Shell onClose={onClose}><div className="network-orb-panel is-loading"><NetworkOrb loading groups={[]} focus={null} selection={[]} onOpen={() => {}} clinicName="Your clinic"/>
    <p className="network-orb-status" role="status">Finding the businesses that share your clients…</p></div></Shell>;
  if (!location) return <Shell onClose={onClose}><div className="network-state"><Icon name="map" size={30}/><h2>Your map isn’t set up yet.</h2>
    <p>The network map opens on your clinic’s saved location, and we don’t have one on file for {data.clinic.name} yet. Call the team and we’ll add it — the map appears here straight afterwards.</p></div></Shell>;

  const selectionIds = data.selection;
  const atCapacity = selectionIds.length >= data.maxStops;

  return <Shell onClose={onClose} subtitle={location.label}>
    {notice && <p className="network-notice" role="status">{notice}</p>}
    <div className="network-layout">
      <section className="network-map-panel" aria-label="Businesses near your clinic">
        <div className="network-orb-panel">
          {groups.length > 0 && <div className="network-orb-towns" role="group" aria-label="Show on the orb">
            <button type="button" className={`network-chip ${focus === null ? 'is-on' : ''}`} aria-pressed={focus === null} onClick={() => setFocus(null)}>All {groups.reduce((n, g) => n + g.businesses.length, 0)}</button>
            {groups.map((group, i) => <button key={group.town} type="button" className={`network-chip ${focus === i ? 'is-on' : ''}`} aria-pressed={focus === i} onClick={() => setFocus(i)}>{group.town}<small>{group.businesses.length}</small></button>)}
          </div>}
          <NetworkOrb loading={busy || !warm} groups={groups} focus={focus} selection={selectionIds} clinicName={data.clinic.name}
            onOpen={id => { const business = businesses.find(b => b.placeId === id); if (business?.routable) toggle(business); setOpen(id);
              requestAnimationFrame(() => document.getElementById(`biz-${id}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })); }}/>
          {busy || !warm ? <p className="network-orb-status" role="status">Finding the businesses that share your clients…</p>
            : focus !== null && groups[focus]
              ? <div className="network-orb-action"><button type="button" className="network-primary" disabled={busy} onClick={() => void commit(groups[focus].businesses.map(b => b.placeId).slice(0, data.maxStops))}>
                  <Icon name="route" size={16}/> Put these {Math.min(data.maxStops, groups[focus].businesses.length)} on your route</button></div>
              : groups.length > 0 && <p className="network-orb-status">{groups.reduce((n, g) => n + g.businesses.length, 0)} businesses across {groups.length} {groups.length === 1 ? 'town' : 'towns'}: {groups.length === 1 ? 'one route' : `${groups.length} routes`} of five. Pick a town to put its five on your route.</p>}
        </div>
        <div className="network-legend">{data.categories.map(category => ({ ...category, shown: visible.filter(business => business.category?.id === category.id).length })).filter(category => category.shown > 0).map(category =>
          <span key={category.id} className="network-legend-item"><span className="network-legend-dot" style={{ background: category.color }}/>{category.label}<small>{category.shown}</small></span>)}
        </div>
        <p className="network-plot-note">Your clinic sits in the middle, with the best five matches in each nearby town around it. The orb is a picture of your network, not a scale map; the list has every real distance and address, and each business carries its own Google Maps link.</p>
      </section>

      <div className="network-side">
      <section className="network-list-panel" aria-label="Nearby business list">
        <div className="network-filters">
          <div className="network-search"><Icon name="search" size={17}/>
            <label className="sr-only" htmlFor="network-search">Search nearby businesses</label>
            <input id="network-search" type="search" placeholder="Search by name or street" value={filters.query} onChange={event => setFilters({ ...filters, query: event.target.value })}/>
          </div>
          <div className="network-filter-row">
            <label className="sr-only" htmlFor="network-distance">Distance from your clinic</label>
            <select id="network-distance" value={filters.withinMiles} onChange={event => setFilters({ ...filters, withinMiles: Number(event.target.value) })}>
              {[...new Set([...data.distanceFilters, location.radiusMiles])].sort((a, b) => a - b).map(miles => <option key={miles} value={miles}>Within {miles} mi</option>)}
            </select>
            <button type="button" className={`network-chip ${filters.onlyRoutable ? 'is-on' : ''}`} aria-pressed={filters.onlyRoutable} onClick={() => setFilters({ ...filters, onlyRoutable: !filters.onlyRoutable })}>Routable only</button>
          </div>
          <div className="network-chips">{data.categories.map(category => {
            const on = filters.categories.includes(category.id);
            return <button key={category.id} type="button" className={`network-chip ${on ? 'is-on' : ''}`} aria-pressed={on}
              onClick={() => setFilters({ ...filters, categories: on ? filters.categories.filter(id => id !== category.id) : [...filters.categories, category.id] })}
              style={{ '--chip': category.color } as CSSProperties}><Icon name={category.icon as IconName} size={15}/>{category.label}</button>;
          })}</div>
        </div>
        <p className="network-count" aria-live="polite">{visible.length} of {businesses.length} nearby {businesses.length === 1 ? 'business' : 'businesses'}</p>
        {!businesses.length
          ? <EmptyMap data={data} busy={busy} onRefresh={refresh}/>
          : !visible.length
            ? <p className="network-empty">Nothing matches those filters yet. Widen the distance or clear a category.</p>
            : <ul className="network-list">{visible.map(business => <li key={business.placeId} id={`biz-${business.placeId}`}>
                <button type="button" className={`network-row ${open === business.placeId ? 'is-open' : ''} ${selectionIds.includes(business.placeId) ? 'is-chosen' : ''}`}
                  aria-expanded={open === business.placeId} onClick={() => setOpen(open === business.placeId ? null : business.placeId)}
                  style={{ '--marker': business.category?.color ?? '#6B7B70' } as CSSProperties}>
                  <span className="network-row-icon"><Icon name={(business.category?.icon ?? 'info') as IconName} size={17}/></span>
                  <span className="network-row-body">
                    <span className="network-row-head"><strong>{business.name ?? 'Unnamed business'}</strong><span className="network-row-distance">{milesLabel(business.distanceMiles)}</span></span>
                    <span className="network-row-meta">{business.category?.label ?? 'Uncategorised'}{business.address ? ` · ${business.address}` : ''}</span>
                    <span className={`network-status is-${business.status}`}>{business.statusLabel}</span>
                  </span>
                </button>
                {business.routable && <button type="button" className={`network-row-add ${selectionIds.includes(business.placeId) ? 'is-on' : ''}`} disabled={busy || (!selectionIds.includes(business.placeId) && atCapacity)}
                  aria-label={`${selectionIds.includes(business.placeId) ? 'Remove' : 'Add'} ${business.name ?? 'this business'} ${selectionIds.includes(business.placeId) ? 'from' : 'to'} your route`} onClick={() => toggle(business)}>
                  <Icon name={selectionIds.includes(business.placeId) ? 'check' : 'plus'} size={16}/></button>}
                {open === business.placeId && <BusinessCard business={business} chosen={selectionIds.includes(business.placeId)} atCapacity={atCapacity} busy={busy} onToggle={() => toggle(business)}/>}
              </li>)}</ul>}
      </section>
      <RoutePanel data={data} selected={selected} busy={busy} onMove={move} onRemove={business => toggle(business)} onSchedule={() => schedule.current?.showModal()} origin={location}/>
      </div>
    </div>

    <Requests requests={data.requests}/>
    <DataNote data={data} busy={busy} onRefresh={refresh}/>
    <ScheduleDialog ref={schedule} data={data} selected={selected} onDone={value => { setData({ ...data, requests: value.requests, selection: value.selection }); setNotice('Your visit request is with the OUR Optimization team. We’ll confirm a time with you.'); }}/>
  </Shell>;
}

function Shell({ children, onClose, subtitle }: { children: React.ReactNode; onClose: () => void; subtitle?: string }) {
  return <section className="network-page" aria-labelledby="network-title">
    <div className="network-head">
      <div>
        <p className="eyebrow">Referral network</p>
        <h1 id="network-title">Network Map</h1>
        {subtitle && <p className="network-subtitle">{subtitle}</p>}
      </div>
      <button className="network-back" onClick={onClose}><Icon name="back" size={17}/> Back to your report</button>
    </div>
    {children}
  </section>;
}

function BusinessCard({ business, chosen, atCapacity, busy, onToggle }: { business: MapBusiness; chosen: boolean; atCapacity: boolean; busy: boolean; onToggle: () => void }) {
  return <div className="network-card">
    <dl className="network-card-facts">
      {business.address && <><dt>Address</dt><dd>{business.address}</dd></>}
      <dt>Distance</dt><dd>{business.distanceMiles.toFixed(1)} miles from your clinic</dd>
      <dt>Category</dt><dd>{business.category?.label ?? 'No category rule matches this business yet'}</dd>
      {business.rating !== null && <><dt>Google rating</dt><dd>{business.rating.toFixed(1)}{business.reviewCount !== null ? ` from ${business.reviewCount.toLocaleString('en-US')} review${business.reviewCount === 1 ? '' : 's'}` : ''} <span className="network-caveat">Context only — a popular business is not a business that has agreed to anything.</span></dd></>}
    </dl>
    <div className="network-card-block">
      <h3>Why this could share your clientele</h3>
      <p>{business.fit.components[0]?.detail}</p>
      <div className="network-fit" aria-label={`Fit score ${business.fit.score} out of 100`}>
        <span className="network-fit-bar"><span style={{ width: `${business.fit.score}%` }}/></span>
        <strong>{business.fit.score}<small>/100</small></strong>
      </div>
      <ul className="network-fit-parts">{business.fit.components.map(part => <li key={part.label}><span>{part.label}</span><span>{part.points} of {part.outOf}</span></li>)}</ul>
    </div>
    <div className={`network-card-block network-reference is-${business.status}`}>
      <h3>{business.statusLabel}</h3>
      <p>{business.statusReason}</p>
    </div>
    <div className="network-card-actions">
      {business.routable
        ? <button type="button" className={chosen ? 'network-secondary' : 'network-primary'} disabled={busy || (!chosen && atCapacity)} onClick={onToggle}>
            <Icon name={chosen ? 'minus' : 'plus'} size={16}/>{chosen ? 'Remove from route' : atCapacity ? 'Route is full' : 'Add to route'}
          </button>
        : <p className="network-blocked"><Icon name="info" size={15}/> The network doesn’t route your clinic here.</p>}
      <a className="network-link" href={mapsPlaceUrl(business)} target="_blank" rel="noreferrer noopener">Open in Google Maps</a>
    </div>
  </div>;
}

function RoutePanel({ data, selected, busy, onMove, onRemove, onSchedule, origin }:
  { data: NetworkMapPayload; selected: MapBusiness[]; busy: boolean; onMove: (index: number, by: number) => void; onRemove: (business: MapBusiness) => void; onSchedule: () => void; origin: { lat: number; lng: number } }) {
  return <section className="network-route" aria-labelledby="route-title">
    <div className="network-route-head">
      <div><h2 id="route-title">Your route</h2><p className="section-subtitle">Up to {data.maxStops} stops, in the order you put them.</p></div>
      <span className="network-route-count">{selected.length} of {data.maxStops}</span>
    </div>
    {!selected.length
      ? <p className="network-empty">No stops yet. Open a business on the map and add it here.</p>
      : <><ol className="network-stops">{selected.map((business, index) => <li key={business.placeId} style={{ '--marker': business.category?.color ?? '#6B7B70' } as CSSProperties}>
          <span className="network-stop-number">{index + 1}</span>
          <span className="network-stop-body"><strong>{business.name ?? 'Unnamed business'}</strong><span>{business.category?.label ?? 'Uncategorised'}{business.address ? ` · ${business.address}` : ''}</span>
            {business.status === 'review' && <span className="network-status is-review">{business.statusLabel} — we’ll check this one first</span>}</span>
          <span className="network-stop-controls">
            <button type="button" aria-label={`Move ${business.name ?? 'this stop'} earlier`} disabled={busy || index === 0} onClick={() => onMove(index, -1)}><Icon name="up" size={16}/></button>
            <button type="button" aria-label={`Move ${business.name ?? 'this stop'} later`} disabled={busy || index === selected.length - 1} onClick={() => onMove(index, 1)}><Icon name="down" size={16}/></button>
            <button type="button" aria-label={`Remove ${business.name ?? 'this stop'}`} disabled={busy} onClick={() => onRemove(business)}><Icon name="minus" size={16}/></button>
          </span>
        </li>)}</ol>
        <div className="network-route-actions">
          <a className="network-primary" href={directionsUrl(origin, selected)} target="_blank" rel="noreferrer noopener"><Icon name="route" size={17}/> Start route in Google Maps</a>
          <button type="button" className="network-secondary" onClick={onSchedule} disabled={busy}><Icon name="calendar" size={17}/> Ask the team to schedule it</button>
        </div>
        <p className="panel-footnote">Google Maps drives the stops in the order above — it does not reorder them for you.</p></>}
  </section>;
}

function Requests({ requests }: { requests: NetworkMapPayload['requests'] }) {
  if (!requests.length) return null;
  return <section className="network-requests" aria-labelledby="requests-title">
    <div className="section-heading"><h2 id="requests-title">Visit requests</h2><p className="section-subtitle">What you’ve asked for, and where each one stands.</p></div>
    <ul>{requests.map(request => <li key={request.id}>
      <div className="network-request-head"><strong>{request.preferredFrom}{request.preferredTo !== request.preferredFrom ? ` – ${request.preferredTo}` : ''}</strong><span className={`network-status is-request-${request.status}`}>{request.statusLabel}</span></div>
      <p className="network-request-stops">{request.stops.map(stop => stop.name ?? 'A saved stop').join(' · ')}</p>
      <p className="network-request-meta">Asked {request.createdAt.slice(0, 10)} · contact {request.contactName}{request.needsReview ? ' · one stop needs review first' : ''}</p>
      {request.teamNote && <p className="network-request-note">From the team: {request.teamNote}</p>}
    </li>)}</ul>
  </section>;
}

function EmptyMap({ data, busy, onRefresh }: { data: NetworkMapPayload; busy: boolean; onRefresh: () => void }) {
  if (!data.data.placesConfigured) return <div className="network-empty-block"><h3>The map has no businesses yet.</h3>
    <p>Google Places isn’t configured on this server, so nothing nearby has been looked up. Nothing is invented here — the map stays empty until the lookup runs.</p></div>;
  const failed = data.data.lastRefresh?.status === 'failed';
  return <div className="network-empty-block"><h3>{failed ? 'The last lookup didn’t go through.' : 'No nearby businesses saved yet.'}</h3>
    <p>{data.data.lastRefresh?.detail ?? 'Your map fills in the first time it is opened.'}</p>
    <button type="button" className="network-secondary" onClick={onRefresh} disabled={busy}><Icon name="refresh" size={16}/> {busy ? 'Checking…' : 'Check again'}</button></div>;
}

function DataNote({ data, busy, onRefresh }: { data: NetworkMapPayload; busy: boolean; onRefresh: () => void }) {
  const last = data.data.lastRefresh;
  return <p className="network-data-note">
    {last ? `Nearby businesses last checked ${last.at.slice(0, 10)}. ` : 'Nearby businesses have not been checked yet. '}
    Google’s details are held for up to {data.data.retentionDays} days and then looked up again, which is why the map doesn’t search on every visit.
    {data.businesses.length > 0 && <> <button type="button" className="network-inline-button" onClick={onRefresh} disabled={busy}>{busy ? 'Checking…' : 'Check for new businesses'}</button></>}
  </p>;
}

function ScheduleDialog({ ref, data, selected, onDone }: { ref: React.Ref<HTMLDialogElement>; data: NetworkMapPayload; selected: MapBusiness[]; onDone: (value: { requests: NetworkMapPayload['requests']; selection: string[] }) => void }) {
  const today = dateInputValue(new Date());
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [contactName, setContactName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const element = ref as React.RefObject<HTMLDialogElement | null>;
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError('');
    try {
      const result = await requestRoute({ contactName, contactPhone, notes, preferredFrom: from, preferredTo: to });
      onDone({ requests: result.requests, selection: result.selection });
      setContactName(''); setContactPhone(''); setNotes('');
      element.current?.close();
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'That request could not be sent.'); }
    finally { setBusy(false); }
  }
  return <dialog ref={ref} className="campaign-dialog network-dialog" aria-labelledby="schedule-title" onClick={event => { if (event.target === event.currentTarget) element.current?.close(); }}>
    <div className="dialog-heading"><div><h2 id="schedule-title">Ask us to schedule this route</h2><p>{selected.length} {selected.length === 1 ? 'stop' : 'stops'}. We’ll confirm a time with you — nothing is booked until we do.</p></div>
      <button className="dialog-close" aria-label="Close" onClick={() => element.current?.close()} type="button"><Icon name="minus" size={18}/></button></div>
    <form onSubmit={submit}>
      <div className="network-date-row">
        <div className="field"><label htmlFor="route-from">Earliest date</label><input id="route-from" type="date" required min={today} value={from} onChange={event => { setFrom(event.target.value); if (to < event.target.value) setTo(event.target.value); }} disabled={busy}/></div>
        <div className="field"><label htmlFor="route-to">Latest date</label><input id="route-to" type="date" required min={from} value={to} onChange={event => setTo(event.target.value)} disabled={busy}/></div>
      </div>
      <div className="field"><label htmlFor="route-contact">Who should we ask for?</label><input id="route-contact" type="text" required maxLength={120} placeholder="Name at your clinic" value={contactName} onChange={event => setContactName(event.target.value)} disabled={busy}/></div>
      <div className="field"><label htmlFor="route-phone">Phone (optional)</label><input id="route-phone" type="tel" maxLength={40} placeholder="Best number to reach them" value={contactPhone} onChange={event => setContactPhone(event.target.value)} disabled={busy}/></div>
      <div className="field"><label htmlFor="route-notes">Anything we should know? (optional)</label><textarea id="route-notes" rows={3} maxLength={600} value={notes} onChange={event => setNotes(event.target.value)} disabled={busy}/></div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <ol className="network-dialog-stops">{selected.map((business, index) => <li key={business.placeId}>{index + 1}. {business.name ?? 'Unnamed business'}{business.address ? ` — ${business.address}` : ''}</li>)}</ol>
      <button className="signin-button" type="submit" disabled={busy || !selected.length}>{busy ? 'Sending…' : 'Send the request'}</button>
      <p className="network-dialog-note">This sends a request to the OUR Optimization team. It is not a confirmed appointment, and your portal will show it as “Requested” until we accept it.</p>
    </form>
  </dialog>;
}
