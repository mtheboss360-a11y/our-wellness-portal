import { useRouter, useSession } from './lib/session';
import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { login, logout } from './lib/api';
import type { Campaign, PortalSnapshot, PublicPortal } from '../data/portal-data';
import { accumulation, dateLabel, filterLeads, isNew, number, phoneLabel, summarize , monthly, fieldDays } from './lib/portal-math';
import NetworkMap from './NetworkMap';
import Drivers from './Drivers';
import BakeryNetwork from './BakeryNetwork';
import DashboardHome from './Dashboard';
import Overview from './Overview';
import OwnerDashboard from './OwnerDashboard';
import RouteNotes from './RouteNotes';
import OutreachReport from './OutreachReport';
import PageStage from './PageStage';
import { Icon, type IconName } from './Icons';
import AssignedBusinesses from './AssignedBusinesses';
import RoundAgenda from './RoundAgenda';
import VisitHistory from './VisitHistory';
import Performance from './Performance';
import RunnerPortal from './RunnerPortal';



// The logo goes home: the website from the sign-in screen, the report once signed in.
function Brand({ name, centered = false, onHome }: { name: string; centered?: boolean; onHome?: () => void }) {
  const logo = <img src="/assets/owo-logo.png" alt={name} width="1579" height="574"/>;
  return <div className={`brand ${centered ? 'brand-centered' : ''}`}>{onHome
    ? <button type="button" className="brand-home" onClick={onHome} aria-label={`${name}: back to your report`}>{logo}</button>
    : <a className="brand-home" href="https://www.ouroptimization.com" aria-label={`${name}: home`}>{logo}</a>}</div>;
}
export default function Portal() {
  const data = useSession().data!;
  if (!data.clinic) return <SignIn config={data.config}/>;
  // A ROUTE RUNNER LANDS ON THEIR WEEK, not on a dashboard. The role is on the account and the
  // server puts it in the snapshot; an account with no role keeps every screen it had.
  if (data.role === 'route_runner') return <RunnerPortal key={data.clinic.id} data={data}/>;
  return <Dashboard key={data.clinic.id} data={data}/>;
}
function SignIn({ config }: { config: PublicPortal }) {
  const router = useRouter();
  const sample = config.sampleLogin;
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function signIn(credentials: { username: string; password: string }) {
    setBusy(true); setError('');
    try {
      const result = await login({ data: credentials });
      if (!result.ok) setError(result.message);
      else await router.invalidate();
    } catch { setError('We couldn’t sign you in just now. Please try again.'); }
    finally { setBusy(false); }
  }
  async function submit(event: FormEvent) { event.preventDefault(); await signIn({ username: email, password }); }
  return <main className="signin-page">
    <div className="signin-wrap"><Brand name={config.name} centered/>
      <section className="signin-card" aria-labelledby="welcome-title">
        <p className="eyebrow">Client portal</p>
        <h1 id="welcome-title">Welcome back.</h1>
        <form onSubmit={submit}>
          <div className="field"><label htmlFor="username">Username</label><input id="username" name="username" type="text" required autoComplete="username" autoCapitalize="none" spellCheck={false} placeholder="yourclinic" value={email} onChange={event => setEmail(event.target.value)} disabled={busy}/></div>
          <div className="field"><label htmlFor="password">Password</label><input id="password" name="password" type="text" required autoComplete="current-password" spellCheck={false} autoCapitalize="none" placeholder="Your password" value={password} onChange={event => setPassword(event.target.value)} disabled={busy}/></div>
          {error && <p className="form-error" role="alert">{error}</p>}
          <div className="signin-actions">
            <button className="signin-button" type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}{!busy && <Icon name="arrow" size={18}/>}</button>
            {sample && <button className="sample-button" type="button" onClick={() => void signIn(sample)} disabled={busy}>Sample account</button>}
          </div>
        </form>
      </section>
    </div>
  </main>;
}
function Dashboard({ data }: { data: PortalSnapshot }) {
  const router = useRouter();
  // Three screens behind one sign-in: the campaign report, drivers & routes, and the referral network.
  const [view, setView] = useState<'home' | 'agenda' | 'businesses' | 'history' | 'performance' | 'report' | 'drivers' | 'notes' | 'network' | 'bakeries'>('home');
  // Which service this practice buys, read from the account. On the portal-only plan their own
  // staff do the visits, so there are no drivers to introduce and no treats run to arrange.
  const plan = data.clinic?.plan ?? 'a';
  const [campaignId, setCampaignId] = useState(data.campaigns[0]?.id ?? '');
  const [selected, setSelected] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  const campaign = data.campaigns.find(c => c.id === campaignId) ?? { id: 'empty', name: 'Your campaigns', period: '', locations: [], leads: [] };
  // A new section starts at the top of itself. PageStage does it, in a layout effect, so the
  // reset lands before the browser paints rather than a frame after it.

  // Back and Forward move between sections rather than leaving the portal.
  useEffect(() => {
    const open = new URLSearchParams(window.location.search).get('v');
    if (open && open !== view) setView(open as typeof view);
    const onPop = () => {
      const next = new URLSearchParams(window.location.search).get('v');
      setView((next as typeof view) || 'home');
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get('v') === view) return;
    url.searchParams.set('v', view);
    window.history.pushState({ view }, '', url);
  }, [view]);

  useEffect(() => {
    // Re-check a backgrounded session on return rather than leaving cached personal data on screen.
    const refresh = () => { if (document.visibilityState === 'visible') void router.invalidate().catch(() => setError('We couldn’t refresh the report. Please reload the page.')); };
    document.addEventListener('visibilitychange', refresh);
    const interval = window.setInterval(refresh, 60000);
    return () => { document.removeEventListener('visibilitychange', refresh); window.clearInterval(interval); };
  }, [router]);
  async function leave() {
    setSigningOut(true); setError('');
    try { await logout(); router.clearCache(); await router.invalidate(); }
    catch { setError('We couldn’t sign you out. Please try again.'); }
    finally { setSigningOut(false); }
  }
  const tabs: Array<{ id: typeof view; label: string; icon: IconName }> = [
    { id: 'home', label: 'Dashboard', icon: 'home' },
    ...(plan === 'b' && data.role !== 'owner' ? [{ id: 'agenda' as typeof view, label: "Today's round", icon: 'sunrise' as IconName }] : []),
    ...(plan === 'b' ? [{ id: 'businesses' as typeof view, label: 'Your businesses', icon: 'shop' as IconName }] : []),
    { id: 'report', label: 'Your report', icon: 'chart' },
    { id: 'drivers', label: plan === 'b' ? 'Routes' : 'Drivers & routes', icon: 'route' },
    ...(plan === 'b' ? [{ id: 'history' as typeof view, label: 'Visit history', icon: 'clock' as IconName }] : []),
    ...(plan === 'b' ? [{ id: 'performance' as typeof view, label: 'Performance', icon: 'trophy' as IconName }] : []),
    ...(plan === 'b' && data.role !== 'owner' ? [{ id: 'notes' as typeof view, label: 'Route notes', icon: 'notebook' as IconName }] : []),
    { id: 'network', label: 'Referral network', icon: 'pin' },
    ...(plan === 'a' ? [{ id: 'bakeries' as typeof view, label: 'Bakery network', icon: 'cake' as IconName }] : []),
  ];
  return <div className={`portal-page portal-shell ${plan === 'b' ? 'plan-b' : ''} ${plan === 'b' && view === 'home' && data.role !== 'owner' ? 'is-overview' : ''}`}>
    <a className="skip-link" href="#report">Skip to the page</a>
    {/* The rail. On a phone it lies down under the brand and scrolls sideways. */}
    <aside className="rail">
      <div className="rail-brand"><Brand name={data.config.name} onHome={() => setView('home')}/></div>
      <nav className="rail-nav" aria-label="Your portal">
        {tabs.map(tab => <button key={tab.id}
          className={view === tab.id ? 'is-current' : ''}
          aria-current={view === tab.id ? 'page' : undefined}
          onClick={() => setView(tab.id)}>
          <Icon name={tab.icon} size={18}/><span>{tab.label}</span>
        </button>)}
      </nav>
      <div className="rail-foot">
        <p className="rail-clinic">{data.user?.name ?? data.clinic?.name}</p>
        {data.user?.name && <p className="rail-sub">{data.clinic?.name}</p>}
        <button className="rail-signout" onClick={leave} disabled={signingOut}>
          <Icon name="exit" size={18}/><span>{signingOut ? 'Signing out…' : 'Sign out'}</span>
        </button>
      </div>
    </aside>
    <main id="report" className="report">
      {error && <p className="form-error" role="alert">{error}</p>}
      <PageStage view={view}>
      {view === 'bakeries' && plan !== 'a' ? <DashboardHome clinicName={data.clinic?.name ?? data.config.name} today={data.today} plan={plan} userName={data.user?.name ?? null} onGo={setView}/>
      : view === 'notes' ? (plan === 'b' ? <RouteNotes onClose={() => setView('home')}/> : <DashboardHome clinicName={data.clinic?.name ?? data.config.name} today={data.today} plan={plan} userName={data.user?.name ?? null} onGo={setView}/>)
      : view === 'agenda' ? <RoundAgenda today={data.today} staffName={data.user?.name ?? null} onClose={() => setView('home')}/>
      : view === 'history' ? <VisitHistory onClose={() => setView('home')}/>
      : view === 'performance' ? <Performance today={data.today} staffName={data.user?.name ?? null} onClose={() => setView('home')}/>
      : view === 'businesses' ? <AssignedBusinesses today={data.today} staffName={data.user?.name ?? null} onClose={() => setView('home')}/>
      : view === 'home' ? (plan === 'b'
          ? (data.role === 'owner'
              ? <OwnerDashboard clinicName={data.clinic?.name ?? data.config.name} today={data.today}
                  ownerName={data.user?.name ?? null} onGo={setView}/>
              : <Overview clinicName={data.clinic?.name ?? data.config.name} today={data.today}
                  staffName={data.user?.name ?? null} onGo={setView}/>)
          : <DashboardHome clinicName={data.clinic?.name ?? data.config.name} today={data.today} plan={plan} userName={data.user?.name ?? null} onGo={setView}/>)
      : view === 'bakeries' ? <BakeryNetwork onClose={() => setView('home')}/> : view === 'network' ? <NetworkMap onClose={() => setView('home')}/> : view === 'drivers' ? <Drivers today={data.today} plan={plan} onClose={() => setView('home')}/> : <>
      <OutreachReport campaigns={data.campaigns}/>
      <h1 className="sr-only" id="report-title">Your campaign report</h1>
      <section className="hero"><div className="campaign-line"><p>{data.clinic?.name}<span className="slash">/</span><span>{campaign?.name ?? 'Your campaigns'}</span></p><button className="past-jobs-button" onClick={() => dialog.current?.showModal()}><Icon name="clock" size={18}/> Past jobs</button></div></section>
      {campaign ? <CampaignReport key={campaign.id} campaign={campaign} config={data.config} today={data.today} selected={selected} onSelect={setSelected}/> : <div className="empty-panel"><h2>Your first campaign starts here.</h2><p>No drops have been logged yet. Your report will appear when your campaign is added.</p></div>}
      <MonthByMonth campaigns={data.campaigns} currentId={campaignId} onPick={id => { setCampaignId(id); setSelected(null); }}/>
      </>}
      </PageStage>
      <footer className="report-footer"><p>{data.config.sampleNotice}</p><span>{data.config.name}</span></footer>
    </main>
    <dialog ref={dialog} className="campaign-dialog" onClick={event => { if (event.target === event.currentTarget) dialog.current?.close(); }} aria-labelledby="past-jobs-title">
      <div className="dialog-heading"><div><h2 id="past-jobs-title">Your campaigns</h2><p>Every job, kept in one place.</p></div><button className="dialog-close" aria-label="Close past jobs" onClick={() => dialog.current?.close()}><Icon name="close"/></button></div>
      <div className="campaign-options">{data.campaigns.map(c => <button key={c.id} className={`campaign-option ${c.id === campaignId ? 'is-current' : ''}`} onClick={() => { setCampaignId(c.id); setSelected(null); dialog.current?.close(); }}><span><strong>{c.name}</strong><small>{c.period}</small></span><span className="campaign-count">{c.id === campaignId ? 'Viewing' : `${number(c.locations.reduce((sum, l) => sum + l.flyers, 0))} marketing materials`}<Icon name="arrow" size={18}/></span></button>)}</div>
    </dialog>
  </div>;
}
function MonthByMonth({ campaigns, currentId, onPick }: { campaigns: Campaign[]; currentId: string; onPick: (id: string) => void }) {
  const { rows, best, flyers, leads } = monthly(campaigns);
  if (rows.length < 2) return null;
  return <section className="month-section" aria-labelledby="month-title">
    <div className="section-heading"><h2 id="month-title">Month by month</h2><p className="section-subtitle">Every month of the programme, and what it brought in.</p></div>
    <div className="month-table-wrap" tabIndex={0} role="region" aria-label="Month by month. Scroll horizontally on small screens.">
      <table className="month-table"><thead><tr><th scope="col">Month</th><th scope="col">Field days</th><th scope="col">Marketing materials</th><th scope="col">Leads</th><th scope="col">Response</th></tr></thead>
        <tbody>{rows.map(row => <tr key={row.id} className={row.id === currentId ? 'is-current' : ''}>
          <th scope="row"><button className="month-pick" onClick={() => onPick(row.id)} aria-current={row.id === currentId ? 'true' : undefined}>{row.name}</button></th>
          <td className="num">{number(row.fieldDays)}</td>
          <td className="num">{number(row.flyers)}</td>
          <td className="num"><span className="month-leads"><strong>{number(row.leads)}</strong><span className="month-bar"><span style={{ width: `${row.leads / best * 100}%` }}/></span></span></td>
          <td className="num">{row.response}%</td>
        </tr>)}</tbody>
        <tfoot><tr><th scope="row">All months</th><td className="num">{number(rows.reduce((t, r) => t + r.fieldDays, 0))}</td><td className="num">{number(flyers)}</td><td className="num">{number(leads)}</td><td className="num">{flyers ? (leads / flyers * 100).toFixed(2) : '0.00'}%</td></tr></tfoot>
      </table>
    </div>
    <p className="panel-footnote">Pick a month to see its neighborhoods, drops and leads above.</p>
  </section>;
}
function CampaignReport({ campaign, config, today, selected, onSelect }: { campaign: Campaign; config: PublicPortal; today: string; selected: string | null; onSelect: (id: string | null) => void }) {
  const stats = summarize(campaign);
  const visibleLeads = filterLeads(campaign.leads, selected);
  const selectedLocation = campaign.locations.find(l => l.id === selected);
  const toggle = (id: string) => onSelect(selected === id ? null : id);
  const color = (index: number) => config.palette[index % config.palette.length];
  const sparkline = accumulation(campaign.leads, campaign.locations);
  const tableCount = selectedLocation ? `${number(visibleLeads.length)} from ${selectedLocation.name}` : `${number(campaign.leads.length)} total`;
  return <>
    <section className="stat-grid" aria-label="Your campaign at a glance">
      <article className="stat-card"><div className="stat-icon green"><Icon name="pin" size={23}/></div><h2>Marketing materials dropped</h2><p className="stat-value">{number(stats.flyers)}</p><p className="stat-note">{number(fieldDays(campaign))} field {fieldDays(campaign) === 1 ? 'day' : 'days'} · {number(campaign.locations.length)} {campaign.locations.length === 1 ? 'location' : 'locations'}</p></article>
      <article className="stat-card leads-stat"><div className="stat-icon amber"><Icon name="people" size={23}/></div><h2>Leads collected</h2><p className="stat-value">{number(stats.leadCount)}</p><p className="stat-note rose">{stats.response}% response</p>{sparkline && <svg className="sparkline" viewBox="0 0 300 42" role="img" aria-label={`Leads accumulated from zero to ${stats.leadCount} over this campaign`} preserveAspectRatio="none"><polyline fill="none" stroke="#BD7189" strokeWidth="2" points={sparkline} vectorEffect="non-scaling-stroke"/><circle cx="300" cy="5" r="3" fill="#BD7189"/></svg>}</article>
      <article className="stat-card"><div className="stat-icon pink"><Icon name="trophy" size={23}/></div><h2>Top location</h2><p className={`stat-value ${stats.top ? 'stat-town' : ''}`}>{stats.top?.area ?? '0'}</p><p className="stat-note">{stats.top ? `${number(stats.top.leads)} leads from ${stats.top.name}` : 'No leads collected yet'}</p></article>
    </section>
    <section className="insights-grid" aria-label="Neighborhood results">
      <div className="report-panel ranking-panel"><h2>Leads by neighborhood</h2><p className="section-subtitle">Ranked by how many people responded.</p>
        {!stats.rows.length ? <p className="empty-state">No drops logged yet. Your neighborhoods will appear here after the first drop.</p> : <div className="ranked-list">{stats.ranked.map((location, rank) => <button type="button" key={location.id} className={`ranked-row ${selected === location.id ? 'is-selected' : ''}`} onClick={() => toggle(location.id)} aria-pressed={selected === location.id} aria-controls="leads-table" style={{ '--location-color': color(location.colorIndex) } as CSSProperties}><span className="rank-number">{rank + 1}</span><span className="rank-body"><span className="rank-line"><span className="rank-location"><strong>{location.name}</strong><span>{location.area}</span></span><span className="lead-count"><strong>{number(stats.leadCount ? location.leads : location.flyers)}</strong> {stats.leadCount ? (location.leads === 1 ? 'lead' : 'leads') : 'marketing materials'}</span></span>{stats.leadCount > 0 && <span className="bar-track"><span style={{ width: `${stats.top ? location.leads / stats.top.leads * 100 : 0}%` }}/></span>}</span></button>)}</div>}
        {!!stats.rows.length && <p className="panel-footnote">{stats.leadCount ? 'Select a neighborhood to see its leads below.' : 'Your marketing materials are out. No one has come in yet.'}</p>}
      </div>
      <div className="report-panel share-panel"><h2>Where leads come from</h2><p className="section-subtitle">Share of all {number(stats.leadCount)} {stats.leadCount === 1 ? 'lead' : 'leads'}.</p>
        {stats.leadCount ? <><Donut rows={stats.rows} total={stats.leadCount} palette={config.palette}/><div className="donut-legend">{stats.rows.map(location => <div className="legend-item" key={location.id}><span className="legend-dot" style={{ background: color(location.colorIndex) }}/><span>{location.name}</span><strong>{Math.round(location.leads / stats.leadCount * 100)}%</strong></div>)}</div><p className="rounding-note">Percentages are rounded to the nearest whole number.</p></> : <p className="empty-state">{stats.rows.length ? 'No leads yet. When someone responds, you’ll see which neighborhood brought them here.' : 'No drops logged yet. There’s no lead share to show just yet.'}</p>}
      </div>
    </section>
    <section className="timeline-section"><div className="section-heading"><h2>Drop timeline</h2><p className="section-subtitle">Every drop, in order, with how it performed.</p></div>
      {!stats.rows.length ? <div className="empty-panel">No drops have been logged for this campaign yet.</div> : <ol className="timeline">{[...stats.rows].sort((a, b) => a.dropDate.localeCompare(b.dropDate)).map(location => <li key={location.id} style={{ '--location-color': color(location.colorIndex) } as CSSProperties}><span className="timeline-dot"/><button className={`drop-card ${selected === location.id ? 'is-selected' : ''}`} onClick={() => toggle(location.id)} aria-pressed={selected === location.id} aria-controls="leads-table"><span className="drop-heading"><span><strong>{location.name}</strong><span className="drop-area">{location.area}</span></span><time dateTime={location.dropDate}>{dateLabel(location.dropDate, true)}</time></span><span className="drop-figures"><span><strong>{number(location.flyers)}</strong> marketing materials</span><span><strong>{number(location.leads)}</strong> {location.leads === 1 ? 'lead' : 'leads'}</span></span></button></li>)}</ol>}
    </section>
    <section className="leads-section" id="leads-table" aria-labelledby="leads-title"><div className="leads-heading"><div><h2 id="leads-title">Your leads</h2><p className="table-count" aria-live="polite">{tableCount}</p></div><div className="table-controls">{selected && <button className="clear-filter" onClick={() => onSelect(null)}>Clear filter <Icon name="close" size={14}/></button>}<label className="sr-only" htmlFor="location-filter">Filter leads by neighborhood</label><select id="location-filter" value={selected ?? ''} onChange={event => onSelect(event.target.value || null)}><option value="">All neighborhoods</option>{campaign.locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</select></div></div>
      <div className="table-overflow" tabIndex={0} role="region" aria-label="Leads table. Scroll horizontally on small screens."><table><thead><tr>{['Name', 'Phone', 'Email', 'Service', 'Location', 'Received'].map(label => <th scope="col" key={label}>{label}</th>)}</tr></thead><tbody>{visibleLeads.map(lead => {
        const location = stats.rows.find(l => l.id === lead.locationId);
        return <tr key={lead.id}><td><span className="lead-name">{lead.name}</span>{isNew(lead.receivedDate, today) && <span className="new-badge">New</span>}</td><td><a className="phone" href={`tel:${lead.phone}`}>{phoneLabel(lead.phone)}</a></td><td><a className="email" href={`mailto:${lead.email}`}>{lead.email}</a></td><td><span className="service-cell">{lead.service}</span></td><td><span className="location-pill" style={{ '--location-color': location ? color(location.colorIndex) : config.palette[0] } as CSSProperties}>{location?.name ?? 'Unassigned'}</span></td><td><time dateTime={lead.receivedDate}>{dateLabel(lead.receivedDate)}</time></td></tr>;
      })}</tbody></table></div>
      {!visibleLeads.length && <div className="table-empty"><Icon name="people" size={27}/><h3>{selected ? 'No leads from this neighborhood yet.' : 'No one has come in yet.'}</h3><p>{stats.rows.length ? 'As people respond to your marketing materials, their details will appear here.' : 'Once your first marketing materials are dropped, responses will appear here.'}</p></div>}
    </section>
  </>;
}
function Donut({ rows, total, palette }: { rows: ReturnType<typeof summarize>['rows']; total: number; palette: string[] }) {
  let offset = 0;
  const circumference = 2 * Math.PI * 78;
  return <div className="donut-wrap"><svg viewBox="0 0 220 220" role="img" aria-label={`Share of ${total} leads: ${rows.map(r => `${r.name}, ${r.leads}`).join('; ')}`}><g transform="rotate(-90 110 110)">{rows.filter(r => r.leads > 0).map(row => {
    const length = row.leads / total * circumference;
    const start = offset; offset += length;
    return <circle key={row.id} cx="110" cy="110" r="78" fill="none" stroke={palette[row.colorIndex % palette.length]} strokeWidth="33" strokeDasharray={`${Math.max(0, length - 2)} ${circumference - Math.max(0, length - 2)}`} strokeDashoffset={-start}><title>{row.name}: {row.leads} leads</title></circle>;
  })}</g><text x="110" y="109" textAnchor="middle" className="donut-total">{number(total)}</text><text x="110" y="133" textAnchor="middle" className="donut-label">LEADS</text></svg></div>;
}
