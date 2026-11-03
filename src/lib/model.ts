// Pinned to a Hugging Face commit so the 1.13 GB download is reproducible.
// The SHA-256 is the LFS object id reported by the Hub (x-linked-etag).
export const MODEL = {
  label: "BitNet b1.58 2B4T",
  repo: "microsoft/bitnet-b1.58-2B-4T-gguf",
  fileName: "ggml-model-i2_s.gguf",
  revision: "a1f2f1c765812aa8af3f6eda4a313707064bba15",
  size: 1_187_801_280,
  sha256: "4221b252fdd5fd25e15847adfeb5ee88886506ba50b8a34548374492884c2162",
  license: "MIT",
} as const;

export const MODEL_URL = `https://huggingface.co/${MODEL.repo}/resolve/${MODEL.revision}/${MODEL.fileName}`;

export const CACHE = {
  dir: "bitnet",
  fileName: "bitnet-b1.58-2B-4T-i2_s.gguf",
  metaName: "bitnet-b1.58-2B-4T-i2_s.meta.json",
} as const;

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KiB", "MiB", "GiB"];
  const exp = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** exp).toFixed(exp === 0 ? 0 : exp === 1 ? 1 : 2)} ${units[exp]}`;
}

export function formatDuration(seconds: number | null): string {
  if (seconds == null || !Number.isFinite(seconds)) return "—";
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}m ${s.toString().padStart(2, "0")}s`;
}
