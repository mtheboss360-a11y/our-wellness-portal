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
server/network/config.ts  Category rules, weights, limits — the Network Map's one config file
server/network/places.ts  Google Places (New); the only module that reads the API key
server/network/network.ts Cross-reference and fit score, as pure functions
server/network/db.ts      The Network Map's tables and queries, all clinic-scoped
server/network/map.ts     When a Places call may be spent, and when the cache is reused
src/NetworkMap.tsx        The Network Map screen
src/lib/network-math.ts   Clustering, filtering and the Google Maps route link
tests/network.test.ts     Tenancy, conflict rules, route limits, caching and retention
server/runner.ts          Route runner assignments, pickups, supplies, route order, audit
src/RunnerPortal.tsx      The route runner's account: four screens and no more
src/MyRoutes.tsx          The weekly planner — the stops, the pickups, the drawers
src/lib/route-math.ts     The planner's arithmetic: arrival times, windows, allowed moves
src/runner.css            The planner's own styling, scoped under .rr
tests/runner.test.ts      Who may see and change a route, and what a runner may never do
tests/route.test.ts       Estimates, pickup windows and the moves the screen offers
samples/route-runner-planner-reference.html  The standalone planner this was built from
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

## Route runner accounts

A **route runner** is the fourth role beside `admin`, `owner` and `staff` — one of ours in the
field, where `staff` is a practice's own person on the existing portal screens. They sign in and
land on their weekly planner — the routes
assigned to them, what to bring, their pickups, and the guided visit at each business — and
nothing else. The practice's own login is untouched and keeps every screen it had.

```sh
INITIAL_PASSWORD='the-password' npm run add-runner-login -- \
  --clinic hyline-dental --username alexis --name "Alexis"

npm run plan-round -- --clinic hyline-dental --date 2026-10-27 --start 09:00 --staff "Alexis"
npm run assign-round -- --clinic hyline-dental --date 2026-10-27 --username alexis \
  --flyers 100 --treats 50 --cards 25
npm run assign-round -- --clinic hyline-dental --date 2026-10-27 --lock "Karve Pilates"
```

What a runner may change: the **order** of the stops on a route of theirs, the **pickups** they
add among them, what they **confirm** carrying, and the **visits** they record. What they may
not: add or remove an assigned business, move one to another date, change the start time or the
allocation, or touch anybody else's route. Those are refused by the server
(`RUNNER_ENDPOINTS` in `server/http.ts`), not merely absent from the navigation.

Supplies are three different numbers and stay three: `planned` is the office's allocation,
`packed` is the runner's own count of what is in the car, and `visit_materials` is what they
recorded dropping. What is left is the confirmed load, plus collected pickups, less what was
dropped.

Every write carries the `revision` the runner's screen was showing. A change sent against an
older one comes back 409 with the current route, so two phones cannot silently overwrite each
other.

## The Network Map

A signed-in client has two screens, switched from the tabs in the header: **Your report** and
**Network Map**. The map opens on the clinic's own saved location and shows the businesses
around it — fitness studios, yoga and Pilates, physical therapy, chiropractic, salons and
wellness retail — with what the network already knows about each one, and lets the client put
up to five of them on a route.

### Set a clinic up

A clinic with no saved location sees a plain message, not an empty map. Give it one:

```sh
npm run set-clinic-location -- --clinic clinic-slug \
  --label "100 Main St, Naperville, IL 60540" --lat 41.7735 --lng=-88.1520 --radius 5
```

A negative longitude needs the equals sign (`--lng=-88.1520`); without it Node reads the dash
as the next option. `--competitors med-spa,salon` overrides which categories count as direct
competitors for that clinic; the default is the med spa and wellness centre category.

Then load the network's own records — the data every status is decided against:

```sh
npm run import-network-records -- --file ./network-records.json
```

Each record is `{ id, kind, ownerClinicId, placeId, name, address, note }`, where `kind` is
`client`, `partner`, `exclusive`, `competitor` or `blocked`. `ownerClinicId` is the clinic that
holds the arrangement. It decides whether another clinic sees "Already in network" or
"Unavailable", and **it is never sent to a browser**: a client is told that an agreement exists,
never whose it is. Records are matched to a business by place ID first, then by a normalised
name, then by house number plus ZIP.

### What a client sees

Each business gets a plain-language status and a reason:

| Status | Means | Can it go on a route? |
| --- | --- | --- |
| Good referral fit | Likely shared clientele, no known conflict | Yes |
| Already in network | Approved for this clinic already | Yes |
| Possible conflict | Another arrangement, or a business in two lines of work | Yes, and the request is flagged for review |
| Unavailable | An agreement or a do-not-approach record covers it | No |
| Direct competitor | Sells the same sessions nearby | No |

The fit score is 0-100: up to 60 for the category and up to 40 for distance, both shown with
the reason. **Google's rating and review count are not inputs** — they are displayed as context
with the caveat that a popular business is not one that has agreed to anything.

`routable: false` is enforced on the server, not in the browser: `saveSelection` and
`createRouteRequest` re-run the same cross-reference and drop anything refused, so editing a
request cannot route a clinic to a competitor or a restricted business.

### Routes

**Start Route** opens an ordinary Google Maps directions link (the Maps URLs API — no key, no
billing, no route optimisation) with the clinic as the origin and the stops in the order the
client arranged them. Google drives them in that order and does not reorder them.

**Schedule Route** creates a visit request with the dates, a contact and the stops. It is
created as `requested` and the portal says "Requested — not scheduled yet" until the team
accepts it. There is no web operations screen yet; requests are handled from the terminal:

```sh
npm run route-requests                                    # everything, newest first
npm run route-requests -- --status requested              # the ones waiting
npm run route-requests -- --accept <id> --note "Wed 3pm"  # the client then sees "Scheduled by the team"
npm run route-requests -- --decline <id> --note "..."
npm run route-requests -- --complete <id>
```

### The Google Places key, and what is stored

The server reads `process.env.Google_places_API` — that exact, case-sensitive name, set in the
Render dashboard. It is used in one place, the `X-Goog-Api-Key` header in
`server/network/places.ts`, and is never logged, never returned by an endpoint and never sent
to the browser.

Opening the map does **not** search Google. One discovery pass — a Nearby Search per category —
runs when a clinic's cache is empty or when its refresh cooldown has passed, and the result is
reused until then. Google Maps Platform terms allow a place ID to be kept indefinitely and its
content for up to 30 days, so `map_place_ids` keeps the IDs and `map_places` keeps names,
addresses, coordinates and ratings with a 30-day expiry that is purged on read. Set
`NETWORK_MAP_AUTO_DISCOVER=false` to stop the automatic pass and refresh by hand instead:

```sh
npm run refresh-network-map -- --clinic clinic-slug
```

If the key is missing or refused, the map says so plainly and stays empty. No business, rating
or status is ever invented.

### The map itself

There is **no embedded Google basemap**. The server-side Places key must never be exposed to a
browser, and no referrer-restricted browser key is configured for this project. The map is
drawn from coordinates instead: the clinic at the centre, distance rings, one circular marker
per business coloured and iconed by category, crowded areas gathered into clusters that spread
open when tapped, and the distance filter doubling as the zoom. Every business also carries its
own Google Maps link, and the route opens in Google Maps.

To add a real Google basemap later you need a **second, browser-restricted Maps JavaScript API
key** (HTTP-referrer restricted to the portal's domain), exposed to the client as a `VITE_`
variable, plus `https://maps.googleapis.com` added to `script-src`, `img-src` and `connect-src`
in the Content-Security-Policy in `server/http.ts`. Until both exist, the coordinate plot is
what ships.

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
