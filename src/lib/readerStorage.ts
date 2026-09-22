// Local-only persistence for the Smart Reader.
//
// Everything here lives in localStorage on purpose:
//   • reading progress (resume where you left off)
//   • session highlights (page-referenced selections)
//
// We deliberately do NOT add new Convex tables/subscriptions for these —
// the platform just recovered from a free-tier query-volume suspension,
// so new reader features must be zero-backend. localStorage is instant,
// offline-friendly and per-device, which is exactly right for
// "continue reading" and "my highlights on this book".

const NS = "learnyx:reader";

function safeGet<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function safeSet(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full / private mode — never break the reader for this.
  }
}

// ─── Reading progress ──────────────────────────────────────────────────

export function loadReadingProgress(contentId: string): number | null {
  const value = safeGet<{ page: number }>(`${NS}:progress:${contentId}`);
  return value && Number.isFinite(value.page) && value.page >= 1 ? value.page : null;
}

export function saveReadingProgress(contentId: string, page: number): void {
  safeSet(`${NS}:progress:${contentId}`, { page, updatedAt: Date.now() });
}

// ─── Session highlights ────────────────────────────────────────────────

export interface ReaderHighlight {
  id: string;
  text: string;
  page: number;
  createdAt: number;
}

export function loadHighlights(contentId: string): ReaderHighlight[] {
  const items = safeGet<ReaderHighlight[]>(`${NS}:highlights:${contentId}`);
  return Array.isArray(items) ? items : [];
}

export function saveHighlights(contentId: string, items: ReaderHighlight[]): void {
  safeSet(`${NS}:highlights:${contentId}`, items.slice(0, 200));
}
