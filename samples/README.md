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
