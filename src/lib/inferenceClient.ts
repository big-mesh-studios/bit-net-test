import type { GenerationSettings, InferenceEvent, WorkerInit } from "./types";

export class InferenceClient {
  private worker: Worker;
  private abortBuffer: SharedArrayBuffer;
  private abortView: Int32Array;
  private handler: (event: InferenceEvent) => void;

  constructor(handler: (event: InferenceEvent) => void) {
    this.handler = handler;
    this.abortBuffer = new SharedArrayBuffer(4);
    this.abortView = new Int32Array(this.abortBuffer);
    this.worker = new Worker(new URL("./inference.worker.ts", import.meta.url), {
      type: "module",
      name: "bitnet-inference",
    });
    this.worker.onmessage = (event: MessageEvent<InferenceEvent>) => this.handler(event.data);
    this.worker.onerror = (event) => {
      this.handler({
        type: "error",
        message: event.message || "Inference worker crashed (out of memory?)",
      });
    };
  }

  init(options: Omit<WorkerInit, "abortBuffer" | "baseUrl">): void {
    Atomics.store(this.abortView, 0, 0);
    // Resolve the app root on the main thread; a module worker's own URL points
    // at the hashed asset folder, not at the folder that contains `wasm/`.
    const baseUrl = new URL(import.meta.env.BASE_URL, document.baseURI).href;
    this.worker.postMessage({
      type: "init",
      init: { ...options, baseUrl, abortBuffer: this.abortBuffer },
    } satisfies { type: "init"; init: WorkerInit });
  }

  generate(
    requestId: string,
    messages: { role: string; content: string }[],
    settings: GenerationSettings,
  ): void {
    Atomics.store(this.abortView, 0, 0);
    this.worker.postMessage({ type: "generate", requestId, messages, settings });
  }

  abort(): void {
    Atomics.store(this.abortView, 0, 1);
  }

  reset(): void {
    this.worker.postMessage({ type: "reset" });
  }

  dispose(): void {
    this.worker.postMessage({ type: "dispose" });
    this.worker.terminate();
  }
}
