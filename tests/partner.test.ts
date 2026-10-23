import test from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { openStore } from '../server/store';
import { createPortalServer } from '../server/http';
import { businessKey, dayOf } from '../server/partner-store';
import { outcomeReport } from '../server/partner-validation';
import { qrSvg, qrPng } from '../server/qr';

// The partner side: joining from an invitation, partner isolation, referral attribution and the dashboard counts.
// Every clinic, business and person here is invented for the test and lives in an in-memory database.
const ORIGIN = 'http://portal.test';
const BROWSER = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1';
type Store = ReturnType<typeof openStore>;

function hub(store: Store, id = 'hub-clinic', name = 'Hub Test Clinic') {
  store.createClient(id, name, `${id}-owner`, 'clinic-password-1');
  store.partners.setDestination(id, { bookingUrl: `https://booking.example.invalid/${id}`, refParam: 'ref' });
  return id;
}
async function serve(store: Store, fn: (http: Http) => Promise<void>) {
  const server = createPortalServer({ store, origin: ORIGIN, secure: false, root: process.cwd() });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try { await fn(new Http(base)); } finally { await new Promise<void>((resolve, reject) => server.close(e => (e ? reject(e) : resolve()))); store.close(); }
}
class Http {
  constructor(readonly base: string) {}
  get(path: string, cookie = '', headers: Record<string, string> = {}) { return fetch(this.base + path, { redirect: 'manual', headers: { Cookie: cookie, 'User-Agent': BROWSER, ...headers } }); }
  head(path: string) { return fetch(this.base + path, { method: 'HEAD', redirect: 'manual', headers: { 'User-Agent': BROWSER } }); }
  post(path: string, fields: Record<string, string>, cookie = '', origin = ORIGIN) {
    return fetch(this.base + path, { method: 'POST', redirect: 'manual', headers: { Origin: origin, Cookie: cookie, 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': BROWSER }, body: new URLSearchParams(fields).toString() });
  }
}
const cookieOf = (response: Response) => (response.headers.get('set-cookie') ?? '').split(';')[0];
const csrfOf = (html: string) => /name="csrf" value="([a-f0-9]{64})"/.exec(html)?.[1] ?? '';
const fields = (over: Record<string, string> = {}) => ({ businessName: 'The Iron Room', contactName: 'Dana Test', email: 'dana@ironroom.example.invalid', password: 'correct-horse-9', confirm: 'correct-horse-9', agree: 'yes', ...over });
async function joinAs(http: Http, store: Store, clinic: string, over: Record<string, string> = {}) {
  const invite = store.partners.createInvitation(clinic);
  const response = await http.post(`/join/${invite.token}`, fields(over));
  assert.equal(response.status, 303, await response.text());
  assert.equal(response.headers.get('location'), '/partner?welcome=1');
  const cookie = cookieOf(response);
  const dash = await (await http.get('/partner', cookie)).text();
  const code = /\/r\/([A-Z0-9]{8})"/.exec(dash)?.[1] ?? '';
  assert.match(code, /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$/);
  return { cookie, code, dash };
}
const rows = (store: Store, sql: string, ...params: Array<string | number>) => (store.db.prepare(sql).all(...params) as Array<Record<string, unknown>>).map(r => ({ ...r }));

test('joining from an invitation records the inviting clinic and the join date, and signs the partner in', async () => {
  const store = openStore(':memory:', false); const clinic = hub(store);
  await serve(store, async http => {
    const invite = store.partners.createInvitation(clinic, { businessHint: 'The Iron Room' });
    const page = await (await http.get(`/join/${invite.token}`)).text();
    assert.match(page, /Hub Test Clinic invited The Iron Room to join its local referral network/);
    assert.match(page, /Joining is free/);
    assert.match(page, /Nobody is paid per referral, and you don&rsquo;t promise any number of referrals/);
    const before = Date.now();
    const { code, dash } = await joinAs(http, store, clinic);
    const [partner] = rows(store, 'SELECT clinic_id,business_name,contact_name,joined_at,invitation_id FROM partners');
    assert.equal(partner.clinic_id, clinic);
    assert.equal(partner.business_name, 'The Iron Room');
    assert.ok(Number(partner.joined_at) >= before && Number(partner.joined_at) <= Date.now());
    assert.ok(partner.invitation_id);
    assert.match(dash, /Connected to <strong>Hub Test Clinic<\/strong> since/);
    assert.match(dash, new RegExp(`/r/${code}`));
    // The invitation link is a secret: only its hash is stored.
    assert.equal(rows(store, 'SELECT 1 FROM partner_invitations WHERE token_hash=?', invite.token).length, 0);
    assert.equal(JSON.stringify(rows(store, 'SELECT * FROM partner_invitations')).includes(invite.token), false);
  });
});

test('an invitation is single-use by default; expired, withdrawn and unknown invitations cannot be used', async () => {
  const store = openStore(':memory:', false); const clinic = hub(store);
  await serve(store, async http => {
    const once = store.partners.createInvitation(clinic);
    assert.equal((await http.post(`/join/${once.token}`, fields())).status, 303);
    const again = await http.post(`/join/${once.token}`, fields({ businessName: 'Second Business', email: 'second@example.invalid' }));
    assert.equal(again.status, 410);
    assert.match(await again.text(), /already been used/);
    const expired = store.partners.createInvitation(clinic, { days: -1 });
    const e = await http.get(`/join/${expired.token}`); assert.equal(e.status, 410); assert.match(await e.text(), /has expired. Ask Hub Test Clinic/);
    const withdrawn = store.partners.createInvitation(clinic);
    store.partners.revokeInvitation(clinic, withdrawn.id);
    assert.equal((await http.get(`/join/${withdrawn.token}`)).status, 410);
    const unknown = await http.get('/join/' + 'A'.repeat(43));
    assert.equal(unknown.status, 404);
    assert.doesNotMatch(await unknown.text(), /Hub Test Clinic/, 'an unknown link reveals no clinic');
    assert.equal(rows(store, 'SELECT 1 FROM partners').length, 1);
  });
});

test('the same business cannot join the same network twice, under any spelling; another network is fine', async () => {
  assert.equal(businessKey('The Iron Room, LLC'), businessKey('iron room'));
  assert.equal(businessKey('Café & Co.'), businessKey('cafe and'));
  const store = openStore(':memory:', false); const clinic = hub(store); const other = hub(store, 'other-clinic', 'Other Test Clinic');
  await serve(store, async http => {
    await joinAs(http, store, clinic);
    const dup = await http.post(`/join/${store.partners.createInvitation(clinic).token}`, fields({ businessName: 'THE IRON ROOM, LLC', email: 'owner2@example.invalid' }));
    assert.equal(dup.status, 409);
    assert.match(await dup.text(), /already joined Hub Test Clinic&#39;s network/);
    const sameEmail = await http.post(`/join/${store.partners.createInvitation(clinic).token}`, fields({ businessName: 'Different Gym' }));
    assert.equal(sameEmail.status, 409, 'one account per email');
    await joinAs(http, store, other, { email: 'iron-room-other@example.invalid' });
    assert.equal(rows(store, 'SELECT 1 FROM partners').length, 2);
  });
});

test('join input is validated and cleaned on the server; nothing is stored when it fails', async () => {
  const store = openStore(':memory:', false); const clinic = hub(store);
  await serve(store, async http => {
    const token = store.partners.createInvitation(clinic).token;
    for (const [over, pattern] of [
      [{ password: 'short', confirm: 'short' }, /at least 10 characters/],
      [{ confirm: 'something-else' }, /passwords do not match/],
      [{ agree: '' }, /Please confirm/],
      [{ email: 'not-an-email' }, /work email address/],
      [{ businessName: 'x'.repeat(300) }, /under 120 characters/],
      [{ businessName: '  ' }, /Enter your business name/],
    ] as Array<[Record<string, string>, RegExp]>) {
      const response = await http.post(`/join/${token}`, fields(over));
      assert.equal(response.status, 400, JSON.stringify(over));
      const html = await response.text();
      assert.match(html, pattern);
      assert.match(html, /aria-invalid="true"/);
    }
    assert.equal(rows(store, 'SELECT 1 FROM partners').length, 0);
    const { dash } = await joinAs(http, store, clinic, { businessName: '  <script>alert(1)</script>\u0000  Studio\n', contactName: 'Pat\tTest' });
    assert.doesNotMatch(dash, /<script>alert/);
    assert.match(dash, /&lt;script&gt;alert\(1\)&lt;\/script&gt; Studio/);
    assert.equal(rows(store, 'SELECT business_name FROM partners')[0].business_name, '<script>alert(1)</script> Studio');
    assert.equal(rows(store, 'SELECT contact_name FROM partners')[0].contact_name, 'Pat Test');
  });
});

test('a partner sees only its own business, code and counts, and never the clinic report', async () => {
  const store = openStore(':memory:', false); const clinic = hub(store);
  await serve(store, async http => {
    const a = await joinAs(http, store, clinic, { businessName: 'Alpha Gym', email: 'alpha@example.invalid' });
    const b = await joinAs(http, store, clinic, { businessName: 'Beta Salon', email: 'beta@example.invalid' });
    for (let i = 0; i < 3; i++) store.partners.recordVisit(b.code, 'link');
    const dashA = await (await http.get('/partner', a.cookie)).text();
    assert.match(dashA, /Alpha Gym/);
    assert.doesNotMatch(dashA, /Beta Salon/);
    assert.doesNotMatch(dashA, new RegExp(b.code));
    assert.match(dashA, /<p class="pt-stat-value">0<\/p>/, "B's visits are not A's");
    // Nothing in a request can point at another partner.
    const probe = await (await http.get(`/partner?partner=${b.code}&code=${b.code}&clinic=other`, a.cookie)).text();
    assert.doesNotMatch(probe, new RegExp(b.code));
    const csv = await (await http.get('/partner/report.csv', a.cookie)).text();
    assert.match(csv, new RegExp(a.code));
    assert.doesNotMatch(csv, new RegExp(b.code));
    const qr = await http.get('/partner/qr.svg', a.cookie);
    assert.match(qr.headers.get('content-disposition') ?? '', new RegExp(a.code));
    // A partner session is not a clinic session: the clinic report API returns nothing for it.
    const portal = await (await http.get('/api/portal', a.cookie.replace('owc-partner-local', 'owo-local-session'))).json();
    assert.equal(portal.clinic, null);
    assert.equal((await (await http.get('/api/portal', a.cookie)).json()).clinic, null);
  });
});

test('protected partner pages need a partner session; a clinic session does not open them', async () => {
  const store = openStore(':memory:', false); const clinic = hub(store);
  await serve(store, async http => {
    const clinicLogin = await fetch(http.base + '/api/login', { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json' }, body: JSON.stringify({ username: `${clinic}-owner`, password: 'clinic-password-1' }) });
    const clinicCookie = cookieOf(clinicLogin);
    for (const path of ['/partner', '/partner/qr.svg', '/partner/qr.png', '/partner/print', '/partner/details', '/partner/report', '/partner/report.csv']) {
      for (const cookie of ['', clinicCookie, clinicCookie.replace('owo-local-session', 'owc-partner-local')]) {
        const response = await http.get(path, cookie);
        assert.equal(response.status, 303, `${path} ${cookie ? 'with clinic cookie' : 'anonymous'}`);
        assert.match(response.headers.get('location') ?? '', /^\/partner\/sign-in\?next=/);
      }
    }
    assert.equal((await http.post('/partner/details', { businessName: 'X', contactName: 'Y' })).status, 401);
  });
});

test('state-changing partner actions need this site as Origin and the session CSRF token', async () => {
  const store = openStore(':memory:', false); const clinic = hub(store);
  await serve(store, async http => {
    const { cookie } = await joinAs(http, store, clinic);
    const csrf = csrfOf(await (await http.get('/partner/details', cookie)).text());
    assert.equal((await http.post('/partner/details', { businessName: 'Renamed', contactName: 'Dana Test' }, cookie)).status, 403, 'no token');
    assert.equal((await http.post('/partner/details', { csrf: 'f'.repeat(64), businessName: 'Renamed', contactName: 'Dana Test' }, cookie)).status, 403, 'wrong token');
    assert.equal((await http.post('/partner/details', { csrf, businessName: 'Renamed', contactName: 'Dana Test' }, cookie, 'https://evil.invalid')).status, 403, 'other origin');
    assert.equal((await http.post(`/join/${store.partners.createInvitation(clinic).token}`, fields({ businessName: 'Other', email: 'o@example.invalid' }), '', 'https://evil.invalid')).status, 403);
    const ok = await http.post('/partner/details', { csrf, businessName: 'Renamed Gym', contactName: 'Dana Test' }, cookie);
    assert.equal(ok.status, 303);
    assert.equal(rows(store, 'SELECT business_name FROM partners')[0].business_name, 'Renamed Gym');
    assert.equal((await http.post('/partner/sign-out', {}, cookie)).status, 403, 'sign-out needs the token too');
    assert.equal((await http.post('/partner/sign-out', { csrf }, cookie)).status, 303);
    assert.equal((await http.get('/partner', cookie)).status, 303, 'signed out');
  });
});

test('changing the sign-in email or password needs the current password; a new password ends other sessions', async () => {
  const store = openStore(':memory:', false); const clinic = hub(store);
  await serve(store, async http => {
    const { cookie } = await joinAs(http, store, clinic);
    const other = cookieOf(await http.post('/partner/sign-in', { email: 'dana@ironroom.example.invalid', password: 'correct-horse-9' }));
    const csrf = csrfOf(await (await http.get('/partner/details', cookie)).text());
    const wrong = await http.post('/partner/account', { csrf, email: 'dana@ironroom.example.invalid', current: 'nope-nope-nope', password: 'brand-new-pass-1', confirm: 'brand-new-pass-1' }, cookie);
    assert.equal(wrong.status, 401);
    const ok = await http.post('/partner/account', { csrf, email: 'dana.new@ironroom.example.invalid', current: 'correct-horse-9', password: 'brand-new-pass-1', confirm: 'brand-new-pass-1' }, cookie);
    assert.equal(ok.status, 303);
    assert.equal((await http.get('/partner', cookie)).status, 200, 'this session stays');
    assert.equal((await http.get('/partner', other)).status, 303, 'the other session ended');
    assert.equal((await http.post('/partner/sign-in', { email: 'dana.new@ironroom.example.invalid', password: 'brand-new-pass-1' })).status, 303);
  });
});

test('partner sign-in gives one generic message and is rate limited', async () => {
  const store = openStore(':memory:', false); const clinic = hub(store);
  await serve(store, async http => {
    await joinAs(http, store, clinic);
    const a = await (await http.post('/partner/sign-in', { email: 'dana@ironroom.example.invalid', password: 'wrong-password' })).text();
    const b = await (await http.post('/partner/sign-in', { email: 'nobody@example.invalid', password: 'wrong-password' })).text();
    const message = (html: string) => /pt-alert-error[^>]*>([^<]*)</.exec(html)?.[1];
    assert.equal(message(a), message(b));
    for (let i = 0; i < 12; i++) await http.post('/partner/sign-in', { email: 'dana@ironroom.example.invalid', password: 'guess-' + i });
    assert.equal((await http.post('/partner/sign-in', { email: 'dana@ironroom.example.invalid', password: 'correct-horse-9' })).status, 429);
  });
});

test('a referral link records one visit with its code and channel, then sends the person to the clinic', async () => {
  const store = openStore(':memory:', false); const clinic = hub(store);
  await serve(store, async http => {
    const { code } = await joinAs(http, store, clinic);
    const first = await http.get(`/r/${code}?via=qr`);
    assert.equal(first.status, 302);
    assert.equal(first.headers.get('location'), `https://booking.example.invalid/${clinic}?ref=${code}`);
    const seen = cookieOf(first);
    assert.equal((await http.get(`/r/${code}?via=qr`, seen)).status, 302, 'the same browser again: still redirected');
    await http.get(`/r/${code.toLowerCase()}`); // a second browser, typed in lower case
    await http.head(`/r/${code}`);
    await http.get(`/r/${code}`, '', { 'User-Agent': 'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)' });
    await http.get(`/r/${code}`, '', { 'Sec-Purpose': 'prefetch' });
    assert.deepEqual(rows(store, 'SELECT code,channel,day FROM referral_events ORDER BY id'), [
      { code, channel: 'qr', day: dayOf(Date.now()) },
      { code, channel: 'link', day: dayOf(Date.now()) },
    ], 'repeat, HEAD, link preview and prefetch are not visits');
    const unknown = await http.get('/r/ZZZZZZZZ');
    assert.equal(unknown.status, 404);
    store.partners.setPartnerStatus(clinic, code, 'paused');
    assert.equal((await http.get(`/r/${code}`)).status, 404, 'a paused partner link is not active');
    assert.equal(rows(store, 'SELECT 1 FROM referral_events').length, 2);
  });
});

test('with only a phone number, the referral link opens a call page and still asks the person for nothing', async () => {
  const store = openStore(':memory:', false);
  store.createClient('phone-clinic', 'Phone Only Clinic', 'phone-owner', 'clinic-password-1');
  store.partners.setDestination('phone-clinic', { phone: '+16305550100' });
  await serve(store, async http => {
    const { code } = await joinAs(http, store, 'phone-clinic');
    const page = await http.get(`/r/${code}`);
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /href="tel:\+16305550100"/);
    assert.match(html, /\(630\) 555-0100/);
    assert.doesNotMatch(html, /<form|<input/, 'no form, no fields');
  });
});

test('nothing stored about a visit or a reported outcome can identify a person', () => {
  const store = openStore(':memory:', false);
  try {
    const columns = (table: string) => rows(store, `PRAGMA table_info(${table})`).map(r => r.name).sort();
    assert.deepEqual(columns('referral_events'), ['channel', 'code', 'created_at', 'day', 'id']);
    assert.deepEqual(columns('referral_outcomes'), ['code', 'count', 'day', 'id', 'report_id', 'status']);
    const bad = outcomeReport.safeParse({ from: '2026-10-01', to: '2026-10-31', reports: ['received'], entries: [{ code: 'AB23CD45', day: '2026-10-02', received: 1, name: 'A Person' }] });
    assert.equal(bad.success, false, 'an outcome entry with a name is refused');
  } finally { store.close(); }
});

test('dashboard counts come from the database only: empty, then visits, then what the clinic reported', async () => {
  const store = openStore(':memory:', false); const clinic = hub(store);
  await serve(store, async http => {
    const { cookie, code, dash } = await joinAs(http, store, clinic);
    assert.match(dash, /<p class="pt-stat-value">0<\/p>/);
    assert.equal((dash.match(/<p class="pt-stat-value pt-stat-empty">Not reported yet<\/p>/g) ?? []).length, 2, 'referrals and bookings are not shown as zero');
    assert.match(dash, /Your referral activity will appear here after someone uses your link\./);
    await http.get(`/r/${code}?via=qr`); await http.get(`/r/${code}`);
    const today = dayOf(Date.now());
    const rows1 = store.partners.reportOutcomes(clinic, outcomeReport.parse({ from: today, to: today, reports: ['received'], entries: [{ code, day: today, received: 2 }] }));
    assert.equal(rows1, 1);
    const after = await (await http.get('/partner', cookie)).text();
    const values = [...after.matchAll(/<p class="pt-stat-value( pt-stat-empty)?">([^<]*)<\/p>/g)].map(m => m[2]);
    assert.deepEqual(values, ['2', '2', 'Not reported yet'], 'visits, referrals recorded, bookings still not reported');
    assert.match(after, /Visits from the QR code/);
    assert.match(after, /Referrals the clinic recorded/);
    // Re-reporting the same day replaces it; reporting bookings as zero makes zero a real number.
    store.partners.reportOutcomes(clinic, outcomeReport.parse({ from: today, to: today, reports: ['received', 'booked'], entries: [{ code, day: today, received: 1, booked: 0 }] }));
    const final = [...(await (await http.get('/partner', cookie)).text()).matchAll(/<p class="pt-stat-value( pt-stat-empty)?">([^<]*)<\/p>/g)].map(m => m[2]);
    assert.deepEqual(final, ['2', '1', '0']);
    const csv = (await (await http.get('/partner/report.csv', cookie)).text()).trim().split('\r\n');
    assert.equal(csv[0], 'month,code,days_counted,link_and_qr_visits,referrals_recorded_by_clinic,days_with_referrals_reported,bookings_reported_by_clinic,days_with_bookings_reported');
    assert.equal(csv[1], `${today.slice(0, 7)},${code},1,2,1,1,0,1`);
  });
});

test('a month the clinic has not reported says "Not reported", never zero', () => {
  const store = openStore(':memory:', false);
  try {
    const clinic = hub(store);
    const invite = store.partners.createInvitation(clinic);
    const joined = store.partners.join(invite.token, { businessName: 'Gamma Studio', contactName: 'G Test', email: 'g@example.invalid', password: 'gamma-pass-123', confirm: 'gamma-pass-123', agree: 'yes' }, 'test');
    assert.ok(joined.ok); if (!joined.ok) return;
    const session = store.partners.session(joined.token)!;
    const month = dayOf(Date.now()).slice(0, 7);
    const report = store.partners.report(session, month, month);
    assert.equal(report.rows.length, 1);
    assert.equal(report.rows[0].received, null);
    assert.equal(report.rows[0].booked, null);
    assert.throws(() => store.partners.reportOutcomes('other-clinic', outcomeReport.parse({ from: '2026-10-01', to: '2026-10-01', reports: ['received'], entries: [{ code: report.rows[0].code, day: '2026-10-01', received: 1 }] })), /do not belong/);
  } finally { store.close(); }
});

test('QR codes come out as a valid SVG and PNG', () => {
  const svg = qrSvg('https://ournetworkportal.com/r/AB23CD45?via=qr', 'QR <code>');
  assert.match(svg, /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" viewBox="0 0 (\d+) \1"/);
  assert.match(svg, /aria-label="QR &lt;code&gt;"/);
  const png = qrPng('https://ournetworkportal.com/r/AB23CD45?via=qr', 4);
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  const side = png.readUInt32BE(16);
  assert.equal(side, png.readUInt32BE(20));
  assert.equal(side % 4, 0);
});
