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
  /** Google's own id for this place. Durable; the coordinates beside it are not. */
  placeId: string | null;
  /** When the coordinates were fetched, so a stale pair can be refused rather than used. */
  geoAt: number | null;
  /** Google's types for this place, as the map's category rules expect them. */
  types: string[];
  primaryType: string | null;
  /** 1 illustrative, 0 real, null nobody has said. */
  demo: number | null;
};

export type Visit = {
  id: string; businessId: string; businessName: string; staff: string; visitedOn: string;
  spokeWith: string; contactRole: string; outcome: Outcome; outcomeLabel: string;
  materials: number; note: string; nextAction: string; followUpOn: string | null;
  createdAt: number; edited: boolean;
  /** The round this visit was recorded against, where the screen said which. Null for every
      visit recorded before a round could be named, and for one recorded off a round. */
  roundId: string | null;
  /** The login that recorded it. Null for the same reason: nothing is attributed backwards. */
  recordedBy: string | null;
  /** What was dropped, by kind, where it was counted that way. Null where only a total exists. */
  dropped: Materials | null;
};

/** Materials, counted by kind. The total on the visit is the sum of these three. */
export type Materials = { flyers: number; treats: number; cards: number };

export type ReleaseEntry = {
  name: string; category: string; address: string;
  phone?: string; website?: string; talkingPoint?: string;
  lat?: number | null; lng?: number | null; script: Script;
};

type BusinessRow = {
  id: string; name: string; category: string; address: string; phone: string; website: string;
  talking_point: string; stage: string; release_id: string; released_at: number;
  lat: number | null; lng: number | null; place_id: string | null;
  geo_at: number | null; demo: number | null; types: string | null;
};

type VisitRow = {
  id: string; business_id: string; business_name: string; staff: string; visited_on: string;
  spoke_with: string; contact_role: string; outcome: string; materials: number; note: string;
  next_action: string; follow_up_on: string | null; created_at: number; edits: number;
  round_id: string | null; recorded_by: string | null;
  flyers: number | null; treats: number | null; cards: number | null;
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
  // MATERIALS DROPPED, split by kind. `visits.materials` stays the authoritative total and is
  // written as the sum of these three, in the same transaction as the visit, so the total and
  // its parts cannot disagree and a half-written visit cannot exist.
  `CREATE TABLE IF NOT EXISTS visit_materials (
     visit_id TEXT PRIMARY KEY REFERENCES visits(id) ON DELETE CASCADE,
     clinic_id TEXT NOT NULL REFERENCES clinics(id),
     round_id TEXT,
     flyers INTEGER NOT NULL DEFAULT 0,
     treats INTEGER NOT NULL DEFAULT 0,
     cards INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS visit_edits (
     id TEXT PRIMARY KEY,
     visit_id TEXT NOT NULL REFERENCES visits(id),
     clinic_id TEXT NOT NULL REFERENCES clinics(id),
     was TEXT NOT NULL,
     edited_by TEXT NOT NULL DEFAULT '',
     edited_at INTEGER NOT NULL)`,
  // A ROUND: a day's work, an ordered list of released businesses, assigned to one person.
  // Stops reference businesses, so a round can never contain somebody a practice was not given.
  `CREATE TABLE IF NOT EXISTS rounds (
     id TEXT PRIMARY KEY,
     clinic_id TEXT NOT NULL REFERENCES clinics(id),
     on_date TEXT NOT NULL,
     start_at TEXT NOT NULL DEFAULT '09:00',
     staff TEXT NOT NULL DEFAULT '',
     status TEXT NOT NULL DEFAULT 'scheduled',
     note TEXT NOT NULL DEFAULT '',
     demo INTEGER,
     created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS round_stops (
     round_id TEXT NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
     clinic_id TEXT NOT NULL REFERENCES clinics(id),
     business_id TEXT NOT NULL REFERENCES businesses(id),
     position INTEGER NOT NULL,
     PRIMARY KEY (round_id, business_id))`,
  `CREATE INDEX IF NOT EXISTS rounds_by_clinic ON rounds(clinic_id, on_date)`,
].join(';\n');

const now = () => Date.now();
/** A quantity as the database will hold it: a whole number, never negative, never absurd. */
const count = (value: unknown) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(10000, Math.trunc(n))) : 0;
};
const asStage = (value: string): Stage =>
  (STAGES as readonly string[]).includes(value) ? value as Stage : 'new';

export function openOutreach(db: DatabaseSync) {
  db.exec(SCHEMA);

  // ADDITIVE COLUMNS. ADD COLUMN is not idempotent the way CREATE TABLE IF NOT EXISTS is, so
  // each is asked for only when genuinely missing.
  //
  // place_id / lat / lng / geo_at: Google's terms let a place ID be kept indefinitely but
  // coordinates only 30 days, which is the rule the network cache already follows. So the id is
  // the durable thing and the coordinates carry the moment they were fetched; anything older
  // than the window is re-fetched rather than served stale.
  //
  // demo: whether this row is illustrative. Deliberately NULLABLE with no default — a row
  // written before tagging existed reads as NULL, which means "nobody said", and
  // activate-live refuses to delete what nobody said is fictional rather than guessing.
  const add = (table: string, column: string, type: string) => {
    const columns = (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(c => c.name);
    if (!columns.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  };
  add('businesses', 'place_id', 'TEXT');
  add('businesses', 'geo_at', 'INTEGER');
  add('businesses', 'demo', 'INTEGER');
  // Google's own classification of the place, kept beside the coordinates and expiring with
  // them. Without it the referral map cannot categorise a business, and an uncategorised one
  // ranks below everything else — which is how five real businesses ended up off the bottom
  // of a list they were already in.
  add('businesses', 'types', 'TEXT');
  add('visits', 'demo', 'INTEGER');
  // WHICH ROUND, AND WHO. Both nullable with no default and no backfill: a visit recorded
  // before this existed cannot be attributed to a round or a person without guessing, and a
  // guess here would put somebody's name on work they may not have done.
  add('visits', 'round_id', 'TEXT');
  add('visits', 'recorded_by', 'TEXT');

  // Transactions are run as statements rather than through exec so the whole file keeps one way
  // of talking to the database.
  const begin = () => { db.prepare('BEGIN').run(); };
  const commit = () => { db.prepare('COMMIT').run(); };
  const rollback = () => { db.prepare('ROLLBACK').run(); };

  const BUSINESS_COLUMNS = `id,name,category,address,phone,website,talking_point,stage,release_id,released_at,lat,lng,place_id,geo_at,demo,types`;

  const toBusiness = (r: BusinessRow): Business => ({
    id: r.id, name: r.name, category: r.category, address: r.address, phone: r.phone,
    website: r.website, talkingPoint: r.talking_point, stage: asStage(r.stage),
    releaseId: r.release_id, releasedAt: r.released_at, lat: r.lat, lng: r.lng,
    placeId: r.place_id, geoAt: r.geo_at, demo: r.demo,
    ...(() => {
      const parsed = r.types ? JSON.parse(r.types) as { types?: string[]; primaryType?: string | null } : null;
      return { types: parsed?.types ?? [], primaryType: parsed?.primaryType ?? null };
    })(),
  });

  const toVisit = (r: VisitRow): Visit => ({
    id: r.id, businessId: r.business_id, businessName: r.business_name, staff: r.staff,
    visitedOn: r.visited_on, spokeWith: r.spoke_with, contactRole: r.contact_role,
    outcome: r.outcome as Outcome, outcomeLabel: OUTCOMES[r.outcome as Outcome]?.label ?? r.outcome,
    materials: r.materials, note: r.note, nextAction: r.next_action,
    followUpOn: r.follow_up_on, createdAt: r.created_at, edited: r.edits > 0,
    roundId: r.round_id, recordedBy: r.recorded_by,
    dropped: r.flyers === null && r.treats === null && r.cards === null
      ? null : { flyers: r.flyers ?? 0, treats: r.treats ?? 0, cards: r.cards ?? 0 },
  });

  const VISIT_COLUMNS = `v.id,v.business_id,b.name AS business_name,v.staff,v.visited_on,v.spoke_with,
        v.contact_role,v.outcome,v.materials,v.note,v.next_action,v.follow_up_on,v.created_at,v.edits,
        v.round_id,v.recorded_by,m.flyers,m.treats,m.cards`;
  const VISIT_FROM = `FROM visits v JOIN businesses b ON b.id=v.business_id
      LEFT JOIN visit_materials m ON m.visit_id=v.id`;

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
    const sql = `SELECT ${VISIT_COLUMNS} ${VISIT_FROM}
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
    /** The round this visit was recorded against. The caller has already checked it is theirs. */
    roundId?: string | null;
    /** The login recording it, so "my visits" means the ones this person actually recorded. */
    recordedBy?: string | null;
    /** Materials by kind. Where it is given, the total is its sum rather than anything sent. */
    dropped?: Materials | null;
  }): { visit: Visit; business: Business } {
    const target = business(clinicId, input.businessId);
    if (!target) throw new Error('That business is not on your list.');
    if (!OUTCOMES[input.outcome]) throw new Error('That is not an outcome we record.');

    const id = input.clientRef ? `v_${input.clientRef}` : `v_${randomUUID()}`;
    const already = db.prepare(`SELECT business_id,round_id,recorded_by FROM visits
      WHERE id=? AND clinic_id=?`).get(id, clinicId) as {
      business_id: string; round_id: string | null; recorded_by: string | null;
    } | undefined;
    if (already) {
      // A retry may reuse its reference, but may not use a saved reference to read another
      // person's visit or silently credit a different stop. Idempotency is scoped to the
      // original business, round and author; it is not a general lookup by clientRef.
      if (already.business_id !== input.businessId ||
          already.round_id !== (input.roundId ?? null) ||
          already.recorded_by !== (input.recordedBy ?? null)) {
        throw new Error('That submission reference has already been used for another visit.');
      }
      const prior = visits(clinicId, input.businessId).find(v => v.id === id);
      if (!prior) throw new Error('The earlier visit could not be retrieved.');
      return { visit: prior, business: target };
    }

    // THE TOTAL IS THE SUM OF ITS PARTS where the parts were counted. A caller cannot send a
    // total that disagrees with the breakdown it also sent.
    const dropped = input.dropped
      ? { flyers: count(input.dropped.flyers), treats: count(input.dropped.treats), cards: count(input.dropped.cards) }
      : null;
    const materials = dropped
      ? dropped.flyers + dropped.treats + dropped.cards
      : Math.max(0, Math.trunc(input.materials));

    begin();
    try {
      db.prepare(`INSERT INTO visits (id,clinic_id,business_id,staff,visited_on,spoke_with,contact_role,
          outcome,materials,note,next_action,follow_up_on,created_at,demo,round_id,recorded_by)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,0,?,?)`)
        .run(id, clinicId, input.businessId, input.staff, input.visitedOn, input.spokeWith,
          input.contactRole, input.outcome, materials, input.note,
          input.nextAction, input.followUpOn, now(), input.roundId ?? null, input.recordedBy ?? null);
      // The breakdown goes in with the visit, not after it: a visit that exists without the
      // counts behind it would leave the remaining-supplies figure wrong until somebody noticed.
      if (dropped) {
        db.prepare(`INSERT INTO visit_materials (visit_id,clinic_id,round_id,flyers,treats,cards)
          VALUES (?,?,?,?,?,?)`)
          .run(id, clinicId, input.roundId ?? null, dropped.flyers, dropped.treats, dropped.cards);
      }
      db.prepare('UPDATE businesses SET stage=? WHERE id=? AND clinic_id=?')
        .run(OUTCOMES[input.outcome].stage, input.businessId, clinicId);
      commit();
    } catch (error) { rollback(); throw error; }

    return {
      visit: visits(clinicId, input.businessId).find(v => v.id === id)!,
      business: business(clinicId, input.businessId)!,
    };
  }

  /**
   * THE VISITS ONE PERSON RECORDED. Not the visits recorded at businesses they happen to be
   * assigned — those are the practice's record and belong on the practice's screens. A visit
   * with no `recorded_by` predates the column and is nobody's until somebody says otherwise.
   */
  function visitsRecordedBy(clinicId: string, userId: string): Visit[] {
    const rows = db.prepare(`SELECT ${VISIT_COLUMNS} ${VISIT_FROM}
      WHERE v.clinic_id=? AND v.recorded_by=? ORDER BY v.visited_on DESC, v.created_at DESC`)
      .all(clinicId, userId) as VisitRow[];
    return rows.map(toVisit);
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
    entries: ReleaseEntry[], demo = false) {
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
              talking_point,lat,lng,stage,release_id,released_at,demo) VALUES (?,?,?,?,?,?,?,?,?,?,'new',?,?,?)`)
            .run(id, clinicId, entry.name, entry.category, entry.address, entry.phone ?? '',
              entry.website ?? '', entry.talkingPoint ?? '', entry.lat ?? null, entry.lng ?? null,
              releaseId, stamp, demo ? 1 : 0);
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

  /**
   * Record where a business actually is. The place id is kept indefinitely, the coordinates
   * are stamped so they can be refused once they are older than Google allows us to hold them.
   */
  function setLocation(clinicId: string, businessId: string, place: {
    placeId: string; lat: number; lng: number; types?: string[]; primaryType?: string | null;
  }, at = now()) {
    const changed = db.prepare('UPDATE businesses SET place_id=?, lat=?, lng=?, geo_at=?, types=? WHERE id=? AND clinic_id=?')
      .run(place.placeId, place.lat, place.lng, at,
        JSON.stringify({ types: place.types ?? [], primaryType: place.primaryType ?? null }),
        businessId, clinicId);
    if (!changed.changes) throw new Error('That business is not on your list.');
    return business(clinicId, businessId)!;
  }

  // ── ROUNDS ─────────────────────────────────────────────────────────────────

  /** One day's work: the stops in order, with everything the agenda needs to lay them out. */
  function rounds(clinicId: string) {
    // The runner is joined in so the office can see at a glance which rounds are still sitting
    // with nobody. `staff` is a name typed when the round was booked; `runner_id` is the login
    // that actually holds it, and only the second one puts it on somebody's planner.
    const rows = db.prepare(`SELECT r.id,r.on_date,r.start_at,r.staff,r.status,r.note,r.demo,r.runner_id,
        COALESCE(NULLIF(u.display_name,''),u.email,'') AS runner_name
      FROM rounds r LEFT JOIN users u ON u.id=r.runner_id
      WHERE r.clinic_id=? ORDER BY r.on_date DESC`).all(clinicId) as Array<{
        id: string; on_date: string; start_at: string; staff: string; status: string;
        note: string; demo: number | null; runner_id: string | null; runner_name: string }>;
    return rows.map(r => ({
      id: r.id, date: r.on_date, start: r.start_at, staff: r.staff,
      status: r.status as 'scheduled' | 'done' | 'draft', note: r.note, demo: r.demo,
      runnerId: r.runner_id, runnerName: r.runner_name,
      stops: (db.prepare(`SELECT ${BUSINESS_COLUMNS.split(',').map(c => 'b.' + c).join(',')}
          FROM round_stops s JOIN businesses b ON b.id=s.business_id
          WHERE s.round_id=? AND s.clinic_id=? ORDER BY s.position`)
        .all(r.id, clinicId) as BusinessRow[]).map(toBusiness),
    }));
  }

  /**
   * Book a round. Every business id has to be one of this practice's, checked one at a time
   * rather than trusted, and the whole round is written or none of it is.
   */
  function planRound(clinicId: string, input: {
    id?: string; date: string; start: string; staff: string; businessIds: string[];
    note?: string; demo?: boolean;
  }) {
    if (!input.businessIds.length) throw new Error('A round needs at least one stop.');
    const mine = new Set(businesses(clinicId).map(b => b.id));
    const strangers = input.businessIds.filter(id => !mine.has(id));
    if (strangers.length) throw new Error(`${strangers.length} of those businesses are not on your list.`);
    if (new Set(input.businessIds).size !== input.businessIds.length) throw new Error('The same business is on this round twice.');

    const id = input.id ?? `r_${randomUUID()}`;
    begin();
    try {
      db.prepare(`INSERT INTO rounds (id,clinic_id,on_date,start_at,staff,status,note,demo,created_at)
        VALUES (?,?,?,?,?,'scheduled',?,?,?)
        ON CONFLICT(id) DO UPDATE SET on_date=excluded.on_date, start_at=excluded.start_at,
          staff=excluded.staff, note=excluded.note`)
        .run(id, clinicId, input.date, input.start, input.staff, input.note ?? '',
          input.demo ? 1 : 0, now());
      db.prepare('DELETE FROM round_stops WHERE round_id=? AND clinic_id=?').run(id, clinicId);
      input.businessIds.forEach((businessId, position) => {
        db.prepare('INSERT INTO round_stops (round_id,clinic_id,business_id,position) VALUES (?,?,?,?)')
          .run(id, clinicId, businessId, position);
      });
      commit();
    } catch (error) { rollback(); throw error; }
    return rounds(clinicId).find(r => r.id === id)!;
  }

  /** Delete a round and its stops. The businesses and any visits recorded stay. */
  function removeRound(clinicId: string, roundId: string) {
    const changed = db.prepare('DELETE FROM rounds WHERE id=? AND clinic_id=?').run(roundId, clinicId);
    if (!changed.changes) throw new Error('That round is not yours.');
    db.prepare('DELETE FROM round_stops WHERE round_id=? AND clinic_id=?').run(roundId, clinicId);
  }

  /** Put the stops in a different order. Only the ones already on the round. */
  function reorderRound(clinicId: string, roundId: string, businessIds: string[]) {
    const round = rounds(clinicId).find(r => r.id === roundId);
    if (!round) throw new Error('That round is not yours.');
    const on = new Set(round.stops.map(s => s.id));
    if (businessIds.length !== on.size || businessIds.some(id => !on.has(id))) {
      throw new Error('Reordering has to list exactly the stops already on the round.');
    }
    begin();
    try {
      businessIds.forEach((businessId, position) => {
        db.prepare('UPDATE round_stops SET position=? WHERE round_id=? AND clinic_id=? AND business_id=?')
          .run(position, roundId, clinicId, businessId);
      });
      commit();
    } catch (error) { rollback(); throw error; }
    return rounds(clinicId).find(r => r.id === roundId)!;
  }

  function releases(clinicId: string) {
    return db.prepare(`SELECT id,name,released_at,released_by,size FROM releases
      WHERE clinic_id=? ORDER BY released_at DESC`).all(clinicId) as Array<{
        id: string; name: string; released_at: number; released_by: string; size: number }>;
  }

  return { businesses, business, script, saveScript, visits, visitsRecordedBy, recordVisit, editVisit, release, releases, setLocation, rounds, planRound, reorderRound, removeRound };
}
