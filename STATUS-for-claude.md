# Our Wellness Network — staff portal status

**Written 2026-10-26. Repo: `mtheboss360-a11y/our-wellness-portal`, branch `main`, tip `3ef3b6d`.**
Live at **ournetworkportal.com** on Render (`our-wellness-portal`). Node 24, TypeScript, Vite,
React 19, `node:sqlite` on a Render persistent disk. 155 tests, all passing.

Read this before changing anything. The sections that matter most are **Known defects** and
**Rules that are not negotiable**.

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

**Opening hours** (`src/lib/agenda-math.ts`, `OPENS`). Mon/Tue/Fri 09:00, Wed/Thu 11:00,
Sat/Sun closed. A round cannot start before the practice opens; `plan-round` refuses a closed
day outright.

---

## Known defects

These are real and visible. Do not report the portal as finished without addressing them.

### 1. The Dashboard and the Agenda disagree about the next round

The Dashboard's "Next" panel reads the **imported field log** (`field_logs`), while Today's
round reads the new `rounds` table. On `hyline-dental` the Dashboard says *"A round is booked
for Wed, Oct 28"* while the Agenda says *Tue, Oct 27*. Both are "true" — they are different
records.

The original spec called this out: *"A round must have one authoritative schedule shared across
all screens."* It is not done. `src/Dashboard.tsx` → `NextUp` and the four figure tiles still
come from `dashboard-math.ts` over the field log. They need rewiring to `getRounds()` and
`getVisits()`.

### 2. The five real businesses are not on the Referral Network orb

`geocode-release` geocoded all five and wrote them through `saveDiscovery`, which is the same
path a discovery refresh uses. But **a clinic flagged `demo` is served a fixed fictional set by
`server/network/sample.ts`**, which overrides the cache. So the orb on `hyline-dental` shows
Copperfield Yoga Loft, Ridgeline Strength and the rest — invented businesses — not Karve
Pilates and the four others.

I previously told Mustafa the five "now appear on the orb". On a demo-flagged clinic that is
wrong. They will appear once the clinic is no longer flagged demo (after `activate-live`), or
if the sample override is changed to merge rather than replace.

### 3. `plan-round` creates a second round instead of replacing one

Running `plan-round` twice for the same clinic and date books **two rounds**, and both show in
the Agenda's day picker. `hyline-dental` currently has two rounds for Tue Oct 27 — one with 5
stops, one with 15. `planRound` only reuses a round when given an explicit `--id`, which the
script never passes. It should match on `(clinic, date, staff)` and replace.

### 4. No owner/staff separation

One login per clinic sees every screen. The spec asked for the practice owner and the field rep
to have different views and permissions. Not built. Today `hylinedental` is Alexis's login and
also, functionally, the owner's.

### 5. Round creation is CLI-only

There is no admin UI. Rounds are booked from the Render Shell with `plan-round`.

---

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
