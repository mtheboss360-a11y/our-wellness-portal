import test from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { openStore } from '../server/store';
import { createPortalServer } from '../server/http';
import { crossReference, fitScore, addressKey, nameKey, matchRecords } from '../server/network/network';
import { categoryForTypes, CATEGORY_RULES, MAX_ROUTE_STOPS, GOOGLE_RETENTION_DAYS, discoveryQueries } from '../server/network/config';
import { haversineMiles, plotOffset, withinRadius } from '../server/network/geo';
import { discoverNearby, normalizePlace, configured, type DiscoveredPlace } from '../server/network/places';
import { directionsUrl, filterBusinesses, mapsPlaceUrl, markers, spread, type MapBusiness } from '../src/lib/network-math';

// A clinic in Naperville, and five fictional neighbours around it. No real business names and
// no real place IDs: the place IDs are obviously fake strings so nothing here can be mistaken
// for Google content, and nothing is written to a live database.
const CLINIC = { clinic: 'test-wellness', name: 'Test Wellness Clinic', username: 'testwellness', password: 'test-password-123' };
const RIVAL = { clinic: 'rival-clinic', name: 'Rival Wellness Rooms', username: 'rivalrooms', password: 'rival-password-123' };
const HERE = { lat: 41.7508, lng: -88.1535 };

const place = (over: Partial<DiscoveredPlace> & { placeId: string }): DiscoveredPlace => ({
  name: 'A Business', address: '1 Test Street, Naperville, IL 60540', lat: 41.7552, lng: -88.1549,
  types: ['gym'], primaryType: 'gym', businessStatus: 'OPERATIONAL', rating: null, reviewCount: null, googleMapsUri: null, ...over,
});
const NEIGHBOURS: DiscoveredPlace[] = [
  place({ placeId: 'fake-gym', name: 'Test Strength Room', types: ['gym'], primaryType: 'gym' }),
  place({ placeId: 'fake-yoga', name: 'Test Yoga Loft', types: ['yoga_studio'], primaryType: 'yoga_studio', lat: 41.7601, lng: -88.1502, address: '2 Test Street, Naperville, IL 60540' }),
  place({ placeId: 'fake-salon', name: 'Test Hair Studio', types: ['hair_salon'], primaryType: 'hair_salon', lat: 41.7478, lng: -88.1601, address: '3 Test Street, Naperville, IL 60540', rating: 4.9, reviewCount: 412 }),
  place({ placeId: 'fake-medspa', name: 'Test Med Spa', types: ['wellness_center'], primaryType: 'wellness_center', lat: 41.7521, lng: -88.1488, address: '4 Test Street, Naperville, IL 60540' }),
  place({ placeId: 'fake-chiro', name: 'Test Spine Care', types: ['chiropractor'], primaryType: 'chiropractor', lat: 41.7700, lng: -88.1400, address: '5 Test Street, Naperville, IL 60540' }),
];

function portal() {
  const store = openStore(':memory:', false);
  store.createClient(CLINIC.clinic, CLINIC.name, CLINIC.username, CLINIC.password);
  store.createClient(RIVAL.clinic, RIVAL.name, RIVAL.username, RIVAL.password);
  store.setClinicLocation({ clinicId: CLINIC.clinic, label: '100 Test Street, Naperville, IL 60540', lat: HERE.lat, lng: HERE.lng, radiusMiles: 5, placeId: null, competitorCategories: [] });
  store.saveDiscovery(CLINIC.clinic, NEIGHBOURS);
  return store;
}

test('distance maths refuses to invent a coordinate', () => {
  assert.ok(Number.isNaN(haversineMiles(HERE.lat, HERE.lng, null, -88.15)));
  assert.ok(Number.isNaN(haversineMiles(HERE.lat, HERE.lng, '', '')));
  assert.equal(withinRadius(null, null, HERE.lat, HERE.lng, 50), false, 'a missing point is not inside the circle');
  assert.ok(Math.abs(haversineMiles(41.7508, -88.1535, 41.7601, -88.1502) - 0.67) < 0.1);
  assert.equal(Math.round(haversineMiles(41.8781, -87.6298, 41.7508, -88.1535) * 10) / 10, 28.4, 'Chicago to Naperville');
});

test('the plot places a business north and east of the clinic, scaled to the radius', () => {
  const north = plotOffset(HERE.lat, HERE.lng, HERE.lat + 0.03, HERE.lng, 5);
  assert.ok(north.y < 0 && Math.abs(north.x) < 1e-9, 'north is up');
  const east = plotOffset(HERE.lat, HERE.lng, HERE.lat, HERE.lng + 0.03, 5);
  assert.ok(east.x > 0 && Math.abs(east.y) < 1e-9, 'east is right');
  const near = plotOffset(HERE.lat, HERE.lng, HERE.lat + 0.03, HERE.lng, 10);
  assert.ok(Math.abs(near.y) < Math.abs(north.y), 'a wider radius pulls the same point toward the middle');
});

test('categories come from the rules, and irrelevant types match nothing', () => {
  assert.equal(categoryForTypes(['gym'], 'gym')?.id, 'fitness');
  assert.equal(categoryForTypes(['yoga_studio'], 'yoga_studio')?.id, 'yoga');
  assert.equal(categoryForTypes(['hair_salon', 'store'], 'hair_salon')?.id, 'salon');
  assert.equal(categoryForTypes(['restaurant', 'bar'], 'restaurant'), null, 'a restaurant is not a referral category');
  assert.equal(categoryForTypes(['gas_station'], 'gas_station'), null);
  // The primary type decides when a place carries several.
  assert.equal(categoryForTypes(['gym', 'yoga_studio'], 'yoga_studio')?.id, 'yoga');
  assert.ok(discoveryQueries().every(query => query.includedTypes.length > 0 && query.includedTypes.length <= 50), 'Nearby Search takes at most 50 types per list');
  assert.equal(discoveryQueries().length, CATEGORY_RULES.length, 'one search per category');
});

test('a fit score is explainable, and Google popularity is not one of its inputs', () => {
  const fitness = CATEGORY_RULES.find(rule => rule.id === 'fitness')!;
  const near = fitScore(fitness, 0.3), far = fitScore(fitness, 8);
  assert.ok(near.score > far.score, 'nearer scores higher');
  assert.equal(near.score, near.components.reduce((total, part) => total + part.points, 0), 'the score is the sum of its stated parts');
  assert.ok(near.components.every(part => part.detail.trim().length > 0), 'every part says why');
  assert.equal(fitScore(CATEGORY_RULES.find(rule => rule.id === 'med-spa')!, 0.1).components[0].points, 0, 'a competitor earns no category points');
  const words = JSON.stringify(fitScore(fitness, 1)).toLowerCase();
  assert.ok(!words.includes('rating') && !words.includes('review'), 'rating and review count are not score inputs');
});

test('name and address keys match the same business written two ways', () => {
  assert.equal(nameKey('The Oak St. Yoga Studio'), nameKey('Oak St Yoga'));
  assert.equal(addressKey('221 Main Street, Naperville, IL 60540'), '221-60540');
  assert.equal(addressKey('no number here'), '', 'an unmatchable address matches nothing');
  const matched = matchRecords({ placeId: 'fake-yoga', name: 'Test Yoga Loft', address: '2 Test Street, Naperville, IL 60540' },
    [{ id: 'r1', kind: 'partner', ownerClinicId: 'someone', placeId: 'fake-yoga', nameKey: null, addressKey: null, note: '' }]);
  assert.equal(matched.length, 1, 'a place ID is the strongest key');
});

test('the cross-reference refuses a competitor and an agreement before it allows anything', () => {
  const competitorPlace = { placeId: 'fake-medspa', name: 'Test Med Spa', address: '4 Test Street', types: ['wellness_center'], primaryType: 'wellness_center' };
  const asCompetitor = crossReference(competitorPlace, categoryForTypes(competitorPlace.types, competitorPlace.primaryType), [], CLINIC.clinic, []);
  assert.equal(asCompetitor.status, 'competitor');
  assert.equal(asCompetitor.routable, false);

  const gym = { placeId: 'fake-gym', name: 'Test Strength Room', address: '1 Test Street', types: ['gym'], primaryType: 'gym' };
  const category = categoryForTypes(gym.types, gym.primaryType);
  assert.equal(crossReference(gym, category, [], CLINIC.clinic, []).status, 'fit');

  // Held by another clinic, so unavailable; held by this clinic, so already in network.
  const exclusive = [{ id: 'x', kind: 'exclusive' as const, ownerClinicId: RIVAL.clinic, placeId: 'fake-gym', nameKey: null, addressKey: null, note: 'territory' }];
  const blocked = crossReference(gym, category, exclusive, CLINIC.clinic, []);
  assert.equal(blocked.status, 'unavailable');
  assert.equal(blocked.routable, false);
  assert.equal(crossReference(gym, category, [{ ...exclusive[0], ownerClinicId: CLINIC.clinic }], CLINIC.clinic, []).status, 'in-network');

  // Somebody else's partner needs a look before outreach, but a visit is not forbidden.
  const shared = crossReference(gym, category, [{ id: 'p', kind: 'partner', ownerClinicId: RIVAL.clinic, placeId: 'fake-gym', nameKey: null, addressKey: null, note: '' }], CLINIC.clinic, []);
  assert.equal(shared.status, 'review');
  assert.equal(shared.routable, true);

  // Both a flagged competitor and somebody's partner: the refusal wins.
  const both = crossReference(gym, category, [
    { id: 'p', kind: 'partner', ownerClinicId: RIVAL.clinic, placeId: 'fake-gym', nameKey: null, addressKey: null, note: '' },
    { id: 'c', kind: 'competitor', ownerClinicId: null, placeId: 'fake-gym', nameKey: null, addressKey: null, note: '' }], CLINIC.clinic, []);
  assert.equal(both.status, 'competitor');
  assert.equal(both.routable, false);

  // A do-not-approach record is refused for everyone, including the clinic that filed it.
  assert.equal(crossReference(gym, category, [{ id: 'b', kind: 'blocked', ownerClinicId: CLINIC.clinic, placeId: 'fake-gym', nameKey: null, addressKey: null, note: '' }], CLINIC.clinic, []).routable, false);

  // A clinic may declare an ordinarily referrable category a competitor of its own.
  assert.equal(crossReference(gym, category, [], CLINIC.clinic, ['fitness']).status, 'competitor');
});

test('a conflict warning never names, numbers or hints at the other clinic', () => {
  const store = portal();
  try {
    store.saveNetworkRecords([
      { id: 'rival-exclusive', kind: 'exclusive', ownerClinicId: RIVAL.clinic, placeId: 'fake-gym', note: 'Rival Wellness Rooms holds this block' },
      { id: 'rival-partner', kind: 'partner', ownerClinicId: RIVAL.clinic, placeId: 'fake-yoga', note: 'signed with Rival Wellness Rooms' },
    ]);
    const payload = JSON.stringify(store.networkMap(CLINIC.clinic, CLINIC.name));
    assert.ok(!payload.includes(RIVAL.clinic), 'the other clinic’s ID does not appear');
    assert.ok(!payload.includes('Rival'), 'the other clinic’s name does not appear');
    assert.ok(!payload.includes('ownerClinicId'), 'the owning clinic field never leaves the server');
    assert.ok(!payload.includes('holds this block'), 'the internal note is not published');
    const rows = store.businesses(CLINIC.clinic);
    assert.equal(rows.find(row => row.placeId === 'fake-gym')?.status, 'unavailable');
    assert.equal(rows.find(row => row.placeId === 'fake-yoga')?.status, 'review');
    for (const row of rows) assert.ok(row.statusReason.trim().length > 0, 'every status says why');
  } finally { store.close(); }
});

test('one clinic cannot see or reach another clinic’s map', () => {
  const store = portal();
  try {
    store.setClinicLocation({ clinicId: RIVAL.clinic, label: '900 Other Street, Aurora, IL 60505', lat: 41.76, lng: -88.32, radiusMiles: 5, placeId: null, competitorCategories: [] });
    store.saveDiscovery(RIVAL.clinic, [place({ placeId: 'fake-rival-only', name: 'Rival Only Gym', lat: 41.761, lng: -88.321 })]);
    assert.deepEqual(store.businesses(CLINIC.clinic).map(row => row.placeId).sort(), NEIGHBOURS.map(row => row.placeId).sort());
    assert.deepEqual(store.businesses(RIVAL.clinic).map(row => row.placeId), ['fake-rival-only']);
    // A borrowed place ID from another clinic's map cannot be put on this clinic's route.
    const saved = store.saveSelection(CLINIC.clinic, ['fake-rival-only']);
    assert.deepEqual(saved.selection, []);
    assert.equal(saved.refused.length, 1);
    assert.deepEqual(store.selection(RIVAL.clinic), [], 'nothing was written to the other clinic either');
  } finally { store.close(); }
});

test('a route takes at most five routable stops, and the server decides which', () => {
  const store = portal();
  try {
    const result = store.saveSelection(CLINIC.clinic, ['fake-gym', 'fake-yoga', 'fake-salon', 'fake-chiro', 'fake-gym', 'fake-medspa', 'no-such-place']);
    assert.deepEqual(result.selection, ['fake-gym', 'fake-yoga', 'fake-salon', 'fake-chiro'], 'duplicates, competitors and unknown IDs are dropped');
    assert.ok(result.refused.some(entry => entry.placeId === 'fake-medspa'), 'the competitor was refused');
    assert.ok(result.refused.some(entry => entry.placeId === 'no-such-place'));

    const many = Array.from({ length: 9 }, (_, index) => place({ placeId: `fake-extra-${index}`, name: `Test Gym ${index}`, lat: HERE.lat + 0.001 * index, lng: HERE.lng + 0.001 * index }));
    store.saveDiscovery(CLINIC.clinic, many);
    const capped = store.saveSelection(CLINIC.clinic, many.map(row => row.placeId));
    assert.equal(capped.selection.length, MAX_ROUTE_STOPS);
    assert.equal(capped.refused.length, many.length - MAX_ROUTE_STOPS);
    assert.match(capped.refused[0].reason, /up to 5 stops/);
    assert.equal(store.selection(CLINIC.clinic).length, MAX_ROUTE_STOPS, 'the stored selection is capped too');
  } finally { store.close(); }
});

test('a route request is only ever requested until the team accepts it', () => {
  const store = portal();
  try {
    assert.equal(store.createRouteRequest(CLINIC.clinic, { contactName: 'Nobody', contactPhone: '', notes: '', preferredFrom: '2026-11-02', preferredTo: '2026-11-06' }).ok, false, 'an empty selection cannot be requested');
    store.saveSelection(CLINIC.clinic, ['fake-gym', 'fake-yoga']);
    const created = store.createRouteRequest(CLINIC.clinic, { contactName: 'Dana at the front desk', contactPhone: '+16305550123', notes: 'Afternoons are better', preferredFrom: '2026-11-02', preferredTo: '2026-11-06' });
    assert.ok(created.ok);
    if (!created.ok) return;
    assert.equal(created.request.status, 'requested');
    assert.doesNotMatch(created.request.statusLabel.toLowerCase(), /^scheduled/, 'a new request is never called scheduled');
    assert.match(created.request.statusLabel, /not scheduled yet/);
    assert.equal(created.request.stops.length, 2);
    assert.deepEqual(created.request.stops.map(stop => stop.placeId), ['fake-gym', 'fake-yoga']);
    assert.deepEqual(store.selection(CLINIC.clinic), [], 'the selection is cleared once it has been asked for');
    assert.equal(store.routeRequests(CLINIC.clinic).length, 1);
    assert.deepEqual(store.routeRequests(RIVAL.clinic), [], 'the other clinic sees none of it');

    const ops = store.allRouteRequests('requested');
    assert.equal(ops.length, 1);
    assert.equal(ops[0].clinicName, CLINIC.name, 'the operations view does name the clinic — it is the agency’s own view');
    assert.equal(store.decideRouteRequest(created.request.id, 'scheduled', 'Wednesday 3pm'), true);
    assert.equal(store.routeRequests(CLINIC.clinic)[0].statusLabel, 'Scheduled by the team');
    assert.equal(store.routeRequests(CLINIC.clinic)[0].teamNote, 'Wednesday 3pm');
    assert.equal(store.decideRouteRequest('not-an-id', 'scheduled'), false);
  } finally { store.close(); }
});

test('a stop that needs review is flagged to the team, not silently routed', () => {
  const store = portal();
  try {
    store.saveNetworkRecords([{ id: 'shared', kind: 'partner', ownerClinicId: RIVAL.clinic, placeId: 'fake-yoga', note: '' }]);
    store.saveSelection(CLINIC.clinic, ['fake-yoga']);
    const created = store.createRouteRequest(CLINIC.clinic, { contactName: 'Dana', contactPhone: '', notes: '', preferredFrom: '2026-11-02', preferredTo: '2026-11-02' });
    assert.ok(created.ok);
    if (!created.ok) return;
    assert.equal(created.request.needsReview, true);
    assert.equal(created.request.stops[0].category, 'review');
  } finally { store.close(); }
});

test('Google content is cached, reused and purged at the retention window', async () => {
  const store = portal();
  try {
    assert.equal(store.cachedDiscovery(CLINIC.clinic).length, NEIGHBOURS.length);
    assert.equal(store.refreshDue(CLINIC.clinic), true, 'nothing has been marked as refreshed yet');
    store.markRefresh(CLINIC.clinic, 'ok', 'five found', NEIGHBOURS.length);
    assert.equal(store.refreshDue(CLINIC.clinic), false, 'a map just refreshed does not search again');

    const day = 86_400_000;
    const past = Date.now() - (GOOGLE_RETENTION_DAYS + 1) * day;
    store.saveDiscovery(CLINIC.clinic, NEIGHBOURS, past);
    assert.equal(store.cachedDiscovery(CLINIC.clinic).length, 0, 'content past 30 days is deleted, not served stale');
    assert.equal(store.businesses(CLINIC.clinic).length, 0);
    // The place IDs survive, which is the one field the Maps terms allow to be kept.
    assert.equal((store.db.prepare('SELECT COUNT(*) AS n FROM map_place_ids WHERE clinic_id=?').get(CLINIC.clinic) as { n: number }).n, NEIGHBOURS.length);

    // One Nearby Search per category, merged by place ID, closed businesses dropped.
    let calls = 0;
    const found = await discoverNearby({ lat: HERE.lat, lng: HERE.lng, radiusMiles: 5 }, async body => {
      calls += 1;
      assert.ok((body as { locationRestriction: { circle: { radius: number } } }).locationRestriction.circle.radius <= 50_000, 'Google caps the radius at 50 km');
      return calls === 1
        ? [{ id: 'dup', displayName: { text: 'Test Gym' }, location: { latitude: 41.75, longitude: -88.15 }, types: ['gym'], businessStatus: 'OPERATIONAL' },
           { id: 'closed', displayName: { text: 'Gone' }, businessStatus: 'CLOSED_PERMANENTLY' }]
        : [{ id: 'dup', displayName: { text: 'Test Gym' }, businessStatus: 'OPERATIONAL' }];
    });
    assert.equal(calls, CATEGORY_RULES.length);
    assert.deepEqual(found.map(row => row.placeId), ['dup'], 'duplicates merge and a closed business is left out');
  } finally { store.close(); }
});

test('the Google Places key is never in anything the portal hands out', () => {
  const previous = process.env.Google_places_API;
  process.env.Google_places_API = 'test-key-not-a-real-one';
  const store = portal();
  try {
    assert.equal(configured(), true, 'the key is read from Google_places_API, that exact name');
    const payload = JSON.stringify(store.networkMap(CLINIC.clinic, CLINIC.name));
    assert.ok(!payload.includes('test-key-not-a-real-one'), 'the key is not in the map payload');
    assert.equal(JSON.parse(payload).data.placesConfigured, true, 'the portal says only that a key exists');
    assert.equal(JSON.parse(payload).data.browserMapKeyConfigured, false, 'no browser map key is claimed');
  } finally { store.close(); if (previous === undefined) delete process.env.Google_places_API; else process.env.Google_places_API = previous; }
});

test('a place with no coordinates is still listed, and never plotted at a made-up point', () => {
  const store = portal();
  try {
    store.saveDiscovery(CLINIC.clinic, [place({ placeId: 'fake-nowhere', name: 'Test No Coordinates', lat: null, lng: null })]);
    const row = store.businesses(CLINIC.clinic).find(entry => entry.placeId === 'fake-nowhere')!;
    assert.equal(row.plot, null, 'no coordinates means no marker');
    assert.equal(row.distanceMiles, 5, 'it falls to the edge of the search radius rather than the clinic’s own doorstep');
    assert.equal(normalizePlace({ displayName: { text: 'No ID' } }), null, 'a place with no ID is not a place');
  } finally { store.close(); }
});

test('the map payload carries a clinic’s own location and nothing else about it', () => {
  const store = portal();
  try {
    const payload = store.networkMap(CLINIC.clinic, CLINIC.name);
    assert.equal(payload.clinic.location?.label, '100 Test Street, Naperville, IL 60540');
    assert.equal(payload.maxStops, MAX_ROUTE_STOPS);
    assert.ok(payload.categories.every(category => typeof category.count === 'number'));
    assert.equal(payload.categories.find(category => category.id === 'fitness')?.count, 1);
    // Fitness carries the heaviest category weight, and this gym is the nearest of the two.
    assert.deepEqual(payload.businesses.map(row => row.placeId).slice(0, 1), ['fake-gym'], 'the best fit comes first');
    // A clinic with no saved location gets an empty map, not somebody else's.
    assert.equal(store.networkMap(RIVAL.clinic, RIVAL.name).clinic.location, null);
    assert.deepEqual(store.networkMap(RIVAL.clinic, RIVAL.name).businesses, []);
  } finally { store.close(); }
});

test('the browser’s route link is a plain Google Maps URL in the order chosen', () => {
  const stops = [
    { placeId: 'fake-gym', name: 'Test Strength Room', address: '1 Test Street' },
    { placeId: 'fake-yoga', name: 'Test Yoga Loft', address: '2 Test Street' },
    { placeId: 'fake-salon', name: 'Test Hair Studio', address: '3 Test Street' },
  ];
  const url = new URL(directionsUrl(HERE, stops));
  assert.equal(url.origin + url.pathname, 'https://www.google.com/maps/dir/');
  assert.equal(url.searchParams.get('origin'), `${HERE.lat},${HERE.lng}`);
  assert.equal(url.searchParams.get('destination_place_id'), 'fake-salon', 'the last stop is the destination');
  assert.deepEqual(url.searchParams.get('waypoint_place_ids')?.split('|'), ['fake-gym', 'fake-yoga']);
  assert.equal(url.searchParams.get('waypoints')?.split('|').length, 2, 'every waypoint ID has its text twin');
  assert.equal(url.searchParams.has('key'), false, 'no API key is in a browser link');
  assert.equal(directionsUrl(HERE, []), '', 'no stops, no link');
  assert.match(mapsPlaceUrl({ placeId: 'fake-gym', name: 'Test Strength Room', googleMapsUri: null }), /query_place_id=fake-gym/);
  assert.equal(mapsPlaceUrl({ placeId: 'fake-gym', name: 'x', googleMapsUri: 'https://maps.google.com/?cid=1' }), 'https://maps.google.com/?cid=1');
});

test('filters and clustering behave on the list the server sent', () => {
  const store = portal();
  try {
    const rows = store.networkMap(CLINIC.clinic, CLINIC.name).businesses as unknown as MapBusiness[];
    assert.equal(filterBusinesses(rows, { query: 'yoga', categories: [], withinMiles: 5, onlyRoutable: false }).length, 1);
    assert.equal(filterBusinesses(rows, { query: '', categories: ['salon'], withinMiles: 5, onlyRoutable: false }).length, 1);
    assert.equal(filterBusinesses(rows, { query: '', categories: [], withinMiles: 0.4, onlyRoutable: false }).every(row => row.distanceMiles <= 0.4), true);
    assert.ok(filterBusinesses(rows, { query: '', categories: [], withinMiles: 5, onlyRoutable: true }).every(row => row.routable), 'routable-only hides the competitor');
    assert.equal(filterBusinesses(rows, { query: 'no such business', categories: [], withinMiles: 5, onlyRoutable: false }).length, 0);

    const grouped = markers(rows, 2);
    assert.equal(grouped.length, 1, 'a coarse grid gathers everything into one cluster');
    assert.equal(grouped[0].members.length, rows.filter(row => row.plot).length);
    assert.equal(markers(rows, 0.001).length, rows.filter(row => row.plot).length, 'a fine grid leaves every marker on its own');
    const spokes = spread(grouped[0]);
    assert.equal(spokes.length, grouped[0].members.length);
    assert.equal(new Set(spokes.map(spoke => `${spoke.x.toFixed(4)},${spoke.y.toFixed(4)}`)).size, spokes.length, 'an opened cluster never leaves two markers stacked');
  } finally { store.close(); }
});

test('the network endpoints need a session, reject cross-origin writes and ignore a named clinic', async () => {
  const store = portal();
  const server = createPortalServer({ store, origin: 'http://portal.test', secure: false, root: process.cwd() });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    assert.equal((await fetch(`${base}/api/network/map`)).status, 401, 'anonymous gets nothing');
    assert.equal((await fetch(`${base}/api/network/selection`, { method: 'POST', headers: { Origin: 'http://portal.test', 'Content-Type': 'application/json' }, body: JSON.stringify({ placeIds: ['fake-gym'] }) })).status, 401);

    const signIn = await fetch(`${base}/api/login`, { method: 'POST', headers: { Origin: 'http://portal.test', 'Content-Type': 'application/json' }, body: JSON.stringify({ username: CLINIC.username, password: CLINIC.password }) });
    const cookie = signIn.headers.get('set-cookie')!.split(';')[0];

    // A clinic named in the query string is ignored: the session decides.
    const map = await (await fetch(`${base}/api/network/map?clinicId=${RIVAL.clinic}`, { headers: { Cookie: cookie } })).json();
    assert.equal(map.clinic.name, CLINIC.name);
    assert.equal(map.clinic.location.label, '100 Test Street, Naperville, IL 60540');
    assert.ok(!JSON.stringify(map).includes(RIVAL.clinic));

    assert.equal((await fetch(`${base}/api/network/selection`, { method: 'POST', headers: { Origin: 'https://evil.invalid', 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ placeIds: [] }) })).status, 403, 'a cross-origin write is refused');

    const chosen = await (await fetch(`${base}/api/network/selection`, { method: 'POST', headers: { Origin: 'http://portal.test', 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ placeIds: ['fake-gym', 'fake-medspa'] }) })).json();
    assert.deepEqual(chosen.selection, ['fake-gym']);

    const badDates = await fetch(`${base}/api/network/route-request`, { method: 'POST', headers: { Origin: 'http://portal.test', 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ contactName: 'Dana', contactPhone: '', notes: '', preferredFrom: '2026-11-10', preferredTo: '2026-11-02' }) });
    assert.equal(badDates.status, 400, 'a backwards date range is refused');

    const asked = await (await fetch(`${base}/api/network/route-request`, { method: 'POST', headers: { Origin: 'http://portal.test', 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ contactName: 'Dana', contactPhone: '', notes: '', preferredFrom: '2026-11-02', preferredTo: '2026-11-06' }) })).json();
    assert.equal(asked.request.status, 'requested');
    assert.deepEqual(asked.selection, []);
    assert.equal((await fetch(`${base}/api/network/nonsense`, { headers: { Cookie: cookie } })).status, 404);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    store.close();
  }
});
