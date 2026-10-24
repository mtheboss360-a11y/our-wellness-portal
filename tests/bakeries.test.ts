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
