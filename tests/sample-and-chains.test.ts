import test from 'node:test';
import assert from 'node:assert/strict';
import { openStore } from '../server/store';
import { ensureDiscovery } from '../server/network/map';
import { chainFilter } from '../server/network/chains';
import type { DiscoveredPlace } from '../server/network/places';

const place = (placeId: string, name: string): DiscoveredPlace => ({ placeId, name, address: 'Westmont, IL 60559', lat: 41.79, lng: -87.97, types: ['gym'], primaryType: 'gym', businessStatus: 'OPERATIONAL', rating: null, reviewCount: null, googleMapsUri: null });

test('chains are dropped: known names, and any name seen at two places nearby', () => {
  const chain = chainFilter(['Planet Fitness', 'Quarry Lane Fitness', 'Iron Oak Gym', 'Iron Oak Gym']);
  assert.equal(chain('Planet Fitness'), true);
  assert.equal(chain('Orangetheory Fitness Westmont'), true);
  assert.equal(chain('Iron Oak Gym'), true, 'two locations nearby');
  assert.equal(chain('Quarry Lane Fitness'), false, 'owner-operated stays');
});

test('the map hides chains', () => {
  const store = openStore(':memory:');
  store.createClient('clinic-a', 'Clinic A', 'clinica', 'password-a-123');
  store.setClinicLocation({ clinicId: 'clinic-a', label: 'x', lat: 41.8, lng: -87.97, radiusMiles: 5, placeId: null, competitorCategories: [] });
  store.saveDiscovery('clinic-a', [place('a', 'LA Fitness'), place('b', 'Quarry Lane Fitness')]);
  assert.deepEqual(store.businesses('clinic-a').map(b => b.name), ['Quarry Lane Fitness']);
  store.close();
});

test('the sample clinic gets its fixed map with no Places key and no location from a device', async () => {
  const previous = process.env.Google_places_API; delete process.env.Google_places_API;
  const store = openStore(':memory:');
  store.createClient('orchard-lantern', 'Orchard Lantern', 'sample', 'password-s-123');
  try {
    const outcome = await ensureDiscovery(store, 'orchard-lantern');
    assert.equal(outcome.found, 17);
    assert.ok(store.clinicLocation('orchard-lantern'), 'its spot is set for it');
    const map = store.networkMap('orchard-lantern', 'Orchard Lantern');
    assert.equal(map.businesses.length, 17);
    assert.ok(map.businesses.every(b => b.placeId.startsWith('sample-')));
  } finally { store.close(); if (previous !== undefined) process.env.Google_places_API = previous; }
});
