// Adds COOP/COEP to same-origin responses inside this worker's scope.
//
// GitHub Pages cannot send custom headers, so `SharedArrayBuffer` (needed by
// the threaded WASM build) is normally unavailable there. This worker is
// registered from the app's own folder, so its default scope is that folder:
// a project published at /<repo>/ only isolates /<repo>/, not the whole origin.
//
// The page reloads once after the worker takes control, because the navigation
// response itself must carry the isolation headers.

const COOP = "same-origin";
const COEP = "require-corp";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const scope = new URL(self.registration.scope);
  const url = new URL(request.url);
  if (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) {
    return;
  }

  event.respondWith(
    (async () => {
      const response = await fetch(request);

      // Opaque responses (for example no-cors redirects) cannot be rebuilt.
      if (response.type === "opaque" || response.type === "opaqueredirect") {
        return response;
      }

      const headers = new Headers(response.headers);
      headers.set("Cross-Origin-Opener-Policy", COOP);
      headers.set("Cross-Origin-Embedder-Policy", COEP);
      headers.set("Cross-Origin-Resource-Policy", "cross-origin");

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    })(),
  );
});
