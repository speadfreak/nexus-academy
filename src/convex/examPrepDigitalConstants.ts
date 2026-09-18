// Shared constant for the deterministic exam engine — one tiny module so
// examPrepDigital.ts (student surface), examQuality.ts (admin surface) and
// the dispatch never drift apart on timings.

/**
 * How long a "running" claim counts as fresh in ADMIN READ MODELS (the
 * console's running/queued counts). The engine itself uses tighter,
 * route-specific windows (3 min for text conversions, 10 min between OCR
 * page submissions) — see examConversionEngineDispatch.ts.
 */
export const PROCESSING_MS_HINT = 10 * 60 * 1000;
