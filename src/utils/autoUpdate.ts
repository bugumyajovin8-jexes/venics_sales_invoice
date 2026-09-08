/**
 * Reload the app when a new build is deployed — without ever doing it while
 * someone is mid-transaction.
 *
 * WHY NOT A version.json
 *   The other apps stamp a timestamp into `public/version.json` from a
 *   `generate-version.js` step wired into `npm run build`, then poll it. That
 *   works only for as long as the host actually runs that script. Point the
 *   build command at `vite build` directly, or upload a pre-built `dist/`, and
 *   the file ships with whatever timestamp it last had. The polling then runs
 *   forever, compares a constant to itself, and never reloads. Silently.
 *
 *   Here the fingerprint is the deployed bundle itself. Vite emits hashed asset
 *   names (`assets/index-B7fK2p.js`), and that hash changes exactly when the
 *   code changes. Nothing to wire into the build, and it cannot report
 *   "unchanged" while the code has in fact changed.
 *
 * WHEN IT RELOADS
 *   * On open, before any work has started — the most considerate moment there
 *     is, and the one that catches a device whose service worker has been
 *     serving a stale bundle.
 *   * Immediately, on any page that is not Kikapu or Madeni.
 *   * On Kikapu and Madeni, only once the user has been idle: those are the
 *     pages someone is actually working on, and a reload there costs a
 *     half-finished sale or a payment being recorded.
 *   * Or the moment they press the button, whenever they choose.
 */

import { useStore } from '../store';

/** How often to look, while the tab is in the foreground. */
const POLL_MS = 5 * 60 * 1000;

/** Never re-check more than this often, however many focus events arrive. */
const MIN_GAP_MS = 30 * 1000;

/** Silence on a working page for this long counts as "not mid-transaction". */
const IDLE_MS = 2 * 60 * 1000;

/** Routes where a reload would interrupt real work. */
const WORKING_ROUTES = ['/kikapu', '/madeni'];

/** Guards against a reload loop if the worker keeps serving the old bundle. */
const STARTUP_RELOAD_KEY = 'autoUpdate_startup_reloaded';

let baseline: string | null = null;
let pending = false;
let lastCheck = 0;
let lastInteraction = Date.now();
let reloading = false;
let timer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<(pending: boolean) => void>();

/**
 * The hashed asset names in a built index.html, as one string.
 *
 * Sorted so the order attributes happen to appear in cannot produce a false
 * "changed"; de-duplicated and joined so a change to ANY chunk counts, not only
 * the entry.
 */
function fingerprint(html: string): string | null {
  const hits = html.match(/assets\/[A-Za-z0-9._-]+\.(?:js|css)/g);
  if (!hits || !hits.length) return null;
  return Array.from(new Set(hits)).sort().join('|');
}

/**
 * The same fingerprint, for the bundle THIS page is running.
 *
 * Taken from the live document rather than from the first network fetch, and
 * that difference is the whole "check on open" feature: after a deploy the
 * service worker can still be serving yesterday's bundle, so the running page
 * and the deployed page genuinely differ. Comparing a fetch against another
 * fetch would have shown them as identical and found nothing.
 *
 * Read once, at module load, before any lazily-imported chunk has been added to
 * the DOM — otherwise this page would look "bigger" than the index.html it is
 * compared against.
 */
function currentDocumentFingerprint(): string | null {
  try {
    const nodes = document.querySelectorAll<HTMLElement>('script[src], link[href]');
    const urls: string[] = [];
    nodes.forEach((n) => {
      const u = n.getAttribute('src') || n.getAttribute('href') || '';
      const m = u.match(/assets\/[A-Za-z0-9._-]+\.(?:js|css)/);
      if (m) urls.push(m[0]);
    });
    if (!urls.length) return null;
    return Array.from(new Set(urls)).sort().join('|');
  } catch {
    return null;
  }
}

async function fetchDeployedFingerprint(): Promise<string | null> {
  // Relative, because the app is built with `base: './'`. The cache-buster stops
  // a CDN or the HTTP cache answering with the copy this page was loaded from;
  // `no-store` covers the rest. A plain fetch is not a navigation request, so
  // the worker's navigateFallback does not intercept it, and the query string
  // keeps it from matching the precached index.html.
  const res = await fetch(`./index.html?_v=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`index.html -> ${res.status}`);
  return fingerprint(await res.text());
}

/** Which route is on screen. `location.hash`, because this app uses HashRouter. */
function currentRoute(): string {
  return window.location.hash.replace(/^#/, '') || '/';
}

function onWorkingPage(): boolean {
  const route = currentRoute();
  return WORKING_ROUTES.some((r) => route.startsWith(r));
}

/**
 * Should a known update wait?
 *
 * Only on Kikapu and Madeni, and only while the user is actually touching the
 * screen. Once they have been still for IDLE_MS the till is not in use and the
 * reload is free — which is why this is a time test rather than a cart test: a
 * cart can be empty while a customer is standing there mid-conversation, and
 * full while the phone sits forgotten on the counter.
 */
function shouldDefer(): boolean {
  if (!onWorkingPage()) return false;
  return Date.now() - lastInteraction < IDLE_MS;
}

function setPending(v: boolean) {
  if (pending === v) return;
  pending = v;
  listeners.forEach((fn) => {
    try { fn(v); } catch { /* a subscriber must not break the updater */ }
  });
}

/** Performs the reload, letting the worker install the new assets first. */
function reload(): void {
  if (reloading) return;
  reloading = true;

  // Reloading immediately can land on a page whose chunks are no longer in the
  // cache and not yet downloaded — a blank screen. Ask the worker to update and
  // go when it takes control.
  const done = () => window.location.reload();
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('controllerchange', done, { once: true });
    navigator.serviceWorker.getRegistration().then((r) => r?.update()).catch(() => {});
  }
  // For when there is no worker, or it was already current, so controllerchange
  // never fires.
  setTimeout(done, 15_000);
}

async function check(): Promise<void> {
  if (reloading) return;

  // Already know there is one waiting — just re-test whether it may go now.
  if (pending) {
    if (!shouldDefer()) reload();
    return;
  }

  const now = Date.now();
  if (now - lastCheck < MIN_GAP_MS) return;
  lastCheck = now;

  let deployed: string | null;
  try {
    deployed = await fetchDeployedFingerprint();
  } catch {
    // Offline, or a transient failure. Nothing is recorded, so the next check
    // simply tries again — a device that starts offline is never left
    // permanently blind, which is the trap the desktop version fell into.
    return;
  }
  if (!deployed) return;

  if (!baseline) {
    baseline = deployed;
    return;
  }
  if (deployed === baseline) return;

  setPending(true);
  if (!shouldDefer()) reload();
}

/**
 * Take the update now. For the button on Kikapu / Madeni, so the user can choose
 * a moment between customers instead of waiting to be idle.
 */
export function applyUpdateNow(): void {
  reload();
}

/** Is there an update waiting for a quiet moment? */
export function isUpdatePending(): boolean {
  return pending;
}

/** Notifies when that changes. Returns an unsubscribe. */
export function onPendingUpdateChange(fn: (pending: boolean) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Starts watching. Safe to call more than once. */
export function startAutoUpdate(): void {
  if (timer) return;

  baseline = currentDocumentFingerprint();

  // Anything the user does counts as "working". Passive + capture so a handler
  // that stops propagation cannot hide the interaction from us.
  const touch = () => { lastInteraction = Date.now(); };
  for (const ev of ['pointerdown', 'keydown', 'touchstart', 'wheel'] as const) {
    window.addEventListener(ev, touch, { passive: true, capture: true });
  }

  // ON OPEN. The best moment to reload is before any work has started, and it is
  // also when the running bundle is most likely to be stale. Guarded by a
  // once-per-session flag: if the worker keeps handing back the old bundle, a
  // startup reload would otherwise loop forever.
  const alreadyReloaded = (() => {
    try { return sessionStorage.getItem(STARTUP_RELOAD_KEY) === '1'; } catch { return false; }
  })();

  void (async () => {
    try {
      const deployed = await fetchDeployedFingerprint();
      lastCheck = Date.now();
      if (deployed && baseline && deployed !== baseline && !alreadyReloaded) {
        try { sessionStorage.setItem(STARTUP_RELOAD_KEY, '1'); } catch { /* private mode */ }
        setPending(true);
        if (!shouldDefer()) reload();
        return;
      }
      if (deployed && !baseline) baseline = deployed;
    } catch {
      // Offline at startup. The interval below will pick it up later.
    }
  })();

  timer = setInterval(() => void check(), POLL_MS);

  // A pending update on a working page is waiting for quiet. Watch for it
  // arriving rather than only noticing at the next five-minute poll.
  setInterval(() => {
    if (pending && !shouldDefer()) reload();
  }, 20_000);

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void check();
  });
}
