// useReadAloud — Web Speech API hook powering the exam player's
// read-aloud accessibility feature.
//
// Design notes (mobile Safari quirks are real):
//   - The question is spoken as a QUEUE of sentence utterances rather than
//     one giant utterance — iOS truncates long utterances (~15s limit) and
//     queues keep both progress tracking and reliability intact.
//   - cancel() before speak() — Chrome for Android ignores speak() while
//     an engine is busy without it.
//   - Voice preference: an explicit en-* voice when available; browsers
//     load voices async (voiceschanged), so we re-read on demand.
//   - Any manual stop/cleanup always cancels — no zombie speech after
//     navigating away from the exam.
//
// Exposes sentence-index tracking so the player can highlight the exact
// sentence currently being spoken (segmentation via the shared
// splitSentences in lib/pdfText — identical to what the UI renders).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { splitSentences } from "@/lib/pdfText";

export interface ReadAloudApi {
  supported: boolean;
  speaking: boolean;
  paused: boolean;
  rate: number;
  /** Index of the sentence currently being spoken (into the last-spoken text's sentence list). */
  sentenceIndex: number | null;
  speak: (text: string) => void;
  pause: () => void;
  resume: () => void;
  stop: () => void;
  setRate: (rate: number) => void;
}

const RATE_KEY = "learnyx.readAloud.rate";

function pickVoice(): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices();
  if (voices.length === 0) return null;
  const byLang = (prefix: string) =>
    voices.find((v) => v.lang.toLowerCase().startsWith(prefix));
  // Prefer natural English voices — Ethiopian exam papers are in English.
  return byLang("en-us") ?? byLang("en-gb") ?? byLang("en") ?? voices[0] ?? null;
}

export function useReadAloud(): ReadAloudApi {
  const supported = useMemo(
    () => typeof window !== "undefined" && "speechSynthesis" in window,
    [],
  );

  const [speaking, setSpeaking] = useState(false);
  const [paused, setPaused] = useState(false);
  const [sentenceIndex, setSentenceIndex] = useState<number | null>(null);
  const [rate, setRateState] = useState<number>(() => {
    const stored = Number(localStorage.getItem(RATE_KEY));
    return stored >= 0.5 && stored <= 1.5 ? stored : 1;
  });

  // Session id: every speak()/stop() bumps it; stale onend callbacks from a
  // previous session are ignored by comparing captured id.
  const sessionRef = useRef(0);
  const rateRef = useRef(rate);
  rateRef.current = rate;

  const hardStop = useCallback(() => {
    sessionRef.current += 1;
    window.speechSynthesis.cancel();
    setSpeaking(false);
    setPaused(false);
    setSentenceIndex(null);
  }, []);

  const speak = useCallback(
    (text: string) => {
      if (!supported) return;
      const trimmed = text.trim();
      if (!trimmed) return;

      hardStop();
      const sessionId = sessionRef.current;
      const sentences = splitSentences(trimmed);

      const speakNext = (i: number) => {
        if (sessionId !== sessionRef.current) return; // superseded
        if (i >= sentences.length) {
          setSpeaking(false);
          setPaused(false);
          setSentenceIndex(null);
          return;
        }
        setSentenceIndex(i);
        const u = new SpeechSynthesisUtterance(sentences[i]!);
        u.rate = rateRef.current;
        u.pitch = 1;
        const voice = pickVoice();
        if (voice) u.voice = voice;
        u.onend = () => speakNext(i + 1);
        u.onerror = () => {
          if (sessionId === sessionRef.current) {
            setSpeaking(false);
            setPaused(false);
            setSentenceIndex(null);
          }
        };
        window.speechSynthesis.speak(u);
      };

      setSpeaking(true);
      setPaused(false);
      speakNext(0);
    },
    [hardStop, supported],
  );

  const pause = useCallback(() => {
    if (!supported || !speaking) return;
    window.speechSynthesis.pause();
    setPaused(true);
  }, [speaking, supported]);

  const resume = useCallback(() => {
    if (!supported || !paused) return;
    window.speechSynthesis.resume();
    setPaused(false);
  }, [paused, supported]);

  const setRate = useCallback(
    (next: number) => {
      const clamped = Math.max(0.5, Math.min(1.5, next));
      setRateState(clamped);
      localStorage.setItem(RATE_KEY, String(clamped));
      // Restart the current speech at the new rate — mid-queue utterances
      // keep the old rate otherwise.
      if (speaking) {
        // Re-speaker needs the original text; simplest honest behaviour is
        // stopping — the player re-triggers speak on demand via auto mode.
        hardStop();
      }
    },
    [hardStop, speaking],
  );

  // Cleanup on unmount — never leave speech running after the exam closes.
  useEffect(() => {
    return () => {
      sessionRef.current += 1;
      window.speechSynthesis.cancel();
    };
  }, []);

  // Warm the voice list (async on Chrome) so the first speak() has voices.
  useEffect(() => {
    if (!supported) return;
    window.speechSynthesis.getVoices();
    const onChange = () => window.speechSynthesis.getVoices();
    window.speechSynthesis.addEventListener?.("voiceschanged", onChange);
    return () => window.speechSynthesis.removeEventListener?.("voiceschanged", onChange);
  }, [supported]);

  return {
    supported,
    speaking,
    paused,
    rate,
    sentenceIndex,
    speak,
    pause,
    resume,
    stop: hardStop,
    setRate,
  };
}
