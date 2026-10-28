import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createReadStream, existsSync, statSync, readFileSync } from 'node:fs';
import { resolve, extname, sep } from 'node:path';
import { z } from 'zod';
import { bakeryChoiceInput, bakeryRemoveInput, deviceLocationInput, itemsRequestInput, routeRequestInput, selectionInput, visitNoteInput, recordVisitInput, editVisitInput, saveScriptInput } from './validation';
import { packedInput, pickupActionInput, pickupInput, reorderRouteInput, runnerVisitInput } from './validation';
import { RoundConflict, SUPPLY_KEYS, type RunnerRound, type Supplies } from './runner';
import { attributeVisits } from '../src/lib/route-math';
import { DEFAULT_RADIUS_MILES } from './network/config';
import { ensureDiscovery } from './network/map';
import { bakeryPayload, ensureBakeries } from './network/bakeries';
import { configured as placesConfigured } from './network/places';
import type { ViteDevServer } from 'vite';
import type { PortalStore } from './store';
const loginInput = z.object({ username: z.string().trim().toLowerCase().min(1).max(254), password: z.string().min(1).max(256) });
type Options = { store: PortalStore; origin: string; secure: boolean; root: string; vite?: ViteDevServer; trustProxy?: boolean };
const mime: Record<string, string> = { '.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.ico':'image/x-icon','.svg':'image/svg+xml','.jpg':'image/jpeg','.webp':'image/webp','.woff2':'font/woff2','.webmanifest':'application/manifest+json' };
/* Sign-ins may come from the configured origin or its www twin: the host redirects one to the other, so the page runs on
   whichever is canonical. Any other origin is refused. A local origin has no twin. */
export function allowedOrigins(origin: string) {
  const url = new URL(origin);
  if (['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return new Set([origin]);
  const twin = new URL(origin); twin.hostname = url.hostname.startsWith('www.') ? url.hostname.slice(4) : `www.${url.hostname}`;
  return new Set([origin, twin.origin]);
}
/**
 * WHAT A ROUTE RUNNER'S ACCOUNT MAY REACH. An allowlist, not a list of things to block: an
 * endpoint added later is closed to a runner until somebody puts it here on purpose.
 *
 * Hiding navigation is not a permission. Every one of these is checked again inside its
 * handler — the round has to be one assigned to the person asking — and everything else under
 * /api is refused outright, so platform-wide client data, billing, the referral network's
 * controls and the office's own screens are unreachable from a runner's session whatever the
 * browser sends.
 */
export const RUNNER_ENDPOINTS: ReadonlyArray<{ path: string; methods: readonly string[] }> = [
  { path: '/api/health', methods: ['GET'] },
  { path: '/api/portal', methods: ['GET'] },
  { path: '/api/login', methods: ['POST'] },
  { path: '/api/logout', methods: ['POST'] },
  { path: '/api/runner/routes', methods: ['GET'] },
  { path: '/api/runner/business', methods: ['GET'] },
  { path: '/api/runner/history', methods: ['GET'] },
  { path: '/api/runner/visit', methods: ['POST'] },
  { path: '/api/runner/order', methods: ['POST'] },
  { path: '/api/runner/pickup', methods: ['POST'] },
  { path: '/api/runner/pickup/remove', methods: ['POST'] },
  { path: '/api/runner/pickup/collected', methods: ['POST'] },
  { path: '/api/runner/packed', methods: ['POST'] },
];
export function runnerMayCall(pathname: string, method: string) {
  const allowed = RUNNER_ENDPOINTS.find(entry => entry.path === pathname);
  return !!allowed && allowed.methods.includes(method === 'HEAD' ? 'GET' : method);
}
function json(response: ServerResponse, status: number, value: unknown) { response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); response.end(JSON.stringify(value)); }
async function body(request: IncomingMessage) {
  if (!request.headers['content-type']?.startsWith('application/json')) throw new Error('content-type');
  let size = 0; const chunks: Buffer[] = [];
  for await (const chunk of request) { size += chunk.length; if (size > 4096) throw new Error('too-large'); chunks.push(Buffer.from(chunk)); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
export function createPortalServer(options: Options) {
  const { store, origin, secure, root, vite } = options;
  const allowed = allowedOrigins(origin);
  const cookieName = secure ? '__Host-owo-session' : 'owo-local-session';
  const cookieFlags = `Path=/; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}`;
  return createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'same-origin');
    response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(self)'); // the Network Map may ask for the clinic's location
    response.setHeader('X-Robots-Tag', 'noindex, nofollow');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Security-Policy', `default-src 'self'; script-src 'self'${vite ? " 'unsafe-inline'" : ''}; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'${vite ? ' ws://localhost:* ws://127.0.0.1:*' : ''}; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'`);
    if (secure) response.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    try {
      const url = new URL(request.url ?? '/', origin);
      const cookie = request.headers.cookie?.split(';').map(part => part.trim()).find(part => part.startsWith(cookieName + '='))?.slice(cookieName.length + 1);
      if (url.pathname.startsWith('/api/')) {
        // Every method that changes something, not only POST. PATCH and DELETE are as much a
        // cross-site risk as POST, and leaving them out of this check is how that gets missed.
        const reads = request.method === 'GET' || request.method === 'HEAD';
        if (!reads && !allowed.has(request.headers.origin ?? '')) { json(response, 403, { error: 'Please refresh and try again.' }); return; }
        // A health check anyone can read: whether the server sees a Places key, never the key itself, and the
        // NAMES (no values) of any environment variables that look like one, so a misnamed key can be spotted.
        if (url.pathname === '/api/health' && request.method === 'GET') {
          json(response, 200, { ok: true, placesKey: placesConfigured(), placesVariableNames: Object.keys(process.env).filter(name => /place/i.test(name)).sort() });
          return;
        }
        if (url.pathname === '/api/portal' && request.method === 'GET') { json(response, 200, store.snapshot(cookie)); return; }
        if (url.pathname === '/api/login' && request.method === 'POST') {
          let input;
          try { input = loginInput.safeParse(await body(request)); } catch { json(response, 400, { error: 'Please check your sign-in details.' }); return; }
          if (!input.success) { json(response, 200, { ok: false, message: "Those details didn't match. Please check your email and password and try again." }); return; }
          const forwarded = request.headers['x-forwarded-for'];
          const ip = options.trustProxy && typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : request.socket.remoteAddress ?? 'unknown';
          const result = store.signIn(input.data.username, input.data.password, ip, cookie);
          if (result.ok) response.setHeader('Set-Cookie', `${cookieName}=${result.token}; ${cookieFlags}; Max-Age=28800`);
          json(response, 200, { ok: result.ok, message: result.message }); return;
        }
        // A ROUTE RUNNER'S SESSION reaches its own routes and nothing else. The role is read
        // from the account row, so no header, query or body can claim it or shed it.
        const signedIn = store.clinicFromToken(cookie);
        if (signedIn?.role === 'route_runner' && !runnerMayCall(url.pathname, request.method ?? 'GET')) {
          json(response, 403, { error: 'Your account covers your own routes and visits. Anything else is your office’s to change.' });
          return;
        }

        // THE WEEKLY PLANNER. Assigned routes, the pickups a runner adds to them, the supplies
        // they confirm carrying and the visits they record. Every handler asks the runner layer
        // whether this round is theirs; a round id belonging to anybody else is simply not found.
        if (url.pathname.startsWith('/api/runner/')) {
          if (!signedIn) { json(response, 401, { error: 'Please sign in again to open your routes.' }); return; }
          // A PRACTICE OWNER IS NOT A RUNNER. Their own rounds would come back empty anyway —
          // nothing is assigned to them — but the planner's endpoints are not theirs to call,
          // and saying so is better than an empty week that looks like a bug.
          if (signedIn.role === 'owner') {
            json(response, 403, { error: 'An owner account does not run routes. Your practice’s rounds are on your dashboard.' });
            return;
          }
          const clinic = signedIn;
          const who = { id: clinic.user_id, displayName: clinic.display_name ?? '' };
          const runner = store.runner;

          // One shape for a route, whichever endpoint returns it: the stops in order, what the
          // office allocated, what the runner confirmed, and what is left in the car.
          const shape = (round: RunnerRound) => ({
            ...round,
            collected: runner.collectedSupplies(clinic.id, round.id),
            dropped: runner.droppedOnRound(clinic.id, round.id),
            remaining: runner.remaining(clinic.id, round.id, round.supplies.packed),
          });
          const sendRoute = (round: RunnerRound) => json(response, 200, { route: shape(round) });

          // A write is refused where the route is not theirs (403), where the office changed it
          // first (409, with the current route so the screen can reload rather than guess), and
          // with the reason itself where the reason is the runner's to fix.
          const refuse = (error: unknown, roundIdValue: string) => {
            if (error instanceof RoundConflict) {
              const current = runner.round(clinic.id, roundIdValue);
              json(response, 409, { error: error.message, route: current ? shape(current) : null });
              return;
            }
            const message = error instanceof Error ? error.message : 'That change could not be saved.';
            // "Not yours", "fixed by the office" and "already finished" are all the same kind of
            // answer — you may not move that — so they get the same status.
            json(response, /not assigned to you|fixed in place|already finished/.test(message) ? 403 : 400,
              { error: message });
          };

          const readBody = async () => { try { return await body(request); } catch { return null; } };

          // The planner needs visits recorded against its rounds to work out completion, plus
          // this runner's own older visits without a round for explicitly labelled inference.
          // Do not send another employee's unrelated contacts and notes simply because both
          // employees were assigned the same business on different rounds.
          const visitsForAssignedRounds = (rounds: RunnerRound[]) => {
            const allowedRounds = new Set(rounds.map(r => r.id));
            const allowedBusinesses = new Set(rounds.flatMap(r => r.items
              .filter(item => item.kind === 'business')
              .map(item => item.id)));
            return store.outreach.visits(clinic.id).filter(visit => visit.roundId
              ? allowedRounds.has(visit.roundId)
              : allowedBusinesses.has(visit.businessId)
                && (visit.recordedBy === who.id || visit.recordedBy === null));
          };

          if (url.pathname === '/api/runner/routes' && request.method === 'GET') {
            const assigned = runner.assignedRounds(clinic.id, who);
            const routes = assigned.map(shape);
            const where = store.clinicLocation(clinic.id);
            const visibleVisits = visitsForAssignedRounds(assigned);
            const visibleIds = new Set(visibleVisits.map(visit => visit.id));
            json(response, 200, {
              routes,
              visits: visibleVisits,
              // Breakdowns are clinic-wide internally. Send only those whose visits this
              // runner is authorized to see, never another employee's visit ids or counts.
              materials: Object.fromEntries(Object.entries(runner.visitMaterials(clinic.id))
                .filter(([visitId]) => visibleIds.has(visitId))),
              clinic: where ? { lat: where.lat, lng: where.lng, label: where.label } : null,
              practice: clinic.name,
              runner: { name: clinic.display_name || null },
            });
            return;
          }

          // One business, with its script and its history — only where it is on the round of
          // theirs that the caller names.
          if (url.pathname === '/api/runner/business' && request.method === 'GET') {
            const id = url.searchParams.get('id') ?? '';
            const on = url.searchParams.get('round') ?? '';
            if (!runner.roundStopFor(clinic.id, on, id, who)) {
              json(response, 404, { error: 'That business is not on that route of yours.' }); return;
            }
            json(response, 200, {
              business: store.outreach.business(clinic.id, id),
              script: store.outreach.script(clinic.id, id),
              visits: store.outreach.visits(clinic.id, id),
            });
            return;
          }

          // THEIR OWN WORK, newest first: the visits this login recorded. Not every visit at a
          // business that happens to be on a route of theirs — those belong to the practice and
          // are on the practice's own screens. A visit recorded before this was tracked has no
          // author and appears for nobody rather than being credited to a guess.
          if (url.pathname === '/api/runner/history' && request.method === 'GET') {
            const mine = store.outreach.visitsRecordedBy(clinic.id, who.id);
            json(response, 200, {
              visits: mine,
              rounds: Object.fromEntries(runner.assignedRounds(clinic.id, who).map(r => [r.id, r.date])),
            });
            return;
          }

          if (url.pathname === '/api/runner/order' && request.method === 'POST') {
            const input = reorderRouteInput.safeParse(await readBody());
            if (!input.success) { json(response, 400, { error: 'That new order could not be read.' }); return; }
            try {
              // A business may appear on more than one round. A visit to it on an older
              // round must not freeze the same business when assigned as a follow-up later.
              // Match each visit to exactly one round, using the same logic as the planner.
              const myRounds = runner.assignedRounds(clinic.id, who);
              const visits = visitsForAssignedRounds(myRounds);
              const assigned = attributeVisits(myRounds, visits);
              const completed = new Set(visits
                .filter(v => assigned.get(v.id)?.roundId === input.data.roundId)
                .map(v => v.businessId));
              sendRoute(runner.reorder(clinic.id, input.data.roundId, input.data.order, who, {
                revision: input.data.revision, completed,
              }));
            } catch (error) { refuse(error, input.data.roundId); }
            return;
          }

          if (url.pathname === '/api/runner/pickup' && request.method === 'POST') {
            const input = pickupInput.safeParse(await readBody());
            if (!input.success) { json(response, 400, { error: input.error.issues[0]?.message ?? 'Please check the pickup details.' }); return; }
            const { roundId: id, pickupId, revision, ...draft } = input.data;
            try {
              sendRoute(pickupId
                ? runner.updatePickup(clinic.id, id, pickupId, draft, who, { revision })
                : runner.addPickup(clinic.id, id, draft, who, { revision, demo: store.isDemoClinic(clinic.id) }));
            } catch (error) { refuse(error, id); }
            return;
          }

          if (url.pathname === '/api/runner/pickup/remove' && request.method === 'POST') {
            const input = pickupActionInput.safeParse(await readBody());
            if (!input.success) { json(response, 400, { error: 'That pickup could not be read.' }); return; }
            try { sendRoute(runner.removePickup(clinic.id, input.data.roundId, input.data.pickupId, who, { revision: input.data.revision })); }
            catch (error) { refuse(error, input.data.roundId); }
            return;
          }

          if (url.pathname === '/api/runner/pickup/collected' && request.method === 'POST') {
            const input = pickupActionInput.safeParse(await readBody());
            if (!input.success) { json(response, 400, { error: 'That pickup could not be read.' }); return; }
            try { sendRoute(runner.collectPickup(clinic.id, input.data.roundId, input.data.pickupId, who,
              { revision: input.data.revision, collected: input.data.collected })); }
            catch (error) { refuse(error, input.data.roundId); }
            return;
          }

          if (url.pathname === '/api/runner/packed' && request.method === 'POST') {
            const input = packedInput.safeParse(await readBody());
            if (!input.success) { json(response, 400, { error: 'Those quantities could not be read.' }); return; }
            try {
              sendRoute(runner.confirmPacked(clinic.id, input.data.roundId, input.data.supplies, who, {
                revision: input.data.revision,
                dropped: runner.droppedOnRound(clinic.id, input.data.roundId),
              }));
            } catch (error) { refuse(error, input.data.roundId); }
            return;
          }

          // RECORD A VISIT from the planner. The visit itself is written by the same function
          // every other screen uses, so there is one record of a conversation and one only. What
          // is added here is the breakdown of what was dropped, and the TOTAL is the sum of it:
          // the browser does not get to send a total that disagrees with its own parts.
          if (url.pathname === '/api/runner/visit' && request.method === 'POST') {
            const input = runnerVisitInput.safeParse(await readBody());
            if (!input.success) { json(response, 400, { error: 'That visit could not be saved. Please check it and try again.' }); return; }
            const draft = input.data;
            // The round is named by the screen that opened the visit, not searched for here: a
            // business can sit on two rounds, and guessing which one would put the conversation,
            // and the materials dropped at it, on whichever sorted first.
            const round = runner.roundStopFor(clinic.id, draft.roundId, draft.businessId, who);
            if (!round) {
              json(response, 403, { error: 'That business is not on that route of yours.' }); return;
            }
            if (draft.visitedOn < round.date) {
              json(response, 400, { error: 'A visit cannot be recorded before its assigned route date.' }); return;
            }
            // One business assignment on one round can be checked off once. A retry with the
            // same clientRef is allowed, but another submission must not double-count visits
            // and supplies. Follow-up visits are a NEW assigned round, not a second checkoff.
            const completedVisit = store.outreach.visits(clinic.id, draft.businessId)
              .find(visit => visit.roundId === round.id);
            if (completedVisit && completedVisit.id !== (draft.clientRef ? `v_${draft.clientRef}` : '')) {
              json(response, 409, { error: 'This stop already has a recorded visit. Ask your office to correct its result rather than checking it off twice.' });
              return;
            }
            const total = SUPPLY_KEYS.reduce((sum, key) => sum + draft.dropped[key], 0);
            if (total > 0) {
              if (!round.supplies.packed) {
                json(response, 400, { error: 'Confirm what you packed before recording materials dropped.' }); return;
              }
              // A retry of a submission already saved must not be measured against its own drop
              // a second time, so what this visit already recorded is added back to what is left.
              const visitId = draft.clientRef ? `v_${draft.clientRef}` : '';
              const already = visitId ? runner.visitMaterials(clinic.id)[visitId] : undefined;
              const left = runner.remaining(clinic.id, round.id, round.supplies.packed);
              const short = SUPPLY_KEYS.find(key => draft.dropped[key] > left[key] + (already?.[key] ?? 0));
              if (short) {
                json(response, 400, { error: `You have ${Math.max(0, left[short] + (already?.[short] ?? 0))} ${short} left on this route, so ${draft.dropped[short]} cannot be recorded as dropped.` });
                return;
              }
            }
            try {
              // One write: the visit, its breakdown, and the business's stage all move together
              // or none of them do.
              const saved = store.outreach.recordVisit(clinic.id, {
                businessId: draft.businessId, visitedOn: draft.visitedOn, spokeWith: draft.spokeWith,
                contactRole: draft.contactRole, outcome: draft.outcome, materials: total,
                note: draft.note, nextAction: draft.nextAction, followUpOn: draft.followUpOn,
                clientRef: draft.clientRef, staff: clinic.display_name || '',
                roundId: round.id, recordedBy: who.id, dropped: draft.dropped,
              });
              const current = runner.round(clinic.id, round.id);
              json(response, 200, {
                visit: saved.visit, business: saved.business, dropped: saved.visit.dropped,
                route: current ? shape(current) : null,
              });
            } catch (error) {
              json(response, 400, { error: error instanceof Error ? error.message : 'That visit could not be saved.' });
            }
            return;
          }

          json(response, 404, { error: 'No such endpoint.' }); return;
        }

        // THE FIELD LOG. Drivers, routes and sign-ups for the signed-in clinic only.
        if (url.pathname === '/api/field' && request.method === 'GET') {
          const clinic = store.clinicFromToken(cookie);
          if (!clinic) { json(response, 401, { error: 'Please sign in again to see your routes.' }); return; }
          json(response, 200, { field: store.fieldLog(clinic.id) }); return;
        }
        // ROUTE NOTES. What the practice's own staff wrote about a business they visited, and
        // whether they want it on the next round. Clinic comes from the cookie; a business id
        // that is not on this clinic's field log is refused by the store.
        if (url.pathname === '/api/field/notes' && request.method === 'GET') {
          const clinic = store.clinicFromToken(cookie);
          if (!clinic) { json(response, 401, { error: 'Please sign in again to see your notes.' }); return; }
          json(response, 200, { notes: store.visitNotes(clinic.id) }); return;
        }
        if (url.pathname === '/api/field/notes' && request.method === 'POST') {
          const clinic = store.clinicFromToken(cookie);
          if (!clinic) { json(response, 401, { error: 'Please sign in again to save your note.' }); return; }
          let input;
          try { input = visitNoteInput.safeParse(await body(request)); } catch { json(response, 400, { error: 'That note could not be read.' }); return; }
          if (!input.success) { json(response, 400, { error: 'That note could not be saved. Please check it and try again.' }); return; }
          try { json(response, 200, { notes: store.saveVisitNote(clinic.id, input.data.businessId, input.data.note, input.data.nextRound) }); }
          catch { json(response, 400, { error: 'That business is not on your field log.' }); }
          return;
        }
        // THE STAFF'S OWN WORK: the businesses this practice has been released, what to say at
        // each, and what happened when somebody went. Like the network endpoints below, the
        // clinic comes from the session cookie and from nowhere else — a business id belonging
        // to another practice is not found rather than refused, which tells the caller nothing.
        if (url.pathname.startsWith('/api/outreach')) {
          const clinic = store.clinicFromToken(cookie);
          if (!clinic) { json(response, 401, { error: 'Please sign in again.' }); return; }

          // THE ROLE BOUNDARY, ENFORCED HERE AND NOT IN THE BROWSER. Hiding a navigation item
          // hides nothing: the endpoint is still one fetch away, and anybody who opens the
          // network tab can read what it returns. So the server decides, every request.
          const role = store.roleOf(cookie);
          const fieldWork = store.mayDoFieldWork(role);
          const article = role === 'owner' || role === 'admin' || role === 'unassigned' ? 'An' : 'A';
          const refuse = (what: string) => json(response, 403, { error: `${article} ${role} account cannot ${what}.` });
          const who = store.db.prepare('SELECT display_name FROM users WHERE clinic_id=? AND display_name<>\'\' LIMIT 1')
            .get(clinic.id) as { display_name: string } | undefined;

          if (url.pathname === '/api/outreach/businesses' && request.method === 'GET') {
            json(response, 200, {
              businesses: store.outreach.businesses(clinic.id),
              releases: store.outreach.releases(clinic.id),
            });
            return;
          }
          if (url.pathname === '/api/outreach/business' && request.method === 'GET') {
            const id = url.searchParams.get('id') ?? '';
            const target = store.outreach.business(clinic.id, id);
            if (!target) { json(response, 404, { error: 'That business is not on your list.' }); return; }
            json(response, 200, {
              business: target,
              // The script is what a rep says at the door. A practice owner has no business
              // reading it, so it is left out of the payload rather than hidden on screen.
              script: fieldWork ? store.outreach.script(clinic.id, id) : null,
              visits: store.outreach.visits(clinic.id, id),
            });
            return;
          }
          if (url.pathname === '/api/outreach/rounds' && request.method === 'GET') {
            const where = store.clinicLocation(clinic.id);
            json(response, 200, {
              rounds: store.outreach.rounds(clinic.id),
              visits: store.outreach.visits(clinic.id),
              clinic: where ? { lat: where.lat, lng: where.lng, label: where.label } : null,
            });
            return;
          }
          if (url.pathname === '/api/outreach/visits' && request.method === 'GET') {
            json(response, 200, { visits: store.outreach.visits(clinic.id) }); return;
          }
          if (url.pathname === '/api/outreach/visit' && request.method === 'POST') {
            if (!fieldWork) { refuse('record a visit'); return; }
            let input;
            try { input = recordVisitInput.safeParse(await body(request)); }
            catch { json(response, 400, { error: 'That visit could not be read.' }); return; }
            if (!input.success) { json(response, 400, { error: 'That visit could not be saved. Please check it and try again.' }); return; }
            try {
              json(response, 200, store.outreach.recordVisit(clinic.id, {
                ...input.data, staff: who?.display_name ?? '',
              }));
            } catch (error) { json(response, 400, { error: error instanceof Error ? error.message : 'That visit could not be saved.' }); }
            return;
          }
          if (url.pathname === '/api/outreach/visit' && request.method === 'PATCH') {
            if (!fieldWork) { refuse('change a visit'); return; }
            let input;
            try { input = editVisitInput.safeParse(await body(request)); }
            catch { json(response, 400, { error: 'That change could not be read.' }); return; }
            if (!input.success) { json(response, 400, { error: 'That change could not be saved.' }); return; }
            const { visitId, ...patch } = input.data;
            try { json(response, 200, { visit: store.outreach.editVisit(clinic.id, visitId, patch, who?.display_name ?? '') }); }
            catch (error) { json(response, 400, { error: error instanceof Error ? error.message : 'That change could not be saved.' }); }
            return;
          }
          if (url.pathname === '/api/outreach/script' && request.method === 'POST') {
            if (!fieldWork) { refuse('edit a visit script'); return; }
            let input;
            try { input = saveScriptInput.safeParse(await body(request)); }
            catch { json(response, 400, { error: 'That script could not be read.' }); return; }
            if (!input.success) { json(response, 400, { error: 'That script could not be saved.' }); return; }
            try { json(response, 200, store.outreach.saveScript(clinic.id, input.data.businessId, input.data.script)); }
            catch (error) { json(response, 400, { error: error instanceof Error ? error.message : 'That script could not be saved.' }); }
            return;
          }
          json(response, 404, { error: 'No such endpoint.' }); return;
        }

        // THE NETWORK MAP. Every endpoint below resolves the clinic from the session cookie and
        // from nowhere else, so `?clinicId=` and a borrowed place ID are both simply ignored.
        if (url.pathname.startsWith('/api/network/')) {
          const clinic = store.clinicFromToken(cookie);
          if (!clinic) { json(response, 401, { error: 'Please sign in again to open your network map.' }); return; }
          if (url.pathname === '/api/network/map' && request.method === 'GET') {
            const refresh = await ensureDiscovery(store, clinic.id);
            json(response, 200, { ...store.networkMap(clinic.id, clinic.name), refresh });
            return;
          }
          if (url.pathname === '/api/network/refresh' && request.method === 'POST') {
            // Deliberately not a forced search: the cooldown in ensureDiscovery still applies, so
            // clicking this cannot spend Places calls repeatedly. A forced pass is a terminal job.
            const refresh = await ensureDiscovery(store, clinic.id);
            json(response, 200, { ...store.networkMap(clinic.id, clinic.name), refresh });
            return;
          }
          // The clinic's spot from its own device: allowed once, while no location is saved. After that only the
          // team changes it (scripts/set-clinic-location.ts), so a phone opened at home can't move a clinic's map.
          if (url.pathname === '/api/network/location' && request.method === 'POST') {
            let input;
            try { input = deviceLocationInput.safeParse(await body(request)); } catch { json(response, 400, { error: 'That location could not be read.' }); return; }
            if (!input.success) { json(response, 400, { error: 'That location could not be read.' }); return; }
            if (store.clinicLocation(clinic.id)) { json(response, 409, { error: 'Your clinic\u2019s location is already set. Call the team to change it.' }); return; }
            if ((input.data.accuracy ?? 0) > 2000) { json(response, 400, { error: 'Your device couldn\u2019t pin your location closely enough. Try again with location set to precise, or call the team.' }); return; }
            store.setClinicLocation({ clinicId: clinic.id, label: 'Set from your device', lat: input.data.lat, lng: input.data.lng, radiusMiles: DEFAULT_RADIUS_MILES, placeId: null, competitorCategories: [] });
            const refresh = await ensureDiscovery(store, clinic.id);
            json(response, 200, { ...store.networkMap(clinic.id, clinic.name), refresh });
            return;
          }
          // The bakery network: where the clinic's treats come from. One bakery chosen at a time.
          if (url.pathname === '/api/network/bakeries' && request.method === 'GET') {
            await ensureBakeries(store, clinic.id);
            json(response, 200, bakeryPayload(store, clinic.id, clinic.name));
            return;
          }
          // Request items from the chosen bakery: saved, then emailed to the team. The bakery becomes the clinic's bakery.
          if (url.pathname === '/api/network/bakery-request' && request.method === 'POST') {
            let input;
            try { input = itemsRequestInput.safeParse(await body(request)); } catch { json(response, 400, { error: 'That request could not be read.' }); return; }
            if (!input.success) { json(response, 400, { error: input.error.issues[0]?.message ?? 'Please check the form.' }); return; }
            const bakery = bakeryPayload(store, clinic.id, clinic.name).bakeries.find(b => b.placeId === input.data.placeId);
            if (!bakery || !store.chooseBakery(clinic.id, bakery.placeId)) { json(response, 400, { error: 'That bakery is no longer on your list.' }); return; }
            const r = input.data;
            store.saveItemsRequest(clinic.id, bakery.placeId, bakery.name ?? 'Bakery', r, false);
            json(response, 200, { ...bakeryPayload(store, clinic.id, clinic.name), sent: true });
            return;
          }
          // Take a bakery off the list, or bring every removed one back.
          if (url.pathname === '/api/network/bakery-remove' && request.method === 'POST') {
            let input;
            try { input = bakeryRemoveInput.safeParse(await body(request)); } catch { json(response, 400, { error: 'That could not be read.' }); return; }
            if (!input.success) { json(response, 400, { error: 'That could not be read.' }); return; }
            if (input.data.placeId) store.hideBakery(clinic.id, input.data.placeId); else store.restoreBakeries(clinic.id);
            json(response, 200, bakeryPayload(store, clinic.id, clinic.name));
            return;
          }
          if (url.pathname === '/api/network/bakery' && request.method === 'POST') {
            let input;
            try { input = bakeryChoiceInput.safeParse(await body(request)); } catch { json(response, 400, { error: 'That choice could not be read.' }); return; }
            if (!input.success || !store.chooseBakery(clinic.id, input.data.placeId)) { json(response, 400, { error: 'That bakery is no longer on your list.' }); return; }
            json(response, 200, bakeryPayload(store, clinic.id, clinic.name));
            return;
          }
          if (url.pathname === '/api/network/selection' && request.method === 'POST') {
            let input;
            try { input = selectionInput.safeParse(await body(request)); } catch { json(response, 400, { error: 'That selection could not be read.' }); return; }
            if (!input.success) { json(response, 400, { error: 'That selection could not be read.' }); return; }
            json(response, 200, store.saveSelection(clinic.id, input.data.placeIds));
            return;
          }
          if (url.pathname === '/api/network/route-request' && request.method === 'POST') {
            let input;
            try { input = routeRequestInput.safeParse(await body(request)); } catch { json(response, 400, { error: 'That request could not be read.' }); return; }
            if (!input.success) { json(response, 400, { error: input.error.issues[0]?.message ?? 'Please check the dates and contact name.' }); return; }
            const result = store.createRouteRequest(clinic.id, input.data);
            if (!result.ok) { json(response, 400, { error: result.message }); return; }
            json(response, 200, { request: result.request, requests: store.routeRequests(clinic.id), selection: store.selection(clinic.id) });
            return;
          }
          json(response, 404, { error: 'Not found.' }); return;
        }
        if (url.pathname === '/api/logout' && request.method === 'POST') { store.signOut(cookie); response.setHeader('Set-Cookie', `${cookieName}=; ${cookieFlags}; Max-Age=0`); json(response, 200, { ok: true }); return; }
        json(response, 404, { error: 'Not found.' }); return;
      }
      if (request.method !== 'GET' && request.method !== 'HEAD') { json(response, 405, { error: 'Method not allowed.' }); return; }
      if (url.pathname === '/robots.txt') { response.setHeader('Content-Type', 'text/plain'); response.end('User-agent: *\nDisallow: /\n'); return; }
      if (vite) {
        if (url.pathname === '/' || url.pathname === '/index.html') {
          const html = await vite.transformIndexHtml(url.pathname, readFileSync(resolve(root, 'index.html'), 'utf8'));
          response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end(html); return;
        }
        vite.middlewares(request, response, () => { json(response, 404, { error: 'Not found.' }); }); return;
      }
      const publicRoot = resolve(root, 'dist/client');
      const path = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
      const file = resolve(publicRoot, path);
      if (!file.startsWith(publicRoot + sep) || !existsSync(file) || !statSync(file).isFile()) { response.writeHead(404, { 'Content-Type': 'text/plain' }); response.end('Page not found. Return to the portal home page.'); return; }
      response.setHeader('Content-Type', mime[extname(file)] ?? 'application/octet-stream');
      if (path.startsWith('assets/')) response.setHeader('Cache-Control', 'public, max-age=3600');
      if (request.method === 'HEAD') { response.end(); return; }
      const stream = createReadStream(file); stream.on('error', () => { if (!response.headersSent) response.writeHead(500); response.end(); }); stream.pipe(response);
    } catch { if (!response.headersSent) json(response, 500, { error: 'The portal could not complete this request. Please try again.' }); else response.end(); }
  });
}
