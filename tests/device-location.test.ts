import test from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { openStore } from '../server/store';
import { createPortalServer } from '../server/http';

// With no Places key in the environment, discovery is skipped, so these tests make no Google calls.
test('a clinic can set its location from its device once, signed in, and only a close enough fix', async () => {
  const previous = process.env.Google_places_API; delete process.env.Google_places_API;
  const store = openStore(':memory:');
  store.createClient('clinic-a', 'Clinic A', 'clinica', 'password-a-123');
  const server = createPortalServer({ store, origin: 'http://portal.test', secure: false, root: process.cwd() });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = (path: string, body: unknown, cookie = '') => fetch(base + path, { method: 'POST', headers: { Origin: 'http://portal.test', 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) });
  try {
    const page = await fetch(base + '/');
    assert.match(page.headers.get('permissions-policy') ?? '', /geolocation=\(self\)/, 'the page may ask for a location');
    assert.equal((await post('/api/network/location', { lat: 41.83, lng: -87.93 })).status, 401, 'signed in only');
    const cookie = (await post('/api/login', { username: 'clinica', password: 'password-a-123' })).headers.get('set-cookie')!.split(';')[0];
    assert.equal((await post('/api/network/location', { lat: 200, lng: -87.93 }, cookie)).status, 400, 'a latitude off the planet is refused');
    assert.equal((await post('/api/network/location', { lat: 41.83, lng: -87.93, accuracy: 5000 }, cookie)).status, 400, 'a fix five kilometres wide is refused');
    const ok = await post('/api/network/location', { lat: 41.8328, lng: -87.929, accuracy: 25 }, cookie);
    assert.equal(ok.status, 200);
    const map = await ok.json();
    assert.equal(map.clinic.location.label, 'Set from your device');
    assert.equal(store.clinicLocation('clinic-a')?.lat, 41.8328);
    assert.equal((await post('/api/network/location', { lat: 40, lng: -88 }, cookie)).status, 409, 'once set, only the team moves it');
    assert.equal(store.clinicLocation('clinic-a')?.lat, 41.8328);
  } finally { server.close(); store.close(); if (previous !== undefined) process.env.Google_places_API = previous; }
});
