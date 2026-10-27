// THE ROUTE RUNNER'S OWN LAYER: who a round belongs to, the pickups a runner puts into it, the
// supplies they confirm they are carrying, and the order they decide to drive it in.
//
// It sits on top of `server/outreach.ts` rather than beside it. The businesses, the scripts and
// the recorded visits are that file's; nothing here creates a business, releases one, writes a
// script or books a round. A round runner is given a day's work and decides how to drive it:
//
//   - they may REORDER the stops they were given, and insert their own pickups among them;
//   - they may not add a business, remove one, move one to another date, or touch a round that
//     is not theirs.
//
// Every function takes a clinic id resolved from the session cookie and, where it matters, the
// signed-in user. There is no function that reaches a round without both.
//
// WHAT IS PLANNED AND WHAT IS ACTUAL are kept apart on purpose. `round_supplies.planned` is the
// office's allocation and a runner cannot write it. `packed` is what the runner says they
// physically have. `visit_materials` is what they recorded dropping. Three different numbers in
// three different columns, so "assigned 100 flyers" can never be read as "100 flyers delivered".
import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import type { Business } from './outreach';

/** What a runner may stop for on the way round. Not a referral business, and never ranked with one. */
export const PICKUP_KINDS = ['treats', 'materials', 'other'] as const;
export type PickupKind = (typeof PICKUP_KINDS)[number];

/** The three things a round carries. Counted separately so "remaining" means something. */
export type Supplies = { flyers: number; treats: number; cards: number };
export const NO_SUPPLIES: Supplies = { flyers: 0, treats: 0, cards: 0 };
export const SUPPLY_KEYS = ['flyers', 'treats', 'cards'] as const;

export type Pickup = {
  id: string; roundId: string; kind: PickupKind; title: string; address: string;
  /** The window the place can be collected from, as the runner was told it. */
  windowStart: string; windowEnd: string;
  minutes: number; items: string; reference: string; note: string;
  /** What the runner expects to collect. Their own plan, not the office's allocation. */
  supplies: Supplies;
  /** What they actually came away with. Null until the pickup is marked collected. */
  collected: Supplies | null;
  status: 'planned' | 'collected';
  collectedAt: number | null;
  position: number;
};

export type RunnerItem =
  | { kind: 'business'; id: string; position: number; locked: boolean; business: Business }
  | { kind: 'pickup'; id: string; position: number; locked: boolean; pickup: Pickup };

export type RoundSupplies = {
  planned: Supplies;
  /** Null until the runner has confirmed what they are actually carrying. */
  packed: Supplies | null;
  packedBy: string; packedAt: number | null;
};

export type RunnerRound = {
  id: string; date: string; start: string; staff: string;
  status: 'scheduled' | 'done' | 'draft'; note: string; demo: number | null;
  /** Bumped by every write. A change sent against an older revision is refused, not merged. */
  revision: number;
  /** The user id this round is assigned to, where one was assigned. */
  runnerId: string | null;
  items: RunnerItem[];
  supplies: RoundSupplies;
};

/** What a runner may send when adding or changing a pickup. */
export type PickupDraft = {
  kind: PickupKind; title: string; address: string;
  windowStart: string; windowEnd: string; minutes: number;
  items: string; reference: string; note: string; supplies: Partial<Supplies>;
};

/** A reference to one thing on a round, as the browser sends it back after a drag. */
export type ItemRef = { kind: 'business' | 'pickup'; id: string };

/** A write that arrived against a round somebody else had already changed. */
export class RoundConflict extends Error {
  constructor(message = 'This route changed somewhere else. It has been reloaded — please try again.') {
    super(message);
    this.name = 'RoundConflict';
  }
}

const SCHEMA = [
  // A PICKUP STOP. It belongs to one round and to nothing else: it is not a business, it never
  // enters the business directory, and the referral network cannot see it.
  `CREATE TABLE IF NOT EXISTS round_pickups (
     id TEXT PRIMARY KEY,
     round_id TEXT NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
     clinic_id TEXT NOT NULL REFERENCES clinics(id),
     kind TEXT NOT NULL DEFAULT 'other',
     title TEXT NOT NULL,
     address TEXT NOT NULL,
     window_start TEXT NOT NULL DEFAULT '09:00',
     window_end TEXT NOT NULL DEFAULT '09:30',
     minutes INTEGER NOT NULL DEFAULT 10,
     items TEXT NOT NULL DEFAULT '',
     reference TEXT NOT NULL DEFAULT '',
     note TEXT NOT NULL DEFAULT '',
     supplies TEXT NOT NULL DEFAULT '{}',
     collected TEXT,
     status TEXT NOT NULL DEFAULT 'planned',
     collected_at INTEGER,
     position INTEGER NOT NULL,
     created_by TEXT NOT NULL DEFAULT '',
     created_at INTEGER NOT NULL,
     demo INTEGER)`,
  `CREATE INDEX IF NOT EXISTS pickups_by_round ON round_pickups(round_id, clinic_id)`,
  // WHAT THE ROUND IS CARRYING. `planned` is the allocation and only the team writes it;
  // `packed` is the runner's own count of what is in the car.
  `CREATE TABLE IF NOT EXISTS round_supplies (
     round_id TEXT PRIMARY KEY REFERENCES rounds(id) ON DELETE CASCADE,
     clinic_id TEXT NOT NULL REFERENCES clinics(id),
     planned TEXT NOT NULL DEFAULT '{}',
     packed TEXT,
     packed_by TEXT NOT NULL DEFAULT '',
     packed_at INTEGER,
     demo INTEGER)`,
  // WHO CHANGED A ROUND AND HOW. A runner reordering their own day is not a thing to hide, and
  // "the stops were in a different order this morning" has to be answerable.
  `CREATE TABLE IF NOT EXISTS round_changes (
     id TEXT PRIMARY KEY,
     round_id TEXT NOT NULL,
     clinic_id TEXT NOT NULL REFERENCES clinics(id),
     by_user TEXT NOT NULL DEFAULT '',
     kind TEXT NOT NULL,
     detail TEXT NOT NULL DEFAULT '',
     at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS changes_by_round ON round_changes(round_id)`,
].join(';\n');

const now = () => Date.now();
const safeParse = (value: string) => { try { return JSON.parse(value); } catch { return {}; } };
const qty = (value: unknown) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(10000, Math.trunc(n))) : 0;
};
const toSupplies = (value: unknown): Supplies => {
  const raw = typeof value === 'string' ? safeParse(value) : value;
  const r = (raw ?? {}) as Partial<Supplies>;
  return { flyers: qty(r.flyers), treats: qty(r.treats), cards: qty(r.cards) };
};
const clockValue = (clock: string) => {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(clock)) return null;
  const [h, m] = clock.split(':').map(Number);
  return h * 60 + m;
};
const trim = (value: unknown, length: number) => String(value ?? '').trim().slice(0, length);

type PickupRow = {
  id: string; round_id: string; kind: string; title: string; address: string;
  window_start: string; window_end: string; minutes: number; items: string; reference: string;
  note: string; supplies: string; collected: string | null; status: string;
  collected_at: number | null; position: number;
};

type BusinessRow = {
  id: string; name: string; category: string; address: string; phone: string; website: string;
  talking_point: string; stage: string; release_id: string; released_at: number;
  lat: number | null; lng: number | null; place_id: string | null;
  geo_at: number | null; demo: number | null; types: string | null;
  locked: number; position: number;
};

const BUSINESS_COLUMNS = ['id', 'name', 'category', 'address', 'phone', 'website', 'talking_point',
  'stage', 'release_id', 'released_at', 'lat', 'lng', 'place_id', 'geo_at', 'demo', 'types'];

export function openRunner(db: DatabaseSync) {
  db.exec(SCHEMA);

  // ADDITIVE COLUMNS on tables `server/outreach.ts` owns. ADD COLUMN is not idempotent the way
  // CREATE TABLE IF NOT EXISTS is, so each is asked for only when genuinely missing.
  //
  // rounds.runner_id: a round's staff was a NAME, which is all a CLI needed. A route runner
  // signs in as a person, so the round has to carry the account it belongs to — a name match is
  // not an authorization check.
  //
  // rounds.revision: bumped by every write, so two phones cannot silently overwrite each other.
  //
  // round_stops.locked: a stop the office has fixed in place. A runner may reorder everything
  // around it; its position does not move.
  const add = (table: string, column: string, type: string) => {
    const columns = (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(c => c.name);
    if (!columns.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  };
  add('rounds', 'runner_id', 'TEXT');
  add('rounds', 'revision', 'INTEGER NOT NULL DEFAULT 0');
  add('round_stops', 'locked', 'INTEGER NOT NULL DEFAULT 0');
  // WHAT WAS ACTUALLY COLLECTED, beside what the runner said they would collect. Null until the
  // pickup is marked collected: planned and actual are two different numbers, like every other
  // pair of them here.
  add('round_pickups', 'collected', 'TEXT');

  const begin = () => { db.prepare('BEGIN IMMEDIATE').run(); };
  const commit = () => { db.prepare('COMMIT').run(); };
  const rollback = () => { db.prepare('ROLLBACK').run(); };

  const toBusiness = (r: BusinessRow): Business => ({
    id: r.id, name: r.name, category: r.category, address: r.address, phone: r.phone,
    website: r.website, talkingPoint: r.talking_point, stage: r.stage as Business['stage'],
    releaseId: r.release_id, releasedAt: r.released_at, lat: r.lat, lng: r.lng,
    placeId: r.place_id, geoAt: r.geo_at, demo: r.demo,
    ...(() => {
      const parsed = r.types ? safeParse(r.types) as { types?: string[]; primaryType?: string | null } : null;
      return { types: parsed?.types ?? [], primaryType: parsed?.primaryType ?? null };
    })(),
  });

  const toPickup = (r: PickupRow): Pickup => ({
    id: r.id, roundId: r.round_id,
    kind: (PICKUP_KINDS as readonly string[]).includes(r.kind) ? r.kind as PickupKind : 'other',
    title: r.title, address: r.address, windowStart: r.window_start, windowEnd: r.window_end,
    minutes: r.minutes, items: r.items, reference: r.reference, note: r.note,
    supplies: toSupplies(r.supplies),
    collected: r.collected ? toSupplies(r.collected) : null,
    status: r.status === 'collected' ? 'collected' : 'planned',
    collectedAt: r.collected_at, position: r.position,
  });

  function logChange(clinicId: string, roundId: string, byUser: string, kind: string, detail: string) {
    db.prepare('INSERT INTO round_changes (id,round_id,clinic_id,by_user,kind,detail,at) VALUES (?,?,?,?,?,?,?)')
      .run(randomUUID(), roundId, clinicId, byUser, kind, detail.slice(0, 900), now());
  }

  /** The audit trail for one round, newest first. */
  function changes(clinicId: string, roundId: string) {
    return db.prepare(`SELECT by_user AS byUser, kind, detail, at FROM round_changes
      WHERE clinic_id=? AND round_id=? ORDER BY at DESC`).all(clinicId, roundId) as Array<{
        byUser: string; kind: string; detail: string; at: number }>;
  }

  function supplies(clinicId: string, roundId: string): RoundSupplies {
    const row = db.prepare('SELECT planned,packed,packed_by,packed_at FROM round_supplies WHERE round_id=? AND clinic_id=?')
      .get(roundId, clinicId) as { planned: string; packed: string | null; packed_by: string; packed_at: number | null } | undefined;
    return {
      planned: toSupplies(row?.planned ?? '{}'),
      packed: row?.packed ? toSupplies(row.packed) : null,
      packedBy: row?.packed_by ?? '', packedAt: row?.packed_at ?? null,
    };
  }

  /** Everything on a round, businesses and pickups in one order. */
  function items(clinicId: string, roundId: string): RunnerItem[] {
    const stops = db.prepare(`SELECT ${BUSINESS_COLUMNS.map(c => 'b.' + c).join(',')}, s.position, s.locked
        FROM round_stops s JOIN businesses b ON b.id=s.business_id
        WHERE s.round_id=? AND s.clinic_id=?`).all(roundId, clinicId) as BusinessRow[];
    const pickups = db.prepare(`SELECT id,round_id,kind,title,address,window_start,window_end,minutes,items,
        reference,note,supplies,collected,status,collected_at,position FROM round_pickups
        WHERE round_id=? AND clinic_id=?`).all(roundId, clinicId) as PickupRow[];
    const list: RunnerItem[] = [
      ...stops.map(r => ({
        kind: 'business' as const, id: r.id, position: r.position, locked: r.locked === 1,
        business: toBusiness(r),
      })),
      ...pickups.map(r => ({
        kind: 'pickup' as const, id: r.id, position: r.position, locked: false, pickup: toPickup(r),
      })),
    ];
    // Position is one shared space across both tables. Ties fall back to the kind and the id so
    // a read is stable rather than whatever order SQLite happened to return.
    return list.sort((a, b) => a.position - b.position || a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));
  }

  type RoundRow = {
    id: string; on_date: string; start_at: string; staff: string; status: string;
    note: string; demo: number | null; revision: number; runner_id: string | null };

  const ROUND_COLUMNS = 'id,on_date,start_at,staff,status,note,demo,revision,runner_id';

  const roundRow = (clinicId: string, roundId: string) =>
    db.prepare(`SELECT ${ROUND_COLUMNS} FROM rounds WHERE id=? AND clinic_id=?`)
      .get(roundId, clinicId) as RoundRow | undefined;

  const hydrate = (clinicId: string, r: RoundRow): RunnerRound => ({
    id: r.id, date: r.on_date, start: r.start_at, staff: r.staff,
    status: (['scheduled', 'done', 'draft'].includes(r.status) ? r.status : 'scheduled') as RunnerRound['status'],
    note: r.note, demo: r.demo, revision: r.revision, runnerId: r.runner_id,
    items: items(clinicId, r.id), supplies: supplies(clinicId, r.id),
  });

  /** One round, with everything on it. Null where it is not this practice's. */
  function round(clinicId: string, roundId: string): RunnerRound | null {
    const row = roundRow(clinicId, roundId);
    return row ? hydrate(clinicId, row) : null;
  }

  type Who = { id: string; displayName: string };

  /**
   * THE ROUNDS ONE PERSON IS ALLOWED TO SEE — the ones assigned to their account, and nothing
   * else. `runner_id` is the assignment and the only thing consulted.
   *
   * This used to fall back to matching `rounds.staff` against the login's display name, because
   * that is how every round booked before assignments existed was handed out. Two people called
   * Alexis would then have seen each other's day, so the fallback is gone: a name is not an
   * identity. `scripts/claim-rounds.ts` turns those historical name matches into real
   * assignments, one login at a time, with somebody looking at the list first.
   */
  function assignedRounds(clinicId: string, user: Who): RunnerRound[] {
    if (!user.id) return [];
    const rows = db.prepare(`SELECT ${ROUND_COLUMNS} FROM rounds
      WHERE clinic_id=? AND runner_id=? ORDER BY on_date DESC`).all(clinicId, user.id) as RoundRow[];
    return rows.map(r => hydrate(clinicId, r));
  }

  /**
   * THE HISTORICAL ROUNDS that were booked under this person's name and never assigned to an
   * account. Returned for somebody to look at; `assign` is what actually hands them over, and
   * each one is written to the round's own history.
   */
  function claimableRounds(clinicId: string, displayName: string) {
    const name = displayName.trim().toLowerCase();
    if (!name) return [];
    const rows = db.prepare(`SELECT ${ROUND_COLUMNS} FROM rounds
      WHERE clinic_id=? AND runner_id IS NULL AND LOWER(TRIM(staff))=? ORDER BY on_date DESC`)
      .all(clinicId, name) as RoundRow[];
    return rows.map(r => hydrate(clinicId, r));
  }

  /** Is this round one that person may change? The same rule as seeing it, asked on every write. */
  function mayRun(clinicId: string, roundId: string, user: Who) {
    return assignedRounds(clinicId, user).some(r => r.id === roundId);
  }

  const assertMine = (clinicId: string, roundId: string, user: Who) => {
    if (!mayRun(clinicId, roundId, user)) throw new Error('That route is not assigned to you.');
    return roundRow(clinicId, roundId)!;
  };

  /** The revision the caller was looking at has to be the revision on the row. */
  const check = (row: RoundRow, revision: number | undefined) => {
    if (revision !== undefined && revision !== row.revision) throw new RoundConflict();
  };
  const bump = (roundId: string, clinicId: string) =>
    db.prepare('UPDATE rounds SET revision=revision+1 WHERE id=? AND clinic_id=?').run(roundId, clinicId);

  /** Put a round in somebody's hands. The office's call, never a runner's. */
  function assignRound(clinicId: string, roundId: string, userId: string | null) {
    if (userId) {
      const user = db.prepare('SELECT clinic_id FROM users WHERE id=?').get(userId) as { clinic_id: string } | undefined;
      if (!user) throw new Error('No such login.');
      if (user.clinic_id !== clinicId) throw new Error('That login belongs to another practice.');
    }
    const changed = db.prepare('UPDATE rounds SET runner_id=?, revision=revision+1 WHERE id=? AND clinic_id=?')
      .run(userId, roundId, clinicId);
    if (!changed.changes) throw new Error('That round is not this practice’s.');
    logChange(clinicId, roundId, 'office', userId ? 'assigned' : 'unassigned', userId ?? '');
    return round(clinicId, roundId)!;
  }

  /** The allocation for a round: what the office says to take. A runner cannot write this. */
  function setPlannedSupplies(clinicId: string, roundId: string, planned: Partial<Supplies>, demo = false) {
    if (!roundRow(clinicId, roundId)) throw new Error('That round is not this practice’s.');
    const value = toSupplies(planned);
    db.prepare(`INSERT INTO round_supplies (round_id,clinic_id,planned,demo) VALUES (?,?,?,?)
      ON CONFLICT(round_id) DO UPDATE SET planned=excluded.planned`)
      .run(roundId, clinicId, JSON.stringify(value), demo ? 1 : 0);
    bump(roundId, clinicId);
    logChange(clinicId, roundId, 'office', 'supplies-planned', JSON.stringify(value));
    return supplies(clinicId, roundId);
  }

  /** Fix a stop in place, or let it move again. The office's call. */
  function lockStop(clinicId: string, roundId: string, businessId: string, locked: boolean) {
    const changed = db.prepare('UPDATE round_stops SET locked=? WHERE round_id=? AND clinic_id=? AND business_id=?')
      .run(locked ? 1 : 0, roundId, clinicId, businessId);
    if (!changed.changes) throw new Error('That stop is not on this round.');
    bump(roundId, clinicId);
    return round(clinicId, roundId)!;
  }

  /**
   * WHAT A RUNNER MAY RECORD A VISIT AGAINST: a named round of theirs, with that business on it.
   *
   * The round is named by the caller rather than searched for. A business can sit on two rounds
   * — a follow-up a week later is the ordinary case — and picking one of them here would attach
   * the conversation, and the materials dropped at it, to whichever round happened to sort
   * first. Returns the round, or null where the pairing is not this person's.
   */
  function roundStopFor(clinicId: string, roundId: string, businessId: string, user: Who) {
    const round = assignedRounds(clinicId, user).find(r => r.id === roundId);
    if (!round) return null;
    return round.items.some(item => item.kind === 'business' && item.business.id === businessId)
      ? round : null;
  }

  /**
   * REORDER one round. The list has to be exactly what is on the round — nothing added, nothing
   * dropped — and three things hold:
   *
   *   - a LOCKED stop keeps its exact position;
   *   - a FINISHED stop keeps its order relative to the other finished ones, so a day that has
   *     happened cannot be rewritten into a sequence it did not happen in;
   *   - the revision has to match, so the phone that saves second is told rather than obeyed.
   */
  function reorder(clinicId: string, roundId: string, order: ItemRef[], user: Who,
    options: { revision?: number; completed?: Set<string> } = {}) {
    const row = assertMine(clinicId, roundId, user);
    check(row, options.revision);

    const current = items(clinicId, roundId);
    const key = (ref: { kind: string; id: string }) => `${ref.kind}:${ref.id}`;
    const have = new Set(current.map(key));
    const sent = order.map(key);
    if (sent.length !== have.size || new Set(sent).size !== sent.length || sent.some(k => !have.has(k))) {
      throw new Error('A reorder has to list exactly the stops already on this route.');
    }

    for (const item of current.filter(i => i.locked)) {
      if (sent.indexOf(key(item)) !== current.findIndex(c => key(c) === key(item))) {
        const name = item.kind === 'business' ? item.business.name : item.pickup.title;
        throw new Error(`${name} is fixed in place by your office and cannot be moved.`);
      }
    }

    // A FINISHED STOP KEEPS ITS PLACE, exactly — the same rule as a locked one. It used to be
    // enough that the finished stops kept their order relative to each other, which let a single
    // visited stop slide, and let an unvisited stop be dragged in front of stops already driven.
    // A day that has partly happened is a record, and time only runs one way through it.
    const done = options.completed ?? new Set<string>();
    const finished = current.filter(item =>
      (item.kind === 'business' && done.has(item.business.id)) ||
      (item.kind === 'pickup' && item.pickup.status === 'collected'));
    for (const item of finished) {
      if (sent.indexOf(key(item)) !== current.findIndex(c => key(c) === key(item))) {
        throw new Error('A stop you have already finished cannot be moved out of the order it happened in.');
      }
    }

    begin();
    try {
      order.forEach((ref, position) => {
        if (ref.kind === 'business') {
          db.prepare('UPDATE round_stops SET position=? WHERE round_id=? AND clinic_id=? AND business_id=?')
            .run(position, roundId, clinicId, ref.id);
        } else {
          db.prepare('UPDATE round_pickups SET position=? WHERE round_id=? AND clinic_id=? AND id=?')
            .run(position, roundId, clinicId, ref.id);
        }
      });
      db.prepare('UPDATE rounds SET revision=revision+1 WHERE id=? AND clinic_id=?').run(roundId, clinicId);
      commit();
    } catch (error) { rollback(); throw error; }
    logChange(clinicId, roundId, user.id, 'reordered', sent.join(','));
    return round(clinicId, roundId)!;
  }

  /** Check a pickup over before it is written. The sentences are for the person, not the log. */
  function clean(draft: PickupDraft) {
    const title = trim(draft.title, 100);
    const address = trim(draft.address, 250);
    const opens = clockValue(draft.windowStart), closes = clockValue(draft.windowEnd);
    const minutes = Math.trunc(Number(draft.minutes));
    if (!title) throw new Error('Give the pickup a location name.');
    if (address.length < 8) throw new Error('Give the pickup a full street address.');
    if (opens === null || closes === null) throw new Error('Give the pickup a window, as HH:MM.');
    if (opens >= closes) throw new Error('The pickup window has to open before it closes.');
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 120) throw new Error('Time at the pickup has to be between 1 and 120 minutes.');
    return {
      kind: (PICKUP_KINDS as readonly string[]).includes(draft.kind) ? draft.kind : 'other',
      title, address, windowStart: draft.windowStart, windowEnd: draft.windowEnd, minutes,
      items: trim(draft.items, 400), reference: trim(draft.reference, 120), note: trim(draft.note, 900),
      supplies: toSupplies(draft.supplies),
    };
  }

  /** Put a pickup on the end of a round. The runner moves it where they want it afterwards. */
  function addPickup(clinicId: string, roundId: string, draft: PickupDraft, user: Who,
    options: { revision?: number; demo?: boolean } = {}) {
    const row = assertMine(clinicId, roundId, user);
    check(row, options.revision);
    const value = clean(draft);
    const count = (db.prepare('SELECT COUNT(*) AS n FROM round_pickups WHERE round_id=? AND clinic_id=?')
      .get(roundId, clinicId) as { n: number }).n;
    if (count >= 12) throw new Error('A route can carry twelve pickups. Remove one before adding another.');
    const last = items(clinicId, roundId).at(-1)?.position ?? -1;
    const id = `pk_${randomUUID()}`;
    db.prepare(`INSERT INTO round_pickups (id,round_id,clinic_id,kind,title,address,window_start,window_end,
        minutes,items,reference,note,supplies,status,position,created_by,created_at,demo)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'planned',?,?,?,?)`)
      .run(id, roundId, clinicId, value.kind, value.title, value.address, value.windowStart,
        value.windowEnd, value.minutes, value.items, value.reference, value.note,
        JSON.stringify(value.supplies), last + 1, user.id, now(), options.demo ? 1 : 0);
    bump(roundId, clinicId);
    logChange(clinicId, roundId, user.id, 'pickup-added', `${value.title} · ${value.address}`);
    return round(clinicId, roundId)!;
  }

  function updatePickup(clinicId: string, roundId: string, pickupId: string, draft: PickupDraft, user: Who,
    options: { revision?: number } = {}) {
    const row = assertMine(clinicId, roundId, user);
    check(row, options.revision);
    const existing = db.prepare('SELECT status FROM round_pickups WHERE id=? AND round_id=? AND clinic_id=?')
      .get(pickupId, roundId, clinicId) as { status: string } | undefined;
    if (!existing) throw new Error('That pickup is not on this route.');
    if (existing.status === 'collected') throw new Error('That pickup has been collected, so it cannot be changed.');
    const value = clean(draft);
    db.prepare(`UPDATE round_pickups SET kind=?,title=?,address=?,window_start=?,window_end=?,minutes=?,
        items=?,reference=?,note=?,supplies=? WHERE id=? AND round_id=? AND clinic_id=?`)
      .run(value.kind, value.title, value.address, value.windowStart, value.windowEnd, value.minutes,
        value.items, value.reference, value.note, JSON.stringify(value.supplies), pickupId, roundId, clinicId);
    bump(roundId, clinicId);
    logChange(clinicId, roundId, user.id, 'pickup-changed', `${value.title} · ${value.address}`);
    return round(clinicId, roundId)!;
  }

  /** Take a pickup off a route. Only a pickup: an assigned business cannot be removed here. */
  function removePickup(clinicId: string, roundId: string, pickupId: string, user: Who,
    options: { revision?: number } = {}) {
    const row = assertMine(clinicId, roundId, user);
    check(row, options.revision);
    const existing = db.prepare('SELECT title,status FROM round_pickups WHERE id=? AND round_id=? AND clinic_id=?')
      .get(pickupId, roundId, clinicId) as { title: string; status: string } | undefined;
    if (!existing) throw new Error('That pickup is not on this route.');
    if (existing.status === 'collected') throw new Error('That pickup has been collected, so it stays on the record.');
    db.prepare('DELETE FROM round_pickups WHERE id=? AND round_id=? AND clinic_id=?').run(pickupId, roundId, clinicId);
    bump(roundId, clinicId);
    logChange(clinicId, roundId, user.id, 'pickup-removed', existing.title);
    return round(clinicId, roundId)!;
  }

  /**
   * Mark a pickup collected, with what was actually in the bag. Only what is collected counts
   * toward what the runner is carrying — a pickup still ahead of them is not supplies they have.
   */
  function collectPickup(clinicId: string, roundId: string, pickupId: string, user: Who,
    options: { revision?: number; collected?: Partial<Supplies> } = {}) {
    const row = assertMine(clinicId, roundId, user);
    check(row, options.revision);
    const planned = db.prepare('SELECT supplies FROM round_pickups WHERE id=? AND round_id=? AND clinic_id=?')
      .get(pickupId, roundId, clinicId) as { supplies: string } | undefined;
    const actual = toSupplies(options.collected ?? planned?.supplies ?? {});
    const changed = db.prepare(`UPDATE round_pickups SET status='collected', collected_at=?, collected=?
      WHERE id=? AND round_id=? AND clinic_id=? AND status<>'collected'`)
      .run(now(), JSON.stringify(actual), pickupId, roundId, clinicId);
    if (!changed.changes) {
      const exists = db.prepare('SELECT status FROM round_pickups WHERE id=? AND round_id=? AND clinic_id=?')
        .get(pickupId, roundId, clinicId) as { status: string } | undefined;
      if (!exists) throw new Error('That pickup is not on this route.');
      // Already collected: a second tap is the same intent, so this is not an error.
      return round(clinicId, roundId)!;
    }
    bump(roundId, clinicId);
    logChange(clinicId, roundId, user.id, 'pickup-collected', pickupId);
    return round(clinicId, roundId)!;
  }

  /**
   * THE RUNNER'S OWN COUNT of what they are carrying. It may be lower than the allocation — a
   * short box is a fact, not an error — but it may not be lower than what has already been
   * recorded as dropped, which would make the remaining figure a negative fiction.
   */
  function confirmPacked(clinicId: string, roundId: string, packed: Partial<Supplies>, user: Who,
    options: { revision?: number; dropped?: Supplies } = {}) {
    const row = assertMine(clinicId, roundId, user);
    check(row, options.revision);
    const value = toSupplies(packed);
    const dropped = options.dropped ?? NO_SUPPLIES;
    const collected = collectedSupplies(clinicId, roundId);
    for (const key of SUPPLY_KEYS) {
      if (value[key] + collected[key] < dropped[key]) {
        throw new Error(`You have already recorded ${dropped[key]} ${key} dropped on this route, so you cannot confirm fewer than that.`);
      }
    }
    db.prepare(`INSERT INTO round_supplies (round_id,clinic_id,planned,packed,packed_by,packed_at)
        VALUES (?,?,'{}',?,?,?)
      ON CONFLICT(round_id) DO UPDATE SET packed=excluded.packed, packed_by=excluded.packed_by, packed_at=excluded.packed_at`)
      .run(roundId, clinicId, JSON.stringify(value), user.displayName || user.id, now());
    bump(roundId, clinicId);
    logChange(clinicId, roundId, user.id, 'supplies-packed', JSON.stringify(value));
    return round(clinicId, roundId)!;
  }

  /**
   * What the collected pickups have added to the car — what was actually collected, which is
   * not always what was planned. A pickup that has not been collected adds nothing.
   */
  function collectedSupplies(clinicId: string, roundId: string): Supplies {
    const rows = db.prepare(`SELECT supplies,collected FROM round_pickups
      WHERE round_id=? AND clinic_id=? AND status='collected'`).all(roundId, clinicId) as Array<{ supplies: string; collected: string | null }>;
    return rows.reduce<Supplies>((total, row) => {
      const value = toSupplies(row.collected ?? row.supplies);
      return { flyers: total.flyers + value.flyers, treats: total.treats + value.treats, cards: total.cards + value.cards };
    }, { ...NO_SUPPLIES });
  }

  /** What has been recorded as dropped on one round, by kind. */
  function droppedOnRound(clinicId: string, roundId: string): Supplies {
    const rows = db.prepare(`SELECT flyers,treats,cards FROM visit_materials
      WHERE clinic_id=? AND round_id=?`).all(clinicId, roundId) as Array<Supplies>;
    return rows.reduce<Supplies>((total, row) => ({
      flyers: total.flyers + qty(row.flyers), treats: total.treats + qty(row.treats), cards: total.cards + qty(row.cards),
    }), { ...NO_SUPPLIES });
  }

  /** The breakdowns for a set of visits, so a screen can show what went where. */
  function visitMaterials(clinicId: string): Record<string, Supplies> {
    const rows = db.prepare('SELECT visit_id,flyers,treats,cards FROM visit_materials WHERE clinic_id=?')
      .all(clinicId) as Array<{ visit_id: string } & Supplies>;
    return Object.fromEntries(rows.map(r => [r.visit_id, { flyers: r.flyers, treats: r.treats, cards: r.cards }]));
  }

  /** What is still in the car: confirmed load, plus collected pickups, less what was dropped. */
  function remaining(clinicId: string, roundId: string, packed: Supplies | null): Supplies {
    const collected = collectedSupplies(clinicId, roundId);
    const dropped = droppedOnRound(clinicId, roundId);
    const base = packed ?? NO_SUPPLIES;
    return {
      flyers: base.flyers + collected.flyers - dropped.flyers,
      treats: base.treats + collected.treats - dropped.treats,
      cards: base.cards + collected.cards - dropped.cards,
    };
  }

  return {
    round, items, supplies, changes, assignedRounds, claimableRounds, mayRun, roundStopFor,
    assignRound, setPlannedSupplies, lockStop, reorder,
    addPickup, updatePickup, removePickup, collectPickup, confirmPacked,
    collectedSupplies, droppedOnRound, visitMaterials, remaining,
  };
}

export type RunnerStore = ReturnType<typeof openRunner>;
