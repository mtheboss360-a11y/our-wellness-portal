// THE ROUTE RUNNER'S ACCOUNT. Four places, and no more: their routes, what they have recorded,
// how to get help, and who they are signed in as.
//
// A field rep is not a manager. There is no analytics here, no client list, no referral network
// controls, no billing and no other employee's work — not hidden, absent: the server refuses
// those endpoints for this role (RUNNER_ENDPOINTS in server/http.ts), so this navigation is a
// convenience rather than the thing keeping them out.
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from './lib/session';
import { getRunnerHistory, logout, type Supplies, type Visit } from './lib/api';
import type { PortalSnapshot } from '../data/portal-data';
import { Icon, type IconName } from './Icons';
import MyRoutes from './MyRoutes';
import { isFreshSignIn, endSession, startAt } from './lib/landing';

type View = 'routes' | 'history' | 'help' | 'profile';

const TABS: Array<{ id: View; label: string; icon: IconName }> = [
  { id: 'routes', label: 'My routes', icon: 'route' },
  { id: 'history', label: 'Visit history', icon: 'clock' },
  { id: 'help', label: 'Help & support', icon: 'info' },
  { id: 'profile', label: 'Profile', icon: 'people' },
];

const dayLabel = (iso: string) => new Date(`${iso}T12:00:00Z`)
  .toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });

export default function RunnerPortal({ data }: { data: PortalSnapshot }) {
  const router = useRouter();
  // The place the URL names, read once as the state is created: a link to ?v=history has to open
  // there, and an effect that set it afterwards raced the effect below that writes it back.
  // A fresh sign-in starts on My routes, whatever the last session left in the URL. A refresh
  // or a shared link still opens the section it names.
  const [view, setView] = useState<View>(() => {
    if (isFreshSignIn()) { startAt('routes'); return 'routes'; }
    const open = new URLSearchParams(window.location.search).get('v');
    return TABS.some(tab => tab.id === open) ? open as View : 'routes';
  });
  const [signingOut, setSigningOut] = useState(false);
  const name = data.user?.name ?? '';
  const practice = data.clinic?.name ?? data.config.name;

  // Back and Forward move between the four places rather than leaving the planner.
  useEffect(() => {
    const onPop = () => {
      const next = new URLSearchParams(window.location.search).get('v');
      setView(TABS.some(tab => tab.id === next) ? next as View : 'routes');
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

  async function leave() {
    // The next sign-in starts at its own landing screen, not on this one's last page.
    endSession();
    setSigningOut(true);
    try { await logout(); router.clearCache(); await router.invalidate(); }
    finally { setSigningOut(false); }
  }

  return <div className="rr">
    <a className="rr-sr" href="#rr-main">Skip to the page</a>
    <header className="rr-top">
      <div className="rr-topinner">
        <div className="rr-brand">
          <img className="rr-mark" src="/assets/owo-logo.png" alt="" width="1579" height="574"/>
          <div className="rr-brand-copy">
            <span className="rr-brand-name">Our Wellness Network</span>
            <span className="rr-brand-sub">ROUTE RUNNER</span>
          </div>
        </div>
        <div className="rr-toptools">
          {data.clinic?.demo && <span className="rr-pill"><i/>Illustrative account</span>}
          <button className="rr-btn rr-btn-outline rr-btn-sm" onClick={leave} disabled={signingOut}>
            <Icon name="exit" size={15}/>{signingOut ? 'Signing out…' : 'Sign out'}
          </button>
          <button className="rr-person" onClick={() => setView('profile')}>
            <span className="rr-avatar">{(name || practice).trim().charAt(0).toUpperCase()}</span>
            <span className="rr-person-text"><b>{name || 'Route runner'}</b><small>{practice}</small></span>
          </button>
        </div>
      </div>
      <nav className="rr-nav" aria-label="Your account">
        {TABS.map(tab => <button key={tab.id} className={view === tab.id ? 'is-here' : ''}
          aria-current={view === tab.id ? 'page' : undefined} onClick={() => setView(tab.id)}>
          <Icon name={tab.icon} size={16}/>{tab.label}
        </button>)}
      </nav>
    </header>

    <div id="rr-main">
      {view === 'routes' && <MyRoutes today={data.today}/>}
      {view === 'history' && <History/>}
      {view === 'help' && <Help phone={data.config.supportPhone} dial={data.config.supportDial} practice={practice}/>}
      {view === 'profile' && <Profile name={name} practice={practice} onSignOut={leave} signingOut={signingOut}/>}
    </div>
  </div>;
}

/** Their own work: the visits they recorded, newest first. Saved records only, never a forecast. */
function History() {
  const [data, setData] = useState<{ visits: Visit[]; materials: Record<string, Supplies> } | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(() => {
    setError('');
    return getRunnerHistory().then(setData)
      .catch(e => setError(e instanceof Error ? e.message : 'We couldn’t open your visit history.'));
  }, []);
  useEffect(() => { void load(); }, [load]);

  return <main className="rr-wrap">
    <p className="rr-eyebrow">Field operations / Your record</p>
    <div className="rr-title"><div>
      <h1>Visit history<span>.</span></h1>
      <p>Every visit you have recorded on a route of yours, newest first.</p>
    </div></div>

    {error && <div className="rr-state" role="alert">
      <h2>We couldn’t open your visit history.</h2><p>{error}</p>
      <button className="rr-btn rr-btn-primary" onClick={() => void load()}>Try again</button>
    </div>}
    {!error && !data && <div aria-busy="true"><div className="rr-skel"/><div className="rr-skel rr-skel-big"/></div>}
    {!error && data && (!data.visits.length
      ? <div className="rr-state">
          <h2>Nothing recorded yet.</h2>
          <p>When you finish a visit it appears here — who you spoke to, how it went, and what you
            dropped. Nothing is filled in for you.</p>
        </div>
      : <ol className="rr-history">
          {data.visits.map(visit => {
            const dropped = data.materials[visit.id];
            return <li key={visit.id}>
              <div className="rr-history-top">
                <strong>{visit.businessName}</strong>
                <time dateTime={visit.visitedOn}>{dayLabel(visit.visitedOn)}</time>
              </div>
              <p>{visit.outcomeLabel}
                {visit.spokeWith ? ` · spoke with ${visit.spokeWith}${visit.contactRole ? `, ${visit.contactRole}` : ''}` : ''}
                {visit.materials ? ` · ${visit.materials} materials dropped` : ''}
                {dropped ? ` (${dropped.flyers} flyers, ${dropped.treats} treats, ${dropped.cards} cards)` : ''}
                {visit.edited ? ' · corrected' : ''}</p>
              {visit.note && <p>“{visit.note}”</p>}
              {visit.followUpOn && <p>Follow up on {dayLabel(visit.followUpOn)}.</p>}
            </li>;
          })}
        </ol>)}
    {data && data.visits.length > 0 && <p className="rr-page-note">
      A visit you have recorded is the practice’s record of that conversation. If one needs
      correcting, ask your office — corrections are kept beside the original rather than replacing it.
    </p>}
  </main>;
}

function Help({ phone, dial, practice }: { phone: string; dial: string; practice: string }) {
  return <main className="rr-wrap">
    <p className="rr-eyebrow">Field operations / Help</p>
    <div className="rr-title"><div>
      <h1>Help &amp; support<span>.</span></h1>
      <p>How a day runs, and who to call when something is wrong.</p>
    </div></div>
    <div className="rr-read">
      <h2>Running a route</h2>
      <p>Pick the day in the week strip, check what you are bringing, then open the first stop.
        Each business opens into its brief, its script and the form that records what happened.
        Saving a visit brings you back here with the next stop ready.</p>

      <h3>Changing the order</h3>
      <p>Drag a stop by its handle, or use the up and down buttons beside it. The times are worked
        out again as soon as you move something, and the new order is saved for you. A stop you
        have already finished stays where it happened, and one your office has fixed in place
        cannot move.</p>

      <h3>Pickups</h3>
      <p>Add a pickup for treats, flyers or anything else you collect on the way, give it the
        window it can be collected in, and drag it to where it belongs in the day. If the order
        you have chosen would reach it after it closes, the round details panel says so.</p>

      <h3>Supplies</h3>
      <p>The assigned quantities are your office’s. Confirm what you actually have before you
        record anything dropped — if a box is short, confirm the lower number. What is left is your
        confirmed load, plus anything you picked up, less what you have recorded dropping.</p>

      <h3>What you cannot change here</h3>
      <p>The businesses on a route, the date, and the quantities assigned to it are set by your
        office. The scripts are approved ones. If a route is wrong, call rather than working
        around it.</p>

      <h2>Getting help</h2>
      <dl>
        <dt>Call the team</dt><dd><a href={`tel:${dial}`}>{phone}</a></dd>
        <dt>Your practice</dt><dd>{practice}</dd>
      </dl>
      <p>If the planner will not load, sign out and in again. A visit you were part way through is
        not saved until you tap Save the visit, so finish it before you leave the screen.</p>
    </div>
  </main>;
}

function Profile({ name, practice, onSignOut, signingOut }: {
  name: string; practice: string; onSignOut: () => void; signingOut: boolean;
}) {
  return <main className="rr-wrap">
    <p className="rr-eyebrow">Field operations / Your account</p>
    <div className="rr-title"><div>
      <h1>Profile<span>.</span></h1>
      <p>Who this account belongs to.</p>
    </div></div>
    <div className="rr-read">
      <h2>{name || 'Route runner'}</h2>
      <dl>
        <dt>Name on your visits</dt><dd>{name || 'Not set'}</dd>
        <dt>Practice</dt><dd>{practice}</dd>
        <dt>Account type</dt><dd>Route runner</dd>
      </dl>
      <p>Your name is what appears on every visit you record. To change it, or your password, ask
        your office — neither can be changed from this screen.</p>
      <h3>Signing out</h3>
      <p>Signing out ends this session on this device only.</p>
      <button className="rr-btn rr-btn-dark" onClick={onSignOut} disabled={signingOut}>
        <Icon name="exit" size={16}/>{signingOut ? 'Signing out…' : 'Sign out'}
      </button>
    </div>
  </main>;
}
