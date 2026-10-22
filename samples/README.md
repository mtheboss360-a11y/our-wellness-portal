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
