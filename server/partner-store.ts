import type { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { digest, passwordHash, verifyPassword } from './store';
import type { JoinInput, OutcomeReport } from './partner-validation';

// The partner side of the network. A clinic is the hub; a nearby business that is not a competitor joins the
// clinic's network for free as a partner, gets a referral code (a link and a QR code), and sees the activity that
// code produces. This app tracks where referrals come from. It is not a patient record: no table here holds a name,
// phone number, email, symptom or treatment of anyone who used a partner's link.
//
// Partners have their own sign-in, their own sessions and their own cookie. They are never rows in `users` or
// `sessions`, so a partner session cannot open the clinic report, by construction rather than by a check someone
// could forget.
export function migratePartners(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS clinic_destinations (
      clinic_id TEXT PRIMARY KEY REFERENCES clinics(id),
      booking_url TEXT, phone TEXT, ref_param TEXT,
      updated_at INTEGER NOT NULL,
      CHECK (booking_url IS NOT NULL OR phone IS NOT NULL));
    CREATE TABLE IF NOT EXISTS partner_invitations (
      id TEXT PRIMARY KEY,
      clinic_id TEXT NOT NULL REFERENCES clinics(id),
      token_hash TEXT NOT NULL UNIQUE,
      business_hint TEXT,
      max_uses INTEGER NOT NULL CHECK (max_uses BETWEEN 1 AND 500),
      uses INTEGER NOT NULL DEFAULT 0,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      revoked_at INTEGER);
    -- business_key is fixed when the business joins: it is how "the same business in the same network" is detected.
    -- Renaming later changes only the name shown.
    CREATE TABLE IF NOT EXISTS partners (
      id TEXT PRIMARY KEY,
      clinic_id TEXT NOT NULL REFERENCES clinics(id),
      invitation_id TEXT REFERENCES partner_invitations(id),
      business_name TEXT NOT NULL,
      business_key TEXT NOT NULL,
      contact_name TEXT NOT NULL,
      joined_at INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','left')),
      left_at INTEGER,
      UNIQUE (clinic_id, business_key));
    CREATE TABLE IF NOT EXISTS partner_users (
      id TEXT PRIMARY KEY,
      partner_id TEXT NOT NULL REFERENCES partners(id),
      email TEXT NOT NULL UNIQUE,
      hash TEXT NOT NULL, salt TEXT NOT NULL,
      created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS partner_sessions (
      token_hash TEXT PRIMARY KEY,
      partner_user_id TEXT NOT NULL REFERENCES partner_users(id),
      csrf TEXT NOT NULL,
      expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS referral_codes (
      code TEXT PRIMARY KEY,
      partner_id TEXT NOT NULL REFERENCES partners(id),
      label TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      active INTEGER NOT NULL DEFAULT 1);
    -- Visits through a partner's link or QR code, counted per code, per day and per channel. Only the code, the day,
    -- how it was opened and how many times: no IP address, no device details, nothing about any person. One row per
    -- code, day and channel, however much traffic arrives.
    CREATE TABLE IF NOT EXISTS referral_visits (
      code TEXT NOT NULL REFERENCES referral_codes(code),
      day TEXT NOT NULL,
      channel TEXT NOT NULL CHECK (channel IN ('qr','link')),
      count INTEGER NOT NULL CHECK (count >= 1),
      PRIMARY KEY (code, day, channel));
    -- What the clinic reports back, as counts per code per day. Each import also records which dates and which
    -- statuses it covers, so a day the clinic has not reported shows as "Not reported", never as zero.
    CREATE TABLE IF NOT EXISTS outcome_reports (
      id INTEGER PRIMARY KEY,
      clinic_id TEXT NOT NULL REFERENCES clinics(id),
      status TEXT NOT NULL CHECK (status IN ('received','booked')),
      from_day TEXT NOT NULL, to_day TEXT NOT NULL,
      reported_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS referral_outcomes (
      id INTEGER PRIMARY KEY,
      code TEXT NOT NULL REFERENCES referral_codes(code),
      day TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('received','booked')),
      count INTEGER NOT NULL CHECK (count BETWEEN 1 AND 10000),
      report_id INTEGER NOT NULL REFERENCES outcome_reports(id));
    CREATE INDEX IF NOT EXISTS partners_clinic ON partners(clinic_id);
    CREATE INDEX IF NOT EXISTS partner_users_partner ON partner_users(partner_id);
    CREATE INDEX IF NOT EXISTS partner_sessions_expiration ON partner_sessions(expires_at);
    CREATE INDEX IF NOT EXISTS referral_codes_partner ON referral_codes(partner_id);
    CREATE INDEX IF NOT EXISTS referral_outcomes_code_day ON referral_outcomes(code, day);
    CREATE INDEX IF NOT EXISTS outcome_reports_clinic ON outcome_reports(clinic_id, status);
    CREATE INDEX IF NOT EXISTS attempts_expiration ON attempts(expires_at);
  `);
}

const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'; // no 0/O, 1/I/L: codes get read aloud and typed
export const CODE_PATTERN = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$/;
const SESSION_MS = 14 * 24 * 60 * 60 * 1000;
const WINDOW_MS = 15 * 60 * 1000;
// Visits: one browser counts once a day (a cookie, in partner-http.ts). As a backstop for clients that drop the
// cookie, one connection counts at most VISITS_PER_IP times a day per code, and a code counts at most
// VISITS_PER_CODE times a day. Over either limit the person is still sent on; the visit is just not counted.
const VISITS_PER_IP = 3;
const VISITS_PER_CODE = 1000;
// Password checks (scrypt) run on the request thread. However many addresses a client uses, unauthenticated
// password work is capped across the whole server, so a flood slows nobody down: it gets "busy" answers instead.
const PASSWORD_CHECKS_PER_MINUTE = 120;
export const TIME_ZONE = process.env.PARTNER_TIME_ZONE || 'America/Chicago';
const dayFormat = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });
/** The calendar day, in the network's time zone, that a moment falls on (YYYY-MM-DD). */
export function dayOf(ms: number) { return dayFormat.format(new Date(ms)); }
const STOP_WORDS = new Set(['the', 'llc', 'inc', 'co', 'corp', 'ltd', 'pllc', 'company']);
/** Two spellings of one business ("The Iron Room, LLC" and "iron room") are the same partner. Works in any script. */
export function businessKey(name: string) {
  const words = name.normalize('NFKC').toLowerCase().normalize('NFKD').replace(/\p{M}+/gu, '').replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/(^| )l l c(?= |$)/g, ' llc').trim().split(' ').filter(Boolean);
  const kept = words.filter(w => !STOP_WORDS.has(w));
  return (kept.length ? kept : words).join('');
}
const newId = () => randomBytes(16).toString('hex');
const newCode = () => Array.from({ length: 8 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
const sameText = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };

export type PartnerSession = { userId: string; partnerId: string; clinicId: string; clinicName: string; businessName: string; contactName: string; email: string; joinedAt: number; csrf: string; status: string };
export type Destination = 'booking' | 'phone' | 'none';
type Fail = { ok: false; status: number; message: string; field?: string };
const BUSY: Fail = { ok: false, status: 429, message: 'We are getting a lot of sign-in attempts right now. Please try again in a minute.' };
const SLOW_DOWN: Fail = { ok: false, status: 429, message: 'Too many attempts. Please wait 15 minutes and try again.' };

export function createPartnerStore(db: DatabaseSync, now = () => Date.now()) {
  const one = <T>(sql: string, ...params: Array<string | number | null>) => db.prepare(sql).get(...params) as T | undefined;
  const all = <T>(sql: string, ...params: Array<string | number | null>) => db.prepare(sql).all(...params) as T[];
  const run = (sql: string, ...params: Array<string | number | null>) => db.prepare(sql).run(...params);
  function tx<T>(fn: () => T): T {
    db.exec('BEGIN IMMEDIATE');
    try { const value = fn(); db.exec('COMMIT'); return value; } catch (error) { db.exec('ROLLBACK'); throw error; }
  }

  // ---- Limits. Checking a limit never counts against it; only attempts that fail (or that cost work) are counted.
  // They share the clinic sign-in's `attempts` table, with partner-specific buckets.
  let pruned = 0;
  function limited(rules: Array<[string, number]>) {
    const t = now();
    if (t - pruned > 60000) { run('DELETE FROM attempts WHERE expires_at<?', t); pruned = t; }
    return rules.some(([bucket, limit]) => ((one<{ count: number }>('SELECT count FROM attempts WHERE bucket=? AND expires_at>?', digest(bucket), t)?.count) ?? 0) >= limit);
  }
  function bump(buckets: string[]) {
    const t = now();
    const counter = db.prepare('INSERT INTO attempts (bucket,count,expires_at) VALUES (?,1,?) ON CONFLICT(bucket) DO UPDATE SET count=CASE WHEN expires_at>? THEN count+1 ELSE 1 END, expires_at=CASE WHEN expires_at>? THEN expires_at ELSE excluded.expires_at END');
    for (const b of buckets) counter.run(digest(b), t + WINDOW_MS, t, t);
  }
  const passwordWork: number[] = [];
  function passwordBudget() {
    const t = now();
    while (passwordWork.length && passwordWork[0] <= t - 60000) passwordWork.shift();
    if (passwordWork.length >= PASSWORD_CHECKS_PER_MINUTE) return false;
    passwordWork.push(t); return true;
  }
  // Visit limits live in memory: they hold nothing but a hash of the address and a count, and reset each day.
  let visitDay = '';
  const visitsByAddress = new Map<string, number>();

  function startSession(userId: string, previousToken?: string) {
    const token = randomBytes(32).toString('hex');
    const csrf = randomBytes(32).toString('hex');
    run('DELETE FROM partner_sessions WHERE token_hash=? OR expires_at<=?', previousToken ? digest(previousToken) : '', now());
    run('INSERT INTO partner_sessions (token_hash,partner_user_id,csrf,expires_at) VALUES (?,?,?,?)', digest(token), userId, csrf, now() + SESSION_MS);
    return token;
  }
  function uniqueCode() {
    for (let i = 0; i < 20; i++) { const code = newCode(); if (!one('SELECT 1 AS x FROM referral_codes WHERE code=?', code)) return code; }
    throw new Error('Could not allocate a referral code.');
  }
  type Invitation = { id: string; clinic_id: string; clinic_name: string; business_hint: string | null; max_uses: number; uses: number; expires_at: number; revoked_at: number | null };
  function invitationRow(token: string) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return undefined;
    return one<Invitation>('SELECT i.id,i.clinic_id,c.name AS clinic_name,i.business_hint,i.max_uses,i.uses,i.expires_at,i.revoked_at FROM partner_invitations i JOIN clinics c ON c.id=i.clinic_id WHERE i.token_hash=?', digest(token));
  }
  function invitationState(row: Invitation | undefined) {
    if (!row) return 'missing' as const;
    if (row.revoked_at) return 'revoked' as const;
    if (row.expires_at <= now()) return 'expired' as const;
    if (row.uses >= row.max_uses) return 'used' as const;
    return 'open' as const;
  }
  function codesOf(partnerId: string) {
    return all<{ code: string; label: string; active: number; created_at: number }>('SELECT code,label,active,created_at FROM referral_codes WHERE partner_id=? ORDER BY created_at', partnerId);
  }
  function destinationOf(clinicId: string): Destination {
    const row = one<{ booking_url: string | null; phone: string | null }>('SELECT booking_url,phone FROM clinic_destinations WHERE clinic_id=?', clinicId);
    return row?.booking_url ? 'booking' : row?.phone ? 'phone' : 'none';
  }
  /** The days a clinic has reported a status for, merged into ranges, clipped to [from, to]. */
  function coverage(clinicId: string, status: 'received' | 'booked', from: string, to: string) {
    const rows = all<{ from_day: string; to_day: string }>('SELECT from_day,to_day FROM outcome_reports WHERE clinic_id=? AND status=? AND to_day>=? AND from_day<=? ORDER BY from_day', clinicId, status, from, to);
    const merged: Array<[string, string]> = [];
    for (const r of rows) {
      const a = r.from_day < from ? from : r.from_day, b = r.to_day > to ? to : r.to_day;
      const last = merged.at(-1);
      if (last && a <= nextDay(last[1])) { if (b > last[1]) last[1] = b; } else merged.push([a, b]);
    }
    return merged;
  }
  const coveredDays = (ranges: Array<[string, string]>) => ranges.reduce((n, [a, b]) => n + daysBetween(a, b) + 1, 0);
  const inList = (list: string[]) => list.map(() => '?').join(',') || "''";

  return {
    // ---- Clinic side: run from the server terminal (scripts/), like the existing client and campaign tools. ----
    setDestination(clinicId: string, value: { bookingUrl?: string; phone?: string; refParam?: string }) {
      if (!one('SELECT 1 AS x FROM clinics WHERE id=?', clinicId)) throw new Error('Create this clinic first.');
      run('INSERT INTO clinic_destinations (clinic_id,booking_url,phone,ref_param,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(clinic_id) DO UPDATE SET booking_url=excluded.booking_url,phone=excluded.phone,ref_param=excluded.ref_param,updated_at=excluded.updated_at',
        clinicId, value.bookingUrl ?? null, value.phone ?? null, value.refParam ?? null, now());
    },
    /** Partner links need somewhere to send people, so there are no invitations until the clinic has a destination. */
    createInvitation(clinicId: string, options: { businessHint?: string; maxUses?: number; days?: number } = {}) {
      if (!one('SELECT 1 AS x FROM clinics WHERE id=?', clinicId)) throw new Error('Create this clinic first.');
      if (destinationOf(clinicId) === 'none') throw new Error('Set where partner links go first (npm run clinic-destination): until then a partner\'s link would have nowhere to send people.');
      const token = randomBytes(32).toString('base64url');
      const id = newId();
      const expiresAt = now() + (options.days ?? 30) * 24 * 60 * 60 * 1000;
      run('INSERT INTO partner_invitations (id,clinic_id,token_hash,business_hint,max_uses,expires_at,created_at) VALUES (?,?,?,?,?,?,?)', id, clinicId, digest(token), options.businessHint ?? null, options.maxUses ?? 1, expiresAt, now());
      return { id, token, expiresAt };
    },
    revokeInvitation(clinicId: string, id: string) { return run('UPDATE partner_invitations SET revoked_at=? WHERE id=? AND clinic_id=? AND revoked_at IS NULL', now(), id, clinicId).changes > 0; },
    listInvitations(clinicId: string) {
      return all<{ id: string; business_hint: string | null; uses: number; max_uses: number; expires_at: number; revoked_at: number | null }>('SELECT id,business_hint,uses,max_uses,expires_at,revoked_at FROM partner_invitations WHERE clinic_id=? ORDER BY created_at', clinicId);
    },
    hasDestination(clinicId: string) { return destinationOf(clinicId) !== 'none'; },
    destination: destinationOf,
    listPartners(clinicId: string) {
      return all<{ business_name: string; contact_name: string; email: string | null; joined_at: number; status: string; codes: string }>(
        `SELECT p.business_name,p.contact_name,u.email,p.joined_at,p.status,(SELECT group_concat(code,' ') FROM referral_codes r WHERE r.partner_id=p.id) AS codes
         FROM partners p LEFT JOIN partner_users u ON u.partner_id=p.id WHERE p.clinic_id=? ORDER BY p.joined_at`, clinicId);
    },
    setPartnerStatus(clinicId: string, code: string, status: 'active' | 'paused') {
      return run("UPDATE partners SET status=? WHERE clinic_id=? AND status<>'left' AND id=(SELECT partner_id FROM referral_codes WHERE code=?)", status, clinicId, code).changes > 0;
    },
    /** A partner leaves (the join page promises they can): the sign-in and the contact name are deleted, the link stops
     *  working, and only the business name and the anonymous counts stay with the clinic's records. */
    removePartner(clinicId: string, code: string) {
      const partner = one<{ id: string }>("SELECT p.id FROM partners p JOIN referral_codes r ON r.partner_id=p.id WHERE p.clinic_id=? AND r.code=? AND p.status<>'left'", clinicId, code);
      if (!partner) return false;
      tx(() => {
        run('DELETE FROM partner_sessions WHERE partner_user_id IN (SELECT id FROM partner_users WHERE partner_id=?)', partner.id);
        run('DELETE FROM partner_users WHERE partner_id=?', partner.id);
        run('UPDATE referral_codes SET active=0 WHERE partner_id=?', partner.id);
        run("UPDATE partners SET status='left',left_at=?,contact_name='' WHERE id=?", now(), partner.id);
      });
      return true;
    },
    /** Replaces whatever the clinic reported earlier for these statuses and dates, then records the coverage. */
    reportOutcomes(clinicId: string, report: OutcomeReport) {
      const today = dayOf(now());
      if (report.to > today) throw new Error(`"to" is ${report.to}, after today (${today}). Report a period only once it has ended: a day that has not happened yet would show as a real zero.`);
      const codes = new Map(all<{ code: string; created_at: number }>('SELECT r.code,r.created_at FROM referral_codes r JOIN partners p ON p.id=r.partner_id WHERE p.clinic_id=?', clinicId).map(r => [r.code, dayOf(r.created_at)]));
      const foreign = report.entries.filter(e => !codes.has(e.code)).map(e => e.code);
      if (foreign.length) throw new Error(`These codes do not belong to this clinic: ${[...new Set(foreign)].join(', ')}`);
      const early = report.entries.filter(e => e.day < codes.get(e.code)!).map(e => `${e.code} on ${e.day}`);
      if (early.length) throw new Error(`These entries are dated before the code existed: ${early.slice(0, 10).join(', ')}`);
      return tx(() => {
        let rows = 0;
        const clear = db.prepare(`DELETE FROM referral_outcomes WHERE status=? AND day BETWEEN ? AND ? AND code IN (SELECT r.code FROM referral_codes r JOIN partners p ON p.id=r.partner_id WHERE p.clinic_id=?)`);
        const cover = db.prepare('INSERT INTO outcome_reports (clinic_id,status,from_day,to_day,reported_at) VALUES (?,?,?,?,?)');
        const insert = db.prepare('INSERT INTO referral_outcomes (code,day,status,count,report_id) VALUES (?,?,?,?,?)');
        for (const status of report.reports) {
          clear.run(status, report.from, report.to, clinicId);
          const reportId = Number(cover.run(clinicId, status, report.from, report.to, now()).lastInsertRowid);
          for (const entry of report.entries) {
            const count = entry[status];
            if (count) { insert.run(entry.code, entry.day, status, count, reportId); rows++; }
          }
        }
        return rows;
      });
    },

    // ---- Public: the invitation, joining, and the referral link itself. ----
    invitation(token: string) {
      const row = invitationRow(token);
      const state = invitationState(row);
      // Only a real invitation reveals which clinic sent it.
      return { state, clinicName: row?.clinic_name ?? null, businessHint: state === 'open' ? row?.business_hint ?? null : null };
    },
    join(token: string, input: JoinInput, ip: string): { ok: true; token: string } | Fail {
      if (limited([['join-ip:' + ip, 20]])) return SLOW_DOWN;
      bump(['join-ip:' + ip]);
      const key = businessKey(input.businessName);
      if (!key) return { ok: false, status: 400, field: 'businessName', message: 'Enter your business name.' };
      const row = invitationRow(token);
      // Each invitation answers at most five "already joined" questions, so it cannot be used to list who is in the network.
      if (row && limited([['join-inv:' + row.id, 5]])) return SLOW_DOWN;
      const duplicate = (fail: Fail) => { if (row) bump(['join-inv:' + row.id]); return fail; };
      if (!passwordBudget()) return BUSY;
      return tx(() => {
        const live = invitationRow(token);
        if (invitationState(live) !== 'open' || !live) return { ok: false as const, status: 410, message: 'This invitation can no longer be used.' };
        if (one('SELECT 1 AS x FROM partners WHERE clinic_id=? AND business_key=?', live.clinic_id, key))
          return duplicate({ ok: false, status: 409, field: 'businessName', message: `A business with this name has already joined ${live.clinic_name}'s network. If that is you, sign in instead.` });
        if (one('SELECT 1 AS x FROM partner_users WHERE email=?', input.email))
          return duplicate({ ok: false, status: 409, field: 'email', message: "We can't create an account with this email. If you already have one, sign in instead, or use a different work email." });
        const partnerId = newId(), userId = newId(), salt = randomBytes(24).toString('hex');
        run('INSERT INTO partners (id,clinic_id,invitation_id,business_name,business_key,contact_name,joined_at) VALUES (?,?,?,?,?,?,?)', partnerId, live.clinic_id, live.id, input.businessName, key, input.contactName, now());
        run('INSERT INTO partner_users (id,partner_id,email,hash,salt,created_at) VALUES (?,?,?,?,?,?)', userId, partnerId, input.email, passwordHash(input.password, salt), salt, now());
        run('INSERT INTO referral_codes (code,partner_id,label,created_at) VALUES (?,?,?,?)', uniqueCode(), partnerId, 'Main code', now());
        run('UPDATE partner_invitations SET uses=uses+1 WHERE id=?', live.id);
        return { ok: true as const, token: startSession(userId) };
      });
    },
    /** Where a partner's code sends people. null when the code is unknown, switched off, or its partner is paused or left. */
    resolveCode(code: string) {
      if (!CODE_PATTERN.test(code)) return null;
      const row = one<{ code: string; clinic_name: string; booking_url: string | null; phone: string | null; ref_param: string | null }>(
        `SELECT r.code,c.name AS clinic_name,d.booking_url,d.phone,d.ref_param FROM referral_codes r JOIN partners p ON p.id=r.partner_id JOIN clinics c ON c.id=p.clinic_id
         LEFT JOIN clinic_destinations d ON d.clinic_id=p.clinic_id WHERE r.code=? AND r.active=1 AND p.status='active'`, code);
      return row ?? null;
    },
    /** Counts one visit unless this connection or this code is over its daily limit. Returns whether it counted. */
    recordVisit(code: string, channel: 'qr' | 'link', ip: string) {
      const t = now(), day = dayOf(t);
      if (day !== visitDay) { visitDay = day; visitsByAddress.clear(); }
      const key = digest(`${code}|${ip}`);
      const seen = visitsByAddress.get(key) ?? 0;
      if (seen >= VISITS_PER_IP) return false;
      if (visitsByAddress.size >= 200000 && !seen) return false; // a flood of new addresses: stop counting, keep routing
      const today = (one<{ n: number | null }>('SELECT sum(count) AS n FROM referral_visits WHERE code=? AND day=?', code, day)?.n) ?? 0;
      if (today >= VISITS_PER_CODE) return false;
      visitsByAddress.set(key, seen + 1);
      run('INSERT INTO referral_visits (code,day,channel,count) VALUES (?,?,?,1) ON CONFLICT(code,day,channel) DO UPDATE SET count=count+1', code, day, channel);
      return true;
    },

    // ---- Partner sign-in. ----
    signIn(email: string, password: string, ip: string, previousToken?: string): { ok: true; token: string } | Fail {
      // Failed attempts count per address, per address and email, and (much higher, so a stranger cannot lock a
      // partner out) per email. A correct password never counts against anyone.
      const rules: Array<[string, number]> = [['p-ip:' + ip, 30], ['p-user-ip:' + email + '|' + ip, 10], ['p-user:' + email, 100]];
      if (limited(rules)) return SLOW_DOWN;
      if (!passwordBudget()) return BUSY;
      const user = one<{ id: string; hash: string; salt: string }>('SELECT id,hash,salt FROM partner_users WHERE email=?', email);
      const valid = verifyPassword(password, user?.salt ?? 'unknown-user-padding', user?.hash ?? '00'.repeat(64));
      if (!user || !valid) { bump(rules.map(r => r[0])); return { ok: false, status: 401, message: "That email and password didn't match. Please check them and try again." }; }
      return { ok: true, token: tx(() => startSession(user.id, previousToken)) };
    },
    session(token: string | undefined): PartnerSession | null {
      if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
      const row = one<{ user_id: string; partner_id: string; clinic_id: string; clinic_name: string; business_name: string; contact_name: string; email: string; joined_at: number; csrf: string; status: string }>(
        `SELECT u.id AS user_id,p.id AS partner_id,p.clinic_id,c.name AS clinic_name,p.business_name,p.contact_name,u.email,p.joined_at,s.csrf,p.status
         FROM partner_sessions s JOIN partner_users u ON u.id=s.partner_user_id JOIN partners p ON p.id=u.partner_id JOIN clinics c ON c.id=p.clinic_id
         WHERE s.token_hash=? AND s.expires_at>? AND p.status<>'left'`, digest(token), now());
      if (!row) return null;
      return { userId: row.user_id, partnerId: row.partner_id, clinicId: row.clinic_id, clinicName: row.clinic_name, businessName: row.business_name, contactName: row.contact_name, email: row.email, joinedAt: row.joined_at, csrf: row.csrf, status: row.status };
    },
    checkCsrf(session: PartnerSession, value: unknown) { return typeof value === 'string' && sameText(value, session.csrf); },
    signOut(token: string | undefined) { if (token && /^[a-f0-9]{64}$/.test(token)) run('DELETE FROM partner_sessions WHERE token_hash=?', digest(token)); },

    // ---- What a signed-in partner sees. Every query below is scoped by the partner id from the session, and to the
    // days between joining and today. ----
    dashboard(session: PartnerSession) {
      const codes = codesOf(session.partnerId);
      const list = codes.map(c => c.code);
      const marks = inList(list);
      const joinedDay = dayOf(session.joinedAt), today = dayOf(now());
      const visits = (one<{ n: number | null }>(`SELECT sum(count) AS n FROM referral_visits WHERE code IN (${marks}) AND day BETWEEN ? AND ?`, ...list, joinedDay, today)?.n) ?? 0;
      const outcome = (status: 'received' | 'booked') => {
        const ranges = coverage(session.clinicId, status, joinedDay, today);
        if (!ranges.length) return { reported: false as const, value: null, through: null };
        const value = (one<{ n: number | null }>(`SELECT sum(count) AS n FROM referral_outcomes WHERE status=? AND code IN (${marks}) AND day BETWEEN ? AND ?`, status, ...list, joinedDay, today)?.n) ?? 0;
        return { reported: true as const, value, through: ranges.at(-1)![1], covered: coveredDays(ranges), span: daysBetween(joinedDay, today) + 1 };
      };
      // Visits are listed by day. What the clinic reports is listed only by month: a daily "1 booking" next to a
      // code the partner gave to one person would tell the partner that this person became a patient.
      // LEGAL/PRIVACY REVIEW: whether monthly totals are coarse enough (or small numbers should be hidden) is a policy
      // decision for the clinic and counsel.
      const history = all<{ period: string; code: string; kind: string; n: number }>(
        `SELECT period,code,kind,n FROM (
           SELECT day AS period,code,'visit-'||channel AS kind,count AS n FROM referral_visits WHERE code IN (${marks}) AND day BETWEEN ? AND ?
           UNION ALL
           SELECT substr(day,1,7) AS period,code,status AS kind,sum(count) AS n FROM referral_outcomes WHERE code IN (${marks}) AND day BETWEEN ? AND ? GROUP BY substr(day,1,7),code,status)
         ORDER BY period DESC, code, kind LIMIT 90`, ...list, joinedDay, today, ...list, joinedDay, today);
      return { codes, visits, received: outcome('received'), booked: outcome('booked'), history, destination: destinationOf(session.clinicId) };
    },
    report(session: PartnerSession, from: string, to: string) {
      const codes = codesOf(session.partnerId);
      const joinedDay = dayOf(session.joinedAt), today = dayOf(now());
      const rows: Array<{ month: string; code: string; days: number; visits: number; received: number | null; receivedDays: number; booked: number | null; bookedDays: number }> = [];
      for (const month of monthsBetween(from, to)) {
        // A month counts from the day the partner joined to today at the latest: days outside that cannot have activity.
        const start = maxDay(month + '-01', joinedDay), end = minDay(lastDayOf(month), today);
        if (start > end) continue;
        const days = daysBetween(start, end) + 1;
        const cov = { received: coveredDays(coverage(session.clinicId, 'received', start, end)), booked: coveredDays(coverage(session.clinicId, 'booked', start, end)) };
        for (const { code } of codes) {
          const visits = (one<{ n: number | null }>('SELECT sum(count) AS n FROM referral_visits WHERE code=? AND day BETWEEN ? AND ?', code, start, end)?.n) ?? 0;
          const sum = (status: 'received' | 'booked') => cov[status] ? ((one<{ n: number | null }>('SELECT sum(count) AS n FROM referral_outcomes WHERE code=? AND status=? AND day BETWEEN ? AND ?', code, status, start, end)?.n) ?? 0) : null;
          rows.push({ month, code, days, visits, received: sum('received'), receivedDays: cov.received, booked: sum('booked'), bookedDays: cov.booked });
        }
      }
      return { codes, rows, joinedMonth: joinedDay.slice(0, 7), currentMonth: today.slice(0, 7) };
    },
    /** Renaming changes the name shown, not the key the business joined with, so it cannot be used to test which
     *  other names are in the network. */
    updateDetails(session: PartnerSession, input: { businessName: string; contactName: string }): { ok: true } | Fail {
      if (limited([['p-details:' + session.userId, 20]])) return SLOW_DOWN;
      bump(['p-details:' + session.userId]);
      run('UPDATE partners SET business_name=?,contact_name=? WHERE id=?', input.businessName, input.contactName, session.partnerId);
      return { ok: true };
    },
    updateAccount(session: PartnerSession, input: { email: string; current: string; password: string }, ip: string): { ok: true } | Fail {
      const rules: Array<[string, number]> = [['p-acct:' + session.userId, 12], ['p-ip:' + ip, 30]];
      if (limited(rules)) return SLOW_DOWN;
      if (!passwordBudget()) return BUSY;
      bump(rules.map(r => r[0]));
      const user = one<{ hash: string; salt: string }>('SELECT hash,salt FROM partner_users WHERE id=?', session.userId);
      if (!user || !verifyPassword(input.current, user.salt, user.hash)) return { ok: false, status: 401, field: 'current', message: 'Your current password is not right.' };
      if (input.email !== session.email && one('SELECT 1 AS x FROM partner_users WHERE email=?', input.email)) return { ok: false, status: 409, field: 'email', message: "We can't use this email for your account. Choose a different one." };
      if (input.password && input.password.toLowerCase() === input.email) return { ok: false, status: 400, field: 'password', message: 'Choose a password that is not your email address.' };
      tx(() => {
        run('UPDATE partner_users SET email=? WHERE id=?', input.email, session.userId);
        if (input.password) {
          const salt = randomBytes(24).toString('hex');
          run('UPDATE partner_users SET hash=?,salt=? WHERE id=?', passwordHash(input.password, salt), salt, session.userId);
          // A new password signs out every other session of this account.
          run('DELETE FROM partner_sessions WHERE partner_user_id=? AND csrf<>?', session.userId, session.csrf);
        }
      });
      return { ok: true };
    },
  };
}

function nextDay(day: string) { const d = new Date(day + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); }
export function daysBetween(a: string, b: string) { return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000); }
const maxDay = (a: string, b: string) => (a > b ? a : b);
const minDay = (a: string, b: string) => (a < b ? a : b);
export function lastDayOf(month: string) { const [y, m] = month.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); }
export function monthsBetween(from: string, to: string) {
  const out: string[] = [];
  let [y, m] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  while ((y < ty || (y === ty && m <= tm)) && out.length < 120) { out.push(`${y}-${String(m).padStart(2, '0')}`); m++; if (m > 12) { m = 1; y++; } }
  return out;
}
