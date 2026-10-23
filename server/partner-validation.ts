import { z } from 'zod';
// What a partner business may send us, and nothing more. Text is normalised (NFC, no control characters, single
// spaces) before the length checks, so what is stored is what was checked. There is deliberately no free-text field
// anywhere on the partner side: nothing a partner types can carry health information about anyone.
export function cleanText(value: unknown) {
  return typeof value === 'string' ? value.normalize('NFC').replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u2028-\u202E\u2066-\u2069]/g, ' ').replace(/\s+/g, ' ').trim() : '';
}
const text = (label: string, min: number, max: number) => z.preprocess(cleanText, z.string().min(min, `Enter ${label}.`).max(max, `Keep ${label} under ${max} characters.`));
const email = z.preprocess(v => cleanText(v).toLowerCase(), z.email('Enter a work email address, like name@yourbusiness.com.').max(254, 'That email address is too long.'));
// Partners choose their own password on a public page, so unlike the clinic accounts (made by the owner on the server)
// there is a floor: 10 characters, the length NIST SP 800-63B suggests for user-chosen secrets without other rules.
const password = z.string().min(10, 'Use at least 10 characters for your password.').max(256, 'Keep your password under 256 characters.');

export const joinInput = z.object({
  businessName: text('your business name', 2, 120),
  contactName: text('your name', 2, 120),
  email,
  password,
  confirm: z.string(),
  agree: z.literal('yes', { error: 'Please confirm you have read how the network works.' }),
}).superRefine((value, ctx) => {
  if (value.password !== value.confirm) ctx.addIssue({ code: 'custom', path: ['confirm'], message: 'The two passwords do not match.' });
  if (value.password.toLowerCase() === value.email) ctx.addIssue({ code: 'custom', path: ['password'], message: 'Choose a password that is not your email address.' });
});
export type JoinInput = z.infer<typeof joinInput>;

export const signInInput = z.object({ email: z.preprocess(v => cleanText(v).toLowerCase(), z.string().min(1).max(254)), password: z.string().min(1).max(256) });

export const detailsInput = z.object({ businessName: text('your business name', 2, 120), contactName: text('your name', 2, 120) });

export const accountInput = z.object({
  email,
  current: z.string().min(1, 'Enter your current password.').max(256),
  password: z.union([z.literal(''), password]),
  confirm: z.string(),
}).superRefine((value, ctx) => {
  if (value.password && value.password !== value.confirm) ctx.addIssue({ code: 'custom', path: ['confirm'], message: 'The two new passwords do not match.' });
});

const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
export const reportRange = z.object({ from: month, to: month }).refine(v => v.from <= v.to, 'The start month must come before the end month.');

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => { const d = new Date(v + 'T00:00:00Z'); return !Number.isNaN(d.valueOf()) && d.toISOString().slice(0, 10) === v; }, 'Use a real date, YYYY-MM-DD.');
export const referralCode = z.string().regex(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$/);
// What a clinic reports back about the referrals it received: counts per partner code per day, never people. The
// import is rejected if it carries any other field, so names, phone numbers or notes cannot ride along.
// LEGAL/PRIVACY REVIEW: before a clinic starts sending these, confirm with counsel that sharing aggregate referral and
// booking counts with partner businesses is consistent with the clinic's notice of privacy practices and state law.
export const outcomeReport = z.object({
  from: day,
  to: day,
  reports: z.array(z.enum(['received', 'booked'])).min(1).refine(v => new Set(v).size === v.length, 'List each status once.'),
  entries: z.array(z.object({ code: referralCode, day, received: z.number().int().min(0).max(10000).optional(), booked: z.number().int().min(0).max(10000).optional() }).strict()).max(100000),
}).strict().superRefine((value, ctx) => {
  if (value.from > value.to) ctx.addIssue({ code: 'custom', path: ['to'], message: '"to" must not be before "from".' });
  value.entries.forEach((entry, index) => {
    if (entry.day < value.from || entry.day > value.to) ctx.addIssue({ code: 'custom', path: ['entries', index, 'day'], message: 'Each entry must fall inside from..to.' });
    for (const status of ['received', 'booked'] as const) if (entry[status] !== undefined && !value.reports.includes(status)) ctx.addIssue({ code: 'custom', path: ['entries', index, status], message: `"${status}" is not listed in "reports".` });
  });
});
export type OutcomeReport = z.infer<typeof outcomeReport>;

export const destinationInput = z.object({
  bookingUrl: z.url({ protocol: /^https$/, error: 'The booking link must start with https://' }).max(2000).optional(),
  phone: z.string().regex(/^\+[1-9]\d{7,14}$/, 'Give the phone in international form, like +16305550100.').optional(),
  refParam: z.string().regex(/^[a-z][a-z0-9_]{0,31}$/i, 'Use letters, numbers and underscores for the parameter name.').optional(),
}).refine(v => v.bookingUrl || v.phone, 'Give a booking link, a phone number, or both.');
