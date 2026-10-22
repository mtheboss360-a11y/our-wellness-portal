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
2. Copy `.env.example` to `.env`, then set `NODE_ENV=production`, `ENABLE_SAMPLE_DATA=false`, and `APP_ORIGIN=https://your-portal-domain` (no trailing slash).
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
