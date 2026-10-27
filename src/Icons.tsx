// The Network Map's icons: one per business category, plus the map's own controls. Same
// construction as the report's icons — 24-unit box, 1.5 stroke, currentColor — so a marker and
// a stat card look like they were drawn by the same hand.
import type { ReactElement } from 'react';
export type IconName = 'dumbbell' | 'lotus' | 'scissors' | 'hand' | 'spine' | 'basket' | 'sparkle'
  | 'clinic' | 'search' | 'plus' | 'check' | 'minus' | 'up' | 'down' | 'calendar' | 'route' | 'map' | 'refresh' | 'back' | 'arrow' | 'pin' | 'clock' | 'info'
  | 'people' | 'cake' | 'trophy' | 'close' | 'lock' | 'home' | 'chart' | 'notebook' | 'exit' | 'sunrise' | 'shop'
  | 'grip' | 'truck' | 'box' | 'warn';

const PATHS: Record<IconName, ReactElement> = {
  dumbbell: <><path d="M4 9v6M7 7v10M17 7v10M20 9v6M7 12h10"/></>,
  lotus: <><path d="M12 4c2 2.2 2.6 4.6 2 7-2.2-1.4-3.6-3.6-2-7ZM4 10c2.8-.4 5 .6 6.4 2.6-2.6 1-5 .3-6.4-2.6ZM20 10c-2.8-.4-5 .6-6.4 2.6 2.6 1 5 .3 6.4-2.6ZM4.5 15c2.4 3 5 4.4 7.5 4.4S17.1 18 19.5 15"/></>,
  scissors: <><circle cx="6" cy="18" r="2.4"/><circle cx="18" cy="18" r="2.4"/><path d="M7.6 16.2 18 4M16.4 16.2 6 4"/></>,
  hand: <><path d="M9 11V5.6a1.6 1.6 0 0 1 3.2 0V11M12.2 11V7a1.6 1.6 0 0 1 3.2 0v4M15.4 11.4V9.2a1.6 1.6 0 0 1 3.2 0V15a5 5 0 0 1-5 5h-1.8a5 5 0 0 1-4.3-2.4L5 13.6a1.6 1.6 0 0 1 2.7-1.7L9 13.6"/></>,
  spine: <><path d="M12 3v18M8.5 5.5h7M8 9h8M8.5 12.5h7M9 16h6M9.5 19h5"/></>,
  basket: <><path d="M4 9h16l-1.4 9.2A2 2 0 0 1 16.6 20H7.4a2 2 0 0 1-2-1.8L4 9ZM8.6 9 11 3.6M15.4 9 13 3.6M10 13v3M14 13v3"/></>,
  sparkle: <><path d="M12 3.5 13.7 9l5.5 1.7-5.5 1.7L12 18l-1.7-5.6L4.8 10.7 10.3 9 12 3.5ZM18.5 16.5l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7.7-2Z"/></>,
  clinic: <><path d="M12 3 4 8.5V20h16V8.5L12 3ZM12 10v6M9 13h6"/></>,
  search: <><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/></>,
  plus: <><path d="M12 5v14M5 12h14"/></>,
  check: <><path d="m5 12.5 4.5 4.5L19 7"/></>,
  minus: <><path d="M5 12h14"/></>,
  up: <><path d="m6 14 6-6 6 6"/></>,
  down: <><path d="m6 10 6 6 6-6"/></>,
  calendar: <><rect x="3.5" y="5.5" width="17" height="15" rx="3"/><path d="M8 3.5v4M16 3.5v4M3.5 11h17"/></>,
  route: <><circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M8.5 6h5a4 4 0 0 1 0 8h-4a4 4 0 0 0 0 8h5.5" /></>,
  map: <><path d="M9 4.5 3.5 6.8v12.7L9 17.2l6 2.3 5.5-2.3V4.5L15 6.8 9 4.5ZM9 4.5v12.7M15 6.8v12.7"/></>,
  refresh: <><path d="M20 12a8 8 0 1 1-2.6-5.9M20 4v4.5h-4.5"/></>,
  back: <><path d="M19 12H5M10 7l-5 5 5 5"/></>,
  arrow: <><path d="M5 12h14M14 7l5 5-5 5"/></>,
  pin: <><path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></>,
  clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
  info: <><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.8v.4"/></>,
  people: <><circle cx="9" cy="7" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3H3ZM16 4a3 3 0 0 1 0 6M18 14a5 5 0 0 1 3 4v3h-3"/></>,
  cake: <><path d="M4 21h16M5 21v-7a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v7M5 16c2 1.5 4 1.5 7 0s5-1.5 7 0M12 12V8M12 5.5v.01"/></>,
  trophy: <><path d="M7 3h10v7a5 5 0 0 1-10 0V3ZM7 5H3v3a4 4 0 0 0 4 4M17 5h4v3a4 4 0 0 1-4 4M12 15v5M7 21h10"/></>,
  close: <><path d="m6 6 12 12M18 6 6 18"/></>,
  lock: <><rect x="5" y="10" width="14" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/></>,
  home: <><path d="M4 11.5 12 4l8 7.5V20a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1Z"/></>,
  chart: <><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></>,
  notebook: <><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 3v18M12 8h4M12 12h4"/></>,
  exit: <><path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4M10 8l-4 4 4 4M6 12h10"/></>,
  sunrise: <><path d="M12 3v4M5.6 8.6 8 11M18.4 8.6 16 11M3 18h3M18 18h3M8 18a4 4 0 0 1 8 0M2 22h20"/></>,
  shop: <><path d="M4 9.5 5.5 4h13L20 9.5M4 9.5h16M4 9.5V20h16V9.5M9 20v-6h6v6M8 9.5a2 2 0 0 0 4 0 2 2 0 0 0 4 0"/></>,
  grip: <><circle cx="9" cy="5" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="19" r="1"/></>,
  truck: <><path d="M3 6h11v10H3zM14 9h4l3 4v3h-7M7 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM18 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z"/></>,
  box: <><path d="M3 7.5 12 3.5l9 4v9l-9 4-9-4v-9ZM3 7.5l9 4 9-4M12 11.5v9"/></>,
  warn: <><path d="M12 3.5 2.5 20.5h19L12 3.5ZM12 9.5v5M12 17.5v.4"/></>,
};

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{PATHS[name]}</svg>;
}
