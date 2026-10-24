import test from 'node:test';
import assert from 'node:assert/strict';
import { townOf, townPicks, type MapBusiness } from '../src/lib/network-math';

const biz = (id: string, address: string | null, score: number, miles = 1, extra: Partial<MapBusiness> = {}): MapBusiness => ({
  placeId: id, name: id, address, category: null, distanceMiles: miles, rating: null, reviewCount: null, googleMapsUri: null,
  plot: { x: 0, y: 0 }, status: 'fit', statusLabel: '', statusReason: '', routable: true, fit: { score, components: [] }, ...extra,
});

test('the town comes from the part before the state', () => {
  assert.equal(townOf('12 Main St, Hinsdale, IL 60521, USA'), 'Hinsdale');
  assert.equal(townOf('400 Oakbrook Center, Oak Brook, IL 60523'), 'Oak Brook');
  assert.equal(townOf('Suite 2, 9 Ogden Ave, Westmont, IL 60559, USA'), 'Westmont');
  assert.equal(townOf(null), null);
  assert.equal(townOf('Somewhere'), null);
});

test('three towns, five best matches in each, ranked towns by how many we can route to', () => {
  const list = [
    ...Array.from({ length: 7 }, (_, i) => biz(`h${i}`, `${i} Elm, Hinsdale, IL 60521`, 60 + i)),
    ...Array.from({ length: 6 }, (_, i) => biz(`o${i}`, `${i} Oak, Oak Brook, IL 60523`, 50 + i)),
    ...Array.from({ length: 5 }, (_, i) => biz(`w${i}`, `${i} Cass, Westmont, IL 60559`, 70)),
    ...Array.from({ length: 2 }, (_, i) => biz(`c${i}`, `${i} Main, Clarendon Hills, IL 60514`, 99)),
  ];
  const groups = townPicks(list);
  assert.deepEqual(groups.map(g => g.town), ['Hinsdale', 'Oak Brook', 'Westmont']);
  assert.ok(groups.every(g => g.businesses.length === 5));
  assert.deepEqual(groups[0].businesses.map(b => b.placeId), ['h6', 'h5', 'h4', 'h3', 'h2'], 'best fit first');
});

test('competitors and businesses we cannot route to are never picked', () => {
  const groups = townPicks([
    biz('a', '1 A, Hinsdale, IL 60521', 90, 1, { status: 'competitor', routable: false }),
    biz('b', '2 B, Hinsdale, IL 60521', 80, 1, { routable: false, status: 'unavailable' }),
    biz('c', '3 C, Hinsdale, IL 60521', 40),
  ]);
  assert.deepEqual(groups.map(g => g.businesses.map(b => b.placeId)), [['c']]);
});
