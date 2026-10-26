// TUTOR MOBILE HARNESS — stub for `@/components/music-player`.
//
// Re-exports the real track catalog (pure data, no audio engine) so the
// Vibe Player pill renders exactly as in production, with a silent fake
// context. Playback is deliberately inert in the harness — we verify the
// player's LAYOUT (dock, collision avoidance, keyboard coordination).

import type { ReactNode } from "react";
import {
  SCENES,
  TRACKS,
  getTrack,
  isKnownTrack,
} from "@/lib/audio/tracks";
import { EQ_PRESETS, type EqPreset } from "@/lib/audio/flowEngine";

export { TRACKS, SCENES, EQ_PRESETS, getTrack, isKnownTrack };
export type { EqPreset };
export type { TrackMeta, SoundCategory, Scene } from "@/lib/audio/tracks";
// The real floating player UI — it consumes THIS stub's useMusic context,
// so the pill renders pixel-identical while staying silent.
export { MusicPlayer } from "@/components/music/MusicPlayerUI";

const noop = () => {};

const stubValue = {
  playing: false,
  track: TRACKS[0],
  volume: 0.55,
  toggle: noop,
  cycleTrack: noop,
  setVolume: noop,
  selectTrack: noop,
  muted: false,
  toggleMute: noop,
  mixerMode: false,
  toggleMixerMode: noop,
  activeLayers: [],
  layerStates: [],
  addLayer: noop,
  removeLayer: noop,
  setLayerVolume: noop,
  setLayerMute: noop,
  setLayerSolo: noop,
  presets: [],
  savePreset: noop,
  renamePreset: noop,
  loadPreset: noop,
  deletePreset: noop,
  favorites: [],
  toggleFavorite: noop,
  recent: [],
  eqPreset: "flat" as EqPreset,
  setEq: noop,
  fadeSeconds: 2,
  setFade: noop,
  pan: 0,
  setPan: noop,
  sleepMinutes: 0,
  setSleepMinutes: noop,
  sleepActive: false,
  ducking: false,
  setDucking: noop,
  getOutputStatus: () => ({ supported: false, state: "harness", sampleRate: null, baseLatencyMs: null }),
  audioSupported: false,
  activeSceneId: null,
  applyScene: noop,
  autoScene: false,
  setAutoScene: noop,
  sceneForMode: () => null,
  setSceneForMode: noop,
  youtubeUrl: "",
  setYoutubeUrl: noop,
  youtubePlaying: false,
  toggleYoutube: noop,
  audioSource: "synth" as const,
  setAudioSource: noop,
  focusMode: "off" as const,
  setFocusMode: noop,
};

export function useMusic() {
  return stubValue;
}

export function MusicProvider({ children }: { children?: ReactNode }) {
  return <>{children}</>;
}

// Re-exports some consumers reach for via the module barrel.
export const DEFAULT_TRACK_ID = TRACKS[0]?.id;
