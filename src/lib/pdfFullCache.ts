// IndexedDB cache for ENTIRE PDF files — the "full loading" guarantee.
//
// The full-loading engine downloads the complete textbook once; this cache
// makes every visit after that INSTANT (0 network bytes, 0 waiting). This
// replaces the old per-chunk cache: the reader no longer loads documents
// part-by-part, so there is nothing per-chunk to remember.
//
// Design:
//   - One object store "files", key: contentId.
//   - Value: { blob, size, savedAt, lastAccess } — a Blob (browser-managed
//     memory, immutable snapshot of the bytes we verified as %PDF).
//   - LRU eviction across ALL documents when the total budget is exceeded.
//   - Every failure is swallowed: the cache is a pure optimization. If
//     IndexedDB is unavailable (private mode, quota), the reader still
//     works — it just downloads again.
//
// Budget: full textbooks are big (the 171.8MB Biology STB is the flagship).
// 800MB keeps a realistic working set (2 large textbooks + papers) resident
// without pressuring device storage; the LRU pass evicts cold entries first.

const DB_NAME = "learnyx-pdf-full";
const DB_VERSION = 1;
const STORE = "files";

/** Total cache budget across all documents. */
const MAX_TOTAL_BYTES = 800 * 1024 * 1024;

export interface CachedFile {
  blob: Blob;
  lastAccess: number;
  savedAt: number;
  size: number;
}

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE);
          store.createIndex("lastAccess", "lastAccess");
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => unknown,
): Promise<T | null> {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, mode);
      const store = tx.objectStore(STORE);
      const result = fn(store) as IDBRequest<T> | undefined;
      tx.oncomplete = () => resolve(result && "result" in result ? result.result : null);
      tx.onerror = () => resolve(null);
      tx.onabort = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/**
 * Get the cached full file for a document (and touch its LRU stamp).
 *
 * `expectedSize` — when the caller knows the true file size (content item
 * metadata), a stored entry whose size disagrees is treated as stale and
 * removed (the file on the bucket was replaced). Cache hits therefore can
 * never resurrect an outdated document.
 */
export async function getCachedFile(contentId: string, expectedSize?: number | null): Promise<Blob | null> {
  const cached = await withStore<CachedFile>("readonly", (store) => store.get(contentId));
  if (!cached || !cached.blob || cached.blob.size === 0) return null;
  if (typeof expectedSize === "number" && expectedSize > 0 && cached.size !== expectedSize) {
    void clearCachedFile(contentId);
    return null;
  }
  // Touch asynchronously — never block the read path.
  void withStore("readwrite", (store) => {
    store.put({ ...cached, lastAccess: Date.now() }, contentId);
  });
  return cached.blob;
}

/** Store a complete file, then enforce the LRU budget. */
export async function putCachedFile(contentId: string, blob: Blob): Promise<void> {
  if (!blob || blob.size === 0) return;
  const entry: CachedFile = {
    blob,
    lastAccess: Date.now(),
    savedAt: Date.now(),
    size: blob.size,
  };
  const ok = await withStore("readwrite", (store) => {
    store.put(entry, contentId);
  });
  if (ok !== null) void enforceBudget();
}

/** Remove one document's cached file (stale-size invalidation, retries). */
export async function clearCachedFile(contentId: string): Promise<void> {
  await withStore("readwrite", (store) => {
    store.delete(contentId);
  });
}

/** LRU eviction down to the budget. Failures are silent. */
async function enforceBudget(): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      const index = store.index("lastAccess");
      const all: { key: IDBValidKey; size: number }[] = [];
      const req = index.openCursor();
      let total = 0;
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) {
          let over = total - MAX_TOTAL_BYTES;
          if (over > 0) {
            for (const entry of all) {
              if (over <= 0) break;
              store.delete(entry.key);
              over -= entry.size;
            }
          }
          return;
        }
        const value = cursor.value as CachedFile;
        total += value.size ?? 0;
        all.push({ key: cursor.primaryKey, size: value.size ?? 0 });
        cursor.continue();
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}
