# Agency batches

Hand-researched shortlists of businesses for a clinic's Network Map, one file per batch.

A file holds Google **place IDs** and the agency's own note on each — never a cached name,
address or rating, which the Maps terms do not let us keep outside the 30-day cache. The names
in these files are there so a human can read the list; the import re-fetches everything from
Google and the map shows what came back, not what is written here.

    npm run import-map-places -- --clinic ethr-lab --file ./agency/ethr-lab-batch-1.json

Re-run a batch when it ages out of the 30-day cache. Batches never overwrite each other: the
import adds place IDs, and a business already on the map is simply refreshed.

- `ethr-lab-batch-1.json` — 15 referral candidates within five miles of ETHR LAB, researched
  2026-10-25. Independent ownership is **not** verified for any of them: each has one
  Google-listed location and no franchise disclosure on its site, which is why it made the
  list, but that is not proof. Chains, franchises, public facilities (park district, YMCA) and
  anything selling cryo, HBOT, IV or injectables were excluded by hand.

A batch carries only businesses the cross-reference clears outright. Run the import, read the
status it prints beside each one, and take out anything that is not **Good referral fit** — a
competitor or a "needs review" is the agency's problem to settle, not something to put in front
of a client. Six of this batch's first fifteen went that way and were replaced.

## A curated map

A clinic can run on batches alone instead of on what discovery finds. That is two settings
together, and neither works without the other:

1. `NETWORK_MAP_AUTO_DISCOVER=false` on the server, so opening the map never adds anything.
2. `npm run prune-map -- --clinic <id> --file ./agency/<batch>.json` (one `--file` per batch
   the clinic keeps), to take off whatever a discovery pass left behind.

ETHR LAB runs this way: the client is shown researched businesses only, so no competitor and
no "needs review" ever reaches the screen. The cost is that nothing refills the map — cached
Google content expires after 30 days, and an expired curated map is an empty one. Re-run
`import-map-places` for every live batch each month.
