// THE ROLE BOUNDARY.
//
// These drive the real HTTP server, not the store, because the claim being tested is about
// what the API answers. A test against the store would pass while the endpoint happily
// returned a visit script to a practice owner, and hiding the button in the browser is not a
// boundary — the endpoint is one fetch away from anybody who opens the network tab.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../server/store.ts';
import { createPortalServer } from '../server/http.ts';
import type { Script } from '../server/outreach.ts';

const script = (): Script => ({
  opening: 'Say this at the door.', introduction: 'i', value: 'v', ask: 'a',
  objections: { busy: 'b', notInterested: 'n', alreadyPartnered: 'p' }, closing: 'c', followUp: 'f',
});

async function portal() {
  const dir = mkdtempSync(join(tmpdir(), 'owp-roles-'));
  const store = openStore(join(dir, 'p.sqlite'), false);
  store.createClient('hyline', 'Hyline Dental', 'owner', 'pw-owner-1234', 'b');
  store.createClient('hyline', 'Hyline Dental', 'rep', 'pw-staff-1234', 'b', false, { displayName: 'Alexis' });
  store.createClient('hyline', 'Hyline Dental', 'legacy', 'pw-legacy-123', 'b');
  store.setRole('owner', 'owner');
  store.setRole('rep', 'staff');
  // 'legacy' is left with no role on purpose: it is the account that existed before roles.

  store.outreach.release('hyline', 'r1', 'Release 1', 't', [{
    name: 'Karve Pilates', category: 'Pilates studio', address: '4827 Rte 59, Naperville, IL',
    script: script(),
  }], false);

  // The origin check compares against a configured value, so the server is started on a known
  // port and told that is where it lives.
  const port = 4300 + Math.floor(Math.random() * 400);
  const base = `http://127.0.0.1:${port}`;
  const server = createPortalServer({ store, origin: base, secure: false, root: dir });
  await new Promise<void>(done => server.listen(port, '127.0.0.1', done));

  async function signIn(username: string, password: string) {
    const res = await fetch(`${base}/api/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base },
      body: JSON.stringify({ username, password }),
    });
    const cookie = res.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
    assert.ok(cookie, `${username} should have signed in`);
    return cookie;
  }
  const get = (path: string, cookie: string) => fetch(`${base}${path}`, { headers: { cookie } });
  const post = (path: string, cookie: string, body: unknown) => fetch(`${base}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', cookie, Origin: base },
    body: JSON.stringify(body),
  });

  const businessId = store.outreach.businesses('hyline')[0].id;
  const close = async () => {
    await new Promise<void>(done => server.close(() => done()));
    store.close(); rmSync(dir, { recursive: true, force: true });
  };
  return { store, base, signIn, get, post, businessId, close };
}

test('a practice owner is not given the visit script, by the API', async () => {
  const p = await portal();
  const cookie = await p.signIn('owner', 'pw-owner-1234');
  const body = await (await p.get(`/api/outreach/business?id=${p.businessId}`, cookie)).json();

  assert.equal(body.business.name, 'Karve Pilates', 'the owner does see their own business');
  assert.equal(body.script, null, 'and is not given the script');
  assert.doesNotMatch(JSON.stringify(body), /Say this at the door/,
    'the words are nowhere in the payload, not merely hidden on screen');
  await p.close();
});

test('a staff member is given the script', async () => {
  const p = await portal();
  const cookie = await p.signIn('rep', 'pw-staff-1234');
  const body = await (await p.get(`/api/outreach/business?id=${p.businessId}`, cookie)).json();
  assert.equal(body.script.script.opening, 'Say this at the door.');
  await p.close();
});

test('a practice owner cannot record a visit', async () => {
  const p = await portal();
  const cookie = await p.signIn('owner', 'pw-owner-1234');
  const res = await p.post('/api/outreach/visit', cookie, {
    businessId: p.businessId, visitedOn: '2026-10-27', outcome: 'interested',
  });
  assert.equal(res.status, 403);
  assert.match((await res.json()).error, /An owner account cannot record a visit/);
  assert.equal(p.store.outreach.visits('hyline').length, 0, 'and nothing was written');
  await p.close();
});

test('a practice owner cannot rewrite a visit script', async () => {
  const p = await portal();
  const cookie = await p.signIn('owner', 'pw-owner-1234');
  const res = await p.post('/api/outreach/script', cookie, {
    businessId: p.businessId,
    script: { opening: 'mine', introduction: 'i', value: 'v', ask: 'a',
      objections: { busy: 'b', notInterested: 'n', alreadyPartnered: 'p' }, closing: 'c', followUp: 'f' },
  });
  assert.equal(res.status, 403);
  assert.equal(p.store.outreach.script('hyline', p.businessId)!.script.opening, 'Say this at the door.');
  await p.close();
});

test('a staff member can record a visit', async () => {
  const p = await portal();
  const cookie = await p.signIn('rep', 'pw-staff-1234');
  const res = await p.post('/api/outreach/visit', cookie, {
    businessId: p.businessId, visitedOn: '2026-10-27', outcome: 'interested', materials: 8,
  });
  assert.equal(res.status, 200);
  assert.equal(p.store.outreach.visits('hyline').length, 1);
  await p.close();
});

test('an account with no role keeps the access it had before roles existed', async () => {
  // The migration state. Deploying the boundary must not lock a live client out of a portal
  // that worked yesterday.
  const p = await portal();
  const cookie = await p.signIn('legacy', 'pw-legacy-123');
  const body = await (await p.get(`/api/outreach/business?id=${p.businessId}`, cookie)).json();
  assert.equal(body.script.script.opening, 'Say this at the door.');
  const res = await p.post('/api/outreach/visit', cookie, {
    businessId: p.businessId, visitedOn: '2026-10-27', outcome: 'interested',
  });
  assert.equal(res.status, 200);
  await p.close();
});

test('the session tells the browser its role, and the audit marks the unassigned', async () => {
  const p = await portal();
  const cookie = await p.signIn('owner', 'pw-owner-1234');
  const snapshot = await (await p.get('/api/portal', cookie)).json();
  assert.equal(snapshot.role, 'owner');

  const roles = Object.fromEntries(p.store.logins().map(l => [l.username, l.role]));
  assert.deepEqual(roles, { owner: 'owner', rep: 'staff', legacy: null });
  await p.close();
});

test('a role change does not reach across practices', async () => {
  const p = await portal();
  p.store.createClient('other', 'Another Practice', 'theirs', 'pw-other-1234', 'b');
  p.store.setRole('owner', 'staff');
  const theirs = p.store.logins().find(l => l.username === 'theirs')!;
  assert.equal(theirs.role, null, 'the neighbour is untouched');
  assert.throws(() => p.store.setRole('nobody', 'owner'), /No login called/);
  await p.close();
});

// ── WHERE A SIGN-IN LANDS ───────────────────────────────────────────────────
// The portal keeps the open section in ?v=, which outlives a session: signing out on Visit
// history and back in an hour later dropped you into Visit history. These cover the rule
// without a browser, by driving the same sessionStorage the components use.
test('a sign-in is fresh once, and not again until the session ends', async () => {
  const store: Record<string, string> = {};
  (globalThis as { sessionStorage?: unknown }).sessionStorage = {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => { store[k] = v; },
    removeItem: (k: string) => { delete store[k]; },
  };
  const { isFreshSignIn, endSession } = await import('../src/lib/landing.ts');

  assert.equal(isFreshSignIn(), true, 'the first mount after signing in');
  assert.equal(isFreshSignIn(), false, 'a refresh is not a new sign-in');
  assert.equal(isFreshSignIn(), false);

  endSession();
  assert.equal(isFreshSignIn(), true, 'signing out and back in is');
  delete (globalThis as { sessionStorage?: unknown }).sessionStorage;
});

test('without sessionStorage it reports not-fresh, which is the old behaviour', async () => {
  // A locked-down private window. Falling back to "restore the URL" is never worse than before.
  (globalThis as { sessionStorage?: unknown }).sessionStorage = {
    getItem() { throw new Error('denied'); },
    setItem() { throw new Error('denied'); },
    removeItem() { throw new Error('denied'); },
  };
  const { isFreshSignIn, endSession } = await import('../src/lib/landing.ts');
  assert.equal(isFreshSignIn(), false);
  assert.doesNotThrow(() => endSession());
  delete (globalThis as { sessionStorage?: unknown }).sessionStorage;
});

test('a business name too long for a bubble is cut, not spilled', async () => {
  // The splitter is not exported, so this is the same rule stated once more. It exists
  // because an over-long second line draws outside the circle it belongs to, and the full
  // name is always readable in the connections list underneath.
  const twoLines = (name: string, perLine = 13): [string, string | null] => {
    if (name.length <= perLine) return [name, null];
    const words = name.split(/\s+/);
    if (words.length === 1) return [name.slice(0, perLine), name.slice(perLine)];
    let first = '';
    for (const word of words) {
      if (first && (`${first} ${word}`).length > perLine) break;
      first = first ? `${first} ${word}` : word;
    }
    const rest = name.slice(first.length).trim();
    if (!rest) return [first, null];
    return [first, rest.length > perLine + 5 ? `${rest.slice(0, perLine + 4).trimEnd()}…` : rest];
  };

  assert.deepEqual(twoLines('Yoga Cave'), ['Yoga Cave', null], 'a short name stays on one line');
  assert.deepEqual(twoLines('KidSnips Naperville'), ['KidSnips', 'Naperville']);
  assert.deepEqual(twoLines('Fieldstone Physical Therapy'), ['Fieldstone', 'Physical Therapy']);

  const [, second] = twoLines('Cedar Spine & Wellness Chiropractic Associates');
  assert.ok(second && second.length <= 18, `the second line is cut, got ${second?.length}`);
  assert.ok(second!.endsWith('…'), 'and says it was cut');
});
