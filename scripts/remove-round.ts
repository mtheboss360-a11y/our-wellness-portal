// REMOVE A BOOKED ROUND.
//
//   npm run remove-round -- --clinic hyline-dental --date 2026-10-28 [--dry-run]
//
// Deletes the round and its stops. The businesses stay, and so does every visit recorded —
// a conversation happened whether or not the round it belonged to still exists, and deleting
// the plan must never delete the record of the work.
//
// With more than one round on a date it lists them and asks for --id, rather than guessing
// which one was meant.
import { parseArgs } from 'node:util';
import { createInterface } from 'node:readline/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { openStore } from '../server/store.ts';

if (existsSync('.env')) process.loadEnvFile('.env');

const { values } = parseArgs({ options: {
  clinic: { type: 'string' }, date: { type: 'string' }, id: { type: 'string' },
  'dry-run': { type: 'boolean' }, yes: { type: 'boolean' },
} });

const clinicId = values.clinic ?? '';
if (!/^[a-z0-9-]{3,80}$/.test(clinicId)) throw new Error('Provide --clinic clinic-slug.');
if (!values.date && !values.id) throw new Error('Provide --date YYYY-MM-DD, or --id for one particular round.');

const store = openStore(resolve(process.env.DATABASE_PATH ?? 'var/portal.sqlite'), false);
try {
  const clinic = store.db.prepare('SELECT name FROM clinics WHERE id=?').get(clinicId) as { name: string } | undefined;
  if (!clinic) throw new Error(`No clinic "${clinicId}".`);

  const all = store.outreach.rounds(clinicId);
  const matching = values.id
    ? all.filter(round => round.id === values.id)
    : all.filter(round => round.date === values.date);

  if (!matching.length) {
    console.log(`\nNothing booked for ${values.id ?? values.date} at ${clinic.name}.`);
    console.log(all.length
      ? `Rounds on this practice:\n${all.map(r => `  ${r.date}  ${r.staff || 'unassigned'}  ${r.stops.length} stops  ${r.id}`).join('\n')}`
      : '  This practice has no rounds at all.');
    process.exit(1);
  }

  if (matching.length > 1) {
    console.error(`\n${matching.length} rounds are booked on ${values.date}:`);
    for (const round of matching) {
      console.error(`  ${round.id}  ${round.staff || 'unassigned'}  ${round.stops.length} stops`);
    }
    console.error('\nRe-run with --id <id> for the one you mean. Nothing has been changed.');
    process.exit(2);
  }

  const [round] = matching;
  // Visits at these businesses on or after the round's date: the work this round stands for.
  const kept = store.outreach.visits(clinicId)
    .filter(visit => visit.visitedOn >= round.date && round.stops.some(stop => stop.id === visit.businessId));

  console.log(`\n${clinic.name} — round on ${round.date}, ${round.staff || 'unassigned'}, ${round.stops.length} stops`);
  round.stops.forEach((stop, i) => console.log(`  ${i + 1}. ${stop.name}`));
  console.log(`\nWould delete: this round and its stop list.`);
  console.log(`Would keep:   every business, and ${kept.length} ${kept.length === 1 ? 'visit' : 'visits'} recorded against them.`);

  if (values['dry-run']) { console.log('\nDRY RUN — nothing was changed.\n'); process.exit(0); }

  if (!values.yes) {
    const ask = createInterface({ input: process.stdin, output: process.stdout });
    const typed = (await ask.question(`\nType the date to remove this round: `)).trim();
    ask.close();
    if (typed !== round.date) { console.log('Not removed. Nothing has been changed.'); process.exit(1); }
  }

  store.outreach.removeRound(clinicId, round.id);
  const left = store.outreach.rounds(clinicId);
  console.log(`\nRemoved. ${left.length} ${left.length === 1 ? 'round' : 'rounds'} left on ${clinic.name}.`);
  for (const r of left) console.log(`  ${r.date}  ${r.staff || 'unassigned'}  ${r.stops.length} stops`);
} finally { store.close(); }
