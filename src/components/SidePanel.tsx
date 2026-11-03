import { For, Show } from "solid-js";
import type { Capabilities } from "../lib/capabilities";
import { formatBytes, MODEL } from "../lib/model";
import type { EngineStats, ModelInfo, UiSettings } from "../lib/types";

interface SidePanelProps {
  info: ModelInfo | null;
  stats: EngineStats | null;
  settings: UiSettings;
  caps: Capabilities | null;
  pendingReload: boolean;
  generating: boolean;
  logs: string[];
  onSetting: <K extends keyof UiSettings>(key: K, value: UiSettings[K]) => void;
  onReload: () => void;
  onClearCache: () => void;
}

function ms(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "—";
  return value >= 1000 ? `${(value / 1000).toFixed(2)} s` : `${value.toFixed(0)} ms`;
}

export function SidePanel(props: SidePanelProps) {
  return (
    <aside class="sidebar">
      <section class="panel model-panel">
        <div class="panel-head">
          <span class="eyebrow">Model</span>
          <span class="live-dot" />
        </div>
        <h3>{MODEL.label}</h3>
        <p class="fine">{props.info?.description ?? "Loading model description…"}</p>

        <dl class="facts">
          <div>
            <dt>Context</dt>
            <dd>{props.info?.contextSize?.toLocaleString() ?? "—"}</dd>
          </div>
          <div>
            <dt>Vocab</dt>
            <dd>{props.info?.vocabSize?.toLocaleString() ?? "—"}</dd>
          </div>
          <div>
            <dt>Threads</dt>
            <dd>{props.info?.threads ?? "—"}</dd>
          </div>
          <div>
            <dt>Load time</dt>
            <dd>{props.info ? ms(props.info.loadMs) : "—"}</dd>
          </div>
          <div>
            <dt>Weights</dt>
            <dd>{formatBytes(MODEL.size)}</dd>
          </div>
          <div>
            <dt>License</dt>
            <dd>{MODEL.license}</dd>
          </div>
        </dl>

        <a
          class="text-link"
          href={`https://huggingface.co/${MODEL.repo}`}
          target="_blank"
          rel="noreferrer"
        >
          Open the model card on Hugging Face ↗
        </a>
      </section>

      <section class="panel">
        <div class="panel-head">
          <span class="eyebrow">Sampling</span>
          <span class="fine">live</span>
        </div>

        <label class="field">
          <span>
            Max tokens <output>{props.settings.maxTokens}</output>
          </span>
          <input
            type="range"
            min="16"
            max="1024"
            step="16"
            value={props.settings.maxTokens}
            onInput={(event) =>
              props.onSetting("maxTokens", Number(event.currentTarget.value))
            }
          />
        </label>

        <label class="field">
          <span>
            Temperature <output>{props.settings.temperature.toFixed(2)}</output>
          </span>
          <input
            type="range"
            min="0"
            max="1.5"
            step="0.05"
            value={props.settings.temperature}
            onInput={(event) =>
              props.onSetting("temperature", Number(event.currentTarget.value))
            }
          />
        </label>

        <label class="field">
          <span>
            Top-p <output>{props.settings.topP.toFixed(2)}</output>
          </span>
          <input
            type="range"
            min="0.1"
            max="1"
            step="0.05"
            value={props.settings.topP}
            onInput={(event) => props.onSetting("topP", Number(event.currentTarget.value))}
          />
        </label>

        <label class="field">
          <span>
            Top-k <output>{props.settings.topK}</output>
          </span>
          <input
            type="range"
            min="1"
            max="100"
            step="1"
            value={props.settings.topK}
            onInput={(event) => props.onSetting("topK", Number(event.currentTarget.value))}
          />
        </label>

        <label class="field">
          <span>
            Repeat penalty <output>{props.settings.repeatPenalty.toFixed(2)}</output>
          </span>
          <input
            type="range"
            min="1"
            max="1.5"
            step="0.01"
            value={props.settings.repeatPenalty}
            onInput={(event) =>
              props.onSetting("repeatPenalty", Number(event.currentTarget.value))
            }
          />
        </label>

        <label class="field">
          <span>System prompt</span>
          <textarea
            rows={3}
            value={props.settings.systemPrompt}
            onInput={(event) =>
              props.onSetting("systemPrompt", event.currentTarget.value)
            }
          />
        </label>
      </section>

      <section class="panel">
        <div class="panel-head">
          <span class="eyebrow">Engine</span>
          <Show when={props.pendingReload}>
            <span class="badge warn">reload needed</span>
          </Show>
        </div>

        <label class="field">
          <span>
            Context window <output>{props.settings.contextSize}</output>
          </span>
          <input
            type="range"
            min="512"
            max="4096"
            step="512"
            value={props.settings.contextSize}
            onInput={(event) =>
              props.onSetting("contextSize", Number(event.currentTarget.value))
            }
          />
        </label>

        <label class="field">
          <span>
            WASM threads <output>{props.settings.threads}</output>
          </span>
          <input
            type="range"
            min="1"
            max={Math.max(1, props.caps?.hardwareConcurrency ?? 8)}
            step="1"
            value={props.settings.threads}
            onInput={(event) =>
              props.onSetting("threads", Number(event.currentTarget.value))
            }
          />
        </label>

        <p class="fine">
          Context size and thread count are fixed when the WASM context is created. Reloading
          re-parses the GGUF (the weights stay cached).
        </p>

        <button
          class="button ghost full"
          onClick={props.onReload}
          disabled={!props.pendingReload || props.generating}
        >
          Reload engine
        </button>
      </section>

      <section class="panel">
        <div class="panel-head">
          <span class="eyebrow">Last run</span>
          <span class="fine">{props.stats ? "measured" : "no data"}</span>
        </div>

        <Show
          when={props.stats}
          fallback={<p class="fine">Send a prompt to collect prefill and decode timings.</p>}
        >
          {(stats) => (
            <dl class="facts">
              <div>
                <dt>Prompt</dt>
                <dd>{stats().promptTokens} tok</dd>
              </div>
              <div>
                <dt>Generated</dt>
                <dd>{stats().generatedTokens} tok</dd>
              </div>
              <div>
                <dt>Prefill</dt>
                <dd>{ms(stats().prefillMs)}</dd>
              </div>
              <div>
                <dt>Decode</dt>
                <dd>{ms(stats().decodeMs)}</dd>
              </div>
              <div>
                <dt>Speed</dt>
                <dd>{stats().tokensPerSecond.toFixed(2)} tok/s</dd>
              </div>
            </dl>
          )}
        </Show>
      </section>

      <details class="panel logs">
        <summary>
          <span class="eyebrow">WASM log</span>
          <span class="fine">{props.logs.length} lines</span>
        </summary>
        <pre>
          <For each={props.logs.slice(-24)}>{(line) => <div>{line}</div>}</For>
        </pre>
      </details>

      <section class="panel danger-panel">
        <div class="panel-head">
          <span class="eyebrow">Local storage</span>
        </div>
        <p class="fine">
          The cached GGUF lives in OPFS. Clearing it does not unload the model from the
          current tab, but the next reload downloads 1.13 GB again.
        </p>
        <button
          class="button danger full"
          disabled={props.generating}
          onClick={() => {
            if (window.confirm("Delete the cached 1.13 GB model from this browser?")) {
              props.onClearCache();
            }
          }}
        >
          Delete cached model
        </button>
      </section>
    </aside>
  );
}
