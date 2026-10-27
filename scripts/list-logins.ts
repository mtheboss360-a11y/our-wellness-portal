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
  // The clinic ID is the whole point of this listing — which practice's records does this
  // login reach — so it is never truncated. Columns are sized to the longest value present.
  const wide = (pick: (r: typeof rows[number]) => string, head: string) =>
    Math.max(head.length, ...rows.map(r => pick(r).length)) + 2;
  const user = wide(r => r.username, 'USERNAME');
  const clinic = wide(r => r.clinic, 'CLINIC ID');
  const person = wide(r => r.name || '—', 'PERSON');
  const roleCol = wide(r => r.role ?? 'unassigned', 'ROLE');

  console.log('USERNAME'.padEnd(user) + 'CLINIC ID'.padEnd(clinic) + 'PERSON'.padEnd(person) +
    'ROLE'.padEnd(roleCol) + 'ACCOUNT'.padEnd(9) + 'SESSIONS');
  for (const r of rows) {
    console.log(r.username.padEnd(user) + r.clinic.padEnd(clinic) +
      (r.name || '—').padEnd(person) + (r.role ?? 'unassigned').padEnd(roleCol) +
      (r.demo === 1 ? 'demo' : 'LIVE').padEnd(9) + String(r.activeSessions));
  }

  // An unassigned account keeps pre-role access. Worth saying out loud, every time.
  const unassigned = rows.filter(r => !r.role);
  if (unassigned.length) {
    console.log(`\n${unassigned.length} ${unassigned.length === 1 ? 'login has' : 'logins have'} no role and keep full access:`);
    console.log(`  ${unassigned.map(r => r.username).join(', ')}`);
    console.log(`  Set one with:  npm run set-role -- --username <name> --role owner|staff`);
  }

  // Several logins on one practice is how an account nobody remembers keeps working.
  const perClinic = new Map<string, string[]>();
  for (const r of rows) perClinic.set(r.clinic, [...(perClinic.get(r.clinic) ?? []), r.username]);
  const crowded = [...perClinic.entries()].filter(([, names]) => names.length > 2);
  if (crowded.length) {
    console.log('\nMore than two logins reach the same practice:');
    for (const [id, names] of crowded) console.log(`  ${id}: ${names.join(', ')}`);
    console.log('  Each one is a way in. Remove the ones nobody uses.');
  }
  console.log(`\nChange a password:  NEW_PASSWORD='…' npm run set-password -- --username <username>`);
  console.log(`Remove a login:     npm run remove-login -- --username <username>`);
} finally { store.close(); }
