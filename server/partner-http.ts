import type { IncomingMessage, ServerResponse } from 'node:http';
import type { PortalStore } from './store';
import { dayOf, monthsBetween, CODE_PATTERN } from './partner-store';
import { clientIp } from './client-ip';
import { joinInput, signInInput, detailsInput, accountInput, reportRange } from './partner-validation';
import { qrSvg, qrPng } from './qr';
import * as view from './partner-views';

// Routes for partner businesses: /join/<invitation>, /partner/... and the referral link itself, /r/<code>.
// Access is enforced here on the server for every request: each protected route resolves the partner from the session
// cookie and passes that session to the store, which scopes every query by the partner's own id. Nothing a request
// carries (a query string, a form field) can name another partner or clinic.
export type PartnerContext = { store: PortalStore; origin: string; allowed: Set<string>; secure: boolean; trustProxy?: boolean; proxyHops?: number };
type Req = IncomingMessage; type Res = ServerResponse;

function send(res: Res, status: number, html: string) { res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(html); }
function redirect(res: Res, location: string, status = 303) { res.writeHead(status, { Location: location }); res.end(); }
function readCookie(req: Req, name: string) {
  return req.headers.cookie?.split(';').map(p => p.trim()).find(p => p.startsWith(name + '='))?.slice(name.length + 1);
}
async function form(req: Req) {
  if (!req.headers['content-type']?.startsWith('application/x-www-form-urlencoded')) throw new Error('content-type');
  let size = 0; const chunks: Buffer[] = [];
  for await (const chunk of req) { size += chunk.length; if (size > 8192) throw new Error('too-large'); chunks.push(Buffer.from(chunk)); }
  const params = new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
  const out: Record<string, string> = {};
  for (const [k, v] of params) if (!(k in out)) out[k] = v;
  return out;
}
function issues(error: { issues: Array<{ path: PropertyKey[]; message: string }> }) {
  const out: Record<string, string> = {};
  for (const issue of error.issues) { const key = String(issue.path[0] ?? 'form'); if (!out[key]) out[key] = issue.message; }
  return out;
}
const safeNext = (value: unknown) => (typeof value === 'string' && /^\/partner(\/[a-z.]*)?(\?[A-Za-z0-9=&-]*)?$/.test(value) ? value : '/partner');
/** Link previews and prefetches are not people choosing to open the link, so they are not counted as visits. */
const NOT_A_VISIT = /(?<!cu)bot|crawl|spider|slurp|preview|facebookexternalhit|whatsapp|telegram|discord|skype|embedly|vkshare|quora|pinterest|bitlybot|headless|curl|wget|python-requests|httpclient|okhttp/i;
const displayPhone = (e164: string) => { const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164); return m ? `(${m[1]}) ${m[2]}-${m[3]}` : e164; };

export async function handlePartner(req: Req, res: Res, url: URL, ctx: PartnerContext): Promise<boolean> {
  const path = url.pathname;
  if (!(path.startsWith('/join/') || path === '/partner' || path.startsWith('/partner/') || path.startsWith('/r/'))) return false;
  const partners = ctx.store.partners;
  const cookieName = ctx.secure ? '__Host-owc-partner' : 'owc-partner-local';
  // Lax, not Strict: a partner who taps a bookmark or an emailed link to the dashboard arrives signed in. Every
  // state-changing request is still protected by the Origin check and a per-session CSRF token below.
  const cookieFlags = `Path=/; HttpOnly; SameSite=Lax${ctx.secure ? '; Secure' : ''}`;
  const setSession = (token: string) => res.setHeader('Set-Cookie', `${cookieName}=${token}; ${cookieFlags}; Max-Age=1209600`);
  const clearSession = () => res.setHeader('Set-Cookie', `${cookieName}=; ${cookieFlags}; Max-Age=0`);
  const token = readCookie(req, cookieName);
  const method = req.method ?? 'GET';
  try {
    // ---- The referral link: /r/<CODE>. Public. Records one visit, then hands the person to the clinic. ----
    if (path.startsWith('/r/')) {
      if (method !== 'GET' && method !== 'HEAD') { send(res, 405, view.visitorMessage('Not available', 'This page only opens in a browser.')); return true; }
      // Codes are plain letters and digits, so the path is matched as it is, never decoded. A lower-case link is sent to
      // the canonical upper-case one first, so the one-visit-a-day cookie (scoped to that path) works for both.
      const raw = path.slice(3);
      if (/^[A-Za-z0-9]{8}$/.test(raw) && raw !== raw.toUpperCase() && CODE_PATTERN.test(raw.toUpperCase())) { redirect(res, `/r/${raw.toUpperCase()}${url.search}`, 301); return true; }
      const target = partners.resolveCode(raw);
      if (!target) { send(res, 404, view.codeInactivePage()); return true; }
      const routable = !!(target.booking_url || target.phone);
      const seenCookie = `owc-v-${target.code}`;
      const purpose = `${req.headers['purpose'] ?? ''} ${req.headers['sec-purpose'] ?? ''} ${req.headers['x-purpose'] ?? ''}`;
      const counting = routable && method === 'GET' && !readCookie(req, seenCookie) && !/prefetch|preview/i.test(purpose) && !NOT_A_VISIT.test(String(req.headers['user-agent'] ?? ''));
      if (counting) {
        // Counting never stands between the person and the clinic: if the visit cannot be stored, they are sent on anyway.
        try { partners.recordVisit(target.code, url.searchParams.get('via') === 'qr' ? 'qr' : 'link', clientIp(req, ctx.trustProxy, ctx.proxyHops)); } catch { /* not counted */ }
        // A plain marker, not an identifier: it only stops one browser from counting twice in a day.
        // LEGAL/PRIVACY REVIEW: this is a functional first-party cookie on the portal domain; confirm it is covered by
        // the portal's privacy notice.
        res.setHeader('Set-Cookie', `${seenCookie}=1; Path=/r/${target.code}; Max-Age=86400; HttpOnly; SameSite=Lax${ctx.secure ? '; Secure' : ''}`);
      }
      if (target.booking_url) {
        const to = new URL(target.booking_url);
        if (target.ref_param) to.searchParams.set(target.ref_param, target.code);
        redirect(res, to.toString(), 302); return true;
      }
      if (target.phone) { send(res, 200, view.callPage(target.clinic_name, target.phone, displayPhone(target.phone))); return true; }
      send(res, 200, view.visitorMessage(target.clinic_name, 'This clinic hasn\u2019t added its booking details yet. Please contact the clinic directly.'));
      return true;
    }

    // ---- Every other partner route. State changes need a POST from this site. ----
    if (method === 'POST' && !ctx.allowed.has(req.headers.origin ?? '')) { send(res, 403, view.messagePage('Please try again', 'This form was sent from somewhere we don’t recognise. Refresh the page and try again.')); return true; }
    if (method !== 'GET' && method !== 'HEAD' && method !== 'POST') { send(res, 405, view.messagePage('Not available', 'That action is not available here.')); return true; }
    const ip = clientIp(req, ctx.trustProxy, ctx.proxyHops);

    // Joining from an invitation.
    const join = /^\/join\/([^/]+)$/.exec(path);
    if (join) {
      const inviteToken = join[1];
      const invite = partners.invitation(inviteToken);
      if (invite.state !== 'open' || !invite.clinicName) { send(res, invite.state === 'missing' ? 404 : 410, view.joinUnavailable(invite.state === 'open' ? 'missing' : invite.state, invite.clinicName)); return true; }
      if (method !== 'POST') { send(res, 200, view.joinPage({ token: inviteToken, clinicName: invite.clinicName, businessHint: invite.businessHint })); return true; }
      let body: Record<string, string>;
      try { body = await form(req); } catch { send(res, 400, view.joinPage({ token: inviteToken, clinicName: invite.clinicName, businessHint: invite.businessHint, formError: 'That form could not be read. Please try again.' })); return true; }
      const values = { businessName: body.businessName ?? '', contactName: body.contactName ?? '', email: body.email ?? '', agree: body.agree ?? '' };
      const parsed = joinInput.safeParse(body);
      if (!parsed.success) { send(res, 400, view.joinPage({ token: inviteToken, clinicName: invite.clinicName, businessHint: invite.businessHint, values, errors: issues(parsed.error) })); return true; }
      const result = partners.join(inviteToken, parsed.data, ip);
      if (!result.ok) {
        if (result.status === 410) { send(res, 410, view.joinUnavailable('used', invite.clinicName)); return true; }
        send(res, result.status, view.joinPage({ token: inviteToken, clinicName: invite.clinicName, businessHint: invite.businessHint, values, errors: result.field ? { [result.field]: result.message } : {}, formError: result.field ? undefined : result.message }));
        return true;
      }
      setSession(result.token);
      redirect(res, '/partner?welcome=1'); return true;
    }

    if (path === '/partner/sign-in') {
      if (method !== 'POST') {
        if (partners.session(token)) { redirect(res, safeNext(url.searchParams.get('next'))); return true; }
        send(res, 200, view.signInPage({ next: url.searchParams.get('next') ?? undefined, notice: url.searchParams.get('signed-out') ? 'You are signed out.' : undefined })); return true;
      }
      let body: Record<string, string>;
      try { body = await form(req); } catch { send(res, 400, view.signInPage({ error: 'That form could not be read. Please try again.' })); return true; }
      const parsed = signInInput.safeParse(body);
      if (!parsed.success) { send(res, 400, view.signInPage({ email: body.email, error: 'Enter your email and password.', next: body.next })); return true; }
      const result = partners.signIn(parsed.data.email, parsed.data.password, ip, token);
      if (!result.ok) { send(res, result.status, view.signInPage({ email: parsed.data.email, error: result.message, next: body.next })); return true; }
      setSession(result.token);
      redirect(res, safeNext(body.next)); return true;
    }

    // Everything below needs a signed-in partner.
    const session = partners.session(token);
    if (!session) {
      if (method === 'POST') { send(res, 401, view.signInPage({ error: 'Your session has ended. Please sign in again.' })); return true; }
      redirect(res, `/partner/sign-in?next=${encodeURIComponent(path + url.search)}`); return true;
    }
    const needCsrf = async () => {
      let body: Record<string, string>;
      try { body = await form(req); } catch { return null; }
      return partners.checkCsrf(session, body.csrf) ? body : null;
    };
    const refused = () => send(res, 403, view.messagePage('Please try again', 'This page was open too long or was sent from somewhere else. Go back, refresh, and try again.', { href: '/partner', label: 'Back to your dashboard' }));

    if (path === '/partner/sign-out' && method === 'POST') {
      if (!(await needCsrf())) { refused(); return true; }
      partners.signOut(token); clearSession(); redirect(res, '/partner/sign-in?signed-out=1'); return true;
    }
    if (method === 'POST' && path === '/partner/details') {
      const body = await needCsrf(); if (!body) { refused(); return true; }
      const parsed = detailsInput.safeParse(body);
      const values = { businessName: body.businessName ?? '', contactName: body.contactName ?? '' };
      if (!parsed.success) { send(res, 400, view.detailsPage(session, { which: 'details', values, errors: issues(parsed.error) })); return true; }
      const result = partners.updateDetails(session, parsed.data);
      if (!result.ok) { send(res, result.status, view.detailsPage(session, { which: 'details', values, errors: result.field ? { [result.field]: result.message } : {}, formError: result.field ? undefined : result.message })); return true; }
      redirect(res, '/partner/details?saved=details'); return true;
    }
    if (method === 'POST' && path === '/partner/account') {
      const body = await needCsrf(); if (!body) { refused(); return true; }
      const parsed = accountInput.safeParse(body);
      const values = { email: body.email ?? '' };
      if (!parsed.success) { send(res, 400, view.detailsPage(session, { which: 'account', values, errors: issues(parsed.error) })); return true; }
      const result = partners.updateAccount(session, parsed.data, ip);
      if (!result.ok) { send(res, result.status, view.detailsPage(session, { which: 'account', values, errors: result.field ? { [result.field]: result.message } : {}, formError: result.field ? undefined : result.message })); return true; }
      redirect(res, '/partner/details?saved=account'); return true;
    }
    if (method === 'POST') { send(res, 404, view.messagePage('Not found', 'That page does not exist.', { href: '/partner', label: 'Back to your dashboard' })); return true; }

    const joinedDay = dayOf(session.joinedAt);
    const data = partners.dashboard(session);
    const primary = data.codes.find(c => c.active) ?? data.codes[0];
    const shareLink = (via?: 'qr') => (primary ? `${ctx.origin}/r/${primary.code}${via ? '?via=qr' : ''}` : '');
    const qrLabel = data.destination === 'phone' ? `QR code that opens a page with ${session.clinicName}'s phone number` : `QR code that opens ${session.clinicName}'s booking page`;

    if (path === '/partner') {
      send(res, 200, view.dashboardPage(session, data, { origin: ctx.origin, qr: primary ? qrSvg(shareLink('qr'), qrLabel) : '', welcome: url.searchParams.get('welcome') === '1', joinedDay, destination: data.destination }));
      return true;
    }
    if ((path === '/partner/qr.svg' || path === '/partner/qr.png') && primary) {
      const png = path.endsWith('.png');
      res.writeHead(200, { 'Content-Type': png ? 'image/png' : 'image/svg+xml; charset=utf-8', 'Content-Disposition': `attachment; filename="referral-qr-${primary.code}.${png ? 'png' : 'svg'}"` });
      res.end(png ? qrPng(shareLink('qr')) : `<?xml version="1.0" encoding="UTF-8"?>\n${qrSvg(shareLink('qr'), qrLabel)}`);
      return true;
    }
    if (path === '/partner/print' && primary) { send(res, 200, view.printPage(session, { code: primary.code, link: shareLink(), qr: qrSvg(shareLink('qr'), qrLabel), destination: data.destination, paused: session.status !== 'active' || !primary.active })); return true; }
    if (path === '/partner/details') { const saved = url.searchParams.get('saved'); send(res, 200, view.detailsPage(session, { saved: saved === 'details' || saved === 'account' ? saved : undefined })); return true; }
    if (path === '/partner/report' || path === '/partner/report.csv') {
      const current = dayOf(Date.now()).slice(0, 7), first = joinedDay.slice(0, 7);
      const months = monthsBetween(first, current).reverse();
      const range = reportRange.safeParse({ from: url.searchParams.get('from') ?? first, to: url.searchParams.get('to') ?? current });
      const from = range.success ? (range.data.from < first ? first : range.data.from) : first;
      const to = range.success ? (range.data.to > current ? current : range.data.to) : current;
      const report = partners.report(session, from, to);
      if (path.endsWith('.csv')) {
        const lines = [['month', 'code', 'days_counted', 'link_and_qr_visits', 'referrals_recorded_by_clinic', 'days_with_referrals_reported', 'bookings_reported_by_clinic', 'days_with_bookings_reported'].join(',')];
        for (const r of report.rows) lines.push([r.month, r.code, r.days, r.visits, r.received ?? 'not reported', r.receivedDays, r.booked ?? 'not reported', r.bookedDays].join(','));
        res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="referral-activity-${from}-to-${to}.csv"` });
        res.end(lines.join('\r\n') + '\r\n'); return true;
      }
      send(res, 200, view.reportPage(session, { rows: report.rows, from, to, months, error: range.success ? undefined : 'Choose a start month before the end month.' }));
      return true;
    }
    send(res, 404, view.messagePage('Not found', 'That page does not exist.', { href: '/partner', label: 'Back to your dashboard' }));
    return true;
  } catch {
    if (!res.headersSent) send(res, 500, view.messagePage('Something went wrong', 'The page could not be loaded. Please try again in a moment.'));
    else res.end();
    return true;
  }
}
