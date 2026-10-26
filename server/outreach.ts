// OUTREACH: the real businesses a practice has been given, what to say at each one, and what
// happened when somebody went.
//
// Everything here is scoped to one clinic. A business belongs to the practice it was released
// to and to nothing else: every read takes a clinic id resolved from the session cookie, and
// there is no function that returns a business without one. A practice that has not been given
// a business cannot see that it exists.
//
// Businesses arrive in RELEASES rather than all at once. A release is a named batch, recorded
// with when it happened and who did it, so "which businesses does this client have, and since
// when" is a question the database answers rather than a thing somebody remembers. Re-running
// the same release is a no-op — the unique key is the clinic plus the business's name and
// address, so a second run updates the details it was given and creates nothing.
//
// Nothing in this file invents a business, a coordinate, a visit or a status. A business starts
// as 'new' and only moves when a staff member records a real conversation.
import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';

/** Where a relationship has got to. Only a recorded visit moves it off 'new'. */
export const STAGES = ['new', 'visited', 'interested', 'partner', 'follow-up', 'declined'] as const;
export type Stage = (typeof STAGES)[number];

/** What a staff member can record at the end of a visit, and where each one leaves the business. */
export const OUTCOMES = {
  interested: { label: 'Interested', stage: 'interested' },
  partner: { label: 'Partnership established', stage: 'partner' },
  'follow-up': { label: 'Follow-up required', stage: 'follow-up' },
  declined: { label: 'Not interested', stage: 'declined' },
  unavailable: { label: 'Decision-maker unavailable', stage: 'follow-up' },
  closed: { label: 'Business closed', stage: 'declined' },
  materials: { label: 'Materials dropped only', stage: 'visited' },
} as const satisfies Record<string, { label: string; stage: Stage }>;
export type Outcome = keyof typeof OUTCOMES;

/** A visit script. Sections, not one block of prose: a person reads the part they are at. */
export type Script = {
  opening: string;
  introduction: string;
  value: string;
  ask: string;
  objections: { busy: string; notInterested: string; alreadyPartnered: string };
  closing: string;
  followUp: string;
};

export type Business = {
  id: string; name: string; category: string; address: string;
  phone: string; website: string; talkingPoint: string;
  stage: Stage; releaseId: string; releasedAt: number;
  lat: number | null; lng: number | null;
};

export type Visit = {
  id: string; businessId: string; businessName: string; staff: string; visitedOn: string;
  spokeWith: string; contactRole: string; outcome: Outcome; outcomeLabel: string;
  materials: number; note: string; nextAction: string; followUpOn: string | null;
  createdAt: number; edited: boolean;
};

export type ReleaseEntry = {
  name: string; category: string; address: string;
  phone?: string; website?: string; talkingPoint?: string;
  lat?: number | null; lng?: number | null; script: Script;
};

type BusinessRow = {
  id: string; name: string; category: string; address: string; phone: string; website: string;
  talking_point: string; stage: string; release_id: string; released_at: number;
  lat: number | null; lng: number | null;
};

type VisitRow = {
  id: string; business_id: string; business_name: string; staff: string; visited_on: string;
  spoke_with: string; contact_role: string; outcome: string; materials: number; note: string;
  next_action: string; follow_up_on: string | null; created_at: number; edits: number;
};

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS releases (
     id TEXT PRIMARY KEY,
     clinic_id TEXT NOT NULL REFERENCES clinics(id),
     name TEXT NOT NULL,
     released_at INTEGER NOT NULL,
     released_by TEXT NOT NULL,
     size INTEGER NOT NULL)`,
  // No coordinate is invented. Where one is unknown it stays null and the portal routes by the
  // verified street address, which is what a person would type into Maps anyway.
  `CREATE TABLE IF NOT EXISTS businesses (
     id TEXT PRIMARY KEY,
     clinic_id TEXT NOT NULL REFERENCES clinics(id),
     name TEXT NOT NULL,
     category TEXT NOT NULL,
     address TEXT NOT NULL,
     phone TEXT NOT NULL DEFAULT '',
     website TEXT NOT NULL DEFAULT '',
     talking_point TEXT NOT NULL DEFAULT '',
     lat REAL, lng REAL,
     stage TEXT NOT NULL DEFAULT 'new',
     release_id TEXT NOT NULL REFERENCES releases(id),
     released_at INTEGER NOT NULL,
     UNIQUE (clinic_id, name, address))`,
  `CREATE INDEX IF NOT EXISTS businesses_by_clinic ON businesses(clinic_id)`,
  // 'edited' marks a script a person has rewritten, so a later release never silently replaces
  // somebody's own words.
  `CREATE TABLE IF NOT EXISTS visit_scripts (
     business_id TEXT PRIMARY KEY REFERENCES businesses(id) ON DELETE CASCADE,
     clinic_id TEXT NOT NULL REFERENCES clinics(id),
     body TEXT NOT NULL,
     edited INTEGER NOT NULL DEFAULT 0,
     updated_at INTEGER NOT NULL)`,
  // A recorded visit. An edit writes the old row into visit_edits first, so a correction stays
  // visible as a correction rather than as the truth having quietly changed.
  `CREATE TABLE IF NOT EXISTS visits (
     id TEXT PRIMARY KEY,
     clinic_id TEXT NOT NULL REFERENCES clinics(id),
     business_id TEXT NOT NULL REFERENCES businesses(id),
     staff TEXT NOT NULL DEFAULT '',
     visited_on TEXT NOT NULL,
     spoke_with TEXT NOT NULL DEFAULT '',
     contact_role TEXT NOT NULL DEFAULT '',
     outcome TEXT NOT NULL,
     materials INTEGER NOT NULL DEFAULT 0,
     note TEXT NOT NULL DEFAULT '',
     next_action TEXT NOT NULL DEFAULT '',
     follow_up_on TEXT,
     created_at INTEGER NOT NULL,
     edits INTEGER NOT NULL DEFAULT 0)`,
  `CREATE INDEX IF NOT EXISTS visits_by_business ON visits(clinic_id, business_id)`,
  `CREATE TABLE IF NOT EXISTS visit_edits (
     id TEXT PRIMARY KEY,
     visit_id TEXT NOT NULL REFERENCES visits(id),
     clinic_id TEXT NOT NULL REFERENCES clinics(id),
     was TEXT NOT NULL,
     edited_by TEXT NOT NULL DEFAULT '',
     edited_at INTEGER NOT NULL)`,
].join(';\n');

const now = () => Date.now();
const asStage = (value: string): Stage =>
  (STAGES as readonly string[]).includes(value) ? value as Stage : 'new';

export function openOutreach(db: DatabaseSync) {
  db.exec(SCHEMA);

  // Transactions are run as statements rather than through exec so the whole file keeps one way
  // of talking to the database.
  const begin = () => { db.prepare('BEGIN').run(); };
  const commit = () => { db.prepare('COMMIT').run(); };
  const rollback = () => { db.prepare('ROLLBACK').run(); };

  const BUSINESS_COLUMNS = `id,name,category,address,phone,website,talking_point,stage,release_id,released_at,lat,lng`;

  const toBusiness = (r: BusinessRow): Business => ({
    id: r.id, name: r.name, category: r.category, address: r.address, phone: r.phone,
    website: r.website, talkingPoint: r.talking_point, stage: asStage(r.stage),
    releaseId: r.release_id, releasedAt: r.released_at, lat: r.lat, lng: r.lng,
  });

  const toVisit = (r: VisitRow): Visit => ({
    id: r.id, businessId: r.business_id, businessName: r.business_name, staff: r.staff,
    visitedOn: r.visited_on, spokeWith: r.spoke_with, contactRole: r.contact_role,
    outcome: r.outcome as Outcome, outcomeLabel: OUTCOMES[r.outcome as Outcome]?.label ?? r.outcome,
    materials: r.materials, note: r.note, nextAction: r.next_action,
    followUpOn: r.follow_up_on, createdAt: r.created_at, edited: r.edits > 0,
  });

  /**
   * Every business this practice has been released, newest release first. The clinic id comes
   * from the caller's session; there is deliberately no way to ask for another practice's.
   */
  function businesses(clinicId: string): Business[] {
    const rows = db.prepare(`SELECT ${BUSINESS_COLUMNS} FROM businesses WHERE clinic_id=?
      ORDER BY released_at DESC, name ASC`).all(clinicId) as BusinessRow[];
    return rows.map(toBusiness);
  }

  function business(clinicId: string, id: string): Business | null {
    const row = db.prepare(`SELECT ${BUSINESS_COLUMNS} FROM businesses WHERE clinic_id=? AND id=?`)
      .get(clinicId, id) as BusinessRow | undefined;
    return row ? toBusiness(row) : null;
  }

  function script(clinicId: string, businessId: string): { script: Script; edited: boolean } | null {
    const row = db.prepare('SELECT body,edited FROM visit_scripts WHERE clinic_id=? AND business_id=?')
      .get(clinicId, businessId) as { body: string; edited: number } | undefined;
    return row ? { script: JSON.parse(row.body) as Script, edited: row.edited === 1 } : null;
  }

  function saveScript(clinicId: string, businessId: string, body: Script) {
    if (!business(clinicId, businessId)) throw new Error('That business is not on your list.');
    db.prepare(`INSERT INTO visit_scripts (business_id,clinic_id,body,edited,updated_at) VALUES (?,?,?,1,?)
      ON CONFLICT(business_id) DO UPDATE SET body=excluded.body, edited=1, updated_at=excluded.updated_at`)
      .run(businessId, clinicId, JSON.stringify(body), now());
    return script(clinicId, businessId);
  }

  /** Visits, newest first. With a business id, that relationship in order; without, the log. */
  function visits(clinicId: string, businessId?: string): Visit[] {
    const where = businessId ? 'WHERE v.clinic_id=? AND v.business_id=?' : 'WHERE v.clinic_id=?';
    const sql = `SELECT v.id,v.business_id,b.name AS business_name,v.staff,v.visited_on,v.spoke_with,
        v.contact_role,v.outcome,v.materials,v.note,v.next_action,v.follow_up_on,v.created_at,v.edits
      FROM visits v JOIN businesses b ON b.id=v.business_id
      ${where} ORDER BY v.visited_on DESC, v.created_at DESC`;
    const rows = (businessId
      ? db.prepare(sql).all(clinicId, businessId)
      : db.prepare(sql).all(clinicId)) as VisitRow[];
    return rows.map(toVisit);
  }

  /**
   * Record one visit and move the business on. Both happen or neither does: a visit saved
   * without its business moving leaves two screens disagreeing about the same conversation.
   *
   * `clientRef` is the caller's own id for this submission. Sending it twice — a double tap, a
   * retried request on a bad signal — returns the first visit rather than writing a second one.
   */
  function recordVisit(clinicId: string, input: {
    businessId: string; staff: string; visitedOn: string; spokeWith: string; contactRole: string;
    outcome: Outcome; materials: number; note: string; nextAction: string; followUpOn: string | null;
    clientRef?: string;
  }): { visit: Visit; business: Business } {
    const target = business(clinicId, input.businessId);
    if (!target) throw new Error('That business is not on your list.');
    if (!OUTCOMES[input.outcome]) throw new Error('That is not an outcome we record.');

    const id = input.clientRef ? `v_${input.clientRef}` : `v_${randomUUID()}`;
    const already = db.prepare('SELECT id FROM visits WHERE id=? AND clinic_id=?').get(id, clinicId);
    if (already) {
      return { visit: visits(clinicId, input.businessId).find(v => v.id === id)!, business: target };
    }

    begin();
    try {
      db.prepare(`INSERT INTO visits (id,clinic_id,business_id,staff,visited_on,spoke_with,contact_role,
          outcome,materials,note,next_action,follow_up_on,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(id, clinicId, input.businessId, input.staff, input.visitedOn, input.spokeWith,
          input.contactRole, input.outcome, Math.max(0, Math.trunc(input.materials)), input.note,
          input.nextAction, input.followUpOn, now());
      db.prepare('UPDATE businesses SET stage=? WHERE id=? AND clinic_id=?')
        .run(OUTCOMES[input.outcome].stage, input.businessId, clinicId);
      commit();
    } catch (error) { rollback(); throw error; }

    return {
      visit: visits(clinicId, input.businessId).find(v => v.id === id)!,
      business: business(clinicId, input.businessId)!,
    };
  }

  /** Correct a visit, keeping what it said before. */
  function editVisit(clinicId: string, visitId: string, patch: Partial<{
    spokeWith: string; contactRole: string; outcome: Outcome; materials: number;
    note: string; nextAction: string; followUpOn: string | null;
  }>, editedBy: string) {
    const was = db.prepare('SELECT * FROM visits WHERE id=? AND clinic_id=?').get(visitId, clinicId);
    if (!was) throw new Error('That visit is not yours to edit.');
    const row = was as unknown as VisitRow;
    const outcome = patch.outcome ?? (row.outcome as Outcome);
    if (!OUTCOMES[outcome]) throw new Error('That is not an outcome we record.');

    begin();
    try {
      db.prepare('INSERT INTO visit_edits (id,visit_id,clinic_id,was,edited_by,edited_at) VALUES (?,?,?,?,?,?)')
        .run(randomUUID(), visitId, clinicId, JSON.stringify(was), editedBy, now());
      db.prepare(`UPDATE visits SET spoke_with=?, contact_role=?, outcome=?, materials=?, note=?,
          next_action=?, follow_up_on=?, edits=edits+1 WHERE id=? AND clinic_id=?`)
        .run(patch.spokeWith ?? row.spoke_with, patch.contactRole ?? row.contact_role, outcome,
          Math.max(0, Math.trunc(patch.materials ?? row.materials)), patch.note ?? row.note,
          patch.nextAction ?? row.next_action,
          patch.followUpOn === undefined ? row.follow_up_on : patch.followUpOn, visitId, clinicId);
      db.prepare('UPDATE businesses SET stage=? WHERE id=? AND clinic_id=?')
        .run(OUTCOMES[outcome].stage, row.business_id, clinicId);
      commit();
    } catch (error) { rollback(); throw error; }
    return visits(clinicId, row.business_id).find(v => v.id === visitId)!;
  }

  /**
   * Put a batch of verified businesses on a practice's list. Idempotent on (clinic, name,
   * address): running it again updates the details and adds nothing, so a release cannot be
   * doubled by running the command twice.
   *
   * A script somebody has edited is left alone. A release does not overwrite a person.
   */
  function release(clinicId: string, releaseId: string, releaseName: string, releasedBy: string,
    entries: ReleaseEntry[]) {
    const stamp = now();
    const added: string[] = [], updated: string[] = [], keptScript: string[] = [];

    begin();
    try {
      db.prepare(`INSERT INTO releases (id,clinic_id,name,released_at,released_by,size) VALUES (?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET name=excluded.name, size=excluded.size`)
        .run(releaseId, clinicId, releaseName, stamp, releasedBy, entries.length);

      for (const entry of entries) {
        const existing = db.prepare('SELECT id FROM businesses WHERE clinic_id=? AND name=? AND address=?')
          .get(clinicId, entry.name, entry.address) as { id: string } | undefined;
        const id = existing?.id ?? `b_${randomUUID()}`;

        if (existing) {
          db.prepare(`UPDATE businesses SET category=?, phone=?, website=?, talking_point=?, lat=?, lng=?
            WHERE id=? AND clinic_id=?`)
            .run(entry.category, entry.phone ?? '', entry.website ?? '', entry.talkingPoint ?? '',
              entry.lat ?? null, entry.lng ?? null, id, clinicId);
          updated.push(entry.name);
        } else {
          db.prepare(`INSERT INTO businesses (id,clinic_id,name,category,address,phone,website,
              talking_point,lat,lng,stage,release_id,released_at) VALUES (?,?,?,?,?,?,?,?,?,?,'new',?,?)`)
            .run(id, clinicId, entry.name, entry.category, entry.address, entry.phone ?? '',
              entry.website ?? '', entry.talkingPoint ?? '', entry.lat ?? null, entry.lng ?? null,
              releaseId, stamp);
          added.push(entry.name);
        }

        const current = db.prepare('SELECT edited FROM visit_scripts WHERE business_id=?')
          .get(id) as { edited: number } | undefined;
        if (current?.edited === 1) { keptScript.push(entry.name); continue; }
        db.prepare(`INSERT INTO visit_scripts (business_id,clinic_id,body,edited,updated_at) VALUES (?,?,?,0,?)
          ON CONFLICT(business_id) DO UPDATE SET body=excluded.body, updated_at=excluded.updated_at`)
          .run(id, clinicId, JSON.stringify(entry.script), stamp);
      }
      commit();
    } catch (error) { rollback(); throw error; }

    return { added, updated, keptScript, total: entries.length };
  }

  function releases(clinicId: string) {
    return db.prepare(`SELECT id,name,released_at,released_by,size FROM releases
      WHERE clinic_id=? ORDER BY released_at DESC`).all(clinicId) as Array<{
        id: string; name: string; released_at: number; released_by: string; size: number }>;
  }

  return { businesses, business, script, saveScript, visits, recordVisit, editVisit, release, releases };
}
