import { existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { openStore } from '../server/store';
import { qrSvg } from '../server/qr';
import { cleanText } from '../server/partner-validation';
// Make an invitation for a business to join a clinic's network, from the trusted server terminal (like create-client).
// Prints the link to put on the clinic's introduction card; --qr also writes that link as a QR code (SVG) to print.
//   npm run partner-invite -- --clinic clinic-slug [--business "The Iron Room"] [--uses 1] [--days 30] [--qr card.svg]
if (existsSync('.env')) process.loadEnvFile('.env');
const { values } = parseArgs({ options: { clinic: { type: 'string' }, business: { type: 'string' }, uses: { type: 'string' }, days: { type: 'string' }, qr: { type: 'string' } } });
const input = z.object({
  clinic: z.string().regex(/^[a-z0-9-]{3,80}$/),
  business: z.preprocess(v => (v === undefined ? undefined : cleanText(v)), z.string().min(2).max(120).optional()),
  uses: z.coerce.number().int().min(1).max(500).default(1),
  days: z.coerce.number().int().min(1).max(365).default(30),
}).safeParse(values);
if (!input.success) { console.error('Provide --clinic clinic-slug, and optionally --business "Name", --uses 1 to 500, --days 1 to 365, --qr file.svg'); process.exit(1); }
const origin = process.env.APP_ORIGIN ?? `http://localhost:${process.env.PORT ?? 3000}`;
const store = openStore(resolve(process.env.DATABASE_PATH ?? 'var/portal.sqlite'), false);
try {
  const invite = store.partners.createInvitation(input.data.clinic, { businessHint: input.data.business, maxUses: input.data.uses, days: input.data.days });
  const link = `${origin}/join/${invite.token}`;
  if (!store.partners.hasDestination(input.data.clinic)) console.warn('Note: this clinic has no booking link or phone yet, so partner links have nowhere to send people. Set one with npm run clinic-destination.');
  console.log(`Invitation ${invite.id}, good for ${input.data.uses} business${input.data.uses === 1 ? '' : 'es'} until ${new Date(invite.expiresAt).toISOString().slice(0, 10)}:`);
  console.log(link);
  if (values.qr) { writeFileSync(values.qr, qrSvg(link, 'QR code for the invitation to join the network')); console.log(`QR code written to ${values.qr}`); }
  console.log('The link is the key: share it only with the business you are inviting.');
} catch (error) { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }
finally { store.close(); }
