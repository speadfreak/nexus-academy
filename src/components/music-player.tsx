// Study-vibe ambient player.
//
// Tracks are synthesized in-browser with the Web Audio API (filtered noise for
// rain, detuned oscillators for the focus drone). No external audio files are
// required, so nothing can 404 and there is no licensing surface. If you want
// real lo-fi tracks later, upload MP3s to R2 and add them to the TRACKS list
// below with a `url` field — the engine falls back to synthesis when absent.
//
// Defaults: OFF on first visit (no autoplay), volume 0.55. State (track +
// volume) persists in localStorage; the provider lives at the app root so play
// state survives route changes.

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
  Pause,
  Play,
  Volume2,
} from "lucide-react";
import { cn } from "@/lib/utils";

type TrackId = "rain" | "focus" | "breeze" | "white" | "brown" | "night" | "binaural";

type TrackCategory = "Focus" | "Calm" | "Deep Work";

interface Track {
  id: TrackId;
  label: string;
  hint: string;
  category: TrackCategory;
  url?: string; // optional R2-hosted audio file; synthesis is used when absent
}

const TRACKS: Track[] = [
  { id: "focus", label: "Deep Focus", hint: "warm analog drone", category: "Focus" },
  { id: "binaural", label: "Binaural Tone", hint: "soft 4 Hz beat — wear headphones", category: "Focus" },
  { id: "rain", label: "Rain", hint: "soft rain on a tin roof", category: "Calm" },
  { id: "breeze", label: "Breeze", hint: "air through an open window", category: "Calm" },
  { id: "night", label: "Night", hint: "quiet room, distant crickets", category: "Calm" },
  { id: "white", label: "White Noise", hint: "flat, steady, detail-friendly", category: "Deep Work" },
  { id: "brown", label: "Brown Noise", hint: "deep rumble, low distraction", category: "Deep Work" },
];

interface MusicContextValue {
  playing: boolean;
  track: Track;
  volume: number;
  toggle: () => void;
  cycleTrack: (direction: 1 | -1) => void;
  setVolume: (volume: number) => void;
}

const MusicContext = createContext<MusicContextValue | null>(null);

const STORAGE_KEY = "nexus-music";

function readStored(): { trackId: TrackId; volume: number } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { trackId?: TrackId; volume?: number };
      const trackId = TRACKS.some((t) => t.id === parsed.trackId)
        ? (parsed.trackId as TrackId)
        : "rain";
      const volume =
        typeof parsed.volume === "number" &&
        parsed.volume >= 0 &&
        parsed.volume <= 1
          ? parsed.volume
          : 0.55;
      return { trackId, volume };
    }
  } catch {
    // ignore
  }
  return { trackId: "rain", volume: 0.55 };
}

// ---------------------------------------------------------------------------
// Web Audio engine — built lazily on first play (autoplay policies require a
// user gesture, so this is created inside the play click handler).
// ---------------------------------------------------------------------------

class AmbientEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private nodes: AudioNode[] = [];
  private lfos: OscillatorNode[] = [];
  private source: AudioBufferSourceNode | null = null;

  private ensureContext(volume: number): AudioContext {
    if (!this.ctx) {
      const Ctx =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
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
    for (let i = 0; i < length; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    return buffer;
  }

  private addLfo(frequency: number, depth: number, target: AudioParam) {
    if (!this.ctx) return;
    const lfo = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    lfo.frequency.value = frequency;
    gain.gain.value = depth;
    lfo.connect(gain);
    gain.connect(target);
    lfo.start();
    this.lfos.push(lfo);
  }

  start(trackId: TrackId, volume: number) {
    this.stop();
    const ctx = this.ensureContext(volume);
    if (!this.master) return;
    const out = this.master;

    if (trackId === "rain") {
      const source = ctx.createBufferSource();
      source.buffer = this.noiseBuffer(ctx);
      source.loop = true;
      const lowpass = ctx.createBiquadFilter();
      lowpass.type = "lowpass";
      lowpass.frequency.value = 850;
      lowpass.Q.value = 0.4;
      const gain = ctx.createGain();
      gain.gain.value = 0.28;
      source.connect(lowpass);
      lowpass.connect(gain);
      gain.connect(out);
      source.start();
      this.source = source;
      this.nodes.push(lowpass, gain);
      this.addLfo(0.14, 0.07, gain.gain);
    } else if (trackId === "focus") {
      const freqs = [110, 165.4, 220.6];
      const gain = ctx.createGain();
      gain.gain.value = 0.16;
      const lowpass = ctx.createBiquadFilter();
      lowpass.type = "lowpass";
      lowpass.frequency.value = 760;
      lowpass.Q.value = 0.6;
      for (const freq of freqs) {
        const osc = ctx.createOscillator();
        osc.type = freq === 220.6 ? "triangle" : "sine";
        osc.frequency.value = freq;
        osc.detune.value = (Math.random() - 0.5) * 6;
        osc.connect(lowpass);
        osc.start();
        this.nodes.push(osc);
      }
      lowpass.connect(gain);
      gain.connect(out);
      this.nodes.push(lowpass, gain);
      this.addLfo(0.09, 0.05, gain.gain);
    } else if (trackId === "breeze") {
      // breeze — filtered noise, gentler and airier than rain
      const source = ctx.createBufferSource();
      source.buffer = this.noiseBuffer(ctx);
      source.loop = true;
      const bandpass = ctx.createBiquadFilter();
      bandpass.type = "bandpass";
      bandpass.frequency.value = 480;
      bandpass.Q.value = 0.5;
      const lowpass = ctx.createBiquadFilter();
      lowpass.type = "lowpass";
      lowpass.frequency.value = 1400;
      const gain = ctx.createGain();
      gain.gain.value = 0.2;
      source.connect(bandpass);
      bandpass.connect(lowpass);
      lowpass.connect(gain);
      gain.connect(out);
      source.start();
      this.source = source;
      this.nodes.push(bandpass, lowpass, gain);
      this.addLfo(0.2, 0.06, gain.gain);
    } else if (trackId === "white") {
      // white noise — full spectrum with a gentle highpass so it's steady
      // without being harsh
      const source = ctx.createBufferSource();
      source.buffer = this.noiseBuffer(ctx);
      source.loop = true;
      const highpass = ctx.createBiquadFilter();
      highpass.type = "highpass";
      highpass.frequency.value = 120;
      const gain = ctx.createGain();
      gain.gain.value = 0.14;
      source.connect(highpass);
      highpass.connect(gain);
      gain.connect(out);
      source.start();
      this.source = source;
      this.nodes.push(highpass, gain);
      this.addLfo(0.07, 0.025, gain.gain);
    } else if (trackId === "brown") {
      // brown noise — heavy lowpass on noise reads as a deep rumble,
      // the classic "covers everything" study sound
      const source = ctx.createBufferSource();
      source.buffer = this.noiseBuffer(ctx);
      source.loop = true;
      const lowpass = ctx.createBiquadFilter();
      lowpass.type = "lowpass";
      lowpass.frequency.value = 210;
      lowpass.Q.value = 0.3;
      const gain = ctx.createGain();
      gain.gain.value = 0.3;
      source.connect(lowpass);
      lowpass.connect(gain);
      gain.connect(out);
      source.start();
      this.source = source;
      this.nodes.push(lowpass, gain);
      this.addLfo(0.05, 0.04, gain.gain);
    } else if (trackId === "night") {
      // night — low room-noise bed plus a faint cricket chirp (a quiet
      // high sine with fast amplitude modulation), barely there
      const source = ctx.createBufferSource();
      source.buffer = this.noiseBuffer(ctx);
      source.loop = true;
      const lowpass = ctx.createBiquadFilter();
      lowpass.type = "lowpass";
      lowpass.frequency.value = 620;
      const bedGain = ctx.createGain();
      bedGain.gain.value = 0.16;
      source.connect(lowpass);
      lowpass.connect(bedGain);
      bedGain.connect(out);
      source.start();
      this.source = source;
      this.nodes.push(lowpass, bedGain);
      this.addLfo(0.09, 0.03, bedGain.gain);

      const cricket = ctx.createOscillator();
      cricket.type = "sine";
      cricket.frequency.value = 4100;
      const cricketGain = ctx.createGain();
      cricketGain.gain.value = 0.004;
      cricket.connect(cricketGain);
      cricketGain.connect(out);
      cricket.start();
      this.nodes.push(cricket, cricketGain);
      this.addLfo(22, 0.0038, cricketGain.gain);
    } else {
      // binaural-style — two close sines (200 + 204 Hz) create a soft
      // 4 Hz beating tone; panned slightly for a headphone-friendly width.
      // A true binaural beat needs separate L/R channels; this is the
      // synthesized approximation, safe on speakers too.
      const left = ctx.createOscillator();
      left.type = "sine";
      left.frequency.value = 200;
      const right = ctx.createOscillator();
      right.type = "sine";
      right.frequency.value = 204;
      const panner = ctx.createStereoPanner();
      panner.pan.value = 0;
      const sum = ctx.createGain();
      sum.gain.value = 0.07;
      const lowpass = ctx.createBiquadFilter();
      lowpass.type = "lowpass";
      lowpass.frequency.value = 900;
      left.connect(lowpass);
      right.connect(lowpass);
      lowpass.connect(sum);
      sum.connect(panner);
      panner.connect(out);
      left.start();
      right.start();
      this.nodes.push(left, right, lowpass, sum, panner);
      this.addLfo(0.12, 0.01, sum.gain);
    }
  }

  setVolume(volume: number) {
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(volume, this.ctx.currentTime, 0.05);
    }
  }

  stop() {
    for (const lfo of this.lfos) {
      try {
        lfo.stop();
      } catch {
        // already stopped
      }
      lfo.disconnect();
    }
    this.lfos = [];
    if (this.source) {
      try {
        this.source.stop();
      } catch {
        // already stopped
      }
      this.source.disconnect();
      this.source = null;
    }
    for (const node of this.nodes) {
      try {
        node.disconnect();
      } catch {
        // ignore
      }
    }
    this.nodes = [];
  }
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function MusicProvider({ children }: { children: ReactNode }) {
  const stored = useRef(readStored());
  const [playing, setPlaying] = useState(false);
  const [trackId, setTrackId] = useState<TrackId>(stored.current.trackId);
  const [volume, setVolumeState] = useState(stored.current.volume);
  const engineRef = useRef<AmbientEngine | null>(null);

  const getEngine = () => {
    if (!engineRef.current) engineRef.current = new AmbientEngine();
    return engineRef.current;
  };

  const track = TRACKS.find((t) => t.id === trackId) ?? TRACKS[0]!;

  const persist = (nextTrackId: TrackId, nextVolume: number) => {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ trackId: nextTrackId, volume: nextVolume }),
      );
    } catch {
      // ignore
    }
  };

  const toggle = useCallback(() => {
    if (!playing) {
      // User gesture — safe to create/resume the AudioContext here.
      getEngine().start(trackId, volume);
      setPlaying(true);
    } else {
      getEngine().stop();
      setPlaying(false);
    }
  }, [playing, trackId, volume]);

  const cycleTrack = useCallback(
    (direction: 1 | -1) => {
      const index = TRACKS.findIndex((t) => t.id === trackId);
      const next = TRACKS[(index + direction + TRACKS.length) % TRACKS.length]!;
      setTrackId(next.id);
      persist(next.id, volume);
      if (playing) getEngine().start(next.id, volume);
    },
    [trackId, volume, playing],
  );

  const setVolume = useCallback(
    (next: number) => {
      setVolumeState(next);
      persist(trackId, next);
      if (playing) getEngine().setVolume(next);
    },
    [trackId, playing],
  );

  // Never autoplay: playing only becomes true via the toggle click. Stop the
  // engine on unmount so audio never leaks after sign-out.
  useEffect(() => {
    return () => {
      engineRef.current?.stop();
    };
  }, []);

  return (
    <MusicContext.Provider
      value={{ playing, track, volume, toggle, cycleTrack, setVolume }}
    >
      {children}
    </MusicContext.Provider>
  );
}

export function useMusic(): MusicContextValue {
  const context = useContext(MusicContext);
  if (!context) {
    throw new Error("useMusic must be used inside <MusicProvider>.");
  }
  return context;
}

// ---------------------------------------------------------------------------
// Player bar — rendered once at the app root, visible across all pages.
// ---------------------------------------------------------------------------

export function MusicPlayer() {
  const { playing, track, volume, toggle, cycleTrack, setVolume } = useMusic();
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="fixed bottom-4 left-1/2 z-40 -translate-x-1/2">
      <div
        className={cn(
          "glass-panel flex items-center gap-2.5 rounded-full px-3 py-2 transition-all duration-300",
          !expanded && "cursor-pointer",
        )}
      >
        {expanded ? (
          <>
            <button
              type="button"
              onClick={() => cycleTrack(-1)}
              aria-label="Previous track"
              className="flex size-10 min-h-10 min-w-10 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground"
            >
              <ChevronDown className="size-4 rotate-90" />
            </button>

            <button
              type="button"
              onClick={toggle}
              aria-label={playing ? "Pause music" : "Play music"}
              className="flex size-10 min-h-10 min-w-10 cursor-pointer items-center justify-center rounded-full bg-primary text-primary-foreground shadow-[0_0_20px_-4px_var(--primary)] transition-transform hover:scale-105 active:scale-95"
            >
              {playing ? (
                <Pause className="size-4" />
              ) : (
                <Play className="size-4 translate-x-px" />
              )}
            </button>

            <button
              type="button"
              onClick={() => cycleTrack(1)}
              aria-label="Next track"
              className="flex size-10 min-h-10 min-w-10 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground"
            >
              <ChevronUp className="size-4 rotate-90" />
            </button>

            <div className="min-w-28 select-none px-1">
              <p className="flex items-center gap-1.5 text-xs font-bold tracking-tight">
                <AudioLines
                  className={cn("size-3.5 text-primary", playing && "animate-pulse")}
                />
                {track.label}
                <span className="rounded-md border border-white/10 bg-white/5 px-1 py-px font-mono text-[8px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {track.category}
                </span>
              </p>
              <p className="truncate font-mono text-[9px] text-muted-foreground">
                {playing ? track.hint : "vibe · tap to play"}
              </p>
            </div>

            <div className="flex items-center gap-1.5 pl-1">
              <Volume2 className="size-3.5 text-muted-foreground" />
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={volume}
                onChange={(e) => setVolume(Number(e.target.value))}
                aria-label="Volume"
                className="h-1 w-20 cursor-pointer accent-[var(--primary)]"
              />
            </div>

            <button
              type="button"
              onClick={() => setExpanded(false)}
              aria-label="Minimize music player"
              className="flex size-7 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground"
            >
              <ChevronDown className="size-4" />
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            aria-label="Open music player"
            className="flex cursor-pointer items-center gap-2 px-1"
          >
            <span className="flex size-8 items-center justify-center rounded-full bg-primary/15 text-primary">
              <AudioLines className="size-4" />
            </span>
            <span className="font-mono text-[10px] font-semibold text-muted-foreground">
              {playing ? track.label : "vibe"}
            </span>
          </button>
        )}
      </div>
      <span className="sr-only" aria-live="polite">
        {playing ? `Playing ${track.label}` : "Music paused"}
      </span>
    </div>
  );
}
