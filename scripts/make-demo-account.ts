// STAND UP A DEMO ACCOUNT IN ONE COMMAND.
//
// Creating one by hand is three steps that have to happen in order — the account, its address,
// then the field log that reads that address — and getting the order wrong leaves a half-built
// account somebody then signs into. This does all three, or none.
//
// What it makes is explicitly a demo: the map is the fixed fictional set rather than a Google
// lookup, and the log is the fictional round under one staff member. It will not touch an
// account that already exists, so it can never overwrite a paying client.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { execFileSync } from 'node:child_process';
import { openStore } from '../server/store';

if (existsSync('.env')) process.loadEnvFile('.env');

const { values } = parseArgs({ options: {
  clinic: { type: 'string' }, name: { type: 'string' }, username: { type: 'string' },
  label: { type: 'string' }, lat: { type: 'string' }, lng: { type: 'string' },
  radius: { type: 'string' }, staff: { type: 'string' }, plan: { type: 'string' },
} });

const clinicId = values.clinic ?? 'demo-dental';
const name = values.name ?? 'Bright Ridge Dental';
const username = (values.username ?? 'demo').trim().toLowerCase();
const label = values.label ?? '1200 Ogden Ave, Naperville, IL 60563';
const lat = Number(values.lat ?? 41.7735);
const lng = Number(values.lng ?? -88.1520);
const radius = Number(values.radius ?? 5);
const staff = values.staff ?? 'Alexis';
const plan = values.plan === 'a' ? 'a' : 'b';
const password = process.env.INITIAL_PASSWORD ?? '';

if (!/^[a-z0-9-]{3,80}$/.test(clinicId)) throw new Error('--clinic must be a slug: lower case, digits and dashes.');
if (!username) throw new Error('--username is required.');
if (!password) throw new Error('Set INITIAL_PASSWORD. The password is yours to choose; nothing here invents one.');
if (password.length < 12) throw new Error('Use at least 12 characters. A short password on an internet-facing portal is guessed, not cracked.');
if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new Error('--lat and --lng must be numbers. A negative longitude needs the equals sign: --lng=-88.1520');
if (!Number.isFinite(radius) || radius <= 0) throw new Error('--radius must be a positive number of miles.');

const dbPath = resolve(process.env.DATABASE_PATH ?? 'var/portal.sqlite');
const store = openStore(dbPath, false);
try {
  if (store.db.prepare('SELECT id FROM clinics WHERE id=?').get(clinicId))
    throw new Error(`"${clinicId}" already exists. This script only creates; it will not change an account that is already there.`);

  store.createClient(clinicId, name, username, password, plan, true);
  store.setClinicLocation({ clinicId, label, lat, lng, radiusMiles: radius, placeId: null, competitorCategories: [] });
  console.log(`Created ${clinicId} — ${name}, plan ${plan}, demo, at ${label}.`);
} finally { store.close(); }

// The log is built by the script that owns that job, so there is one place where a demo log is
// made and one set of rules about when it may be written.
execFileSync(process.execPath, ['--import', 'tsx', resolve('scripts/make-demo-field-log.ts'), '--clinic', clinicId, '--staff', staff], { stdio: 'inherit' });

console.log(`\nSign in as ${username} with the password you set. Its figures are illustrative: the map is a fixed fictional set, not a Google lookup, and the rounds are the sample log under ${staff}.`);
