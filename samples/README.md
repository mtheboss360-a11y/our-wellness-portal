# Sample feed

`orchard-lantern.json` is a fictional campaign feed: an invented integrative
wellness clinic, invented host businesses, `example.invalid` emails and reserved
555-0100–0199 phone numbers. Nine months, 500 marketing materials each, 90 leads.

It exists so a demo account can be shown to a prospect without exposing a real
client's drops and contacts.

The server never reads this file. Nothing is seeded at boot and there is no
sample mode in the build; a demo account is an ordinary clinic that someone
imported this feed into by hand:

    npm run create-client -- --clinic orchard-lantern --name "Orchard Lantern Integrative Wellness" --username <name>
    npm run import-campaigns -- --clinic orchard-lantern --file samples/orchard-lantern.json

Tenant scoping keeps it apart from every real clinic. Never import a real
client's data here, and never import this feed into a real client's clinic.

## Network records

`network-records.example.json` shows the five kinds of record the Network Map
cross-references against, with invented businesses and placeholder clinic slugs.
It is a shape reference, not data to import:

    npm run import-network-records -- --file ./your-real-records.json

`ownerClinicId` is the clinic that holds an arrangement. It decides whether
another clinic reads "Already in network" or "Unavailable", and it never leaves
the server — a client is told an agreement exists, never whose it is. `placeId`
is the strongest match; a name, or a house number plus ZIP, is matched when
there is no place ID.

## Field log (Drivers & routes)

`field-log.sample.json` is a fictional field log for the same demo clinic: six invented
drivers (portraits are AI-generated, in `public/assets/field/`), seven routes of 5 or 10
stops, and the staff sign-ups that came back. Load it into the demo clinic only:

    npm run import-field-log -- --clinic orchard-lantern --file samples/field-log.sample.json

Every figure the portal shows is a count of these rows. For a real clinic they come from two
Google Forms and the sheet they write to:

| Feed field | Where it comes from |
| --- | --- |
| `routes[].date`, `start`, `driverId` | The route plan (one row per route) |
| `stops[].arrived`, `left` | Stop form: "Time in", "Time out" |
| `stops[].spokeWith` | Stop form: "Who did you speak with?" (Owner / Manager / Front desk) |
| `stops[].staffOnShift` | Stop form: "Staff on shift" |
| `stops[].boxes`, `coffees`, `cards` | Stop form: "Boxes", "Coffees", "Referral cards handed out" |
| `stops[].display` | Stop form: "Counter card placed?" |
| `stops[].outcome` | Stop form: "Outcome" (Joined / Follow-up / Not now) |
| `stops[].note`, `photo` | Stop form: "Notes", "Photo" (saved under `/assets/field/`) |
| `stops[].crossRef` | The team's match notes for that business |
| `signups[]` | Sign-up form behind each tap card / QR code: first name, card, service, date |
| `signups[].status` | The clinic's front desk column in the sheet: New / Called / Booked |
