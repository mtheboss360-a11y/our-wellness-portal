import type { PortalSnapshot } from '../../data/portal-data';
async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(path, { method, credentials: 'same-origin', cache: 'no-store', headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
  // The server's own sentence when it sent one — "a route takes up to 5 stops" is more use to
  // a client than a generic failure — and the generic failure when it did not.
  if (!response.ok) { const detail = await response.json().catch(() => null); throw new Error((detail as { error?: string } | null)?.error || 'The request could not be completed.'); }
  return response.json() as Promise<T>;
}
export const getPortal = () => request<PortalSnapshot>('/api/portal');
export const login = ({ data }: { data: { username: string; password: string } }) => request<{ ok: boolean; message: string }>('/api/login', 'POST', data);
export const logout = () => request<{ ok: boolean }>('/api/logout', 'POST');

// Network Map. Same same-origin client, same generic failure message: the server decides
// everything and the browser only asks.
import type { NetworkMapPayload } from './network-math';
export const getNetworkMap = () => request<NetworkMapPayload>('/api/network/map');
export const refreshNetworkMap = () => request<NetworkMapPayload>('/api/network/refresh', 'POST', {});
export const setDeviceLocation = (input: { lat: number; lng: number; accuracy?: number }) => request<NetworkMapPayload>('/api/network/location', 'POST', input);
export const saveSelection = (placeIds: string[]) => request<{ selection: string[]; refused: Array<{ placeId: string; reason: string }> }>('/api/network/selection', 'POST', { placeIds });
export const requestRoute = (input: { contactName: string; contactPhone: string; notes: string; preferredFrom: string; preferredTo: string }) =>
  request<{ request: NetworkMapPayload['requests'][number]; requests: NetworkMapPayload['requests']; selection: string[] }>('/api/network/route-request', 'POST', input);

// The field log: drivers, routes and sign-ups. Null until a clinic's log has been imported.
import type { FieldLog } from '../../data/field-data';
export const getField = () => request<{ field: FieldLog | null }>('/api/field');
export type BakeryRow = { placeId: string; name: string | null; address: string | null; town: string | null; kind: 'local' | 'panera' | 'krispy-kreme'; label: string; category: { color: string }; distanceMiles: number; rating: number | null; reviewCount: number | null; googleMapsUri: string | null };
export type BakeryPayload = { clinic: { name: string; location: { label: string } | null }; bakeries: BakeryRow[]; removed: number; choice: string | null; placesConfigured: boolean };
export const getBakeries = () => request<BakeryPayload>('/api/network/bakeries');
export const chooseBakery = (placeId: string | null) => request<BakeryPayload>('/api/network/bakery', 'POST', { placeId });
export type ItemsRequest = { placeId: string; items: string; people: number; neededBy: string; contactName: string; contactPhone: string; notes: string };
export const requestItems = (input: ItemsRequest) => request<BakeryPayload & { sent: boolean }>('/api/network/bakery-request', 'POST', input);
export const removeBakery = (placeId: string | null) => request<BakeryPayload>('/api/network/bakery-remove', 'POST', { placeId });

// Route notes: what the practice's own staff wrote about a business they visited.
export type VisitNote = { businessId: string; note: string; nextRound: boolean };
export const getVisitNotes = () => request<{ notes: VisitNote[] }>('/api/field/notes');
export const saveVisitNote = (input: VisitNote) => request<{ notes: VisitNote[] }>('/api/field/notes', 'POST', input);

// The businesses this practice has been released, what to say at each, and what happened.
import type { Business, Script, Visit, Outcome } from '../../server/outreach';
export type { Business, Script, Visit, Outcome };
export const getBusinesses = () =>
  request<{ businesses: Business[]; releases: Array<{ id: string; name: string; released_at: number; size: number }> }>('/api/outreach/businesses');
export const getBusiness = (id: string) =>
  request<{ business: Business; script: { script: Script; edited: boolean } | null; visits: Visit[] }>(`/api/outreach/business?id=${encodeURIComponent(id)}`);
export const getVisits = () => request<{ visits: Visit[] }>('/api/outreach/visits');
export type VisitDraft = {
  businessId: string; visitedOn: string; spokeWith: string; contactRole: string;
  outcome: Outcome; materials: number; note: string; nextAction: string;
  followUpOn: string | null; clientRef?: string;
};
export const recordVisit = (input: VisitDraft) =>
  request<{ visit: Visit; business: Business }>('/api/outreach/visit', 'POST', input);
export const editVisit = (input: { visitId: string } & Partial<VisitDraft>) =>
  request<{ visit: Visit }>('/api/outreach/visit', 'PATCH', input);

// Rounds: a day's work built from the released businesses.
import type { Round } from './round-math';
export type { Round };
export const getRounds = () => request<{
  rounds: Round[]; visits: Visit[]; clinic: { lat: number; lng: number; label: string } | null;
}>('/api/outreach/rounds');

// THE ROUTE RUNNER'S PLANNER. Every call goes to /api/runner/*, where the server decides which
// routes are this person's; the browser never sends a clinic, a user or an allocation.
//
// `revision` is what the screen was showing when the runner acted. A 409 means somebody else
// changed the route first — the response carries the current route, so the screen reloads from
// the server rather than keeping an order that was never saved.
import type { ItemRef, PickupDraft, RunnerRound, Supplies } from '../../server/runner';
export type { ItemRef, PickupDraft, RunnerItem, RunnerRound, Pickup, PickupKind, Supplies } from '../../server/runner';

/** A route as the planner reads it: the round, plus what is in the car. */
export type RunnerRoute = RunnerRound & { collected: Supplies; dropped: Supplies; remaining: Supplies };
export type RunnerPayload = {
  routes: RunnerRoute[]; visits: Visit[]; materials: Record<string, Supplies>;
  clinic: { lat: number; lng: number; label: string } | null;
  practice: string; runner: { name: string | null };
};

/** A failed write that carries the route as it now stands, so the screen can roll back onto it. */
export class RouteChanged extends Error {
  constructor(message: string, readonly route: RunnerRoute | null) { super(message); this.name = 'RouteChanged'; }
}

async function runnerWrite(path: string, body: unknown): Promise<{ route: RunnerRoute }> {
  const response = await fetch(path, {
    method: 'POST', credentials: 'same-origin', cache: 'no-store',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null) as { error?: string; route?: RunnerRoute } | null;
  if (response.status === 409) throw new RouteChanged(payload?.error ?? 'This route changed somewhere else.', payload?.route ?? null);
  if (!response.ok) throw new Error(payload?.error || 'That change could not be saved.');
  return payload as { route: RunnerRoute };
}

export const getRunnerRoutes = () => request<RunnerPayload>('/api/runner/routes');
export const getRunnerBusiness = (roundId: string, id: string) =>
  request<{ business: Business; script: { script: Script; edited: boolean } | null; visits: Visit[] }>(
    `/api/runner/business?round=${encodeURIComponent(roundId)}&id=${encodeURIComponent(id)}`);
/** The visits this login recorded, with the date of each round they were recorded on. */
export const getRunnerHistory = () =>
  request<{ visits: Visit[]; rounds: Record<string, string> }>('/api/runner/history');
export const reorderRoute = (roundId: string, order: ItemRef[], revision: number) =>
  runnerWrite('/api/runner/order', { roundId, order, revision });
export const savePickup = (roundId: string, revision: number, draft: PickupDraft & { pickupId?: string }) =>
  runnerWrite('/api/runner/pickup', { roundId, revision, ...draft });
export const removePickup = (roundId: string, pickupId: string, revision: number) =>
  runnerWrite('/api/runner/pickup/remove', { roundId, pickupId, revision });
export const collectPickup = (roundId: string, pickupId: string, revision: number, collected?: Supplies) =>
  runnerWrite('/api/runner/pickup/collected', { roundId, pickupId, revision, collected });
export const confirmPacked = (roundId: string, supplies: Supplies, revision: number) =>
  runnerWrite('/api/runner/packed', { roundId, supplies, revision });

/** A visit recorded from the planner: the same record, with the breakdown of what was dropped. */
export type RunnerVisitDraft = {
  /** The round this visit is being recorded on. The server checks it is the caller's. */
  roundId: string;
  businessId: string; visitedOn: string; spokeWith: string; contactRole: string;
  outcome: Outcome; dropped: Supplies; note: string; nextAction: string;
  followUpOn: string | null; clientRef?: string;
};
export const recordRunnerVisit = (input: RunnerVisitDraft) =>
  request<{ visit: Visit; business: Business; dropped: Supplies | null; route: RunnerRoute | null }>(
    '/api/runner/visit', 'POST', input);
