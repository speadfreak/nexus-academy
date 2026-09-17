// Shared constants for the digital exam engine — a single tiny module so
// examPrepDigital.ts (student surface), examQuality.ts (admin surface) and
// the autopilot hooks never drift apart on timings or capacity.

/**
 * Platform-wide conversion pipeline cap. Each pipeline runs in a student's
 * (or admin's) browser tab; the AI calls inside them are paced by the
 * global rate orchestrator (aiRateLimit.ts) — so this cap protects browser
 * memory and PDF fetching, NOT the AI budget. 8 parallel pipelines with
 * 3-second AI spacing drain a large backlog 15-20× faster than the old
 * 2-slot guard, at the exact same requests-per-minute.
 */
export const MAX_CONCURRENT_CONVERSIONS = 8;

/**
 * Crowd (pre-conversion) pipelines cap. The autopilot stops claiming NEW
 * batch work while this many conversions are running, keeping at least
 * MAX_CONCURRENT_CONVERSIONS − CROWD_MAX_CONCURRENT slots free for
 * student-demanded papers. Students can almost always claim instantly;
 * the library still pre-converts at full speed.
 */
export const CROWD_MAX_CONCURRENT = 6;

/**
 * How long a "processing"/"running" claim stays fresh before the system
 * treats it as dead (crashed tab, lost network) and lets another worker
 * replace it. With the global AI scheduler a deep reservation queue can
 * add up to ~45s of wait per AI call, and scanned papers transcribe one
 * page at a time — 25 minutes is generous headroom for the slowest
 * legitimate pipeline.
 */
export const PROCESSING_MS_HINT = 25 * 60 * 1000;

/** Polite pacing BETWEEN chunk AI calls inside one pipeline (ms). The
 *  global rate orchestrator does the real pacing — this is just a small
 *  breather so one paper's chunks don't hog consecutive slots. */
export const CHUNK_PACING_MS_TEXT = 1_200;
/** Batch runs pace a touch gentler — they have no waiting human. */
export const CHUNK_PACING_MS_BATCH = 2_000;
/** Pacing between page-image OCR calls (vision lane is tighter). */
export const PAGE_PACING_MS_VISION = 3_000;
