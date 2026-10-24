import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createReadStream, existsSync, statSync, readFileSync } from 'node:fs';
import { resolve, extname, sep } from 'node:path';
import { z } from 'zod';
import { bakeryChoiceInput, deviceLocationInput, itemsRequestInput, routeRequestInput, selectionInput } from './validation';
import { DEFAULT_RADIUS_MILES } from './network/config';
import { ensureDiscovery } from './network/map';
import { bakeryPayload, ensureBakeries } from './network/bakeries';
import { sendTeamEmail } from './email';
import { configured as placesConfigured } from './network/places';
import type { ViteDevServer } from 'vite';
import type { PortalStore } from './store';
const loginInput = z.object({ username: z.string().trim().toLowerCase().min(1).max(254), password: z.string().min(1).max(256) });
type Options = { store: PortalStore; origin: string; secure: boolean; root: string; vite?: ViteDevServer; trustProxy?: boolean };
const mime: Record<string, string> = { '.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.ico':'image/x-icon','.svg':'image/svg+xml','.jpg':'image/jpeg','.webp':'image/webp','.woff2':'font/woff2','.webmanifest':'application/manifest+json' };
/* Sign-ins may come from the configured origin or its www twin: the host redirects one to the other, so the page runs on
   whichever is canonical. Any other origin is refused. A local origin has no twin. */
export function allowedOrigins(origin: string) {
  const url = new URL(origin);
  if (['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return new Set([origin]);
  const twin = new URL(origin); twin.hostname = url.hostname.startsWith('www.') ? url.hostname.slice(4) : `www.${url.hostname}`;
  return new Set([origin, twin.origin]);
}
function json(response: ServerResponse, status: number, value: unknown) { response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); response.end(JSON.stringify(value)); }
async function body(request: IncomingMessage) {
  if (!request.headers['content-type']?.startsWith('application/json')) throw new Error('content-type');
  let size = 0; const chunks: Buffer[] = [];
  for await (const chunk of request) { size += chunk.length; if (size > 4096) throw new Error('too-large'); chunks.push(Buffer.from(chunk)); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
export function createPortalServer(options: Options) {
  const { store, origin, secure, root, vite } = options;
  const allowed = allowedOrigins(origin);
  const cookieName = secure ? '__Host-owo-session' : 'owo-local-session';
  const cookieFlags = `Path=/; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}`;
  return createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'same-origin');
    response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(self)'); // the Network Map may ask for the clinic's location
    response.setHeader('X-Robots-Tag', 'noindex, nofollow');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Security-Policy', `default-src 'self'; script-src 'self'${vite ? " 'unsafe-inline'" : ''}; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'${vite ? ' ws://localhost:* ws://127.0.0.1:*' : ''}; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'`);
    if (secure) response.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    try {
      const url = new URL(request.url ?? '/', origin);
      const cookie = request.headers.cookie?.split(';').map(part => part.trim()).find(part => part.startsWith(cookieName + '='))?.slice(cookieName.length + 1);
      if (url.pathname.startsWith('/api/')) {
        if (request.method === 'POST' && !allowed.has(request.headers.origin ?? '')) { json(response, 403, { error: 'Please refresh and try again.' }); return; }
        // A health check anyone can read: whether the server sees a Places key, never the key itself, and the
        // NAMES (no values) of any environment variables that look like one, so a misnamed key can be spotted.
        if (url.pathname === '/api/health' && request.method === 'GET') {
          json(response, 200, { ok: true, placesKey: placesConfigured(), placesVariableNames: Object.keys(process.env).filter(name => /place/i.test(name)).sort() });
          return;
        }
        if (url.pathname === '/api/portal' && request.method === 'GET') { json(response, 200, store.snapshot(cookie)); return; }
        if (url.pathname === '/api/login' && request.method === 'POST') {
          let input;
          try { input = loginInput.safeParse(await body(request)); } catch { json(response, 400, { error: 'Please check your sign-in details.' }); return; }
          if (!input.success) { json(response, 200, { ok: false, message: "Those details didn't match. Please check your email and password and try again." }); return; }
          const forwarded = request.headers['x-forwarded-for'];
          const ip = options.trustProxy && typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : request.socket.remoteAddress ?? 'unknown';
          const result = store.signIn(input.data.username, input.data.password, ip, cookie);
          if (result.ok) response.setHeader('Set-Cookie', `${cookieName}=${result.token}; ${cookieFlags}; Max-Age=28800`);
          json(response, 200, { ok: result.ok, message: result.message }); return;
        }
        // THE FIELD LOG. Drivers, routes and sign-ups for the signed-in clinic only.
        if (url.pathname === '/api/field' && request.method === 'GET') {
          const clinic = store.clinicFromToken(cookie);
          if (!clinic) { json(response, 401, { error: 'Please sign in again to see your routes.' }); return; }
          json(response, 200, { field: store.fieldLog(clinic.id) }); return;
        }
        // THE NETWORK MAP. Every endpoint below resolves the clinic from the session cookie and
        // from nowhere else, so `?clinicId=` and a borrowed place ID are both simply ignored.
        if (url.pathname.startsWith('/api/network/')) {
          const clinic = store.clinicFromToken(cookie);
          if (!clinic) { json(response, 401, { error: 'Please sign in again to open your network map.' }); return; }
          if (url.pathname === '/api/network/map' && request.method === 'GET') {
            const refresh = await ensureDiscovery(store, clinic.id);
            json(response, 200, { ...store.networkMap(clinic.id, clinic.name), refresh });
            return;
          }
          if (url.pathname === '/api/network/refresh' && request.method === 'POST') {
            // Deliberately not a forced search: the cooldown in ensureDiscovery still applies, so
            // clicking this cannot spend Places calls repeatedly. A forced pass is a terminal job.
            const refresh = await ensureDiscovery(store, clinic.id);
            json(response, 200, { ...store.networkMap(clinic.id, clinic.name), refresh });
            return;
          }
          // The clinic's spot from its own device: allowed once, while no location is saved. After that only the
          // team changes it (scripts/set-clinic-location.ts), so a phone opened at home can't move a clinic's map.
          if (url.pathname === '/api/network/location' && request.method === 'POST') {
            let input;
            try { input = deviceLocationInput.safeParse(await body(request)); } catch { json(response, 400, { error: 'That location could not be read.' }); return; }
            if (!input.success) { json(response, 400, { error: 'That location could not be read.' }); return; }
            if (store.clinicLocation(clinic.id)) { json(response, 409, { error: 'Your clinic\u2019s location is already set. Call the team to change it.' }); return; }
            if ((input.data.accuracy ?? 0) > 2000) { json(response, 400, { error: 'Your device couldn\u2019t pin your location closely enough. Try again with location set to precise, or call the team.' }); return; }
            store.setClinicLocation({ clinicId: clinic.id, label: 'Set from your device', lat: input.data.lat, lng: input.data.lng, radiusMiles: DEFAULT_RADIUS_MILES, placeId: null, competitorCategories: [] });
            const refresh = await ensureDiscovery(store, clinic.id);
            json(response, 200, { ...store.networkMap(clinic.id, clinic.name), refresh });
            return;
          }
          // The bakery network: where the clinic's treats come from. One bakery chosen at a time.
          if (url.pathname === '/api/network/bakeries' && request.method === 'GET') {
            await ensureBakeries(store, clinic.id);
            json(response, 200, bakeryPayload(store, clinic.id, clinic.name));
            return;
          }
          // Request items from the chosen bakery: saved, then emailed to the team. The bakery becomes the clinic's bakery.
          if (url.pathname === '/api/network/bakery-request' && request.method === 'POST') {
            let input;
            try { input = itemsRequestInput.safeParse(await body(request)); } catch { json(response, 400, { error: 'That request could not be read.' }); return; }
            if (!input.success) { json(response, 400, { error: input.error.issues[0]?.message ?? 'Please check the form.' }); return; }
            const bakery = bakeryPayload(store, clinic.id, clinic.name).bakeries.find(b => b.placeId === input.data.placeId);
            if (!bakery || !store.chooseBakery(clinic.id, bakery.placeId)) { json(response, 400, { error: 'That bakery is no longer on your list.' }); return; }
            const r = input.data;
            const text = [`${clinic.name} requested items.`, '', `Bakery: ${bakery.name} (${bakery.label})`, bakery.address ? `Address: ${bakery.address}` : '', '',
              `Items: ${r.items}`, `People: ${r.people}`, `Needed by: ${r.neededBy}`, '', `Contact: ${r.contactName}${r.contactPhone ? `, ${r.contactPhone}` : ''}`, r.notes ? `Notes: ${r.notes}` : '']
              .filter((line, i, all) => line !== '' || all[i - 1] !== '').join('\n');
            const emailed = await sendTeamEmail(`Items request: ${clinic.name} · ${bakery.name}`, text);
            store.saveItemsRequest(clinic.id, bakery.placeId, bakery.name ?? 'Bakery', r, emailed);
            json(response, 200, { ...bakeryPayload(store, clinic.id, clinic.name), sent: true });
            return;
          }
          if (url.pathname === '/api/network/bakery' && request.method === 'POST') {
            let input;
            try { input = bakeryChoiceInput.safeParse(await body(request)); } catch { json(response, 400, { error: 'That choice could not be read.' }); return; }
            if (!input.success || !store.chooseBakery(clinic.id, input.data.placeId)) { json(response, 400, { error: 'That bakery is no longer on your list.' }); return; }
            json(response, 200, bakeryPayload(store, clinic.id, clinic.name));
            return;
          }
          if (url.pathname === '/api/network/selection' && request.method === 'POST') {
            let input;
            try { input = selectionInput.safeParse(await body(request)); } catch { json(response, 400, { error: 'That selection could not be read.' }); return; }
            if (!input.success) { json(response, 400, { error: 'That selection could not be read.' }); return; }
            json(response, 200, store.saveSelection(clinic.id, input.data.placeIds));
            return;
          }
          if (url.pathname === '/api/network/route-request' && request.method === 'POST') {
            let input;
            try { input = routeRequestInput.safeParse(await body(request)); } catch { json(response, 400, { error: 'That request could not be read.' }); return; }
            if (!input.success) { json(response, 400, { error: input.error.issues[0]?.message ?? 'Please check the dates and contact name.' }); return; }
            const result = store.createRouteRequest(clinic.id, input.data);
            if (!result.ok) { json(response, 400, { error: result.message }); return; }
            json(response, 200, { request: result.request, requests: store.routeRequests(clinic.id), selection: store.selection(clinic.id) });
            return;
          }
          json(response, 404, { error: 'Not found.' }); return;
        }
        if (url.pathname === '/api/logout' && request.method === 'POST') { store.signOut(cookie); response.setHeader('Set-Cookie', `${cookieName}=; ${cookieFlags}; Max-Age=0`); json(response, 200, { ok: true }); return; }
        json(response, 404, { error: 'Not found.' }); return;
      }
      if (request.method !== 'GET' && request.method !== 'HEAD') { json(response, 405, { error: 'Method not allowed.' }); return; }
      if (url.pathname === '/robots.txt') { response.setHeader('Content-Type', 'text/plain'); response.end('User-agent: *\nDisallow: /\n'); return; }
      if (vite) {
        if (url.pathname === '/' || url.pathname === '/index.html') {
          const html = await vite.transformIndexHtml(url.pathname, readFileSync(resolve(root, 'index.html'), 'utf8'));
          response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end(html); return;
        }
        vite.middlewares(request, response, () => { json(response, 404, { error: 'Not found.' }); }); return;
      }
      const publicRoot = resolve(root, 'dist/client');
      const path = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
      const file = resolve(publicRoot, path);
      if (!file.startsWith(publicRoot + sep) || !existsSync(file) || !statSync(file).isFile()) { response.writeHead(404, { 'Content-Type': 'text/plain' }); response.end('Page not found. Return to the portal home page.'); return; }
      response.setHeader('Content-Type', mime[extname(file)] ?? 'application/octet-stream');
      if (path.startsWith('assets/')) response.setHeader('Cache-Control', 'public, max-age=3600');
      if (request.method === 'HEAD') { response.end(); return; }
      const stream = createReadStream(file); stream.on('error', () => { if (!response.headersSent) response.writeHead(500); response.end(); }); stream.pipe(response);
    } catch { if (!response.headersSent) json(response, 500, { error: 'The portal could not complete this request. Please try again.' }); else response.end(); }
  });
}
