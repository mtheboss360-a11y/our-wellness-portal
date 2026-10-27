# Our Wellness Network — staff portal status

**Updated 2026-10-27 from the owner-dashboard source package. Repo lineage: `mtheboss360-a11y/our-wellness-portal`.**
Live at **ournetworkportal.com** on Render (`our-wellness-portal`). Node 24, TypeScript, Vite,
React 19, `node:sqlite` on a Render persistent disk. 162 tests, all passing.

Read this before changing anything. Read the **Owner and staff access** section and **Rules that are not negotiable** before changing anything.

---

## Accounts

| Clinic | What is on it | Login |
|---|---|---|
| `hyline-dental` | **The live one.** Alexis, 5 verified businesses, 20 sample businesses, 14 sample visits, 2 rounds | `hylinedental` |
| `hyline-demo` | Old throwaway demo | `alexis` |
| `ethr-lab` | ETHR LAB, predates this work | `ethrlabs` |
| `orchard-lantern…` | Sample clinic, predates this work | `sample`, `skybalancesample` |

A clinic called `hyline` existed, was empty, and its only login was removed.

Logins are unique across every clinic, not per clinic. Passwords are scrypt-hashed and cannot
be read back — if one is lost, set a new one, there is no recovery.

```
npm run list-logins                                              # who can sign in
NEW_PASSWORD='…' npm run set-password -- --username <name>       # change one, signs it out everywhere
npm run name-login -- --username <name> --name "Alexis"          # put a person on a login
npm run remove-login -- --username <name> --dry-run              # remove one
```

---

## What was built

**`server/outreach.ts`** is the data layer everything new sits on. Tables: `releases`,
`businesses`, `visit_scripts`, `visits`, `visit_edits`, `rounds`, `round_stops`. Every read
takes a clinic id and there is no function that returns a business without one. The API
resolves that id from the session cookie and from nowhere else.

**Releases.** Businesses arrive in named batches, keyed on `(clinic, name, address)`, so
running a release twice updates details and creates nothing. A script someone has rewritten in
the portal is never overwritten by a later release.

**Guided Visit Mode** (`src/GuidedVisit.tsx`). Brief → script → record → next. Built for a phone
held in one hand outside a door. A `clientRef` on each submission makes a double tap or a retry
return the visit already saved instead of writing a second one.

**Rounds** (`src/lib/round-math.ts`, `src/RoundAgenda.tsx`). A round is an ordered list of
released businesses. Progress is counted from recorded visits. A visit counts toward a round if
recorded on its date **or after** — matching only the exact date meant a round run a day late
showed no progress.

**Visit history, Performance, Assigned Businesses.** All read saved records only.

**Owner dashboard** (`src/OwnerDashboard.tsx`, `src/ReferralBubbles.tsx`). Plan B owner logins open a practice dashboard with account-level activity, radius-filtered assigned businesses, route watchlist and full-screen route details. The bubble view reads only that practice's released businesses, uses larger readable nodes in one broad ring or two staggered rings (up to 25), and keeps every partner bubble the same size. Owners do not receive visit scripts and cannot record or edit a field visit. QR/NFC values are not in the current data model, so route details honestly show “Not added.” Fresh sign-ins open the role's landing screen; in-session Back and Forward navigation remains available.

**Opening hours** (`src/lib/agenda-math.ts`, `OPENS`). Mon/Tue/Fri 09:00, Wed/Thu 11:00,
Sat/Sun closed. A round cannot start before the practice opens; `plan-round` refuses a closed
day outright.

---

## Known defects

Defects 1, 2 and 3 were **fixed in `e3ad56f`** and are kept here as history — the causes are
worth knowing. Defects 4 and 5 are still open.

### 1. The Dashboard and the Agenda disagree about the next round — FIXED

The Dashboard's "Next" panel reads the **imported field log** (`field_logs`), while Today's
round reads the new `rounds` table. On `hyline-dental` the Dashboard says *"A round is booked
for Wed, Oct 28"* while the Agenda says *Tue, Oct 27*. Both are "true" — they are different
records.

Fixed: where a practice has released businesses the dashboard reads `src/lib/staff-dashboard.ts`
and lays the round out with the agenda's own `planRound`. A clinic with no released businesses
keeps the field-log dashboard.

### 2. The five real businesses are not on the Referral Network orb — FIXED

`geocode-release` geocoded all five and wrote them through `saveDiscovery`, which is the same
path a discovery refresh uses. But **a clinic flagged `demo` is served a fixed fictional set by
`server/network/sample.ts`**, which overrides the cache. So the orb on `hyline-dental` shows
Copperfield Yoga Loft, Ridgeline Strength and the rest — invented businesses — not Karve
Pilates and the four others.

Fixed: the fictional set now sits alongside the practice's real businesses instead of
replacing them, and the real ones are rebuilt from the rows we hold rather than merely
preserved — the earlier wipe had already removed them. Each rebuilt place keeps the expiry of
the fetch it came from, so rewriting the cache cannot extend Google's retention window.

### 3. `plan-round` creates a second round instead of replacing one — FIXED

Running `plan-round` twice for the same clinic and date books **two rounds**, and both show in
the Agenda's day picker. Fixed: it matches on `(clinic, date, staff)` and replaces, saying so. `--another` books a
genuine second round. **`hyline-dental` still has the two rounds booked before this fix** —
re-run `plan-round` for Tue Oct 27 and it will collapse them to one.

### 4. Owner/staff separation — BUILT, in two halves that met in the middle

Both halves of this landed separately and are now merged. `users.role` is one nullable column
with four values; the plan (`a`/`b`) is **not** a role and must never be used as one.

**The practice owner.** An `owner` login opens `src/OwnerDashboard.tsx` instead of `Overview`:
account-level activity, a radius-filtered bubble view of that practice's released businesses, a
route watchlist and full-screen route details. The server leaves visit scripts out of what it
returns to an owner and refuses field writes with a 403 — not a hidden button. See
`tests/roles.test.ts`, which drives the real HTTP server.

**The route runner.** A `route_runner` login gets the weekly planner (`src/MyRoutes.tsx`), their
own routes and their own visits, restricted by an allowlist on the server (`RUNNER_ENDPOINTS` in
`server/http.ts`), so their session cannot reach the practice's screens, the referral network or
somebody else's round whatever the browser sends. See **Route runners** below.

**A login with no role keeps every screen, exactly as before.** That is deliberate: deploying a
boundary must not lock a live client out of a portal that worked an hour ago. It is a migration
state, not a permission — `npm run list-logins` marks every unassigned account, and
`npm run set-role` ends it one login at a time. Check the production roles before relying on
what any one person can see.

### 5. Round creation is CLI-only

There is no admin UI. Rounds are booked from the Render Shell with `plan-round`.

---

## Route runners

**Added 2026-10-27.** The weekly planner a field rep lives in, built from the standalone file
kept at `samples/route-runner-planner-reference.html`.

`route_runner` is the fourth value in the role column the owner dashboard added, beside
`admin`, `owner` and `staff`. It is not the same as `staff`: `staff` is a practice's own
person on the existing portal screens (plan b, where the practice does its own visits);
`route_runner` is one of ours on the planner. An account with no role keeps what it had.

| Piece | Where |
|---|---|
| Assignments, pickups, supplies, route order, audit | `server/runner.ts` |
| The allowlist a runner's session is held to | `RUNNER_ENDPOINTS`, `server/http.ts` |
| The account: four screens, nothing else | `src/RunnerPortal.tsx` |
| The planner itself | `src/MyRoutes.tsx`, `src/lib/route-math.ts`, `src/runner.css` |
| Tests | `tests/runner.test.ts`, `tests/route.test.ts` |

```
INITIAL_PASSWORD='…' npm run add-runner-login -- --clinic <id> --username <name> --name "Alexis"
npm run assign-round -- --clinic <id> --date YYYY-MM-DD --username <name> [--flyers N --treats N --cards N]
npm run assign-round -- --clinic <id> --date YYYY-MM-DD --lock "Karve Pilates"   # fixed in place
npm run assign-round -- --round r_… --unassign
```

Things worth knowing before changing any of it:

- **Assignment is the permission, and only the user id is consulted.** `rounds.runner_id`. There
  was a fallback that matched `rounds.staff` against the login's display name, because that is
  how rounds booked before assignments existed were handed out — two people called Alexis would
  have seen each other's day, so it is gone. `npm run claim-rounds -- --clinic <id> --username
  <name>` lists the historical name matches and `--apply` turns them into real assignments.
  **A round with no `runner_id` shows on nobody's planner.**
- **A visit belongs to one round.** `visits.round_id` is written from the round the screen was
  on, and `visits.recorded_by` from the login. Both are nullable and nothing was backfilled: a
  visit recorded before these existed is attributed by `attributeVisits` to the last round on or
  before its date that held that business, and belongs to no login at all. Visit history is
  `recorded_by`, never "every visit at a business on your route".
- **A pickup is not a business.** `round_pickups` belongs to one round. It never enters
  `businesses`, the directory or the referral map, and the office's own screens do not show it.
- **Three supply numbers, never two.** `round_supplies.planned` is the office's allocation and a
  runner cannot write it; `packed` is their own count; `visit_materials` is what was dropped.
  `visits.materials` stays the authoritative total and is written as the sum of the breakdown —
  in the same transaction as the visit, so a visit cannot exist without the counts behind it.
- **`rounds.revision`** is bumped by every write. A change sent against an older revision is
  refused with 409 and the current route, never merged.
- **Reordering** keeps a locked stop at its exact position and keeps finished stops in the order
  they happened in. The screen offers only the moves the server would accept
  (`moveItem` in `src/lib/route-math.ts` mirrors `reorder` in `server/runner.ts`).
- **Times are arithmetic.** A leg between two known coordinates is estimated from the distance;
  everything else gets a flat 8-minute allowance. There is still no routing provider, so nothing
  here may be presented as navigation.
- **The start time is the office's.** The standalone file let a runner change it; the portal does
  not. The Route timing drawer explains the arithmetic instead.

## Rules that are not negotiable

These come from the client and from decisions already made. Breaking one is a regression even
if tests pass.

- **Never modify the Referral Network orb**, its ranking, or its matching engine. Only the page
  around it. Checksum `src/NetworkOrb.tsx`, `src/NetworkMap.tsx`, `src/BakeryNetwork.tsx` before
  and after any change.
- **Never fabricate.** No invented business, coordinate, visit, outcome or figure. Where
  something is unknown the screen says so. An empty state beats a placeholder.
- **No conversions, revenue, appointments or patient data** anywhere in the staff portal. The
  database does not know whether anybody booked, so nothing may claim it does.
- **"Materials dropped", never "materials left."**
- **Google Maps terms:** a place id may be kept indefinitely, a coordinate for 30 days only.
  `businesses.geo_at` stamps them; `map_places.expires_at` purges them.
- **Scripts never promise** referrals, payment or a medical outcome.
- **Never run `activate-live` without being asked.** It deletes records.
- Fifteen items at a time in any list put in front of Mustafa.

---

## Demo tagging, and how an account goes live

Every table that can hold illustrative data has a **nullable** `demo` column. `1` means someone
marked it illustrative, `0` real, `NULL` nobody said. `activate-live` deletes only `demo=1`,
keeps `demo=0`, and **stops** on any `NULL` rather than guessing.

```
npm run make-sample-outreach -- --clinic <id> --staff "Alexis"   # 20 fictional businesses + 14 visits, all tagged
npm run activate-live -- --clinic <id> --dry-run                 # preview
npm run activate-live -- --clinic <id>                           # type ACTIVATE; backs up first
```

`activate-live` has **not** been run on anything. `hyline-dental` is still flagged demo, which
is why the orb shows the fictional set (defect 2).

`hyline-demo`'s rows predate tagging and are all `NULL`, so `activate-live` will refuse on it.
That is the design working.

---

## The other commands

```
npm run release-businesses -- --clinic <id> --file data/releases/hyline-release-1.json --by <you>
npm run geocode-release -- --clinic <id> [--clinic-address "…"] [--dry-run]
npm run plan-round -- --clinic <id> --date YYYY-MM-DD --start HH:MM --staff "Alexis" [--only "A,B"]
```

`geocode-release` refuses a match whose street number and town do not agree with the address we
were given. A business left without a coordinate still routes, by street address.

---

## Deploying

Render **Auto-Deploy is off**. Use **Manual Deploy → Deploy latest commit**. Do not deploy
individual commits — they replay in click order, and deploying an older one after a newer one
silently rolls back. That has happened twice.

Build command is `npm ci --include=dev && npm run build`. `NODE_ENV=production` makes npm omit
dev dependencies, which breaks the TypeScript build without `--include=dev`.
