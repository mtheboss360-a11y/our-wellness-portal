import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createReadStream, existsSync, statSync, readFileSync } from 'node:fs';
import { resolve, extname, sep } from 'node:path';
import { z } from 'zod';
import type { ViteDevServer } from 'vite';
import type { PortalStore } from './store';
const loginInput = z.object({ username: z.string().trim().toLowerCase().min(1).max(254), password: z.string().min(1).max(256) });
type Options = { store: PortalStore; origin: string; secure: boolean; root: string; vite?: ViteDevServer; trustProxy?: boolean };
const mime: Record<string, string> = { '.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.ico':'image/x-icon','.svg':'image/svg+xml','.woff2':'font/woff2','.webmanifest':'application/manifest+json' };
function json(response: ServerResponse, status: number, value: unknown) { response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); response.end(JSON.stringify(value)); }
async function body(request: IncomingMessage) {
  if (!request.headers['content-type']?.startsWith('application/json')) throw new Error('content-type');
  let size = 0; const chunks: Buffer[] = [];
  for await (const chunk of request) { size += chunk.length; if (size > 4096) throw new Error('too-large'); chunks.push(Buffer.from(chunk)); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
export function createPortalServer(options: Options) {
  const { store, origin, secure, root, vite } = options;
  const cookieName = secure ? '__Host-owo-session' : 'owo-local-session';
  const cookieFlags = `Path=/; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}`;
  return createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'same-origin');
    response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    response.setHeader('X-Robots-Tag', 'noindex, nofollow');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Security-Policy', `default-src 'self'; script-src 'self'${vite ? " 'unsafe-inline'" : ''}; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'${vite ? ' ws://localhost:* ws://127.0.0.1:*' : ''}; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'`);
    if (secure) response.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    try {
      const url = new URL(request.url ?? '/', origin);
      const cookie = request.headers.cookie?.split(';').map(part => part.trim()).find(part => part.startsWith(cookieName + '='))?.slice(cookieName.length + 1);
      if (url.pathname.startsWith('/api/')) {
        if (request.method === 'POST' && request.headers.origin !== origin) { json(response, 403, { error: 'Please refresh and try again.' }); return; }
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
