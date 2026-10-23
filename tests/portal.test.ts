import test from 'node:test';
import assert from 'node:assert/strict';
import { campaigns } from '../data/portal-data';
import { summarize, filterLeads, isNew, accumulation, monthly, fieldDays } from '../src/lib/portal-math';
import type { Campaign } from '../data/portal-data';

// Edge-case campaigns live here, not in the shipped sample, so the empty states stay
// covered no matter what the sample is changed to.
const noDrops: Campaign = { id: 'none', name: 'No drops', period: '', locations: [], leads: [] };
const dropsNoLeads: Campaign = { id: 'quiet', name: 'Drops, no leads', period: '',
  locations: [{ id: 'a', name: 'A', area: 'A town', dropDate: '2026-03-02', flyers: 900 },
              { id: 'b', name: 'B', area: 'B town', dropDate: '2026-03-16', flyers: 600 }], leads: [] };
import { openStore, passwordHash, verifyPassword } from '../server/store';

// The live build ships no sample clinic, so these tests create their own account.

// The maths is tested against a fixture, not the shipped feed: the live build ships no records.
const FIXTURE: Campaign = {
  id: '2026-10', name: 'October 2026', period: 'October 2026 · 2 field days · 500 flyers',
  locations: [
    { id: 'a', name: 'A Studio', area: 'Oak Brook', dropDate: '2026-10-06', flyers: 100 },
    { id: 'b', name: 'B Gym', area: 'Hinsdale', dropDate: '2026-10-06', flyers: 100 },
    { id: 'c', name: 'C Salon', area: 'Westmont', dropDate: '2026-10-20', flyers: 100 }
  ],
  leads: [
    { id: 'l1', name: 'One Person', phone: '+16305550101', email: 'one@example.invalid', locationId: 'a', receivedDate: '2026-10-08', service: 'Infrared sauna' },
    { id: 'l2', name: 'Two Person', phone: '+16305550102', email: 'two@example.invalid', locationId: 'a', receivedDate: '2026-10-11', service: 'Lymphatic drainage' },
    { id: 'l3', name: 'Three Person', phone: '+16305550103', email: 'three@example.invalid', locationId: 'b', receivedDate: '2026-10-21', service: 'IV drip' }
  ]
};
const ACCOUNT = { clinic: 'test-clinic', name: 'Test Clinic', username: 'testclinic', password: 'test-password-123' };
const withAccount = (store: ReturnType<typeof openStore>) => { store.createClient(ACCOUNT.clinic, ACCOUNT.name, ACCOUNT.username, ACCOUNT.password); return store; };
import { campaignFeed } from '../server/validation';
import { createPortalServer } from '../server/http';
import type { AddressInfo } from 'node:net';

test('the feed contract accepts the empty live feed', () => { assert.deepEqual(campaignFeed.parse(campaigns), []); });
test('totals and response derive from the records', () => { for (const campaign of campaigns) { const s = summarize(campaign);
  assert.equal(s.flyers, campaign.locations.reduce((t, l) => t + l.flyers, 0));
  assert.equal(s.leadCount, campaign.leads.length);
  assert.equal(s.response, s.flyers ? (s.leadCount / s.flyers * 100).toFixed(2) : '0.00');
  assert.equal(s.top?.leads ?? 0, Math.max(0, ...s.rows.map(r => r.leads))); } });
test('ranking, shares and stable colors are correct', () => { const s = summarize(FIXTURE);
  assert.deepEqual(s.ranked.map(l => l.leads), [...s.ranked.map(l => l.leads)].sort((a, b) => b - a));
  assert.deepEqual(s.rows.map(l => l.colorIndex), s.rows.map((_, i) => i));
  assert.equal(s.rows.reduce((t, l) => t + l.leads, 0), s.leadCount);
  assert.deepEqual([...s.ranked].map(l => l.id).sort(), s.rows.map(l => l.id).sort()); });
test('filtering and clearing return only matching records', () => { const c = FIXTURE; const first = c.locations[0].id;
  assert.equal(filterLeads(c.leads, first).length, c.leads.filter(l => l.locationId === first).length);
  assert.equal(filterLeads(c.leads, null).length, c.leads.length);
  assert.equal(filterLeads(c.leads, 'missing').length, 0); });
test('leads sort newest first', () => { const sorted = filterLeads(FIXTURE.leads, null);
  assert.equal(sorted[0].receivedDate, [...FIXTURE.leads].map(l => l.receivedDate).sort().at(-1));
  for (let i = 1; i < sorted.length; i++) assert.ok(sorted[i].receivedDate <= sorted[i - 1].receivedDate); });
test('no-drop state has zero totals, no top location and no fake chart', () => { const s = summarize(noDrops); assert.equal(s.flyers,0); assert.equal(s.leadCount,0); assert.equal(s.top,undefined); assert.equal(s.ranked.length,0); assert.equal(s.response,'0.00'); assert.equal(accumulation([],[]),''); });
test('drops without leads retain their flyer counts', () => { const s = summarize(dropsNoLeads); assert.equal(s.flyers,1500); assert.equal(s.leadCount,0); assert.equal(s.ranked.length,2); assert.equal(s.response,'0.00'); assert.equal(s.top,undefined); });
test('NEW badge is bounded to seven calendar days, never future dates', () => { assert.equal(isNew('2026-10-22','2026-10-22'),true); assert.equal(isNew('2026-10-16','2026-10-22'),true); assert.equal(isNew('2026-10-15','2026-10-22'),false); assert.equal(isNew('2026-10-23','2026-10-22'),false); });
test('sparkline is cumulative and uses actual dates', () => { const points=accumulation(FIXTURE.leads,FIXTURE.locations).split(' ').map(v=>v.split(',').map(Number)); assert.deepEqual(points[0],[0,37]); assert.deepEqual(points.at(-1),[300,5]); for(let i=1;i<points.length;i++)assert.ok(points[i][1]<=points[i-1][1]); });
test('all lead contacts use reserved fictional contact ranges', () => { for(const lead of FIXTURE.leads){assert.match(lead.phone,/^\+163055501\d{2}$/);assert.ok(lead.email.endsWith('@example.invalid'));} });
test('feed rejects orphan leads and invalid dates', () => { const value=structuredClone([FIXTURE]); value[0].leads[0].locationId='missing'; assert.equal(campaignFeed.safeParse(value).success,false); const bad=structuredClone([FIXTURE]); bad[0].locations[0].dropDate='2026-02-31'; assert.equal(campaignFeed.safeParse(bad).success,false); });
test('password hashes are salted and checked correctly', () => { const hash=passwordHash('test-password-123','one-salt'); assert.ok(verifyPassword('test-password-123','one-salt',hash)); assert.ok(!verifyPassword('wrong-password','one-salt',hash)); assert.notEqual(hash,passwordHash('test-password-123','other-salt')); });
test('anonymous request returns no clinic or campaign data', () => { const s=openStore(':memory:'); try{assert.equal(s.snapshot(undefined).clinic,null);assert.deepEqual(s.snapshot(undefined).campaigns,[]);assert.equal(s.snapshot('fake').clinic,null);}finally{s.close();} });
test('incorrect password and unknown username return the same generic error', () => { const s=withAccount(openStore(':memory:'));try{const a=s.signIn(ACCOUNT.username,'wrong','test');const b=s.signIn('nosuchuser','wrong','test');assert.equal(a.message,b.message);assert.equal(a.ok,false);}finally{s.close();} });
test('authentication scopes campaigns to the session clinic and logout revokes it', () => { const s=withAccount(openStore(':memory:')); try{
  s.createClient('second-clinic','Second Fictional Clinic','secondclinic','Test-password-123!');
  s.saveCampaigns('second-clinic',[{id:'other',name:'Other clinic only',period:'2026',locations:[],leads:[]}]);
  const a=s.signIn(ACCOUNT.username,ACCOUNT.password,'one'); const b=s.signIn('secondclinic','Test-password-123!','two');
  assert.ok(a.ok && b.ok); if(!a.ok || !b.ok)return;
  assert.equal(s.snapshot(a.token).campaigns.length,campaigns.length); assert.deepEqual(s.snapshot(b.token).campaigns.map((c: { id: string })=>c.id),['other']);
  s.signOut(a.token);assert.equal(s.snapshot(a.token).clinic,null);
}finally{s.close();} });
test('login rotates the previous session', () => { const s=withAccount(openStore(':memory:'));try{const a=s.signIn(ACCOUNT.username,ACCOUNT.password,'rotation');assert.ok(a.ok);if(!a.ok)return;const b=s.signIn(ACCOUNT.username,ACCOUNT.password,'rotation',a.token);assert.ok(b.ok);assert.equal(s.snapshot(a.token).clinic,null);}finally{s.close();} });
test('login rate limiting blocks repeated attempts', () => { const s=openStore(':memory:');try{for(let i=0;i<12;i++)s.signIn('unknown@example.invalid','wrong','rate');assert.match(s.signIn('unknown@example.invalid','wrong','rate').message,/Too many/);}finally{s.close();} });
test('the live build ships no sample clinic, no seeded account and no sample login', () => {
  assert.deepEqual(campaigns, [], 'no campaign records are bundled');
  const s = openStore(':memory:');
  try {
    assert.equal(s.snapshot(undefined).config.sampleLogin, null, 'no sample login is disclosed');
    assert.deepEqual(s.snapshot(undefined).campaigns, []);
    assert.equal(s.signIn('sample', 'SampleFlyers2026!', 'old-sample').ok, false, 'the old sample account cannot sign in');
  } finally { s.close(); }
});
test('HTTP endpoints reject cross-origin sign-in and issue HttpOnly sessions',async()=>{
  const store=withAccount(openStore(':memory:')); const server=createPortalServer({store,origin:'http://portal.test',secure:false,root:process.cwd()});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try{
    const blocked=await fetch(base+'/api/login',{method:'POST',headers:{Origin:'https://evil.invalid','Content-Type':'application/json'},body:JSON.stringify({username:ACCOUNT.username,password:ACCOUNT.password})});assert.equal(blocked.status,403);
    const response=await fetch(base+'/api/login',{method:'POST',headers:{Origin:'http://portal.test','Content-Type':'application/json'},body:JSON.stringify({username:ACCOUNT.username,password:ACCOUNT.password})});assert.equal((await response.json()).ok,true);
    const setCookie=response.headers.get('set-cookie')!;assert.match(setCookie,/HttpOnly/);assert.match(setCookie,/SameSite=Strict/);
    const cookie=setCookie.split(';')[0];const data=await (await fetch(base+'/api/portal?clinicId=other',{headers:{Cookie:cookie}})).json();assert.equal(data.clinic.id,ACCOUNT.clinic);assert.deepEqual(data.campaigns,[]);
    const out=await fetch(base+'/api/logout',{method:'POST',headers:{Origin:'http://portal.test',Cookie:cookie}});assert.equal(out.status,200);assert.equal((await (await fetch(base+'/api/portal',{headers:{Cookie:cookie}})).json()).clinic,null);
  }finally{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));store.close();}
});

test('sign-in works from the bare domain and from www, and nowhere else',async()=>{
  // The host redirects one of the two to the other, so the page can run on either (October 23, 2026).
  const store=withAccount(openStore(':memory:')); const server=createPortalServer({store,origin:'https://ournetworkportal.com',secure:false,root:process.cwd()});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const signIn=(origin:string)=>fetch(base+'/api/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({username:ACCOUNT.username,password:ACCOUNT.password})});
  try{
    for(const origin of ['https://ournetworkportal.com','https://www.ournetworkportal.com']){const response=await signIn(origin);assert.equal(response.status,200,origin);assert.equal((await response.json()).ok,true,origin);}
    for(const origin of ['https://evil.ournetworkportal.com','https://wwwournetworkportal.com','http://www.ournetworkportal.com','https://www.ournetworkportal.com.evil.invalid','null']){assert.equal((await signIn(origin)).status,403,origin);}
    assert.equal((await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,403,'no Origin header');
  }finally{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));store.close();}
});

test('field days count distinct trips, not locations', () => {
  assert.equal(fieldDays(dropsNoLeads), 2);
  assert.equal(fieldDays({ ...dropsNoLeads, locations: dropsNoLeads.locations.map(l => ({ ...l, dropDate: '2026-03-02' })) }), 1);
  assert.equal(fieldDays(noDrops), 0);
  for (const campaign of campaigns) assert.ok(fieldDays(campaign) <= campaign.locations.length);
});
test('the month by month roll-up matches the campaigns it sums', () => {
  const { rows, flyers, leads } = monthly(campaigns);
  assert.equal(rows.length, campaigns.length);
  assert.deepEqual(rows.map(r => r.id), [...campaigns.map(c => c.id)].sort());
  assert.equal(flyers, campaigns.reduce((t, c) => t + c.locations.reduce((n, l) => n + l.flyers, 0), 0));
  assert.equal(leads, campaigns.reduce((t, c) => t + c.leads.length, 0));
  for (const row of rows) assert.equal(row.response, row.flyers ? (row.leads / row.flyers * 100).toFixed(2) : '0.00');
});
test('every sample lead names a service and a real location', () => {
  for (const campaign of campaigns) for (const lead of campaign.leads) {
    assert.ok(lead.service.trim().length > 0);
    assert.ok(campaign.locations.some(l => l.id === lead.locationId));
  }
});
test('every sample lead contact is fictional, across all campaigns', () => {
  for (const campaign of campaigns) for (const lead of campaign.leads) {
    assert.match(lead.phone, /^\+163055501\d{2}$/);
    assert.ok(lead.email.endsWith('@example.invalid'));
  }
});

test('the owner chooses the username and the password; only empty is refused', () => {
  const s = openStore(':memory:', false);
  try {
    s.createClient('short-pw', 'Short Password Clinic', 'ethrlabs', 'ethrleads');
    const ok = s.signIn('ethrlabs', 'ethrleads', 'chosen');
    assert.equal(ok.ok, true, 'a short, plain password the owner chose is accepted');
    assert.equal(s.signIn('ETHRLABS', 'ethrleads', 'case').ok, true, 'the username is case-insensitive');
    assert.throws(() => s.createClient('no-user', 'No User', '   ', 'whatever'), /username is required/);
    assert.throws(() => s.createClient('no-pw', 'No Password', 'someone', ''), /password is required/);
  } finally { s.close(); }
});
test('a weak password is still behind the rate limit', () => {
  const s = openStore(':memory:', false);
  try {
    s.createClient('rl', 'Rate Limited Clinic', 'ethrlabs', 'ethrleads');
    for (let i = 0; i < 12; i++) s.signIn('ethrlabs', 'guess', 'attacker');
    assert.match(s.signIn('ethrlabs', 'guess', 'attacker').message, /Too many/);
  } finally { s.close(); }
});
