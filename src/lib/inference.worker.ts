/// <reference lib="webworker" />
import type {
  EngineStats,
  GenerationSettings,
  InferenceEvent,
  ModelInfo,
  WorkerInit,
} from "./types";

interface BitNetModule {
  FS: {
    mkdirTree(path: string): void;
    mount(fs: unknown, opts: unknown, path: string): void;
    unmount(path: string): void;
  };
  WORKERFS: unknown;
  HEAPU8: Uint8Array;
  HEAP32: Int32Array;
  _malloc(size: number): number;
  _free(ptr: number): void;
  stringToUTF8(str: string, ptr: number, maxBytes: number): void;
  lengthBytesUTF8(str: string): number;
  UTF8ToString(ptr: number): string;
  _bn_last_error(): number;
  _bn_init(pathPtr: number, nCtx: number, nBatch: number, nThreads: number): number;
  _bn_free(): void;
  _bn_reset(): void;
  _bn_n_ctx(): number;
  _bn_n_past(): number;
  _bn_vocab_size(): number;
  _bn_model_desc(out: number, cap: number): number;
  _bn_tokenize(text: number, addSpecial: number, out: number, cap: number): number;
  _bn_detokenize(tokens: number, n: number, out: number, cap: number): number;
  _bn_decode(tokens: number, n: number, startPos: number): number;
  _bn_sampler_init(
    temperature: number,
    topP: number,
    topK: number,
    repeatPenalty: number,
    repeatLastN: number,
    seed: number,
  ): number;
  _bn_sample(): number;
  _bn_is_eog(token: number): boolean | number;
  _bn_token_piece(token: number, out: number, cap: number): number;
  _bn_prompt_ms(): number;
  _bn_eval_ms(): number;
  _bn_prompt_tokens(): number;
  _bn_eval_tokens(): number;
  _bn_perf_reset(): void;
}

type Incoming =
  | { type: "init"; init: WorkerInit }
  | { type: "generate"; requestId: string; messages: { role: string; content: string }[]; settings: GenerationSettings }
  | { type: "reset" }
  | { type: "dispose" };

const post = (event: InferenceEvent) => self.postMessage(event);

let module: BitNetModule | null = null;
let init: WorkerInit | null = null;
let abortView: Int32Array | null = null;
let ready = false;

function isAborted(): boolean {
  return abortView ? Atomics.load(abortView, 0) === 1 : false;
}

function readCString(ptr: number): string {
  return module ? module.UTF8ToString(ptr) : "";
}

function lastError(): string {
  if (!module) return "WASM module is not loaded.";
  const ptr = module._bn_last_error();
  return ptr ? module.UTF8ToString(ptr) : "Unknown BitNet error.";
}

function allocString(value: string): number {
  if (!module) throw new Error("WASM module is not loaded.");
  const bytes = module.lengthBytesUTF8(value) + 1;
  const ptr = module._malloc(bytes);
  if (!ptr) throw new Error("Out of WASM memory while allocating a string.");
  module.stringToUTF8(value, ptr, bytes);
  return ptr;
}

async function loadModule(baseUrl: string): Promise<BitNetModule> {
  const jsUrl = new URL("wasm/bitnet.js", baseUrl).href;
  const factoryModule = (await import(/* @vite-ignore */ jsUrl)) as {
    default: (options?: Record<string, unknown>) => Promise<BitNetModule>;
  };

  const instance = await factoryModule.default({
    locateFile: (path: string) => new URL(`wasm/${path}`, baseUrl).href,
    mainScriptUrlOrBlob: jsUrl,
    print: (message: string) => post({ type: "log", message }),
    printErr: (message: string) => post({ type: "log", message }),
    onAbort: (what: unknown) =>
      post({ type: "error", message: `WASM abort: ${String(what)}` }),
  });

  return instance;
}

async function mountModel(instance: BitNetModule, workerInit: WorkerInit): Promise<void> {
  const root = await navigator.storage.getDirectory();
  const dir = await root.getDirectoryHandle(workerInit.cacheDir);
  const handle = await dir.getFileHandle(workerInit.fileName);
  const file = await handle.getFile();

  instance.FS.mkdirTree("/models");
  const fs = instance.WORKERFS ?? (instance.FS as unknown as { filesystems: { WORKERFS: unknown } }).filesystems?.WORKERFS;
  if (!fs) throw new Error("Emscripten WORKERFS support is missing from the WASM build.");
  instance.FS.mount(fs, { files: [file] }, "/models");
}

async function initEngine(workerInit: WorkerInit): Promise<void> {
  init = workerInit;
  abortView = new Int32Array(workerInit.abortBuffer);
  Atomics.store(abortView, 0, 0);

  const started = performance.now();
  post({ type: "status", message: "Loading WebAssembly SIMD runtime…" });

  const baseUrl = workerInit.baseUrl;
  module = await loadModule(baseUrl);
  post({ type: "status", message: "Mounting cached model…" });
  await mountModel(module, workerInit);

  post({ type: "status", message: "Loading 1.13 GB of 1.58-bit weights into WASM memory…" });
  const pathPtr = allocString(`/models/${workerInit.fileName}`);
  let ok = 0;
  try {
    ok = module._bn_init(pathPtr, workerInit.contextSize, workerInit.batchSize, workerInit.threads);
  } finally {
    module._free(pathPtr);
  }

  try {
    module.FS.unmount("/models");
  } catch {
    // Not fatal.
  }

  if (!ok) throw new Error(lastError());

  const descPtr = module._malloc(256);
  const descLen = module._bn_model_desc(descPtr, 256);
  const description = descLen > 0 ? module.UTF8ToString(descPtr) : "BitNet";
  module._free(descPtr);

  const info: ModelInfo = {
    description,
    contextSize: module._bn_n_ctx(),
    vocabSize: module._bn_vocab_size(),
    threads: workerInit.threads,
    loadMs: performance.now() - started,
  };

  ready = true;
  post({ type: "ready", info });
}

// BitNet b1.58 2B4T was trained with "User: <content><|eot_id|>Assistant: "
// turns, see gpu/tokenizer.py in microsoft/BitNet. The template embedded in the
// official GGUF uses "Human:"/"BITNETAssistant:" and the eos token instead, and
// llama.cpp's heuristic parser cannot read it, so format the turns here.
// llama_tokenize() adds <|begin_of_text|> because the vocab sets add_bos_token.
function formatPrompt(messages: { role: string; content: string }[]): string {
  let prompt = "";
  for (const message of messages) {
    const role =
      message.role === "system" ? "System" : message.role === "assistant" ? "Assistant" : "User";
    prompt += `${role}: ${message.content.trim()}<|eot_id|>`;
  }
  return `${prompt}Assistant: `;
}

function tokenize(instance: BitNetModule, text: string): Int32Array {
  const textPtr = allocString(text);
  try {
    let cap = Math.max(64, text.length + 32);
    let tokensPtr = instance._malloc(cap * 4);
    let count = instance._bn_tokenize(textPtr, 1, tokensPtr, cap);

    if (count < 0) {
      instance._free(tokensPtr);
      cap = -count + 8;
      tokensPtr = instance._malloc(cap * 4);
      count = instance._bn_tokenize(textPtr, 1, tokensPtr, cap);
    }
    if (count < 0) throw new Error("Tokenization failed.");

    const result = new Int32Array(count);
    const heap = new Int32Array(instance.HEAP32.buffer, tokensPtr, count);
    result.set(heap);
    instance._free(tokensPtr);
    return result;
  } finally {
    instance._free(textPtr);
  }
}

function decodeChunk(instance: BitNetModule, tokens: Int32Array, startPos: number): void {
  const ptr = instance._malloc(tokens.length * 4);
  if (!ptr) throw new Error("Out of WASM memory while decoding the prompt.");
  try {
    const heap = new Int32Array(instance.HEAP32.buffer, ptr, tokens.length);
    heap.set(tokens);
    const rc = instance._bn_decode(ptr, tokens.length, startPos);
    if (rc !== 0) throw new Error(lastError());
  } finally {
    instance._free(ptr);
  }
}

function generate(
  requestId: string,
  messages: { role: string; content: string }[],
  settings: GenerationSettings,
): void {
  if (!module || !init || !ready) {
    post({ type: "error", message: "The model is not loaded yet.", requestId });
    return;
  }

  const instance = module;
  let generatedText = "";
  let step = "reset";

  try {
    instance._bn_reset();
    instance._bn_perf_reset();
    Atomics.store(abortView!, 0, 0);

    step = "format prompt";
    const prompt = formatPrompt(messages);
    step = "tokenize";
    const tokens = tokenize(instance, prompt);
    if (tokens.length === 0) throw new Error("The prompt produced no tokens.");
    if (tokens.length + settings.maxTokens > settings.contextSize) {
      throw new Error(
        `Prompt (${tokens.length} tokens) + max tokens (${settings.maxTokens}) exceeds the ${settings.contextSize}-token context.`,
      );
    }

    post({ type: "status", message: `Prefilling ${tokens.length} tokens…` });

    step = "prefill";
    for (let offset = 0; offset < tokens.length; offset += init.batchSize) {
      if (isAborted()) {
        post({ type: "aborted", requestId, text: generatedText });
        return;
      }
      const end = Math.min(offset + init.batchSize, tokens.length);
      decodeChunk(instance, tokens.subarray(offset, end), offset);
      post({
        type: "status",
        message: `Prefilling ${end} / ${tokens.length} tokens…`,
      });
    }
    step = "sampler init";
    instance._bn_sampler_init(
      settings.temperature,
      settings.topP,
      settings.topK,
      settings.repeatPenalty,
      64,
      (Math.random() * 0xffffffff) >>> 0,
    );

    const tokenPtr = instance._malloc(4);
    const piecePtr = instance._malloc(256);
    const decoder = new TextDecoder();

    try {
      step = "sample";
      for (let i = 0; i < settings.maxTokens; i++) {
        if (isAborted()) {
          const tail = decoder.decode();
          if (tail) {
            generatedText += tail;
            post({ type: "token", requestId, tokenId: -1, text: tail });
          }
          post({ type: "aborted", requestId, text: generatedText });
          return;
        }

        const token = instance._bn_sample();
        if (token < 0) break;
        if (instance._bn_is_eog(token)) break;

        const pieceLen = instance._bn_token_piece(token, piecePtr, 256);
        if (pieceLen > 0) {
          // HEAPU8 is backed by a SharedArrayBuffer (pthreads build), and
          // TextDecoder rejects shared views, so copy the bytes first.
          const piece = decoder.decode(
            instance.HEAPU8.slice(piecePtr, piecePtr + pieceLen),
            { stream: true },
          );
          if (piece) {
            generatedText += piece;
            post({ type: "token", requestId, tokenId: token, text: piece });
          }
        }

        instance.HEAP32[tokenPtr >> 2] = token;
        step = "decode token";
        const rc = instance._bn_decode(tokenPtr, 1, instance._bn_n_past());
        if (rc !== 0) throw new Error(lastError());
        step = "sample";
      }

      const tail = decoder.decode();
      if (tail) {
        generatedText += tail;
        post({ type: "token", requestId, tokenId: -1, text: tail });
      }
    } finally {
      instance._free(tokenPtr);
      instance._free(piecePtr);
    }

    const prefillMs = instance._bn_prompt_ms();
    const decodeMs = instance._bn_eval_ms();
    const promptTokens = instance._bn_prompt_tokens();
    const generatedTokens = instance._bn_eval_tokens();
    const stats: EngineStats = {
      promptTokens,
      generatedTokens,
      prefillMs,
      decodeMs,
      tokensPerSecond: decodeMs > 0 ? (generatedTokens * 1000) / decodeMs : 0,
    };

    post({ type: "done", requestId, stats, text: generatedText });
  } catch (error) {
    const err = error as { message?: string; stack?: string };
    const detail = err?.message ?? String(error);
    if (err?.stack) post({ type: "log", message: `[${step}] ${err.stack}` });
    post({ type: "error", requestId, message: `${step}: ${detail}` });
  }
}

self.onmessage = async (event: MessageEvent<Incoming>) => {
  const message = event.data;

  try {
    if (message.type === "init") {
      await initEngine(message.init);
      return;
    }

    if (message.type === "generate") {
      generate(message.requestId, message.messages, message.settings);
      return;
    }

    if (message.type === "reset") {
      module?._bn_reset();
      return;
    }

    if (message.type === "dispose") {
      module?._bn_free();
      module = null;
      ready = false;
      self.close();
    }
  } catch (error) {
    post({
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
