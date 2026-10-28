/*
 * Ledger service worker: Web Push only (D-0016). It shows the weekly review and material
 * alerts and opens the in-app route the push names. It caches nothing, so a deploy is never
 * hidden behind a stale copy.
 *
 * Push payload (from the notify function): { "title": "…", "body": "…", "url": "/today", "tag": "weekly" }
 * Push text never carries amounts.
 */

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "Ledger";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "M8 has something for you.",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag: data.tag || undefined,
      data: { url: data.url || "/today" },
    }),
  );
});

/** "/review" → "<scope>#/review" (the app routes on the hash). */
function appUrl(route) {
  const r = typeof route === "string" && route.startsWith("/") ? route : "/today";
  return new URL(`#${r.replace(/^\/?#/, "")}`, self.registration.scope).href;
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const route = (event.notification.data && event.notification.data.url) || "/today";
  const target = appUrl(route);
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const w of windows) {
        if (new URL(w.url).origin !== self.location.origin) continue;
        await w.focus();
        w.postMessage({ type: "ledger:navigate", route });
        return;
      }
      await self.clients.openWindow(target);
    })(),
  );
});
