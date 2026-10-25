import test from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { openStore } from '../server/store';
import { createPortalServer } from '../server/http';
import { BRAIN, RULES_VERSION } from '../server/network/config';
import { addMonths, countNote, followUpQueue, nextDue, periodOf, rankRecommendations, referralFit, staggerQueue, type BrainRow } from '../server/network/brain';
import { ownershipOf } from '../server/network/network';
import type { DiscoveredPlace } from '../server/network/places';

// The same fictional neighbourhood the Network Map tests use: a clinic in Naperville and
// obviously fake place IDs, so nothing here can be mistaken for Google content or a real
// business. Nothing is seeded into a live database; every store is in memory.
const CLINIC = { clinic: 'test-wellness', name: 'Test Wellness Clinic', username: 'testwellness', password: 'test-password-123' };
const RIVAL = { clinic: 'rival-clinic', name: 'Rival Wellness Rooms', username: 'rivalrooms', password: 'rival-password-123' };
const HERE = { lat: 41.7508, lng: -88.1535 };
const TODAY = '2026-10-25';

const CATEGORY_TYPES: Record<string, string> = { fitness: 'gym', yoga: 'yoga_studio', salon: 'hair_salon', chiropractic: 'chiropractor', 'wellness-retail': 'health_food_store' };

const place = (over: Partial<DiscoveredPlace> & { placeId: string }): DiscoveredPlace => ({
  name: 'A Business', address: '1 Test Street, Naperville, IL 60540', lat: 41.7552, lng: -88.1549,
  types: ['gym'], primaryType: 'gym', businessStatus: 'OPERATIONAL', rating: null, reviewCount: null, googleMapsUri: null, ...over,
});

/** `count` fictional businesses in one category, each a little further out than the last. */
function fixtures(categoryId: string, count: number, offset = 0): DiscoveredPlace[] {
  const type = CATEGORY_TYPES[categoryId];
  return Array.from({ length: count }, (_, index) => {
    const n = offset + index;
    return place({ placeId: `fake-${categoryId}-${n}`, name: `Test ${categoryId} ${n}`, types: [type], primaryType: type,
      lat: HERE.lat + 0.004 * (n + 1), lng: HERE.lng + 0.002 * (n + 1), address: `${100 + n} Test Street, Naperville, IL 60540` });
  });
}

function portal(places: DiscoveredPlace[], radiusMiles = 10) {
  const store = openStore(':memory:', false);
  store.createClient(CLINIC.clinic, CLINIC.name, CLINIC.username, CLINIC.password);
  store.createClient(RIVAL.clinic, RIVAL.name, RIVAL.username, RIVAL.password);
  store.setClinicLocation({ clinicId: CLINIC.clinic, label: '100 Test Street, Naperville, IL 60540', lat: HERE.lat, lng: HERE.lng, radiusMiles, placeId: null, competitorCategories: [] });
  store.saveDiscovery(CLINIC.clinic, places);
  return store;
}

/** A spread of twenty fictional businesses across four categories. */
const TWENTY = [...fixtures('fitness', 5), ...fixtures('yoga', 5), ...fixtures('salon', 5), ...fixtures('chiropractic', 5)];

const row = (over: Partial<BrainRow> & { placeId: string }): BrainRow => ({
  name: 'A Business', address: '1 Test Street, Naperville, IL 60540',
  category: { id: 'fitness', label: 'Fitness studios', weight: 60, reason: 'Shares clientele.', competitor: false },
  distanceMiles: 0.5, status: 'fit', routable: true, ownership: 'unknown', dedupeKey: 'abusiness|1-60540', ...over,
});

// ── The score ────────────────────────────────────────────────────────────────────────────────

test('the referral score is the sum of four stated parts, and popularity is not one of them', () => {
  const near = referralFit(row({ placeId: 'a' }));
  assert.equal(near.score, near.components.reduce((total, part) => total + part.points, 0), 'the score is the sum of its parts');
  assert.equal(near.components.length, 4);
  assert.ok(near.components.every(part => part.detail.trim().length > 0), 'every part says why');
  assert.equal(near.components.reduce((total, part) => total + part.outOf, 0), 100, 'the parts add up to a score out of 100');
  const far = referralFit(row({ placeId: 'b', distanceMiles: 5.5 }));
  assert.ok(near.score > far.score, 'nearer scores higher');
  const words = JSON.stringify(near).toLowerCase();
  assert.ok(!words.includes('rating') && !words.includes('review'), 'no rating or review count anywhere in the score');
  assert.equal(near.inputs.rulesVersion, RULES_VERSION, 'the score records which rules produced it');
});

test('unknown ownership is scored neutrally and never guessed from a name, rating or review count', () => {
  const unknown = referralFit(row({ placeId: 'a', ownership: 'unknown' }));
  const independent = referralFit(row({ placeId: 'a', ownership: 'independent' }));
  const chain = referralFit(row({ placeId: 'a', ownership: 'chain' }));
  const points = (fit: typeof unknown) => fit.components.find(part => part.label === 'Ownership')!.points;
  assert.equal(points(independent), BRAIN.weights.ownership);
  assert.equal(points(chain), 0);
  assert.equal(points(unknown), Math.round(BRAIN.weights.ownership / 2), 'not knowing is the neutral middle, not a mark against');
  assert.match(unknown.components.find(part => part.label === 'Ownership')!.detail, /Ownership unknown/);

  // A family-sounding name with a glowing listing is still "Ownership unknown": only the
  // network's own verified record can say otherwise.
  const familyName = { placeId: 'fake-family', name: 'Smith Family Chiropractic', address: '1 Test Street, Naperville, IL 60540' };
  assert.equal(ownershipOf(familyName, []).state, 'unknown');
  assert.equal(ownershipOf(familyName, []).label, 'Ownership unknown');
  assert.equal(ownershipOf(familyName, [{ id: 'v', kind: 'independent', ownerClinicId: null, placeId: 'fake-family', nameKey: null, addressKey: null, note: '' }]).state, 'independent');
  // A chain record wins over an independent one: the cautious answer is the one that claims less.
  assert.equal(ownershipOf(familyName, [
    { id: 'v', kind: 'independent', ownerClinicId: null, placeId: 'fake-family', nameKey: null, addressKey: null, note: '' },
    { id: 'c', kind: 'chain', ownerClinicId: null, placeId: 'fake-family', nameKey: null, addressKey: null, note: '' }]).state, 'chain');
});

// ── This month's fifteen ─────────────────────────────────────────────────────────────────────

test('a month offers at most fifteen, and never pads a short list', () => {
  const plenty = rankRecommendations([...TWENTY, ...fixtures('wellness-retail', 5)].map(toRow));
  assert.equal(plenty.picks.length, BRAIN.monthlyNewLimit);
  assert.deepEqual(plenty.picks.map(pick => pick.rank), Array.from({ length: 15 }, (_, index) => index + 1));
  assert.match(plenty.note, /15 new businesses/);

  const few = rankRecommendations(fixtures('fitness', 4).map(toRow));
  assert.equal(few.picks.length, 4);
  assert.match(few.note, /every match that qualified/, 'the count is explained rather than padded');
  assert.match(countNote(0, 15), /No new businesses qualified/);

  // Weak matches are left out instead of filling the fifteen: an uncategorised business scores
  // below the bar and is simply not offered.
  const weak = rankRecommendations([row({ placeId: 'uncategorised', category: null, status: 'review', dedupeKey: 'x|1' })]);
  assert.equal(weak.picks.length, 0);
  assert.ok(referralFit(row({ placeId: 'uncategorised', category: null, status: 'review' })).score < BRAIN.minimumScore);
});

test('a batch prefers a spread of categories but still fills when the strong matches are alike', () => {
  const mixed = rankRecommendations(TWENTY.map(toRow));
  const counts = new Map<string, number>();
  for (const pick of mixed.picks) counts.set(pick.inputs.categoryId ?? 'none', (counts.get(pick.inputs.categoryId ?? 'none') ?? 0) + 1);
  assert.ok(counts.size >= 3, 'fifteen businesses are not all one category');
  assert.ok([...counts.values()].every(count => count <= BRAIN.preferredPerCategory), 'the category ceiling holds when there is a choice');

  // Twenty gyms and nothing else: the ceiling is a preference, not a reason to hand over five.
  const allGyms = rankRecommendations(fixtures('fitness', 20).map(toRow));
  assert.equal(allGyms.picks.length, BRAIN.monthlyNewLimit);
});

test('competitors, closed businesses, restricted businesses and far ones are never recommended', () => {
  const store = portal([
    ...fixtures('fitness', 2),
    place({ placeId: 'fake-medspa', name: 'Test Med Spa', types: ['wellness_center'], primaryType: 'wellness_center', lat: 41.7521, lng: -88.1488, address: '4 Test Street, Naperville, IL 60540' }),
    place({ placeId: 'fake-closed', name: 'Test Closed Gym', businessStatus: 'CLOSED_PERMANENTLY', lat: 41.7530, lng: -88.1500, address: '5 Test Street, Naperville, IL 60540' }),
    place({ placeId: 'fake-paused', name: 'Test Paused Gym', businessStatus: 'CLOSED_TEMPORARILY', lat: 41.7532, lng: -88.1502, address: '6 Test Street, Naperville, IL 60540' }),
    place({ placeId: 'fake-held', name: 'Test Exclusive Gym', lat: 41.7540, lng: -88.1510, address: '7 Test Street, Naperville, IL 60540' }),
    place({ placeId: 'fake-far', name: 'Test Far Gym', lat: HERE.lat + 0.12, lng: HERE.lng, address: '8 Test Street, Plainfield, IL 60544' }),
  ]);
  try {
    store.saveNetworkRecords([{ id: 'rival-exclusive', kind: 'exclusive', ownerClinicId: RIVAL.clinic, placeId: 'fake-held', note: 'internal' }]);
    const offered = store.monthlySet(CLINIC.clinic, { day: TODAY }).picks.map(pick => pick.placeId);
    assert.ok(!offered.includes('fake-medspa'), 'a direct competitor is not a recommendation');
    assert.ok(!offered.includes('fake-closed') && !offered.includes('fake-paused'), 'Google says these are shut');
    assert.ok(!offered.includes('fake-held'), 'another clinic’s exclusivity keeps it out');
    assert.ok(!offered.includes('fake-far'), 'eight miles is past the practical limit');
    assert.deepEqual(offered.sort(), ['fake-fitness-0', 'fake-fitness-1']);
    // And the status the client sees for a closed business says so, with no route button.
    const closed = store.businesses(CLINIC.clinic).find(entry => entry.placeId === 'fake-closed')!;
    assert.equal(closed.routable, false);
    assert.match(closed.statusReason, /closed/i);
  } finally { store.close(); }
});

test('a business with no readable distance is held back and listed, not quietly included', () => {
  const ranked = rankRecommendations([row({ placeId: 'fake-nowhere', name: 'Test No Coordinates', distanceMiles: null })]);
  assert.equal(ranked.picks.length, 0);
  assert.equal(ranked.held.length, 1);
  assert.equal(ranked.held[0].placeId, 'fake-nowhere');
  assert.match(ranked.held[0].reason, /no readable distance/i);
  assert.match(ranked.note, /held back for review/);

  const store = portal([...fixtures('fitness', 1), place({ placeId: 'fake-nowhere', name: 'Test No Coordinates', lat: null, lng: null, address: '9 Test Street, Naperville, IL 60540' })]);
  try {
    const plan = store.networkPlan(CLINIC.clinic, { day: TODAY });
    assert.deepEqual(plan.recommended.map(entry => entry.placeId), ['fake-fitness-0']);
    assert.deepEqual(plan.heldBack.map(entry => entry.placeId), ['fake-nowhere']);
  } finally { store.close(); }
});

test('the same location listed twice is held back, and a duplicate place ID cannot double up', () => {
  const twin = { name: 'Test Twin Studio', address: '200 Test Street, Naperville, IL 60540' };
  const ranked = rankRecommendations([
    row({ placeId: 'fake-twin-a', ...twin, dedupeKey: 'testtwin|200-60540' }),
    row({ placeId: 'fake-twin-b', ...twin, dedupeKey: 'testtwin|200-60540' }),
  ]);
  assert.deepEqual(ranked.picks.map(pick => pick.placeId), ['fake-twin-a']);
  assert.deepEqual(ranked.held.map(entry => entry.placeId), ['fake-twin-b']);
  assert.match(ranked.held[0].reason, /same location/i);
});

test('a month’s set is made once, and a business is never offered as new twice', () => {
  const store = portal(TWENTY);
  try {
    const first = store.monthlySet(CLINIC.clinic, { day: '2026-10-25' });
    const again = store.monthlySet(CLINIC.clinic, { day: '2026-10-28' });
    assert.equal(first.period, '2026-10');
    assert.deepEqual(again.picks.map(pick => pick.placeId), first.picks.map(pick => pick.placeId), 'October asked twice is the same October list');
    assert.equal((store.db.prepare('SELECT COUNT(*) AS n FROM recommendation_sets WHERE clinic_id=?').get(CLINIC.clinic) as { n: number }).n, 1, 'one set row for October');
    assert.equal((store.db.prepare('SELECT COUNT(*) AS n FROM recommendations WHERE clinic_id=?').get(CLINIC.clinic) as { n: number }).n, 15, 'one set of fifteen, not two');

    const november = store.monthlySet(CLINIC.clinic, { day: '2026-11-03' });
    assert.equal(november.period, '2026-11');
    assert.equal(november.picks.length, 5, 'the five that were left, not fifteen repeats');
    const overlap = november.picks.filter(pick => first.picks.some(earlier => earlier.placeId === pick.placeId));
    assert.deepEqual(overlap, [], 'nothing shown in October comes back as new in November');

    const december = store.monthlySet(CLINIC.clinic, { day: '2026-12-01' });
    assert.deepEqual(december.picks, [], 'with everything already offered, December offers nothing rather than repeating');
    assert.match(december.note, /No new businesses qualified/);
  } finally { store.close(); }
});

test('a recommendation stores the dated, versioned inputs that explain it', () => {
  const store = portal(fixtures('fitness', 1));
  try {
    const set = store.monthlySet(CLINIC.clinic, { day: TODAY, now: Date.parse('2026-10-25T12:00:00Z') });
    const pick = set.picks[0];
    assert.equal(set.rulesVersion, RULES_VERSION);
    assert.equal(pick.inputs.categoryId, 'fitness');
    assert.equal(typeof pick.inputs.distanceMiles, 'number');
    assert.equal(pick.inputs.networkStatus, 'fit');
    assert.equal(pick.inputs.ownership, 'unknown');
    assert.equal(pick.inputs.parts.length, 4);
    assert.ok(pick.reason.trim().length > 0, 'every recommendation carries its own short reason');
    assert.match(pick.reason, /Fitness studios/);
    // No Google name or address is written into the brain's own tables: they live only in the
    // 30-day content cache the map reads.
    const stored = store.db.prepare('SELECT reason,score_inputs FROM recommendations WHERE clinic_id=?').all(CLINIC.clinic) as Array<Record<string, string>>;
    assert.ok(stored.every(entry => !entry.reason.includes('Test fitness') && !entry.score_inputs.includes('Test Street')));
  } finally { store.close(); }
});

test('a recommendation the network later refuses is withdrawn, not left looking current', () => {
  const store = portal(fixtures('fitness', 2));
  try {
    store.monthlySet(CLINIC.clinic, { day: TODAY });
    store.saveNetworkRecords([{ id: 'late-exclusive', kind: 'exclusive', ownerClinicId: RIVAL.clinic, placeId: 'fake-fitness-0', note: 'internal' }]);
    const plan = store.networkPlan(CLINIC.clinic, { day: TODAY });
    assert.deepEqual(plan.recommended.map(entry => entry.placeId), ['fake-fitness-1']);
    assert.deepEqual(plan.withdrawn.map(entry => entry.placeId), ['fake-fitness-0']);
    assert.ok(plan.withdrawn[0].reason.trim().length > 0);
    assert.ok(!JSON.stringify(plan).includes(RIVAL.clinic), 'and still nothing about the other clinic');
    assert.match(plan.recommendedNote, /withdrawn/);
  } finally { store.close(); }
});

test('nothing in the plan promises an agreed partner or a guaranteed lead', () => {
  const store = portal(TWENTY);
  try {
    const words = JSON.stringify(store.networkPlan(CLINIC.clinic, { day: TODAY })).toLowerCase();
    for (const claim of ['agreed to refer', 'guaranteed', 'referral partner', 'will send', 'commission', 'payout', 'per referral'])
      assert.ok(!words.includes(claim), `the plan never says "${claim}"`);
  } finally { store.close(); }
});

// ── The follow-up rotation ───────────────────────────────────────────────────────────────────

test('the outcome sets the next due date, about two months by default', () => {
  assert.equal(BRAIN.followUp.defaultMonths, 2);
  assert.equal(nextDue('follow-up-later', '2026-10-25'), '2026-12-25', 'the default is the month after next');
  assert.equal(nextDue('interested', '2026-10-25'), '2026-11-25');
  assert.equal(nextDue('unable-to-reach', '2026-10-25'), '2026-11-15');
  assert.equal(nextDue('not-interested', '2026-10-25'), null, 'not interested does not come back on its own');
  assert.equal(nextDue('reopened', '2026-10-25'), '2026-10-25', 'a reopened business is due now');
  assert.equal(addMonths('2026-12-31', 2), '2027-02-28', 'the day of the month is clamped, never rolled over');
  assert.equal(periodOf('2026-10-25'), '2026-10');
});

test('a month’s worth of follow-ups is staggered across the month, never pulled earlier', () => {
  const entries = Array.from({ length: 10 }, (_, index) => ({ placeId: `p${index}`, lastVisitedOn: '2026-08-15', outcome: 'follow-up-later' as const, dueOn: '2026-10-15', note: '' }));
  const staggered = staggerQueue(entries, 4);
  assert.deepEqual(staggered.map(entry => entry.week), [1, 1, 1, 1, 2, 2, 2, 2, 3, 3]);
  assert.deepEqual([...new Set(staggered.map(entry => entry.scheduledOn))], ['2026-10-15', '2026-10-22', '2026-10-29']);
  assert.ok(staggered.every(entry => entry.scheduledOn >= entry.dueOn), 'the stagger only ever moves a visit later');
  // The order is stable: the same cohort staggers the same way every time it is read.
  assert.deepEqual(staggerQueue(entries, 4).map(entry => entry.placeId), staggered.map(entry => entry.placeId));
});

test('the queue shows what is due, holds the rest back, and never exceeds fifteen at once', () => {
  const events = Array.from({ length: 24 }, (_, index) => ({ placeId: `p${index}`, visitedOn: '2026-08-20', outcome: 'follow-up-later' as const, note: '', recordedAt: 1 }));
  const queue = followUpQueue(events, '2026-12-31');
  assert.equal(queue.due.length, BRAIN.followUp.queueLimit, 'fifteen at a time, no more');
  assert.equal(queue.due.length + queue.upcoming.length, 24, 'the rest are waiting, not lost');
  assert.match(queue.note, /15 businesses are due/);
  assert.match(queue.note, /9 more come due/);
  assert.ok(queue.due.every(entry => entry.reason.trim().length > 0), 'every entry says why it is back');
  assert.ok(queue.due.every(entry => entry.lastVisitedOn === '2026-08-20'), 'and when it was last visited');
  assert.ok(queue.due.every(entry => entry.scheduledOn <= '2026-12-31'));

  // Mid-rotation: only the earliest slots have come round.
  const partway = followUpQueue(events, '2026-10-21');
  assert.equal(partway.due.length, 4, 'one week’s slot, not the whole cohort');
  assert.equal(partway.upcoming.length, 20);
  assert.match(partway.note, /4 businesses are due/);
  assert.match(followUpQueue([], '2026-10-25').note, /Nothing is due/);
});

test('not interested stays out of the queue until the clinic reopens it', () => {
  const store = portal(fixtures('fitness', 2));
  try {
    assert.equal(store.recordOutreach(CLINIC.clinic, { placeId: 'fake-fitness-0', visitedOn: '2026-10-20', outcome: 'not-interested', note: 'Not for them' }, { day: TODAY }).ok, true);
    const plan = store.networkPlan(CLINIC.clinic, { day: '2027-06-01' });
    assert.deepEqual(plan.followUps.due.map(entry => entry.placeId), [], 'eight months later it is still parked');
    assert.deepEqual(plan.followUps.parked.map(entry => entry.placeId), ['fake-fitness-0']);
    assert.match(plan.followUps.note, /until you reopen/);

    assert.equal(store.reopenOutreach(CLINIC.clinic, 'fake-fitness-1', { day: TODAY }).ok, false, 'a business with no history cannot be reopened');
    const reopened = store.reopenOutreach(CLINIC.clinic, 'fake-fitness-0', { day: TODAY });
    assert.equal(reopened.ok, true);
    assert.equal(reopened.ok && reopened.nextDueOn, TODAY);
    const after = store.networkPlan(CLINIC.clinic, { day: TODAY });
    assert.deepEqual(after.followUps.due.map(entry => entry.placeId), ['fake-fitness-0']);
    assert.deepEqual(after.followUps.parked, []);
    assert.match(after.followUps.due[0].reason, /reopened/i);
  } finally { store.close(); }
});

test('a recorded visit moves a business out of the new list and into the rotation', () => {
  const store = portal(fixtures('fitness', 3));
  try {
    const october = store.monthlySet(CLINIC.clinic, { day: TODAY });
    assert.equal(october.picks.length, 3);
    assert.equal(store.recordOutreach(CLINIC.clinic, { placeId: 'fake-fitness-0', visitedOn: '2026-10-20', outcome: 'interested', note: 'Owner keen' }, { day: TODAY }).ok, true);

    const sameMonth = store.networkPlan(CLINIC.clinic, { day: TODAY });
    assert.ok(sameMonth.recommended.some(entry => entry.placeId === 'fake-fitness-0'), 'October’s list is not rewritten mid-month');
    assert.deepEqual(sameMonth.followUps.due, [], 'and it is not due again yet');

    const next = store.networkPlan(CLINIC.clinic, { day: '2026-11-25' });
    assert.deepEqual(next.followUps.due.map(entry => entry.placeId), ['fake-fitness-0'], 'a month later the interested one is due');
    assert.equal(next.followUps.due[0].outcomeLabel, 'Interested');
    assert.match(next.followUps.due[0].reason, /interested/i);
    assert.ok(!next.recommended.some(entry => entry.placeId === 'fake-fitness-0'), 'and November does not offer it as new');

    const history = store.outreachHistory(CLINIC.clinic);
    assert.equal(history.length, 1);
    assert.equal(history[0].outcome, 'interested');
    assert.equal(history[0].nextDueOn, '2026-11-20');
  } finally { store.close(); }
});

test('the server decides what outreach may be recorded', () => {
  const store = portal([...fixtures('fitness', 1), place({ placeId: 'fake-medspa', name: 'Test Med Spa', types: ['wellness_center'], primaryType: 'wellness_center', lat: 41.7521, lng: -88.1488, address: '4 Test Street, Naperville, IL 60540' })]);
  try {
    assert.equal(store.recordOutreach(CLINIC.clinic, { placeId: 'not-a-place', visitedOn: '2026-10-20', outcome: 'interested' }, { day: TODAY }).ok, false, 'a place that is not on this clinic’s map');
    assert.equal(store.recordOutreach(CLINIC.clinic, { placeId: 'fake-medspa', visitedOn: '2026-10-20', outcome: 'interested' }, { day: TODAY }).ok, false, 'a direct competitor');
    assert.equal(store.recordOutreach(CLINIC.clinic, { placeId: 'fake-fitness-0', visitedOn: '2026-12-01', outcome: 'interested' }, { day: TODAY }).ok, false, 'a visit in the future');
    assert.equal(store.recordOutreach(CLINIC.clinic, { placeId: 'fake-fitness-0', visitedOn: 'last Tuesday', outcome: 'interested' }, { day: TODAY }).ok, false, 'a date that is not a date');
    assert.equal(store.recordOutreach(CLINIC.clinic, { placeId: 'fake-fitness-0', visitedOn: '2026-10-20', outcome: 'brilliant' as 'interested' }, { day: TODAY }).ok, false, 'an outcome the portal does not offer');
    assert.equal((store.db.prepare('SELECT COUNT(*) AS n FROM outreach_records').get() as { n: number }).n, 0, 'nothing was written');
    assert.equal(store.recordOutreach(CLINIC.clinic, { placeId: 'fake-fitness-0', visitedOn: '2026-10-20', outcome: 'interested' }, { day: TODAY }).ok, true);
  } finally { store.close(); }
});

// ── One client, one plan ─────────────────────────────────────────────────────────────────────

test('a plan, its recommendations and its outreach belong to one clinic only', () => {
  const store = portal(fixtures('fitness', 2));
  try {
    store.setClinicLocation({ clinicId: RIVAL.clinic, label: '900 Other Street, Aurora, IL 60505', lat: 41.76, lng: -88.32, radiusMiles: 5, placeId: null, competitorCategories: [] });
    store.saveDiscovery(RIVAL.clinic, [place({ placeId: 'fake-rival-only', name: 'Rival Only Gym', lat: 41.761, lng: -88.321, address: '1 Rival Street, Aurora, IL 60505' })]);

    store.monthlySet(CLINIC.clinic, { day: TODAY });
    store.monthlySet(RIVAL.clinic, { day: TODAY });
    assert.deepEqual(store.networkPlan(CLINIC.clinic, { day: TODAY }).recommended.map(entry => entry.placeId).sort(), ['fake-fitness-0', 'fake-fitness-1']);
    assert.deepEqual(store.networkPlan(RIVAL.clinic, { day: TODAY }).recommended.map(entry => entry.placeId), ['fake-rival-only']);

    // A place ID borrowed from the other clinic's map cannot be recorded against this one.
    assert.equal(store.recordOutreach(CLINIC.clinic, { placeId: 'fake-rival-only', visitedOn: '2026-10-20', outcome: 'interested' }, { day: TODAY }).ok, false);
    assert.equal(store.recordOutreach(CLINIC.clinic, { placeId: 'fake-fitness-0', visitedOn: '2026-10-20', outcome: 'interested' }, { day: TODAY }).ok, true);
    assert.deepEqual(store.outreachHistory(RIVAL.clinic), [], 'the other clinic’s history is untouched');
    assert.deepEqual(store.networkPlan(RIVAL.clinic, { day: '2026-11-25' }).followUps.due, []);
  } finally { store.close(); }
});

test('a client can act on a recommendation, and the server still refuses an ineligible stop', async () => {
  const store = portal([...fixtures('fitness', 2), place({ placeId: 'fake-medspa', name: 'Test Med Spa', types: ['wellness_center'], primaryType: 'wellness_center', lat: 41.7521, lng: -88.1488, address: '4 Test Street, Naperville, IL 60540' })]);
  const server = createPortalServer({ store, origin: 'http://portal.test', secure: false, root: process.cwd() });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = (path: string, value: unknown, cookie?: string) => fetch(`${base}${path}`, { method: 'POST',
    headers: { Origin: 'http://portal.test', 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(value) });
  try {
    assert.equal((await post('/api/network/outreach', { placeId: 'fake-fitness-0', visitedOn: '2026-10-20', outcome: 'interested', note: '' })).status, 401, 'anonymous records nothing');
    const signIn = await post('/api/login', { username: CLINIC.username, password: CLINIC.password });
    const cookie = signIn.headers.get('set-cookie')!.split(';')[0];

    const map = await (await fetch(`${base}/api/network/map`, { headers: { Cookie: cookie } })).json();
    assert.equal(map.plan.monthlyLimit, 15);
    assert.equal(map.plan.recommended.length, 2);
    assert.match(map.plan.promise, /15 new businesses/);
    assert.ok(!map.plan.recommended.some((entry: { placeId: string }) => entry.placeId === 'fake-medspa'));

    // The route still refuses the competitor, whether or not it was ever recommended.
    const chosen = await (await post('/api/network/selection', { placeIds: ['fake-fitness-0', 'fake-medspa'] }, cookie)).json();
    assert.deepEqual(chosen.selection, ['fake-fitness-0']);

    assert.equal((await post('/api/network/outreach', { placeId: 'fake-medspa', visitedOn: '2026-10-20', outcome: 'interested', note: '' }, cookie)).status, 400);
    assert.equal((await post('/api/network/outreach', { placeId: 'fake-fitness-0', visitedOn: '2026-10-20', outcome: 'maybe', note: '' }, cookie)).status, 400, 'an unlisted outcome is refused');
    const recorded = await post('/api/network/outreach', { placeId: 'fake-fitness-0', visitedOn: '2026-10-20', outcome: 'interested', note: 'Spoke to the owner' }, cookie);
    assert.equal(recorded.status, 200);
    const body = await recorded.json();
    assert.equal(body.nextDueOn, '2026-11-20');
    assert.equal(body.plan.history[0].outcomeLabel, 'Interested');
    assert.equal((await post('/api/network/outreach', { placeId: 'fake-fitness-0', visitedOn: '2026-10-20', outcome: 'interested', note: '' }, cookie)).status, 200, 'a second visit on the same day is just another record');

    assert.equal((await fetch(`${base}/api/network/outreach`, { method: 'POST', headers: { Origin: 'https://evil.invalid', 'Content-Type': 'application/json', Cookie: cookie }, body: '{}' })).status, 403, 'a cross-origin write is refused');
    assert.equal((await post('/api/network/reopen', { placeId: 'fake-not-on-your-map' }, cookie)).status, 400);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    store.close();
  }
});

/** A discovered place as the brain reads it, for the pure ranking tests. */
function toRow(entry: DiscoveredPlace): BrainRow {
  const categoryId = Object.entries(CATEGORY_TYPES).find(([, type]) => entry.types.includes(type))?.[0] ?? null;
  const weights: Record<string, number> = { fitness: 60, yoga: 58, salon: 44, chiropractic: 52, 'wellness-retail': 38 };
  return {
    placeId: entry.placeId, name: entry.name, address: entry.address,
    category: categoryId ? { id: categoryId, label: categoryId, weight: weights[categoryId], reason: 'Shares clientele.', competitor: false } : null,
    distanceMiles: 0.4 + Number(entry.placeId.slice(-1)) * 0.1,
    status: 'fit', routable: true, ownership: 'unknown', dedupeKey: `${entry.name}|${entry.address}`,
  };
}
