// TWENTY FICTIONAL BUSINESSES AND A HISTORY OF VISITING THEM, so the portal can be shown
// working before a client has done any of it.
//
//   npm run make-sample-outreach -- --clinic <clinic-id> [--staff Alexis]
//
// EVERY ROW IS TAGGED demo=1. That is what lets activate-live take all of this out again and
// leave the real businesses, their scripts and their real visits exactly where they are. A
// row this script writes without a tag would become a row nobody can safely delete.
//
// The names are invented and obviously so — no real Naperville business is impersonated, and
// no real one is given fictional activity. The streets are real Naperville streets, because a
// sample that routes to nowhere does not demonstrate routing.
//
// It refuses to run twice, because sample data is only illustrative while there is one of it.
import { parseArgs } from 'node:util';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { openStore } from '../server/store.ts';
import type { Outcome, Script } from '../server/outreach.ts';
import { OPENS, weekdayOf } from '../src/lib/agenda-math.ts';

if (existsSync('.env')) process.loadEnvFile('.env');

const { values } = parseArgs({ options: {
  clinic: { type: 'string' }, staff: { type: 'string' }, today: { type: 'string' },
} });

const clinicId = values.clinic ?? '';
const staff = (values.staff ?? 'Alexis').trim();
const today = values.today ?? new Date().toISOString().slice(0, 10);
if (!/^[a-z0-9-]{3,80}$/.test(clinicId)) throw new Error('Provide --clinic clinic-slug.');

const RELEASE_ID = 'sample-outreach-1';

/** Invented businesses on real streets. The "Sample" wording is not shown; the tag is the truth. */
const SAMPLE: Array<[name: string, category: string, street: string, lat: number, lng: number]> = [
  ['Lantern Barre Studio', 'Pilates studio', '1520 N Naper Blvd', 41.7886, -88.1335],
  ['Still Water Yoga', 'Yoga studio', '2704 Showplace Dr', 41.7198, -88.1762],
  ['Copperleaf Salon', 'Hair salon', '1163 E Ogden Ave', 41.7731, -88.1247],
  ['Harbor Row Fitness', 'Gym', '2835 95th St', 41.7110, -88.1588],
  ['Meadowlark Chiropractic', 'Chiropractor', '1952 Springbrook Square Dr', 41.7452, -88.1998],
  ['Fieldstone Physical Therapy', 'Physical therapy', '636 N Mill St', 41.7846, -88.1476],
  ['Northwind Cycle Studio', 'Cycling studio', '55 S Main St', 41.7723, -88.1479],
  ['Quarry Lane Nails', 'Nail salon', '1259 S Naper Blvd', 41.7398, -88.1312],
  ['Birchwood Massage', 'Massage therapy', '808 S Washington St', 41.7612, -88.1485],
  ['Sable Lane Barbers', 'Barber shop', '120 Water St', 41.7705, -88.1512],
  ['Willow Grain Bakery', 'Bakery', '34 W Jefferson Ave', 41.7731, -88.1492],
  ['Ridgeline Strength', 'Gym', '2500 Aurora Ave', 41.7498, -88.1921],
  ['Juniper Skin Studio', 'Skin care', '1240 Rickert Dr', 41.7055, -88.1702],
  ['Cedar Point Dance', 'Dance studio', '3155 Book Rd', 41.6978, -88.1849],
  ['Amber Field Optometry', 'Optometrist', '2775 Maple Ave', 41.7249, -88.1659],
  ['Slate Creek Spa', 'Day spa', '1555 W Ogden Ave', 41.7712, -88.1801],
  ['Bellbrook Pediatrics', 'Pediatric clinic', '1804 N Naper Blvd', 41.7925, -88.1330],
  ['Foxglove Florist', 'Florist', '212 S Main St', 41.7688, -88.1480],
  ['Oakhurst Pet Grooming', 'Pet grooming', '1127 E Chicago Ave', 41.7780, -88.1298],
  ['Tidewater Swim School', 'Swim school', '1240 Iroquois Ave', 41.7820, -88.1655],
];

const sampleScript = (name: string, category: string): Script => ({
  opening: `Hi, I'm with the local outreach team representing the practice here in Naperville. We're introducing it to a few businesses nearby. Would the owner or manager be open to a quick introduction?`,
  introduction: `A local practice a few minutes from here, looking after everyday care for people in this part of Naperville.`,
  value: `${name} and the practice see the same families. A quiet introduction between two local independents costs neither of us anything.`,
  ask: `Could we leave a few cards at the desk, and would the owner be open to a short chat another time?`,
  objections: {
    busy: `No problem — I'll leave these. Is there a quieter time to catch the owner?`,
    notInterested: `Understood, thanks for your time. I'll leave a card in case it's useful.`,
    alreadyPartnered: `Good to hear. Nothing exclusive here — just so there's a local name people recognise.`,
  },
  closing: `Thanks very much. I'll note that we spoke and we'll check back before long.`,
  followUp: `Hi, I came by a few weeks ago about the local ${category.toLowerCase()} introduction. Just checking whether the cards were any use.`,
});

/** A plausible spread of results. Deterministic, so two runs describe the same world. */
const STORY: Array<{ weeksAgo: number; outcome: Outcome; spokeWith: string; role: string; materials: number; note: string }> = [
  { weeksAgo: 7, outcome: 'partner', spokeWith: 'Ruth', role: 'Owner', materials: 40, note: 'Happy to keep a stack at the desk. Asked for more next month.' },
  { weeksAgo: 7, outcome: 'interested', spokeWith: 'Marcus', role: 'Manager', materials: 25, note: 'Wants to run it past the owner first.' },
  { weeksAgo: 6, outcome: 'declined', spokeWith: 'Priya', role: 'Owner', materials: 0, note: 'Not taking any material from outside at the moment.' },
  { weeksAgo: 6, outcome: 'materials', spokeWith: '', role: '', materials: 20, note: 'Nobody free. Left cards with the front desk.' },
  { weeksAgo: 5, outcome: 'partner', spokeWith: 'Dana', role: 'Owner', materials: 50, note: 'Put them by the till herself.' },
  { weeksAgo: 5, outcome: 'follow-up', spokeWith: 'Tom', role: 'Front desk', materials: 15, note: 'Owner in on Thursdays.' },
  { weeksAgo: 4, outcome: 'unavailable', spokeWith: '', role: '', materials: 10, note: 'Closed for a private class. Try mid-morning.' },
  { weeksAgo: 4, outcome: 'interested', spokeWith: 'Alina', role: 'Manager', materials: 30, note: 'Asked whether we could do something for their members.' },
  { weeksAgo: 3, outcome: 'partner', spokeWith: 'Jo', role: 'Owner', materials: 45, note: 'Second drop. Said the first lot went.' },
  { weeksAgo: 3, outcome: 'follow-up', spokeWith: 'Sam', role: 'Front desk', materials: 12, note: 'Manager back next week.' },
  { weeksAgo: 2, outcome: 'interested', spokeWith: 'Nadia', role: 'Owner', materials: 22, note: 'Keen, wants a card holder rather than loose cards.' },
  { weeksAgo: 2, outcome: 'materials', spokeWith: '', role: '', materials: 18, note: 'Busy with a queue. Left them and went.' },
  { weeksAgo: 1, outcome: 'follow-up', spokeWith: 'Greg', role: 'Manager', materials: 16, note: 'Wants to see how the first month goes.' },
  { weeksAgo: 1, outcome: 'declined', spokeWith: 'Hana', role: 'Owner', materials: 0, note: 'Already works with a practice in Aurora.' },
];

const dayBefore = (iso: string, weeks: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - weeks * 7);
  // Never land illustrative activity on a day the practice is shut.
  while (OPENS[weekdayOf(d.toISOString().slice(0, 10))] === null) d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};

const store = openStore(resolve(process.env.DATABASE_PATH ?? 'var/portal.sqlite'), false);
try {
  const clinic = store.db.prepare('SELECT name FROM clinics WHERE id=?').get(clinicId) as { name: string } | undefined;
  if (!clinic) throw new Error(`No clinic "${clinicId}".`);

  const existing = store.db.prepare('SELECT COUNT(*) AS n FROM businesses WHERE clinic_id=? AND release_id=?')
    .get(clinicId, RELEASE_ID) as { n: number };
  if (existing.n) throw new Error(`${clinicId} already has this sample set. Remove it with activate-live, or leave it as it is — this script will not write a second copy.`);

  store.outreach.release(clinicId, RELEASE_ID, 'Illustrative sample businesses', 'make-sample-outreach',
    SAMPLE.map(([name, category, street, lat, lng]) => ({
      name, category, address: `${street}, Naperville, IL`, phone: '', website: '',
      talkingPoint: `Illustrative: a ${category.toLowerCase()} close to the practice, serving the same neighbourhood.`,
      lat, lng, script: sampleScript(name, category),
    })), true);

  const made = store.outreach.businesses(clinicId).filter(b => b.releaseId === RELEASE_ID);

  // A history of visiting them, tagged the same way. Every row is written through recordVisit
  // so the stages it leaves behind are the ones the real code would leave.
  let written = 0;
  STORY.forEach((beat, i) => {
    const business = made[i];
    if (!business) return;
    const on = dayBefore(today, beat.weeksAgo);
    const { visit } = store.outreach.recordVisit(clinicId, {
      businessId: business.id, staff, visitedOn: on, spokeWith: beat.spokeWith,
      contactRole: beat.role, outcome: beat.outcome, materials: beat.materials, note: beat.note,
      nextAction: beat.outcome === 'follow-up' ? 'Go back and ask for the decision-maker' : '',
      followUpOn: beat.outcome === 'follow-up' || beat.outcome === 'interested' ? dayBefore(today, beat.weeksAgo - 3) : null,
      clientRef: `sample${String(i).padStart(2, '0')}${clinicId.replace(/[^a-z0-9]/g, '').slice(0, 20)}`,
    });
    // recordVisit writes demo=0 because a visit through the portal is a real conversation.
    // These are not, so they are tagged here, in the same breath as being written.
    store.db.prepare('UPDATE visits SET demo=1 WHERE id=? AND clinic_id=?').run(visit.id, clinicId);
    written += 1;
  });

  console.log(`${clinic.name} (${clinicId})`);
  console.log(`  ${made.length} illustrative businesses added, all tagged demo.`);
  console.log(`  ${written} illustrative visits recorded under ${staff}, tagged demo.`);
  console.log(`  ${made.length - written} left at "New / not contacted", so there is something to go and do.`);
  console.log(`\nNone of this touches the verified businesses or any real visit.`);
  console.log(`Remove it all later with:  npm run activate-live -- --clinic ${clinicId}`);
} finally { store.close(); }
