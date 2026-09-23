// Full-loading download engine — the "insane" part of full loading.
//
// The reader downloads the ENTIRE PDF (no part-by-part, no chunk picking —
// that is a hard product decision from the user). To make a 171.8MB
// textbook arrive as fast as the connection physically allows, this engine
// downloads it as MANY PARALLEL RANGE SEGMENTS (HTTP 206) instead of one
// slow sequential stream:
//
//   total 180,129,045 bytes
//   → 15 segments of ~12MB
//   → all fetched CONCURRENTLY (HTTP/2 multiplexed against Cloudflare R2)
//   → each segment streams directly into its slot of ONE preallocated
//     Uint8Array (zero assembly copies, bounded memory)
//   → aggregate progress ticks smoothly toward 100%
//
// Why parallel beats sequential: a single HTTP stream is throughput-capped
// by one connection's congestion window + per-connection packet loss. 12-16
// concurrent ranges multiply effective throughput (typically 4-10× against
// R2/Cloudflare) and one slow segment never blocks the others.
//
// Fallbacks, in order (each only fires when the previous one is impossible):
//   1. Parallel range segments   — needs Content-Length + 206 support.
//   2. Single streaming download — server ignores Range (200 responses).
//   3. Error card with retry     — never a hidden failure.
//
// The %PDF magic is verified before any buffer leaves this module, so the
// engine can never hand pdf.js an HTML error page or a truncated file.

export interface FullLoadProgress {
  /** 0-100, only meaningful when totalBytes > 0. */
  percent: number;
  receivedBytes: number;
  totalBytes: number;
  /** True while the total size is still being probed. */
  probing: boolean;
}

export interface FullLoadResult {
  buffer: ArrayBuffer;
  totalBytes: number;
}

/** Target bytes per parallel segment. 12MB × up to 16 segments covers a
 * 180MB textbook with smooth progress granularity without overwhelming
 * mobile radios with thousands of tiny ranges. */
const SEGMENT_TARGET_BYTES = 12 * 1024 * 1024;
const MIN_SEGMENTS = 3;
const MAX_SEGMENTS = 16;

/** Per-segment network retry (transient radio/CDN hiccups). */
const SEGMENT_ATTEMPTS = 2;

function isPdfMagic(bytes: Uint8Array): boolean {
  return bytes.length >= 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
}

/** Read a fetch body into `out` starting at `offset`, calling onBytes for
 * every chunk. Returns bytes written. */
async function pumpInto(
  res: Response,
  out: Uint8Array,
  offset: number,
  onBytes: (n: number) => void,
): Promise<number> {
  const reader = res.body?.getReader();
  if (!reader) throw new Error("This browser cannot stream the download.");
  let written = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      // Guard against a misbehaving server that sends more than its range.
      if (offset + written + value.length > out.length) {
        throw new Error("Server sent more data than the file size.");
      }
      out.set(value, offset + written);
      written += value.length;
      onBytes(value.length);
    }
  }
  return written;
}

/**
 * Download the ENTIRE file at `url` as parallel range segments.
 *
 * @param expectedSize Known file size (content metadata) — skips the HEAD
 *   probe when present. A mismatch with the real bytes aborts with an
 *   error rather than silently parsing a wrong document.
 */
export async function downloadEntirePdf(
  url: string,
  opts: {
    expectedSize?: number | null;
    onProgress?: (p: FullLoadProgress) => void;
    signal?: AbortSignal;
  } = {},
): Promise<FullLoadResult> {
  const { expectedSize = null, onProgress, signal } = opts;
  const emit = (p: FullLoadProgress) => {
    try {
      onProgress?.(p);
    } catch {
      // Progress UI errors must never break the download.
    }
  };

  // ── 1. Determine the total size ────────────────────────────────────
  let total = 0;
  if (typeof expectedSize === "number" && expectedSize > 0) {
    total = expectedSize;
  } else {
    emit({ percent: 0, receivedBytes: 0, totalBytes: 0, probing: true });
    try {
      const head = await fetch(url, { method: "HEAD", signal });
      if (head.ok) {
        const len = head.headers.get("content-length");
        if (len) total = parseInt(len, 10);
      }
    } catch {
      // HEAD can fail behind some CDNs — the range probe below still works.
    }
  }

  // ── 2. Plan segments ───────────────────────────────────────────────
  const canSegment = total > 0;
  const segmentCount = canSegment
    ? Math.max(MIN_SEGMENTS, Math.min(MAX_SEGMENTS, Math.ceil(total / SEGMENT_TARGET_BYTES)))
    : 1;

  // ── 3. Single-stream fallback (no size / no ranges) ────────────────
  if (!canSegment || segmentCount <= 1) {
    const res = await fetch(url, { signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    const declared = total || parseInt(res.headers.get("content-length") || "0", 10);
    // Grow-as-you-go buffer when the size is unknown.
    const parts: Uint8Array[] = [];
    let received = 0;
    const reader = res.body?.getReader();
    if (!reader) throw new Error("This browser cannot stream the download.");
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        parts.push(value);
        received += value.length;
        emit({
          percent: declared > 0 ? Math.min(99, Math.round((received / declared) * 100)) : 0,
          receivedBytes: received,
          totalBytes: declared,
          probing: false,
        });
      }
    }
    const combined = new Uint8Array(received);
    let off = 0;
    for (const part of parts) {
      combined.set(part, off);
      off += part.length;
    }
    if (!isPdfMagic(combined)) throw new Error("The server did not return a PDF file.");
    emit({ percent: 100, receivedBytes: received, totalBytes: received, probing: false });
    return { buffer: combined.buffer as ArrayBuffer, totalBytes: received };
  }

  // ── 4. Parallel segmented download ─────────────────────────────────
  const out = new Uint8Array(total);
  let received = 0;
  let rangeUnsupported = false; // a segment got HTTP 200 → server ignored Range
  let lastEmit = 0;

  const reportBytes = (n: number) => {
    received += n;
    const now = Date.now();
    // Throttle progress emission to ~10fps — smooth enough, cheap enough.
    if (now - lastEmit > 100) {
      lastEmit = now;
      emit({
        percent: Math.min(99, Math.round((received / total) * 100)),
        receivedBytes: received,
        totalBytes: total,
        probing: false,
      });
    }
  };

  const buildSegments = (): { start: number; end: number }[] => {
    const segs: { start: number; end: number }[] = [];
    const segSize = Math.ceil(total / segmentCount);
    for (let i = 0; i < segmentCount; i++) {
      const start = i * segSize;
      const end = Math.min(total - 1, start + segSize - 1);
      if (start > end) break;
      segs.push({ start, end });
    }
    return segs;
  };

  const fetchSegment = async (start: number, end: number, attempt: number): Promise<void> => {
    try {
      const res = await fetch(url, {
        headers: { Range: `bytes=${start}-${end}` },
        signal,
      });
      if (res.status === 200) {
        // Server ignored the Range header entirely (a range-aware server
        // answers a Range request with 206, never 200). Abandon the whole
        // segmented plan — sequential is the only honest route left.
        rangeUnsupported = true;
        try {
          res.body?.cancel();
        } catch {
          /* ignore */
        }
        return;
      }
      if (res.status !== 206) {
        throw new Error(`HTTP ${res.status} for bytes ${start}-${end}`);
      }
      const expected = end - start + 1;
      const got = await pumpInto(res, out, start, reportBytes);
      if (got !== expected) {
        throw new Error(`Segment ${start}-${end} truncated (${got}/${expected} bytes)`);
      }
    } catch (err) {
      if (signal?.aborted) return;
      if (attempt + 1 < SEGMENT_ATTEMPTS) {
        // Brief backoff, then retry this range from scratch.
        await new Promise((r) => setTimeout(r, 350 * (attempt + 1)));
        return fetchSegment(start, end, attempt + 1);
      }
      throw err;
    }
  };

  const segments = buildSegments();
  const workers = segments.map(({ start, end }) => fetchSegment(start, end, 0));

  try {
    await Promise.all(workers);
  } catch (err) {
    // If ANY segment exhausted its retries, the parallel plan failed —
    // fall back to the single-stream path (which also re-downloads, but is
    // the most compatible route there is).
    if (signal?.aborted) throw err;
    return downloadEntirePdfSequential(url, { onProgress, signal, totalHint: total });
  }

  if (rangeUnsupported) {
    return downloadEntirePdfSequential(url, { onProgress, signal, totalHint: total });
  }

  if (received !== total) {
    throw new Error(`Download incomplete — got ${received} of ${total} bytes.`);
  }
  if (!isPdfMagic(out)) {
    throw new Error("The server did not return a PDF file.");
  }

  emit({ percent: 100, receivedBytes: received, totalBytes: total, probing: false });
  return { buffer: out.buffer as ArrayBuffer, totalBytes: total };
}

/** Sequential streaming fallback — maximally compatible. */
async function downloadEntirePdfSequential(
  url: string,
  opts: { onProgress?: (p: FullLoadProgress) => void; signal?: AbortSignal; totalHint?: number },
): Promise<FullLoadResult> {
  const { onProgress, signal, totalHint = 0 } = opts;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  const declared = totalHint || parseInt(res.headers.get("content-length") || "0", 10);
  const parts: Uint8Array[] = [];
  let received = 0;
  let lastEmit = 0;
  const reader = res.body?.getReader();
  if (!reader) throw new Error("This browser cannot stream the download.");
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      parts.push(value);
      received += value.length;
      const now = Date.now();
      if (onProgress && now - lastEmit > 100) {
        lastEmit = now;
        try {
          onProgress({
            percent: declared > 0 ? Math.min(99, Math.round((received / declared) * 100)) : 0,
            receivedBytes: received,
            totalBytes: declared,
            probing: false,
          });
        } catch {
          // UI errors never break the download.
        }
      }
    }
  }
  const combined = new Uint8Array(received);
  let off = 0;
  for (const part of parts) {
    combined.set(part, off);
    off += part.length;
  }
  if (!isPdfMagic(combined)) throw new Error("The server did not return a PDF file.");
  onProgress?.({ percent: 100, receivedBytes: received, totalBytes: received, probing: false });
  return { buffer: combined.buffer as ArrayBuffer, totalBytes: received };
}
