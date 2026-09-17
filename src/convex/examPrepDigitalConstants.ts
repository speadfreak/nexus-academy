// Shared constants for the digital exam engine — a single tiny module so
// examPrepDigital.ts (student surface) and examQuality.ts (admin surface)
// never drift apart on timings or capacity.

/**
 * Platform-wide conversion concurrency. Free-tier AI providers meter
 * tokens per minute; at most this many pipelines (each paced between
 * chunks) run simultaneously across ALL users. Student-demanded jobs
 * always fill slots before admin batch jobs.
 */
export const MAX_CONCURRENT_CONVERSIONS = 2;

/**
 * How long a "processing"/"running" claim stays fresh before the system
 * treats it as dead (crashed tab, lost network) and lets another worker
 * replace it. The client pipeline is sequential AI calls — a 30-page
 * paper is ~4 chunks × ~30s worst case; 15 minutes is generous headroom.
 */
export const PROCESSING_MS_HINT = 15 * 60 * 1000;

/** Polite pacing BETWEEN chunk AI calls inside one pipeline (ms). */
export const CHUNK_PACING_MS_TEXT = 4_000;
/** Batch runs pace even gentler — they have no waiting human. */
export const CHUNK_PACING_MS_BATCH = 8_000;
/** Pacing between page-image OCR calls (vision free tier is tighter). */
export const PAGE_PACING_MS_VISION = 5_000;
