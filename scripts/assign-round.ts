// ASSIGN A ROUND to a route runner, and set what the office says to take with it.
//
//   npm run assign-round -- --clinic hyline-dental --date 2026-10-27 --username alexis \
//     --flyers 100 --treats 50 --cards 25
//   npm run assign-round -- --round r_1234 --username alexis
//   npm run assign-round -- --clinic hyline-dental --date 2026-10-27 --unassign
//   npm run assign-round -- --clinic hyline-dental --date 2026-10-27 --lock "Karve Pilates"
//
// The assignment is the permission: a runner sees and changes the rounds assigned to them and
// nothing else. Quantities set here are the ALLOCATION. A runner can confirm what they actually
// packed, which may be less, but they cannot raise this number from the planner.
//
// A locked stop keeps its exact position: the runner may reorder everything around it.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { openStore } from '../server/store';

if (existsSync('.env')) process.loadEnvFile('.env');

const { values } = parseArgs({ options: {
  clinic: { type: 'string' }, date: { type: 'string' }, round: { type: 'string' },
  staff: { type: 'string' }, username: { type: 'string' }, unassign: { type: 'boolean' },
  flyers: { type: 'string' }, treats: { type: 'string' }, cards: { type: 'string' },
  lock: { type: 'string' }, unlock: { type: 'string' },
} });

const count = (value: string | undefined, label: string) => {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 10000) throw new Error(`--${label} has to be a whole number from 0 to 10000.`);
  return n;
};

const store = openStore(resolve(process.env.DATABASE_PATH ?? 'var/portal.sqlite'), false);
try {
  // The round, either by id or by the clinic and day it was booked for.
  let clinicId = values.clinic ?? '';
  let roundId = values.round ?? '';
  if (roundId) {
    const row = store.db.prepare('SELECT clinic_id FROM rounds WHERE id=?').get(roundId) as { clinic_id: string } | undefined;
    if (!row) throw new Error(`No round "${roundId}".`);
    clinicId = row.clinic_id;
  } else {
    if (!/^[a-z0-9-]{3,80}$/.test(clinicId)) throw new Error('Provide --clinic clinic-slug, or --round <id>.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(values.date ?? '')) throw new Error('Provide --date YYYY-MM-DD, or --round <id>.');
    const matches = store.outreach.rounds(clinicId).filter(round => round.date === values.date
      && (!values.staff || round.staff.trim().toLowerCase() === values.staff.trim().toLowerCase()));
    if (!matches.length) throw new Error(`No round booked for ${clinicId} on ${values.date}${values.staff ? ` under "${values.staff}"` : ''}.`);
    if (matches.length > 1) {
      console.log('More than one round that day. Name one with --round:');
      for (const round of matches) console.log(`  ${round.id}  ${round.staff || 'unassigned'}  ${round.stops.length} stops`);
      throw new Error('Nothing has been changed.');
    }
    roundId = matches[0].id;
  }

  if (values.unassign) {
    store.runner.assignRound(clinicId, roundId, null);
    console.log(`Round ${roundId} is no longer assigned to a login.`);
  } else if (values.username) {
    const username = values.username.trim().toLowerCase();
    const user = store.db.prepare('SELECT id,display_name,role,clinic_id FROM users WHERE email=?')
      .get(username) as { id: string; display_name: string; role: string; clinic_id: string } | undefined;
    if (!user) throw new Error(`No login called "${username}". Create one with add-runner-login.`);
    if (user.clinic_id !== clinicId) throw new Error(`"${username}" belongs to another practice.`);
    if (user.role !== 'route_runner') {
      console.log(`Note: "${username}" is not a route runner login, so this round will not appear on a planner.`);
    }
    store.runner.assignRound(clinicId, roundId, user.id);
    console.log(`Round ${roundId} is ${user.display_name || username}'s.`);
  }

  const planned = {
    flyers: count(values.flyers, 'flyers'), treats: count(values.treats, 'treats'), cards: count(values.cards, 'cards'),
  };
  if (Object.values(planned).some(value => value !== undefined)) {
    const current = store.runner.supplies(clinicId, roundId).planned;
    const next = {
      flyers: planned.flyers ?? current.flyers,
      treats: planned.treats ?? current.treats,
      cards: planned.cards ?? current.cards,
    };
    store.runner.setPlannedSupplies(clinicId, roundId, next, store.isDemoClinic(clinicId));
    console.log(`To take: ${next.flyers} flyers, ${next.treats} treats, ${next.cards} referral cards.`);
    console.log('That is the allocation. What the runner confirms packing is their own count, and may be less.');
  }

  for (const [name, locked] of [[values.lock, true], [values.unlock, false]] as const) {
    if (!name) continue;
    const round = store.runner.round(clinicId, roundId);
    const stop = round?.items.find(item => item.kind === 'business'
      && item.business.name.toLowerCase() === name.trim().toLowerCase());
    if (!stop) throw new Error(`"${name}" is not a stop on that round.`);
    store.runner.lockStop(clinicId, roundId, stop.id, locked);
    console.log(`${name} is ${locked ? 'fixed in place' : 'free to move'}.`);
  }

  const round = store.runner.round(clinicId, roundId)!;
  console.log(`\n${round.date} · ${round.staff || 'unassigned'} · ${round.items.length} stops`);
  round.items.forEach((item, index) => console.log(`  ${index + 1}. ${item.kind === 'business'
    ? `${item.business.name}${item.locked ? '  (fixed)' : ''}`
    : `${item.pickup.title}  (pickup)`}`));
} finally { store.close(); }
