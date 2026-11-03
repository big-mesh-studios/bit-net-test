import { defineConfig } from "vite";
import solid from "@solidjs/vite-plugin";

// SharedArrayBuffer (Emscripten pthreads) requires cross-origin isolation.
const isolationHeaders = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
  "Cross-Origin-Resource-Policy": "cross-origin",
};

export default defineConfig(({ command }) => ({
  plugins: [solid()],
  // A relative base lets the same build live at /repo/, /team/repo/ or at the
  // origin root on GitHub Pages. Workers and the WASM bundle resolve against
  // the base passed from the main thread.
  base: command === "build" ? "./" : "/",
  server: {
    headers: isolationHeaders,
    port: 5173,
  },
  preview: {
    headers: isolationHeaders,
  },
  worker: {
    format: "es",
  },
  build: {
    target: "es2022",
    assetsInlineLimit: 0,
  },
}));
