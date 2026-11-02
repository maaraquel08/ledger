/*
 * Ledger service worker: retired. Push notifications were removed, and this app caches nothing.
 * Browsers that still hold the old worker pick this one up, which unregisters itself so no push
 * handler is left behind.
 */

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) =>
  event.waitUntil(
    (async () => {
      const sub = await self.registration.pushManager?.getSubscription();
      if (sub) await sub.unsubscribe();
      await self.registration.unregister();
    })(),
  ),
);
