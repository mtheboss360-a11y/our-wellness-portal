// RELEASE A BATCH OF VERIFIED BUSINESSES to one practice.
//
//   npm run release-businesses -- --clinic hyline-demo --file data/releases/hyline-release-1.json
//
// Safe to run twice: the release is keyed on the clinic plus each business's name and address,
// so a second run updates details and adds nothing. A script somebody has edited in the portal
// is kept. Nothing belonging to another clinic is read or written.
import { parseArgs } from 'node:util';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { openStore } from '../server/store.ts';

if (existsSync('.env')) process.loadEnvFile('.env');

const { values } = parseArgs({ options: {
  clinic: { type: 'string' }, file: { type: 'string' }, by: { type: 'string' },
} });

const clinicId = values.clinic ?? '';
const file = values.file ?? '';
const releasedBy = (values.by ?? process.env.USER ?? 'unknown').trim();

if (!/^[a-z0-9-]{3,80}$/.test(clinicId)) throw new Error('Provide --clinic clinic-slug.');
if (!file) throw new Error('Provide --file data/releases/<release>.json.');

const scriptShape = z.object({
  opening: z.string().min(1), introduction: z.string().min(1), value: z.string().min(1),
  ask: z.string().min(1),
  objections: z.object({ busy: z.string().min(1), notInterested: z.string().min(1), alreadyPartnered: z.string().min(1) }).strict(),
  closing: z.string().min(1), followUp: z.string().min(1),
}).strict();

const releaseShape = z.object({
  id: z.string().regex(/^[a-z0-9-]{3,80}$/),
  name: z.string().min(1).max(160),
  notes: z.array(z.string()).optional(),
  businesses: z.array(z.object({
    name: z.string().min(1).max(160),
    category: z.string().min(1).max(80),
    address: z.string().min(6).max(240),
    phone: z.string().max(40).optional(),
    website: z.string().url().max(300).optional(),
    talkingPoint: z.string().max(400).optional(),
    lat: z.number().min(-90).max(90).optional(),
    lng: z.number().min(-180).max(180).optional(),
    script: scriptShape,
  }).strict()).min(1).max(100),
}).strict();

const parsed = releaseShape.safeParse(JSON.parse(readFileSync(resolve(file), 'utf8')));
if (!parsed.success) {
  console.error(parsed.error.issues.map(i => `  ${i.path.join('.')}: ${i.message}`).join('\n'));
  throw new Error(`${file} is not a release we can read.`);
}
const release = parsed.data;

// A name and address can only belong to one business. Two the same in one file is a mistake in
// the file, and catching it here is cheaper than finding a duplicate in the portal later.
const seen = new Set<string>();
for (const b of release.businesses) {
  const key = `${b.name}|${b.address}`.toLowerCase();
  if (seen.has(key)) throw new Error(`${b.name} appears twice in this release.`);
  seen.add(key);
}

const store = openStore(resolve(process.env.DATABASE_PATH ?? 'var/portal.sqlite'), false);
try {
  const clinic = store.db.prepare('SELECT name,demo FROM clinics WHERE id=?').get(clinicId) as
    { name: string; demo: number } | undefined;
  if (!clinic) throw new Error(`No clinic "${clinicId}". This releases to a practice that already exists.`);

  const result = store.outreach.release(clinicId, release.id, release.name, releasedBy,
    release.businesses.map(b => ({ ...b, lat: b.lat ?? null, lng: b.lng ?? null })));

  console.log(`${release.name} → ${clinic.name} (${clinicId})`);
  if (result.added.length) console.log(`  Added:   ${result.added.join(', ')}`);
  if (result.updated.length) console.log(`  Updated: ${result.updated.join(', ')} (already on the list)`);
  if (result.keptScript.length) console.log(`  Kept the edited script for: ${result.keptScript.join(', ')}`);
  console.log(`  ${result.total} businesses in this release, all at "New / not contacted".`);

  const missing = release.businesses.filter(b => b.lat === undefined || b.lng === undefined);
  if (missing.length) console.log(`\n  ${missing.length} have no coordinates, so they route by street address and do not appear on the orb. Geocoding is a separate step.`);
  if (clinic.demo === 1) console.log(`\n  NOTE: ${clinicId} is flagged as a demo account, so these real businesses now sit alongside its illustrative field log.`);
} finally { store.close(); }
