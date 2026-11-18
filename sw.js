// Tableau – small helper that lets phones offer "Install / Add to Home screen" for the guest page.
// It does not store anything; every page is still loaded fresh from the internet.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => {
  if (e.request.mode === 'navigate') e.respondWith(fetch(e.request));
});
