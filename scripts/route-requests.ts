// The operations side of route visit requests, until there is a web screen for it.
//
//   npm run route-requests                                  # everything, newest first
//   npm run route-requests -- --status requested            # just the ones waiting
//   npm run route-requests -- --accept <id> --note "Wed 3pm, Maria driving"
//   npm run route-requests -- --decline <id> --note "Two of these are already covered"
//   npm run route-requests -- --complete <id>
//
// A request stays "requested" in the client's portal until it is accepted here. Nothing in
// the portal tells a client a visit is scheduled before that.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { openStore } from '../server/store';
import type { RequestStatus } from '../server/network/db';
if (existsSync('.env')) process.loadEnvFile('.env');
const { values } = parseArgs({ options: { status: { type: 'string' }, accept: { type: 'string' }, decline: { type: 'string' }, complete: { type: 'string' }, note: { type: 'string' } } });
const store = openStore(resolve(process.env.DATABASE_PATH ?? 'var/portal.sqlite'), false);
try {
  const decision = values.accept ? (['scheduled', values.accept] as const) : values.decline ? (['declined', values.decline] as const) : values.complete ? (['completed', values.complete] as const) : null;
  if (decision) {
    const [status, id] = decision;
    if (!store.decideRouteRequest(id, status, values.note ?? '')) { console.error(`No route request with ID ${id}.`); process.exit(1); }
    console.log(`Request ${id} is now ${status}.`);
  } else {
    const status = values.status as RequestStatus | undefined;
    const rows = store.allRouteRequests(status);
    if (!rows.length) { console.log(status ? `No ${status} route requests.` : 'No route requests yet.'); }
    for (const row of rows) {
      console.log(`\n${row.id}  ${row.status.toUpperCase()}${row.needsReview ? '  [a stop needs review]' : ''}`);
      console.log(`  ${row.clinicName} (${row.clinicId}) — asked ${row.createdAt.slice(0, 10)}`);
      console.log(`  Wants: ${row.preferredFrom}${row.preferredTo !== row.preferredFrom ? ` to ${row.preferredTo}` : ''}   Contact: ${row.contactName}${row.contactPhone ? ` ${row.contactPhone}` : ''}`);
      if (row.notes) console.log(`  Note from the clinic: ${row.notes}`);
      if (row.teamNote) console.log(`  Our note: ${row.teamNote}`);
      row.stops.forEach((stop, index) => console.log(`  ${index + 1}. ${stop.name ?? '(name expired from the Google cache)'} — ${stop.address ?? 'https://www.google.com/maps/search/?api=1&query=place&query_place_id=' + stop.placeId}  [${stop.placeId}]`));
    }
  }
} finally { store.close(); }
