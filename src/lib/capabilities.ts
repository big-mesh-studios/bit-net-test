export interface Capabilities {
  secureContext: boolean;
  wasm: boolean;
  simd: boolean;
  sharedArrayBuffer: boolean;
  crossOriginIsolated: boolean;
  opfs: boolean;
  syncAccessHandle: boolean;
  storageQuota: number;
  storageUsage: number;
  hardwareConcurrency: number;
  deviceMemory: number | null;
}

// Minimal valid module containing a v128 type and a v128.const instruction.
// Validation fails on engines without WebAssembly SIMD.
const SIMD_PROBE = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
  0x01, 0x05, 0x01, 0x60, 0x00, 0x01, 0x7b,
  0x03, 0x02, 0x01, 0x00,
  0x0a, 0x16, 0x01, 0x14, 0x00, 0xfd, 0x0c,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x0b,
]);

export async function detectCapabilities(): Promise<Capabilities> {
  let storageQuota = 0;
  let storageUsage = 0;
  try {
    const estimate = await navigator.storage?.estimate?.();
    storageQuota = estimate?.quota ?? 0;
    storageUsage = estimate?.usage ?? 0;
  } catch {
    // Storage estimation is advisory.
  }

  const nav = navigator as Navigator & { deviceMemory?: number };

  return {
    secureContext: window.isSecureContext,
    wasm: typeof WebAssembly === "object" && typeof WebAssembly.validate === "function",
    simd: typeof WebAssembly === "object" && WebAssembly.validate(SIMD_PROBE),
    sharedArrayBuffer: typeof SharedArrayBuffer !== "undefined",
    crossOriginIsolated: window.crossOriginIsolated === true,
    opfs: typeof navigator.storage?.getDirectory === "function",
    syncAccessHandle:
      typeof FileSystemFileHandle !== "undefined" &&
      "createSyncAccessHandle" in FileSystemFileHandle.prototype,
    storageQuota,
    storageUsage,
    hardwareConcurrency: Math.max(1, navigator.hardwareConcurrency || 4),
    deviceMemory: nav.deviceMemory ?? null,
  };
}

export function blockingProblem(caps: Capabilities): string | null {
  if (!caps.secureContext) return "This page must be served over HTTPS (or localhost).";
  if (!caps.wasm) return "This browser does not support WebAssembly.";
  if (!caps.simd) return "This browser does not support WebAssembly SIMD (v128).";
  if (!caps.sharedArrayBuffer || !caps.crossOriginIsolated) {
    return "Cross-origin isolation is off, so SharedArrayBuffer (and the threaded WASM build) is unavailable. Serve the app with COOP/COEP headers.";
  }
  if (!caps.opfs) return "This browser does not expose the Origin Private File System, which is needed to cache the 1.13 GB model.";
  return null;
}
