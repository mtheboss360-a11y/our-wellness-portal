import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { publicPortal } from '../data/portal-data';
import type { Campaign, PortalSnapshot } from '../data/portal-data';
import { migratePartners, createPartnerStore } from './partner-store';
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
    CREATE INDEX IF NOT EXISTS sessions_expiration ON sessions(expires_at);
  `);
  // The partner network lives in its own tables (server/partner-store.ts). They are only ever added, never changed
  // here, so an existing database picks them up on the next start without touching clinic data.
  migratePartners(db);
  // The owner sets the username and the password. The only rule left is that neither is empty:
  // length and format are the owner's call. What protects the account is the scrypt hash and the
  // rate limit below, not a character count.
  function createClient(clinicId: string, name: string, username: string, password: string) {
    if (!username.trim()) throw new Error('A username is required.');
    if (!password) throw new Error('A password is required.');
    const salt = randomBytes(24).toString('hex');
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('INSERT OR IGNORE INTO clinics (id,name) VALUES (?,?)').run(clinicId, name);
      db.prepare('INSERT INTO users (id,clinic_id,email,hash,salt) VALUES (?,?,?,?,?)').run(randomBytes(16).toString('hex'), clinicId, username.trim().toLowerCase(), passwordHash(password, salt), salt);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  function saveCampaigns(clinicId: string, values: Campaign[]) {
    if (!db.prepare('SELECT id FROM clinics WHERE id=?').get(clinicId)) throw new Error('Create this clinic first.');
    db.exec('BEGIN IMMEDIATE');
    try {
      values.forEach((value, position) => db.prepare(`INSERT INTO campaigns (id,clinic_id,name,period,locations,leads,position) VALUES (?,?,?,?,?,?,?) ON CONFLICT(id,clinic_id) DO UPDATE SET name=excluded.name,period=excluded.period,locations=excluded.locations,leads=excluded.leads,position=excluded.position`).run(value.id, clinicId, value.name, value.period, JSON.stringify(value.locations), JSON.stringify(value.leads), position));
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  // The live build seeds nothing. Accounts are made with scripts/create-client.ts and campaigns
  // with scripts/import-campaigns.ts. There is no sample clinic in this build to seed.
  function session(token: string | undefined) {
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
    const value = db.prepare('SELECT c.id,c.name,u.email FROM sessions s JOIN users u ON u.id=s.user_id JOIN clinics c ON c.id=u.clinic_id WHERE s.token_hash=? AND s.expires_at>?').get(digest(token), Date.now()) as {id: string; name: string; email: string} | undefined;
    return value ?? null;
  }
  function snapshot(token: string | undefined): PortalSnapshot {
    const clinic = session(token);
    const config = publicPortal(enableSample);
    const base = { config, today: new Date().toISOString().slice(0, 10) };
    if (!clinic) return { ...base, clinic: null, campaigns: [] };
    const values = db.prepare('SELECT id,name,period,locations,leads FROM campaigns WHERE clinic_id=? ORDER BY position').all(clinic.id) as Array<{id: string;name: string;period: string;locations: string;leads: string}>;
    return { ...base, clinic: { id: clinic.id, name: clinic.name }, campaigns: values.map(row => ({ id: row.id, name: row.name, period: row.period, locations: JSON.parse(row.locations), leads: JSON.parse(row.leads) })) };
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
  return { db, snapshot, signIn, signOut, createClient, saveCampaigns, partners: createPartnerStore(db), close: () => db.close() };
}
