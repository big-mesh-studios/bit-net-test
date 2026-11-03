import type { DownloadEvent } from "./types";

export class ModelDownloader {
  private worker: Worker;
  private handler: (event: DownloadEvent) => void;

  constructor(handler: (event: DownloadEvent) => void) {
    this.handler = handler;
    this.worker = new Worker(new URL("./download.worker.ts", import.meta.url), {
      type: "module",
      name: "bitnet-download",
    });
    this.worker.onmessage = (event: MessageEvent<DownloadEvent>) => this.handler(event.data);
    this.worker.onerror = (event) => {
      this.handler({ type: "error", message: event.message || "Download worker crashed." });
    };
  }

  start(options: {
    url: string;
    dir: string;
    fileName: string;
    metaName: string;
    size: number;
    etag: string;
    revision: string;
  }): void {
    this.worker.postMessage({ type: "start", ...options });
  }

  cancel(): void {
    this.worker.postMessage({ type: "cancel" });
  }

  dispose(): void {
    this.worker.terminate();
  }
}
