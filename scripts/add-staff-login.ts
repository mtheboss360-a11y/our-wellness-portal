// A STAFF LOGIN FOR AN EXISTING PRACTICE.
//
// The clinic account is the practice. This adds a person at it: their own username and
// password, their own name on screen, and optionally a link to the driver in that clinic's
// field log, which is how the portal knows which rounds are theirs.
//
// It does not create a clinic and it does not change one. The practice must already exist, and
// the staff id, where given, must already appear in that practice's own log — otherwise the
// account would be tied to somebody who does not work there.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { openStore } from '../server/store';

if (existsSync('.env')) process.loadEnvFile('.env');

const { values } = parseArgs({ options: {
  clinic: { type: 'string' }, username: { type: 'string' }, name: { type: 'string' }, staff: { type: 'string' },
} });

const clinicId = values.clinic ?? '';
const username = (values.username ?? '').trim().toLowerCase();
const displayName = (values.name ?? '').trim();
const staffName = (values.staff ?? '').trim();
const password = process.env.INITIAL_PASSWORD ?? '';

if (!/^[a-z0-9-]{3,80}$/.test(clinicId)) throw new Error('Provide --clinic clinic-slug.');
if (!username) throw new Error('Provide --username.');
if (!displayName) throw new Error('Provide --name "Alexis": the name the portal greets them by.');
if (!password) throw new Error('Set INITIAL_PASSWORD. The password is yours to choose.');

const store = openStore(resolve(process.env.DATABASE_PATH ?? 'var/portal.sqlite'), false);
try {
  const clinic = store.db.prepare('SELECT name FROM clinics WHERE id=?').get(clinicId) as { name: string } | undefined;
  if (!clinic) throw new Error(`No clinic "${clinicId}". This adds a person to a practice that already exists.`);
  if (store.db.prepare('SELECT id FROM users WHERE email=?').get(username)) throw new Error(`The username "${username}" is taken.`);

  // Tie them to the driver in this clinic's own log, by name, so "her rounds" means something.
  let staffId: string | undefined;
  if (staffName) {
    const log = store.fieldLog(clinicId);
    const match = log?.drivers.find(d => d.name.toLowerCase() === staffName.toLowerCase());
    if (!match) throw new Error(`No one called "${staffName}" in ${clinicId}'s field log. Import the log first, or leave --staff off.`);
    staffId = match.id;
  }

  store.createClient(clinicId, clinic.name, username, password, 'a', false, { displayName, staffId });
  console.log(`Added ${displayName} (${username}) to ${clinic.name}${staffId ? `, tied to their rounds in the log` : ''}.`);
  console.log('The practice keeps the plan and the data it already had; this is another way in, not another clinic.');
} finally { store.close(); }
