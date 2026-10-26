// THE STAGE. One place that owns what happens between clicking a tab and reading the new page.
//
// Three things, in this order, because the order is the whole point:
//
//   1. The scroll resets BEFORE the browser paints. The portal already called window.scrollTo on
//      a view change, and in Chromium it landed at the top — but it ran in an effect, after
//      paint, so for one frame you saw the bottom of a page you had just opened. A layout effect
//      runs before that frame exists. Safari also restores its own scroll position across history
//      entries, which is why scrollRestoration is taken off it here.
//   2. The new section fades in over 160ms. Short enough not to be a wait, long enough that the
//      content does not snap into place.
//   3. A loader appears only if the screen is still fetching 180ms later. A page whose data is
//      already in hand must never flash a spinner — that reads as slower than no loader at all.
//
// The shell around this — the rail, the brand, the sign-out — is outside the stage and never
// re-renders, so the frame of the application stays still while the middle of it changes.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

/** The browser's own scroll memory fights ours. Ours wins; Back and Forward are handled below. */
if (typeof history !== 'undefined' && 'scrollRestoration' in history) history.scrollRestoration = 'manual';

const BUSY = '[aria-busy="true"]';
/** Long enough that an instant page never flashes it; short enough to beat an impatient tap. */
const PATIENCE = 180;

export default function PageStage({ view, children }: { view: string; children: ReactNode }) {
  const stage = useRef<HTMLDivElement>(null);
  const [entering, setEntering] = useState(false);
  const [waiting, setWaiting] = useState(false);

  // Before paint. An effect here instead of a layout effect is the bug this component exists for.
  useLayoutEffect(() => {
    const doc = document.scrollingElement ?? document.documentElement;
    doc.scrollTop = 0;
    // Belt and braces for Safari, where the scrolling element is not always the one that moved.
    document.body.scrollTop = 0;
    window.scrollTo(0, 0);
    setEntering(true);
  }, [view]);

  useEffect(() => {
    const done = setTimeout(() => setEntering(false), 170);
    return () => clearTimeout(done);
  }, [view]);

  // The loader watches what the screens already tell us: their skeletons carry aria-busy. No new
  // state to keep in step, and nothing to show for a screen that was ready immediately.
  useEffect(() => {
    setWaiting(false);
    const node = stage.current;
    if (!node) return;

    const look = () => setWaiting(node.querySelector(BUSY) !== null);
    const start = setTimeout(look, PATIENCE);
    // Once it is up, it comes down the moment the screen stops saying it is busy.
    const watch = new MutationObserver(() => { if (!node.querySelector(BUSY)) setWaiting(false); });
    watch.observe(node, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-busy'] });

    return () => { clearTimeout(start); watch.disconnect(); };
  }, [view]);

  return <div className="stage" ref={stage}>
    <div className={`stage-body ${entering ? 'is-entering' : ''}`}>{children}</div>
    {waiting && <div className="stage-wait" role="status" aria-live="polite">
      <img src="/assets/owo-logo.png" alt="" width="1579" height="574"/>
      <span className="stage-bar"><i/></span>
      <span className="sr-only">Loading this page.</span>
    </div>}
  </div>;
}
