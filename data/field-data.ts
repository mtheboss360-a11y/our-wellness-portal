// THE FIELD LOG. What the drivers' Google Form and the staff sign-up form record, per clinic:
// who drove, where they stopped, what they handed out, who signed up afterwards and whether the
// clinic booked them. Nothing here is computed — the portal derives every total from these rows.
// The live build ships no field log; each clinic's is loaded with scripts/import-field-log.ts.
export type Category = 'gym' | 'yoga' | 'pilates' | 'salon' | 'nails' | 'boutique' | 'physio' | 'cycle' | 'other';
export type Driver = { id: string; name: string; photo: string; homeBase: string; since: string; vehicle: string; languages: string[]; bio: string };
export type CrossRef = { theirClients: string; yourServices: string[]; score: number };
export type FieldStop = {
  id: string; businessId: string; name: string; category: Category; town: string; lat: number; lng: number;
  arrived: string | null; left: string | null; spokeWith: string;
  staffOnShift: number; boxes: number; coffees: number; cards: number; display: boolean;
  outcome: 'joined' | 'follow-up' | 'not-now' | 'pending'; note: string; photo: string | null; crossRef: CrossRef;
};
export type FieldRoute = { id: string; date: string; start: string; driverId: string; status: 'done' | 'scheduled'; stops: FieldStop[] };
export type Signup = { id: string; firstName: string; routeId: string; stopId: string; date: string; service: string; status: 'new' | 'called' | 'booked' };
export type FieldLog = { clinic: { label: string; lat: number; lng: number }; drivers: Driver[]; routes: FieldRoute[]; signups: Signup[] };
