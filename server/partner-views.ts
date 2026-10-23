import { esc } from './html';
import type { PartnerSession, Destination } from './partner-store';
// Server-rendered pages for partner businesses. No framework and no build step: a partner opens these from a QR code
// on a phone, often on a slow connection, so each page is one HTML response plus a small stylesheet and script.
// The pages work with JavaScript off; partner.js only adds the copy button, the print button and busy states.

export const SUPPORT = { phone: '(331) 271-6851', dial: '+13312716851' };
type Errors = Partial<Record<string, string>>;
const dateFmt = new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
export const longDate = (day: string) => dateFmt.format(new Date(day + 'T12:00:00Z'));
const monthFmt = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
export const monthName = (month: string) => monthFmt.format(new Date(month + '-15T12:00:00Z'));
const n = (value: number) => value.toLocaleString('en-US');

export function layout(title: string, body: string, options: { session?: PartnerSession; wide?: boolean; bodyClass?: string; visitor?: boolean } = {}) {
  const s = options.session;
  const account = s ? `<nav class="pt-nav" aria-label="Partner"><a href="/partner">Dashboard</a><a href="/partner/report">Monthly report</a><a href="/partner/details">Your details</a>
      <form method="post" action="/partner/sign-out"><input type="hidden" name="csrf" value="${esc(s.csrf)}"><button type="submit" class="pt-link-button">Sign out</button></form></nav>` : '';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta name="theme-color" content="#F3F6F2">
<title>${esc(title)} | Our Wellness Connections</title><link rel="icon" href="/assets/owo-favicon.ico"><link rel="stylesheet" href="/assets/partner.css"><script src="/assets/partner.js" defer></script></head>
<body class="pt ${options.bodyClass ?? ''}"><a class="skip-link" href="#main">Skip to content</a>
<header class="pt-header"><div class="pt-header-row ${options.wide ? 'pt-wide' : ''}">${options.visitor ? '<span class="pt-brand"><img src="/assets/owc-logo.png" alt="Our Wellness Connections" width="360" height="134"></span>' : `<a class="pt-brand" href="${s ? '/partner' : '/partner/sign-in'}"><img src="/assets/owc-logo.png" alt="Our Wellness Connections" width="360" height="134"></a>`}${account}</div></header>
<main id="main" class="pt-main ${options.wide ? 'pt-wide' : ''}" tabindex="-1">${body}</main>
<footer class="pt-foot">${options.visitor ? '<p>Questions about booking? Please contact the clinic directly.</p>' : `<p>Partner portal of Our Wellness Connections. Questions? Call or text <a href="tel:${SUPPORT.dial}">${SUPPORT.phone}</a>.</p>`}</footer>
</body></html>`;
}

function field(name: string, label: string, options: { type?: string; value?: string; errors: Errors; autocomplete?: string; hint?: string; required?: boolean; minlength?: number; maxlength?: number; inputmode?: string }) {
  const error = options.errors[name];
  const ids = [options.hint ? `${name}-hint` : '', error ? `${name}-error` : ''].filter(Boolean).join(' ');
  return `<div class="pt-field${error ? ' has-error' : ''}"><label for="${name}">${esc(label)}</label>
    ${options.hint ? `<p class="pt-hint" id="${name}-hint">${esc(options.hint)}</p>` : ''}
    ${error ? `<p class="pt-error" id="${name}-error">${esc(error)}</p>` : ''}
    <input id="${name}" name="${name}" type="${options.type ?? 'text'}" ${options.value !== undefined ? `value="${esc(options.value)}"` : ''} ${options.autocomplete ? `autocomplete="${options.autocomplete}"` : ''} ${options.inputmode ? `inputmode="${options.inputmode}"` : ''} ${options.required === false ? '' : 'required'} ${options.minlength ? `minlength="${options.minlength}"` : ''} maxlength="${options.maxlength ?? 120}" ${ids ? `aria-describedby="${ids}"` : ''} ${error ? 'aria-invalid="true"' : ''}></div>`;
}
// Each form's summary names fields exactly as their labels do.
const JOIN_LABELS: Record<string, string> = { businessName: 'Business name', contactName: 'Your name', email: 'Work email', password: 'Choose a password', confirm: 'Type the password again', agree: 'Confirmation' };
const DETAIL_LABELS: Record<string, string> = { businessName: 'Business name', contactName: 'Your name' };
const ACCOUNT_LABELS: Record<string, string> = { email: 'Work email', password: 'New password (optional)', confirm: 'Type the new password again', current: 'Current password' };
function errorSummary(errors: Errors, formError: string | undefined, LABELS: Record<string, string>) {
  const items = Object.entries(errors).filter(([, v]) => v);
  if (!items.length && !formError) return '';
  return `<div class="pt-alert pt-alert-error" role="alert" tabindex="-1" data-focus><h2 class="pt-alert-title">${formError ? esc(formError) : 'Please fix the highlighted details.'}</h2>
    ${items.length ? `<ul>${items.map(([k, v]) => `<li><a href="#${k}">${esc(LABELS[k] ?? k)}: ${esc(v)}</a></li>`).join('')}</ul>` : ''}</div>`;
}

// ---------------------------------------------------------------- Joining
export function joinPage(p: { token: string; clinicName: string; businessHint: string | null; values?: Record<string, string>; errors?: Errors; formError?: string }) {
  const v = p.values ?? {}, e = p.errors ?? {};
  const clinic = esc(p.clinicName);
  // LEGAL/PRIVACY REVIEW: the promises below (free, no payment per referral, no referral quota, leave any time) are the
  // terms a partner accepts by joining. Have counsel confirm them, and the courtesy the clinic offers partner staff,
  // against federal and Illinois rules on referral payments for health services before this goes to real partners.
  return layout(`Join ${p.clinicName}'s referral network`, `
  <section class="pt-intro">
    <p class="eyebrow">An invitation from ${clinic}</p>
    <h1>${clinic} invited ${p.businessHint ? esc(p.businessHint) : 'your business'} to join its local referral network.</h1>
    <p class="pt-lede">The network is a small circle of nearby businesses that don&rsquo;t compete with each other and recommend each other to their customers. ${clinic} is at the center of it.</p>
  </section>
  <ul class="pt-points">
    <li><strong>Joining is free.</strong> There is nothing to pay, now or later.</li>
    <li><strong>What you get:</strong> your own referral link and QR code, a printable card for your counter, and a simple page that shows how often your link is used.</li>
    <li><strong>No strings.</strong> Nobody is paid per referral, and you don&rsquo;t promise any number of referrals. You can leave whenever you like.</li>
    <li><strong>Private by design.</strong> You never see who used your link, and other businesses in the network never see your activity.</li>
  </ul>
  <section class="pt-card" aria-labelledby="join-h">
    <h2 id="join-h">Join ${clinic}&rsquo;s network</h2>
    <p class="pt-sub">We only ask for what we need to set up your account.</p>
    ${errorSummary(e, p.formError, JOIN_LABELS)}
    <form method="post" action="/join/${esc(p.token)}" data-busy="Joining&hellip;">
      ${field('businessName', 'Business name', { value: v.businessName ?? p.businessHint ?? '', errors: e, autocomplete: 'organization', minlength: 2 })}
      ${field('contactName', 'Your name', { value: v.contactName, errors: e, autocomplete: 'name', minlength: 2 })}
      ${field('email', 'Work email', { type: 'email', value: v.email, errors: e, autocomplete: 'email', inputmode: 'email', maxlength: 254, hint: 'You will sign in with this email.' })}
      ${field('password', 'Choose a password', { type: 'password', errors: e, autocomplete: 'new-password', minlength: 10, maxlength: 256, hint: 'At least 10 characters.' })}
      ${field('confirm', 'Type the password again', { type: 'password', errors: e, autocomplete: 'new-password', minlength: 10, maxlength: 256 })}
      <div class="pt-check${e.agree ? ' has-error' : ''}">
        ${e.agree ? `<p class="pt-error" id="agree-error">${esc(e.agree)}</p>` : ''}
        <input id="agree" name="agree" type="checkbox" value="yes" required ${v.agree === 'yes' ? 'checked' : ''} ${e.agree ? 'aria-invalid="true" aria-describedby="agree-error"' : ''}>
        <label for="agree">I understand that joining is free, that nobody is paid per referral, and that I&rsquo;m not promising any number of referrals.</label>
      </div>
      <button class="btn btn-primary btn-block" type="submit">Join the network</button>
    </form>
    <p class="pt-aside">Already joined? <a href="/partner/sign-in">Sign in</a></p>
  </section>`);
}
export function joinUnavailable(state: 'missing' | 'expired' | 'used' | 'revoked', clinicName: string | null) {
  const clinic = clinicName ? esc(clinicName) : 'the clinic that invited you';
  const text = {
    missing: `This invitation link isn&rsquo;t valid. Check that the whole link was copied, or ask the clinic that invited you for a new one.`,
    expired: `This invitation from ${clinic} has expired. Ask ${clinic} for a new one.`,
    used: `This invitation has already been used. If your business has joined, sign in to see your link and QR code.`,
    revoked: `${clinic} withdrew this invitation. If you think that&rsquo;s a mistake, ask them about it.`,
  }[state];
  return layout('Invitation unavailable', `<section class="pt-card pt-narrow"><p class="eyebrow">Invitation</p><h1 class="pt-h1-small">This invitation can&rsquo;t be used</h1><p>${text}</p><p class="pt-aside"><a class="btn btn-ghost" href="/partner/sign-in">Partner sign in</a></p></section>`);
}

// ---------------------------------------------------------------- Sign in
export function signInPage(p: { email?: string; error?: string; notice?: string; next?: string }) {
  return layout('Partner sign in', `<section class="pt-card pt-narrow" aria-labelledby="signin-h">
    <p class="eyebrow">Partner portal</p><h1 id="signin-h" class="pt-h1-small">Sign in</h1>
    <p class="pt-sub">See your QR code, your referral link and your activity.</p>
    ${p.notice ? `<div class="pt-alert pt-alert-ok" role="status">${esc(p.notice)}</div>` : ''}
    ${p.error ? `<div class="pt-alert pt-alert-error" role="alert" tabindex="-1" data-focus>${esc(p.error)}</div>` : ''}
    <form method="post" action="/partner/sign-in" data-busy="Signing in&hellip;">
      ${p.next ? `<input type="hidden" name="next" value="${esc(p.next)}">` : ''}
      ${field('email', 'Work email', { type: 'email', value: p.email, errors: {}, autocomplete: 'username', inputmode: 'email', maxlength: 254 })}
      ${field('password', 'Password', { type: 'password', errors: {}, autocomplete: 'current-password', maxlength: 256 })}
      <button class="btn btn-primary btn-block" type="submit">Sign in</button>
    </form>
    <p class="pt-aside">Forgot your password? Call or text <a href="tel:${SUPPORT.dial}">${SUPPORT.phone}</a> and we&rsquo;ll reset it.</p>
    <p class="pt-aside">New partners join through the invitation link their clinic sends.</p>
  </section>`);
}

// ---------------------------------------------------------------- Dashboard
type Outcome = { reported: false; value: null; through: null } | { reported: true; value: number; through: string; covered: number; span: number };
export type DashboardData = { codes: Array<{ code: string; label: string; active: number }>; visits: number; received: Outcome; booked: Outcome; history: Array<{ period: string; code: string; kind: string; n: number }>; destination: Destination };
const KIND: Record<string, string> = { 'visit-qr': 'Visits from the QR code', 'visit-link': 'Visits from the link', received: 'Referrals the clinic recorded (month total)', booked: 'Bookings the clinic reported (month total)' };
const periodLabel = (period: string) => (period.length === 7 ? monthName(period) : longDate(period));
const whereItGoes = (clinic: string, d: Destination) => d === 'booking' ? `${clinic}&rsquo;s booking page` : d === 'phone' ? `a page with ${clinic}&rsquo;s phone number, to call and book` : '';
function outcomeTile(title: string, o: Outcome, clinic: string, id: string) {
  return `<div class="pt-stat" aria-labelledby="${id}"><h3 id="${id}">${title}</h3>
    ${o.reported ? `<p class="pt-stat-value">${n(o.value)}</p><p class="pt-stat-note">Reported by ${clinic} through ${esc(longDate(o.through))}${o.covered < o.span ? ` (${n(o.covered)} of ${n(o.span)} days since you joined)` : ''}.</p>`
      : `<p class="pt-stat-value pt-stat-empty">Not reported yet</p><p class="pt-stat-note">${clinic} hasn&rsquo;t shared this yet. It doesn&rsquo;t mean zero.</p>`}</div>`;
}
export function dashboardPage(s: PartnerSession, d: DashboardData, p: { origin: string; qr: string; welcome: boolean; joinedDay: string; destination: Destination }) {
  const clinic = esc(s.clinicName);
  const primary = d.codes.find(c => c.active) ?? d.codes[0];
  const link = primary ? `${p.origin}/r/${primary.code}` : '';
  const paused = s.status !== 'active' || !primary?.active;
  const history = d.history.length
    ? `<div class="pt-table-wrap" tabindex="0" role="region" aria-label="Activity history table"><table class="pt-table pt-stack"><thead><tr><th scope="col">Date</th><th scope="col">Code</th><th scope="col">What happened</th><th scope="col" class="num">Count</th></tr></thead><tbody>
      ${d.history.map(r => `<tr><td data-label="Date">${esc(periodLabel(r.period))}</td><td data-label="Code"><code>${esc(r.code)}</code></td><td data-label="What happened">${esc(KIND[r.kind] ?? r.kind)}</td><td class="num" data-label="Count">${n(r.n)}</td></tr>`).join('')}
      </tbody></table></div>${d.history.length >= 90 ? '<p class="pt-hint">Showing the 90 most recent rows. The monthly report covers everything.</p>' : ''}`
    : `<div class="pt-empty"><p>Your referral activity will appear here after someone uses your link.</p></div>`;
  return layout('Dashboard', `
  ${p.welcome ? `<div class="pt-alert pt-alert-ok" role="status" tabindex="-1" data-focus><strong>You&rsquo;re in.</strong> Welcome to ${clinic}&rsquo;s network.${p.destination === 'none' ? '' : ' Your link and QR code are ready to share.'}</div>` : ''}
  ${p.destination === 'none' ? `<div class="pt-alert pt-alert-warn" role="status"><strong>Hold off on sharing for now.</strong> ${clinic} hasn&rsquo;t set where your link goes yet, so people who use it won&rsquo;t reach a booking page. We&rsquo;ll let you know when it&rsquo;s ready.</div>` : ''}
  ${paused ? `<div class="pt-alert pt-alert-warn" role="status"><strong>Your link is paused.</strong> ${clinic} has paused your referral link, so people who use it see a &ldquo;not active&rdquo; page. Ask ${clinic} if you have questions.</div>` : ''}
  <section class="pt-intro"><p class="eyebrow">Partner of ${clinic}</p><h1>${esc(s.businessName)}</h1>
    <p class="pt-lede">Connected to <strong>${clinic}</strong> since ${esc(longDate(p.joinedDay))}.</p></section>
  <div class="pt-grid">
    <section class="pt-card pt-share" aria-labelledby="share-h">
      <h2 id="share-h">Your QR code and link</h2>
      ${primary ? `<figure class="pt-qr">${p.qr}<figcaption>Code <code>${esc(primary.code)}</code></figcaption></figure>
      <label class="pt-label" for="ref-link">Your referral link</label>
      <div class="pt-copy"><input id="ref-link" type="text" readonly value="${esc(link)}"><button class="btn" type="button" data-copy="ref-link" hidden>Copy link</button></div>
      <p class="pt-status" role="status" aria-live="polite" data-copy-status></p>
      <div class="pt-actions">
        <a class="btn btn-primary" href="/partner/print">Print a counter card</a>
        <a class="btn btn-ghost" href="/partner/qr.svg" download="referral-qr-${esc(primary.code)}.svg">Download QR (SVG)</a>
        <a class="btn btn-ghost" href="/partner/qr.png" download="referral-qr-${esc(primary.code)}.png">Download QR (PNG)</a>
      </div>
      ${p.destination === 'none' ? '' : `<p class="pt-hint">People who scan the code or tap the link go straight to ${whereItGoes(clinic, p.destination)}. Nothing asks them for personal details on the way.</p>`}` : '<p>Your referral code is being set up. Please refresh in a moment.</p>'}
    </section>
    <section class="pt-card" aria-labelledby="counts-h">
      <h2 id="counts-h">Activity since you joined</h2>
      <div class="pt-stats">
        <div class="pt-stat" aria-labelledby="visits-h"><h3 id="visits-h">Visits through your link or QR code</h3><p class="pt-stat-value">${n(d.visits)}</p><p class="pt-stat-note">Counted by this app, once per browser per day.</p></div>
        ${outcomeTile('Referrals the clinic recorded', d.received, clinic, 'received-h')}
        ${outcomeTile('Bookings the clinic reported', d.booked, clinic, 'booked-h')}
      </div>
      <p class="pt-aside"><a href="/partner/report">See the monthly report</a></p>
    </section>
  </div>
  <section class="pt-card" aria-labelledby="history-h"><h2 id="history-h">Activity history</h2>${history}</section>
  <section class="pt-card" aria-labelledby="meaning-h"><h2 id="meaning-h">What these numbers mean</h2>
    <dl class="pt-defs">
      <dt>Visits through your link or QR code</dt><dd>How many times your link was opened or your QR code was scanned. Each browser counts once a day, so the same person in another browser or app counts again, and link previews in chat apps don&rsquo;t count. A visit is not a person or a patient, and not everyone who visits books.</dd>
      <dt>Referrals the clinic recorded</dt><dd>People who reached ${clinic} through you, as ${clinic} counts them and reports them here. They are shown as monthly totals, and you never see who they are.</dd>
      <dt>Bookings the clinic reported</dt><dd>Appointments ${clinic} says were booked from your referrals. &ldquo;Not reported yet&rdquo; means ${clinic} hasn&rsquo;t shared these numbers; it doesn&rsquo;t mean zero.</dd>
      <dt>What they are not</dt><dd>These numbers aren&rsquo;t a target, and nobody is paid per referral. They show you what your recommendation is doing, nothing more.</dd>
    </dl>
  </section>`, { session: s, wide: true });
}

// ---------------------------------------------------------------- Print card
export function printPage(s: PartnerSession, p: { code: string; link: string; qr: string; destination: Destination; paused: boolean }) {
  return layout('Counter card', `
  ${p.paused ? `<div class="pt-alert pt-alert-warn" role="status"><strong>Your link is paused.</strong> ${esc(s.clinicName)} has paused your referral link, so this card leads to a &ldquo;not active&rdquo; page for now.</div>` : ''}
  ${p.destination === 'none' ? `<div class="pt-alert pt-alert-warn" role="status"><strong>Hold off on printing.</strong> ${esc(s.clinicName)} hasn&rsquo;t set where your link goes yet.</div>` : ''}
  <div class="pt-print-tools"><p>Print this card and keep it by your register, or tape it to your mirror or front desk.</p>
    <p class="pt-actions"><button class="btn btn-primary" type="button" data-print hidden>Print</button><a class="btn btn-ghost" href="/partner">Back to your dashboard</a></p></div>
  <article class="pt-card pt-print-card" aria-label="Counter card">
    <img class="pt-print-logo" src="/assets/owc-logo.png" alt="Our Wellness Connections" width="360" height="134">
    <p class="pt-print-eyebrow">Recommended by ${esc(s.businessName)}</p>
    <h1 class="pt-print-h">${esc(s.clinicName)}</h1>
    <figure class="pt-qr pt-qr-print">${p.qr}</figure>
    <p class="pt-print-cta">${p.destination === 'phone' ? 'Scan to call and book' : 'Scan to book'}</p>
    <p class="pt-print-link">${esc(p.link.replace(/^https?:\/\//, ''))}</p>
  </article>`, { session: s, bodyClass: 'pt-printing' });
}

// ---------------------------------------------------------------- Details
export function detailsPage(s: PartnerSession, p: { values?: Record<string, string>; errors?: Errors; formError?: string; which?: 'details' | 'account'; saved?: 'details' | 'account' }) {
  const v = p.values ?? {}, e = p.errors ?? {};
  const de = p.which === 'details' ? e : {}, ae = p.which === 'account' ? e : {};
  return layout('Your details', `
  <section class="pt-intro"><p class="eyebrow">Your details</p><h1 class="pt-h1-small">Business and contact details</h1>
    <p class="pt-lede">${esc(s.clinicName)} sees these details. Other businesses in the network don&rsquo;t.</p></section>
  ${p.saved ? `<div class="pt-alert pt-alert-ok" role="status" tabindex="-1" data-focus>${p.saved === 'details' ? 'Your business details are saved.' : 'Your sign-in details are saved.'}</div>` : ''}
  <section class="pt-card" aria-labelledby="biz-h"><h2 id="biz-h">Business</h2>
    ${p.which === 'details' ? errorSummary(de, p.formError, DETAIL_LABELS) : ''}
    <form method="post" action="/partner/details" data-busy="Saving&hellip;"><input type="hidden" name="csrf" value="${esc(s.csrf)}">
      ${field('businessName', 'Business name', { value: p.which === 'details' ? v.businessName : s.businessName, errors: de, autocomplete: 'organization', minlength: 2 })}
      ${field('contactName', 'Your name', { value: p.which === 'details' ? v.contactName : s.contactName, errors: de, autocomplete: 'name', minlength: 2 })}
      <button class="btn btn-primary" type="submit">Save business details</button></form></section>
  <section class="pt-card" aria-labelledby="acct-h"><h2 id="acct-h">Sign-in email and password</h2>
    <p class="pt-sub">Enter your current password to change either one.</p>
    ${p.which === 'account' ? errorSummary(ae, p.formError, ACCOUNT_LABELS) : ''}
    <form method="post" action="/partner/account" data-busy="Saving&hellip;"><input type="hidden" name="csrf" value="${esc(s.csrf)}">
      ${field('email', 'Work email', { type: 'email', value: p.which === 'account' ? v.email : s.email, errors: ae, autocomplete: 'username', inputmode: 'email', maxlength: 254 })}
      ${field('password', 'New password (optional)', { type: 'password', errors: ae, autocomplete: 'new-password', minlength: 10, maxlength: 256, required: false, hint: 'Leave blank to keep your password. At least 10 characters.' })}
      ${field('confirm', 'Type the new password again', { type: 'password', errors: ae, autocomplete: 'new-password', maxlength: 256, required: false })}
      ${field('current', 'Current password', { type: 'password', errors: ae, autocomplete: 'current-password', maxlength: 256 })}
      <button class="btn btn-primary" type="submit">Save sign-in details</button></form></section>
  <section class="pt-card" aria-labelledby="leave-h"><h2 id="leave-h">Leaving the network</h2>
    <p class="pt-sub">You can leave whenever you like: tell ${esc(s.clinicName)}, or call or text us at <a href="tel:${SUPPORT.dial}">${SUPPORT.phone}</a>. When you leave, your sign-in and your name are deleted and your link stops working. ${esc(s.clinicName)} keeps your business name and the anonymous counts in its records.</p></section>`, { session: s });
}

// ---------------------------------------------------------------- Monthly report
export type ReportRow = { month: string; code: string; days: number; visits: number; received: number | null; receivedDays: number; booked: number | null; bookedDays: number };
function reportedCell(value: number | null, covered: number, days: number, label: string) {
  if (value === null) return `<td class="num pt-muted" data-label="${label}">Not reported</td>`;
  return `<td class="num" data-label="${label}">${n(value)}${covered < days ? `<span class="pt-cell-note">${n(covered)} of ${n(days)} days reported</span>` : ''}</td>`;
}
export function reportPage(s: PartnerSession, p: { rows: ReportRow[]; from: string; to: string; months: string[]; error?: string }) {
  const options = (selected: string) => p.months.map(m => `<option value="${m}" ${m === selected ? 'selected' : ''}>${esc(monthName(m))}</option>`).join('');
  return layout('Monthly report', `
  <section class="pt-intro"><p class="eyebrow">Monthly report</p><h1 class="pt-h1-small">Your activity by month</h1>
    <p class="pt-lede">Counts for your referral code${p.rows.length && new Set(p.rows.map(r => r.code)).size > 1 ? 's' : ''}, month by month. Each column is counted separately; none of them is an estimate of another.</p></section>
  <section class="pt-card" aria-labelledby="range-h"><h2 id="range-h" class="sr-only">Choose months</h2>
    ${p.error ? `<div class="pt-alert pt-alert-error" role="alert">${esc(p.error)}</div>` : ''}
    <form class="pt-range" method="get" action="/partner/report">
      <div class="pt-field"><label for="from">From</label><select id="from" name="from">${options(p.from)}</select></div>
      <div class="pt-field"><label for="to">To</label><select id="to" name="to">${options(p.to)}</select></div>
      <button class="btn" type="submit">Show</button>
      <button class="btn btn-ghost" type="submit" formaction="/partner/report.csv">Download CSV</button>
    </form>
    ${p.rows.length ? `<div class="pt-table-wrap" tabindex="0" role="region" aria-label="Monthly activity"><table class="pt-table pt-stack"><thead><tr><th scope="col">Month</th><th scope="col">Code</th><th scope="col" class="num">Link and QR visits</th><th scope="col" class="num">Referrals the clinic recorded</th><th scope="col" class="num">Bookings the clinic reported</th></tr></thead><tbody>
      ${p.rows.map(r => `<tr><td data-label="Month">${esc(monthName(r.month))}</td><td data-label="Code"><code>${esc(r.code)}</code></td><td class="num" data-label="Link and QR visits">${n(r.visits)}</td>${reportedCell(r.received, r.receivedDays, r.days, 'Referrals the clinic recorded')}${reportedCell(r.booked, r.bookedDays, r.days, 'Bookings the clinic reported')}</tr>`).join('')}
      </tbody></table></div>` : `<div class="pt-empty"><p>There is nothing to show for these months yet. Your referral activity will appear here after someone uses your link.</p></div>`}
    <p class="pt-hint">Link and QR visits are counted by this app. Referrals and bookings come from ${esc(s.clinicName)}; &ldquo;Not reported&rdquo; means ${esc(s.clinicName)} hasn&rsquo;t shared that month, not that it was zero. Revenue is never shown here.</p>
  </section>`, { session: s, wide: true });
}

// ---------------------------------------------------------------- Referral link landing and errors
// Pages for people who used a partner's link: no partner navigation, no partner sign-in, no portal support number.
export function callPage(clinicName: string, dial: string, shown: string) {
  return layout(`Book with ${clinicName}`, `<section class="pt-card pt-narrow"><p class="eyebrow">Book a visit</p><h1 class="pt-h1-small">${esc(clinicName)}</h1>
    <p>Call or text to book. The front desk will take it from there.</p><p class="pt-aside"><a class="btn btn-primary btn-block" href="tel:${esc(dial)}">Call ${esc(shown)}</a></p></section>`, { visitor: true });
}
export function codeInactivePage() {
  return layout('Link not active', `<section class="pt-card pt-narrow"><h1 class="pt-h1-small">This link isn&rsquo;t active</h1><p>This referral link isn&rsquo;t active right now. If you were trying to reach a clinic, please contact the clinic directly.</p></section>`, { visitor: true });
}
export function visitorMessage(title: string, text: string) {
  return layout(title, `<section class="pt-card pt-narrow"><h1 class="pt-h1-small">${esc(title)}</h1><p>${esc(text)}</p></section>`, { visitor: true });
}
export function messagePage(title: string, text: string, link?: { href: string; label: string }) {
  return layout(title, `<section class="pt-card pt-narrow"><h1 class="pt-h1-small">${esc(title)}</h1><p>${esc(text)}</p>${link ? `<p class="pt-aside"><a class="btn btn-ghost" href="${esc(link.href)}">${esc(link.label)}</a></p>` : ''}</section>`);
}
