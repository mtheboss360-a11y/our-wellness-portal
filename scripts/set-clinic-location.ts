// The clinic's saved map location — the point the Network Map opens on.
// Run from a trusted server terminal, like the other admin commands.
//
//   npm run set-clinic-location -- --clinic ethr-lab --label "123 Main St, Naperville IL" \
//     --lat 41.7508 --lng=-88.1535 --radius 5
//
// Write a negative longitude as --lng=-88.1535, with the equals sign. Without it Node reads
// the leading dash as the next option and refuses the whole command.
//
// Coordinates are the clinic's own address, not Google content, so they are kept
// indefinitely. --competitors overrides which categories count as direct competitors for
// this clinic (comma separated category IDs from server/network/config.ts).
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { openStore } from '../server/store';
import { clinicLocationInput } from '../server/validation';
import { DEFAULT_RADIUS_MILES } from '../server/network/config';
if (existsSync('.env')) process.loadEnvFile('.env');
const USAGE = 'Provide --clinic slug --label "street address" --lat 41.7508 --lng=-88.1535 [--radius 5] [--place-id ...] [--competitors med-spa,salon]\n  A negative longitude needs the equals sign: --lng=-88.1535';
let values: Record<string, string | undefined>;
try { values = parseArgs({ options: { clinic: { type: 'string' }, label: { type: 'string' }, lat: { type: 'string' }, lng: { type: 'string' }, radius: { type: 'string' }, 'place-id': { type: 'string' }, competitors: { type: 'string' } } }).values as Record<string, string | undefined>; }
catch (error) { console.error(`${(error as Error).message}\n\n${USAGE}`); process.exit(1); }
const input = clinicLocationInput.safeParse({
  clinic: values.clinic, label: values.label,
  lat: Number(values.lat), lng: Number(values.lng),
  radiusMiles: values.radius ? Number(values.radius) : DEFAULT_RADIUS_MILES,
  placeId: values['place-id'] ?? null,
  competitorCategories: values.competitors ? values.competitors.split(',').map(value => value.trim()).filter(Boolean) : [],
});
if (!input.success) { console.error(USAGE); console.error(input.error.issues.map(issue => `  ${issue.path.join('.') || 'input'}: ${issue.message}`).join('\n')); process.exit(1); }
const store = openStore(resolve(process.env.DATABASE_PATH ?? 'var/portal.sqlite'), false);
try {
  store.setClinicLocation({ clinicId: input.data.clinic, label: input.data.label, lat: input.data.lat, lng: input.data.lng, radiusMiles: input.data.radiusMiles, placeId: input.data.placeId, competitorCategories: input.data.competitorCategories });
  console.log(`Saved. ${input.data.clinic} opens its network map at ${input.data.lat}, ${input.data.lng} within ${input.data.radiusMiles} miles.`);
} finally { store.close(); }
