import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { publicPortal } from '../data/portal-data';
import type { Campaign, PortalSnapshot } from '../data/portal-data';
import type { FieldLog } from '../data/field-data';
import { openNetwork } from './network/db';
import { openBakeries } from './network/bakeries';
import { openOutreach } from './outreach';
export type PortalStore = ReturnType<typeof openStore>;
const hours = 8 * 60 * 60 * 1000;
export function digest(value: string) { return createHash('sha256').update(value).digest('hex'); }
export function passwordHash(password: string, salt: string) { return scryptSync(password, salt, 64).toString('hex'); }
export function verifyPassword(password: string, salt: string, hash: string) { const value = Buffer.from(passwordHash(password, salt), 'hex'); const expected = Buffer.from(hash, 'hex'); return value.length === expected.length && timingSafeEqual(value, expected); }
export function openStore(filename: string, enableSample = true) {
  if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(filename);
  db.exec(`PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS clinics (id TEXT PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, clinic_id TEXT NOT NULL REFERENCES clinics(id), email TEXT NOT NULL UNIQUE, hash TEXT NOT NULL, salt TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS campaigns (id TEXT NOT NULL, clinic_id TEXT NOT NULL REFERENCES clinics(id), name TEXT NOT NULL, period TEXT NOT NULL, locations TEXT NOT NULL, leads TEXT NOT NULL, position INTEGER NOT NULL, PRIMARY KEY(id,clinic_id));
    CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS attempts (bucket TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS seeds (id TEXT PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS field_logs (clinic_id TEXT PRIMARY KEY REFERENCES clinics(id), feed TEXT NOT NULL, updated_at INTEGER NOT NULL);
    -- WHAT THE STAFF MEMBER WROTE ABOUT A BUSINESS THEY VISITED, and whether they want it on the
    -- next round. Keyed by the clinic and the business from that clinic's own field log, so one
    -- practice's notes are unreachable from another's session.
    CREATE TABLE IF NOT EXISTS visit_notes (clinic_id TEXT NOT NULL REFERENCES clinics(id), business_id TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', next_round INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL, PRIMARY KEY (clinic_id, business_id));
    CREATE INDEX IF NOT EXISTS sessions_expiration ON sessions(expires_at);
  `);
  // The Network Map's own tables. Additive: every statement is CREATE ... IF NOT EXISTS, so an
  // existing database keeps its clinics, users, campaigns and sessions untouched.
  // WHICH SERVICE THE PRACTICE BUYS, on the account itself rather than anywhere the browser
  // can reach. 'a' is the full service, where our drivers run the routes. 'b' is the portal on
  // its own, where the practice's own staff do the visits. Existing clinics are 'a', which is
  // what every account was before this column existed.
  //
  // ADD COLUMN is not idempotent the way CREATE TABLE IF NOT EXISTS is, so it is asked for only
  // when the column is genuinely missing.
  const clinicColumns = (db.prepare('PRAGMA table_info(clinics)').all() as Array<{ name: string }>).map(c => c.name);
  if (!clinicColumns.includes('plan')) db.exec("ALTER TABLE clinics ADD COLUMN plan TEXT NOT NULL DEFAULT 'a'");
  // A DEMO ACCOUNT. Its figures are illustrative and the portal says so on every screen. The
  // flag lives on the clinic, so a real client can never be turned into one from the browser
  // and a demo's numbers can never be read as somebody's results.
  if (!clinicColumns.includes('demo')) db.exec('ALTER TABLE clinics ADD COLUMN demo INTEGER NOT NULL DEFAULT 0');
  // WHO IS SIGNED IN, as distinct from which practice they work for. A clinic account is the
  // practice; a staff account is a person at it. `staff_id` ties that person to the driver in
  // the clinic's own field log, which is how the portal knows which rounds are theirs. Both are
  // optional: an account created before this reads as the practice, exactly as it did.
  const userColumns = (db.prepare('PRAGMA table_info(users)').all() as Array<{ name: string }>).map(c => c.name);
  if (!userColumns.includes('display_name')) db.exec("ALTER TABLE users ADD COLUMN display_name TEXT NOT NULL DEFAULT ''");
  if (!userColumns.includes('staff_id')) db.exec('ALTER TABLE users ADD COLUMN staff_id TEXT');

  // WHETHER A ROW IS ILLUSTRATIVE. Nullable with no default: an existing row reads NULL,
  // meaning nobody has said, and the activate-live command refuses to delete what nobody has
  // labelled rather than deciding for itself which records are fictional.
  for (const [table, column] of [['campaigns', 'demo'], ['field_logs', 'demo'], ['visit_notes', 'demo']] as const) {
    const columns = (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(c => c.name);
    if (!columns.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} INTEGER`);
  }

  const network = openNetwork(db);
  const bakeries = openBakeries(db);
  // The released businesses, their scripts and the visits recorded against them.
  const outreach = openOutreach(db);
  // The owner sets the username and the password. The only rule left is that neither is empty:
  // length and format are the owner's call. What protects the account is the scrypt hash and the
  // rate limit below, not a character count.
  function createClient(clinicId: string, name: string, username: string, password: string, plan: 'a' | 'b' = 'a', demo = false, user: { displayName?: string; staffId?: string } = {}) {
    if (!username.trim()) throw new Error('A username is required.');
    if (!password) throw new Error('A password is required.');
    const salt = randomBytes(24).toString('hex');
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('INSERT OR IGNORE INTO clinics (id,name,plan,demo) VALUES (?,?,?,?)').run(clinicId, name, plan, demo ? 1 : 0);
      // A second account on an existing clinic must not quietly change what that clinic buys.
      db.prepare('UPDATE clinics SET plan=? WHERE id=? AND plan IS NULL').run(plan, clinicId);
      db.prepare('INSERT INTO users (id,clinic_id,email,hash,salt,display_name,staff_id) VALUES (?,?,?,?,?,?,?)')
        .run(randomBytes(16).toString('hex'), clinicId, username.trim().toLowerCase(), passwordHash(password, salt), salt,
             (user.displayName ?? '').trim(), user.staffId?.trim() || null);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  /** Is this an illustrative account? Read from the clinic row, never from a request. */
  function isDemoClinic(clinicId: string) {
    return (db.prepare('SELECT demo FROM clinics WHERE id=?').get(clinicId) as { demo: number } | undefined)?.demo === 1;
  }
  function saveCampaigns(clinicId: string, values: Campaign[], demo = false) {
    if (!db.prepare('SELECT id FROM clinics WHERE id=?').get(clinicId)) throw new Error('Create this clinic first.');
    db.exec('BEGIN IMMEDIATE');
    try {
      values.forEach((value, position) => db.prepare(`INSERT INTO campaigns (id,clinic_id,name,period,locations,leads,position,demo) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id,clinic_id) DO UPDATE SET name=excluded.name,period=excluded.period,locations=excluded.locations,leads=excluded.leads,position=excluded.position,demo=excluded.demo`).run(value.id, clinicId, value.name, value.period, JSON.stringify(value.locations), JSON.stringify(value.leads), position, demo ? 1 : 0));
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  // One field log per clinic, replaced whole on each import: the Google Form sheet is the record.
  function saveFieldLog(clinicId: string, value: FieldLog, demo = false) {
    if (!db.prepare('SELECT id FROM clinics WHERE id=?').get(clinicId)) throw new Error('Create this clinic first.');
    db.prepare('INSERT INTO field_logs (clinic_id,feed,updated_at,demo) VALUES (?,?,?,?) ON CONFLICT(clinic_id) DO UPDATE SET feed=excluded.feed,updated_at=excluded.updated_at,demo=excluded.demo').run(clinicId, JSON.stringify(value), Date.now(), demo ? 1 : 0);
  }
  /** Every note this clinic has written, newest wins. Scoped to the clinic, always. */
  function visitNotes(clinicId: string) {
    return db.prepare('SELECT business_id,note,next_round FROM visit_notes WHERE clinic_id=?').all(clinicId)
      .map(row => { const r = row as { business_id: string; note: string; next_round: number };
        return { businessId: r.business_id, note: r.note, nextRound: r.next_round === 1 }; });
  }
  /**
   * Save one note. The business must appear in this clinic's own field log: without that check
   * a signed-in client could write a note against any id it cared to send.
   */
  function saveVisitNote(clinicId: string, businessId: string, note: string, nextRound: boolean) {
    const log = fieldLog(clinicId);
    const known = log?.routes.some(route => route.stops.some(stop => stop.businessId === businessId));
    if (!known) throw new Error('That business is not on this clinic’s field log.');
    db.prepare(`INSERT INTO visit_notes (clinic_id,business_id,note,next_round,updated_at) VALUES (?,?,?,?,?)
      ON CONFLICT(clinic_id,business_id) DO UPDATE SET note=excluded.note,next_round=excluded.next_round,updated_at=excluded.updated_at`)
      .run(clinicId, businessId, note.slice(0, 2000), nextRound ? 1 : 0, Date.now());
    return visitNotes(clinicId);
  }
  function fieldLog(clinicId: string): FieldLog | null {
    const row = db.prepare('SELECT feed FROM field_logs WHERE clinic_id=?').get(clinicId) as { feed: string } | undefined;
    return row ? JSON.parse(row.feed) : null;
  }
  // The live build seeds nothing. Accounts are made with scripts/create-client.ts and campaigns
  // with scripts/import-campaigns.ts. There is no sample clinic in this build to seed.
  function session(token: string | undefined) {
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
    const value = db.prepare('SELECT c.id,c.name,c.plan,c.demo,u.email,u.display_name,u.staff_id FROM sessions s JOIN users u ON u.id=s.user_id JOIN clinics c ON c.id=u.clinic_id WHERE s.token_hash=? AND s.expires_at>?').get(digest(token), Date.now()) as {id: string; name: string; plan: string; demo: number; email: string; display_name: string; staff_id: string | null} | undefined;
    return value ?? null;
  }
  function snapshot(token: string | undefined): PortalSnapshot {
    const clinic = session(token);
    const config = publicPortal(enableSample);
    const base = { config, today: new Date().toISOString().slice(0, 10) };
    if (!clinic) return { ...base, clinic: null, campaigns: [] };
    const values = db.prepare('SELECT id,name,period,locations,leads FROM campaigns WHERE clinic_id=? ORDER BY position').all(clinic.id) as Array<{id: string;name: string;period: string;locations: string;leads: string}>;
    return { ...base, clinic: { id: clinic.id, name: clinic.name, plan: clinic.plan === 'b' ? 'b' : 'a', demo: clinic.demo === 1 },
      user: { name: clinic.display_name || null, staffId: clinic.staff_id || null }, campaigns: values.map(row => ({ id: row.id, name: row.name, period: row.period, locations: JSON.parse(row.locations), leads: JSON.parse(row.leads) })) };
  }
  function signIn(username: string, password: string, ip: string, previousToken?: string) {
    const now = Date.now();
    db.prepare('DELETE FROM attempts WHERE expires_at<?').run(now);
    const count = db.prepare('INSERT INTO attempts (bucket,count,expires_at) VALUES (?,1,?) ON CONFLICT(bucket) DO UPDATE SET count=count+1 RETURNING count');
    const ipCount = count.get(digest('ip:' + ip), now + 900000) as {count: number};
    const emailCount = count.get(digest('user:' + username), now + 900000) as {count: number};
    if (ipCount.count > 12 || emailCount.count > 12) return { ok: false as const, message: 'Too many attempts. Please wait 15 minutes and try again.' };
    const user = db.prepare('SELECT id,email,hash,salt FROM users WHERE email=?').get(username.trim().toLowerCase()) as {id: string;email: string;hash: string;salt: string} | undefined;
    const valid = verifyPassword(password, user?.salt ?? 'unknown-user-padding', user?.hash ?? '00'.repeat(64));
    if (!user || !valid) return { ok: false as const, message: "Those details didn't match. Please check your username and password and try again." };
    const token = randomBytes(32).toString('hex');
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('DELETE FROM sessions WHERE token_hash=? OR expires_at<=?').run(previousToken ? digest(previousToken) : '', now);
      db.prepare('INSERT INTO sessions (token_hash,user_id,expires_at) VALUES (?,?,?)').run(digest(token), user.id, now + hours);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    return { ok: true as const, token, message: '' };
  }
  function signOut(token?: string) { if (token) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(digest(token)); }
  // `clinicFromToken` is how every Network Map endpoint learns which clinic is asking. It is
  // the session row and nothing else: there is no code path that takes a clinic from a request.
  return { db, snapshot, signIn, signOut, createClient, isDemoClinic, saveCampaigns, saveFieldLog, fieldLog, visitNotes, saveVisitNote, clinicFromToken: session, ...network, ...bakeries, outreach, close: () => db.close() };
}
