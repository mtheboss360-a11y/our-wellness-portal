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
