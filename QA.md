# Delivery checks

Checked 22 October 2026, and again on 23 October 2026 for the Network Map.
This report distinguishes automated checks from hosting/visual review.

## Network Map, 23 October 2026

- TypeScript strict type check: PASS.
- Automated tests: 43 passed, 0 failed (25 existing, 18 new). None of the existing tests changed.
- Production build: PASS. Bundle approximately 271 KB, 83 KB compressed; CSS approximately 38 KB, 8 KB compressed. No map library, no tile requests, no new dependency of any kind.
- npm audit: 0 reported vulnerabilities.
- Browser pass completed this time, on a throwaway database with fictional businesses, at 1440x950 and at 375x812: sign in, open the Network Map, filter and search, zoom by distance, open a cluster, read a business card, add and reorder three stops, check the Google Maps route link, send a visit request, accept it from the terminal, and see the client's status change to "Scheduled by the team". No console errors.
- The throwaway database and its fictional records were deleted afterwards. The live local database was not written to; it still holds only the real ETHR LAB account.
- NOT verified: a real call to Google Places. No request was made against the live key, so the discovery path is proven only against an injected test double, and the exact shape of live Places responses for these categories in this area is unconfirmed. Run `npm run refresh-network-map -- --clinic clinic-slug` once with the key set to confirm it.

### Network Map security review

| Threat / check | Severity if unmitigated | Likelihood | Impact | Status |
|---|---|---|---|---|
| A client reading another clinic's map or requests | High | Medium | Client data exposure | PASS: every network query takes its clinic from the session row only; `?clinicId=` is ignored; tested |
| A conflict warning disclosing which clinic holds an agreement | High | Medium | Client confidentiality | PASS: owner clinic and record notes never leave the server; the payload is asserted free of both |
| Routing a client to a competitor or a restricted business | High | Medium | Breach of an agreement | PASS: the refusal is re-run server-side on save and on request; browser state cannot override it |
| Borrowing another clinic's place ID to route to it | Medium | Low | Cross-tenant leakage | PASS: a place ID not on this clinic's own map is dropped |
| More than five stops, or duplicates | Low | Medium | Operational noise | PASS: capped and de-duplicated server-side |
| The Google Places key reaching a browser | High | Medium | Key theft and billing abuse | PASS: read in one module, used in one header, absent from every payload; asserted by test. No browser map key is claimed or used |
| Spending Places calls on every page view | Medium | High | Unbounded Google billing | PASS: one pass per category per cooldown window; the client-facing refresh obeys the same cooldown; a forced pass is a terminal command |
| Holding Google content past its terms | Medium | Medium | Terms breach | PASS: place IDs kept, all other Google content expires at 30 days and is purged on read; tested |
| Cross-origin writes to the network endpoints | High | Medium | Unauthorized changes | PASS: the existing exact-origin check covers them; tested |
| SQL injection through the new tables | High | Low | Database access | PASS: bound parameters throughout |
| Invented businesses, ratings or statuses | Medium | Medium | Misleading a client | PASS: no placeholder data anywhere; an unconfigured or failing lookup shows an explained empty state |

### Still to build

- A web operations screen for route requests. They are stored and complete, and handled from the terminal with `npm run route-requests`; there is no admin UI and no email or notification when a client asks for a visit.
- An embedded Google basemap. It needs a second, HTTP-referrer-restricted browser key and three Content-Security-Policy entries; until then the map is a coordinate plot with Google Maps links.
- A clinic's saved location is set from the terminal. There is no screen for it.

## Results

- TypeScript strict type check: PASS.
- Optimized Vite production build: PASS.
- Automated tests: 19 passed, 0 failed.
- npm audit after dependency installation: 0 reported vulnerabilities.
- Production dependency audit: 0 reported vulnerabilities.
- Built JavaScript: approximately 241 KB, 75 KB compressed; CSS approximately 19 KB, 5 KB compressed. No charting library, animation library, external font requests, or video asset.
- Original website logo and favicon files are included locally, without alteration.
- Source imports were reviewed: campaign data is server-only at runtime. UI imports of its types disappear from the browser build.
- Responsive CSS includes desktop/tablet/phone breakpoints, three stacked stat cards on mobile, stacked analysis panels, and a horizontally scrollable semantic table.
- Native dialog supplies modal focus handling and Escape behavior. Filtering controls are semantic buttons/selects with pressed state. Charts include accessible labels. Reduced-motion and keyboard-focus treatments are implemented.
- Browser visual/interaction QA was not completed: the available browser tool refused the local preview URL as an internal address. No bypass was attempted. Functional HTTP/auth and data tests ran locally instead. Please perform a final visual pass on your target desktop and phone browsers after running the app.

## Security review

| Threat / check | Severity if unmitigated | Likelihood | Impact | Status |
|---|---|---|---|---|
| Cross-clinic record access | High | Medium | Client data exposure | PASS: session clinic is the only query scope; second-clinic isolation test passes |
| Anonymous data access | High | Medium | Contact disclosure | PASS: no session returns no campaign data; type-only imports exclude sample data from client code |
| Plaintext passwords | High | Medium | Account compromise | PASS: salted scrypt hashes; timing-safe comparison |
| Session fixation / replay after logout | High | Medium | Account access | PASS: cryptographic random tokens, hashed server-side, rotated on login, revoked on logout, eight-hour expiry |
| Cross-origin mutations | High | Medium | Unauthorized sign-in/sign-out actions | PASS: exact origin checks and SameSite=Strict cookies |
| Brute-force attempts | Medium | Medium | Account compromise / resource use | PASS: SQLite-backed per-IP and email attempt limits |
| SQL injection | High | Medium | Database access | PASS: bound parameters for all request-derived values |
| Path traversal | High | Low | Server file exposure | PASS: static files resolve only inside dist/client |
| Demo accidentally retained | High | Medium | Public sample login | PASS: production mode disables sample by default; explicitly disabling it rejects existing sample accounts too |
| Secrets in archive | High | Low | Credential exposure | PASS: no private credentials, .env, SQLite runtime files, platform scaffolding, or dependency folders are included |
| Dependency vulnerabilities | Varies | Varies | Varies | PASS: npm audit reports none at delivery time |
| HTTPS and persistent storage | High | Medium | Data/cookie loss or interception | OWNER HOSTING STEP: configure domain, HTTPS proxy, production flags, persistent disk and encrypted backups |
| MFA / self-service reset | Medium | Medium | Account recovery limitations | NOT INCLUDED: trusted CLI provisioning and phone access support only |
| Regulatory compliance | High | Contextual | Sensitive data handling | NOT CERTIFIED: assess policies and infrastructure before using real health-related data |

## Known product boundaries

- Fictional sample data, not connected to live QR/NFC intake or a clinic CRM.
- Includes a validated campaign import path; integrating your real feed is a server-side step and does not require UI changes.
- One local SQLite file; suitable for a single Node server with persistent disk. Horizontal multi-instance hosting needs a shared database adaptation.
- Application sessions use secure cookies on HTTPS. Localhost-only HTTP uses a separately named development cookie.
- NEW badges follow the current UTC calendar date; they age out naturally.
- Percentages are rounded individually (the provided sample intentionally displays 28/28/17/11/11/6 and can sum to 101).
- The final ZIP is not deployed or publicly listed.
