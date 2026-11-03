import { For, Show } from "solid-js";
import type { Capabilities } from "../lib/capabilities";
import { formatBytes, formatDuration, MODEL } from "../lib/model";
import type { AppPhase, DownloadProgress } from "../lib/types";

interface BootScreenProps {
  phase: AppPhase;
  caps: Capabilities | null;
  status: string;
  error: string;
  download: DownloadProgress | null;
  onStartDownload: () => void;
  onCancelDownload: () => void;
  onRetry: () => void;
}

function percent(progress: DownloadProgress): number {
  if (!progress.total) return 0;
  return Math.min(100, (progress.received / progress.total) * 100);
}

export function BootScreen(props: BootScreenProps) {
  const capabilities = () => [
    {
      label: "WebAssembly SIMD",
      detail: "v128 intrinsics",
      ok: props.caps?.simd ?? false,
    },
    {
      label: "SharedArrayBuffer",
      detail: props.caps?.crossOriginIsolated ? "cross-origin isolated" : "COOP/COEP missing",
      ok: Boolean(props.caps?.sharedArrayBuffer && props.caps?.crossOriginIsolated),
    },
    {
      label: "Origin Private File System",
      detail: "1.13 GB model cache",
      ok: props.caps?.opfs ?? false,
    },
    {
      label: "Threads",
      detail: `${props.caps?.hardwareConcurrency ?? "?"} logical cores available`,
      ok: (props.caps?.hardwareConcurrency ?? 1) > 1,
    },
  ];

  const showDownload = () =>
    props.phase === "downloading" || props.phase === "needs-download";

  return (
    <main class="boot">
      <div class="boot-hero">
        <div class="eyebrow">
          <span class="pulse" />
          local-first inference
        </div>
        <h1>
          1.58 bits.
          <br />
          <span>Zero GPU.</span>
        </h1>
        <p class="lede">
          BitNet b1.58 2B4T is a ternary language model. This demo compiles Microsoft's
          bitnet.cpp kernels to WebAssembly with SIMD and runs the whole thing — weights,
          tokenizer, sampler — inside your browser tab.
        </p>

        <div class="model-facts">
          <div>
            <span>Parameters</span>
            <strong>2.4B</strong>
          </div>
          <div>
            <span>Weights</span>
            <strong>1.58 bit</strong>
          </div>
          <div>
            <span>Download</span>
            <strong>{formatBytes(MODEL.size)}</strong>
          </div>
          <div>
            <span>Backend</span>
            <strong>WASM SIMD</strong>
          </div>
        </div>
      </div>

      <section class="boot-card">
        <Show when={props.phase === "checking"}>
          <div class="boot-state">
            <span class="spinner" />
            <div>
              <h2>Checking this browser</h2>
              <p>{props.status}</p>
            </div>
          </div>
        </Show>

        <Show when={props.phase === "loading"}>
          <div class="boot-state">
            <span class="spinner" />
            <div>
              <h2>Loading the 1.58-bit weights</h2>
              <p>{props.status}</p>
              <p class="fine">
                Parsing the GGUF file and allocating the KV cache. On a typical laptop this
                takes 10–40 seconds. The tab may feel busy while WASM memory grows.
              </p>
            </div>
          </div>
        </Show>

        <Show when={showDownload()}>
          <div class="download-head">
            <div>
              <div class="eyebrow">Step 1 of 2</div>
              <h2>Cache the model locally</h2>
              <p>
                Downloaded once from Hugging Face into the Origin Private File System, then
                reused on every visit. Nothing is sent to a server after this.
              </p>
            </div>
            <span class="size-badge">{formatBytes(MODEL.size)}</span>
          </div>

          <Show
            when={props.download}
            fallback={
              <div class="download-actions">
                <button class="button primary" onClick={props.onStartDownload}>
                  Download model
                </button>
                <span class="fine">Resumable · stored in OPFS · not committed to browser cache</span>
              </div>
            }
          >
            {(progress) => (
              <>
                <div class="progress-track" aria-label="Model download progress">
                  <div
                    class="progress-fill"
                    style={{ width: `${percent(progress())}%` }}
                  />
                </div>
                <div class="progress-meta">
                  <span>
                    {formatBytes(progress().received)} / {formatBytes(progress().total)}
                  </span>
                  <span>{percent(progress()).toFixed(1)}%</span>
                </div>
                <div class="progress-meta subtle">
                  <span>
                    {progress().resuming ? "resuming · " : ""}
                    {progress().bytesPerSecond > 0
                      ? `${formatBytes(progress().bytesPerSecond)}/s`
                      : "waiting for bytes…"}
                  </span>
                  <span>
                    {progress().etaSeconds != null
                      ? `${formatDuration(progress().etaSeconds)} left`
                      : "estimating…"}
                  </span>
                </div>
                <div class="download-actions">
                  <button class="button ghost" onClick={props.onCancelDownload}>
                    Pause download
                  </button>
                  <span class="fine">
                    A partial download is kept and resumed with an HTTP Range request.
                  </span>
                </div>
              </>
            )}
          </Show>
        </Show>

        <Show when={props.phase === "blocked" || props.phase === "error"}>
          <div class="boot-state error">
            <div class="error-icon">!</div>
            <div>
              <h2>
                {props.phase === "blocked" ? "This browser can't run the demo" : "Something broke"}
              </h2>
              <p>{props.error}</p>
              <Show when={props.phase === "blocked"}>
                <p class="fine">
                  The production server must send{" "}
                  <code>Cross-Origin-Opener-Policy: same-origin</code> and{" "}
                  <code>Cross-Origin-Embedder-Policy: require-corp</code>.
                </p>
              </Show>
              <button class="button ghost" onClick={props.onRetry}>
                Try again
              </button>
            </div>
          </div>
        </Show>

        <div class="capability-grid">
          <For each={capabilities()}>
            {(capability) => (
              <div class={`capability ${capability.ok ? "ok" : "bad"}`}>
                <span class="capability-mark">{capability.ok ? "✓" : "×"}</span>
                <div>
                  <strong>{capability.label}</strong>
                  <span>{capability.detail}</span>
                </div>
              </div>
            )}
          </For>
        </div>

        <div class="boot-foot">
          <span>
            Storage quota: {formatBytes(props.caps?.storageQuota ?? 0)}
            {props.caps?.storageUsage
              ? ` · ${formatBytes(props.caps.storageUsage)} already used`
              : ""}
          </span>
          <span class="mono">MIT weights · bitnet.cpp · Emscripten</span>
        </div>
      </section>
    </main>
  );
}
