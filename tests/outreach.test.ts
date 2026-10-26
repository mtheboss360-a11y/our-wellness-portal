// RELEASED BUSINESSES, SCRIPTS AND VISITS.
//
// Two things matter more than the rest here and most of these tests are about them: one
// practice must never reach another's businesses, and a release must be safe to run twice.
// After that, a visit has to move the relationship and say who moved it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openStore } from '../server/store.ts';
import type { Script } from '../server/outreach.ts';

const script = (opening: string): Script => ({
  opening, introduction: 'i', value: 'v', ask: 'a',
  objections: { busy: 'b', notInterested: 'n', alreadyPartnered: 'p' },
  closing: 'c', followUp: 'f',
});

const entry = (name: string, address: string) => ({
  name, category: 'Pilates studio', address, phone: '(630) 000-0000',
  website: 'https://example.com', talkingPoint: 'A local introduction.', script: script(`Hello, ${name}.`),
});

function fresh() {
  const store = openStore(':memory:', false);
  store.createClient('hyline', 'Hyline Dental', 'hyline', 'pw', 'b');
  store.createClient('other', 'Another Practice', 'other', 'pw', 'b');
  return store;
}

test('a release puts the businesses on one practice list and nobody else sees them', () => {
  const store = fresh();
  store.outreach.release('hyline', 'r1', 'Release 1', 'tester', [entry('Karve Pilates', '4827 S Route 59')]);

  const mine = store.outreach.businesses('hyline');
  assert.equal(mine.length, 1);
  assert.equal(mine[0].name, 'Karve Pilates');
  assert.equal(mine[0].stage, 'new', 'nothing is pre-filled as contacted');

  assert.deepEqual(store.outreach.businesses('other'), [], 'another practice sees nothing');
  assert.equal(store.outreach.business('other', mine[0].id), null, 'not even by id');
  store.close();
});

test('running the same release twice adds nothing', () => {
  const store = fresh();
  const list = [entry('Karve Pilates', '4827 S Route 59'), entry('Yoga Cave', '2863 95th St')];
  const first = store.outreach.release('hyline', 'r1', 'Release 1', 'tester', list);
  const second = store.outreach.release('hyline', 'r1', 'Release 1', 'tester', list);

  assert.equal(first.added.length, 2);
  assert.equal(second.added.length, 0, 'the second run creates nothing');
  assert.equal(second.updated.length, 2, 'it refreshes what it was given');
  assert.equal(store.outreach.businesses('hyline').length, 2, 'still two businesses, not four');
  store.close();
});

test('a release does not overwrite a script somebody has rewritten', () => {
  const store = fresh();
  store.outreach.release('hyline', 'r1', 'Release 1', 'tester', [entry('Karve Pilates', '4827 S Route 59')]);
  const id = store.outreach.businesses('hyline')[0].id;

  store.outreach.saveScript('hyline', id, script('My own words.'));
  const again = store.outreach.release('hyline', 'r1', 'Release 1', 'tester', [entry('Karve Pilates', '4827 S Route 59')]);

  assert.deepEqual(again.keptScript, ['Karve Pilates']);
  assert.equal(store.outreach.script('hyline', id)!.script.opening, 'My own words.');
  assert.equal(store.outreach.script('hyline', id)!.edited, true);
  store.close();
});

test('a recorded visit moves the relationship and is readable back', () => {
  const store = fresh();
  store.outreach.release('hyline', 'r1', 'Release 1', 'tester', [entry('Karve Pilates', '4827 S Route 59')]);
  const id = store.outreach.businesses('hyline')[0].id;

  const { business } = store.outreach.recordVisit('hyline', {
    businessId: id, staff: 'Alexis', visitedOn: '2026-10-28', spokeWith: 'Dana',
    contactRole: 'Owner', outcome: 'interested', materials: 12, note: 'Warm.',
    nextAction: 'Call back', followUpOn: '2026-11-11',
  });

  assert.equal(business.stage, 'interested');
  const [visit] = store.outreach.visits('hyline', id);
  assert.equal(visit.spokeWith, 'Dana');
  assert.equal(visit.materials, 12);
  assert.equal(visit.outcomeLabel, 'Interested');
  assert.equal(visit.businessName, 'Karve Pilates');
  assert.equal(visit.edited, false);
  store.close();
});

test('the same submission sent twice records one visit', () => {
  const store = fresh();
  store.outreach.release('hyline', 'r1', 'Release 1', 'tester', [entry('Karve Pilates', '4827 S Route 59')]);
  const id = store.outreach.businesses('hyline')[0].id;
  const once = {
    businessId: id, staff: 'Alexis', visitedOn: '2026-10-28', spokeWith: 'Dana', contactRole: 'Owner',
    outcome: 'interested' as const, materials: 6, note: '', nextAction: '', followUpOn: null,
    clientRef: 'tap-abc12345',
  };
  store.outreach.recordVisit('hyline', once);
  store.outreach.recordVisit('hyline', once);
  assert.equal(store.outreach.visits('hyline', id).length, 1, 'a double tap is still one visit');
  store.close();
});

test('a visit cannot be recorded against another practice business', () => {
  const store = fresh();
  store.outreach.release('hyline', 'r1', 'Release 1', 'tester', [entry('Karve Pilates', '4827 S Route 59')]);
  const id = store.outreach.businesses('hyline')[0].id;
  assert.throws(() => store.outreach.recordVisit('other', {
    businessId: id, staff: 'Someone', visitedOn: '2026-10-28', spokeWith: '', contactRole: '',
    outcome: 'interested', materials: 0, note: '', nextAction: '', followUpOn: null,
  }), /not on your list/);
  assert.equal(store.outreach.visits('hyline', id).length, 0);
  store.close();
});

test('an edit keeps what the visit said before', () => {
  const store = fresh();
  store.outreach.release('hyline', 'r1', 'Release 1', 'tester', [entry('Karve Pilates', '4827 S Route 59')]);
  const id = store.outreach.businesses('hyline')[0].id;
  const { visit } = store.outreach.recordVisit('hyline', {
    businessId: id, staff: 'Alexis', visitedOn: '2026-10-28', spokeWith: 'Dana', contactRole: 'Owner',
    outcome: 'interested', materials: 12, note: '', nextAction: '', followUpOn: null,
  });

  const fixed = store.outreach.editVisit('hyline', visit.id, { materials: 6, outcome: 'partner' }, 'Alexis');
  assert.equal(fixed.materials, 6);
  assert.equal(fixed.edited, true);
  assert.equal(store.outreach.business('hyline', id)!.stage, 'partner', 'the stage follows the correction');

  const kept = store.db.prepare('SELECT was FROM visit_edits WHERE visit_id=?').get(visit.id) as { was: string };
  assert.equal(JSON.parse(kept.was).materials, 12, 'the original figure is still on record');
  store.close();
});

test('an outcome we do not recognise is refused rather than stored', () => {
  const store = fresh();
  store.outreach.release('hyline', 'r1', 'Release 1', 'tester', [entry('Karve Pilates', '4827 S Route 59')]);
  const id = store.outreach.businesses('hyline')[0].id;
  assert.throws(() => store.outreach.recordVisit('hyline', {
    businessId: id, staff: '', visitedOn: '2026-10-28', spokeWith: '', contactRole: '',
    outcome: 'sold-them-a-car' as never, materials: 0, note: '', nextAction: '', followUpOn: null,
  }), /not an outcome/);
  store.close();
});

test('the release file we ship for Hyline is five distinct, verified businesses', async () => {
  const release = JSON.parse(await (await import('node:fs/promises')).readFile('data/releases/hyline-release-1.json', 'utf8'));
  assert.equal(release.businesses.length, 5);
  const keys = new Set(release.businesses.map((b: { name: string; address: string }) => `${b.name}|${b.address}`));
  assert.equal(keys.size, 5, 'no duplicates');
  for (const b of release.businesses) {
    assert.ok(b.address.includes('Naperville'), `${b.name} has a real address`);
    assert.ok(b.phone && b.website, `${b.name} has a phone and a website`);
    assert.ok(b.script.opening.length > 40, `${b.name} has its own opening`);
    assert.equal(b.lat, undefined, 'no coordinate is invented');
  }
  const openings = new Set(release.businesses.map((b: { script: { opening: string } }) => b.script.opening));
  assert.equal(openings.size, 5, 'each business has its own script, not one shared one');
});

test('a username already used elsewhere is refused by name, and creates nothing', () => {
  const store = openStore(':memory:', false);
  store.createClient('one', 'First Practice', 'shared-name', 'pw', 'b');
  assert.throws(() => store.createClient('two', 'Second Practice', 'Shared-Name', 'pw', 'b'),
    /already in use on another account/);
  // The clinic row went in the same transaction as the login, so neither survived.
  assert.equal(store.db.prepare('SELECT id FROM clinics WHERE id=?').get('two'), undefined);
  store.close();
});
