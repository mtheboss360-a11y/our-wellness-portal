// HAND HISTORICAL ROUNDS TO THE LOGIN THEY BELONG TO.
//
//   npm run claim-rounds -- --clinic hyline-dental --username alexisfield            # shows them
//   npm run claim-rounds -- --clinic hyline-dental --username alexisfield --apply    # assigns them
//
// A round booked before assignments existed carries a NAME (`plan-round --staff "Alexis"`) and
// no account. The planner used to fall back to matching that name against the signed-in login's
// display name, which meant two people called Alexis would each have seen the other's day. A
// name is not an identity, so that fallback is gone and this is what replaces it: the matches
// are printed for somebody to look at, and --apply turns them into real assignments, each one
// written to the round's own history.
//
// It never assigns a round that already belongs to an account, and it never touches a round
// booked under a different name.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { openStore } from '../server/store';

if (existsSync('.env')) process.loadEnvFile('.env');

const { values } = parseArgs({ options: {
  clinic: { type: 'string' }, username: { type: 'string' }, apply: { type: 'boolean' },
} });

const clinicId = values.clinic ?? '';
const username = (values.username ?? '').trim().toLowerCase();

if (!/^[a-z0-9-]{3,80}$/.test(clinicId)) throw new Error('Provide --clinic clinic-slug.');
if (!username) throw new Error('Provide --username.');

const store = openStore(resolve(process.env.DATABASE_PATH ?? 'var/portal.sqlite'), false);
try {
  const user = store.db.prepare('SELECT id,display_name,role,clinic_id FROM users WHERE email=?')
    .get(username) as { id: string; display_name: string; role: string | null; clinic_id: string } | undefined;
  if (!user) throw new Error(`No login called "${username}".`);
  if (user.clinic_id !== clinicId) throw new Error(`"${username}" belongs to another practice.`);
  if (!user.display_name.trim()) {
    throw new Error(`"${username}" has no name on it, so there is nothing to match historical rounds against. Set one with name-login.`);
  }

  const claimable = store.runner.claimableRounds(clinicId, user.display_name);
  const already = store.runner.assignedRounds(clinicId, { id: user.id, displayName: user.display_name });

  console.log(`${user.display_name} (${username}) at ${clinicId}`);
  console.log(`  ${already.length} round${already.length === 1 ? '' : 's'} already assigned to this login.`);

  if (!claimable.length) {
    console.log('  No unassigned rounds are booked under that name. Nothing to do.');
  } else {
    console.log(`\n  ${claimable.length} unassigned round${claimable.length === 1 ? '' : 's'} booked under "${user.display_name}":`);
    for (const round of claimable) {
      console.log(`    ${round.date}  ${round.items.length} stops  ${round.id}`);
    }
    if (!values.apply) {
      console.log(`\n  Nothing has been changed. Run it again with --apply to assign these to ${username}.`);
      console.log('  Check the list first: a round booked under a name somebody else also goes by is not theirs.');
    } else {
      for (const round of claimable) store.runner.assignRound(clinicId, round.id, user.id);
      console.log(`\n  Assigned ${claimable.length} round${claimable.length === 1 ? '' : 's'} to ${username}. Each one is on the round's own history.`);
    }
  }

  const orphans = store.db.prepare(`SELECT on_date, staff, id FROM rounds
    WHERE clinic_id=? AND runner_id IS NULL ORDER BY on_date DESC`).all(clinicId) as Array<{
      on_date: string; staff: string; id: string }>;
  if (orphans.length) {
    console.log(`\n  ${orphans.length} round${orphans.length === 1 ? '' : 's'} at this practice still belong to no login:`);
    for (const round of orphans.slice(0, 15)) console.log(`    ${round.on_date}  ${round.staff || 'no name'}  ${round.id}`);
    if (orphans.length > 15) console.log(`    …and ${orphans.length - 15} more.`);
    console.log('  A round with no login on it shows on nobody’s planner.');
  }
} finally { store.close(); }
