/// <reference lib="webworker" />
import type { DownloadEvent, DownloadProgress } from "./types";

interface StartMessage {
  type: "start";
  url: string;
  dir: string;
  fileName: string;
  metaName: string;
  size: number;
  etag: string;
  revision: string;
}

interface CancelMessage {
  type: "cancel";
}

type Incoming = StartMessage | CancelMessage;

const post = (event: DownloadEvent) => self.postMessage(event);

let controller: AbortController | null = null;
let running = false;

async function readMeta(
  dir: FileSystemDirectoryHandle,
  metaName: string,
): Promise<{
  complete?: boolean;
  size?: number;
  etag?: string;
  revision?: string;
} | null> {
  try {
    const handle = await dir.getFileHandle(metaName);
    const file = await handle.getFile();
    return JSON.parse(await file.text());
  } catch {
    return null;
  }
}

async function writeMeta(
  dir: FileSystemDirectoryHandle,
  metaName: string,
  value: unknown,
): Promise<void> {
  const handle = await dir.getFileHandle(metaName, { create: true });
  const writable = await handle.createWritable();
  await writable.write(JSON.stringify(value, null, 2));
  await writable.close();
}

async function download(msg: StartMessage): Promise<void> {
  const root = await navigator.storage.getDirectory();
  const dir = await root.getDirectoryHandle(msg.dir, { create: true });
  const meta = await readMeta(dir, msg.metaName);

  const handle = await dir.getFileHandle(msg.fileName, { create: true });
  const access = await handle.createSyncAccessHandle();

  try {
    let offset = access.getSize();

    const sameObject =
      meta?.etag === msg.etag &&
      meta?.revision === msg.revision &&
      meta?.size === msg.size;

    if (meta?.complete && sameObject && offset === msg.size) {
      post({ type: "done", bytes: offset });
      return;
    }

    if (!sameObject && offset > 0) {
      access.truncate(0);
      offset = 0;
    }
    if (offset > msg.size) {
      access.truncate(0);
      offset = 0;
    }

    post({ type: "started", total: msg.size, offset });

    const headers = new Headers();
    headers.set("Accept", "application/octet-stream");
    if (offset > 0) headers.set("Range", `bytes=${offset}-`);

    controller = new AbortController();
    const response = await fetch(msg.url, {
      headers,
      signal: controller.signal,
      mode: "cors",
      credentials: "omit",
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(`Hugging Face returned HTTP ${response.status}`);
    }

    // The CDN normally honours Range. If it does not, restart from zero.
    if (offset > 0 && response.status !== 206) {
      access.truncate(0);
      offset = 0;
    }

    const contentRange = response.headers.get("content-range");
    let total = msg.size;
    if (contentRange) {
      const match = /\/(\d+)\s*$/.exec(contentRange);
      if (match) total = Number(match[1]);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error("The browser did not expose a response stream.");

    let received = offset;
    let lastPost = performance.now();
    let lastBytes = received;
    let lastTime = lastPost;

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      access.write(value, { at: received });
      received += value.byteLength;

      const now = performance.now();
      if (now - lastPost > 200) {
        const dt = (now - lastTime) / 1000;
        const speed = dt > 0 ? (received - lastBytes) / dt : 0;
        const remaining = Math.max(0, total - received);
        const progress: DownloadProgress = {
          received,
          total,
          bytesPerSecond: speed,
          etaSeconds: speed > 0 ? remaining / speed : null,
          resuming: offset > 0,
        };
        post({ type: "progress", progress });
        lastPost = now;
        lastTime = now;
        lastBytes = received;
      }
    }

    access.flush();
    access.truncate(received);
    const finalSize = access.getSize();

    if (finalSize !== msg.size) {
      throw new Error(
        `Download ended at ${finalSize} bytes, expected ${msg.size}. The partial file will be resumed on retry.`,
      );
    }

    post({
      type: "progress",
      progress: {
        received,
        total,
        bytesPerSecond: 0,
        etaSeconds: 0,
        resuming: offset > 0,
      },
    });

    await writeMeta(dir, msg.metaName, {
      complete: true,
      size: msg.size,
      etag: msg.etag,
      revision: msg.revision,
      downloadedAt: Date.now(),
    });

    post({ type: "done", bytes: received });
  } finally {
    try {
      access.close();
    } catch {
      // Already closed.
    }
    controller = null;
  }
}

self.onmessage = async (event: MessageEvent<Incoming>) => {
  const msg = event.data;

  if (msg.type === "cancel") {
    controller?.abort();
    return;
  }

  if (msg.type !== "start" || running) return;
  running = true;

  try {
    await download(msg);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      post({ type: "cancelled", bytes: 0 });
    } else {
      post({ type: "error", message: error instanceof Error ? error.message : String(error) });
    }
  } finally {
    running = false;
  }
};
