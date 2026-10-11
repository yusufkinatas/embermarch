/**
 * Guarded key-value persistence for the run layer (GDD §N "Storage").
 *
 * - Uses `localStorage` when it exists and works; every access is wrapped in try/catch.
 * - Falls back to an in-memory store (private windows, blocked storage, quota errors, Node tests).
 * - Tests (and tools) can inject their own backend with `setStorageBackend`.
 *
 * The run layer never touches `window` directly: only `globalThis.localStorage`, through here.
 */

export const META_KEY = 'embermarch.meta.v1';
export const RUN_KEY = 'embermarch.run.v1';

/** Minimal Storage subset the run layer needs (compatible with the DOM Storage interface). */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Simple in-memory storage (also handy for tests). */
export class MemoryStorage implements KeyValueStorage {
  private data = new Map<string, string>();
  getItem(key: string): string | null {
    return this.data.has(key) ? (this.data.get(key) as string) : null;
  }
  setItem(key: string, value: string): void {
    this.data.set(key, String(value));
  }
  removeItem(key: string): void {
    this.data.delete(key);
  }
  clear(): void {
    this.data.clear();
  }
  keys(): string[] {
    return [...this.data.keys()];
  }
}

const memory = new MemoryStorage();
let injected: KeyValueStorage | null = null;
/** undefined = not probed yet; null = unavailable. */
let probed: KeyValueStorage | null | undefined;

/** Inject a backend (tests). Pass null to return to localStorage-or-memory. */
export function setStorageBackend(storage: KeyValueStorage | null): void {
  injected = storage;
  probed = undefined;
}

function probeLocalStorage(): KeyValueStorage | null {
  try {
    const ls = (globalThis as { localStorage?: KeyValueStorage }).localStorage;
    if (!ls) return null;
    const k = '__embermarch_probe__';
    ls.setItem(k, '1');
    ls.removeItem(k);
    return ls;
  } catch {
    return null;
  }
}

function backend(): KeyValueStorage {
  if (injected) return injected;
  if (probed === undefined) probed = probeLocalStorage();
  return probed ?? memory;
}

/** Read and JSON-parse a key. Returns null when missing, unreadable or malformed. */
export function readJson(key: string): unknown {
  let raw: string | null = null;
  try {
    raw = backend().getItem(key);
  } catch {
    raw = null;
  }
  if (raw === null) {
    // A previous write may have fallen back to memory (quota / blocked storage).
    raw = memory.getItem(key);
  }
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

/** JSON-serialize and write a key. Never throws; returns false if only the memory fallback holds it. */
export function writeJson(key: string, value: unknown): boolean {
  let raw: string;
  try {
    raw = JSON.stringify(value);
  } catch {
    return false;
  }
  const b = backend();
  try {
    b.setItem(key, raw);
    if (b !== memory) memory.removeItem(key);
    return true;
  } catch {
    try {
      memory.setItem(key, raw);
    } catch {
      /* ignore */
    }
    return false;
  }
}

export function removeKey(key: string): void {
  try {
    backend().removeItem(key);
  } catch {
    /* ignore */
  }
  memory.removeItem(key);
}
