// THE CROSS-REFERENCE ENGINE. Pure functions, no database and no network, so the rules can
// be read and tested on their own.
//
// WHAT A CLIENT IS ALLOWED TO LEARN. A status and a reason, and nothing else. The network
// records carry `ownerClinicId` — which clinic holds a partnership or an exclusivity — and
// that field never leaves this module: no status string, reason string or payload field below
// names another clinic, hints at its identity, or says which clinic an agreement belongs to.
// "An existing agreement covers this business" is the whole of what a client is told.
//
// WHAT THE ENGINE REFUSES. `routable: false` is not advice. server/store.ts re-runs this same
// function when a selection is saved and when a route request is created, and drops anything
// that is not routable, so a client cannot route to a direct competitor or to a business an
// agreement restricts by editing a request.

import { CATEGORY_RULES, DISTANCE_BANDS, categoryForTypes, type CategoryRule } from './config';
import type { DiscoveredPlace } from './places';

export type RecordKind = 'client' | 'partner' | 'exclusive' | 'competitor' | 'blocked';
export type NetworkRecord = {
  id: string;
  kind: RecordKind;
  /** Which clinic holds this record, or null for a network-wide record. NEVER sent to a client. */
  ownerClinicId: string | null;
  placeId: string | null;
  nameKey: string | null;
  addressKey: string | null;
  note: string;
};

export type Status = 'fit' | 'review' | 'competitor' | 'in-network' | 'unavailable';
export type CrossReference = { status: Status; label: string; reason: string; routable: boolean };

const LABELS: Record<Status, string> = {
  fit: 'Good referral fit',
  review: 'Possible conflict',
  competitor: 'Direct competitor',
  'in-network': 'Already in network',
  unavailable: 'Unavailable',
};

/** Names are matched on letters and digits only, so "Oak St. Yoga" and "Oak Street Yoga" meet. */
export const nameKey = (value: string | null | undefined) =>
  (value ?? '').toLowerCase().replace(/\b(the|and|co|inc|llc|ltd|studio|studios)\b/g, '').replace(/[^a-z0-9]/g, '');

/** House number plus ZIP: enough to tell two businesses apart without storing the address. */
export const addressKey = (value: string | null | undefined) => {
  const text = (value ?? '').toLowerCase();
  const number = text.match(/\b(\d{1,6})\b/)?.[1] ?? '';
  const zip = text.match(/\b(\d{5})(?:-\d{4})?\b(?!.*\b\d{5}\b)/)?.[1] ?? '';
  return number && zip ? `${number}-${zip}` : '';
};

/** Every network record this place matches, strongest key first. */
export function matchRecords(place: Pick<DiscoveredPlace, 'placeId' | 'name' | 'address'>, records: NetworkRecord[]) {
  const name = nameKey(place.name);
  const address = addressKey(place.address);
  return records.filter(record =>
    (record.placeId && record.placeId === place.placeId) ||
    (!!name && record.nameKey === name) ||
    (!!address && !!record.addressKey && record.addressKey === address));
}

/**
 * The status for one business, for one clinic.
 *
 * Order matters and is the whole safety argument: a reason to refuse is checked before any
 * reason to allow, so a business that is both a flagged competitor and somebody's partner
 * comes back as a competitor, not as routable.
 */
export function crossReference(
  place: Pick<DiscoveredPlace, 'placeId' | 'name' | 'address' | 'types' | 'primaryType'>,
  category: CategoryRule | null,
  records: NetworkRecord[],
  clinicId: string,
  competitorCategories: string[],
): CrossReference {
  const matched = matchRecords(place, records);
  const held = (kind: RecordKind, byThisClinic: boolean) =>
    matched.some(record => record.kind === kind && (byThisClinic ? record.ownerClinicId === clinicId : record.ownerClinicId !== clinicId));

  const competesByCategory = !!category && (category.competitor === true || competitorCategories.includes(category.id));
  if (competesByCategory || matched.some(record => record.kind === 'competitor'))
    return { status: 'competitor', label: LABELS.competitor, reason: 'Sells the same kind of sessions to the same neighborhood, so the network does not route your clinic here.', routable: false };

  if (matched.some(record => record.kind === 'blocked'))
    return { status: 'unavailable', label: LABELS.unavailable, reason: 'This business has asked the network not to approach it. It is not available to route.', routable: false };

  if (held('exclusive', false))
    return { status: 'unavailable', label: LABELS.unavailable, reason: 'An existing agreement in the network already covers this business, so it is not available to your clinic.', routable: false };

  // A client of the network that is not a competitor by category is still another member's
  // account: it is already inside the network, and the client is told only that.
  if (held('client', false) || held('partner', false))
    return { status: 'review', label: LABELS.review, reason: 'This business already has an arrangement inside the network. The OUR Optimization team needs to review it before any outreach.', routable: true };

  if (held('exclusive', true) || held('partner', true) || held('client', true))
    return { status: 'in-network', label: LABELS['in-network'], reason: 'Already approved for your clinic. Visiting is fine — no new arrangement is needed.', routable: true };

  // No record matched. A business that is partly in a competing line of work — a gym with its
  // own treatment rooms, say — is a judgement call, not an automatic yes.
  const competingTypes = CATEGORY_RULES.filter(rule => rule.competitor).flatMap(rule => rule.googleTypes);
  if (place.types.some(type => competingTypes.includes(type)))
    return { status: 'review', label: LABELS.review, reason: 'Listed under a service your clinic also offers, as well as its main category. Worth a look before outreach.', routable: true };

  if (!category)
    return { status: 'review', label: LABELS.review, reason: 'The network has no category rule for this business yet, so its fit is unconfirmed.', routable: true };

  return { status: 'fit', label: LABELS.fit, reason: 'Shares the kind of customer your clinic already sees, and nothing in the network conflicts.', routable: true };
}

/**
 * The fit score, 0-100, and the reasons it reached that number.
 *
 * Google's rating and review count are deliberately NOT inputs. A five-star gym is a popular
 * gym; it is not a gym that has agreed to anything. Both figures are shown on the card as
 * context and are kept out of the arithmetic.
 */
export function fitScore(category: CategoryRule | null, distanceMiles: number) {
  const band = DISTANCE_BANDS.find(entry => distanceMiles <= entry.withinMiles) ?? DISTANCE_BANDS[DISTANCE_BANDS.length - 1];
  const categoryPoints = category && !category.competitor ? category.weight : 0;
  const components = [
    { label: category ? category.label : 'Uncategorised', detail: category?.reason ?? 'No category rule matches this business yet.', points: categoryPoints, outOf: 60 },
    { label: 'Distance', detail: `${distanceMiles.toFixed(1)} miles — ${band.label}.`, points: band.points, outOf: 40 },
  ];
  return { score: categoryPoints + band.points, components };
}
