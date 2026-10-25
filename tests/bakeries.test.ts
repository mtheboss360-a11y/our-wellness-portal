import test from 'node:test';
import assert from 'node:assert/strict';
import { openStore } from '../server/store';
import { bakeriesOnly, bakeryPayload, ensureBakeries } from '../server/network/bakeries';
import type { DiscoveredPlace } from '../server/network/places';

const place = (placeId: string, name: string): DiscoveredPlace => ({ placeId, name, address: 'Westmont, IL 60559', lat: 41.79, lng: -87.97, types: ['bakery'], primaryType: 'bakery', businessStatus: 'OPERATIONAL', rating: 4.7, reviewCount: 80, googleMapsUri: null });

test('bakeries: local ones, Panera and Krispy Kreme; no other chains', () => {
  const kept = bakeriesOnly([place('a', 'Panera Bread'), place('b', 'Panera Bread'), place('c', 'Krispy Kreme'), place('d', 'Maple Glaze Donut Co.'),
    place('e', "Dunkin'"), place('f', 'Crumbl Cookies'), place('g', 'Nothing Bundt Cakes'), place('h', 'Jewel-Osco Bakery'), place('i', 'Twin Oven'), place('j', 'Twin Oven')]).map(p => p.placeId);
  assert.deepEqual(kept, ['a', 'b', 'c', 'd']);
});

test('the sample clinic gets its bakeries without Google, and can choose one', async () => {
  const previous = process.env.Google_places_API; delete process.env.Google_places_API;
  const store = openStore(':memory:');
  store.createClient('orchard-lantern', 'Orchard Lantern', 'sample', 'password-s-123');
  try {
    await ensureBakeries(store, 'orchard-lantern');
    const payload = bakeryPayload(store, 'orchard-lantern', 'Orchard Lantern');
    assert.equal(payload.bakeries.length, 10);
    assert.ok(payload.bakeries.some(b => b.kind === 'panera') && payload.bakeries.some(b => b.kind === 'krispy-kreme') && payload.bakeries.some(b => b.kind === 'local'));
    assert.equal(store.chooseBakery('orchard-lantern', payload.bakeries[0].placeId), true);
    assert.equal(store.chooseBakery('orchard-lantern', 'not-on-the-list'), false);
    assert.equal(bakeryPayload(store, 'orchard-lantern', 'x').choice, payload.bakeries[0].placeId);
  } finally { store.close(); if (previous !== undefined) process.env.Google_places_API = previous; }
});

test('an items request is checked, saved and makes that bakery the clinic\'s bakery', async () => {
  const { createPortalServer } = await import('../server/http');
  
  const previous = process.env.Google_places_API; delete process.env.Google_places_API;
  const store = openStore(':memory:');
  store.createClient('orchard-lantern', 'Orchard Lantern', 'sample', 'password-s-123');
  const server = createPortalServer({ store, origin: 'http://portal.test', secure: false, root: process.cwd() });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`;
  const post = (path: string, body: unknown, cookie = '') => fetch(base + path, { method: 'POST', headers: { Origin: 'http://portal.test', 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) });
  try {
    const cookie = (await post('/api/login', { username: 'sample', password: 'password-s-123' })).headers.get('set-cookie')!.split(';')[0];
    const list = await (await fetch(base + '/api/network/bakeries', { headers: { Cookie: cookie } })).json();
    const placeId = list.bakeries[0].placeId;
    const form = { placeId, items: '2 dozen donuts', people: 20, neededBy: '2030-01-10', contactName: 'Dana', contactPhone: '', notes: '' };
    assert.equal((await post('/api/network/bakery-request', { ...form, items: '' }, cookie)).status, 400, 'items are required');
    assert.equal((await post('/api/network/bakery-request', { ...form, placeId: 'nope' }, cookie)).status, 400, 'only a bakery on the list');
    const ok = await post('/api/network/bakery-request', form, cookie);
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).choice, placeId);
    assert.equal((store.db.prepare('SELECT COUNT(*) AS n FROM bakery_requests').get() as { n: number }).n, 1);
  } finally { server.close(); store.close(); if (previous !== undefined) process.env.Google_places_API = previous; }
});

test('a clinic can take a bakery off its list and bring removed ones back', async () => {
  const store = openStore(':memory:');
  store.createClient('orchard-lantern', 'Orchard Lantern', 'sample', 'password-s-123');
  try {
    await ensureBakeries(store, 'orchard-lantern');
    const first = bakeryPayload(store, 'orchard-lantern', 'x').bakeries[0].placeId;
    store.chooseBakery('orchard-lantern', first);
    store.hideBakery('orchard-lantern', first);
    const after = bakeryPayload(store, 'orchard-lantern', 'x');
    assert.equal(after.bakeries.length, 9);
    assert.equal(after.removed, 1);
    assert.equal(after.choice, null, 'a removed bakery is no longer the chosen one');
    store.restoreBakeries('orchard-lantern');
    assert.equal(bakeryPayload(store, 'orchard-lantern', 'x').bakeries.length, 10);
  } finally { store.close(); }
});
