// THE LIVE PORTAL. No sample clinic and no fictional records: this build ships with no
// campaigns at all, and sample mode is off in .env. Each real client's campaigns are loaded
// with scripts/import-campaigns.ts. Brand values below are genuine, from
// https://ouroptimization.com/ on 2026-10-22.
// This is the ONLY source of content values. Replace this feed, not the UI.
export type Location = { id: string; name: string; area: string; dropDate: string; flyers: number };
export type Lead = { id: string; name: string; phone: string; email: string; locationId: string; receivedDate: string; service: string };
export type Campaign = { id: string; name: string; period: string; locations: Location[]; leads: Lead[] };
export const portal = {
  name: 'Our Wellness Network',
  supportPhone: '(331) 271-6851', supportDial: '+13312716851',
  palette: ['#1F4D3A', '#C2663C', '#9B3B3B', '#D4A53A', '#7FA96A', '#2E8B7A'],
};
export const campaigns: Campaign[] = [];
// No sample in this build: the sign-in screen renders no sample button and no notice.
export const publicPortal = (_enableSample = true) => ({ name: portal.name, supportPhone: portal.supportPhone, supportDial: portal.supportDial, sampleLogin: null as { username: string; password: string } | null, sampleNotice: '', palette: portal.palette });
export type PublicPortal = ReturnType<typeof publicPortal>;
/** 'a' is the full service, our drivers running the routes. 'b' is the portal on its own,
    where the practice's own staff visit. It is read from the account, never from the browser. */
export type Plan = 'a' | 'b';
export type PortalSnapshot = { config: PublicPortal; clinic: { id: string; name: string; plan: Plan; demo: boolean } | null;
  /** Who is signed in, when the account belongs to a person rather than the practice. */
  user?: { name: string | null; staffId: string | null };
  /** What this session may do. Set by the server; the browser follows it, never decides it. */
  role?: 'admin' | 'owner' | 'staff' | 'unassigned' | null;
  campaigns: Campaign[]; today: string };
