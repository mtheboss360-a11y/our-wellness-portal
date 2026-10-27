// THE ROUTE RUNNER'S ACCOUNT. A 56px bar and the planner under it.
//
// Four places, and the bar names three of them; who you are and the way out live behind the
// avatar, so sign out appears once on the screen rather than twice. A field rep is not a
// manager: there is no analytics here, no client list, no referral controls, no other
// employee's work — not hidden, absent. The server refuses those endpoints for this role.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from './lib/session';
import { getRunnerHistory, logout, type Visit } from './lib/api';
import type { PortalSnapshot } from '../data/portal-data';
import { Icon, type IconName } from './Icons';
import MyRoutes from './MyRoutes';
import { isFreshSignIn, endSession, startAt } from './lib/landing';

type View = 'routes' | 'history' | 'help' | 'profile';

const TABS: Array<{ id: View; label: string; icon: IconName }> = [
  { id: 'routes', label: 'My routes', icon: 'route' },
  { id: 'history', label: 'Visit history', icon: 'clock' },
  { id: 'help', label: 'Help', icon: 'info' },
];

const dayLabel = (iso: string) => new Date(`${iso}T12:00:00Z`)
  .toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });

export default function RunnerPortal({ data }: { data: PortalSnapshot }) {
  const router = useRouter();
  const [view, setView] = useState<View>(() => {
    const open = new URLSearchParams(window.location.search).get('v');
    if (isFreshSignIn()) { startAt('routes'); return 'routes'; }
    return [...TABS.map(t => t.id), 'profile'].includes(open ?? '') ? open as View : 'routes';
  });
  const [menu, setMenu] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const name = data.user?.name ?? '';
  const practice = data.clinic?.name ?? data.config.name;

  useEffect(() => {
    const onPop = () => {
      const next = new URLSearchParams(window.location.search).get('v');
      setView([...TABS.map(t => t.id), 'profile'].includes(next ?? '') ? next as View : 'routes');
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get('v') === view) return;
    url.searchParams.set('v', view);
    window.history.pushState({ view }, '', url);
  }, [view]);

  // A session left open in a pocket is re-checked on return rather than left on screen.
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === 'visible') void router.invalidate().catch(() => {}); };
    document.addEventListener('visibilitychange', refresh);
    return () => document.removeEventListener('visibilitychange', refresh);
  }, [router]);

  useEffect(() => {
    if (!menu) return;
    const close = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenu(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [menu]);

  const leave = useCallback(async () => {
    endSession();
    setSigningOut(true);
    try { await logout(); router.clearCache(); await router.invalidate(); }
    finally { setSigningOut(false); }
  }, [router]);

  return <div className="rr">
    <a className="rr-sr" href="#rr-main">Skip to the page</a>
    <header className="rr-top">
      <div className="rr-wordmark">
        <span className="rr-plate">
          <img src="/assets/owo-logo.png" alt="Our Wellness Network" width="1579" height="574"/>
        </span>
        <b>Route runner</b>
      </div>

      <nav className="rr-nav" aria-label="Your account">
        {TABS.map(tab => <button key={tab.id} className={view === tab.id ? 'is-here' : ''}
          aria-current={view === tab.id ? 'page' : undefined} onClick={() => setView(tab.id)}>
          {tab.label}
        </button>)}
      </nav>

      <div className="rr-tools" ref={menuRef} style={{ position: 'relative' }}>
        <button className="rr-btn rr-btn-ghost" aria-haspopup="menu" aria-expanded={menu}
          onClick={() => setMenu(open => !open)} style={{ gap: 8, paddingLeft: 8, paddingRight: 10 }}>
          <span aria-hidden="true" style={{
            width: 26, height: 26, borderRadius: '50%', background: 'var(--gold)',
            color: 'var(--gold-ink)', display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: 12,
          }}>{(name || practice).trim().charAt(0).toUpperCase()}</span>
          <span className="rr-label" style={{ fontSize: 13 }}>{name || 'Account'}</span>
        </button>
        {menu && <div className="rr-menu" role="menu" style={{ top: 44, right: 0, minWidth: 190 }}>
          <button role="menuitem" onClick={() => { setMenu(false); setView('profile'); }}>
            <Icon name="people" size={15}/>Profile
          </button>
          <button role="menuitem" onClick={() => { setMenu(false); void leave(); }} disabled={signingOut}>
            <Icon name="exit" size={15}/>{signingOut ? 'Signing out…' : 'Sign out'}
          </button>
        </div>}
      </div>
    </header>

    <div id="rr-main">
      {view === 'routes' && <MyRoutes today={data.today} timezone={data.timezone ?? 'America/Chicago'}/>}
      {view === 'history' && <History/>}
      {view === 'help' && <Help phone={data.config.supportPhone} dial={data.config.supportDial}/>}
      {view === 'profile' && <Profile name={name} practice={practice} onSignOut={leave} signingOut={signingOut}/>}
    </div>
  </div>;
}

/** Their own work: the visits this login recorded, newest first. Saved records only. */
function History() {
  const [data, setData] = useState<{ visits: Visit[]; rounds: Record<string, string> } | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(() => {
    setError('');
    return getRunnerHistory().then(setData)
      .catch(e => setError(e instanceof Error ? e.message : 'We couldn’t open your visit history.'));
  }, []);
  useEffect(() => { void load(); }, [load]);

  return <main className="rr-main">
    <h1 className="rr-page-title">Visit history</h1>
    {error && <div className="rr-state" role="alert">
      <h2>We couldn’t open your visit history.</h2><p>{error}</p>
      <button className="rr-btn rr-btn-primary" onClick={() => void load()}>Try again</button>
    </div>}
    {!error && !data && <div className="rr-skel" style={{ maxWidth: '46rem', height: 64 }} aria-busy="true"/>}
    {!error && data && (!data.visits.length
      ? <div className="rr-state">
          <h2>Nothing recorded yet.</h2>
          <p>When you finish a visit it appears here — who you spoke to, how it went, what you
            dropped and which route it was on.</p>
        </div>
      : <ol className="rr-list">
          {data.visits.map(visit => {
            const on = visit.roundId ? data.rounds[visit.roundId] : null;
            return <li key={visit.id}>
              <div className="rr-list-top">
                <strong>{visit.businessName}</strong>
                <time dateTime={visit.visitedOn}>{dayLabel(visit.visitedOn)}</time>
              </div>
              <p>{visit.outcomeLabel}{visit.materials ? ` · ${visit.materials} materials dropped` : ''}</p>
              <details className="rr-fold">
                <summary>Details</summary>
                <div className="rr-fold-body">
                  <p>{visit.spokeWith
                    ? `Spoke with ${visit.spokeWith}${visit.contactRole ? `, ${visit.contactRole}` : ''}`
                    : 'No contact recorded.'}</p>
                  {visit.dropped && <p>Materials Dropped: {visit.dropped.flyers} flyers ·
                    {' '}{visit.dropped.treats} treats · {visit.dropped.cards} cards</p>}
                  {on && <p>On your {dayLabel(on)} route.</p>}
                  {visit.note && <p>“{visit.note}”</p>}
                  {visit.followUpOn && <p>Follow up on {dayLabel(visit.followUpOn)}.</p>}
                  {visit.edited && <p>This record has been corrected.</p>}
                </div>
              </details>
            </li>;
          })}
        </ol>)}
  </main>;
}

const TOPICS: Array<{ q: string; a: string }> = [
  { q: 'Running a route', a: 'Pick the day in the week, then open the first stop. Each business opens into its brief and script, and Start visit records what happened. Saving brings you back with the next stop ready.' },
  { q: 'Changing the order', a: 'Drag a stop by its tile, or use Move up and Move down in the card menu. The times are worked out again as soon as you move something, and the new order is saved for you.' },
  { q: 'Pickups', a: 'Add pickup puts a treats or materials stop on the day. Give it the window it can be collected in, drag it where it belongs, and confirm what you actually came away with.' },
  { q: 'Supplies', a: 'The assigned quantities are your office’s. Confirm what you really have before you record anything dropped — if a box is short, confirm the lower number.' },
  { q: 'What you cannot change', a: 'The businesses on a route, its date, the start time and the quantities assigned to it are set by your office. If a route is wrong, call rather than working around it.' },
];

function Help({ phone, dial }: { phone: string; dial: string }) {
  return <main className="rr-main">
    <h1 className="rr-page-title">Help</h1>
    <div className="rr-topics">
      {TOPICS.map(topic => <details className="rr-fold" key={topic.q}>
        <summary>{topic.q}</summary>
        <div className="rr-fold-body"><p>{topic.a}</p></div>
      </details>)}
    </div>
    {dial && <a className="rr-btn rr-btn-outline" href={`tel:${dial}`} style={{ alignSelf: 'flex-start' }}>
      <Icon name="people" size={15}/>Call the team · {phone}
    </a>}
  </main>;
}

function Profile({ name, practice, onSignOut, signingOut }: {
  name: string; practice: string; onSignOut: () => void; signingOut: boolean;
}) {
  return <main className="rr-main">
    <h1 className="rr-page-title">Profile</h1>
    <div className="rr-card-panel">
      <dl className="rr-dl">
        <dt>Name</dt><dd>{name || 'Not set'}</dd>
        <dt>Account</dt><dd>Route runner</dd>
        <dt>Practice</dt><dd>{practice}</dd>
      </dl>
      <p className="rr-sheet-note" style={{ marginTop: 14 }}>
        Your name is what appears on every visit you record. To change it, or your password, ask
        your office.
      </p>
      <button className="rr-btn rr-btn-outline" style={{ marginTop: 14 }}
        onClick={onSignOut} disabled={signingOut}>
        <Icon name="exit" size={15}/>{signingOut ? 'Signing out…' : 'Sign out'}
      </button>
    </div>
  </main>;
}
