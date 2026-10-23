# Our Wellness Network client portal — LIVE

**This is the real portal.** It ships with no sample clinic, no fictional records and no sample
button on the sign-in screen: the only way in is a real client's username and password.
`ENABLE_SAMPLE_DATA=false` in `.env`, and the seeding code is not in this build at all, so the
switch cannot be flipped back by accident.

ETHR LAB is already set up in `var/portal.sqlite`: username **ethrlabs**. The account has no
campaigns yet, so it opens on the empty states. Load its records with `scripts/import-campaigns.ts`.

For the demo you show prospects, use the separate **sample** build. Keep them apart: that is the
whole point of there being two.

A complete, standalone two-screen client portal: sign-in and a responsive campaign report. Includes your genuine website logo and favicon, your green/peony branding, Apple-style native typography, and barely perceptible scroll motion. No Higgsfield account, service, or platform package is needed to run this project.

## Run it

Install Node.js 22.13 or newer (Node 24 LTS recommended), then open a terminal in this folder:

```sh
npm ci
npm run build
npm start
```

Open **http://localhost:3000**. Use this exact hostname unless you change `APP_ORIGIN`.

The ZIP includes `dist/client`, but rebuilding is recommended after installation. For editing with hot reload:

```sh
npm run dev
```

Do not open `index.html` directly or upload only `dist/client` to a static host. The sign-in and report need the included Node server and a writable SQLite database. No paid service or database account is required for local use. Node 22 may print an experimental SQLite notice; Node 24 is recommended.

## Try the fictional clinic

On the sign-in screen press **Sample account**, beside Sign in. It signs you straight in. These
intentionally public sample credentials grant access only to fictional records.

The sample is Orchard Lantern Pediatrics, not a real clinic. All 18 lead email addresses use `example.invalid`; all lead phones use the reserved 555-0100–0199 range. The agency support number and branding are genuine, from your website.

Under **Past jobs**:
- **Fall outreach**: six neighborhoods and 18 leads across September and October 2026.
- **Late-summer welcome**: drops logged, no leads.
- **Summer introduction**: no drops and no leads.

Click a ranked neighborhood or timeline card to filter the table. Click the selected item again to clear. The dropdown and Clear filter control share the same selection. Campaign changes clear the filter. The NEW label is calculated against the server's current UTC calendar date, not permanently attached to a sample lead.

## Project layout

```text
data/portal-data.ts       All sample content and brand contact values
src/Portal.tsx            Both screens and report components
src/styles.css           Palette, Apple-style font stack, responsive layouts
src/lib/portal-math.ts    Pure calculations, sorting, filtering, date logic
src/lib/api.ts            Same-origin API client
src/lib/session.tsx      Session loading and refresh
server/store.ts          SQLite, scrypt passwords, sessions, tenant scoping
server/http.ts           API, origin checks, cookies, static-file serving
server/validation.ts     Campaign-feed validation
scripts/create-client.ts Create an account from the trusted server CLI
scripts/import-campaigns.ts Validate and import a clinic-specific data feed
tests/portal.test.ts      Automated calculations, empty-state and auth tests
public/assets/           Original logo and favicon files from your website
BRAND-SOURCES.md          Exact asset URLs and palette sources
QA.md                    Test results, review, and remaining hosting work
```

## Replace the sample data

`data/portal-data.ts` is the one source of all sample locations and leads. It is imported only on the server; browser imports of its shapes use `import type`, so unauthenticated visitors are not sent the campaign records. The UI consumes a clinic-scoped API response with these unchanged shapes:

```ts
location: { id, name, area, dropDate, flyers }
lead: { id, name, phone, email, locationId, receivedDate }
```

All totals, response rates, shares, ranks, top locations, and sparkline points are derived. A real feed can populate the database through `saveCampaigns` or the import command without changing any UI components.

The sample feed is seeded once into the local database, not overwritten on each page load. Changing sample data after the first run requires importing the updated feed or starting with a separate new database path. Never delete a database containing real clients to refresh a sample.

## Add a real client

There is intentionally no public signup, settings page, or fourth stat card. Create accounts only from a trusted server terminal. Example syntax:

```sh
# Read the password without putting it in command history (bash/zsh):
read -s INITIAL_PASSWORD
export INITIAL_PASSWORD
npm run create-client -- --clinic clinic-slug --name "Your client business name" --email "authorized-client-email"
unset INITIAL_PASSWORD
```

The email argument must be a valid email address. Use at least 12 characters in the initial password and share it securely. Repeating an existing email will fail rather than silently reset the account. This build does not include self-service password reset or MFA.

Import a JSON array of campaigns using the same structure as `data/portal-data.ts`:

```sh
npm run import-campaigns -- --clinic clinic-slug --file /path/to/campaigns.json
```

Each campaign needs `id`, `name`, `period`, `locations`, and `leads`. Import validation checks date format, unique identifiers, positive/zero flyer counts, valid email/phone shapes, and lead-to-location links. Existing campaign IDs for that clinic are updated; omitted campaigns are retained, not deleted. Accounts cannot choose another clinic via a request parameter: clinic identity always comes from the authenticated server session.

## Hosting safely

This is a runnable foundation with real server-side authentication, not a compliance certification. Before putting real client data online:

1. Host on a Node-compatible server with persistent storage, HTTPS, and encrypted backups.
2. Copy `.env.example` to `.env`, then set `NODE_ENV=production`, `ENABLE_SAMPLE_DATA=false`, and `APP_ORIGIN=https://your-portal-domain` (no trailing slash). Sign-ins are accepted from that origin and its www twin (`https://www.your-portal-domain`, or the bare domain if `APP_ORIGIN` starts with `www.`), because the host redirects one to the other; every other origin gets a 403.
3. Keep `HOST=127.0.0.1` behind your HTTPS reverse proxy, or configure container networking deliberately.
4. With HTTPS, cookies use `HttpOnly; Secure; SameSite=Strict` and the `__Host-` prefix. HTTP cookies are allowed only for localhost development.
5. Leave `TRUST_PROXY=false` unless your trusted proxy overwrites X-Forwarded-For and direct access to Node is blocked. The rate limit otherwise uses the socket IP.
6. Create real accounts using the CLI. Disabling sample mode also blocks the sample account even if it remains in an older database.
7. Establish a password reset process, consent/retention policies, access review, monitoring, and appropriate safeguards before storing health-related or sensitive data. The application is not described as HIPAA compliant.
8. Keep the SQLite database off public paths. Do not put runtime databases, `.env`, or passwords in source control or a shared ZIP.

Sample mode is off by default when `NODE_ENV=production`. There is no public listing or analytics/tracking code. `robots.txt` and noindex headers discourage search indexing; authentication, not noindex, protects data.

## Tests

```sh
npm test
npm run typecheck
npm audit
```

The delivered build passed 19 automated tests covering derived numbers, both empty states, filtering, date badges, fictional contact ranges, feed validation, password hashing, anonymous access, generic sign-in errors, clinic isolation, session rotation, sign-out, rate limiting, sample-mode disabling, and HTTP origin/cookie behavior.

## Typography and motion

The UI uses the device's native UI font: San Francisco on Apple devices, Segoe UI on Windows, and appropriate system fallbacks elsewhere. Apple font binaries are not redistributed. The original logo is unchanged. Scroll moves only the headline, at 1% of scroll distance capped at 3px; there is no video download, takeover, or looping animation. Reduced-motion preferences disable motion entirely.

The two charts are inline SVG, not a chart library. There is no dark mode, theme switch, settings page, or leads-per-thousand figure.


## Logins

A login is a **username and a password**, both chosen by the owner. Not an email address, and no
minimum length: the only rule is that neither is empty. Usernames are stored and matched in
lowercase, so case does not matter when signing in.

```sh
INITIAL_PASSWORD='the-password' npx tsx scripts/create-client.ts \
  --clinic ethr-lab --name "ETHR LAB" --username ethrlabs
```

What protects an account is the scrypt hash and the rate limit — twelve failed attempts per
username and per IP in fifteen minutes, then a lockout — not a character count. A short, guessable
password still deserves thought before the portal is on a public address, and the tests cover both
the freedom and the limit: `the owner chooses the username and the password` and
`a weak password is still behind the rate limit`.

## Partner network (the partner-facing side)

A clinic is the hub of a local referral network. A nearby business that doesn't compete with it (a gym, a salon, a
studio, a physical therapy office) joins for free as a **partner**, gets its own referral link and QR code, and sees the
activity that code produces. The clinic's staff do all the calling and booking. This app records where referrals come
from; it is not a patient record and holds nothing about the people who use a partner's link.

### How it fits this codebase

- **Same server, same database.** Partner pages are served by the existing Node server (`server/http.ts` hands
  `/join/...`, `/partner/...` and `/r/...` to `server/partner-http.ts`) and stored in the same `node:sqlite` file, in new
  tables only (`server/partner-store.ts`). An existing database gains them on the next start; no clinic data changes.
- **No framework on the partner side.** The clinic report stays the React app it is. Partner pages are plain HTML from
  the server (`server/partner-views.ts`) with one stylesheet and one small script (`public/assets/partner.css`,
  `partner.js`), because they are opened from a QR code on a phone and must work fast, and with JavaScript off.
- **Clinic actions are terminal commands**, like `create-client` and `import-campaigns`: there is still no admin UI.
- There was no matching or approval module in this repo to reuse; the partner records stand on their own and can link
  to one later.

### Clinic setup (server terminal)

```sh
# 1. Where partner links send people. Prefer the clinic's own booking page: nothing is collected on the way.
npm run clinic-destination -- --clinic clinic-slug --booking-url https://booking.example.com/clinic --ref-param ref
#    (or --phone +16305550100 for a call page; --ref-param adds the partner's code to the booking link)

# 2. An invitation for one business (the link goes on the clinic's introduction card; --qr writes it as a QR code).
npm run partner-invite -- --clinic clinic-slug --business "The Iron Room" --qr iron-room-invite.svg
#    --uses N lets one link onboard N businesses; --days sets how long it stays valid (default 30).

#    No invitation until step 1 is done. --list shows every invitation; --revoke <id> stops one link at once.

# 3. Who has joined, and each partner's code. --pause / --resume CODE turns a partner's link off and on;
#    --remove CODE is how a partner leaves: their sign-in and contact name are deleted and the link stops,
#    while the business name and the anonymous counts stay in the clinic's records.
npm run partners -- --clinic clinic-slug

# 4. Report back what referrals became: counts per code per day, never people.
npm run report-outcomes -- --clinic clinic-slug --file october.json
```

```json
{ "from": "2026-10-01", "to": "2026-10-31", "reports": ["received", "booked"],
  "entries": [ { "code": "AB23CD45", "day": "2026-10-03", "received": 2, "booked": 1 } ] }
```

`reports` says which counts the file covers for every day from `from` to `to`: a covered day with no entry is a real
zero, a day never covered shows as **Not reported**. Importing the same dates again replaces them. Several entries for
the same code and day are added together. An entry with any other field (a name, a phone, a note) is refused, and so is
a file that reaches past today (run a month's report once the month is over) or an entry dated before its code existed.

### What a partner gets

- **`/join/<invitation>`**: which clinic invited them, what the network is, that joining is free, what they receive, and
  that nobody is paid per referral and nobody promises a number of referrals. They give a business name, their name, a
  work email and a password (10+ characters), and are signed in. The partner row records the inviting clinic, the
  invitation and the join time. One business per network (names are compared loosely: "The Iron Room, LLC" is "iron
  room"), one account per email. Invitations are single-use by default, expire, and are stored only as a hash.
- **`/partner`**: the clinic they belong to, their QR code and link (copy, download as SVG or PNG, print a counter
  card at `/partner/print`), three counts with what each one means, an activity history, and an empty state when there
  is nothing yet. **`/partner/report`**: month by month, per code, with a CSV download. **`/partner/details`**: business
  and contact name (renaming changes the name shown, not the business the partner joined as); sign-in email and
  password (current password required); how to leave.
- **The counts are never mixed up.** *Visits through your link or QR code* are counted by this app (once per browser
  per day; link previews, prefetches and `HEAD` requests are not visits). *Referrals the clinic recorded* and *Bookings
  the clinic reported* come only from the clinic's reports, and show "Not reported yet" until the clinic reports them.
  In the activity history they appear as monthly totals, never by day, so a partner who sent one person cannot read
  off whether that person booked. Revenue is never shown.

### The referral link

`/r/<CODE>` (the QR code adds `?via=qr`) counts a visit and sends the person straight to the clinic's booking page, or
to a call page when the clinic only gave a phone. Unknown codes, paused partners and partners who left get a "not
active" page. Nothing asks the person for anything, and nothing about them is stored: visits are kept as one count per
code, day and channel (`referral_visits`), with no IP address and no device details. A one-day cookie scoped to the code
stops one browser counting twice; as a backstop one connection counts at most 3 times a day per code and a code at
most 1,000 times a day, so a flood cannot inflate a partner's numbers or grow the database. The person is always sent
on, even when the visit is not counted or cannot be stored. Visitor pages carry no partner-portal links.

### Security and data rules

- Partners have their **own tables, sessions and cookie** (`__Host-owc-partner`), so a partner session cannot open the
  clinic report or `/api/portal`, by construction. Every partner query is scoped by the partner id from the session;
  no request parameter can name another partner or clinic. A partner never sees other partners or anyone's details.
- Every state change is a `POST` that must come from this site (the existing Origin check) and carry the session's
  CSRF token. Cookies are `HttpOnly` and `SameSite=Lax`, `Secure` on HTTPS.
- Input is validated on the server with zod and cleaned (no control characters, collapsed spaces, length limits).
  All SQL is parameterised. Every value on a page is HTML-escaped. The existing CSP applies (no inline script).
- Rate limits use the existing `attempts` table. Only failed sign-ins count (per address, per address and email, and a
  much higher per-email ceiling, so a stranger cannot lock a partner out). Each invitation answers at most five "already
  joined" questions, and renames are limited. Password checks are capped at 120 a minute across the server, so a flood
  gets "busy" answers instead of tying up the server. Passwords use the existing salted scrypt hashing. Partner sessions
  last 14 days; a new password ends the account's other sessions.
- **Proxies:** with `TRUST_PROXY=true`, the client address is read `TRUST_PROXY_HOPS` entries from the right of
  X-Forwarded-For (default 1: one proxy, such as Render alone; 2 for Cloudflare in front of Render). Never the leftmost
  entry, which the client writes itself. Check the live chain before raising it. The clinic sign-in (`/api/login`) still
  uses its original reading of the header; switching it to `server/client-ip.ts` is a follow-up once the chain is known.
- The database waits up to 1.5 s for a clinic command to finish writing instead of failing a request; the commands
  wait up to 10 s.
- Comments marked `LEGAL/PRIVACY REVIEW` mark what counsel should look at before real partners join: the terms a
  partner accepts, the courtesy the clinic offers partner staff (referral-payment rules), sharing aggregate counts with
  partners, and the visit cookie. This app is not described as HIPAA compliant.

### Known gaps

- Clinic actions are command-line only; there is no clinic screen for partners or invitations yet.
- One sign-in per email: a business in two clinics' networks needs a second email. Because emails are unique, the join
  and account forms can confirm that an email already has an account (behind the rate limits); closing that fully needs
  email verification.
- Leaving goes through the clinic (`npm run partners -- --remove CODE`); there is no self-service button yet.
- No self-service password reset (same as clinic accounts): partners are told to call or text.
- Visits are counted per browser per day; someone clearing cookies or switching devices counts again.
- The clinic report (React) still carries the old "Our Wellness Network" name; the partner pages use Our Wellness
  Connections.
