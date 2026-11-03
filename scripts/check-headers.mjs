#!/usr/bin/env node
// Verifies that a running server sends the COOP/COEP headers required for
// SharedArrayBuffer (and therefore Emscripten pthreads).
//
// Usage: node scripts/check-headers.mjs [url]
//        node scripts/check-headers.mjs https://example.com/

const url = process.argv[2] ?? "http://localhost:5173/";

const response = await fetch(url, { redirect: "follow" });
const headers = {
  "Cross-Origin-Opener-Policy": response.headers.get("cross-origin-opener-policy"),
  "Cross-Origin-Embedder-Policy": response.headers.get("cross-origin-embedder-policy"),
};

let ok = true;
for (const [name, value] of Object.entries(headers)) {
  const good = name === "Cross-Origin-Opener-Policy" ? value === "same-origin" : value === "require-corp";
  console.log(`${good ? "✓" : "✗"} ${name}: ${value ?? "(missing)"}`);
  if (!good) ok = false;
}

console.log(
  ok
    ? "\nCross-origin isolation is configured correctly."
    : "\nCross-origin isolation is NOT configured. SharedArrayBuffer and threaded WASM will fail.",
);

process.exit(ok ? 0 : 1);
