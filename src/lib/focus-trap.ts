// A PANEL THAT OPENS OVER THE ROUTE has to behave like a door, not a trapdoor: the keyboard
// goes in when it opens, stays inside while it is open, Escape closes it, and focus comes back
// to whatever opened it. Without that a runner on a keyboard — or anybody using a screen reader
// — tabs straight out of the drawer into the itinerary behind it and loses their place.
import { useEffect, type RefObject } from 'react';

const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled])', 'select:not([disabled])',
  'textarea:not([disabled])', 'details', '[tabindex]:not([tabindex="-1"])',
].join(',');

const focusableIn = (element: HTMLElement) =>
  Array.from(element.querySelectorAll<HTMLElement>(FOCUSABLE))
    .filter(node => node.offsetParent !== null || node === document.activeElement);

/**
 * Hold the keyboard inside `container` while `open`. Escape asks to close — it asks rather than
 * closes, because a drawer with unsaved work in it should say so first.
 */
export function useFocusTrap(open: boolean, container: RefObject<HTMLElement | null>, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const element = container.current;
    if (!element) return;
    const previous = document.activeElement as HTMLElement | null;

    // The first thing inside, so a runner starts at the top of the panel rather than wherever
    // the browser last left the caret.
    const first = focusableIn(element)[0];
    (first ?? element).focus({ preventScroll: true });

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); return; }
      if (event.key !== 'Tab') return;
      const stops = focusableIn(element);
      if (!stops.length) { event.preventDefault(); return; }
      const start = stops[0], end = stops[stops.length - 1];
      const here = document.activeElement;
      if (event.shiftKey && (here === start || !element.contains(here))) {
        event.preventDefault(); end.focus();
      } else if (!event.shiftKey && (here === end || !element.contains(here))) {
        event.preventDefault(); start.focus();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      // Back where they were. A phone keyboard that was open for the drawer closes with it.
      previous?.focus?.({ preventScroll: true });
    };
  }, [open, container, onClose]);
}
