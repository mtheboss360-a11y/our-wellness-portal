# ETHR LAB on production — the exact commands

Everything below was run end to end on a local database first and verified in both portals.
Nothing here has been run against production.

## Why you have to run these, not me

Account creation in this portal is CLI-only — there is no admin HTTP endpoint (see the route
list in `server/http.ts`). The scripts write to the SQLite file named by `DATABASE_PATH`, and on
Render that is `/data/portal.sqlite` on the service's persistent disk (`render.yaml`). That disk
is only reachable from inside the running service, so these must be run in the
**Render dashboard → our-wellness-portal → Shell**.

I could not read production either, so I do not know whether `ethr-lab` already exists there.
**Run step 0 first.** If ETHR is already a clinic on production, skip step 1 and tell me — the
rest still applies.

## 0. What is already there

```
npm run list-logins
```

## 1. The practice and Yelena's owner login

Pick a real password and type it in place of the dots. Do not reuse one of yours.

```
INITIAL_PASSWORD='…' npm run create-client -- --clinic ethr-lab --name "ETHR LAB" --username yelena --plan b
npm run set-role -- --username yelena --role owner
```

## 2. Where ETHR is

These are the coordinates and Google place id already resolved for ETHR in your earlier local
work — not guessed, and not re-fetched.

```
npm run set-clinic-location -- --clinic ethr-lab --label "1S550 IL-83 Unit A2, Oakbrook Terrace, IL 60181" --lat 41.8502785 --lng=-87.9586133 --radius 5 --place-id ChIJuxeuYQBNDogRjy6HNcQ19kI
```

The prompt's version of this command had only `--label`. That is rejected: the script requires
`--lat` and `--lng`, and a negative longitude needs the equals sign.

## 3. The route runner login

```
INITIAL_PASSWORD='…' npm run add-runner-login -- --clinic ethr-lab --username ethrroute --name "ETHR Route"
```

## 4. The five businesses

`data/releases/ethr-release-1.json` is on the `ethr-lab-portals` branch. It has to be in the
deployed code for this to run, so this step comes after that branch is merged — and merging
deploys, so it waits on your word.

```
npm run release-businesses -- --clinic ethr-lab --file data/releases/ethr-release-1.json
npm run geocode-release -- --clinic ethr-lab --dry-run
npm run geocode-release -- --clinic ethr-lab
```

The dry run locally matched all five on street number and town. Run it on production too and
read it before the real one.

## 5. The round

Change the date if the walk is not that day.

```
npm run plan-round -- --clinic ethr-lab --date 2026-10-29 --start 09:00 --staff "ETHR Route"
npm run assign-round -- --clinic ethr-lab --date 2026-10-29 --username ethrroute --flyers 106 --cards 26
```

`--start 09:00` is held to opening hours by the agenda; locally it moved the first stop to
11:03 AM rather than sending someone to a locked door.

There is no brochure field — the planner carries flyers, treats and referral cards only. Your
26 brochures are going in as `--cards 26`, so the runner's screen will say "26 cards". If you
would rather it said nothing than said the wrong word, drop `--cards 26` and I will put the
brochures in the round note instead.

## 6. Check

```
npm run list-logins
```

Then sign in as `yelena` and as `ethrroute` and look at both.
