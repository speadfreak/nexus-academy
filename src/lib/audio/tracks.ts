// LEARNYX FLOWSTATE — Sound Vault registry.
//
// Single source of truth for every sound the study-audio system can play.
// The registry is consumed by the FlowEngine (src/lib/audio/flowEngine.ts),
// the floating player (src/components/music-player.tsx), the Reader
// soundtrack and the Focus page — so there is exactly ONE track list in the
// product and no competing catalogs.
//
// LICENSING (critical, deliberate):
//   Every sound here is synthesized live in the browser with the Web Audio
//   API — filtered noise, oscillators and LFOs — or sequenced from MIDI note
//   arrays of PUBLIC-DOMAIN compositions (all composers died before 1934).
//   Learnyx never hosts, streams or redistributes third-party recordings,
//   so the whole vault is legally distributable by construction. New tracks
//   must follow the same rule: procedural synthesis or public-domain
//   composition data only. Do NOT add recorded/external audio URLs.

export type SoundCategory =
  | "Noise"
  | "Rain & Weather"
  | "Nature"
  | "Study Spaces"
  | "Instrumental"
  | "Focus Rituals"
  | "Wind-down";

export interface TrackMeta {
  id: string;
  label: string;
  hint: string;
  category: SoundCategory;
  tags: string[];
  /** "ambient" = procedural loop; "classical" = public-domain MIDI sequence. */
  kind: "ambient" | "classical";
  /** Length of one musical loop in seconds (classical pieces); null = seamless ∞ loop. */
  loopSeconds: number | null;
}

export const SOUND_CATEGORIES: SoundCategory[] = [
  "Noise",
  "Rain & Weather",
  "Nature",
  "Study Spaces",
  "Instrumental",
  "Focus Rituals",
  "Wind-down",
];

export const TRACKS: TrackMeta[] = [
  // ── Noise — masking beds for deep work ────────────────────────────────
  { id: "white", label: "White Noise", hint: "flat, steady, detail-friendly", category: "Noise", tags: ["white", "static", "masking", "hiss"], kind: "ambient", loopSeconds: null },
  { id: "brown", label: "Brown Noise", hint: "deep rumble, low distraction", category: "Noise", tags: ["brown", "red", "low", "rumble", "masking"], kind: "ambient", loopSeconds: null },
  { id: "pink", label: "Pink Noise", hint: "balanced spectrum, softer than white", category: "Noise", tags: ["pink", "balanced", "masking", "sleep"], kind: "ambient", loopSeconds: null },

  // ── Rain & Weather ─────────────────────────────────────────────────────
  { id: "rain", label: "Rain", hint: "soft rain on a tin roof", category: "Rain & Weather", tags: ["rain", "water", "tin roof", "cozy", "storm"], kind: "ambient", loopSeconds: null },
  { id: "city_rain", label: "City Rain", hint: "rain over a distant low rumble", category: "Rain & Weather", tags: ["rain", "city", "urban", "storm", "window"], kind: "ambient", loopSeconds: null },
  { id: "ocean", label: "Ocean Drift", hint: "slow waves and wide space", category: "Rain & Weather", tags: ["ocean", "waves", "sea", "beach"], kind: "ambient", loopSeconds: null },
  { id: "stream", label: "Mountain Stream", hint: "gentle flowing water", category: "Rain & Weather", tags: ["stream", "river", "water", "creek"], kind: "ambient", loopSeconds: null },

  // ── Nature ─────────────────────────────────────────────────────────────
  { id: "birds", label: "Morning Birds", hint: "gentle dawn chorus", category: "Nature", tags: ["birds", "morning", "dawn", "forest"], kind: "ambient", loopSeconds: null },
  { id: "forest", label: "Forest Walk", hint: "leaves, breeze and distant birds", category: "Nature", tags: ["forest", "trees", "leaves", "walk", "birds"], kind: "ambient", loopSeconds: null },
  { id: "breeze", label: "Breeze", hint: "air through an open window", category: "Nature", tags: ["breeze", "air", "window", "soft"], kind: "ambient", loopSeconds: null },
  { id: "wind", label: "Soft Wind", hint: "distant breeze through trees", category: "Nature", tags: ["wind", "trees", "outdoors"], kind: "ambient", loopSeconds: null },
  { id: "night", label: "Night", hint: "quiet room, distant crickets", category: "Nature", tags: ["night", "crickets", "quiet", "evening"], kind: "ambient", loopSeconds: null },

  // ── Study Spaces ───────────────────────────────────────────────────────
  { id: "library", label: "Reading Room", hint: "hushed library hall, page turns", category: "Study Spaces", tags: ["library", "reading", "quiet", "study", "hall"], kind: "ambient", loopSeconds: null },
  { id: "cafe", label: "Café Ambience", hint: "soft murmur of a coffee shop", category: "Study Spaces", tags: ["cafe", "coffee", "murmur", "people", "urban"], kind: "ambient", loopSeconds: null },

  // ── Instrumental — public-domain compositions, synthesized live ───────
  { id: "bach_prelude_c", label: "Bach — Prelude in C", hint: "Prelude No.1 in C Major (BWV 846)", category: "Instrumental", tags: ["bach", "baroque", "piano", "prelude", "calm"], kind: "classical", loopSeconds: 32 * (60000 / 72) / 1000 },
  { id: "mozart_eine_kleine", label: "Mozart — Eine Kleine", hint: "Serenade in G, slow movement", category: "Instrumental", tags: ["mozart", "classical", "serenade"], kind: "classical", loopSeconds: 24 * (60000 / 60) / 1000 },
  { id: "beethoven_ode", label: "Beethoven — Ode to Joy", hint: "Symphony No.9, Ode to Joy theme", category: "Instrumental", tags: ["beethoven", "ode", "joy", "symphony"], kind: "classical", loopSeconds: 18 * (60000 / 100) / 1000 },
  { id: "pachelbel_canon", label: "Pachelbel — Canon", hint: "Canon in D, gentle variation", category: "Instrumental", tags: ["pachelbel", "canon", "calm"], kind: "classical", loopSeconds: 16 * (60000 / 55) / 1000 },
  { id: "satie_gymnopedie", label: "Satie — Gymnopédie", hint: "Gymnopédie No.1, slow and dreamy", category: "Instrumental", tags: ["satie", "gymnopedie", "piano", "dreamy", "slow"], kind: "classical", loopSeconds: 24 * (60000 / 66) / 1000 },
  { id: "chopin_prelude", label: "Chopin — Prelude in E", hint: "Prelude Op.28 No.4, melancholic", category: "Instrumental", tags: ["chopin", "prelude", "piano", "melancholy"], kind: "classical", loopSeconds: 28 * (60000 / 54) / 1000 },

  // ── Focus Rituals — beds that mean "study mode" ───────────────────────
  { id: "focus", label: "Deep Focus", hint: "warm analog drone", category: "Focus Rituals", tags: ["focus", "drone", "warm", "study"], kind: "ambient", loopSeconds: null },
  { id: "drone", label: "Concentration Drone", hint: "sustained low harmonic", category: "Focus Rituals", tags: ["drone", "low", "harmonic", "focus"], kind: "ambient", loopSeconds: null },
  { id: "lofi", label: "Study Pulse", hint: "gentle rhythmic focus bed", category: "Focus Rituals", tags: ["lofi", "pulse", "rhythm", "study"], kind: "ambient", loopSeconds: null },
  { id: "pulse", label: "Alpha Pulse", hint: "soft twin-tone pad for relaxed focus", category: "Focus Rituals", tags: ["alpha", "pulse", "pad", "relaxed"], kind: "ambient", loopSeconds: null },
  { id: "binaural", label: "Twin-Tone Pad", hint: "soft two-tone bed — wear headphones", category: "Focus Rituals", tags: ["twin", "tones", "headphones", "pad"], kind: "ambient", loopSeconds: null },
  { id: "morning", label: "Morning Lift", hint: "bright harmonics for a fresh start", category: "Focus Rituals", tags: ["morning", "bright", "fresh", "energize"], kind: "ambient", loopSeconds: null },

  // ── Wind-down — breaks and closing the day ────────────────────────────
  { id: "hum", label: "Soft Hum", hint: "low sine drone for winding down", category: "Wind-down", tags: ["hum", "drone", "rest"], kind: "ambient", loopSeconds: null },
  { id: "fire", label: "Quiet Fireplace", hint: "low crackle and warm air", category: "Wind-down", tags: ["fire", "fireplace", "crackle", "warm", "cozy"], kind: "ambient", loopSeconds: null },
  { id: "singing_bowl", label: "Singing Bowl", hint: "resonant Tibetan-style tone", category: "Wind-down", tags: ["bowl", "resonant", "meditation", "break"], kind: "ambient", loopSeconds: null },
];

export const DEFAULT_TRACK_ID = "rain";

export function getTrack(id: string): TrackMeta {
  return TRACKS.find((t) => t.id === id) ?? TRACKS.find((t) => t.id === DEFAULT_TRACK_ID)!;
}

export function isKnownTrack(id: string): boolean {
  return TRACKS.some((t) => t.id === id);
}

/** Case-insensitive search across label, hint, category and tags. */
export function searchTracks(query: string, tracks: TrackMeta[] = TRACKS): TrackMeta[] {
  const q = query.trim().toLowerCase();
  if (!q) return tracks;
  const terms = q.split(/\s+/);
  return tracks.filter((t) => {
    const haystack = `${t.label} ${t.hint} ${t.category} ${t.tags.join(" ")}`.toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}

// ── Studio scenes (audio rituals) ─────────────────────────────────────
// A scene is a one-tap atmosphere: base track + optional support layers.
// `trackId: null` = silence (used by the "Silent exam" ritual). Scenes are
// pure preference presets — no health or performance claims are made.

export interface SceneLayer {
  trackId: string;
  volume: number;
}

export interface Scene {
  id: string;
  label: string;
  description: string;
  /** null = silence (stops playback). */
  trackId: string | null;
  layers: SceneLayer[];
}

export const SCENES: Scene[] = [
  { id: "deep_work", label: "Deep Work", description: "Brown noise, zero distraction", trackId: "brown", layers: [] },
  { id: "reading", label: "Reading", description: "Rain over a quiet reading room", trackId: "rain", layers: [{ trackId: "library", volume: 0.35 }] },
  { id: "revision", label: "Revision", description: "Gentle rhythmic study pulse", trackId: "lofi", layers: [] },
  { id: "cafe_study", label: "Café Study", description: "Coffee-shop murmur with soft rain", trackId: "cafe", layers: [{ trackId: "rain", volume: 0.18 }] },
  { id: "forest_break", label: "Break", description: "Forest air for a real pause", trackId: "forest", layers: [] },
  { id: "wind_down", label: "Wind-down", description: "Resonant bowl to close the day", trackId: "singing_bowl", layers: [] },
  { id: "silent_exam", label: "Silent Exam", description: "Stop all audio — exam conditions", trackId: null, layers: [] },
];

export function getScene(id: string): Scene | undefined {
  return SCENES.find((s) => s.id === id);
}

// ── Public-domain MIDI sequences (Instrumental) ───────────────────────
// [midiNote, durationInBeats, startBeat] — simplified main themes,
// recognizable but not full scores. Frequencies: A4 = 440 Hz.

export function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export interface ClassicalPiece {
  notes: [number, number, number][];
  tempo: number;
  totalBeats: number;
}

export const CLASSICAL_PIECES: Record<string, ClassicalPiece> = {
  bach_prelude_c: {
    tempo: 72,
    totalBeats: 32,
    notes: [
      [60, 0.5, 0], [64, 0.5, 0.5], [67, 0.5, 1], [72, 0.5, 1.5], [76, 0.5, 2], [79, 0.5, 2.5], [76, 0.5, 3], [72, 0.5, 3.5],
      [60, 0.5, 4], [64, 0.5, 4.5], [67, 0.5, 5], [72, 0.5, 5.5], [76, 0.5, 6], [79, 0.5, 6.5], [76, 0.5, 7], [72, 0.5, 7.5],
      [62, 0.5, 8], [65, 0.5, 8.5], [69, 0.5, 9], [74, 0.5, 9.5], [77, 0.5, 10], [81, 0.5, 10.5], [77, 0.5, 11], [74, 0.5, 11.5],
      [62, 0.5, 12], [65, 0.5, 12.5], [69, 0.5, 13], [74, 0.5, 13.5], [77, 0.5, 14], [81, 0.5, 14.5], [77, 0.5, 15], [74, 0.5, 15.5],
      [55, 0.5, 16], [59, 0.5, 16.5], [62, 0.5, 17], [67, 0.5, 17.5], [71, 0.5, 18], [74, 0.5, 18.5], [71, 0.5, 19], [67, 0.5, 19.5],
      [55, 0.5, 20], [59, 0.5, 20.5], [62, 0.5, 21], [67, 0.5, 21.5], [71, 0.5, 22], [74, 0.5, 22.5], [71, 0.5, 23], [67, 0.5, 23.5],
      [60, 0.5, 24], [64, 0.5, 24.5], [67, 0.5, 25], [72, 0.5, 25.5], [76, 0.5, 26], [79, 0.5, 26.5], [76, 0.5, 27], [72, 0.5, 27.5],
      [60, 0.5, 28], [64, 0.5, 28.5], [67, 0.5, 29], [72, 0.5, 29.5], [76, 0.5, 30], [79, 0.5, 30.5], [76, 0.5, 31], [72, 0.5, 31.5],
    ],
  },
  mozart_eine_kleine: {
    tempo: 60,
    totalBeats: 24,
    notes: [
      [67, 1, 0], [74, 1, 1], [67, 1, 2], [74, 0.5, 3], [71, 0.5, 3.5], [69, 1, 4], [67, 1, 5], [65, 1, 6],
      [67, 0.5, 7], [69, 0.5, 7.5], [71, 1, 8], [72, 1, 9], [71, 0.5, 10], [69, 0.5, 10.5], [67, 2, 11],
      [62, 1, 13], [69, 1, 14], [62, 1, 15], [69, 0.5, 16], [67, 0.5, 16.5], [65, 1, 17], [62, 1, 18],
      [67, 0.5, 19], [65, 0.5, 19.5], [64, 1, 20], [62, 3, 21],
    ],
  },
  beethoven_ode: {
    tempo: 100,
    totalBeats: 18,
    notes: [
      [64, 0.5, 0], [64, 0.5, 0.5], [65, 0.5, 1], [67, 0.5, 1.5],
      [67, 0.5, 2], [65, 0.5, 2.5], [64, 0.5, 3], [62, 0.5, 3.5],
      [60, 0.5, 4], [60, 0.5, 4.5], [62, 0.5, 5], [64, 0.5, 5.5],
      [64, 0.75, 6], [62, 0.25, 6.75], [62, 2, 7],
      [64, 0.5, 9], [64, 0.5, 9.5], [65, 0.5, 10], [67, 0.5, 10.5],
      [67, 0.5, 11], [65, 0.5, 11.5], [64, 0.5, 12], [62, 0.5, 12.5],
      [60, 0.5, 13], [60, 0.5, 13.5], [62, 0.5, 14], [64, 0.5, 14.5],
      [62, 0.75, 15], [60, 0.25, 15.75], [60, 2, 16],
    ],
  },
  pachelbel_canon: {
    tempo: 55,
    totalBeats: 16,
    notes: [
      [62, 1, 0], [69, 1, 1], [71, 1, 2], [66, 1, 3],
      [67, 1, 4], [62, 1, 5], [67, 1, 6], [69, 1, 7],
      [74, 0.5, 8], [73, 0.5, 8.5], [74, 0.5, 9], [76, 0.5, 9.5],
      [74, 0.5, 10], [73, 0.5, 10.5], [71, 0.5, 11], [69, 0.5, 11.5],
      [71, 0.5, 12], [73, 0.5, 12.5], [74, 0.5, 13], [76, 0.5, 13.5],
      [77, 0.5, 14], [76, 0.5, 14.5], [74, 0.5, 15], [73, 0.5, 15.5],
    ],
  },
  // Erik Satie (1866–1925) — Gymnopédie No.1, simplified dreamy theme.
  satie_gymnopedie: {
    tempo: 66,
    totalBeats: 24,
    notes: [
      [78, 1.5, 0], [81, 0.5, 1.5], [83, 1, 2], [78, 2, 3],
      [76, 1.5, 5], [78, 0.5, 6.5], [81, 1, 7], [76, 2, 8],
      [74, 1.5, 10], [76, 0.5, 11.5], [78, 1, 12], [83, 2, 13],
      [81, 1.5, 15], [78, 0.5, 16.5], [76, 1, 17], [74, 3, 18],
      [69, 1, 21], [71, 1, 22], [74, 2, 23],
    ],
  },
  // Frédéric Chopin (1810–1849) — Prelude Op.28 No.4 in E minor,
  // simplified melodic line over a slow homophonic feel.
  chopin_prelude: {
    tempo: 54,
    totalBeats: 28,
    notes: [
      [71, 2, 0], [72, 2, 2], [71, 2, 4], [69, 2, 6],
      [67, 2, 8], [69, 2, 10], [71, 3, 12],
      [64, 2, 15], [67, 2, 17], [69, 2, 19], [71, 2, 21],
      [72, 2, 23], [71, 4, 25],
    ],
  },
};
