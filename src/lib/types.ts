export type Role = "system" | "user" | "assistant";

export type AppPhase =
  | "checking"
  | "blocked"
  | "needs-download"
  | "downloading"
  | "loading"
  | "ready"
  | "error";

export interface ChatMessage {
  id: string;
  role: Role;
  content: string;
  streaming?: boolean;
}

export interface Draft {
  requestId: string;
  content: string;
  startedAt: number;
  tokens: number;
}

export interface GenerationSettings {
  maxTokens: number;
  temperature: number;
  topP: number;
  topK: number;
  repeatPenalty: number;
  contextSize: number;
  threads: number;
}

export interface UiSettings extends GenerationSettings {
  systemPrompt: string;
}

export interface EngineStats {
  promptTokens: number;
  generatedTokens: number;
  prefillMs: number;
  decodeMs: number;
  tokensPerSecond: number;
}

export interface DownloadProgress {
  received: number;
  total: number;
  bytesPerSecond: number;
  etaSeconds: number | null;
  resuming: boolean;
}

export interface ModelInfo {
  description: string;
  contextSize: number;
  vocabSize: number;
  threads: number;
  loadMs: number;
}

export interface CachedModel {
  fileName: string;
  metaName: string;
  size: number;
  etag: string;
  revision: string;
  complete: boolean;
}

export interface WorkerInit {
  cacheDir: string;
  fileName: string;
  metaName: string;
  contextSize: number;
  batchSize: number;
  threads: number;
  baseUrl: string;
  abortBuffer: SharedArrayBuffer;
}

export type InferenceEvent =
  | { type: "status"; message: string }
  | { type: "ready"; info: ModelInfo }
  | { type: "token"; requestId: string; tokenId: number; text: string }
  | { type: "done"; requestId: string; stats: EngineStats; text: string }
  | { type: "aborted"; requestId: string; text: string }
  | { type: "error"; message: string; requestId?: string }
  | { type: "log"; message: string };

export type DownloadEvent =
  | { type: "started"; total: number; offset: number }
  | { type: "progress"; progress: DownloadProgress }
  | { type: "done"; bytes: number }
  | { type: "cancelled"; bytes: number }
  | { type: "error"; message: string };
