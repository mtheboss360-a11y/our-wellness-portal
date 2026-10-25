// THE BAKERY NETWORK. Where your monthly treats come from: the bakeries in the towns around your clinic,
// on the same orb as your referral network. Local bakeries, plus Panera Bread and Krispy Kreme where
// there's one nearby. Pick one; we bring your treats from there.
import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { chooseBakery, emailFromBrowser, getBakeries, requestItems, type BakeryPayload, type BakeryRow } from './lib/api';
import { dateInputValue } from './lib/network-math';
import { milesLabel } from './lib/network-math';
import { Icon } from './Icons';
import NetworkOrb, { type OrbGroup } from './NetworkOrb';
import { LocateClinic } from './NetworkMap';

const KINDS = [{ kind: 'local', label: 'Local bakery', color: '#C2663C' }, { kind: 'panera', label: 'Panera Bread', color: '#7FA96A' }, { kind: 'krispy-kreme', label: 'Krispy Kreme', color: '#9B3B3B' }] as const;

/** Up to three towns, up to five bakeries each: the best-rated local bakeries first, and Panera or Krispy Kreme when the town has one. */
function byTown(bakeries: BakeryRow[]) {
  const standing = (b: BakeryRow) => (b.rating ?? 4) * Math.min(1, Math.log10((b.reviewCount ?? 0) + 1) / 2) + (b.kind === 'local' ? .3 : 0);
  const towns = new Map<string, BakeryRow[]>();
  for (const b of bakeries) if (b.town) towns.set(b.town, [...(towns.get(b.town) ?? []), b]);
  return [...towns.entries()]
    .map(([town, list]) => ({ town, businesses: [...list].sort((a, b) => standing(b) - standing(a)).slice(0, 5), nearest: Math.min(...list.map(b => b.distanceMiles)), depth: list.length }))
    .sort((a, b) => b.depth - a.depth || a.nearest - b.nearest).slice(0, 3);
}

export default function BakeryNetwork({ onClose }: { onClose: () => void }) {
  const [data, setData] = useState<BakeryPayload | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  // Picking a bakery opens the items form; sending it emails the team.
  const [asking, setAsking] = useState<BakeryRow | null>(null);
  const load = () => getBakeries().then(value => { setData(value); setError(''); }).catch(e => setError(e instanceof Error ? e.message : 'We couldn’t open your bakery network.'));
  useEffect(() => { void load(); }, []);
  const groups = useMemo(() => byTown(data?.bakeries ?? []), [data]);
  const chosen = data?.bakeries.find(b => b.placeId === data.choice) ?? null;
  async function pick(placeId: string | null) {
    setBusy(true);
    try { setData(await chooseBakery(placeId)); } catch (e) { setError(e instanceof Error ? e.message : 'That choice could not be saved.'); }
    finally { setBusy(false); }
  }

  if (error && !data) return <Shell onClose={onClose}><div className="network-state" role="alert"><h2>We couldn’t open your bakery network.</h2><p>{error}</p></div></Shell>;
  if (!data) return <Shell onClose={onClose}><div className="network-locate"><p className="network-orb-status" role="status">Opening your bakery network…</p></div></Shell>;
  if (!data.clinic.location) return <Shell onClose={onClose}><LocateClinic onDone={() => void load()}/></Shell>;

  return <Shell onClose={onClose} subtitle={data.clinic.location.label}>
    {error && <p className="network-notice" role="alert">{error}</p>}
    {notice && <p className="network-notice" role="status">{notice}</p>}
    <div className="network-layout">
      <section className="network-map-panel" aria-label="Bakeries near your clinic">
        <div className="network-orb-panel">
          <NetworkOrb loading={false} groups={groups as OrbGroup[]} focus={null} selection={data.choice ? [data.choice] : []} clinicName={data.clinic.name} onOpen={id => setAsking(data.bakeries.find(b => b.placeId === id) ?? null)}/>
          <div className="bakery-legend">{KINDS.filter(k => data.bakeries.some(b => b.kind === k.kind)).map(k => <span key={k.kind}><i style={{ background: k.color }}/>{k.label}</span>)}</div>
        </div>
      </section>

      <div className="network-side">
        <section className="network-list-panel bakery-list" aria-label="Bakeries by town">
          {!groups.length
            ? <div className="network-empty-block"><h3>No bakeries found nearby yet.</h3>{!data.placesConfigured && <p>The bakery search isn’t switched on for this portal yet.</p>}</div>
            : groups.map(group => <div key={group.town} className="network-tier">
                <h2 className="network-tier-title">{group.town}</h2>
                <ul className="network-list">{group.businesses.map(b => { const on = b.placeId === data.choice; return <li key={b.placeId}>
                  <div className={`network-row ${on ? 'is-chosen' : ''}`} style={{ '--marker': b.category.color } as CSSProperties}>
                    <span className="bakery-dot" style={{ background: b.category.color }}/>
                    <span className="network-row-body">
                      <span className="network-row-head"><strong>{b.name ?? 'Bakery'}</strong><span className="network-row-distance">{milesLabel(b.distanceMiles)}</span></span>
                      <span className="network-row-meta">{b.label}{b.rating !== null ? ` · ${b.rating.toFixed(1)}★` : ''}</span>
                    </span>
                  </div>
                  <button type="button" className={`network-row-add ${on ? 'is-on' : ''}`} disabled={busy} aria-label={on ? `Unchoose ${b.name}` : `Choose ${b.name}`} onClick={() => on ? void pick(null) : setAsking(b)}>
                    <Icon name={on ? 'check' : 'plus'} size={16}/></button>
                </li>; })}</ul>
              </div>)}
        </section>
        <section className="network-route" aria-labelledby="bakery-title">
          <div className="network-route-head"><div><h2 id="bakery-title">Your bakery</h2><p className="section-subtitle">{chosen ? 'We’ll bring your treats from here.' : 'Pick one. We’ll bring your treats from there.'}</p></div></div>
          {chosen && <button type="button" className="network-primary bakery-again" onClick={() => setAsking(chosen)}>Request items</button>}
          {chosen && <div className="bakery-chosen"><span className="bakery-dot" style={{ background: chosen.category.color }}/><span><strong>{chosen.name}</strong><small>{chosen.label}{chosen.town ? ` · ${chosen.town}` : ''}</small></span></div>}
        </section>
      </div>
    </div>
    {asking && <ItemsForm bakery={asking} onClose={() => setAsking(null)} onSent={value => { setData(value); setAsking(null); setNotice(`Sent. We’ll get your items from ${asking.name ?? 'the bakery'}.`); }}/>}
  </Shell>;
}

/** The items request: pops up when a bakery is picked, with one bar at the bottom to send it. */
function ItemsForm({ bakery, onClose, onSent }: { bakery: BakeryRow; onClose: () => void; onSent: (value: BakeryPayload) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const today = dateInputValue(new Date());
  const [form, setForm] = useState({ items: '', people: '', neededBy: today, contactName: '', contactPhone: '', notes: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { dialog.current?.showModal(); }, []);
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) => setForm({ ...form, [key]: event.target.value });
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const result = await requestItems({ placeId: bakery.placeId, ...form, people: Number(form.people) });
      if (result.fallback) await emailFromBrowser(result.fallback);
      onSent(result);
    }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'That request could not be sent.'); }
    finally { setBusy(false); }
  }
  return <dialog ref={dialog} className="campaign-dialog network-dialog items-dialog" aria-labelledby="items-title" onClose={onClose} onClick={event => { if (event.target === event.currentTarget) dialog.current?.close(); }}>
    <div className="dialog-heading"><div><h2 id="items-title">{bakery.name}</h2><p>{bakery.label}{bakery.town ? ` · ${bakery.town}` : ''}</p></div>
      <button className="dialog-close" aria-label="Close" type="button" onClick={() => dialog.current?.close()}><Icon name="minus" size={18}/></button></div>
    <form onSubmit={submit}>
      <div className="field"><label htmlFor="items-what">What should we bring?</label><textarea id="items-what" rows={3} required maxLength={600} placeholder="2 dozen donuts, a dozen muffins" value={form.items} onChange={set('items')} disabled={busy}/></div>
      <div className="network-date-row">
        <div className="field"><label htmlFor="items-people">How many people?</label><input id="items-people" type="number" inputMode="numeric" min={1} max={500} required value={form.people} onChange={set('people')} disabled={busy}/></div>
        <div className="field"><label htmlFor="items-date">Needed by</label><input id="items-date" type="date" required min={today} value={form.neededBy} onChange={set('neededBy')} disabled={busy}/></div>
      </div>
      <div className="network-date-row">
        <div className="field"><label htmlFor="items-name">Your name</label><input id="items-name" type="text" required maxLength={120} value={form.contactName} onChange={set('contactName')} disabled={busy}/></div>
        <div className="field"><label htmlFor="items-phone">Phone (optional)</label><input id="items-phone" type="tel" maxLength={40} value={form.contactPhone} onChange={set('contactPhone')} disabled={busy}/></div>
      </div>
      <div className="field"><label htmlFor="items-notes">Notes (optional)</label><textarea id="items-notes" rows={2} maxLength={600} value={form.notes} onChange={set('notes')} disabled={busy}/></div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="items-submit"><button className="signin-button" type="submit" disabled={busy}>{busy ? 'Sending…' : 'Request items'}</button></div>
    </form>
  </dialog>;
}

function Shell({ children, onClose, subtitle }: { children: React.ReactNode; onClose: () => void; subtitle?: string }) {
  return <section className="network-page" aria-labelledby="bakery-network-title">
    <div className="network-head">
      <div><h1 id="bakery-network-title">Bakery network</h1>{subtitle && <p className="network-subtitle">{subtitle}</p>}</div>
      <button className="network-back" onClick={onClose}><Icon name="back" size={17}/> Back to your report</button>
    </div>
    {children}
  </section>;
}
