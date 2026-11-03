import { CACHE } from "./model";

export interface CacheMeta {
  complete: boolean;
  size: number;
  etag: string;
  revision: string;
  downloadedAt: number;
}

async function rootDir(): Promise<FileSystemDirectoryHandle> {
  return navigator.storage.getDirectory();
}

export async function getCacheDir(create = true): Promise<FileSystemDirectoryHandle> {
  const root = await rootDir();
  return root.getDirectoryHandle(CACHE.dir, { create });
}

export async function readCacheMeta(): Promise<CacheMeta | null> {
  try {
    const dir = await getCacheDir(false);
    const handle = await dir.getFileHandle(CACHE.metaName);
    const file = await handle.getFile();
    return JSON.parse(await file.text()) as CacheMeta;
  } catch {
    return null;
  }
}

export async function getCachedModelFile(expected: {
  size: number;
  etag: string;
  revision: string;
}): Promise<File | null> {
  try {
    const meta = await readCacheMeta();
    if (!meta?.complete) return null;
    if (meta.size !== expected.size || meta.etag !== expected.etag || meta.revision !== expected.revision) {
      return null;
    }
    const dir = await getCacheDir(false);
    const handle = await dir.getFileHandle(CACHE.fileName);
    const file = await handle.getFile();
    return file.size === expected.size ? file : null;
  } catch {
    return null;
  }
}

export async function clearModelCache(): Promise<void> {
  try {
    const root = await rootDir();
    await root.removeEntry(CACHE.dir, { recursive: true });
  } catch {
    // Nothing cached.
  }
}

export async function requestPersistence(): Promise<boolean> {
  try {
    return (await navigator.storage.persist?.()) ?? false;
  } catch {
    return false;
  }
}

export async function cacheUsage(): Promise<{ usage: number; quota: number }> {
  try {
    const estimate = await navigator.storage.estimate();
    return { usage: estimate.usage ?? 0, quota: estimate.quota ?? 0 };
  } catch {
    return { usage: 0, quota: 0 };
  }
}
