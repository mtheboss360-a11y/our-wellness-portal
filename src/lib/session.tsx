import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { PortalSnapshot } from '../../data/portal-data';
import { getPortal } from './api';
type Session = { data: PortalSnapshot | null; invalidate: () => Promise<void>; clearCache: () => void };
const Context = createContext<Session | null>(null);
export function SessionProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<PortalSnapshot | null>(null);
  const [error, setError] = useState(false);
  const invalidate = useCallback(async () => { try { const value = await getPortal(); setData(value); setError(false); } catch (failure) { setError(true); throw failure; } }, []);
  const clearCache = useCallback(() => setData(null), []);
  useEffect(() => { void invalidate().catch(() => setError(true)); }, [invalidate]);
  const value = useMemo(() => ({ data, invalidate, clearCache }), [data, invalidate, clearCache]);
  return <Context.Provider value={value}>{data ? children : <main className="boot"><div><img className="boot-logo" src="/assets/owo-logo.png" alt="Our Wellness Network"/><p role="status">{error ? 'We couldn’t open the portal. Please try again.' : 'Opening your portal…'}</p>{error && <button onClick={() => { setError(false); void invalidate().catch(() => setError(true)); }}>Try again</button>}</div></main>}</Context.Provider>;
}
export function useSession() { const value = useContext(Context); if (!value) throw new Error('Session provider is required.'); return value; }
export function useRouter() { const session = useSession(); return useMemo(() => ({ invalidate: session.invalidate, clearCache: session.clearCache }), [session.invalidate, session.clearCache]); }
