import { existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { openStore } from '../server/store';
import { dayOf } from '../server/partner-store';
import { qrSvg } from '../server/qr';
import { cleanText } from '../server/partner-validation';
// Make an invitation for a business to join a clinic's network, from the trusted server terminal (like create-client).
// Prints the link to put on the clinic's introduction card; --qr also writes that link as a QR code (SVG) to print.
//   npm run partner-invite -- --clinic clinic-slug [--business "The Iron Room"] [--uses 1] [--days 30] [--qr card.svg]
//   npm run partner-invite -- --clinic clinic-slug --list            (every invitation, with its id)
//   npm run partner-invite -- --clinic clinic-slug --revoke <id>     (the link stops working at once)
if (existsSync('.env')) process.loadEnvFile('.env');
const { values } = parseArgs({ options: { clinic: { type: 'string' }, business: { type: 'string' }, uses: { type: 'string' }, days: { type: 'string' }, qr: { type: 'string' }, list: { type: 'boolean' }, revoke: { type: 'string' } } });
const input = z.object({
  clinic: z.string().regex(/^[a-z0-9-]{3,80}$/),
  business: z.preprocess(v => (v === undefined ? undefined : cleanText(v)), z.string().min(2).max(120).optional()),
  uses: z.coerce.number().int().min(1).max(500).default(1),
  days: z.coerce.number().int().min(1).max(365).default(30),
}).safeParse({ clinic: values.clinic, business: values.business, uses: values.uses, days: values.days });
if (!input.success) { console.error('Provide --clinic clinic-slug, and optionally --business "Name", --uses 1 to 500, --days 1 to 365, --qr file.svg (or --list, or --revoke id)'); process.exit(1); }
const origin = process.env.APP_ORIGIN ?? `http://localhost:${process.env.PORT ?? 3000}`;
const store = openStore(resolve(process.env.DATABASE_PATH ?? 'var/portal.sqlite'), false);
store.db.exec('PRAGMA busy_timeout = 10000');
try {
  if (values.list) {
    const rows = store.partners.listInvitations(input.data.clinic);
    if (!rows.length) console.log('No invitations yet.');
    for (const r of rows) console.log([r.id, r.business_hint ?? '(any business)', `${r.uses}/${r.max_uses} used`, r.revoked_at ? 'withdrawn' : r.expires_at <= Date.now() ? 'expired' : `open until ${dayOf(r.expires_at)}`].join(' | '));
  } else if (values.revoke) {
    const ok = store.partners.revokeInvitation(input.data.clinic, values.revoke);
    console.log(ok ? 'Withdrawn: that invitation link no longer works.' : 'No open invitation of this clinic has that id.');
    if (!ok) process.exitCode = 1;
  } else {
    const invite = store.partners.createInvitation(input.data.clinic, { businessHint: input.data.business, maxUses: input.data.uses, days: input.data.days });
    const link = `${origin}/join/${invite.token}`;
    console.log(`Invitation ${invite.id}, good for ${input.data.uses} business${input.data.uses === 1 ? '' : 'es'} until ${dayOf(invite.expiresAt)}:`);
    console.log(link);
    if (values.qr) { writeFileSync(values.qr, qrSvg(link, 'QR code for the invitation to join the network')); console.log(`QR code written to ${values.qr}`); }
    console.log('The link is the key: share it only with the business you are inviting.');
  }
} catch (error) { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }
finally { store.close(); }
