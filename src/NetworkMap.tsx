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
import { getNetworkMap, refreshNetworkMap, requestRoute, saveSelection, setDeviceLocation } from './lib/api';
import { Icon, type IconName } from './Icons';
import { bestFifteen, dateInputValue, milesLabel, townOf, type MapBusiness, type NetworkMapPayload } from './lib/network-math';
import NetworkOrb from './NetworkOrb';


export default function NetworkMap({ onClose }: { onClose: () => void }) {
  const [data, setData] = useState<NetworkMapPayload | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const schedule = useRef<HTMLDialogElement>(null);

  const load = useCallback(async () => {
    try {
      const value = await getNetworkMap();
      setData(value);
      setError('');
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'We couldn’t open your referral network.'); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const businesses = data?.businesses ?? [];
  const location = data?.clinic.location ?? null;
  // The best fifteen, as three fives: the top 5, top 10 and top 15. All of them go on the orb, and the list
  // shows only these: no search, no filters, no browsing every business nearby.
  const groups = useMemo(() => bestFifteen(businesses), [businesses]);
  const selected = useMemo(() => (data?.selection ?? []).map(id => businesses.find(row => row.placeId === id)).filter(Boolean) as MapBusiness[], [data?.selection, businesses]);

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
  async function refresh() {
    setBusy(true); setNotice('');
    try { const value = await refreshNetworkMap(); setData(value); if (value.refresh?.status === 'failed') setNotice(value.refresh.detail); }
    catch (failure) { setNotice(failure instanceof Error ? failure.message : 'We couldn’t check for new businesses.'); }
    finally { setBusy(false); }
  }

  if (error) return <Shell onClose={onClose}><div className="network-state" role="alert"><h2>We couldn’t open your referral network.</h2><p>{error}</p><button className="network-primary" onClick={() => void load()}>Try again</button></div></Shell>;
  if (!data) return <Shell onClose={onClose}><div className="network-locate" aria-busy="true"><p className="network-orb-status" role="status">Opening your referral network…</p></div></Shell>;
  if (!location) return <Shell onClose={onClose}><LocateClinic onDone={value => { setData(value); if (value.refresh?.status === 'failed') setNotice(value.refresh.detail); }}/></Shell>;

  const selectionIds = data.selection;
  const atCapacity = selectionIds.length >= data.maxStops;

  return <Shell onClose={onClose} subtitle={location.label}>
    {notice && <p className="network-notice" role="status">{notice}</p>}
    <div className="network-layout">
      <section className="network-map-panel" aria-label="Your referral network">
        <div className="network-orb-panel">
          <NetworkOrb loading={busy && !groups.length} groups={groups} focus={null} selection={selectionIds} clinicName={data.clinic.name}
            onOpen={id => { const business = businesses.find(b => b.placeId === id); if (business?.routable && (selectionIds.includes(id) || !atCapacity)) toggle(business); }}/>
        </div>
      </section>

      <div className="network-side">
      <section className="network-list-panel" aria-label="Your best fifteen">
        {!groups.length
          ? <EmptyMap data={data} busy={busy} onRefresh={refresh}/>
          : groups.map((group, g) => <div key={group.town} className="network-tier">
              <h2 className="network-tier-title">{group.town}</h2>
              <ul className="network-list">{group.businesses.map((business, i) => { const chosen = selectionIds.includes(business.placeId); return <li key={business.placeId} id={`biz-${business.placeId}`}>
                <div className={`network-row ${chosen ? 'is-chosen' : ''}`} style={{ '--marker': business.category?.color ?? '#6B7B70' } as CSSProperties}>
                  <span className="network-row-rank">{g * 5 + i + 1}</span>
                  <span className="network-row-body">
                    <span className="network-row-head"><strong>{business.name ?? 'Unnamed business'}</strong><span className="network-row-distance">{milesLabel(business.distanceMiles)}</span></span>
                    <span className="network-row-meta">{business.category?.label ?? 'Business'}{townOf(business.address) ? ` · ${townOf(business.address)}` : ''}</span>
                  </span>
                </div>
                <button type="button" className={`network-row-add ${chosen ? 'is-on' : ''}`} disabled={busy || (!chosen && atCapacity)}
                  aria-label={`${chosen ? 'Remove' : 'Add'} ${business.name ?? 'this business'} ${chosen ? 'from' : 'to'} your route`} onClick={() => toggle(business)}>
                  <Icon name={chosen ? 'check' : 'plus'} size={16}/></button>
              </li>; })}</ul>
            </div>)}
      </section>
      <RoutePanel data={data} selected={selected} busy={busy} onRemove={business => toggle(business)} onSchedule={() => schedule.current?.showModal()} origin={location}/>
      </div>
    </div>

    <Requests requests={data.requests}/>
    <ScheduleDialog ref={schedule} data={data} selected={selected} onDone={value => { setData({ ...data, requests: value.requests, selection: value.selection }); setNotice('Sent. We’ll put your route together and confirm a time.'); }}/>
  </Shell>;
}

/**
 * No location saved yet: the clinic can share its device's location once, and the map is built from
 * there. The browser asks for permission; nothing is sent until the clinic agrees. The big orb and one
 * button; the orb stays big while the clinic is found and its best fifteen are looked up.
 */
export function LocateClinic({ onDone }: { onDone: (value: NetworkMapPayload) => void }) {
  const [step, setStep] = useState<'idle' | 'locating' | 'searching'>('idle');
  const [error, setError] = useState('');
  function locate() {
    if (!('geolocation' in navigator)) { setError('This browser can\u2019t share a location. Call the team and we\u2019ll set your clinic\u2019s spot for you.'); return; }
    setError(''); setStep('locating');
    navigator.geolocation.getCurrentPosition(async position => {
      setStep('searching');
      try { onDone(await setDeviceLocation({ lat: position.coords.latitude, lng: position.coords.longitude, accuracy: position.coords.accuracy })); }
      catch (failure) { setError(failure instanceof Error ? failure.message : 'We couldn\u2019t build your map.'); setStep('idle'); }
    }, failure => {
      setError(failure.code === failure.PERMISSION_DENIED ? 'Location is turned off for this site. Allow it in your browser\u2019s settings, or call the team and we\u2019ll set your clinic\u2019s spot for you.' : 'Your device couldn\u2019t find its location just now. Try again in a moment.');
      setStep('idle');
    }, { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
  }
  const working = step !== 'idle';
  return <div className="network-orb-panel network-locate is-big">
    <NetworkOrb loading={working} groups={[]} focus={null} selection={[]} onOpen={() => {}} clinicName="Your clinic"/>
    <div className="network-locate-copy">
      {working && <p className="network-orb-status" role="status">{step === 'locating' ? 'Finding your clinic\u2026' : 'Finding your best fifteen\u2026'}</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      {!working && <button type="button" className="network-primary" onClick={locate}><Icon name="map" size={17}/> Build my network</button>}
    </div>
  </div>;
}

function Shell({ children, onClose, subtitle }: { children: React.ReactNode; onClose: () => void; subtitle?: string }) {
  return <section className="network-page" aria-labelledby="network-title">
    <div className="network-head">
      <div>
        <h1 id="network-title">Referral network</h1>
        {subtitle && <p className="network-subtitle">{subtitle}</p>}
      </div>
      <button className="network-back" onClick={onClose}><Icon name="back" size={17}/> Back to your report</button>
    </div>
    {children}
  </section>;
}

// Pick the spots and send them. The team puts the route together, so there is no ordering here.
function RoutePanel({ data, selected, busy, onRemove, onSchedule }:
  { data: NetworkMapPayload; selected: MapBusiness[]; busy: boolean; onRemove: (business: MapBusiness) => void; onSchedule: () => void; origin: { lat: number; lng: number } }) {
  return <section className="network-route" aria-labelledby="route-title">
    <div className="network-route-head">
      <div><h2 id="route-title">Your route</h2><p className="section-subtitle">Pick up to {data.maxStops}. We put the route together.</p></div>
      <span className="network-route-count">{selected.length} of {data.maxStops}</span>
    </div>
    {!selected.length
      ? <p className="network-empty">No stops yet. Open a business on the map and add it here.</p>
      : <><ul className="network-stops">{selected.map(business => <li key={business.placeId} style={{ '--marker': business.category?.color ?? '#6B7B70' } as CSSProperties}>
          <span className="network-stop-body"><strong>{business.name ?? 'Unnamed business'}</strong><span>{business.category?.label ?? 'Uncategorised'}{business.address ? ` · ${business.address}` : ''}</span>
            {business.status === 'review' && <span className="network-status is-review">{business.statusLabel} — we’ll check this one first</span>}</span>
          <span className="network-stop-controls">
            <button type="button" aria-label={`Remove ${business.name ?? 'this stop'}`} disabled={busy} onClick={() => onRemove(business)}><Icon name="minus" size={16}/></button>
          </span>
        </li>)}</ul>
        <div className="network-route-actions">
          <button type="button" className="network-primary" onClick={onSchedule} disabled={busy}><Icon name="route" size={17}/> Send to our team</button>
        </div></>}
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
    <div className="dialog-heading"><div><h2 id="schedule-title">Send your spots</h2><p>We’ll put the route together and confirm a time.</p></div>
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
      <ul className="network-dialog-stops">{selected.map(business => <li key={business.placeId}>{business.name ?? 'Unnamed business'}</li>)}</ul>
      <button className="signin-button" type="submit" disabled={busy || !selected.length}>{busy ? 'Sending…' : 'Send to our team'}</button>
    </form>
  </dialog>;
}
