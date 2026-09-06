// useSpeechRecognition — a small wrapper around the browser's native
// Web Speech API (SpeechRecognition / webkitSpeechRecognition).
//
// WHY NATIVE: zero backend cost, zero new dependencies, works in Chrome +
// Edge + Safari (with the webkit prefix). No new AI billing, no audio
// uploads, no privacy concerns — the audio never leaves the browser.
//
// BEHAVIOR:
//   - `start()` begins listening. `interimResults = true` so we get
//     live partial transcripts while the user speaks.
//   - The hook accumulates the FINAL transcript (only committed phrases)
//     and exposes it via `transcript`. The component using the hook
//     decides how to merge it into its input (append, replace, etc.).
//   - `stop()` stops listening + cleans up.
//   - `supported` is false on browsers without the API (e.g. older
//     Safari, Firefox) — the UI should hide/disable the mic button in
//     that case.
//   - `listening` is true while actively recording.
//   - `interim` is the live partial transcript (not yet committed) so
//     the UI can show "you said: …" while the user is still talking.
//
// GRACEFUL DEGRADATION: if the API isn't supported, the hook returns
// `supported: false` and `start()` is a no-op. The component is
// responsible for hiding/disabling the mic button + showing a clear
// tooltip.
//
// ERROR HANDLING: `error` holds the last error string (e.g.
// "not-allowed" if the user denied microphone permission,
// "no-speech" if nothing was heard). The component can show a toast.

import { useCallback, useEffect, useRef, useState } from "react";

// ── Minimal type declarations for the Web Speech API ───────────────────
// The TS DOM lib doesn't ship SpeechRecognition types by default, so we
// declare just enough to use it safely. These match the W3C spec.

interface SpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}
interface SpeechRecognitionResult {
  isFinal: boolean;
  length: number;
  item(index: number): SpeechRecognitionAlternative;
  [index: number]: SpeechRecognitionAlternative;
}
interface SpeechRecognitionResultList {
  length: number;
  item(index: number): SpeechRecognitionResult;
  [index: number]: SpeechRecognitionResult;
}
interface SpeechRecognitionEvent extends Event {
  resultIndex: number;
  results: SpeechRecognitionResultList;
}
interface SpeechRecognitionErrorEvent extends Event {
  error: string;
  message: string;
}
interface SpeechRecognitionLike extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  }
}

// ── Hook ────────────────────────────────────────────────────────────────

export interface UseSpeechRecognitionOptions {
  /** Language code, e.g. "en-US" or "am-ET". Defaults to "en-US". */
  lang?: string;
  /** Whether to keep listening after a final result (default false —
   *  one phrase per tap). */
  continuous?: boolean;
}

export interface UseSpeechRecognitionResult {
  /** True if the browser supports SpeechRecognition. */
  supported: boolean;
  /** True while actively listening. */
  listening: boolean;
  /** The accumulated final transcript. Resets to "" when start() is
   *  called fresh. */
  transcript: string;
  /** The live partial (interim) transcript — updated as the user
   *  speaks, cleared when a phrase is committed. */
  interim: string;
  /** Last error string (e.g. "not-allowed", "no-speech"), or null. */
  error: string | null;
  /** Begin listening. No-op if unsupported or already listening. */
  start: () => void;
  /** Stop listening. No-op if not listening. */
  stop: () => void;
  /** Reset the accumulated transcript to "". */
  reset: () => void;
}

export function useSpeechRecognition(
  options: UseSpeechRecognitionOptions = {},
): UseSpeechRecognitionResult {
  const { lang = "en-US", continuous = false } = options;

  const supported =
    typeof window !== "undefined" &&
    Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);

  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  // Build the recognition instance on first start (lazy — don't create
  // it at module load time in case the API isn't supported).
  const ensureRecognition = useCallback((): SpeechRecognitionLike | null => {
    if (recognitionRef.current) return recognitionRef.current;
    const Ctor = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Ctor) return null;
    const instance = new Ctor();
    instance.lang = lang;
    instance.continuous = continuous;
    instance.interimResults = true;
    instance.maxAlternatives = 1;

    instance.onstart = () => {
      setListening(true);
      setError(null);
    };
    instance.onend = () => {
      setListening(false);
      setInterim("");
    };
    instance.onerror = (event) => {
      setError(event.error);
      setListening(false);
      setInterim("");
    };
    instance.onresult = (event) => {
      let interimText = "";
      let finalText = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]!;
        const alt = result[0]!;
        if (result.isFinal) {
          finalText += alt.transcript;
        } else {
          interimText += alt.transcript;
        }
      }
      if (finalText) {
        setTranscript((prev) => (prev ? prev + " " : "") + finalText.trim());
      }
      setInterim(interimText);
    };

    recognitionRef.current = instance;
    return instance;
  }, [lang, continuous]);

  const start = useCallback(() => {
    if (!supported) return;
    const instance = ensureRecognition();
    if (!instance) return;
    // Reset transcript on a fresh start so each tap is a clean phrase.
    setTranscript("");
    setInterim("");
    setError(null);
    try {
      instance.start();
    } catch {
      // Can throw if start() is called twice — ignore.
    }
  }, [supported, ensureRecognition]);

  const stop = useCallback(() => {
    const instance = recognitionRef.current;
    if (!instance) return;
    try {
      instance.stop();
    } catch {
      // ignore
    }
    setListening(false);
  }, []);

  const reset = useCallback(() => {
    setTranscript("");
    setInterim("");
    setError(null);
  }, []);

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      const instance = recognitionRef.current;
      if (instance) {
        try {
          instance.abort();
        } catch {
          // ignore
        }
        recognitionRef.current = null;
      }
    };
  }, []);

  return {
    supported,
    listening,
    transcript,
    interim,
    error,
    start,
    stop,
    reset,
  };
}
