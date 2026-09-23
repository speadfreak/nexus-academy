// IndexedDB cache for large-PDF chunks (Priority 5 of the big-textbook fix).
//
// Once a chunk has been fetched once it lives here, so re-opening the same
// large textbook later — later in the session or days later — is
// near-instant instead of a repeat network fetch. This is also the first
// real step toward offline reading.
//
// Design:
//   - One object store "chunks", key: `${contentId}:${chunkIndex}`.
//   - Value: { blob, lastAccess, size } — we store a Blob (not ArrayBuffer)
//     so the browser can manage memory efficiently and we can hand the blob
//     straight to react-pdf.
//   - LRU eviction: when total stored bytes exceed the cap, evict the
//     least-recently-used chunks (other documents first conceptually —
//     lastAccess ordering handles that naturally).
//   - All failures are swallowed: the cache is an optimization, never a
//     dependency. If IndexedDB is unavailable (private mode, etc.) the
//     reader still works, just without caching.

const DB_NAME = "learnyx-pdf-chunks";
const DB_VERSION = 1;
const STORE = "chunks";

/** Total cache budget across all documents. ~256MB keeps even a
 * two-textbook working set resident without risking storage pressure. */
const MAX_TOTAL_BYTES = 256 * 1024 * 1024;

export interface CachedChunk {
  blob: Blob;
  lastAccess: number;
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

function cacheKey(contentId: string, chunkIndex: number): string {
  return `${contentId}:${chunkIndex}`;
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

/** Get a cached chunk (and touch its lastAccess for LRU). */
export async function getCachedChunk(contentId: string, chunkIndex: number): Promise<Blob | null> {
  const cached = await withStore<CachedChunk>("readonly", (store) =>
    store.get(cacheKey(contentId, chunkIndex)),
  );
  if (!cached) return null;
  // Touch asynchronously — never block the read path.
  void withStore("readwrite", (store) => {
    store.put({ ...cached, lastAccess: Date.now() }, cacheKey(contentId, chunkIndex));
  });
  return cached.blob ?? null;
}

/** Store a chunk, then enforce the LRU budget. */
export async function putCachedChunk(contentId: string, chunkIndex: number, blob: Blob): Promise<void> {
  const entry: CachedChunk = { blob, lastAccess: Date.now(), size: blob.size };
  await withStore("readwrite", (store) => {
    store.put(entry, cacheKey(contentId, chunkIndex));
  });
  void enforceBudget();
}

/** Remove every cached chunk of one document (called if the doc's chunks
 * change, e.g. after a re-split). */
export async function clearCachedContent(contentId: string): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      const req = store.openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) return;
        const key = String(cursor.key);
        if (key.startsWith(`${contentId}:`)) cursor.delete();
        cursor.continue();
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

/** LRU eviction down to the budget. */
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
          // Second pass: evict oldest-first until under budget.
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
        const value = cursor.value as CachedChunk;
        total += value.size ?? 0;
        all.push({ key: cursor.primaryKey, size: value.size ?? 0 });
        cursor.continue();
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}
