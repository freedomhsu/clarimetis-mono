// This service worker self-unregisters to clean up after PWA removal.
// Browsers that previously installed the PWA service worker will fetch this
// file as an update check. Installing this no-op SW and immediately
// unregistering it stops future requests and clears the old cache.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", () => {
  self.registration.unregister().then(() => {
    return self.clients.matchAll({ type: "window" });
  }).then((clients) => {
    clients.forEach((client) => client.navigate(client.url));
  });
});
