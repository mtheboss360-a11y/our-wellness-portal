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

- `npm test`: 49 passed, 0 failed (26 existing in `tests/portal.test.ts`, 23 in `tests/partner.test.ts`: joining,
  invitation limits and withdrawal, no invitations before a destination, duplicates in any spelling or alphabet,
  homoglyphs, validation and escaping, isolation with a second active partner (exact tiles, history, report and CSV,
  QR content in all four places, renames), clinic/partner session separation, CSRF and Origin on every form, account
  changes, sign-in limits that never count a correct password, the proxy address rule, referral attribution, the
  canonical link, visit limits and bounded storage, counting never blocking the redirect, phone-only and
  no-destination behaviour, no personal fields in stored activity, "Not reported" in the dashboard, report and CSV,
  import date rules, leaving the network, QR output, and the stylesheet's hidden and contrast rules).
- Mutation check: 18 deliberate defects (unscoped queries, no CSRF or Origin check, wrong QR link, rename hitting other
  partners, no visit or probe limits, future imports, counting correct passwords, leftmost proxy address, visit errors
  blocking the redirect, and others): 17 fail the suite. The one that passes removes a second guard (sessions of a
  partner who left are also deleted when they leave).
- An independent five-lens review (security, privacy against the brief, correctness, phone use and accessibility,
  adversarial testing) confirmed 39 findings, each re-checked by a second reviewer; all are fixed or, where noted in
  the README, documented. One is left as a follow-up by choice: the clinic sign-in's reading of X-Forwarded-For.
- `npm run typecheck` and `npm run build`: pass.
- QR codes: SVG and PNG output decoded back to the exact link with an independent decoder (jsQR), including the PNG
  downloaded from the dashboard.
- Manual run against a throwaway database (`npm run build`, `npm start`, clinic and invitation made with the CLI):
  join, error states, dashboard, copy link, print card, details, monthly report and CSV, sign in and out, the referral
  link redirect and the "not active" page, at 390 and 1280 px; axe-core on every partner page; no sideways scrolling.
