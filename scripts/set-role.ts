// WHAT A LOGIN IS ALLOWED TO DO.
//
//   npm run set-role -- --username <name> --role owner|staff|admin
//   npm run set-role -- --username <name> --clear
//
// The role decides what the API answers, not what the portal draws. A practice owner asking
// for a visit script gets a refusal from the server, not a hidden button.
//
// An account with no role keeps the access it had before roles existed, so deploying this
// changes nothing until a role is set. That is a migration state and is meant to be ended:
// `npm run list-logins` marks every unassigned account.
import { parseArgs } from 'node:util';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { openStore } from '../server/store.ts';

if (existsSync('.env')) process.loadEnvFile('.env');

const { values } = parseArgs({ options: {
  username: { type: 'string' }, role: { type: 'string' }, clear: { type: 'boolean' },
} });

const username = (values.username ?? '').trim().toLowerCase();
const role = values.role?.trim().toLowerCase();

if (!username) throw new Error('Provide --username.');
if (!values.clear && !role) throw new Error('Provide --role owner|staff|admin, or --clear.');
if (role && !['owner', 'staff', 'admin'].includes(role)) {
  throw new Error(`"${role}" is not a role. Use owner, staff or admin.`);
}

const store = openStore(resolve(process.env.DATABASE_PATH ?? 'var/portal.sqlite'), false);
try {
  const before = store.logins().find(l => l.username === username);
  if (!before) throw new Error(`No login called "${username}".`);

  store.setRole(username, values.clear ? null : role as 'owner' | 'staff' | 'admin');

  console.log(`\n${username} at ${before.clinicName} (${before.clinic})`);
  console.log(`  was: ${before.role ?? 'no role — legacy access'}`);
  console.log(`  now: ${values.clear ? 'no role — legacy access' : role}`);

  if (role === 'owner') {
    console.log(`\n  An owner sees their practice's own records and its curated matches.`);
    console.log(`  Visit scripts are left out of what the API returns to them, and they`);
    console.log(`  cannot record or change a visit.`);
  }
  if (role === 'staff') {
    console.log(`\n  Staff see their assigned work and the scripts for it.`);
  }

  const left = store.logins().filter(l => l.clinic === before.clinic && !l.role);
  if (left.length) {
    console.log(`\n  Still unassigned on this practice: ${left.map(l => l.username).join(', ')}.`);
    console.log(`  Those keep full access until a role is set.`);
  }
} finally { store.close(); }
