// Privately owned only. A referral partner is a local business whose owner can say yes: no chains,
// no franchises, nothing public or institutional. A place is dropped when
//   - its name matches a known chain or franchise,
//   - the same name shows up at two or more places nearby (a local chain),
//   - its name or its Google types say park, school, church, hospital, government and the like.

import { nameKey } from './network';
import type { DiscoveredPlace } from './places';

const CHAINS = [
  // gyms and boutique fitness franchises
  'planet fitness', 'la fitness', 'orangetheory', 'anytime fitness', 'f45', 'crunch fitness', 'snap fitness', '24 hour fitness',
  'life time', 'lifetime', 'lifetime fitness', 'lt athletic', 'xsport', 'equinox', 'ymca', 'gold s gym', 'golds gym', 'chicago athletic clubs', 'midtown athletic',
  'east bank club', 'fitness formula', 'ff clubs', 'burn boot camp', 'fit body boot camp', 'title boxing', '9round', 'stretchlab',
  'stretch zone', 'row house', 'cyclebar', 'pure barre', 'club pilates', 'yogasix', 'corepower yoga', 'bodybar', 'solidcore',
  'the barre code', 'barre3', 'eos fitness', 'blink fitness', 'workout anytime', 'bft', 'rumble', 'barry s', 'shred415', 'hotworx',
  'the dailey method', 'perfect fit', 'd1 training', 'mayweather boxing', 'ufc gym', 'the little gym', 'my gym', 'lady of america',
  'curves', 'jazzercise', 'hot yoga', 'bikram', 'modo yoga', 'lifepower yoga', 'xponential',
  // salons, barbers, beauty
  'great clips', 'supercuts', 'sport clips', 'fantastic sams', 'cost cutters', 'hair cuttery', 'regis', 'mastercuts', 'smartstyle',
  'first choice haircutters', 'floyd s 99', 'roosters', 'the lodge', 'v s barbershop', 'drybar', 'blo blow dry', 'sola salon',
  'salon lofts', 'phenix salon', 'my salon suite', 'salons by jc', 'image studios', 'ulta', 'sally beauty', 'sephora',
  'european wax center', 'waxing the city', 'benefit brow', 'amazing lash', 'lash lounge', 'deka lash', 'hand stone',
  'massage envy', 'massage heights', 'elements massage', 'massage luxe', 'spavia', 'woodhouse', 'restore hyper wellness',
  'the joint', 'chiro one', '100 chiropractic', 'hello sugar', 'regal nails', 'frenchies',
  // therapy chains and health systems
  'ati physical therapy', 'athletico', 'illinois bone joint', 'ivy rehab', 'novacare', 'select physical therapy', 'pt solutions',
  'upstream rehabilitation', 'professional physical therapy', 'northwestern medicine', 'advocate', 'endeavor health', 'edward elmhurst',
  'duly health', 'rush', 'loyola medicine', 'amita', 'ascension', 'uchicago medicine', 'midwest orthopaedics',
  // retail, juice, nutrition
  'gnc', 'vitamin shoppe', 'smoothie king', 'tropical smoothie', 'jamba', 'robeks', 'clean juice', 'nekter', 'playa bowls',
  'everbowl', 'nothing bundt', 'whole foods', 'trader joe s', 'mariano s', 'jewel osco', 'sprouts', 'fresh thyme', 'aldi',
  'dick s sporting goods', 'scheels', 'academy sports', 'big 5', 'rei', 'fleet feet', 'running room', 'play it again',
  'lululemon', 'athleta', 'nike', 'walgreens', 'cvs', 'target', 'costco', 'walmart', 'kroger', 'meijer', 'hy vee',
].map(nameKey);

/** Words in a name that mean public, institutional or not a business an owner runs. */
const NOT_PRIVATE = /\b(park|park district|forest preserve|school|high school|middle school|elementary|university|college|campus|church|parish|temple|mosque|synagogue|ministr(y|ies)|hospital|medical center|health system|clinic network|village of|city of|township|county|state of|government|police|fire department|library|ymca|ywca|community center|recreation center|rec center|field|fields|courts?|tennis courts|pool|aquatic|apartments?|condominiums?|residences|hotel|inn|resort|country club|golf course|club house|clubhouse|hoa)\b/i;

/** Google types that are never a privately owned partner. */
const PUBLIC_TYPES = new Set(['park', 'city_park', 'national_park', 'state_park', 'dog_park', 'playground', 'school', 'primary_school', 'secondary_school',
  'university', 'library', 'church', 'place_of_worship', 'mosque', 'synagogue', 'hindu_temple', 'hospital', 'local_government_office', 'city_hall',
  'courthouse', 'police', 'fire_station', 'community_center', 'athletic_field', 'swimming_pool', 'golf_course', 'stadium', 'arena',
  'lodging', 'hotel', 'apartment_building', 'apartment_complex', 'housing_complex', 'department_store', 'supermarket', 'grocery_store',
  'shopping_mall', 'warehouse_store', 'pharmacy', 'drugstore', 'corporate_office']);

export function privateOnly(places: Array<Pick<DiscoveredPlace, 'name' | 'types' | 'primaryType'>>) {
  const counts = new Map<string, number>();
  for (const place of places) { const key = nameKey(place.name); if (key) counts.set(key, (counts.get(key) ?? 0) + 1); }
  return (place: Pick<DiscoveredPlace, 'name' | 'types' | 'primaryType'>) => {
    const key = nameKey(place.name);
    if (!key) return false;
    if ((counts.get(key) ?? 0) > 1) return false;
    // A chain's name anywhere in the name counts: "Chiropractic at Life Time" is inside a Life Time. Short
    // chain names (cvs, rei, rush...) only match at the start, so they don't catch ordinary words.
    if (CHAINS.some(chain => key === chain || key.startsWith(chain) || (chain.length >= 6 && key.includes(chain)))) return false;
    if (/\b(at|inside|@)\s/i.test(place.name ?? '') && CHAINS.some(chain => chain.length >= 3 && key.includes(chain))) return false;
    if (NOT_PRIVATE.test(place.name ?? '')) return false;
    if ([place.primaryType, ...place.types].some(type => type && PUBLIC_TYPES.has(type))) return false;
    return true;
  };
}
