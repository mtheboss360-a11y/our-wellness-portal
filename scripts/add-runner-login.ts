// A ROUTE RUNNER LOGIN for an existing practice.
//
//   INITIAL_PASSWORD='…' npm run add-runner-login -- --clinic hyline-dental --username alexis --name "Alexis"
//
// A route runner signs in and lands on their weekly planner: the routes assigned to them, the
// supplies to bring, the pickups they add, and the guided visit at each business. They do not
// reach the practice's own screens, the referral network's controls or anybody else's routes,
// and that is enforced on the server (see RUNNER_ENDPOINTS in server/http.ts).
//
// It creates a person on a practice that already exists. It never creates a clinic, never
// changes the plan a practice is on, and never raises an existing login's access.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { openStore } from '../server/store';

if (existsSync('.env')) process.loadEnvFile('.env');

const { values } = parseArgs({ options: {
  clinic: { type: 'string' }, username: { type: 'string' }, name: { type: 'string' },
} });

const clinicId = values.clinic ?? '';
const username = (values.username ?? '').trim().toLowerCase();
const displayName = (values.name ?? '').trim();
const password = process.env.INITIAL_PASSWORD ?? '';

if (!/^[a-z0-9-]{3,80}$/.test(clinicId)) throw new Error('Provide --clinic clinic-slug.');
if (!username) throw new Error('Provide --username.');
if (!displayName) throw new Error('Provide --name "Alexis": the name on their routes and their visits.');
if (!password) throw new Error('Set INITIAL_PASSWORD. The password is yours to choose.');
if (password.length < 12) throw new Error('Use at least 12 characters. A short password on an internet-facing portal is guessed, not cracked.');

const store = openStore(resolve(process.env.DATABASE_PATH ?? 'var/portal.sqlite'), false);
try {
  const clinic = store.db.prepare('SELECT name FROM clinics WHERE id=?').get(clinicId) as { name: string } | undefined;
  if (!clinic) throw new Error(`No clinic "${clinicId}". This adds a person to a practice that already exists.`);
  if (store.db.prepare('SELECT id FROM users WHERE email=?').get(username)) throw new Error(`The username "${username}" is taken.`);

  store.createClient(clinicId, clinic.name, username, password, 'a', false,
    { displayName, role: 'route_runner' });

  const rounds = store.outreach.rounds(clinicId)
    .filter(round => round.staff.trim().toLowerCase() === displayName.toLowerCase());
  console.log(`Added ${displayName} (${username}) to ${clinic.name} as a route runner.`);
  console.log(rounds.length
    ? `${rounds.length} round${rounds.length === 1 ? '' : 's'} already booked under "${displayName}" will show on their planner. Use assign-round to tie a round to this login rather than to the name.`
    : 'No rounds are booked under that name yet. Book one with plan-round, then assign it with assign-round.');
} finally { store.close(); }
