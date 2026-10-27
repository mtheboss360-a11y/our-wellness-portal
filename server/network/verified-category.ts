// WHAT WE KNOW ABOUT A BUSINESS WE RELEASED OURSELVES.
//
// Google classifies a place with its own type list, and the Network Map's category rules read
// that list. Most of the time it is right. Sometimes it says almost nothing: Karve Pilates came
// back as `health, point_of_interest, establishment` — true, and useless, since `health` covers
// dentists, doctors and chiropractors alike. Loosening a rule to match `health` would miscolour
// half the map.
//
// But for a business WE released we already hold a category somebody verified by hand, in the
// release file. That is better information than "health", and this turns it into the type the
// existing rules already understand. It is used only when Google's own types classify a place
// as nothing, and only for a released business — never to override what Google did say, and
// never for a place discovered by a search.
//
// This adds no rule and changes no score. It supplies an input the rules were always expecting.

/** Our own category wording → the Google type the category rules match on. */
const FROM_OUR_WORDS: Array<[RegExp, string]> = [
  [/pilates|yoga|barre/i, 'yoga_studio'],
  [/gym|fitness|strength|cycling|crossfit|swim/i, 'gym'],
  [/physical therapy|physio|rehab/i, 'physiotherapist'],
  [/chiroprac/i, 'chiropractor'],
  [/barber|grooming/i, 'barber_shop'],
  [/nail/i, 'nail_salon'],
  [/salon|hair|beauty/i, 'hair_salon'],
  [/spa|massage|sauna|skin|esthet|aesthet/i, 'spa'],
  [/juice|health food|nutrition|supplement/i, 'juice_shop'],
];

/**
 * A type to stand in for one the rules can use, read from the category we recorded when the
 * business was released. Null when our own wording does not match anything either — in which
 * case the business stays uncategorised, which is the honest answer.
 */
export function typeFromVerifiedCategory(category: string): string | null {
  for (const [pattern, type] of FROM_OUR_WORDS) if (pattern.test(category)) return type;
  return null;
}
