import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import type { IncomingMessage } from 'node:http';
import { openStore } from '../server/store';
import { createPortalServer } from '../server/http';
import { businessKey, dayOf } from '../server/partner-store';
import { outcomeReport, joinInput } from '../server/partner-validation';
import { clientIp } from '../server/client-ip';
import { qrSvg, qrPng } from '../server/qr';

// The partner side: joining from an invitation, partner isolation, referral attribution and the dashboard counts.
// Every clinic, business and person here is invented for the test and lives in an in-memory database.
const ORIGIN = 'http://portal.test';
const BROWSER = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1';
const ZWSP = String.fromCharCode(0x200b);
type Store = ReturnType<typeof openStore>;

function hub(store: Store, id = 'hub-clinic', name = 'Hub Test Clinic') {
  store.createClient(id, name, `${id}-owner`, 'clinic-password-1');
  store.partners.setDestination(id, { bookingUrl: `https://booking.example.invalid/${id}`, refParam: 'ref' });
  return id;
}
async function serve(store: Store, fn: (http: Http) => Promise<void>, options: { trustProxy?: boolean; proxyHops?: number } = {}) {
  const server = createPortalServer({ store, origin: ORIGIN, secure: false, root: process.cwd(), ...options });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try { await fn(new Http(base)); } finally { await new Promise<void>((resolve, reject) => server.close(e => (e ? reject(e) : resolve()))); store.close(); }
}
class Http {
  constructor(readonly base: string) {}
  get(path: string, cookie = '', headers: Record<string, string> = {}) { return fetch(this.base + path, { redirect: 'manual', headers: { Cookie: cookie, 'User-Agent': BROWSER, ...headers } }); }
  head(path: string) { return fetch(this.base + path, { method: 'HEAD', redirect: 'manual', headers: { 'User-Agent': BROWSER } }); }
  post(path: string, fields: Record<string, string>, cookie = '', origin = ORIGIN, headers: Record<string, string> = {}) {
    return fetch(this.base + path, { method: 'POST', redirect: 'manual', headers: { Origin: origin, Cookie: cookie, 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': BROWSER, ...headers }, body: new URLSearchParams(fields).toString() });
  }
}
const cookieOf = (response: Response) => (response.headers.get('set-cookie') ?? '').split(';')[0];
const csrfOf = (html: string) => /name="csrf" value="([a-f0-9]{64})"/.exec(html)?.[1] ?? '';
const tiles = (html: string) => [...html.matchAll(/<p class="pt-stat-value( pt-stat-empty)?">([^<]*)<\/p>/g)].map(m => m[2]);
const historyRows = (html: string) => [...html.matchAll(/<tr><td data-label="Date">([^<]*)<\/td><td data-label="Code"><code>([^<]*)<\/code><\/td><td data-label="What happened">([^<]*)<\/td><td class="num" data-label="Count">([^<]*)<\/td><\/tr>/g)].map(m => m.slice(1).join(' | '));
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
const label = (clinic: string) => `QR code that opens ${clinic}'s booking page`;

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
    assert.equal(JSON.stringify(rows(store, 'SELECT * FROM partner_invitations')).includes(invite.token), false);
  });
});

test('an invitation is single-use by default; expired, withdrawn and unknown invitations cannot be used; no invitations before a destination', async () => {
  const store = openStore(':memory:', false); const clinic = hub(store);
  store.createClient('no-destination', 'No Destination Clinic', 'nd-owner', 'clinic-password-1');
  assert.throws(() => store.partners.createInvitation('no-destination'), /Set where partner links go first/);
  await serve(store, async http => {
    const once = store.partners.createInvitation(clinic);
    assert.equal((await http.post(`/join/${once.token}`, fields())).status, 303);
    const again = await http.post(`/join/${once.token}`, fields({ businessName: 'Second Business', email: 'second@example.invalid' }));
    assert.equal(again.status, 410);
    assert.match(await again.text(), /already been used/);
    const expired = store.partners.createInvitation(clinic, { days: -1 });
    const e = await http.get(`/join/${expired.token}`); assert.equal(e.status, 410); assert.match(await e.text(), /has expired. Ask Hub Test Clinic/);
    const withdrawn = store.partners.createInvitation(clinic);
    assert.equal(store.partners.revokeInvitation(clinic, withdrawn.id), true);
    assert.equal(store.partners.listInvitations(clinic).find(i => i.id === withdrawn.id)?.revoked_at !== null, true);
    assert.equal((await http.get(`/join/${withdrawn.token}`)).status, 410);
    const unknown = await http.get('/join/' + 'A'.repeat(43));
    assert.equal(unknown.status, 404);
    assert.doesNotMatch(await unknown.text(), /Hub Test Clinic/, 'an unknown link reveals no clinic');
    assert.equal(rows(store, 'SELECT 1 FROM partners').length, 1);
  });
});

test('the same business cannot join the same network twice, under any spelling or alphabet; another network is fine', async () => {
  assert.equal(businessKey('The Iron Room, LLC'), businessKey('iron room'));
  assert.equal(businessKey('Iron Room L.L.C.'), businessKey('iron room'));
  assert.equal(businessKey('Caf' + String.fromCharCode(0xe9) + ' & Co.'), businessKey('cafe and'));
  assert.notEqual(businessKey('Студия Йоги'), '', 'non-Latin names keep their letters');
  assert.notEqual(businessKey('Студия Йоги'), businessKey('Салон Красоты'), 'different non-Latin names are different businesses');
  assert.equal(businessKey('The Company'), 'thecompany', 'a name made only of stop words still has a key');
  const store = openStore(':memory:', false); const clinic = hub(store); const other = hub(store, 'other-clinic', 'Other Test Clinic');
  await serve(store, async http => {
    await joinAs(http, store, clinic);
    const dup = await http.post(`/join/${store.partners.createInvitation(clinic).token}`, fields({ businessName: 'THE IRON ROOM, LLC', email: 'owner2@example.invalid' }));
    assert.equal(dup.status, 409);
    assert.match(await dup.text(), /already joined Hub Test Clinic&#39;s network/);
    const sameEmail = await http.post(`/join/${store.partners.createInvitation(clinic).token}`, fields({ businessName: 'Different Gym' }));
    assert.equal(sameEmail.status, 409, 'one account per email');
    assert.match(await sameEmail.text(), /We can&#39;t create an account with this email/);
    await joinAs(http, store, other, { email: 'iron-room-other@example.invalid' });
    await joinAs(http, store, clinic, { businessName: 'Студия Йоги', email: 'yoga@example.invalid' });
    assert.equal(rows(store, 'SELECT 1 FROM partners').length, 3);
  });
});

test('one invitation answers at most five "already joined" questions', async () => {
  const store = openStore(':memory:', false); const clinic = hub(store);
  await serve(store, async http => {
    await joinAs(http, store, clinic);
    const token = store.partners.createInvitation(clinic, { maxUses: 50 }).token;
    for (let i = 0; i < 5; i++) assert.equal((await http.post(`/join/${token}`, fields({ email: `probe${i}@example.invalid` }))).status, 409);
    assert.equal((await http.post(`/join/${token}`, fields({ email: 'probe9@example.invalid' }))).status, 429);
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
      [{ contactName: ZWSP.repeat(4) }, /Enter your name/],
      [{ businessName: 'Ir' + String.fromCharCode(0x43e) + 'n Room' }, /one alphabet per word/],
    ] as Array<[Record<string, string>, RegExp]>) {
      const response = await http.post(`/join/${token}`, fields(over));
      assert.equal(response.status, 400, JSON.stringify(over));
      const html = await response.text();
      assert.match(html, pattern);
      assert.match(html, /aria-invalid="true"/);
    }
    assert.equal(rows(store, 'SELECT 1 FROM partners').length, 0);
    const { dash } = await joinAs(http, store, clinic, { businessName: '  <script>alert(1)</script>' + String.fromCharCode(0) + '  Studio\n', contactName: 'Pat\tTest' + ZWSP });
    assert.doesNotMatch(dash, /<script>alert/);
    assert.match(dash, /&lt;script&gt;alert\(1\)&lt;\/script&gt; Studio/);
    assert.equal(rows(store, 'SELECT business_name FROM partners')[0].business_name, '<script>alert(1)</script> Studio');
    assert.equal(rows(store, 'SELECT contact_name FROM partners')[0].contact_name, 'Pat Test');
  });
});

test('a partner sees only its own business, code and numbers, even with another partner active in the same network', async () => {
  const store = openStore(':memory:', false); const clinic = hub(store);
  await serve(store, async http => {
    const a = await joinAs(http, store, clinic, { businessName: 'Alpha Gym', email: 'alpha@example.invalid' });
    const b = await joinAs(http, store, clinic, { businessName: 'Beta Salon', email: 'beta@example.invalid' });
    const today = dayOf(Date.now());
    for (let i = 0; i < 3; i++) await http.get(`/r/${b.code}?via=qr`, '', { 'X-Test': String(i) });
    await http.get(`/r/${a.code}`);
    store.partners.reportOutcomes(clinic, outcomeReport.parse({ from: today, to: today, reports: ['received', 'booked'], entries: [{ code: b.code, day: today, received: 4, booked: 3 }, { code: a.code, day: today, received: 1, booked: 0 }] }));
    const dashA = await (await http.get('/partner', a.cookie)).text();
    assert.match(dashA, /Alpha Gym/);
    assert.doesNotMatch(dashA, /Beta Salon/);
    assert.doesNotMatch(dashA, new RegExp(b.code));
    assert.deepEqual(tiles(dashA), ['1', '1', '0'], "A's visits, referrals and bookings, not B's");
    assert.deepEqual(historyRows(dashA), [
      `${new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(today + 'T12:00:00Z'))} | ${a.code} | Visits from the link | 1`,
      `${new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(today + 'T12:00:00Z'))} | ${a.code} | Referrals the clinic recorded (month total) | 1`,
    ]);
    // Nothing in a request can point at another partner.
    const probe = await (await http.get(`/partner?partner=${b.code}&code=${b.code}&clinic=other`, a.cookie)).text();
    assert.doesNotMatch(probe, new RegExp(b.code));
    const csv = (await (await http.get('/partner/report.csv', a.cookie)).text()).trim().split('\r\n');
    assert.deepEqual(csv.slice(1), [`${today.slice(0, 7)},${a.code},1,1,1,1,0,1`]);
    const report = await (await http.get('/partner/report', a.cookie)).text();
    assert.doesNotMatch(report, new RegExp(b.code));
    // The QR code on the dashboard, in both downloads and on the print card is A's own link.
    const expected = qrSvg(`${ORIGIN}/r/${a.code}?via=qr`, label('Hub Test Clinic'));
    assert.ok(dashA.includes(expected), 'dashboard QR');
    assert.equal(await (await http.get('/partner/qr.svg', a.cookie)).text(), `<?xml version="1.0" encoding="UTF-8"?>\n${expected}`);
    assert.ok((await (await http.get('/partner/print', a.cookie)).text()).includes(expected), 'print card QR');
    assert.deepEqual(Buffer.from(await (await http.get('/partner/qr.png', a.cookie)).arrayBuffer()), qrPng(`${ORIGIN}/r/${a.code}?via=qr`));
    // Renaming A touches only A.
    const csrf = csrfOf(await (await http.get('/partner/details', a.cookie)).text());
    assert.equal((await http.post('/partner/details', { csrf, businessName: 'Alpha Gym Renamed', contactName: 'Dana Test' }, a.cookie)).status, 303);
    assert.deepEqual(rows(store, 'SELECT business_name FROM partners ORDER BY joined_at').map(r => r.business_name), ['Alpha Gym Renamed', 'Beta Salon']);
    // A partner session is not a clinic session: the clinic report API returns nothing for it.
    assert.equal((await (await http.get('/api/portal', a.cookie.replace('owc-partner-local', 'owo-local-session'))).json()).clinic, null);
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
    assert.equal((await http.post('/partner/account', { email: 'x@example.invalid', current: 'correct-horse-9', password: '', confirm: '' }, cookie)).status, 403, 'account change without token');
    assert.equal((await http.post(`/join/${store.partners.createInvitation(clinic).token}`, fields({ businessName: 'Other', email: 'o@example.invalid' }), '', 'https://evil.invalid')).status, 403);
    assert.equal(rows(store, "SELECT 1 FROM partners WHERE business_name='Renamed'").length, 0);
    const ok = await http.post('/partner/details', { csrf, businessName: 'Renamed Gym', contactName: 'Dana Test' }, cookie);
    assert.equal(ok.status, 303);
    assert.equal(rows(store, 'SELECT business_name FROM partners')[0].business_name, 'Renamed Gym');
    assert.equal((await http.post('/partner/sign-out', {}, cookie)).status, 403, 'sign-out needs the token too');
    assert.equal((await http.post('/partner/sign-out', { csrf }, cookie)).status, 303);
    assert.equal((await http.get('/partner', cookie)).status, 303, 'signed out');
  });
});

test('renaming cannot be used to test which names are in the network, and is rate limited', async () => {
  const store = openStore(':memory:', false); const clinic = hub(store);
  await serve(store, async http => {
    const a = await joinAs(http, store, clinic, { businessName: 'Alpha Gym', email: 'alpha@example.invalid' });
    await joinAs(http, store, clinic, { businessName: 'Beta Salon', email: 'beta@example.invalid' });
    const csrf = csrfOf(await (await http.get('/partner/details', a.cookie)).text());
    // The same answer whether or not the name is taken: the key the business joined with does not change.
    assert.equal((await http.post('/partner/details', { csrf, businessName: 'Beta Salon', contactName: 'Dana Test' }, a.cookie)).status, 303);
    assert.equal((await http.post('/partner/details', { csrf, businessName: 'Gamma Studio', contactName: 'Dana Test' }, a.cookie)).status, 303);
    assert.deepEqual(rows(store, 'SELECT business_key FROM partners ORDER BY joined_at').map(r => r.business_key), ['alphagym', 'betasalon']);
    for (let i = 0; i < 18; i++) await http.post('/partner/details', { csrf, businessName: 'Gamma ' + i, contactName: 'Dana Test' }, a.cookie);
    assert.equal((await http.post('/partner/details', { csrf, businessName: 'Gamma last', contactName: 'Dana Test' }, a.cookie)).status, 429);
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

test('partner sign-in: one generic message; failures are limited per address, a correct password never counts, and a stranger cannot lock a partner out', async () => {
  const store = openStore(':memory:', false); const clinic = hub(store);
  await serve(store, async http => {
    await joinAs(http, store, clinic);
    const from = (ip: string) => ({ 'X-Forwarded-For': ip });
    const signIn = (password: string, ip: string) => http.post('/partner/sign-in', { email: 'dana@ironroom.example.invalid', password }, '', ORIGIN, from(ip));
    const a = await (await signIn('wrong-password', '198.51.100.1')).text();
    const b = await (await http.post('/partner/sign-in', { email: 'nobody@example.invalid', password: 'wrong-password' }, '', ORIGIN, from('198.51.100.1'))).text();
    const message = (html: string) => /pt-alert-error[^>]*>([^<]*)</.exec(html)?.[1];
    assert.equal(message(a), message(b));
    for (let i = 0; i < 8; i++) await signIn('guess-' + i, '198.51.100.1');
    for (let i = 0; i < 5; i++) assert.equal((await signIn('correct-horse-9', '198.51.100.1')).status, 303, 'correct passwords do not count');
    await signIn('guess-x', '198.51.100.1');
    assert.equal((await signIn('correct-horse-9', '198.51.100.1')).status, 429, 'ten failures from this address');
    assert.equal((await signIn('correct-horse-9', '203.0.113.7')).status, 303, 'the partner can still sign in from elsewhere');
    // The address is read from the right of X-Forwarded-For: a client cannot pick a fresh one by writing on the left.
    assert.equal((await signIn('correct-horse-9', '192.0.2.99, 198.51.100.1')).status, 429);
  }, { trustProxy: true, proxyHops: 1 });
});

test('the client address comes from the trusted proxies, never from what the client wrote', () => {
  const request = (xff: string | undefined, remote = '10.0.0.5') => ({ headers: xff === undefined ? {} : { 'x-forwarded-for': xff }, socket: { remoteAddress: remote } }) as unknown as IncomingMessage;
  assert.equal(clientIp(request('203.0.113.9'), false), '10.0.0.5', 'no proxy trusted: the socket');
  assert.equal(clientIp(request('6.6.6.6, 203.0.113.9'), true, 1), '203.0.113.9', 'one proxy: the rightmost entry');
  assert.equal(clientIp(request('6.6.6.6, 203.0.113.9, 172.70.1.1'), true, 2), '203.0.113.9', 'two proxies: second from the right');
  assert.equal(clientIp(request('203.0.113.9'), true, 2), '10.0.0.5', 'a chain shorter than the proxies: the socket');
  assert.equal(clientIp(request(undefined), true, 1), '10.0.0.5');
});

test('a referral link counts a visit with its code and channel, then sends the person to the clinic', async () => {
  const store = openStore(':memory:', false); const clinic = hub(store);
  await serve(store, async http => {
    const { code } = await joinAs(http, store, clinic);
    const first = await http.get(`/r/${code}?via=qr`);
    assert.equal(first.status, 302);
    assert.equal(first.headers.get('location'), `https://booking.example.invalid/${clinic}?ref=${code}`);
    const seen = cookieOf(first);
    assert.equal((await http.get(`/r/${code}?via=qr`, seen)).status, 302, 'the same browser again: still redirected');
    const lower = await http.get(`/r/${code.toLowerCase()}?via=qr`);
    assert.equal(lower.status, 301, 'a lower-case link goes to the canonical one first');
    assert.equal(lower.headers.get('location'), `/r/${code}?via=qr`);
    await http.get(`/r/${code}`, '', { 'User-Agent': 'Mozilla/5.0 (Linux; Android 13; CUBOT P80) AppleWebKit/537.36 Chrome/118 Mobile Safari/537.36' });
    await http.head(`/r/${code}`);
    await http.get(`/r/${code}`, '', { 'User-Agent': 'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)' });
    await http.get(`/r/${code}`, '', { 'Sec-Purpose': 'prefetch' });
    assert.deepEqual(rows(store, 'SELECT code,day,channel,count FROM referral_visits ORDER BY channel'), [
      { code, day: dayOf(Date.now()), channel: 'link', count: 1 },
      { code, day: dayOf(Date.now()), channel: 'qr', count: 1 },
    ], 'repeat, lower-case redirect, HEAD, link preview and prefetch are not visits; a Cubot phone is');
    assert.equal((await http.get('/r/ZZZZZZZZ')).status, 404);
    assert.equal((await http.get('/r/%E0%A4%A')).status, 404, 'a broken escape is just an inactive link');
    store.partners.setPartnerStatus(clinic, code, 'paused');
    assert.equal((await http.get(`/r/${code}`)).status, 404, 'a paused partner link is not active');
  });
});

test('one connection counts at most three visits a day per code, and storage stays one row per code, day and channel', async () => {
  const store = openStore(':memory:', false); const clinic = hub(store);
  await serve(store, async http => {
    const { code } = await joinAs(http, store, clinic);
    for (let i = 0; i < 25; i++) assert.equal((await http.get(`/r/${code}`)).status, 302, 'everyone is still sent on');
    assert.deepEqual(rows(store, 'SELECT count FROM referral_visits'), [{ count: 3 }]);
  });
});

test('counting a visit can never stop the person reaching the clinic', async () => {
  const store = openStore(':memory:', false); const clinic = hub(store);
  await serve(store, async http => {
    const { code } = await joinAs(http, store, clinic);
    store.partners.recordVisit = () => { throw new Error('database is locked'); };
    const response = await http.get(`/r/${code}`);
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), `https://booking.example.invalid/${clinic}?ref=${code}`);
  });
});

test('with only a phone number, the referral link opens a call page that asks for nothing and carries no partner-portal links', async () => {
  const store = openStore(':memory:', false);
  store.createClient('phone-clinic', 'Phone Only Clinic', 'phone-owner', 'clinic-password-1');
  store.partners.setDestination('phone-clinic', { phone: '+16305550100' });
  await serve(store, async http => {
    const { code, cookie, dash } = await joinAs(http, store, 'phone-clinic');
    assert.match(dash, /a page with Phone Only Clinic&rsquo;s phone number, to call and book/);
    assert.match(await (await http.get('/partner/print', cookie)).text(), /Scan to call and book/);
    const html = await (await http.get(`/r/${code}`)).text();
    assert.match(html, /href="tel:\+16305550100"/);
    assert.match(html, /\(630\) 555-0100/);
    assert.doesNotMatch(html, /<form|<input/, 'no form, no fields');
    assert.doesNotMatch(html, /\/partner\/sign-in|271-6851|Partner portal/, 'nothing about the partner portal');
  });
});

test('if a clinic has nowhere to send people, partners are told to hold off and visits are not counted', async () => {
  const store = openStore(':memory:', false); const clinic = hub(store);
  await serve(store, async http => {
    const { code, cookie } = await joinAs(http, store, clinic);
    store.db.prepare('DELETE FROM clinic_destinations WHERE clinic_id=?').run(clinic);
    const dash = await (await http.get('/partner', cookie)).text();
    assert.match(dash, /Hold off on sharing for now/);
    assert.doesNotMatch(dash, /go straight to/);
    assert.match(await (await http.get('/partner/print', cookie)).text(), /Hold off on printing/);
    const visit = await http.get(`/r/${code}`);
    assert.equal(visit.status, 200);
    assert.match(await visit.text(), /hasn.t added its booking details yet/);
    assert.equal(rows(store, 'SELECT 1 FROM referral_visits').length, 0);
  });
});

test('nothing stored about a visit or a reported outcome can identify a person', () => {
  const store = openStore(':memory:', false);
  try {
    const columns = (table: string) => rows(store, `PRAGMA table_info(${table})`).map(r => r.name).sort();
    assert.deepEqual(columns('referral_visits'), ['channel', 'code', 'count', 'day']);
    assert.deepEqual(columns('referral_outcomes'), ['code', 'count', 'day', 'id', 'report_id', 'status']);
    const bad = outcomeReport.safeParse({ from: '2026-10-01', to: '2026-10-31', reports: ['received'], entries: [{ code: 'AB23CD45', day: '2026-10-02', received: 1, name: 'A Person' }] });
    assert.equal(bad.success, false, 'an outcome entry with a name is refused');
  } finally { store.close(); }
});

test('dashboard counts come from the database only: empty, then visits, then what the clinic reported', async () => {
  const store = openStore(':memory:', false); const clinic = hub(store);
  await serve(store, async http => {
    const { cookie, code, dash } = await joinAs(http, store, clinic);
    assert.deepEqual(tiles(dash), ['0', 'Not reported yet', 'Not reported yet'], 'referrals and bookings are not shown as zero');
    assert.match(dash, /Your referral activity will appear here after someone uses your link\./);
    const month = dayOf(Date.now()).slice(0, 7);
    const emptyReport = await (await http.get('/partner/report', cookie)).text();
    assert.equal((emptyReport.match(/<td class="num pt-muted" data-label="[^"]+">Not reported<\/td>/g) ?? []).length, 2);
    assert.match(await (await http.get('/partner/report.csv', cookie)).text(), new RegExp(`${month},${code},\\d+,0,not reported,0,not reported,0`));
    await http.get(`/r/${code}?via=qr`); await http.get(`/r/${code}`, '', { 'User-Agent': BROWSER + ' second' });
    const today = dayOf(Date.now());
    assert.equal(store.partners.reportOutcomes(clinic, outcomeReport.parse({ from: today, to: today, reports: ['received'], entries: [{ code, day: today, received: 2 }] })), 1);
    const after = await (await http.get('/partner', cookie)).text();
    assert.deepEqual(tiles(after), ['2', '2', 'Not reported yet'], 'visits, referrals recorded, bookings still not reported');
    assert.match(after, /Visits from the QR code/);
    assert.match(after, /Referrals the clinic recorded \(month total\)/);
    assert.doesNotMatch(after, /Bookings the clinic reported \(month total\)/);
    // Re-reporting the same day replaces it; reporting bookings as zero makes zero a real number.
    store.partners.reportOutcomes(clinic, outcomeReport.parse({ from: today, to: today, reports: ['received', 'booked'], entries: [{ code, day: today, received: 1, booked: 0 }] }));
    assert.deepEqual(tiles(await (await http.get('/partner', cookie)).text()), ['2', '1', '0']);
    const csv = (await (await http.get('/partner/report.csv', cookie)).text()).trim().split('\r\n');
    assert.equal(csv[0], 'month,code,days_counted,link_and_qr_visits,referrals_recorded_by_clinic,days_with_referrals_reported,bookings_reported_by_clinic,days_with_bookings_reported');
    assert.equal(csv[1], `${month},${code},1,2,1,1,0,1`);
  });
});

test('a clinic cannot report days that have not happened, or days before a code existed, or codes it does not own', () => {
  const store = openStore(':memory:', false);
  try {
    const clinic = hub(store);
    const invite = store.partners.createInvitation(clinic);
    const joined = store.partners.join(invite.token, joinInput.parse({ businessName: 'Gamma Studio', contactName: 'G Test', email: 'g@example.invalid', password: 'gamma-pass-123', confirm: 'gamma-pass-123', agree: 'yes' }), 'test');
    assert.ok(joined.ok); if (!joined.ok) return;
    const session = store.partners.session(joined.token)!;
    const month = dayOf(Date.now()).slice(0, 7);
    const report = store.partners.report(session, month, month);
    assert.equal(report.rows.length, 1);
    assert.equal(report.rows[0].received, null);
    assert.equal(report.rows[0].booked, null);
    const code = report.rows[0].code;
    const tomorrow = dayOf(Date.now() + 36 * 3600 * 1000);
    assert.throws(() => store.partners.reportOutcomes(clinic, outcomeReport.parse({ from: dayOf(Date.now()), to: tomorrow, reports: ['booked'], entries: [] })), /after today/);
    assert.throws(() => store.partners.reportOutcomes(clinic, outcomeReport.parse({ from: '2020-01-01', to: '2020-01-31', reports: ['received'], entries: [{ code, day: '2020-01-05', received: 1 }] })), /before the code existed/);
    assert.throws(() => store.partners.reportOutcomes('other-clinic', outcomeReport.parse({ from: '2026-10-01', to: '2026-10-01', reports: ['received'], entries: [{ code, day: '2026-10-01', received: 1 }] })), /do not belong/);
    assert.equal(store.partners.report(session, month, month).rows[0].booked, null, 'nothing was recorded by the refused imports');
  } finally { store.close(); }
});

test('a partner who leaves loses the sign-in and the link; the clinic keeps the business name and the counts', async () => {
  const store = openStore(':memory:', false); const clinic = hub(store);
  await serve(store, async http => {
    const { cookie, code } = await joinAs(http, store, clinic);
    await http.get(`/r/${code}`);
    assert.match(await (await http.get('/partner/details', cookie)).text(), /Leaving the network/);
    assert.equal(store.partners.removePartner(clinic, code), true);
    assert.equal((await http.get('/partner', cookie)).status, 303, 'signed out');
    assert.equal((await http.post('/partner/sign-in', { email: 'dana@ironroom.example.invalid', password: 'correct-horse-9' })).status, 401);
    assert.equal((await http.get(`/r/${code}`)).status, 404);
    const [left] = store.partners.listPartners(clinic);
    assert.deepEqual({ name: left.business_name, contact: left.contact_name, email: left.email, status: left.status }, { name: 'The Iron Room', contact: '', email: null, status: 'left' });
    assert.equal(rows(store, 'SELECT 1 FROM partner_users').length, 0);
    assert.equal(rows(store, 'SELECT 1 FROM referral_visits').length, 1);
    assert.equal(store.partners.setPartnerStatus(clinic, code, 'active'), false, 'a partner who left cannot be switched back on');
  });
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

test('partner styles: the hidden attribute always hides, and form fields have a visible edge (3:1)', () => {
  const css = readFileSync(new URL('../public/assets/partner.css', import.meta.url), 'utf8');
  assert.match(css, /\[hidden\]\{display:none!important\}/);
  const control = /--control:(#[0-9A-F]{6})/i.exec(css)?.[1] ?? '';
  const lum = (hex: string) => { const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  for (const bg of ['#FFFFFF', '#FDFEFC']) assert.ok((lum(bg) + 0.05) / (lum(control) + 0.05) >= 3, `${control} on ${bg}`);
  assert.match(css, /\.pt-field input,\.pt-field select,\.pt-copy input\{[^}]*border:1px solid var\(--control\)/);
});
