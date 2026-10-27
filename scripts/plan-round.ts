// BOOK A ROUND for a practice's staff, from the businesses it has been released.
//
//   npm run plan-round -- --clinic hyline-dental --date 2026-10-28 --start 09:00 --staff Alexis
//   npm run plan-round -- --clinic hyline-dental --date 2026-10-28 --only "Karve Pilates,Yoga Cave"
//
// With no --only it takes every business that has not been visited yet, nearest first from the
// practice. The order is a starting point, not a solved route, and it can be changed afterwards.
//
// The round's start is held to the practice's opening hours by the agenda, so a time earlier
// than opening is moved and the portal says why rather than sending somebody to a locked door.
import { parseArgs } from 'node:util';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { openStore } from '../server/store.ts';
import { suggestOrder } from '../src/lib/round-math.ts';
import { clockOf, OPENS, WEEKDAY, weekdayOf } from '../src/lib/agenda-math.ts';

if (existsSync('.env')) process.loadEnvFile('.env');

const { values } = parseArgs({ options: {
  clinic: { type: 'string' }, date: { type: 'string' }, start: { type: 'string' },
  staff: { type: 'string' }, only: { type: 'string' }, note: { type: 'string' },
  demo: { type: 'boolean' }, 'include-visited': { type: 'boolean' }, another: { type: 'boolean' },
} });

const clinicId = values.clinic ?? '';
const date = values.date ?? '';
const start = values.start ?? '09:00';
const staff = (values.staff ?? '').trim();

if (!/^[a-z0-9-]{3,80}$/.test(clinicId)) throw new Error('Provide --clinic clinic-slug.');
if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Provide --date YYYY-MM-DD.');
if (!/^\d{2}:\d{2}$/.test(start)) throw new Error('Provide --start HH:MM, or leave it at 09:00.');
if (!staff) throw new Error('Provide --staff "Alexis": whose round this is.');

const store = openStore(resolve(process.env.DATABASE_PATH ?? 'var/portal.sqlite'), false);
try {
  const clinic = store.db.prepare('SELECT name FROM clinics WHERE id=?').get(clinicId) as { name: string } | undefined;
  if (!clinic) throw new Error(`No clinic "${clinicId}".`);

  const weekday = weekdayOf(date);
  if (OPENS[weekday] === null) {
    throw new Error(`${date} is a ${WEEKDAY[weekday]}, when the practice is closed. Nothing has been booked.`);
  }

  const all = store.outreach.businesses(clinicId);
  if (!all.length) throw new Error('This practice has no businesses. Release a batch first.');

  const wanted = values.only?.split(',').map(s => s.trim().toLowerCase()).filter(Boolean) ?? [];
  let chosen = wanted.length
    ? all.filter(b => wanted.includes(b.name.toLowerCase()))
    : values['include-visited'] ? all : all.filter(b => b.stage === 'new' || b.stage === 'follow-up');

  if (wanted.length) {
    const missing = wanted.filter(w => !all.some(b => b.name.toLowerCase() === w));
    if (missing.length) throw new Error(`Not on this practice's list: ${missing.join(', ')}. Nothing has been booked.`);
  }
  if (!chosen.length) throw new Error('Nothing to visit — every business has been seen. Use --include-visited to book them again.');

  const where = store.clinicLocation(clinicId);
  if (where) chosen = suggestOrder({ lat: where.lat, lng: where.lng }, chosen);

  // Re-planning the same person's round on the same day replaces it. Booking a second one for
  // the same date left both in the portal's day picker with no way to tell them apart.
  //
  // All of them, not just the first: an earlier version of this script booked duplicates, and
  // replacing one of those left the others behind for somebody to find later.
  const existing = values.another ? [] : store.outreach.rounds(clinicId).filter(r => r.date === date && r.staff === staff);
  const [already, ...duplicates] = existing;
  if (already) {
    console.log(`Replacing the round already booked for ${staff} on ${date}.`);
    for (const extra of duplicates) store.outreach.removeRound(clinicId, extra.id);
    if (duplicates.length) console.log(`  Also removed ${duplicates.length} duplicate ${duplicates.length === 1 ? 'round' : 'rounds'} for that day.`);
  }

  const round = store.outreach.planRound(clinicId, {
    id: already?.id,
    date, start, staff, businessIds: chosen.map(b => b.id), note: values.note ?? '', demo: values.demo === true,
  });

  console.log(`${clinic.name} — round booked for ${date} (${WEEKDAY[weekday]}), ${staff}, from ${clockOf(Number(start.slice(0, 2)) * 60 + Number(start.slice(3)))}`);
  round.stops.forEach((b, i) => console.log(`  ${i + 1}. ${b.name}${b.lat === null ? '  (no coordinate — no drive estimate)' : ''}`));
  console.log(`\n${round.stops.length} stops. It shows in the portal under Today's round.`);
  if (values.demo) console.log('Tagged illustrative, so activate-live will remove it.');
} finally { store.close(); }
