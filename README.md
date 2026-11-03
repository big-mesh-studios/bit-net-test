# BitNet b1.58 on WebAssembly + Solid 2

Runs the official `microsoft/bitnet-b1.58-2B-4T` I2_S model entirely in the
browser: no WebGPU, no inference server, no telemetry.

- Solid 2 (`solid-js` / `@solidjs/web` 2.0.0-rc.20) + Vite 8
- wasm32 build of [BitNet](https://github.com/microsoft/BitNet)'s llama.cpp fork
- WebAssembly SIMD I2_S kernels, pthreads via `SharedArrayBuffer`
- 1.13 GB GGUF downloaded once from Hugging Face and cached in OPFS
- Works from a GitHub Pages project subfolder through a folder-scoped COOP/COEP
  service worker

## Requirements

- Node.js 22+
- [Emscripten SDK](https://emscripten.org/docs/getting_started/downloads.html)
  (`emcc`, `em++`, `emcmake` on `PATH`)
- A Chromium/Firefox/Safari build with WebAssembly SIMD, OPFS and
  `SharedArrayBuffer`

## Build the WASM runtime

The generated WASM is intentionally not committed. Build it once, and again
after changing the C/C++ sources or patches:

```sh
npm run build:wasm
```

The script clones the pinned BitNet and llama.cpp revisions into `.cache/` on
first run, applies `patches/gemm-config-wasm.patch` and
`patches/i2s-wasm-simd.patch`, builds the static wasm32 libraries, and writes:

```
public/wasm/bitnet.js
public/wasm/bitnet.wasm
```

This takes several minutes.

## Develop

```sh
npm ci
npm run dev
```

Vite serves the app at http://localhost:5173 with the COOP/COEP headers needed
for `SharedArrayBuffer`.

## Build and preview

```sh
npm run build
npm run preview
```

The production build uses a relative base (`./`), so the same `dist/` works at
the origin root or under any subfolder.

## Deploy to GitHub Pages

`.github/workflows/gh-pages.yml` does this on every push to `main` (and on
manual dispatch):

1. Set up Node 22 and Emscripten 3.1.74.
2. Restore the pinned BitNet/llama.cpp checkout and Emscripten caches.
3. Run `npm run build:wasm`.
4. Run `npm run build`.
5. Publish `dist/` to the `gh-pages` branch.

In the repository settings, set **Pages -> Source** to **Deploy from a branch**
and choose `gh-pages` / `(root)`.

`.github/workflows/ci.yml` runs the typecheck and the production build (without
Emscripten, since the WASM is resolved at runtime) on pull requests and pushes
to `main`.

No server header configuration is required. GitHub Pages cannot send COOP/COEP,
so `public/coi-serviceworker.js` adds them at runtime. The worker is registered
from the app's own base URL, so a project published at
`https://user.github.io/<repo>/` gets:

```
script: https://user.github.io/<repo>/coi-serviceworker.js
scope:  https://user.github.io/<repo>/
```

It only rewrites responses inside that scope, so other projects on the same
GitHub Pages origin are untouched. The first visit installs the worker and
reloads once; after that the page is cross-origin isolated and the threaded
WASM engine can start. The service worker is a no-op on hosts that already send
the headers.

## Model cache

The GGUF is downloaded from the pinned Hugging Face revision on first use and
stored in the Origin Private File System (`bitnet` / `ggml-model-i2_s.gguf`).
Downloads resume with HTTP range requests. Clearing site data or using the
"Clear cache" action in the side panel removes it.

## Project layout

```
public/coi-serviceworker.js   COOP/COEP worker, scoped to the app folder
public/wasm/                  generated Emscripten output (gitignored)
wasm/bitnet_wasm.cpp          C ABI wrapper around llama.cpp
src/lib/download.worker.ts    resumable HF download into OPFS
src/lib/inference.worker.ts   Emscripten module, tokenizer, sampling loop
src/lib/isolation.ts          service-worker registration / reload
src/lib/*.ts                  OPFS, capabilities, worker clients
patches/                      pinned upstream source patches
scripts/build-wasm.sh         reproducible WASM build
```

## Notes

- Weights are 2-bit I2_S and activations are int8 (W2A8) integer dot products. The
  prompt format is `User: ...<|eot_id|>Assistant: `, matching the model's
  training data rather than the GGUF's embedded chat template.
- Prefill is batched at 128 tokens; decode is one token at a time.
- `SharedArrayBuffer` requires a secure context. `http://localhost` works;
  other hostnames must use HTTPS.
