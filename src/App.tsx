import { createEffect, createMemo, createSignal, onSettled, Show } from "solid-js";
import { BootScreen } from "./components/BootScreen";
import { ChatPanel } from "./components/ChatPanel";
import { SidePanel } from "./components/SidePanel";
import { blockingProblem, detectCapabilities, type Capabilities } from "./lib/capabilities";
import { ensureCrossOriginIsolation } from "./lib/isolation";
import { ModelDownloader } from "./lib/downloadClient";
import { InferenceClient } from "./lib/inferenceClient";
import { CACHE, MODEL, formatBytes } from "./lib/model";
import { getCachedModelFile, clearModelCache, requestPersistence } from "./lib/opfs";
import type {
  AppPhase,
  ChatMessage,
  DownloadProgress,
  Draft,
  EngineStats,
  InferenceEvent,
  ModelInfo,
  UiSettings,
} from "./lib/types";

const DEFAULT_SETTINGS: UiSettings = {
  systemPrompt:
    "You are a helpful, concise assistant. You are running entirely inside the user's browser as a 1.58-bit BitNet model compiled to WebAssembly.",
  maxTokens: 256,
  temperature: 0.7,
  topP: 0.9,
  topK: 40,
  repeatPenalty: 1.1,
  contextSize: 2048,
  threads: Math.min(4, Math.max(1, navigator.hardwareConcurrency || 4)),
};

const BATCH_SIZE = 128;

export default function App() {
  const [phase, setPhase] = createSignal<AppPhase>("checking");
  const [caps, setCaps] = createSignal<Capabilities | null>(null);
  const [status, setStatus] = createSignal("Checking browser capabilities…");
  const [error, setError] = createSignal("");
  const [download, setDownload] = createSignal<DownloadProgress | null>(null);
  const [info, setInfo] = createSignal<ModelInfo | null>(null);
  const [settings, setSettings] = createSignal<UiSettings>(DEFAULT_SETTINGS);

  const [messages, setMessages] = createSignal<ChatMessage[]>([]);
  const [draft, setDraft] = createSignal<Draft | null>(null);
  const [input, setInput] = createSignal("");
  const [generating, setGenerating] = createSignal(false);
  const [activeRequest, setActiveRequest] = createSignal<string | null>(null);
  const [stats, setStats] = createSignal<EngineStats | null>(null);
  const [liveTps, setLiveTps] = createSignal(0);
  const [logs, setLogs] = createSignal<string[]>([]);

  let client: InferenceClient | undefined;
  let downloader: ModelDownloader | undefined;
  let scroller: HTMLDivElement | undefined;

  const canSend = createMemo(
    () => phase() === "ready" && !generating() && input().trim().length > 0,
  );

  const pendingReload = createMemo(() => {
    const current = info();
    if (!current) return false;
    const next = settings();
    return current.contextSize !== next.contextSize || current.threads !== next.threads;
  });

  function updateSetting<K extends keyof UiSettings>(key: K, value: UiSettings[K]) {
    setSettings((current) => ({ ...current, [key]: value }));
  }

  function finalize(text: string, nextStats?: EngineStats) {
    const content = (text || draft()?.content || "").trimEnd();
    if (content.trim().length > 0) {
      setMessages((current) => [
        ...current,
        { id: crypto.randomUUID(), role: "assistant", content },
      ]);
    }
    setDraft(null);
    setGenerating(false);
    setActiveRequest(null);
    setLiveTps(0);
    if (nextStats) setStats(nextStats);
  }

  function handleInferenceEvent(event: InferenceEvent) {
    switch (event.type) {
      case "status":
        setStatus(event.message);
        break;
      case "log":
        setLogs((current) => [...current.slice(-79), event.message]);
        break;
      case "ready":
        setInfo(event.info);
        setStatus("");
        setPhase("ready");
        break;
      case "token": {
        if (event.requestId !== activeRequest()) return;
        setDraft((current) => {
          if (!current) return current;
          const tokens = current.tokens + 1;
          const elapsed = (performance.now() - current.startedAt) / 1000;
          if (elapsed > 0) setLiveTps(tokens / elapsed);
          return { ...current, content: current.content + event.text, tokens };
        });
        break;
      }
      case "done":
        if (event.requestId !== activeRequest()) return;
        finalize(event.text, event.stats);
        break;
      case "aborted":
        if (event.requestId !== activeRequest()) return;
        finalize(event.text);
        setStatus("Generation stopped.");
        break;
      case "error":
        if (event.requestId && event.requestId !== activeRequest()) return;
        setError(event.message);
        if (event.requestId) {
          finalize(draft()?.content ?? "");
        } else {
          setPhase("error");
        }
        break;
    }
  }

  function handleDownloadEvent(event: import("./lib/types").DownloadEvent) {
    switch (event.type) {
      case "started":
        setStatus(
          event.offset > 0
            ? `Resuming at ${formatBytes(event.offset)}…`
            : "Downloading the model from Hugging Face…",
        );
        setDownload({
          received: event.offset,
          total: event.total,
          bytesPerSecond: 0,
          etaSeconds: null,
          resuming: event.offset > 0,
        });
        break;
      case "progress":
        setDownload(event.progress);
        break;
      case "done":
        downloader?.dispose();
        downloader = undefined;
        setDownload(null);
        setStatus("Download complete. Starting the WASM engine…");
        startEngine();
        break;
      case "cancelled":
        downloader?.dispose();
        downloader = undefined;
        setDownload(null);
        setPhase("needs-download");
        setStatus("Download paused. The partial file is kept, so the next attempt resumes.");
        break;
      case "error":
        downloader?.dispose();
        downloader = undefined;
        setDownload(null);
        setError(event.message);
        setPhase("error");
        break;
    }
  }

  function startDownload() {
    downloader?.dispose();
    setError("");
    setPhase("downloading");
    setDownload({
      received: 0,
      total: MODEL.size,
      bytesPerSecond: 0,
      etaSeconds: null,
      resuming: false,
    });
    setStatus("Requesting persistent storage…");
    void requestPersistence();
    downloader = new ModelDownloader(handleDownloadEvent);
    downloader.start({
      url: `https://huggingface.co/${MODEL.repo}/resolve/${MODEL.revision}/${MODEL.fileName}`,
      dir: CACHE.dir,
      fileName: CACHE.fileName,
      metaName: CACHE.metaName,
      size: MODEL.size,
      etag: MODEL.sha256,
      revision: MODEL.revision,
    });
  }

  function startEngine() {
    setPhase("loading");
    setError("");
    setStatus("Booting the threaded WASM runtime…");
    client?.dispose();
    client = new InferenceClient(handleInferenceEvent);
    const current = settings();
    client.init({
      cacheDir: CACHE.dir,
      fileName: CACHE.fileName,
      metaName: CACHE.metaName,
      contextSize: current.contextSize,
      batchSize: BATCH_SIZE,
      threads: current.threads,
    });
  }

  async function boot() {
    setPhase("checking");
    setStatus("Checking browser capabilities…");
    // On static hosts without COOP/COEP headers this registers the folder-local
    // service worker and reloads once (the page unloads before the await
    // resolves). On hosts that already set the headers this is a no-op.
    await ensureCrossOriginIsolation();
    const detected = await detectCapabilities();
    setCaps(detected);

    const problem = blockingProblem(detected);
    if (problem) {
      setError(problem);
      setPhase("blocked");
      return;
    }

    setStatus("Looking for a cached copy of the model…");
    const cached = await getCachedModelFile({
      size: MODEL.size,
      etag: MODEL.sha256,
      revision: MODEL.revision,
    });

    if (cached) {
      setStatus(`Found ${formatBytes(cached.size)} in Origin Private File System.`);
      startEngine();
    } else {
      setPhase("needs-download");
      setStatus("The model is not cached yet.");
      startDownload();
    }
  }

  function send() {
    const content = input().trim();
    if (!canSend()) return;

    const history = messages();
    const system = settings().systemPrompt.trim();
    const requestMessages = [
      ...(system ? [{ role: "system", content: system }] : []),
      ...history.map((message) => ({ role: message.role, content: message.content })),
      { role: "user", content },
    ];

    setMessages([...history, { id: crypto.randomUUID(), role: "user", content }]);
    setInput("");
    setGenerating(true);
    setError("");
    setStats(null);
    setLiveTps(0);

    const requestId = crypto.randomUUID();
    setActiveRequest(requestId);
    setDraft({ requestId, content: "", startedAt: performance.now(), tokens: 0 });
    client?.generate(requestId, requestMessages, settings());
  }

  function stop() {
    client?.abort();
  }

  function clearChat() {
    setMessages([]);
    setDraft(null);
    setGenerating(false);
    setActiveRequest(null);
    setStats(null);
    setError("");
    setStatus("");
    setLiveTps(0);
    client?.reset();
  }

  function restartEngine() {
    if (generating()) return;
    client?.dispose();
    startEngine();
  }

  onSettled(() => {
    void boot();
    return () => {
      client?.dispose();
      downloader?.dispose();
    };
  });

  // Keep the transcript pinned to the bottom while tokens stream in.
  createEffect(
    () => [messages().length, draft()?.content.length ?? 0, draft() ? 1 : 0] as const,
    () => {
      requestAnimationFrame(() => {
        if (scroller) scroller.scrollTop = scroller.scrollHeight;
      });
    },
  );

  return (
    <div class="app">
      <header class="topbar">
        <div class="brand">
          <span class="brand-mark">1.58</span>
          <div class="brand-copy">
            <strong>BitNet</strong>
            <span>WASM inference lab</span>
          </div>
        </div>

        <div class="topbar-meta">
          <span class="chip">
            <span class="dot" /> {MODEL.label}
          </span>
          <span class="chip muted">I2_S · {formatBytes(MODEL.size)}</span>
          <span class={`chip ${phase() === "ready" ? "ok" : "warn"}`}>
            {phase() === "ready" ? "engine ready" : phase()}
          </span>
        </div>
      </header>

      <Show
        when={phase() === "ready"}
        fallback={
          <BootScreen
            phase={phase()}
            caps={caps()}
            status={status()}
            error={error()}
            download={download()}
            onStartDownload={startDownload}
            onCancelDownload={() => downloader?.cancel()}
            onRetry={() => void boot()}
          />
        }
      >
        <main class="workspace">
          <ChatPanel
            messages={messages()}
            draft={draft()}
            input={input()}
            generating={generating()}
            canSend={canSend()}
            liveTps={liveTps()}
            status={status()}
            error={error()}
            onInput={setInput}
            onSend={send}
            onStop={stop}
            onClear={clearChat}
            onScroller={(element) => (scroller = element)}
          />

          <SidePanel
            info={info()}
            stats={stats()}
            settings={settings()}
            caps={caps()}
            pendingReload={pendingReload()}
            generating={generating()}
            logs={logs()}
            onSetting={updateSetting}
            onReload={restartEngine}
            onClearCache={() => {
              // The cache panel intentionally only clears when the engine is idle.
              if (generating()) return;
              void clearModelCache();
            }}
          />
        </main>
      </Show>

      <footer class="footer">
        <span>
          Everything runs locally: model weights, tokenizer, sampler and BitNet I2_S kernels.
        </span>
        <span class="mono">no WebGPU · no server · no telemetry</span>
      </footer>
    </div>
  );
}
