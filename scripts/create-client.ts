import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { openStore } from '../server/store';
if (existsSync('.env')) process.loadEnvFile('.env');
const { values } = parseArgs({ options: { clinic: { type: 'string' }, name: { type: 'string' }, username: { type: 'string' } } });
const input = z.object({ clinic: z.string().regex(/^[a-z0-9-]{3,80}$/), name: z.string().min(1).max(160), username: z.string().trim().min(1).max(254), password: z.string().min(1).max(256) }).safeParse({ ...values, password: process.env.INITIAL_PASSWORD });
if (!input.success) { console.error('Provide --clinic slug --name "Clinic name" --username name and an INITIAL_PASSWORD environment variable.'); process.exit(1); }
const store = openStore(resolve(process.env.DATABASE_PATH ?? 'var/portal.sqlite'), false);
try { store.createClient(input.data.clinic,input.data.name,input.data.username,input.data.password); console.log('Clinic account created. Share the initial password through a secure channel.'); }
finally { store.close(); }
