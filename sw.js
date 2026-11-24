// Tableau – lets the guest page keep working when the venue has no signal.
// Once a guest has opened their wedding's page with signal, the page, its fonts and pictures are kept on the phone.
// The seating data itself is kept by guest-view.html (in the phone's storage), so this file only handles files.
// The app and the website are never stored here: they always load fresh from the internet.
const CACHE = 'tableau-guest-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil((async () => {
  const keys = await caches.keys();
  await Promise.all(keys.filter(k => k.startsWith('tableau-guest-') && k !== CACHE).map(k => caches.delete(k)));
  await self.clients.claim();
})()));

const isGuestPage = url => url.origin === self.location.origin && /^\/(guest-view(\.html)?|dj(\.html)?)$/.test(url.pathname);
const isKeepable = url =>
  (/\.supabase\.co$/.test(url.hostname) && url.pathname.indexOf('/storage/v1/object/public/') === 0) ||
  (url.origin === self.location.origin && /\.(png|jpe?g|webp|svg|ico|json)$/i.test(url.pathname));

/* the guest page: try the internet first; if there is no answer within 4 seconds (weak signal), use the saved copy */
async function guestPage(req, url) {
  const cache = await caches.open(CACHE);
  const key = url.origin + url.pathname.replace(/\.html$/, '') + '.html';
  const net = fetch(req).then(res => { if (res && res.ok) cache.put(key, res.clone()); return res; });
  const saved = await cache.match(key);
  if (!saved) return net;
  return Promise.race([
    net.catch(() => saved),
    new Promise(r => setTimeout(() => r(saved), 4000))
  ]);
}

/* fonts and pictures: use the saved copy straight away, and refresh it in the background */
async function keepable(req) {
  const cache = await caches.open(CACHE);
  const saved = await cache.match(req);
  const net = fetch(req).then(res => { if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone()); return res; }).catch(() => saved);
  return saved || net;
}

const isFont = url => url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (req.mode === 'navigate') { if (isGuestPage(url)) e.respondWith(guestPage(req, url)); return; }
  if (isFont(url)) { e.respondWith(keepable(req)); return; }   /* fonts never change, so keeping them is always safe */
  if (!isKeepable(url)) return;
  /* pictures: only keep the ones a guest page asked for, never the app's */
  e.respondWith((async () => {
    const c = e.clientId ? await self.clients.get(e.clientId) : null;
    if (c && isGuestPage(new URL(c.url))) return keepable(req);
    return fetch(req);
  })());
});
