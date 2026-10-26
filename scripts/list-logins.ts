// WHO CAN SIGN IN. An audit, printed; it reads no hash and no salt and can disclose neither.
//
//   npm run list-logins
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { openStore } from '../server/store.ts';

if (existsSync('.env')) process.loadEnvFile('.env');

const store = openStore(resolve(process.env.DATABASE_PATH ?? 'var/portal.sqlite'), false);
try {
  const rows = store.logins();
  if (!rows.length) { console.log('No logins exist.'); process.exit(0); }
  console.log(`${rows.length} logins\n`);
  console.log('USERNAME'.padEnd(26) + 'CLINIC'.padEnd(22) + 'PERSON'.padEnd(16) + 'ACCOUNT'.padEnd(9) + 'SESSIONS');
  for (const r of rows) {
    console.log(r.username.padEnd(26) + `${r.clinicName} (${r.clinic})`.slice(0, 21).padEnd(22) +
      (r.name || '—').slice(0, 15).padEnd(16) + (r.demo === 1 ? 'demo' : 'LIVE').padEnd(9) + String(r.activeSessions));
  }
  console.log(`\nChange one with:  NEW_PASSWORD='…' npm run set-password -- --username <username>`);
} finally { store.close(); }
