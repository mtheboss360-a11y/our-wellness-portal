// Owner-operated only. Franchises and national chains don't make referral partners: the staff
// answer to a head office, not the owner down the street. A business is dropped from the map when
// its name matches a known chain, or when the same name shows up at two or more places nearby.

import { nameKey } from './network';

const CHAINS = [
  'planet fitness', 'la fitness', 'orangetheory', 'anytime fitness', 'f45', 'crunch fitness', 'snap fitness', '24 hour fitness',
  'life time', 'lifetime fitness', 'xsport', 'equinox', 'ymca', 'gold s gym', 'golds gym', 'chicago athletic clubs', 'midtown athletic',
  'east bank club', 'burn boot camp', 'fit body boot camp', 'title boxing', '9round', 'stretchlab', 'row house', 'cyclebar', 'pure barre',
  'club pilates', 'yogasix', 'corepower yoga', 'bodybar', 'solidcore', 'the barre code', 'eos fitness', 'blink fitness', 'workout anytime',
  'great clips', 'supercuts', 'sport clips', 'fantastic sams', 'cost cutters', 'hair cuttery', 'regis', 'floyd s 99', 'drybar',
  'european wax center', 'massage envy', 'hand stone', 'massage heights', 'elements massage', 'the joint chiropractic', 'the joint',
  'ati physical therapy', 'athletico', 'illinois bone joint', 'ulta', 'sally beauty', 'sephora', 'gnc', 'vitamin shoppe',
  'smoothie king', 'tropical smoothie', 'jamba', 'whole foods', 'trader joe s', 'mariano s', 'jewel osco', 'sprouts', 'fresh thyme',
  'dick s sporting goods', 'walgreens', 'cvs', 'target', 'costco', 'nothing bundt', 'restore hyper wellness',
].map(nameKey);

export function chainFilter(names: Array<string | null>) {
  const counts = new Map<string, number>();
  for (const name of names) { const key = nameKey(name); if (key) counts.set(key, (counts.get(key) ?? 0) + 1); }
  return (name: string | null) => {
    const key = nameKey(name);
    if (!key) return false;
    if ((counts.get(key) ?? 0) > 1) return true;
    return CHAINS.some(chain => key === chain || key.startsWith(chain));
  };
}
