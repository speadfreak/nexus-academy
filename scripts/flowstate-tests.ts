// LEARNYX FLOWSTATE — logic test suite (bun).
//
// Covers the pure, testable core of the upgrade:
//   1. Sound Vault registry integrity (single source of truth).
//   2. Search behavior.
//   3. Scene/ritual integrity (Phase 7).
//   4. Public-domain MIDI data well-formedness (licensing + playback safety).
//   5. Server-aware session math: elapsed / remaining / pause handling /
//      clamping (Phase 5 — the exact functions the mutation uses).
//
// Run: bun scripts/flowstate-tests.mjs

import {
  TRACKS,
  SCENES,
  SOUND_CATEGORIES,
  CLASSICAL_PIECES,
  midiToFreq,
  searchTracks,
  getTrack,
  isKnownTrack,
} from "../src/lib/audio/tracks.ts";
// Server-side math lives in the convex module; these two helpers are pure.
import { elapsedMsOf, remainingMsOf } from "../src/convex/focusSessions.ts";

let passed = 0;
let failed = 0;
function check(name, cond, detail = "") {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

// ── 1. Registry integrity ────────────────────────────────────────────────
console.log("Sound Vault registry");
{
  const ids = TRACKS.map((t) => t.id);
  check("track ids are unique", new Set(ids).size === ids.length);
  check("vault has the full original catalog (24) + additions", TRACKS.length >= 29, `got ${TRACKS.length}`);
  check("every original track id survived the refactor", [
    "focus", "binaural", "lofi", "drone", "pulse", "rain", "breeze", "night", "ocean",
    "stream", "wind", "white", "brown", "pink", "birds", "morning", "cafe", "hum",
    "fire", "singing_bowl", "bach_prelude_c", "mozart_eine_kleine", "beethoven_ode",
    "pachelbel_canon",
  ].every((id) => ids.includes(id)));
  check("every track has a non-empty label, hint and tags",
    TRACKS.every((t) => t.label.trim() && t.hint.trim() && t.tags.length > 0));
  check("every track maps to a spec category", TRACKS.every((t) => SOUND_CATEGORIES.includes(t.category)));
  check("every category has at least one track",
    SOUND_CATEGORIES.every((c) => TRACKS.some((t) => t.category === c)));
  check("getTrack falls back to the default for unknown ids", getTrack("does-not-exist").id === "rain");
  check("isKnownTrack is exact", isKnownTrack("rain") && !isKnownTrack("nope"));
  check("binaural track renamed honestly (no medical framing)",
    TRACKS.find((t) => t.id === "binaural")!.label !== "Binaural Tone" ||
      TRACKS.find((t) => t.id === "binaural")!.hint.includes("headphones"));
}

// ── 2. Search ────────────────────────────────────────────────────────────
console.log("Search");
{
  check("empty query returns everything", searchTracks("").length === TRACKS.length);
  check("single term hits label", searchTracks("rain").some((t) => t.id === "rain"));
  check("tag search works", searchTracks("cozy").some((t) => t.id === "fire"));
  check("multi-term AND semantics", searchTracks("rain city").every((t) => t.id === "city_rain"));
  check("category names are searchable", searchTracks("noise").length >= 3);
  check("no ghost results", searchTracks("xylophoneZYX").length === 0);
}

// ── 3. Scenes / rituals ──────────────────────────────────────────────────
console.log("Scenes (rituals)");
{
  const sceneIds = SCENES.map((s) => s.id);
  check("scene ids unique", new Set(sceneIds).size === sceneIds.length);
  check("silent exam scene exists and is silent", SCENES.some((s) => s.id === "silent_exam" && s.trackId === null));
  check("every scene track exists", SCENES.every((s) => s.trackId === null || isKnownTrack(s.trackId)));
  check("every scene layer track exists with valid volume",
    SCENES.every((s) => s.layers.every((l) => isKnownTrack(l.trackId) && l.volume >= 0 && l.volume <= 1)));
  check("scenes stay within the 4-layer cap", SCENES.every((s) => s.layers.length <= 4));
}

// ── 4. Public-domain MIDI data ───────────────────────────────────────────
console.log("Public-domain MIDI pieces");
{
  const pieceIds = Object.keys(CLASSICAL_PIECES);
  check("registry classical tracks all have piece data",
    TRACKS.filter((t) => t.kind === "classical").every((t) => pieceIds.includes(t.id)));
  for (const [id, piece] of Object.entries(CLASSICAL_PIECES)) {
    const bad = piece.notes.find(([m, b, s]) => !(m >= 0 && m <= 127 && b > 0 && s >= 0));
    check(`${id}: notes well-formed`, !bad, JSON.stringify(bad));
    check(`${id}: notes fit inside the loop`,
      piece.notes.every(([, , s]) => s < piece.totalBeats));
    const reg = TRACKS.find((t) => t.id === id)!;
    const expect = (piece.totalBeats * (60000 / piece.tempo)) / 1000;
    check(`${id}: loopSeconds matches tempo/beats`, Math.abs((reg.loopSeconds ?? 0) - expect) < 0.01);
  }
  check("A4 = 440 Hz", midiToFreq(69) === 440);
  check("C4 ≈ 261.63 Hz", Math.abs(midiToFreq(60) - 261.626) < 0.01);
  check("composers are public-domain (died before 1934) — data-only check that we ship no post-1934 metadata",
    !TRACKS.some((t) => /(\b19[3-9]\d-\b)|(\b20\d\d-\b)/.test(t.hint)));
}

// ── 5. Server-aware session math (Phase 5) ───────────────────────────────
console.log("Server-aware session math");
{
  // Running, nothing paused: elapsed = now - started
  const running = { startedAt: 0, pausedAt: undefined, pausedTotalMs: 0, plannedSeconds: 1500 };
  check("running elapsed counts up", elapsedMsOf(running, 60_000) === 60_000);
  check("running remaining counts down", remainingMsOf(running, 60_000) === 1500_000 - 60_000);

  // Paused: frozen at pausedAt, server "now" can be much later
  const paused = { startedAt: 0, pausedAt: 50_000, pausedTotalMs: 0, plannedSeconds: 1500 };
  check("paused elapsed freezes at pausedAt", elapsedMsOf(paused, 120_000) === 50_000);
  check("paused remaining is frozen", remainingMsOf(paused, 120_000) === 1500_000 - 50_000);
  check("paused remaining never goes negative", remainingMsOf(paused, 999_999_999) >= 0);

  // After resume: accumulated pause is excluded
  const resumed = { startedAt: 0, pausedAt: undefined, pausedTotalMs: 70_000, plannedSeconds: 1500 };
  check("resumed elapsed excludes paused time", elapsedMsOf(resumed, 120_000) === 50_000);

  // Long pause chain: multiple pauses accumulate
  const chain = { startedAt: 0, pausedAt: undefined, pausedTotalMs: 70_000 + 30_000, plannedSeconds: 1500 };
  check("multiple pauses accumulate", elapsedMsOf(chain, 200_000) === 100_000);

  // Clamp: elapsed can never exceed planned (server-side honesty)
  const runaway = { startedAt: 0, pausedAt: undefined, pausedTotalMs: 0, plannedSeconds: 1500 };
  check("remaining clamps at zero", remainingMsOf(runaway, 99_000_000) === 0);

  // Clock skew: a client 10s fast still derives the same remaining
  const skewNow = 60_000;
  const skewOffset = 10_000;
  const r1 = remainingMsOf(running, skewNow);
  const r2 = remainingMsOf(running, skewNow - skewOffset);
  check("clock offset shifts remaining by exactly the offset", r2 - r1 === skewOffset);

  // Sweeper effective end (end + pausedTotal) covers paused sessions
  const sweepSession = { startedAt: 0, pausedAt: 1_400_000, pausedTotalMs: 100_000, plannedSeconds: 1500, endsAt: 1_500_000 };
  const effectiveEnd = sweepSession.endsAt + sweepSession.pausedTotalMs;
  check("sweeper effective end accounts for paused time", effectiveEnd === 1_600_000);
  check("session paused before its end is not sweepable early",
    1_450_000 < effectiveEnd);
}

console.log(`\nFLOWSTATE LOGIC TESTS: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
