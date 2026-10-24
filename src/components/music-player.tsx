// LEARNYX FLOWSTATE — study-audio context & provider.
//
// The floating player's VISUAL IDENTITY lives in ./music/MusicPlayerUI.tsx
// (the capsule markup is unchanged there). This file owns the STATE and the
// single audio engine contract:
//
//   - ONE engine (FlowEngine, src/lib/audio/flowEngine.ts) — no competing
//     audio code anywhere in the app. Reader's StudySoundtrack and the
//     Focus page all consume THIS context.
//   - Play state survives route changes because the provider sits at the
//     app root (main.tsx), above <BrowserRouter>.
//   - Defaults: OFF on first visit (no autoplay), volume 0.55. Track +
//     volume + last active mix persist in localStorage and are restored —
//     never auto-played.
//   - The vault (Sound Vault) adds favorites + recently played, stored
//     locally. Scenes ("rituals") are one-tap atmospheres the Focus page
//     can auto-apply; auto-scene is opt-out and respects autoplay rules.
//
// CRITICAL PRINCIPLE (unchanged): no user-uploaded or third-party audio is
// ever stored or hosted. All sounds are synthesized live in the browser
// from code, or sequenced from public-domain compositions.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { FlowEngine, EQ_PRESETS, type EqPreset } from "@/lib/audio/flowEngine";
import {
  DEFAULT_TRACK_ID,
  SCENES,
  TRACKS,
  getTrack,
  isKnownTrack,
  type Scene,
  type SoundCategory,
  type TrackMeta,
} from "@/lib/audio/tracks";

export type { TrackMeta, SoundCategory, Scene, EqPreset };
export { TRACKS, SCENES, EQ_PRESETS, getTrack };

export type FocusSyncMode = "work" | "break" | "idle";
export type FocusSessionMode = "sprint" | "pomodoro" | "deep_work" | "custom" | "break";

interface MixLayer {
  trackId: string;
  volume: number; // 0-1
}

interface MixPreset {
  id: string;
  name: string;
  layers: MixLayer[];
}

interface LayerAudioState {
  mute: boolean;
  solo: boolean;
}

export interface MusicContextValue {
  playing: boolean;
  track: TrackMeta;
  volume: number;
  toggle: () => void;
  cycleTrack: (direction: 1 | -1) => void;
  setVolume: (volume: number) => void;
  selectTrack: (trackId: string) => void;
  // Mute (distinct from pause — instant level 0)
  muted: boolean;
  toggleMute: () => void;
  // Mixer mode
  mixerMode: boolean;
  toggleMixerMode: () => void;
  activeLayers: MixLayer[];
  layerStates: LayerAudioState[];
  addLayer: (trackId: string) => void;
  removeLayer: (index: number) => void;
  setLayerVolume: (index: number, volume: number) => void;
  setLayerMute: (index: number, mute: boolean) => void;
  setLayerSolo: (index: number, solo: boolean) => void;
  // Mix recipes (saved mixes)
  presets: MixPreset[];
  savePreset: (name: string) => void;
  renamePreset: (id: string, name: string) => void;
  loadPreset: (preset: MixPreset) => void;
  deletePreset: (id: string) => void;
  // Sound Vault
  favorites: string[];
  toggleFavorite: (trackId: string) => void;
  recent: string[];
  // Studio controls
  eqPreset: EqPreset;
  setEq: (preset: EqPreset) => void;
  fadeSeconds: number;
  setFade: (seconds: number) => void;
  pan: number;
  setPan: (pan: number) => void;
  sleepMinutes: number;
  setSleepMinutes: (minutes: number) => void;
  sleepActive: boolean;
  ducking: boolean;
  setDucking: (active: boolean) => void;
  getOutputStatus: () => { supported: boolean; state: string; sampleRate: number | null; baseLatencyMs: number | null };
  audioSupported: boolean;
  // Scenes / rituals
  activeSceneId: string | null;
  applyScene: (sceneId: string) => void;
  autoScene: boolean;
  setAutoScene: (enabled: boolean) => void;
  sceneForMode: (mode: FocusSessionMode) => string | null;
  setSceneForMode: (mode: FocusSessionMode, sceneId: string | null) => void;
  // YouTube
  youtubeUrl: string;
  setYoutubeUrl: (url: string) => void;
  youtubePlaying: boolean;
  toggleYoutube: () => void;
  audioSource: "synth" | "youtube";
  setAudioSource: (source: "synth" | "youtube") => void;
  // Focus-timer sync
  focusMode: FocusSyncMode;
  setFocusMode: (mode: FocusSyncMode) => void;
}

const MusicContext = createContext<MusicContextValue | null>(null);

const STORAGE_KEY = "learnyx-music";
const PRESETS_KEY = "learnyx-mix-presets";
const VAULT_KEY = "learnyx-flowstate-vault";
const RITUALS_KEY = "learnyx-flowstate-rituals";

// ── Storage helpers ───────────────────────────────────────────────────

interface StoredMusic {
  trackId: string;
  volume: number;
  layers?: MixLayer[];
  mixerMode?: boolean;
}

function readStored(): StoredMusic {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<StoredMusic>;
      const trackId = isKnownTrack(parsed.trackId ?? "") ? parsed.trackId! : DEFAULT_TRACK_ID;
      const volume =
        typeof parsed.volume === "number" && parsed.volume >= 0 && parsed.volume <= 1
          ? parsed.volume
          : 0.55;
      const layers = Array.isArray(parsed.layers)
        ? parsed.layers.filter(
            (l): l is MixLayer =>
              !!l && isKnownTrack(l.trackId) && typeof l.volume === "number" && l.volume >= 0 && l.volume <= 1,
          )
        : [];
      return {
        trackId,
        volume,
        layers: layers.slice(0, 4),
        mixerMode: parsed.mixerMode === true && layers.length > 0,
      };
    }
  } catch {
    /* ignore corrupted storage */
  }
  return { trackId: DEFAULT_TRACK_ID, volume: 0.55 };
}

function readPresets(): MixPreset[] {
  try {
    const raw = localStorage.getItem(PRESETS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as MixPreset[];
      return Array.isArray(parsed)
        ? parsed
            .filter((p): p is MixPreset => !!p && typeof p.name === "string" && Array.isArray(p.layers))
            .map((p) => ({
              ...p,
              layers: p.layers.filter((l) => isKnownTrack(l.trackId)).slice(0, 4),
            }))
            .slice(0, 24)
        : [];
    }
  } catch {
    /* ignore */
  }
  return [];
}

function readVaultPrefs(): { favorites: string[]; recent: string[] } {
  try {
    const raw = localStorage.getItem(VAULT_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { favorites?: unknown; recent?: unknown };
      const valid = (arr: unknown): string[] =>
        Array.isArray(arr) ? arr.filter((id): id is string => typeof id === "string" && isKnownTrack(id)) : [];
      return {
        favorites: valid(parsed.favorites).slice(0, 12),
        recent: valid(parsed.recent).slice(0, 8),
      };
    }
  } catch {
    /* ignore */
  }
  return { favorites: [], recent: [] };
}

export interface RitualPrefs {
  autoScene: boolean;
  byMode: Partial<Record<FocusSessionMode, string | null>>;
}

const DEFAULT_RITUALS: RitualPrefs = {
  autoScene: false,
  byMode: {
    sprint: "deep_work",
    pomodoro: "revision",
    deep_work: "deep_work",
    custom: null,
    break: "forest_break",
  },
};

function readRituals(): RitualPrefs {
  try {
    const raw = localStorage.getItem(RITUALS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<RitualPrefs>;
      const byMode: RitualPrefs["byMode"] = {};
      for (const [mode, sceneId] of Object.entries(parsed.byMode ?? {})) {
        if (sceneId === null || (typeof sceneId === "string" && SCENES.some((s) => s.id === sceneId))) {
          byMode[mode as FocusSessionMode] = sceneId;
        }
      }
      return { autoScene: parsed.autoScene === true, byMode };
    }
  } catch {
    /* ignore */
  }
  return DEFAULT_RITUALS;
}

// ── Provider ──────────────────────────────────────────────────────────

export function MusicProvider({ children }: { children: ReactNode }) {
  const stored = useRef(readStored());
  const [playing, setPlaying] = useState(false); // never autoplay
  const [trackId, setTrackId] = useState(stored.current.trackId);
  const [volume, setVolumeState] = useState(stored.current.volume);
  const [muted, setMuted] = useState(false);
  const engineRef = useRef<FlowEngine | null>(null);

  // Mixer state — restored from the last active mix.
  const [mixerMode, setMixerMode] = useState(stored.current.mixerMode ?? false);
  const [activeLayers, setActiveLayers] = useState<MixLayer[]>(stored.current.layers ?? []);
  const [layerStates, setLayerStates] = useState<LayerAudioState[]>(
    (stored.current.layers ?? []).map(() => ({ mute: false, solo: false })),
  );
  const [presets, setPresets] = useState<MixPreset[]>(() => readPresets());

  // Sound Vault prefs
  const [vaultPrefs, setVaultPrefs] = useState(() => readVaultPrefs());

  // Studio controls
  const [eqPreset, setEqPreset] = useState<EqPreset>("flat");
  const [fadeSeconds, setFadeSeconds] = useState(0.8);
  const [pan, setPanState] = useState(0);
  const [sleepMinutes, setSleepMinutesState] = useState(0);
  const [ducking, setDuckingState] = useState(false);

  // Rituals
  const [rituals, setRituals] = useState<RitualPrefs>(() => readRituals());
  const [activeSceneId, setActiveSceneId] = useState<string | null>(null);

  // YouTube state
  const [youtubeUrl, setYoutubeUrlState] = useState("");
  const [youtubePlaying, setYoutubePlaying] = useState(false);
  const [audioSource, setAudioSource] = useState<"synth" | "youtube">("synth");

  // Focus-timer sync
  const [focusMode, setFocusMode] = useState<FocusSyncMode>("idle");

  const getEngine = useCallback(() => {
    if (!engineRef.current) engineRef.current = new FlowEngine();
    return engineRef.current;
  }, []);

  const track = useMemo(() => getTrack(trackId), [trackId]);

  const persist = useCallback(
    (next: Partial<StoredMusic>) => {
      try {
        const current = readStored();
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...current, ...next }));
      } catch {
        /* ignore */
      }
    },
    [],
  );

  // ── Playback ────────────────────────────────────────────────────────

  const toggle = useCallback(() => {
    if (audioSource === "youtube") {
      setYoutubePlaying((p) => !p);
      return;
    }
    const engine = getEngine();
    if (!playing) {
      if (mixerMode && activeLayers.length > 0) {
        activeLayers.forEach((layer, i) => engine.startMixerLayer(i, layer.trackId, layer.volume));
        engine.setVolume(volume);
      } else {
        engine.playBase(trackId, volume);
      }
      setPlaying(true);
    } else {
      engine.stopAllMixerLayers();
      engine.stopBase();
      setPlaying(false);
    }
  }, [playing, trackId, volume, mixerMode, activeLayers, audioSource, getEngine]);

  const pushRecent = useCallback((id: string) => {
    setVaultPrefs((prev) => {
      const next = {
        favorites: prev.favorites,
        recent: [id, ...prev.recent.filter((r) => r !== id)].slice(0, 8),
      };
      try {
        localStorage.setItem(VAULT_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const cycleTrack = useCallback(
    (direction: 1 | -1) => {
      const index = TRACKS.findIndex((t) => t.id === trackId);
      const next = TRACKS[(index + direction + TRACKS.length) % TRACKS.length]!;
      setTrackId(next.id);
      persist({ trackId: next.id });
      pushRecent(next.id);
      if (playing && !mixerMode) getEngine().playBase(next.id, volume);
    },
    [trackId, volume, playing, mixerMode, persist, pushRecent, getEngine],
  );

  const selectTrack = useCallback(
    (id: string) => {
      if (!isKnownTrack(id)) return;
      setTrackId(id);
      setActiveSceneId(null); // manual choice overrides the scene
      persist({ trackId: id });
      pushRecent(id);
      if (playing && !mixerMode) getEngine().playBase(id, volume);
    },
    [volume, playing, mixerMode, persist, pushRecent, getEngine],
  );

  const setVolume = useCallback(
    (next: number) => {
      setVolumeState(next);
      persist({ volume: next });
      if (playing) getEngine().setVolume(next);
    },
    [playing, persist, getEngine],
  );

  const toggleMute = useCallback(() => {
    setMuted((prev) => {
      const next = !prev;
      getEngine().setMuted(next);
      return next;
    });
  }, [getEngine]);

  // ── Mixer actions ───────────────────────────────────────────────────

  const restartMix = useCallback(
    (layers: MixLayer[], states: LayerAudioState[], masterVolume: number) => {
      const engine = getEngine();
      engine.stopAllMixerLayers(0);
      layers.forEach((layer, i) => engine.startMixerLayer(i, layer.trackId, layer.volume));
      engine.setVolume(masterVolume);
      // Apply mute/solo without double-fading (engine handles gain targets).
      states.forEach((s, i) => {
        if (s.mute) engine.setLayerMute(i, true);
        if (s.solo) engine.setLayerSolo(i, true);
      });
    },
    [getEngine],
  );

  const toggleMixerMode = useCallback(() => {
    setMixerMode((prev) => {
      const next = !prev;
      if (playing) {
        if (next && activeLayers.length > 0) {
          restartMix(activeLayers, layerStates, volume);
          setPlaying(true);
        } else if (!next) {
          getEngine().stopAllMixerLayers();
          getEngine().playBase(trackId, volume);
          setPlaying(true);
        } else {
          getEngine().stopBase();
          setPlaying(false);
        }
      }
      persist({ mixerMode: next });
      return next;
    });
  }, [playing, activeLayers, layerStates, trackId, volume, restartMix, persist, getEngine]);

  const addLayer = useCallback(
    (id: string) => {
      if (!isKnownTrack(id)) return;
      if (activeLayers.length >= 4) return; // engine/UI cap: 1 base + 4 layers
      setActiveLayers((prev) => {
        const next = [...prev, { trackId: id, volume: 0.5 }];
        setLayerStates((s) => [...s, { mute: false, solo: false }]);
        persist({ layers: next, mixerMode: true });
        if (playing) getEngine().startMixerLayer(next.length - 1, id, 0.5);
        return next;
      });
      pushRecent(id);
    },
    [activeLayers.length, playing, persist, pushRecent, getEngine],
  );

  const removeLayer = useCallback(
    (index: number) => {
      const nextLayers = activeLayers.filter((_, i) => i !== index);
      const nextStates = layerStates.filter((_, i) => i !== index);
      setActiveLayers(nextLayers);
      setLayerStates(nextStates);
      persist({ layers: nextLayers, mixerMode: mixerMode && nextLayers.length > 0 });
      if (playing && nextLayers.length > 0) {
        restartMix(nextLayers, nextStates, volume);
      } else if (playing) {
        getEngine().stopAllMixerLayers();
        setMixerMode(false);
        getEngine().playBase(trackId, volume);
      }
    },
    [activeLayers, layerStates, playing, volume, mixerMode, trackId, persist, restartMix, getEngine],
  );

  const setLayerVolume = useCallback(
    (index: number, vol: number) => {
      const clamped = Math.max(0, Math.min(1, vol));
      setActiveLayers((prev) => {
        const next = prev.map((l, i) => (i === index ? { ...l, volume: clamped } : l));
        persist({ layers: next });
        return next;
      });
      getEngine().setLayerVolume(index, clamped);
    },
    [persist, getEngine],
  );

  const setLayerMute = useCallback(
    (index: number, mute: boolean) => {
      setLayerStates((prev) => prev.map((s, i) => (i === index ? { ...s, mute } : s)));
      getEngine().setLayerMute(index, mute);
    },
    [getEngine],
  );

  const setLayerSolo = useCallback(
    (index: number, solo: boolean) => {
      setLayerStates((prev) => {
        // Solo is exclusive: soloing one layer unsolos the others.
        const next = prev.map((s, i) => ({ ...s, solo: i === index ? solo : solo ? false : s.solo }));
        next.forEach((s, i) => getEngine().setLayerSolo(i, s.solo));
        return next;
      });
    },
    [getEngine],
  );

  // ── Mix recipes ─────────────────────────────────────────────────────

  const savePreset = useCallback(
    (name: string) => {
      const preset: MixPreset = {
        id: `preset-${Date.now()}`,
        name: name.slice(0, 40),
        layers: activeLayers.map((l) => ({ ...l })),
      };
      const next = [...presets, preset];
      setPresets(next);
      try {
        localStorage.setItem(PRESETS_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
    },
    [activeLayers, presets],
  );

  const renamePreset = useCallback(
    (id: string, name: string) => {
      const next = presets.map((p) => (p.id === id ? { ...p, name: name.slice(0, 40) } : p));
      setPresets(next);
      try {
        localStorage.setItem(PRESETS_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
    },
    [presets],
  );

  const loadPreset = useCallback(
    (preset: MixPreset) => {
      const layers = preset.layers.slice(0, 4);
      const states = layers.map(() => ({ mute: false, solo: false }));
      setActiveLayers(layers);
      setLayerStates(states);
      setMixerMode(true);
      setActiveSceneId(null);
      persist({ layers, mixerMode: true });
      if (playing) restartMix(layers, states, volume);
    },
    [playing, volume, persist, restartMix],
  );

  const deletePreset = useCallback(
    (id: string) => {
      const next = presets.filter((p) => p.id !== id);
      setPresets(next);
      try {
        localStorage.setItem(PRESETS_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
    },
    [presets],
  );

  // ── Sound Vault prefs ───────────────────────────────────────────────

  const toggleFavorite = useCallback((id: string) => {
    setVaultPrefs((prev) => {
      const favorites = prev.favorites.includes(id)
        ? prev.favorites.filter((f) => f !== id)
        : [...prev.favorites, id].slice(0, 12);
      const next = { favorites, recent: prev.recent };
      try {
        localStorage.setItem(VAULT_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  // ── Studio controls ─────────────────────────────────────────────────

  const setEq = useCallback((preset: EqPreset) => {
    setEqPreset(preset);
    getEngine().setEq(preset);
  }, [getEngine]);

  const setFade = useCallback(
    (seconds: number) => {
      const clamped = Math.max(0, Math.min(8, seconds));
      setFadeSeconds(clamped);
      getEngine().setFade(clamped);
    },
    [getEngine],
  );

  const setPan = useCallback(
    (next: number) => {
      const clamped = Math.max(-1, Math.min(1, next));
      setPanState(clamped);
      getEngine().setPan(clamped);
    },
    [getEngine],
  );

  const setSleepMinutes = useCallback(
    (minutes: number) => {
      setSleepMinutesState(minutes);
      const engine = getEngine();
      if (minutes <= 0) {
        engine.cancelSleepTimer();
        return;
      }
      engine.setSleepTimer(minutes, () => {
        setPlaying(false);
      });
    },
    [getEngine],
  );

  const setDucking = useCallback(
    (active: boolean) => {
      setDuckingState(active);
      getEngine().setDucking(active);
    },
    [getEngine],
  );

  const getOutputStatus = useCallback(() => {
    const status = getEngine().outputStatus();
    return {
      supported: status.supported,
      state: status.state,
      sampleRate: status.sampleRate,
      baseLatencyMs: status.baseLatencyMs,
    };
  }, [getEngine]);

  // ── Scenes / rituals ────────────────────────────────────────────────

  const applyScene = useCallback(
    (sceneId: string) => {
      const scene = SCENES.find((s) => s.id === sceneId);
      if (!scene) return;
      setActiveSceneId(scene.id);
      if (scene.trackId === null) {
        // Silent scene — stop playback (respecting the user's pause button).
        if (playing) {
          getEngine().stopAllMixerLayers();
          getEngine().stopBase();
          setPlaying(false);
        }
        return;
      }
      const layers = scene.layers.slice(0, 4);
      const states = layers.map(() => ({ mute: false, solo: false }));
      setTrackId(scene.trackId);
      setActiveLayers(layers);
      setLayerStates(states);
      setMixerMode(layers.length > 0);
      persist({ trackId: scene.trackId, layers, mixerMode: layers.length > 0 });
      pushRecent(scene.trackId);
      if (playing) {
        if (layers.length > 0) {
          restartMix(layers, states, volume);
        } else {
          getEngine().stopAllMixerLayers();
          getEngine().playBase(scene.trackId, volume);
        }
      }
    },
    [playing, volume, persist, pushRecent, restartMix, getEngine],
  );

  const setAutoScene = useCallback((enabled: boolean) => {
    setRituals((prev) => {
      const next = { ...prev, autoScene: enabled };
      try {
        localStorage.setItem(RITUALS_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const setSceneForMode = useCallback((mode: FocusSessionMode, sceneId: string | null) => {
    setRituals((prev) => {
      const next = { ...prev, byMode: { ...prev.byMode, [mode]: sceneId } };
      try {
        localStorage.setItem(RITUALS_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const sceneForMode = useCallback(
    (mode: FocusSessionMode) => rituals.byMode[mode] ?? null,
    [rituals.byMode],
  );

  // ── YouTube actions ─────────────────────────────────────────────────

  const setYoutubeUrl = useCallback(
    (url: string) => {
      setYoutubeUrlState(url);
      if (url) {
        setAudioSource("youtube");
        if (playing) {
          getEngine().stopAllMixerLayers();
          getEngine().stopBase();
          setPlaying(false);
        }
      }
    },
    [playing, getEngine],
  );

  const toggleYoutube = useCallback(() => {
    setYoutubePlaying((p) => !p);
  }, []);

  // ── Focus-timer fallback sync ───────────────────────────────────────
  // FLOWSTATE rituals (scene-per-mode) are the primary mechanism — the
  // Focus page applies them on session start. This effect is the FALLBACK
  // for students who never enabled a scene: a running timer still shifts
  // wind-down/nature sounds toward focus, and a break shifts focus beds
  // back toward calm. It deliberately does nothing once a scene is active.

  useEffect(() => {
    if (activeSceneId || !playing) return;
    if (focusMode === "work" && (track.category === "Wind-down" || track.category === "Nature" || track.category === "Rain & Weather")) {
      selectTrack("focus");
    } else if (focusMode === "break" && (track.category === "Focus Rituals" || track.category === "Noise")) {
      selectTrack("rain");
    }
  }, [focusMode, playing, track, activeSceneId, selectTrack]);

  // ── OS media integration (lock-screen controls) ─────────────────────

  useEffect(() => {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
    try {
      if (playing && audioSource === "synth") {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: track.label,
          artist: "Learnyx FLOWSTATE",
          album: track.hint,
        });
        navigator.mediaSession.playbackState = "playing";
      } else {
        navigator.mediaSession.playbackState = audioSource === "youtube" && youtubePlaying ? "playing" : "paused";
      }
    } catch {
      /* MediaMetadata unavailable */
    }
  }, [playing, track, audioSource, youtubePlaying]);

  useEffect(() => {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
    const ms = navigator.mediaSession;
    try {
      ms.setActionHandler("play", () => {
        if (!playing) toggle();
      });
      ms.setActionHandler("pause", () => {
        if (playing) toggle();
      });
    } catch {
      /* unsupported */
    }
    return () => {
      try {
        ms.setActionHandler("play", null);
        ms.setActionHandler("pause", null);
      } catch {
        /* unsupported */
      }
    };
  }, [playing, toggle]);

  // ── Visibility change: some mobile OSes suspend the AudioContext when
  //    the tab hides; when we become visible again and playback should be
  //    running, poke the context back to life.

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible" && playing && audioSource === "synth") {
        getEngine().resume(); // some mobile OSes suspend the context on hide
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [playing, volume, audioSource, getEngine]);

  // Cleanup on unmount (provider lives for the app lifetime; this is a
  // correctness guarantee, not a route-change teardown).
  useEffect(() => {
    return () => {
      engineRef.current?.dispose();
    };
  }, []);

  return (
    <MusicContext.Provider
      value={{
        playing,
        track,
        volume,
        toggle,
        cycleTrack,
        setVolume,
        selectTrack,
        muted,
        toggleMute,
        mixerMode,
        toggleMixerMode,
        activeLayers,
        layerStates,
        addLayer,
        removeLayer,
        setLayerVolume,
        setLayerMute,
        setLayerSolo,
        presets,
        savePreset,
        renamePreset,
        loadPreset,
        deletePreset,
        favorites: vaultPrefs.favorites,
        toggleFavorite,
        recent: vaultPrefs.recent,
        eqPreset,
        setEq,
        fadeSeconds,
        setFade,
        pan,
        setPan,
        sleepMinutes,
        setSleepMinutes,
        sleepActive: sleepMinutes > 0,
        ducking,
        setDucking,
        getOutputStatus,
        audioSupported: getEngine().supported,
        activeSceneId,
        applyScene,
        autoScene: rituals.autoScene,
        setAutoScene,
        sceneForMode,
        setSceneForMode,
        youtubeUrl,
        setYoutubeUrl,
        youtubePlaying,
        toggleYoutube,
        audioSource,
        setAudioSource,
        focusMode,
        setFocusMode,
      }}
    >
      {children}
    </MusicContext.Provider>
  );
}

export function useMusic(): MusicContextValue {
  const context = useContext(MusicContext);
  if (!context) throw new Error("useMusic must be used inside <MusicProvider>.");
  return context;
}

// The floating player UI (unchanged visual identity, FLOWSTATE panels).
export { MusicPlayer } from "./music/MusicPlayerUI";
