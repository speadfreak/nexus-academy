// Study-vibe ambient player — NEXT LEVEL.
//
// ARCHITECTURE:
//   - Synthesized ambient tracks (Web Audio API, no external files)
//   - Classical pieces (MIDI-synthesized from public-domain compositions)
//   - Mixer mode (layer 2+ tracks with independent volumes)
//   - Saved mix presets (stored as JSON config in localStorage)
//   - Focus-timer sync (auto-shift mood during work/break)
//   - YouTube embed integration (student's own URL, embeds only)
//   - Visualizer (reacts to active audio source)
//   - Time-of-day mood suggestions (dismissible)
//
// CRITICAL PRINCIPLE: No user-uploaded audio files are ever stored on
// our servers. External music (YouTube/Spotify) streams from the
// external service's own infrastructure — we only embed their player.
//
// DEFAULTS: OFF on first visit (no autoplay), volume 0.55. State
// (track + volume + mix presets) persists in localStorage. The
// provider lives at the app root so play state survives route changes.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  AudioLines,
  ChevronDown,
  ChevronUp,
  Layers,
  Pause,
  Play,
  Plus,
  Save,
  Trash2,
  Volume2,
  X,
  Youtube,
  Sparkles,
  Sun,
  Moon,
  Cloud,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Track definitions ─────────────────────────────────────────────────

type TrackCategory = "Focus" | "Calm" | "Deep Work" | "Energize" | "Wind-down" | "Classical";

interface Track {
  id: string;
  label: string;
  hint: string;
  category: TrackCategory;
  icon?: string;
}

const TRACKS: Track[] = [
  // Focus
  { id: "focus", label: "Deep Focus", hint: "warm analog drone", category: "Focus" },
  { id: "binaural", label: "Binaural Tone", hint: "soft 4 Hz beat — wear headphones", category: "Focus" },
  { id: "lofi", label: "Study Pulse", hint: "gentle rhythmic focus bed", category: "Focus" },
  { id: "drone", label: "Concentration Drone", hint: "sustained low harmonic", category: "Focus" },
  { id: "pulse", label: "Alpha Pulse", hint: "10 Hz alpha waves for relaxed focus", category: "Focus" },

  // Calm
  { id: "rain", label: "Rain", hint: "soft rain on a tin roof", category: "Calm" },
  { id: "breeze", label: "Breeze", hint: "air through an open window", category: "Calm" },
  { id: "night", label: "Night", hint: "quiet room, distant crickets", category: "Calm" },
  { id: "ocean", label: "Ocean Drift", hint: "slow waves and wide space", category: "Calm" },
  { id: "stream", label: "Mountain Stream", hint: "gentle flowing water", category: "Calm" },
  { id: "wind", label: "Soft Wind", hint: "distant breeze through trees", category: "Calm" },

  // Deep Work
  { id: "white", label: "White Noise", hint: "flat, steady, detail-friendly", category: "Deep Work" },
  { id: "brown", label: "Brown Noise", hint: "deep rumble, low distraction", category: "Deep Work" },
  { id: "pink", label: "Pink Noise", hint: "balanced spectrum, softer than white", category: "Deep Work" },

  // Energize
  { id: "birds", label: "Morning Birds", hint: "gentle dawn chorus", category: "Energize" },
  { id: "morning", label: "Morning Lift", hint: "bright harmonics for a fresh start", category: "Energize" },
  { id: "cafe", label: "Cafe Ambience", hint: "soft murmur of a coffee shop", category: "Energize" },

  // Wind-down
  { id: "hum", label: "Soft Hum", hint: "low sine drone for winding down", category: "Wind-down" },
  { id: "fire", label: "Quiet Fireplace", hint: "low crackle and warm air", category: "Wind-down" },
  { id: "singing_bowl", label: "Singing Bowl", hint: "resonant Tibetan-style tone", category: "Wind-down" },

  // Classical (synthesized from public-domain compositions)
  { id: "bach_prelude_c", label: "Bach — Prelude in C", hint: "Prelude No.1 in C Major (BWV 846)", category: "Classical" },
  { id: "mozart_eine_kleine", label: "Mozart — Eine Kleine", hint: "Serenade in G, slow movement", category: "Classical" },
  { id: "beethoven_ode", label: "Beethoven — Ode to Joy", hint: "Symphony No.9, Ode to Joy theme", category: "Classical" },
  { id: "pachelbel_canon", label: "Pachelbel — Canon", hint: "Canon in D, gentle variation", category: "Classical" },
];

// ── MIDI note frequency helper ───────────────────────────────────────
// A4 = 440 Hz. We compute frequencies from MIDI note numbers.
function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

// ── Classical piece data (MIDI note sequences) ────────────────────────
// Each note: [midi_note, duration_in_beats, start_beat]
// Tempo is set per-piece. These are simplified melodies of the main
// themes — enough to be recognizable, not full scores.

const BACH_PRELUDE_C: [number, number, number][] = [
  // Bach Prelude No.1 in C Major (BWV 846) — simplified arpeggios
  // Each bar: C-E-G-C'-E'-G'-E'-C' repeated with chord changes
  // [midi, beats, start]
  [60, 0.5, 0], [64, 0.5, 0.5], [67, 0.5, 1], [72, 0.5, 1.5], [76, 0.5, 2], [79, 0.5, 2.5], [76, 0.5, 3], [72, 0.5, 3.5],
  [60, 0.5, 4], [64, 0.5, 4.5], [67, 0.5, 5], [72, 0.5, 5.5], [76, 0.5, 6], [79, 0.5, 6.5], [76, 0.5, 7], [72, 0.5, 7.5],
  // Bar 3: D minor chord
  [62, 0.5, 8], [65, 0.5, 8.5], [69, 0.5, 9], [74, 0.5, 9.5], [77, 0.5, 10], [81, 0.5, 10.5], [77, 0.5, 11], [74, 0.5, 11.5],
  // Bar 4: D minor chord
  [62, 0.5, 12], [65, 0.5, 12.5], [69, 0.5, 13], [74, 0.5, 13.5], [77, 0.5, 14], [81, 0.5, 14.5], [77, 0.5, 15], [74, 0.5, 15.5],
  // Bar 5: G major
  [55, 0.5, 16], [59, 0.5, 16.5], [62, 0.5, 17], [67, 0.5, 17.5], [71, 0.5, 18], [74, 0.5, 18.5], [71, 0.5, 19], [67, 0.5, 19.5],
  // Bar 6: G major
  [55, 0.5, 20], [59, 0.5, 20.5], [62, 0.5, 21], [67, 0.5, 21.5], [71, 0.5, 22], [74, 0.5, 22.5], [71, 0.5, 23], [67, 0.5, 23.5],
  // Bar 7: C major (resolution)
  [60, 0.5, 24], [64, 0.5, 24.5], [67, 0.5, 25], [72, 0.5, 25.5], [76, 0.5, 26], [79, 0.5, 26.5], [76, 0.5, 27], [72, 0.5, 27.5],
  // Bar 8: C major
  [60, 0.5, 28], [64, 0.5, 28.5], [67, 0.5, 29], [72, 0.5, 29.5], [76, 0.5, 30], [79, 0.5, 30.5], [76, 0.5, 31], [72, 0.5, 31.5],
];

const MOZART_EINE_KLEINE: [number, number, number][] = [
  // Mozart Eine Kleine Nachtmusik — Romanza (slow movement) simplified
  // G-D-G-Dq-B-A-G motif
  [67, 1, 0], [74, 1, 1], [67, 1, 2], [74, 0.5, 3], [71, 0.5, 3.5], [69, 1, 4], [67, 1, 5], [65, 1, 6],
  [67, 0.5, 7], [69, 0.5, 7.5], [71, 1, 8], [72, 1, 9], [71, 0.5, 10], [69, 0.5, 10.5], [67, 2, 11],
  [62, 1, 13], [69, 1, 14], [62, 1, 15], [69, 0.5, 16], [67, 0.5, 16.5], [65, 1, 17], [62, 1, 18],
  [67, 0.5, 19], [65, 0.5, 19.5], [64, 1, 20], [62, 3, 21],
];

const BEETHOVEN_ODE_JOY: [number, number, number][] = [
  // Beethoven Symphony No.9 — Ode to Joy theme (simplified melody)
  // E-E-F-G-G-F-E-D-C-C-D-E-E-D-D
  [64, 0.5, 0], [64, 0.5, 0.5], [65, 0.5, 1], [67, 0.5, 1.5],
  [67, 0.5, 2], [65, 0.5, 2.5], [64, 0.5, 3], [62, 0.5, 3.5],
  [60, 0.5, 4], [60, 0.5, 4.5], [62, 0.5, 5], [64, 0.5, 5.5],
  [64, 0.75, 6], [62, 0.25, 6.75], [62, 2, 7],
  // Second phrase
  [64, 0.5, 9], [64, 0.5, 9.5], [65, 0.5, 10], [67, 0.5, 10.5],
  [67, 0.5, 11], [65, 0.5, 11.5], [64, 0.5, 12], [62, 0.5, 12.5],
  [60, 0.5, 13], [60, 0.5, 13.5], [62, 0.5, 14], [64, 0.5, 14.5],
  [62, 0.75, 15], [60, 0.25, 15.75], [60, 2, 16],
];

const PACHELBEL_CANON: [number, number, number][] = [
  // Pachelbel Canon in D — simplified bass + melody line
  // D-A-B-F#-G-D-G-A pattern
  [62, 1, 0], [69, 1, 1], [71, 1, 2], [66, 1, 3],
  [67, 1, 4], [62, 1, 5], [67, 1, 6], [69, 1, 7],
  // Melody over the bass
  [74, 0.5, 8], [73, 0.5, 8.5], [74, 0.5, 9], [76, 0.5, 9.5],
  [74, 0.5, 10], [73, 0.5, 10.5], [71, 0.5, 11], [69, 0.5, 11.5],
  [71, 0.5, 12], [73, 0.5, 12.5], [74, 0.5, 13], [76, 0.5, 13.5],
  [77, 0.5, 14], [76, 0.5, 14.5], [74, 0.5, 15], [73, 0.5, 15.5],
];

const CLASSICAL_PIECES: Record<string, { notes: [number, number, number][]; tempo: number; totalBeats: number }> = {
  bach_prelude_c: { notes: BACH_PRELUDE_C, tempo: 72, totalBeats: 32 },
  mozart_eine_kleine: { notes: MOZART_EINE_KLEINE, tempo: 60, totalBeats: 24 },
  beethoven_ode: { notes: BEETHOVEN_ODE_JOY, tempo: 100, totalBeats: 18 },
  pachelbel_canon: { notes: PACHELBEL_CANON, tempo: 55, totalBeats: 16 },
};

// ── Mix preset type ───────────────────────────────────────────────────

interface MixLayer {
  trackId: string;
  volume: number; // 0-1
}

interface MixPreset {
  id: string;
  name: string;
  layers: MixLayer[];
}

// ── Music context ────────────────────────────────────────────────────

type AudioSource = "synth" | "youtube";

interface MusicContextValue {
  playing: boolean;
  track: Track;
  volume: number;
  toggle: () => void;
  cycleTrack: (direction: 1 | -1) => void;
  setVolume: (volume: number) => void;
  selectTrack: (trackId: string) => void;
  // Mixer mode
  mixerMode: boolean;
  toggleMixerMode: () => void;
  activeLayers: MixLayer[];
  addLayer: (trackId: string) => void;
  removeLayer: (index: number) => void;
  setLayerVolume: (index: number, volume: number) => void;
  // Mix presets
  presets: MixPreset[];
  savePreset: (name: string) => void;
  loadPreset: (preset: MixPreset) => void;
  deletePreset: (id: string) => void;
  // YouTube
  youtubeUrl: string;
  setYoutubeUrl: (url: string) => void;
  youtubePlaying: boolean;
  toggleYoutube: () => void;
  audioSource: AudioSource;
  setAudioSource: (source: AudioSource) => void;
  // Focus-timer sync
  focusMode: "work" | "break" | "idle";
  setFocusMode: (mode: "work" | "break" | "idle") => void;
}

const MusicContext = createContext<MusicContextValue | null>(null);

const STORAGE_KEY = "learnyx-music";
const PRESETS_KEY = "learnyx-mix-presets";

// ── Storage helpers ───────────────────────────────────────────────────

function readStored(): { trackId: string; volume: number } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { trackId?: string; volume?: number };
      const trackId = TRACKS.some((t) => t.id === parsed.trackId) ? parsed.trackId! : "rain";
      const volume = typeof parsed.volume === "number" && parsed.volume >= 0 && parsed.volume <= 1 ? parsed.volume : 0.55;
      return { trackId, volume };
    }
  } catch { /* ignore */ }
  return { trackId: "rain", volume: 0.55 };
}

function readPresets(): MixPreset[] {
  try {
    const raw = localStorage.getItem(PRESETS_KEY);
    if (raw) return JSON.parse(raw) as MixPreset[];
  } catch { /* ignore */ }
  return [];
}

// ── Ambient Engine — handles all synthesized audio ───────────────────

class AmbientEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private nodes: AudioNode[] = [];
  private lfos: OscillatorNode[] = [];
  private source: AudioBufferSourceNode | null = null;
  private classicalTimeouts: ReturnType<typeof setTimeout>[] = [];
  private layerEngines: Map<number, { gain: GainNode; nodes: AudioNode[]; source: AudioBufferSourceNode | null; lfos: OscillatorNode[]; timeouts: ReturnType<typeof setTimeout>[] }> = new Map();

  private ensureContext(volume: number): AudioContext {
    if (!this.ctx) {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.gain.value = volume;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
    return this.ctx;
  }

  private noiseBuffer(ctx: AudioContext): AudioBuffer {
    const length = ctx.sampleRate * 2;
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  private addLfo(freq: number, depth: number, target: AudioParam, lfoArr: OscillatorNode[]) {
    if (!this.ctx) return;
    const lfo = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    lfo.frequency.value = freq;
    gain.gain.value = depth;
    lfo.connect(gain);
    gain.connect(target);
    lfo.start();
    lfoArr.push(lfo);
  }

  // ── Single-track synthesis (original mode) ──────────────────────────

  start(trackId: string, volume: number) {
    this.stop();
    const ctx = this.ensureContext(volume);
    if (!this.master) return;
    const out = this.master;
    this.synthesizeTrack(ctx, out, trackId, this.nodes, this.lfos);
  }

  private synthesizeTrack(
    ctx: AudioContext,
    out: AudioNode,
    trackId: string,
    nodes: AudioNode[],
    lfos: OscillatorNode[],
  ) {
    // Classical pieces — schedule MIDI notes
    if (CLASSICAL_PIECES[trackId]) {
      this.playClassical(ctx, out, trackId, nodes, lfos);
      return;
    }

    // Ambient tracks
    switch (trackId) {
      case "rain": {
        const source = ctx.createBufferSource();
        source.buffer = this.noiseBuffer(ctx); source.loop = true;
        const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 850; lp.Q.value = 0.4;
        const g = ctx.createGain(); g.gain.value = 0.28;
        source.connect(lp); lp.connect(g); g.connect(out); source.start();
        if ("source" in this && this.source === null) this.source = source;
        nodes.push(lp, g);
        this.addLfo(0.14, 0.07, g.gain, lfos);
        break;
      }
      case "focus": case "drone": {
        const freqs = trackId === "focus" ? [110, 165.4, 220.6] : [82.4, 123.5, 164.8];
        const g = ctx.createGain(); g.gain.value = trackId === "focus" ? 0.16 : 0.12;
        const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 760; lp.Q.value = 0.6;
        for (const f of freqs) {
          const osc = ctx.createOscillator(); osc.type = f === freqs[2] ? "triangle" : "sine";
          osc.frequency.value = f; osc.detune.value = (Math.random() - 0.5) * 6;
          osc.connect(lp); osc.start(); nodes.push(osc);
        }
        lp.connect(g); g.connect(out); nodes.push(lp, g);
        this.addLfo(0.09, 0.05, g.gain, lfos);
        break;
      }
      case "pulse": {
        // Alpha waves — 10 Hz binaural-ish
        const l = ctx.createOscillator(); l.type = "sine"; l.frequency.value = 200;
        const r = ctx.createOscillator(); r.type = "sine"; r.frequency.value = 210;
        const g = ctx.createGain(); g.gain.value = 0.06;
        l.connect(g); r.connect(g); g.connect(out);
        l.start(); r.start(); nodes.push(l, r, g);
        this.addLfo(0.12, 0.01, g.gain, lfos);
        break;
      }
      case "breeze": case "wind": {
        const source = ctx.createBufferSource();
        source.buffer = this.noiseBuffer(ctx); source.loop = true;
        const bp = ctx.createBiquadFilter(); bp.type = "bandpass";
        bp.frequency.value = trackId === "wind" ? 360 : 480; bp.Q.value = 0.5;
        const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = trackId === "wind" ? 800 : 1400;
        const g = ctx.createGain(); g.gain.value = trackId === "wind" ? 0.15 : 0.2;
        source.connect(bp); bp.connect(lp); lp.connect(g); g.connect(out); source.start();
        if (this.source === null) this.source = source;
        nodes.push(bp, lp, g);
        this.addLfo(trackId === "wind" ? 0.12 : 0.2, 0.06, g.gain, lfos);
        break;
      }
      case "white": case "pink": {
        const source = ctx.createBufferSource();
        source.buffer = this.noiseBuffer(ctx); source.loop = true;
        const hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 120;
        const g = ctx.createGain(); g.gain.value = trackId === "pink" ? 0.12 : 0.14;
        source.connect(hp); hp.connect(g); g.connect(out); source.start();
        if (this.source === null) this.source = source;
        nodes.push(hp, g);
        this.addLfo(0.07, 0.025, g.gain, lfos);
        break;
      }
      case "brown": {
        const source = ctx.createBufferSource();
        source.buffer = this.noiseBuffer(ctx); source.loop = true;
        const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 210; lp.Q.value = 0.3;
        const g = ctx.createGain(); g.gain.value = 0.3;
        source.connect(lp); lp.connect(g); g.connect(out); source.start();
        if (this.source === null) this.source = source;
        nodes.push(lp, g);
        this.addLfo(0.05, 0.04, g.gain, lfos);
        break;
      }
      case "night": {
        const source = ctx.createBufferSource();
        source.buffer = this.noiseBuffer(ctx); source.loop = true;
        const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 620;
        const bedG = ctx.createGain(); bedG.gain.value = 0.16;
        source.connect(lp); lp.connect(bedG); bedG.connect(out); source.start();
        if (this.source === null) this.source = source;
        nodes.push(lp, bedG);
        this.addLfo(0.09, 0.03, bedG.gain, lfos);
        const cricket = ctx.createOscillator(); cricket.type = "sine"; cricket.frequency.value = 4100;
        const cg = ctx.createGain(); cg.gain.value = 0.004;
        cricket.connect(cg); cg.connect(out); cricket.start();
        nodes.push(cricket, cg);
        this.addLfo(22, 0.0038, cg.gain, lfos);
        break;
      }
      case "ocean": case "stream": {
        const source = ctx.createBufferSource();
        source.buffer = this.noiseBuffer(ctx); source.loop = true;
        const f = ctx.createBiquadFilter(); f.type = "lowpass";
        f.frequency.value = trackId === "stream" ? 580 : 420; f.Q.value = trackId === "stream" ? 1.2 : 0.8;
        const g = ctx.createGain(); g.gain.value = trackId === "stream" ? 0.25 : 0.32;
        source.connect(f); f.connect(g); g.connect(out); source.start();
        if (this.source === null) this.source = source;
        nodes.push(f, g);
        this.addLfo(trackId === "stream" ? 0.3 : 0.08, trackId === "stream" ? 0.05 : 0.18, g.gain, lfos);
        break;
      }
      case "fire": {
        const source = ctx.createBufferSource();
        source.buffer = this.noiseBuffer(ctx); source.loop = true;
        const f = ctx.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = 260; f.Q.value = 0.55;
        const g = ctx.createGain(); g.gain.value = 0.18;
        source.connect(f); f.connect(g); g.connect(out); source.start();
        if (this.source === null) this.source = source;
        nodes.push(f, g);
        this.addLfo(3.2, 0.12, g.gain, lfos);
        break;
      }
      case "lofi": case "morning": {
        const g = ctx.createGain(); g.gain.value = 0.055; g.connect(out);
        const notes = trackId === "lofi" ? [146.83, 174.61, 220, 261.63] : [261.63, 329.63, 392, 523.25];
        for (const f of notes) {
          const osc = ctx.createOscillator(); osc.type = "triangle"; osc.frequency.value = f;
          osc.detune.value = (Math.random() - 0.5) * 4; osc.connect(g); osc.start(); nodes.push(osc);
        }
        this.addLfo(trackId === "lofi" ? 0.16 : 0.08, 0.025, g.gain, lfos);
        break;
      }
      case "cafe": {
        const source = ctx.createBufferSource();
        source.buffer = this.noiseBuffer(ctx); source.loop = true;
        const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 300; bp.Q.value = 0.3;
        const g = ctx.createGain(); g.gain.value = 0.12;
        source.connect(bp); bp.connect(g); g.connect(out); source.start();
        if (this.source === null) this.source = source;
        nodes.push(bp, g);
        this.addLfo(0.15, 0.03, g.gain, lfos);
        break;
      }
      case "singing_bowl": {
        // Resonant bowl tone — rich harmonic
        const g = ctx.createGain(); g.gain.value = 0.08; g.connect(out);
        const freqs = [196, 294, 392, 490]; // G3, D4, G4, B4
        for (const f of freqs) {
          const osc = ctx.createOscillator(); osc.type = "sine"; osc.frequency.value = f;
          osc.detune.value = (Math.random() - 0.5) * 2; osc.connect(g); osc.start(); nodes.push(osc);
        }
        this.addLfo(0.08, 0.02, g.gain, lfos);
        break;
      }
      case "hum": {
        const g = ctx.createGain(); g.gain.value = 0.06; g.connect(out);
        const osc = ctx.createOscillator(); osc.type = "sine"; osc.frequency.value = 130;
        osc.connect(g); osc.start(); nodes.push(osc, g);
        this.addLfo(0.1, 0.015, g.gain, lfos);
        break;
      }
      case "binaural": {
        const l = ctx.createOscillator(); l.type = "sine"; l.frequency.value = 200;
        const r = ctx.createOscillator(); r.type = "sine"; r.frequency.value = 204;
        const g = ctx.createGain(); g.gain.value = 0.07;
        const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 900;
        l.connect(lp); r.connect(lp); lp.connect(g); g.connect(out);
        l.start(); r.start(); nodes.push(l, r, lp, g);
        this.addLfo(0.12, 0.01, g.gain, lfos);
        break;
      }
      default: {
        // Fallback — simple rain
        const source = ctx.createBufferSource();
        source.buffer = this.noiseBuffer(ctx); source.loop = true;
        const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 850;
        const g = ctx.createGain(); g.gain.value = 0.28;
        source.connect(lp); lp.connect(g); g.connect(out); source.start();
        if (this.source === null) this.source = source;
        nodes.push(lp, g);
        this.addLfo(0.14, 0.07, g.gain, lfos);
      }
    }
  }

  // ── Classical piece playback — schedule MIDI notes ────────────────

  private playClassical(
    ctx: AudioContext,
    out: AudioNode,
    pieceId: string,
    nodes: AudioNode[],
    lfos: OscillatorNode[],
    timeouts: ReturnType<typeof setTimeout>[] = this.classicalTimeouts,
  ) {
    const piece = CLASSICAL_PIECES[pieceId];
    if (!piece) return;
    const beatDuration = 60000 / piece.tempo; // ms per beat
    const masterGain = ctx.createGain();
    masterGain.gain.value = 0.12;
    masterGain.connect(out);
    nodes.push(masterGain);

    // Schedule each note
    for (const [midi, beats, startBeat] of piece.notes) {
      const startTime = startBeat * beatDuration;
      const duration = beats * beatDuration;

      const timeout = setTimeout(() => {
        if (!this.ctx || this.ctx.state === "closed") return;
        const osc = ctx.createOscillator();
        osc.type = "triangle";
        osc.frequency.value = midiToFreq(midi);

        const noteGain = ctx.createGain();
        // Gentle attack + release envelope for a piano-like sound
        const now = ctx.currentTime;
        noteGain.gain.setValueAtTime(0, now);
        noteGain.gain.linearRampToValueAtTime(0.8, now + 0.03); // 30ms attack
        noteGain.gain.setTargetAtTime(0.4, now + 0.1, 0.15); // decay to sustain
        noteGain.gain.setTargetAtTime(0, now + duration / 1000, 0.1); // release

        osc.connect(noteGain);
        noteGain.connect(masterGain);
        osc.start(now);
        osc.stop(now + duration / 1000 + 0.3);
        nodes.push(osc, noteGain);
      }, startTime);
      timeouts.push(timeout);
    }

    // Schedule loop — repeat the piece
    const totalDuration = piece.totalBeats * beatDuration;
    const loopTimeout = setTimeout(() => {
      this.playClassical(ctx, out, pieceId, nodes, lfos, timeouts);
    }, totalDuration);
    timeouts.push(loopTimeout);
  }

  // ── Mixer mode — play multiple layers ──────────────────────────────

  startLayer(index: number, trackId: string, volume: number) {
    const ctx = this.ensureContext(volume);
    if (!this.master) return;

    const layerGain = ctx.createGain();
    layerGain.gain.value = volume;
    layerGain.connect(this.master);

    const layerNodes: AudioNode[] = [layerGain];
    const layerLfos: OscillatorNode[] = [];
    const layerSource: AudioBufferSourceNode | null = null;
    const layerTimeouts: ReturnType<typeof setTimeout>[] = [];

    this.synthesizeTrack(ctx, layerGain, trackId, layerNodes, layerLfos);
    // For classical pieces, we need to pass the timeouts too
    if (CLASSICAL_PIECES[trackId]) {
      this.playClassical(ctx, layerGain, trackId, layerNodes, layerLfos, layerTimeouts);
    }

    this.layerEngines.set(index, {
      gain: layerGain,
      nodes: layerNodes,
      source: layerSource,
      lfos: layerLfos,
      timeouts: layerTimeouts,
    });
  }

  setLayerVolume(index: number, volume: number) {
    const layer = this.layerEngines.get(index);
    if (layer && this.ctx) {
      layer.gain.gain.setTargetAtTime(volume, this.ctx.currentTime, 0.05);
    }
  }

  stopLayer(index: number) {
    const layer = this.layerEngines.get(index);
    if (layer) {
      for (const lfo of layer.lfos) { try { lfo.stop(); } catch {} lfo.disconnect(); }
      for (const t of layer.timeouts) clearTimeout(t);
      if (layer.source) { try { layer.source.stop(); } catch {} layer.source.disconnect(); }
      for (const n of layer.nodes) { try { n.disconnect(); } catch {} }
      this.layerEngines.delete(index);
    }
  }

  stopAllLayers() {
    for (const index of Array.from(this.layerEngines.keys())) {
      this.stopLayer(index);
    }
  }

  setVolume(volume: number) {
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(volume, this.ctx.currentTime, 0.05);
    }
  }

  stop() {
    // Clear classical timeouts
    for (const t of this.classicalTimeouts) clearTimeout(t);
    this.classicalTimeouts = [];
    // Stop single track
    for (const lfo of this.lfos) { try { lfo.stop(); } catch {} lfo.disconnect(); }
    this.lfos = [];
    if (this.source) { try { this.source.stop(); } catch {} this.source.disconnect(); this.source = null; }
    for (const n of this.nodes) { try { n.disconnect(); } catch {} }
    this.nodes = [];
    // Stop all layers
    this.stopAllLayers();
  }
}

// ── Provider ──────────────────────────────────────────────────────────

export function MusicProvider({ children }: { children: ReactNode }) {
  const stored = useRef(readStored());
  const [playing, setPlaying] = useState(false);
  const [trackId, setTrackId] = useState(stored.current.trackId);
  const [volume, setVolumeState] = useState(stored.current.volume);
  const engineRef = useRef<AmbientEngine | null>(null);

  // Mixer state
  const [mixerMode, setMixerMode] = useState(false);
  const [activeLayers, setActiveLayers] = useState<MixLayer[]>([]);
  const [presets, setPresets] = useState<MixPreset[]>(() => readPresets());

  // YouTube state
  const [youtubeUrl, setYoutubeUrlState] = useState("");
  const [youtubePlaying, setYoutubePlaying] = useState(false);
  const [audioSource, setAudioSource] = useState<AudioSource>("synth");

  // Focus-timer sync
  const [focusMode, setFocusMode] = useState<"work" | "break" | "idle">("idle");

  const getEngine = () => {
    if (!engineRef.current) engineRef.current = new AmbientEngine();
    return engineRef.current;
  };

  const track = TRACKS.find((t) => t.id === trackId) ?? TRACKS[0]!;

  const persist = (nextTrackId: string, nextVolume: number) => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ trackId: nextTrackId, volume: nextVolume })); } catch {}
  };

  const toggle = useCallback(() => {
    if (audioSource === "youtube") {
      setYoutubePlaying((p) => !p);
      return;
    }
    if (!playing) {
      if (mixerMode && activeLayers.length > 0) {
        // Mixer mode — start all layers
        activeLayers.forEach((layer, i) => {
          getEngine().startLayer(i, layer.trackId, layer.volume * volume);
        });
      } else {
        getEngine().start(trackId, volume);
      }
      setPlaying(true);
    } else {
      if (mixerMode) getEngine().stopAllLayers(); else getEngine().stop();
      setPlaying(false);
    }
  }, [playing, trackId, volume, mixerMode, activeLayers, audioSource]);

  const cycleTrack = useCallback((direction: 1 | -1) => {
    const index = TRACKS.findIndex((t) => t.id === trackId);
    const next = TRACKS[(index + direction + TRACKS.length) % TRACKS.length]!;
    setTrackId(next.id);
    persist(next.id, volume);
    if (playing && !mixerMode) getEngine().start(next.id, volume);
  }, [trackId, volume, playing, mixerMode]);

  const selectTrack = useCallback((id: string) => {
    setTrackId(id);
    persist(id, volume);
    if (playing && !mixerMode) getEngine().start(id, volume);
  }, [volume, playing, mixerMode]);

  const setVolume = useCallback((next: number) => {
    setVolumeState(next);
    persist(trackId, next);
    if (playing) getEngine().setVolume(next);
  }, [trackId, playing]);

  // ── Mixer actions ────────────────────────────────────────────────

  const toggleMixerMode = useCallback(() => {
    setMixerMode((prev) => {
      const next = !prev;
      if (playing) {
        getEngine().stop();
        if (next && activeLayers.length > 0) {
          activeLayers.forEach((layer, i) => getEngine().startLayer(i, layer.trackId, layer.volume * volume));
        } else if (!next) {
          getEngine().start(trackId, volume);
        }
        setPlaying(next ? activeLayers.length > 0 : true);
      }
      return next;
    });
  }, [playing, activeLayers, trackId, volume]);

  const addLayer = useCallback((id: string) => {
    setActiveLayers((prev) => {
      const next = [...prev, { trackId: id, volume: 0.5 }];
      if (playing && mixerMode) {
        getEngine().startLayer(next.length - 1, id, 0.5 * volume);
      }
      return next;
    });
  }, [playing, mixerMode, volume]);

  const removeLayer = useCallback((index: number) => {
    setActiveLayers((prev) => {
      getEngine().stopLayer(index);
      return prev.filter((_, i) => i !== index);
    });
  }, []);

  const setLayerVolume = useCallback((index: number, vol: number) => {
    setActiveLayers((prev) => prev.map((l, i) => i === index ? { ...l, volume: vol } : l));
    getEngine().setLayerVolume(index, vol * volume);
  }, [volume]);

  const savePreset = useCallback((name: string) => {
    const preset: MixPreset = {
      id: `preset-${Date.now()}`,
      name,
      layers: activeLayers.map(l => ({ ...l })),
    };
    const next = [...presets, preset];
    setPresets(next);
    try { localStorage.setItem(PRESETS_KEY, JSON.stringify(next)); } catch {}
  }, [activeLayers, presets]);

  const loadPreset = useCallback((preset: MixPreset) => {
    if (playing) getEngine().stop();
    setActiveLayers(preset.layers);
    setMixerMode(true);
    if (playing) {
      preset.layers.forEach((layer, i) => getEngine().startLayer(i, layer.trackId, layer.volume * volume));
    }
  }, [playing, volume]);

  const deletePreset = useCallback((id: string) => {
    const next = presets.filter(p => p.id !== id);
    setPresets(next);
    try { localStorage.setItem(PRESETS_KEY, JSON.stringify(next)); } catch {}
  }, [presets]);

  // ── YouTube actions ──────────────────────────────────────────────

  const setYoutubeUrl = useCallback((url: string) => {
    setYoutubeUrlState(url);
    if (url) {
      setAudioSource("youtube");
      if (playing) {
        getEngine().stop();
        setPlaying(false);
      }
    }
  }, [playing]);

  const toggleYoutube = useCallback(() => {
    setYoutubePlaying((p) => !p);
  }, []);

  // ── Focus-timer sync ────────────────────────────────────────────
  // When the focus mode changes, auto-shift the track to match the mood:
  // work → deep focus / concentration track
  // break → calm / wind-down track
  // idle → no change

  useEffect(() => {
    if (focusMode === "idle" || !playing) return;
    if (focusMode === "work" && (track.category === "Wind-down" || track.category === "Calm")) {
      // Shift to a focus track
      const focusTrack = TRACKS.find(t => t.category === "Focus" && t.id === "focus");
      if (focusTrack) selectTrack(focusTrack.id);
    } else if (focusMode === "break" && (track.category === "Focus" || track.category === "Deep Work")) {
      // Shift to a calm track
      const calmTrack = TRACKS.find(t => t.category === "Calm" && t.id === "rain");
      if (calmTrack) selectTrack(calmTrack.id);
    }
  }, [focusMode, playing, track, selectTrack]);

  // Cleanup on unmount
  useEffect(() => {
    return () => { engineRef.current?.stop(); };
  }, []);

  return (
    <MusicContext.Provider value={{
      playing, track, volume, toggle, cycleTrack, setVolume, selectTrack,
      mixerMode, toggleMixerMode, activeLayers, addLayer, removeLayer, setLayerVolume,
      presets, savePreset, loadPreset, deletePreset,
      youtubeUrl, setYoutubeUrl, youtubePlaying, toggleYoutube,
      audioSource, setAudioSource,
      focusMode, setFocusMode,
    }}>
      {children}
    </MusicContext.Provider>
  );
}

export function useMusic(): MusicContextValue {
  const context = useContext(MusicContext);
  if (!context) throw new Error("useMusic must be used inside <MusicProvider>.");
  return context;
}

// ── YouTube URL parser ────────────────────────────────────────────────

function parseYoutubeUrl(url: string): { videoId: string; listId?: string } | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/playlist\?list=([a-zA-Z0-9_-]+)/,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) {
      const videoId = m[1]!.length === 11 ? m[1] : "";
      const listMatch = url.match(/[?&]list=([a-zA-Z0-9_-]+)/);
      return { videoId: videoId || "", listId: listMatch?.[1] };
    }
  }
  return null;
}

// ── Player bar ────────────────────────────────────────────────────────

export function MusicPlayer() {
  const {
    playing, track, volume, toggle, cycleTrack, setVolume, selectTrack,
    mixerMode, toggleMixerMode, activeLayers, addLayer, removeLayer, setLayerVolume,
    presets, savePreset, loadPreset, deletePreset,
    youtubeUrl, setYoutubeUrl, youtubePlaying, toggleYoutube,
    audioSource, setAudioSource,
  } = useMusic();

  const [expanded, setExpanded] = useState(true);
  const [showMixer, setShowMixer] = useState(false);
  const [showBrowser, setShowBrowser] = useState(false);
  const [showYoutube, setShowYoutube] = useState(false);
  const [presetName, setPresetName] = useState("");
  const [activeCategory, setActiveCategory] = useState<TrackCategory | "All">("All");
  const [timeSuggestion, setTimeSuggestion] = useState<string | null>(null);

  // Time-of-day suggestion (Priority 5)
  useEffect(() => {
    const hour = new Date().getHours();
    if (hour >= 5 && hour < 11) setTimeSuggestion("Energize");
    else if (hour >= 11 && hour < 17) setTimeSuggestion("Focus");
    else if (hour >= 17 && hour < 22) setTimeSuggestion("Classical");
    else setTimeSuggestion("Wind-down");
    // Auto-dismiss after 8 seconds
    const timer = setTimeout(() => setTimeSuggestion(null), 8000);
    return () => clearTimeout(timer);
  }, []);

  const categories: (TrackCategory | "All")[] = ["All", "Focus", "Calm", "Deep Work", "Energize", "Wind-down", "Classical"];
  const filteredTracks = activeCategory === "All" ? TRACKS : TRACKS.filter(t => t.category === activeCategory);
  const ytParsed = youtubeUrl ? parseYoutubeUrl(youtubeUrl) : null;

  return (
    <div
      // Mobile: width-constrained to viewport - 1.5rem, capped at 28rem
      // (max-w-md) so the expanded 2-row layout never overflows. Desktop:
      // sm:w-auto + sm:max-w-none lets the bar grow to its natural content
      // width so all controls (prev/play/next/track-name/visualizer/volume/
      // 3 action buttons/minimize) have proper breathing room on a single row.
      className="fixed bottom-4 left-1/2 z-40 -translate-x-1/2 w-[calc(100vw-1.5rem)] max-w-md sm:w-auto sm:max-w-none"
      data-lenis-prevent-wheel
    >
      {/* Time-of-day suggestion banner */}
      {timeSuggestion && !playing && (
        <div className="mb-2 flex items-center gap-2 rounded-full border border-amber-400/20 bg-amber-400/[0.06] px-3 py-1 text-[11px] text-amber-200">
          {new Date().getHours() < 11 ? <Sun className="size-3" /> : new Date().getHours() < 17 ? <Sparkles className="size-3" /> : new Date().getHours() < 22 ? <Cloud className="size-3" /> : <Moon className="size-3" />}
          <span>Mood suggestion: <strong>{timeSuggestion}</strong></span>
          <button onClick={() => setTimeSuggestion(null)} className="cursor-pointer text-amber-300/60 hover:text-amber-200"><X className="size-3" /></button>
        </div>
      )}

      {/* YouTube embed (hidden when not active) */}
      {audioSource === "youtube" && ytParsed && youtubePlaying && (
        <div className="mb-2 overflow-hidden rounded-lg border border-white/10 bg-black/50">
          <iframe
            src={`https://www.youtube.com/embed/${ytParsed.videoId}?autoplay=1${ytParsed.listId ? `&list=${ytParsed.listId}` : ""}`}
            className="h-20 w-40"
            allow="autoplay; encrypted-media"
            title="YouTube study music"
          />
        </div>
      )}

      {/* Mixer panel */}
      {showMixer && (
        <div className="mb-2 w-80 max-w-[calc(100vw-1.5rem)] rounded-2xl border border-white/10 bg-background/95 p-3 shadow-2xl backdrop-blur-xl" data-lenis-prevent-wheel>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-bold uppercase tracking-wider text-amber-300">Mixer — Layer your sounds</p>
            <button onClick={() => setShowMixer(false)} className="cursor-pointer text-muted-foreground hover:text-foreground"><X className="size-3.5" /></button>
          </div>
          {activeLayers.length === 0 && <p className="py-3 text-center text-[11px] text-muted-foreground">Add tracks from the browser to start mixing.</p>}
          {activeLayers.map((layer, i) => (
            <div key={i} className="mb-1.5 flex items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-2 py-1.5">
              <span className="flex-1 truncate text-[11px] font-semibold">{TRACKS.find(t => t.id === layer.trackId)?.label ?? layer.trackId}</span>
              <input type="range" min={0} max={1} step={0.01} value={layer.volume} onChange={(e) => setLayerVolume(i, Number(e.target.value))} className="h-1 w-16 cursor-pointer accent-[var(--primary)]" />
              <button onClick={() => removeLayer(i)} className="cursor-pointer text-muted-foreground hover:text-rose-300"><Trash2 className="size-3" /></button>
            </div>
          ))}
          {/* Preset controls */}
          {activeLayers.length > 0 && (
            <div className="mt-2 flex items-center gap-1.5 border-t border-white/[0.06] pt-2">
              <input type="text" value={presetName} onChange={(e) => setPresetName(e.target.value)} placeholder="Preset name" className="h-7 flex-1 rounded-lg bg-white/5 px-2 text-[11px]" />
              <button onClick={() => { if (presetName.trim()) { savePreset(presetName.trim()); setPresetName(""); } }} className="cursor-pointer rounded-lg bg-primary/10 px-2 py-1 text-[11px] font-semibold text-primary hover:bg-primary/20"><Save className="size-3" /></button>
            </div>
          )}
          {presets.length > 0 && (
            <div className="mt-2 space-y-1">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Saved presets</p>
              {presets.map(p => (
                <div key={p.id} className="flex items-center gap-2 rounded-lg border border-white/[0.04] px-2 py-1">
                  <button onClick={() => loadPreset(p)} className="flex-1 cursor-pointer text-left text-[11px] font-semibold hover:text-amber-300">{p.name}</button>
                  <span className="text-[9px] text-muted-foreground">{p.layers.length} layers</span>
                  <button onClick={() => deletePreset(p.id)} className="cursor-pointer text-muted-foreground hover:text-rose-300"><Trash2 className="size-2.5" /></button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Track browser */}
      {showBrowser && (
        <div className="mb-2 max-h-64 w-80 max-w-[calc(100vw-1.5rem)] overflow-y-auto rounded-2xl border border-white/10 bg-background/95 p-3 shadow-2xl backdrop-blur-xl" data-lenis-prevent-wheel>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-bold uppercase tracking-wider text-amber-300">Browse tracks</p>
            <button onClick={() => setShowBrowser(false)} className="cursor-pointer text-muted-foreground hover:text-foreground"><X className="size-3.5" /></button>
          </div>
          {/* Category filter */}
          <div className="mb-2 flex flex-wrap gap-1">
            {categories.map(cat => (
              <button key={cat} onClick={() => setActiveCategory(cat)} className={cn("rounded-lg px-2 py-0.5 text-[10px] font-semibold transition", activeCategory === cat ? "bg-primary/15 text-primary" : "bg-white/5 text-muted-foreground hover:text-foreground")}>
                {cat}
              </button>
            ))}
          </div>
          {/* Track list */}
          <div className="space-y-1">
            {filteredTracks.map(t => (
              <div key={t.id} className="group flex items-center gap-2 rounded-lg border border-white/[0.04] px-2 py-1.5 hover:border-primary/20 hover:bg-white/[0.03]">
                <button onClick={() => { selectTrack(t.id); setShowBrowser(false); }} className="flex-1 cursor-pointer text-left">
                  <p className="text-[11px] font-semibold">{t.label}</p>
                  <p className="truncate text-[9px] text-muted-foreground">{t.hint}</p>
                </button>
                <span className="rounded-md border border-white/10 bg-white/5 px-1 text-[8px] font-semibold uppercase text-muted-foreground">{t.category}</span>
                {mixerMode && (
                  <button onClick={() => addLayer(t.id)} className="cursor-pointer rounded-md bg-primary/10 p-1 text-primary hover:bg-primary/20" title="Add to mixer"><Plus className="size-3" /></button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* YouTube panel */}
      {showYoutube && (
        <div className="mb-2 w-80 max-w-[calc(100vw-1.5rem)] rounded-2xl border border-white/10 bg-background/95 p-3 shadow-2xl backdrop-blur-xl" data-lenis-prevent-wheel>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-bold uppercase tracking-wider text-amber-300">YouTube study music</p>
            <button onClick={() => setShowYoutube(false)} className="cursor-pointer text-muted-foreground hover:text-foreground"><X className="size-3.5" /></button>
          </div>
          <input type="text" value={youtubeUrl} onChange={(e) => setYoutubeUrl(e.target.value)} placeholder="Paste a YouTube URL…" className="h-8 w-full rounded-lg bg-white/5 px-2 text-[11px]" />
          <p className="mt-1.5 text-[10px] text-muted-foreground">Paste any public YouTube video or playlist URL. Audio plays through YouTube's own player — we never store or host the audio.</p>
          {youtubeUrl && !ytParsed && <p className="mt-1 text-[10px] text-rose-300">Could not parse that URL. Try a standard youtube.com/watch or youtu.be link.</p>}
        </div>
      )}

      {/* Main player bar — responsive: wraps to 2 rows on mobile, single row on desktop.
          Layout breakdown:
            • Mobile collapsed: [icon + "vibe"/track-label] pill — fits viewport
            • Mobile expanded: row 1 = [prev][play][next][track-name][minimize],
                                row 2 = [volume-slider-flex-1][browse][mixer][youtube]
            • Desktop collapsed: same as mobile
            • Desktop expanded: single row with everything inline (no wrapping).
              gap-3 (desktop) gives comfortable breathing room between the play
              cluster + track name + volume cluster + action cluster — wider
              than mobile's gap-2.5 to avoid visual cramping on wide screens. */}
      <div
        className={cn(
          "glass-panel flex items-center gap-2.5 rounded-2xl px-3 py-2 transition-all duration-300 sm:gap-3 sm:px-4 sm:rounded-full sm:flex-nowrap flex-wrap",
          !expanded && "cursor-pointer flex-nowrap rounded-full",
        )}
      >
        {expanded ? (
          <>
            {/* Essential controls — always visible, never wrap apart */}
            <button type="button" onClick={() => cycleTrack(-1)} aria-label="Previous track" className="flex size-10 min-h-10 min-w-10 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground">
              <ChevronDown className="size-4 rotate-90" />
            </button>
            <button type="button" onClick={toggle} aria-label={playing ? "Pause" : "Play"} className="flex size-10 min-h-10 min-w-10 shrink-0 cursor-pointer items-center justify-center rounded-full bg-primary text-primary-foreground shadow-[0_0_20px_-4px_var(--primary)] transition-transform hover:scale-105 active:scale-95">
              {playing ? <Pause className="size-4" /> : <Play className="size-4 translate-x-px" />}
            </button>
            <button type="button" onClick={() => cycleTrack(1)} aria-label="Next track" className="flex size-10 min-h-10 min-w-10 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground">
              <ChevronUp className="size-4 rotate-90" />
            </button>

            {/* Track name — flex-1 so it takes available space and truncates */}
            <div className="min-w-0 flex-1 select-none px-1">
              <p className="flex items-center gap-1.5 text-xs font-bold tracking-tight">
                <AudioLines className={cn("size-3.5 shrink-0 text-primary", playing && "animate-pulse")} />
                <span className="truncate">
                  {audioSource === "youtube" ? "YouTube" : track.label}
                </span>
                {track.category !== "Classical" && (
                  <span className="hidden shrink-0 rounded-md border border-white/10 bg-white/5 px-1 py-px font-mono text-[8px] font-semibold uppercase tracking-wider text-muted-foreground sm:inline">{track.category}</span>
                )}
              </p>
              <p className="truncate font-mono text-[9px] text-muted-foreground">
                {audioSource === "youtube" ? "external stream" : playing ? track.hint : "vibe · tap to play"}
              </p>
            </div>

            {/* Desktop-only inline: visualizer + volume slider.
                Hidden on mobile — moves to mobile-only second row below.
                pl-2 separates the volume cluster from the truncated track
                name with visible breathing room (prevents cramping). */}
            <div className="hidden items-center gap-1.5 pl-2 sm:flex">
              {playing && (
                <div className="flex items-center gap-0.5 px-1">
                  {[0, 1, 2, 3].map(i => (
                    <span key={i} className="w-0.5 rounded-full bg-primary/60" style={{ animation: `pulse ${0.4 + i * 0.15}s ease-in-out ${i * 0.1}s infinite alternate`, height: `${4 + (i % 2) * 4}px` }} />
                  ))}
                </div>
              )}
              <Volume2 className="size-3.5 text-muted-foreground" />
              <input type="range" min={0} max={1} step={0.01} value={volume} onChange={(e) => setVolume(Number(e.target.value))} aria-label="Volume" className="h-1 w-20 cursor-pointer accent-[var(--primary)]" />
            </div>

            {/* Action buttons — desktop inline. Grouped in their own flex
                container with gap-1 so the cluster reads as one unit, with
                a left border separator to visually distinguish from the
                volume cluster. The parent's gap-3 still applies between
                this group and its siblings. */}
            <div className="hidden items-center gap-1 border-l border-white/10 pl-2 sm:flex">
              <button onClick={() => { setShowBrowser(s => !s); setShowMixer(false); setShowYoutube(false); }} title="Browse tracks" className={cn("flex size-7 cursor-pointer items-center justify-center rounded-full transition-colors", showBrowser ? "text-primary" : "text-muted-foreground hover:text-foreground")}>
                <AudioLines className="size-3.5" />
              </button>
              <button onClick={() => { setShowMixer(s => !s); setShowBrowser(false); setShowYoutube(false); }} title="Mixer mode" className={cn("flex size-7 cursor-pointer items-center justify-center rounded-full transition-colors", showMixer ? "text-primary" : "text-muted-foreground hover:text-foreground")}>
                <Layers className="size-3.5" />
              </button>
              <button onClick={() => { setShowYoutube(s => !s); setShowBrowser(false); setShowMixer(false); }} title="YouTube" className={cn("flex size-7 cursor-pointer items-center justify-center rounded-full transition-colors", showYoutube ? "text-rose-400" : "text-muted-foreground hover:text-foreground")}>
                <Youtube className="size-3.5" />
              </button>
            </div>

            {/* Minimize — always visible, sits at the end of row 1 on mobile */}
            <button type="button" onClick={() => setExpanded(false)} aria-label="Minimize" className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground sm:ml-0 ml-auto">
              <ChevronDown className="size-4" />
            </button>

            {/* Mobile-only second row — volume slider takes available width,
                action buttons sit at the right. Replaces the desktop inline
                controls that don't fit on a narrow screen. */}
            <div className="flex w-full items-center gap-2 border-t border-white/10 pt-2 sm:hidden">
              <Volume2 className="size-3.5 shrink-0 text-muted-foreground" />
              <input type="range" min={0} max={1} step={0.01} value={volume} onChange={(e) => setVolume(Number(e.target.value))} aria-label="Volume" className="h-1 min-w-0 flex-1 cursor-pointer accent-[var(--primary)]" />
              <button onClick={() => { setShowBrowser(s => !s); setShowMixer(false); setShowYoutube(false); }} title="Browse tracks" className={cn("flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-full transition-colors", showBrowser ? "text-primary" : "text-muted-foreground hover:text-foreground")}>
                <AudioLines className="size-3.5" />
              </button>
              <button onClick={() => { setShowMixer(s => !s); setShowBrowser(false); setShowYoutube(false); }} title="Mixer mode" className={cn("flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-full transition-colors", showMixer ? "text-primary" : "text-muted-foreground hover:text-foreground")}>
                <Layers className="size-3.5" />
              </button>
              <button onClick={() => { setShowYoutube(s => !s); setShowBrowser(false); setShowMixer(false); }} title="YouTube" className={cn("flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-full transition-colors", showYoutube ? "text-rose-400" : "text-muted-foreground hover:text-foreground")}>
                <Youtube className="size-3.5" />
              </button>
            </div>
          </>
        ) : (
          <button type="button" onClick={() => setExpanded(true)} aria-label="Open music player" className="flex cursor-pointer items-center gap-2 px-1">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
              <AudioLines className="size-4" />
            </span>
            <span className="truncate font-mono text-[10px] font-semibold text-muted-foreground">
              {audioSource === "youtube" ? "YouTube" : playing ? track.label : "vibe"}
            </span>
          </button>
        )}
      </div>
      <span className="sr-only" aria-live="polite">
        {audioSource === "youtube" ? (youtubePlaying ? "YouTube playing" : "YouTube paused") : playing ? `Playing ${track.label}` : "Music paused"}
      </span>
    </div>
  );
}
