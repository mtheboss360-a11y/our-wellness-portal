// WHICH RING A CARD LANDS ON.
//
// Once the orbit splits, the ring is not decoration: the inner one means "on the round that is
// coming" and the outer one means "waiting". A card on the wrong ring tells the owner the
// opposite of the truth about where their people are going, so the rule is pinned here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { place, type Connection } from '../src/ReferralOrbit';

const make = (n: number, group: Connection['group'], from = 0): Connection[] =>
  Array.from({ length: n }, (_, i) => ({ id: `b${from + i}`, name: `Business ${from + i}`, demo: false, group }));

const ringOf = (placed: ReturnType<typeof place>, id: string) =>
  placed.find(p => p.connection.id === id)?.ring;

test('the round that is coming rides the inner ring, the rest the outer one', () => {
  const placed = place([...make(5, 'routed'), ...make(5, 'waiting', 5)]);
  assert.equal(placed.length, 10);
  for (const c of make(5, 'routed')) assert.equal(ringOf(placed, c.id), 0, `${c.id} should be inside`);
  for (const c of make(5, 'waiting', 5)) assert.equal(ringOf(placed, c.id), 1, `${c.id} should be outside`);
});

test('with nobody routed the orbit lays out as one ring, as it always did', () => {
  const placed = place(make(10, undefined));
  assert.equal(placed.length, 10);
  assert.ok(placed.every(p => p.ring === 0), 'a single ring, not a split');
});

test('a round too big for the inner ring falls back rather than splitting a lie', () => {
  // The inner ring holds six. A seventh routed card cannot go on it, and putting it outside
  // would put it among the ones nobody is visiting — so the split is abandoned instead.
  const placed = place([...make(7, 'routed'), ...make(5, 'waiting', 7)]);
  const routedRings = new Set(make(7, 'routed').map(c => ringOf(placed, c.id)));
  assert.equal(routedRings.size, 1, 'the routed cards are not spread across both rings');
});

test('every card gets a place, and no two sit on the same spot', () => {
  const placed = place([...make(5, 'routed'), ...make(5, 'waiting', 5)]);
  const spots = new Set(placed.map(p => `${p.x.toFixed(3)},${p.y.toFixed(3)}`));
  assert.equal(spots.size, placed.length, 'no card is hidden underneath another');
  assert.ok(placed.every(p => Number.isFinite(p.x) && Number.isFinite(p.y)));
});
