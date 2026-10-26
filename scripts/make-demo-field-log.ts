// BUILD A DEMO ACCOUNT'S FIELD LOG FROM THE ADDRESS IT IS ALREADY SET UP WITH.
//
// The businesses, people and sign-ups come from samples/field-log.sample.json, which is the
// fictional set the portal has always used. Nothing new is invented here: this script takes
// that set, re-anchors it on the practice's own saved location so the map and distances make
// sense for them, and puts the whole round under one staff member, because a practice on the
// portal-only plan sends its own person rather than one of our drivers.
//
// It refuses to run against an account that is not marked demo. A real client's log must come
// from what their staff actually recorded.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { openStore } from '../server/store';
import { fieldLogFeed } from '../server/validation';

if (existsSync('.env')) process.loadEnvFile('.env');

const { values } = parseArgs({ options: { clinic: { type: 'string' }, staff: { type: 'string' }, file: { type: 'string' } } });
const clinicId = values.clinic ?? '';
const staffName = (values.staff ?? 'Alexis').trim();
const source = values.file ?? 'samples/field-log.sample.json';
if (!/^[a-z0-9-]{3,80}$/.test(clinicId)) throw new Error('Provide --clinic clinic-slug. Optional: --staff "Alexis", --file samples/field-log.sample.json');
if (!staffName) throw new Error('A staff name is required.');

const store = openStore(resolve(process.env.DATABASE_PATH ?? 'var/portal.sqlite'), false);
try {
  const clinic = store.db.prepare('SELECT name,demo FROM clinics WHERE id=?').get(clinicId) as { name: string; demo: number } | undefined;
  if (!clinic) throw new Error(`No clinic "${clinicId}". Create it first.`);
  if (clinic.demo !== 1) throw new Error(`"${clinicId}" is not a demo account. Illustrative figures must never be written to a real client; create it with --demo if that is what you meant.`);

  const place = store.db.prepare('SELECT label,lat,lng FROM clinic_locations WHERE clinic_id=?').get(clinicId) as { label: string; lat: number; lng: number } | undefined;
  if (!place) throw new Error(`"${clinicId}" has no saved address. Run set-clinic-location first; this script reuses that address rather than guessing one.`);

  const feed = fieldLogFeed.parse(JSON.parse(readFileSync(source, 'utf8')));
  const staffId = 'demo-staff';

  const rebuilt = {
    ...feed,
    // the practice's own address, exactly as it was saved
    clinic: { label: `${clinic.name} · ${place.label}`, lat: place.lat, lng: place.lng },
    drivers: [{
      ...feed.drivers[0],
      id: staffId,
      name: staffName,
      homeBase: place.label,
      bio: `${staffName} runs the rounds for ${clinic.name} and keeps the log.`,
    }],
    routes: feed.routes.map(route => ({ ...route, driverId: staffId })),
  };

  store.saveFieldLog(clinicId, fieldLogFeed.parse(rebuilt));
  const stops = rebuilt.routes.reduce((total, route) => total + route.stops.length, 0);
  console.log(`Demo field log saved for ${clinicId}: ${rebuilt.routes.length} rounds, ${stops} stops, ${rebuilt.signups.length} sign-ups, all under ${staffName}, anchored on ${place.label}.`);
} finally { store.close(); }
