import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openStore } from './store';
import { createPortalServer } from './http';
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
if (existsSync(resolve(root, '.env'))) process.loadEnvFile(resolve(root, '.env'));
const port = Number(process.env.PORT ?? 3000);
const origin = process.env.APP_ORIGIN ?? `http://localhost:${port}`;
const originUrl = new URL(origin);
if (originUrl.origin !== origin) throw new Error('APP_ORIGIN must contain only scheme, host and optional port.');
const local = ['localhost', '127.0.0.1', '[::1]'].includes(originUrl.hostname);
// A managed host routes traffic in from outside the container, so bind every
// interface there; keep local runs on loopback so a dev server stays off the LAN.
const host = process.env.HOST ?? (local ? '127.0.0.1' : '0.0.0.0');
if (!local && originUrl.protocol !== 'https:') throw new Error('Public hosting requires HTTPS in APP_ORIGIN.');
const sample = process.env.ENABLE_SAMPLE_DATA === 'true' || (process.env.ENABLE_SAMPLE_DATA !== 'false' && process.env.NODE_ENV !== 'production');
const store = openStore(resolve(root, process.env.DATABASE_PATH ?? 'var/portal.sqlite'), sample);
const dev = process.argv.includes('--dev');
const vite = dev ? await (await import('vite')).createServer({ root, server: { middlewareMode: true }, appType: 'custom' }) : undefined;
if (!dev && !existsSync(resolve(root, 'dist/client/index.html'))) throw new Error('Run npm run build before npm start.');
const server = createPortalServer({ store, origin, secure: originUrl.protocol === 'https:', root, vite, trustProxy: process.env.TRUST_PROXY === 'true' });
server.listen(port, host, () => console.log(`Our Wellness Network portal: ${origin}\nSample clinic: ${sample ? 'enabled (fictional records only)' : 'disabled'}`));
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { server.close(() => { store.close(); void vite?.close().finally(() => process.exit(0)); if (!vite) process.exit(0); }); });
