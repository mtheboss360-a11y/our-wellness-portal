// WHERE A SIGN-IN LANDS.
//
// The portal keeps the open section in `?v=`, so Back and Forward work and a link to one
// section opens there. The cost was that signing out on Visit history and signing back in an
// hour later dropped you straight back into Visit history — the URL outlived the session, and
// a new sign-in inherited the last one's place.
//
// So a sign-in starts at the role's own landing screen, and everything else keeps the URL:
//
//   - A fresh sign-in → the landing screen, with `?v=` replaced rather than pushed, so Back
//     does not lead back to a page from somebody else's session.
//   - A refresh, or Back and Forward inside the session → exactly where the URL says.
//
// The marker lives in sessionStorage: it survives a refresh, dies with the tab, and is cleared
// on sign-out. Where sessionStorage is unavailable — a locked-down private window — this
// reports "not fresh", which is the old behaviour and never worse than it.

const KEY = 'own.session-open';

/**
 * True exactly once per signed-in session: the first time the portal mounts after a sign-in.
 * Calling it marks the session as open, so the second call in the same session is false.
 */
export function isFreshSignIn(): boolean {
  try {
    if (sessionStorage.getItem(KEY)) return false;
    sessionStorage.setItem(KEY, '1');
    return true;
  } catch { return false; }
}

/** Called when signing out, so the next sign-in starts at its own landing screen again. */
export function endSession(): void {
  try { sessionStorage.removeItem(KEY); } catch { /* nothing to clear */ }
}

/**
 * Put the landing section in the URL without adding a history entry. Replacing rather than
 * pushing matters: a pushed entry would let Back return to the previous session's page.
 */
export function startAt(view: string): void {
  const url = new URL(window.location.href);
  if (url.searchParams.get('v') === view) return;
  url.searchParams.set('v', view);
  window.history.replaceState({ view }, '', url);
}
