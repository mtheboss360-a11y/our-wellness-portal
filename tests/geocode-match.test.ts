// WHO GOOGLE'S ANSWER IS ACTUALLY ABOUT.
//
// This file exists because of a real incident. geocode-release matched on street number and
// town only, and the sample businesses are invented names placed on real Naperville streets.
// Asked about "Copperleaf Salon, 1163 E Ogden Ave", Google returned the business that really
// trades at 1163 E Ogden Ave — a perfect address match to a completely different company.
// Eight illustrative records were handed the place ID and coordinates of real businesses.
//
// Two defences, tested here: the name has to agree too, and an illustrative business is never
// looked up at all.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const EMPTY = new Set(['the', 'and', 'of', 'at', 'studio', 'salon', 'spa', 'clinic', 'center',
  'centre', 'co', 'inc', 'llc', 'ltd', 'naperville', 'il', 'chicago']);
const words = (value: string) => value.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/)
  .filter(word => word.length > 2 && !EMPTY.has(word));
const streetNumber = (address: string) => address.trim().match(/^\s*(\d+)/)?.[1] ?? '';
const town = (address: string) => {
  const parts = address.split(',').map(p => p.trim());
  const index = parts.findIndex(p => /^[A-Z]{2}\b/.test(p));
  return (index > 0 ? parts[index - 1] : parts.at(-2) ?? '').toLowerCase();
};
function agrees(askedName: string, asked: string, gotName: string | null, got: string | null) {
  if (!got) return false;
  const wantedNumber = streetNumber(asked);
  if (wantedNumber && streetNumber(got) !== wantedNumber) return false;
  const wantedTown = town(asked);
  if (wantedTown && !got.toLowerCase().includes(wantedTown)) return false;
  const ours = words(askedName);
  const theirs = words(gotName ?? '');
  if (!ours.length) return true;
  return ours.some(word => theirs.some(other => other === word || other.includes(word) || word.includes(other)));
}

test('the five verified businesses still match their real Google answers', () => {
  const real: Array<[string, string, string, string]> = [
    ['Karve Pilates', '4827 S Illinois Route 59, Unit 105, Naperville, IL 60564', 'Karve Pilates', '4827 Rte 59 #105, Naperville, IL 60564, USA'],
    ['KidSnips Naperville', '2835 Showplace Drive, Suite 131, Naperville, IL 60564', 'KidSnips', '2835 Showplace Dr Ste 131, Naperville, IL 60564, USA'],
    ['Salon Fluxx', '1048 104th Street, Suite 100, Naperville, IL 60564', 'Salon Fluxx', '1048 104th St #100, Naperville, IL 60564, USA'],
    ['Upscale Male', '1935 95th Street, Suite 123, Naperville, IL 60564', 'Upscale Male', '1935 95th St #123, Naperville, IL 60564, USA'],
    ['Yoga Cave', '2863 95th Street, Suite 159, Naperville, IL 60564', 'Yoga Cave', '2863 95th St #159, Naperville, IL 60564, USA'],
  ];
  for (const [name, asked, gotName, got] of real) {
    assert.equal(agrees(name, asked, gotName, got), true, `${name} should still match`);
  }
});

test('a different business at the right address is refused', () => {
  // The actual incident: an invented salon name on a real street.
  assert.equal(agrees('Copperleaf Salon', '1163 E Ogden Ave, Naperville, IL',
    'Ogden Dental Care', '1163 E Ogden Ave #715, Naperville, IL 60563, USA'), false);
  assert.equal(agrees('Willow Grain Bakery', '34 W Jefferson Ave, Naperville, IL',
    'Jefferson Hill Tap', '34 W Jefferson Ave, Naperville, IL 60540, USA'), false);
  assert.equal(agrees('Sable Lane Barbers', '120 Water St, Naperville, IL',
    'Water Street Apartments', '120 Water St #126, Naperville, IL 60540, USA'), false);
});

test('a generic word alone is not agreement', () => {
  // "Salon" and "Studio" are in nearly every name on this list; sharing one proves nothing.
  assert.equal(agrees('Copperleaf Salon', '10 Main St, Naperville, IL',
    'Hudson Salon', '10 Main St, Naperville, IL 60540, USA'), false);
  assert.equal(agrees('Lantern Barre Studio', '10 Main St, Naperville, IL',
    'Pilates Studio Naperville', '10 Main St, Naperville, IL 60540, USA'), false);
});

test('the wrong street number or the wrong town is still refused', () => {
  assert.equal(agrees('Karve Pilates', '4827 Rte 59, Naperville, IL',
    'Karve Pilates', '4825 Rte 59, Naperville, IL 60564, USA'), false);
  assert.equal(agrees('Karve Pilates', '4827 Rte 59, Naperville, IL',
    'Karve Pilates', '4827 Rte 59, Aurora, IL 60504, USA'), false);
});

test('the practice own address is matched on address alone', () => {
  // There is no business name to check when looking up where the clinic itself is.
  assert.equal(agrees('', '1301 S Route 59, Unit 107, Naperville, IL 60564',
    '', '1301 S Rte 59 Unit 107, Naperville, IL 60564, USA'), true);
});

// ── WHICH BUSINESSES THE REFERRAL LIST SHOWS ────────────────────────────────
// The filter must change the set that is ranked, never the ranking itself. These assert that
// the same scoring produces the same order within whichever set is chosen.
import { bestFifteen } from '../src/lib/network-math.ts';

type Row = Parameters<typeof bestFifteen>[0][number];
const biz = (placeId: string, name: string, miles: number): Row => ({
  placeId, name, address: `${name}, Naperville, IL`, lat: 41.7, lng: -88.15,
  distanceMiles: miles, routable: true, rating: null, reviewCount: null,
  category: { id: 'gym', label: 'Gym', icon: 'dumbbell', color: '#000', competitor: false },
  fit: 0, googleMapsUri: null, matched: [],
} as unknown as Row);

const isSample = (b: { placeId: string }) => b.placeId.startsWith('sample-');
const flat = (groups: ReturnType<typeof bestFifteen>) => groups.flatMap(g => g.businesses.map(b => b.name));

test('the verified filter shows every real business, however the fictional ones rank', () => {
  // Twenty invented businesses sitting closer than the real ones: exactly the demo account.
  const sample = Array.from({ length: 20 }, (_, i) => biz(`sample-${i}`, `Invented ${i}`, 0.5 + i * 0.01));
  const real = [
    biz('ChIJreal1', 'Karve Pilates', 3.1), biz('ChIJreal2', 'Yoga Cave', 1.4),
    biz('ChIJreal3', 'Salon Fluxx', 3.8), biz('ChIJreal4', 'KidSnips Naperville', 2.2),
    biz('ChIJreal5', 'Upscale Male', 2.9),
  ];
  const everything = [...sample, ...real];

  const all = flat(bestFifteen(everything));
  assert.equal(all.length, 15, 'the fifteen limit still holds');
  assert.ok(real.some(r => !all.includes(r.name)), 'crowded out, which is why the filter exists');

  const verified = flat(bestFifteen(everything.filter(b => !isSample(b))));
  assert.equal(verified.length, 5);
  for (const r of real) assert.ok(verified.includes(r.name), `${r.name} is shown`);
});

test('filtering changes the set, not the order within it', () => {
  const everything = [
    biz('sample-a', 'Invented A', 0.5), biz('ChIJb', 'Real B', 1.0),
    biz('sample-c', 'Invented C', 1.5), biz('ChIJd', 'Real D', 2.0),
  ];
  const all = flat(bestFifteen(everything));
  const verified = flat(bestFifteen(everything.filter(b => !isSample(b))));
  const sampleOnly = flat(bestFifteen(everything.filter(isSample)));

  // Each filtered list is the full list with the other kind removed — same relative order.
  assert.deepEqual(verified, all.filter(name => name.startsWith('Real')));
  assert.deepEqual(sampleOnly, all.filter(name => name.startsWith('Invented')));
});

test('the sample marker cannot be mistaken for a Google place id', () => {
  assert.equal(isSample({ placeId: 'sample-0012' }), true);
  assert.equal(isSample({ placeId: 'ChIJN1t_tDeuEmsRUsoyG83frY4' }), false);
  assert.equal(isSample({ placeId: 'preview-abc' }), false);
});
