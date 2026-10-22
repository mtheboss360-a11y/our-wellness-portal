import type { PortalSnapshot } from '../../data/portal-data';
async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(path, { method, credentials: 'same-origin', cache: 'no-store', headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
  if (!response.ok) throw new Error('The request could not be completed.');
  return response.json() as Promise<T>;
}
export const getPortal = () => request<PortalSnapshot>('/api/portal');
export const login = ({ data }: { data: { username: string; password: string } }) => request<{ ok: boolean; message: string }>('/api/login', 'POST', data);
export const logout = () => request<{ ok: boolean }>('/api/logout', 'POST');
