# Delivery checks

Checked 22 October 2026. This report distinguishes automated checks from hosting/visual review.

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

## Partner network checks (23 October 2026)

- `npm test`: 41 passed, 0 failed (19 existing, 22 new in `tests/partner.test.ts`: joining, invitation limits,
  duplicates, validation and escaping, partner isolation, clinic/partner session separation, CSRF and Origin, account
  changes, sign-in limits, referral attribution and redirect, phone-only call page, no personal fields in stored
  activity, dashboard and report counts, "Not reported" months, QR output).
- `npm run typecheck` and `npm run build`: pass.
- QR codes: SVG and PNG output decoded back to the exact link with an independent decoder (jsQR), including the PNG
  downloaded from the dashboard.
- Manual run against a throwaway database (`npm run build`, `npm start`, clinic and invitation made with the CLI):
  join, error states, dashboard, copy link, print card, details, monthly report and CSV, sign in and out, the referral
  link redirect and the "not active" page, at 390 and 1280 px. axe-core: no violations on any partner page. No
  sideways scrolling.
