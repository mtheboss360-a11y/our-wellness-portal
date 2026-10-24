// The Network Map's icons: one per business category, plus the map's own controls. Same
// construction as the report's icons — 24-unit box, 1.5 stroke, currentColor — so a marker and
// a stat card look like they were drawn by the same hand.
import type { ReactElement } from 'react';
export type IconName = 'dumbbell' | 'lotus' | 'scissors' | 'hand' | 'spine' | 'basket' | 'sparkle'
  | 'clinic' | 'search' | 'plus' | 'check' | 'minus' | 'up' | 'down' | 'calendar' | 'route' | 'map' | 'refresh' | 'back' | 'info';

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
  info: <><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.8v.4"/></>,
};

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{PATHS[name]}</svg>;
}
