// CHANGE A PASSWORD.
//
//   NEW_PASSWORD='…' npm run set-password -- --username <username>
//
// There was no way to do this before, which meant a password handed out to get somebody
// started was the password for good. Changing one also signs that person out everywhere, so a
// cookie taken with the old password stops working.
//
// The new password is read from the environment, never from an argument: an argument is in the
// shell history and in the process list for anyone on the box to read.
import { parseArgs } from 'node:util';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { openStore } from '../server/store.ts';

if (existsSync('.env')) process.loadEnvFile('.env');

const { values } = parseArgs({ options: { username: { type: 'string' } } });
const username = (values.username ?? '').trim().toLowerCase();
const password = process.env.NEW_PASSWORD ?? '';

if (!username) throw new Error('Provide --username.');
if (!password) throw new Error("Set NEW_PASSWORD. Put it in the environment, not in the command: NEW_PASSWORD='…' npm run set-password -- --username name");

// Not a policy, a floor. The portal's protection is the scrypt hash and the rate limit, but a
// password somebody could reach on the fourth guess defeats both.
if (password.length < 12) throw new Error('Use at least 12 characters. A short password on an internet-facing portal is guessed, not cracked.');
if (password.toLowerCase().includes(username)) throw new Error('The password contains the username. Pick something unrelated.');

const store = openStore(resolve(process.env.DATABASE_PATH ?? 'var/portal.sqlite'), false);
try {
  store.setPassword(username, password);
  console.log(`Password changed for ${username}. Every session it had is signed out.`);
  console.log('Send the new one through something other than email or chat.');
} finally { store.close(); }
