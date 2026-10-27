// LEARNYX FLOWSTATE — floating player UI.
//
// The capsule (gold play button, track navigation, volume, icon row,
// warm glass surfaces) is visually UNCHANGED from the original player —
// students keep the exact control they know. What changed is what the
// three action buttons open:
//
//   Browse  → the Sound Vault (searchable, categorized, favorites,
//             recently played, honest licensing note).
//   Mixer   → the Atmosphere Mixer (layers with volume/mute/solo,
//             scene presets, saved recipes) with a Studio tab
//             (EQ presets, fades, sleep timer, balance, Tutor ducking,
//             output status).
//   YouTube → unchanged (student's own URL, embeds only).
//
// The player is never mounted on /admin while idle, and publishes its real
// height as --music-player-h so immersive pages can reserve clearance.
// DESKTOP WORKSPACE — it also publishes --music-player-bar-h, the height of
// the main pill/deck bar ALONE (excluding the mixer / vault / YouTube panels
// that stack above it). Desktop surfaces reserve the bar so the composer
// stays naturally anchored; the panels float over the canvas as transient
// overlays instead of shoving the composer up the screen. Phones keep the
// full-container reservation (--music-player-h) exactly as Mobile 3.0 built it.

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useLocation } from "react-router";
import {
  AudioLines,
  BedDouble,
  ChevronDown,
  ChevronUp,
  Heart,
  Layers,
  Moon,
  Pause,
  Play,
  Plus,
  Save,
  Search,
  SlidersHorizontal,
  Sparkles,
  Sun,
  Volume2,
  VolumeX,
  X,
  Youtube,
  Cloud,
  Pencil,
  Check,
  Waves,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  EQ_PRESETS,
  SCENES,
  TRACKS,
  useMusic,
  type EqPreset,
  type SoundCategory,
  type TrackMeta,
} from "@/components/music-player";
import { Switch } from "@/components/ui/switch";

// ── Keyboard state bridge (MOBILE 3.0) ─────────────────────────────────
//
// The useKeyboardViewport hook (DashboardShell) toggles the `kb-open` class
// on <html> while the virtual keyboard is up. ClassList isn't reactive, so
// this tiny external store subscribes to that attribute and re-renders the
// player when the keyboard opens/closes. Used ONLY for chrome decisions —
// never playback: when the keyboard opens on a phone the deck miniaturizes
// to its pill and the audio keeps playing, untouched.

function subscribeKbClass(onChange: () => void) {
  const mo = new MutationObserver(onChange);
  mo.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  });
  return () => mo.disconnect();
}

function useKbOpen(): boolean {
  return useSyncExternalStore(
    subscribeKbClass,
    () => document.documentElement.classList.contains("kb-open"),
    () => false,
  );
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

// ── Small shared bits ─────────────────────────────────────────────────

function loopBadge(t: TrackMeta): string {
  if (t.kind === "classical") return "≈" + Math.round(t.loopSeconds ?? 40) + "s loop";
  return "loops ∞";
}

function TrackRow({
  t,
  current,
  playing,
  favorite,
  mixerMode,
  onSelect,
  onToggleFavorite,
  onAddLayer,
}: {
  t: TrackMeta;
  current: boolean;
  playing: boolean;
  favorite: boolean;
  mixerMode: boolean;
  onSelect: () => void;
  onToggleFavorite: () => void;
  onAddLayer: () => void;
}) {
  return (
    <div
      className={cn(
        "group flex items-center gap-2 rounded-lg border px-2 py-1.5 transition-colors",
        current ? "border-primary/30 bg-primary/[0.07]" : "border-white/[0.04] hover:border-primary/20 hover:bg-white/[0.03]",
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        className="focus-ring flex min-w-0 flex-1 cursor-pointer rounded-sm text-left"
        aria-label={current && playing ? `Now playing ${t.label}` : `Play ${t.label}`}
      >
        <span className="min-w-0">
          <span className="flex items-center gap-1.5">
            {current && <AudioLines className={cn("size-3 shrink-0 text-primary", playing && "animate-pulse")} />}
            <span className="truncate text-[11px] font-semibold">{t.label}</span>
          </span>
          <span className="block truncate text-[9px] text-muted-foreground">{t.hint}</span>
        </span>
      </button>
      <span className="hidden shrink-0 rounded-md border border-white/10 bg-white/5 px-1 py-px font-mono text-[8px] font-semibold uppercase tracking-wider text-muted-foreground sm:inline">
        {t.category}
      </span>
      <span className="shrink-0 font-mono text-[8px] text-muted-foreground/60">{loopBadge(t)}</span>
      <button
        type="button"
        onClick={onToggleFavorite}
        aria-pressed={favorite}
        aria-label={favorite ? `Remove ${t.label} from favorites` : `Add ${t.label} to favorites`}
        className={cn(
          "focus-ring flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md transition-colors",
          favorite ? "text-rose-300" : "text-muted-foreground/40 hover:text-rose-300",
        )}
      >
        <Heart className={cn("size-3", favorite && "fill-current")} />
      </button>
      {mixerMode && (
        <button
          type="button"
          onClick={onAddLayer}
          aria-label={`Add ${t.label} to mixer`}
          title="Add to mixer"
          className="focus-ring flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md bg-primary/10 text-primary hover:bg-primary/20"
        >
          <Plus className="size-3" />
        </button>
      )}
    </div>
  );
}

// ── Sound Vault panel ─────────────────────────────────────────────────

function SoundVault({ onClose }: { onClose: () => void }) {
  const {
    track,
    playing,
    selectTrack,
    favorites,
    toggleFavorite,
    recent,
    mixerMode,
    addLayer,
  } = useMusic();
  const [query, setQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<SoundCategory | "All" | "Faves">("All");

  const searching = query.trim().length > 0;
  const pool = searching
    ? TRACKS
    : activeCategory === "All"
      ? TRACKS
      : activeCategory === "Faves"
        ? TRACKS.filter((t) => favorites.includes(t.id))
        : TRACKS.filter((t) => t.category === activeCategory);
  const q = query.trim().toLowerCase();
  const results = searching
    ? pool.filter((t) =>
        `${t.label} ${t.hint} ${t.category} ${t.tags.join(" ")}`.toLowerCase().includes(q),
      )
    : pool;
  const recentTracks = recent.map((id) => TRACKS.find((t) => t.id === id)).filter((t): t is TrackMeta => !!t);

  const categories: (SoundCategory | "All" | "Faves")[] = ["All", "Faves", "Noise", "Rain & Weather", "Nature", "Study Spaces", "Instrumental", "Focus Rituals", "Wind-down"];

  return (
    <div
      className="mb-2 w-80 max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-2xl border border-white/10 bg-background/95 shadow-2xl backdrop-blur-xl"
      data-scroll-contain
      role="group"
      aria-label="Sound Vault"
    >
      <div className="flex items-center justify-between border-b border-white/[0.06] px-3 py-2.5">
        <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-amber-300">
          <Waves className="size-3.5" /> Sound Vault
          <span className="font-mono text-[9px] font-normal normal-case text-muted-foreground">{TRACKS.length} sounds</span>
        </p>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close Sound Vault"
          className="focus-ring cursor-pointer rounded-sm text-muted-foreground hover:text-foreground"
        >
          <X className="size-3.5" />
        </button>
      </div>

      <div className="max-h-72 overflow-y-auto p-3" data-scroll-contain>
        {/* Search */}
        <div className="relative mb-2">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground/60" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search sounds, moods, tags…"
            aria-label="Search the sound vault"
            className="focus-ring h-8 w-full rounded-lg bg-white/5 pl-7 pr-2 text-[11px] outline-none placeholder:text-muted-foreground/50"
          />
        </div>

        {/* Category chips */}
        {!searching && (
          <div className="mb-2 flex flex-wrap gap-1">
            {categories.map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setActiveCategory(cat)}
                aria-pressed={activeCategory === cat}
                className={cn(
                  "focus-ring cursor-pointer rounded-lg px-2 py-0.5 text-[10px] font-semibold transition",
                  activeCategory === cat
                    ? "bg-primary/15 text-primary"
                    : "bg-white/5 text-muted-foreground hover:text-foreground",
                )}
              >
                {cat === "Faves" ? (
                  <span className="flex items-center gap-1"><Heart className="size-2.5" /> {favorites.length || ""}</span>
                ) : cat}
              </button>
            ))}
          </div>
        )}

        {/* Recently played */}
        {!searching && activeCategory === "All" && recentTracks.length > 0 && (
          <div className="mb-2">
            <p className="mb-1 font-mono text-[9px] uppercase tracking-wider text-muted-foreground/70">Recently played</p>
            <div className="flex flex-wrap gap-1">
              {recentTracks.slice(0, 4).map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => selectTrack(t.id)}
                  aria-label={`Play recent ${t.label}`}
                  className={cn(
                    "focus-ring cursor-pointer rounded-full border px-2 py-0.5 text-[10px] transition",
                    t.id === track.id
                      ? "border-primary/40 bg-primary/10 text-primary"
                      : "border-white/10 bg-white/5 text-muted-foreground hover:text-foreground",
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Results */}
        <div className="space-y-1">
          {results.map((t) => (
            <TrackRow
              key={t.id}
              t={t}
              current={t.id === track.id}
              playing={playing}
              favorite={favorites.includes(t.id)}
              mixerMode={mixerMode}
              onSelect={() => selectTrack(t.id)}
              onToggleFavorite={() => toggleFavorite(t.id)}
              onAddLayer={() => addLayer(t.id)}
            />
          ))}
          {results.length === 0 && (
            <p className="py-4 text-center text-[11px] text-muted-foreground">
              {activeCategory === "Faves" ? "No favorites yet — tap the heart on any sound." : "No sounds match that search."}
            </p>
          )}
        </div>
      </div>

      <p className="border-t border-white/[0.06] px-3 py-2 text-[9px] leading-relaxed text-muted-foreground/70">
        Every sound is synthesized live on this device or sequenced from public-domain scores — nothing recorded, nothing hosted, fully licensed.
      </p>
    </div>
  );
}

// ── Atmosphere Mixer panel (Layers + Studio tabs) ─────────────────────

function AtmosphereMixer({ onClose, onOpenVault }: { onClose: () => void; onOpenVault: () => void }) {
  const {
    playing,
    track,
    volume,
    setVolume,
    toggle,
    activeLayers,
    layerStates,
    removeLayer,
    setLayerVolume,
    setLayerMute,
    setLayerSolo,
    presets,
    savePreset,
    renamePreset,
    loadPreset,
    deletePreset,
    eqPreset,
    setEq,
    fadeSeconds,
    setFade,
    pan,
    setPan,
    sleepMinutes,
    setSleepMinutes,
    ducking,
    setDucking,
    activeSceneId,
    applyScene,
    getOutputStatus,
    audioSupported,
  } = useMusic();
  const [tab, setTab] = useState<"layers" | "studio">("layers");
  const [presetName, setPresetName] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [status, setStatus] = useState<{ state: string; sampleRate: number | null; baseLatencyMs: number | null } | null>(null);

  const refreshStatus = () => {
    const s = getOutputStatus();
    setStatus({ state: s.state, sampleRate: s.sampleRate, baseLatencyMs: s.baseLatencyMs });
  };

  return (
    <div
      className="mb-2 w-80 max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-2xl border border-white/10 bg-background/95 shadow-2xl backdrop-blur-xl"
      data-scroll-contain
      role="group"
      aria-label="Atmosphere mixer"
    >
      <div className="flex items-center justify-between border-b border-white/[0.06] px-3 py-2.5">
        <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-amber-300">
          <SlidersHorizontal className="size-3.5" /> Atmosphere
        </p>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close atmosphere mixer"
          className="focus-ring cursor-pointer rounded-sm text-muted-foreground hover:text-foreground"
        >
          <X className="size-3.5" />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-white/[0.06]">
        <button
          type="button"
          onClick={() => setTab("layers")}
          aria-pressed={tab === "layers"}
          className={cn(
            "focus-ring flex-1 cursor-pointer px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider transition-colors",
            tab === "layers" ? "border-b-2 border-primary text-primary" : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Layers className="mr-1 inline size-3" /> Layers
        </button>
        <button
          type="button"
          onClick={() => { setTab("studio"); refreshStatus(); }}
          aria-pressed={tab === "studio"}
          className={cn(
            "focus-ring flex-1 cursor-pointer px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider transition-colors",
            tab === "studio" ? "border-b-2 border-primary text-primary" : "text-muted-foreground hover:text-foreground",
          )}
        >
          <SlidersHorizontal className="mr-1 inline size-3" /> Studio
        </button>
      </div>

      <div className="max-h-80 overflow-y-auto p-3" data-scroll-contain>
        {tab === "layers" ? (
          <>
            {/* Scene presets — one-tap atmospheres */}
            <p className="mb-1 font-mono text-[9px] uppercase tracking-wider text-muted-foreground/70">Scenes</p>
            <div className="mb-3 flex flex-wrap gap-1">
              {SCENES.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => applyScene(s.id)}
                  aria-pressed={activeSceneId === s.id}
                  title={s.description}
                  className={cn(
                    "focus-ring cursor-pointer rounded-full border px-2 py-0.5 text-[10px] font-semibold transition",
                    activeSceneId === s.id
                      ? "border-primary/40 bg-primary/10 text-primary shadow-[0_0_12px_-6px_rgb(251,191,36/0.6)]"
                      : "border-white/10 bg-white/5 text-muted-foreground hover:text-foreground",
                  )}
                >
                  {s.label}
                </button>
              ))}
            </div>

            {/* Base layer */}
            <div className="mb-1.5 flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/[0.05] px-2 py-1.5">
              <AudioLines className={cn("size-3.5 shrink-0 text-primary", playing && "animate-pulse")} />
              <span className="min-w-0 flex-1 truncate text-[11px] font-semibold">{track.label}</span>
              <span className="font-mono text-[8px] uppercase text-muted-foreground">base</span>
            </div>

            {/* Layers */}
            {activeLayers.length === 0 && (
              <p className="py-2 text-center text-[11px] text-muted-foreground">
                Layer a second sound for atmosphere —{" "}
                <button type="button" onClick={onOpenVault} className="focus-ring cursor-pointer text-primary underline-offset-2 hover:underline">
                  browse the vault
                </button>
                .
              </p>
            )}
            {activeLayers.map((layer, i) => {
              const state = layerStates[i] ?? { mute: false, solo: false };
              const meta = TRACKS.find((t) => t.id === layer.trackId);
              return (
                <div key={i} className="mb-1.5 flex items-center gap-1.5 rounded-lg border border-white/[0.06] bg-white/[0.02] px-2 py-1.5">
                  <span className="min-w-0 flex-1 truncate text-[11px] font-semibold">{meta?.label ?? layer.trackId}</span>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={layer.volume}
                    onChange={(e) => setLayerVolume(i, Number(e.target.value))}
                    aria-label={`${meta?.label ?? "Layer"} volume`}
                    className="focus-ring h-1 w-14 cursor-pointer accent-[var(--primary)]"
                  />
                  <button
                    type="button"
                    onClick={() => setLayerMute(i, !state.mute)}
                    aria-pressed={state.mute}
                    aria-label={`${meta?.label ?? "Layer"} mute`}
                    title="Mute"
                    className={cn(
                      "focus-ring flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md transition-colors",
                      state.mute ? "bg-rose-400/15 text-rose-300" : "text-muted-foreground/50 hover:text-foreground",
                    )}
                  >
                    <VolumeX className="size-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setLayerSolo(i, !state.solo)}
                    aria-pressed={state.solo}
                    aria-label={`${meta?.label ?? "Layer"} solo`}
                    title="Solo"
                    className={cn(
                      "focus-ring flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-[9px] font-bold transition-colors",
                      state.solo ? "bg-amber-400/20 text-amber-300" : "text-muted-foreground/50 hover:text-foreground",
                    )}
                  >
                    S
                  </button>
                  <button
                    type="button"
                    onClick={() => removeLayer(i)}
                    aria-label={`Remove ${meta?.label ?? "layer"}`}
                    className="focus-ring cursor-pointer rounded-sm text-muted-foreground hover:text-rose-300"
                  >
                    <X className="size-3" />
                  </button>
                </div>
              );
            })}

            {/* Master volume + play */}
            <div className="mt-2 flex items-center gap-2 border-t border-white/[0.06] pt-2">
              <button
                type="button"
                onClick={toggle}
                aria-label={playing ? "Pause atmosphere" : "Play atmosphere"}
                className="focus-ring flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-full bg-primary/15 text-primary hover:bg-primary/25"
              >
                {playing ? <Pause className="size-3" /> : <Play className="size-3 translate-x-px" />}
              </button>
              <Volume2 className="size-3.5 shrink-0 text-muted-foreground" />
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={volume}
                onChange={(e) => setVolume(Number(e.target.value))}
                aria-label="Master volume"
                className="focus-ring h-1 min-w-0 flex-1 cursor-pointer accent-[var(--primary)]"
              />
            </div>

            {/* Save recipe */}
            {activeLayers.length > 0 && (
              <div className="mt-2 flex items-center gap-1.5">
                <input
                  type="text"
                  value={presetName}
                  onChange={(e) => setPresetName(e.target.value)}
                  placeholder="Name this mix…"
                  aria-label="Mix recipe name"
                  className="focus-ring h-7 min-w-0 flex-1 rounded-lg bg-white/5 px-2 text-[11px] outline-none placeholder:text-muted-foreground/50"
                />
                <button
                  type="button"
                  onClick={() => {
                    if (presetName.trim()) {
                      savePreset(presetName.trim());
                      setPresetName("");
                    }
                  }}
                  disabled={!presetName.trim()}
                  aria-label="Save mix recipe"
                  className="focus-ring cursor-pointer rounded-lg bg-primary/10 px-2 py-1 text-[11px] font-semibold text-primary hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Save className="size-3" />
                </button>
              </div>
            )}

            {/* Saved recipes */}
            {presets.length > 0 && (
              <div className="mt-2 space-y-1">
                <p className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground/70">Your recipes</p>
                {presets.map((p) => (
                  <div key={p.id} className="flex items-center gap-1.5 rounded-lg border border-white/[0.04] px-2 py-1">
                    {renamingId === p.id ? (
                      <>
                        <input
                          type="text"
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          aria-label="Recipe name"
                          className="focus-ring h-6 min-w-0 flex-1 rounded bg-white/5 px-1.5 text-[11px] outline-none"
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && renameValue.trim()) {
                              renamePreset(p.id, renameValue.trim());
                              setRenamingId(null);
                            }
                            if (e.key === "Escape") setRenamingId(null);
                          }}
                          autoFocus
                        />
                        <button
                          type="button"
                          onClick={() => {
                            if (renameValue.trim()) renamePreset(p.id, renameValue.trim());
                            setRenamingId(null);
                          }}
                          aria-label="Save recipe name"
                          className="focus-ring cursor-pointer text-emerald-300 hover:text-emerald-200"
                        >
                          <Check className="size-3" />
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => loadPreset(p)}
                          className="focus-ring min-w-0 flex-1 cursor-pointer truncate rounded-sm text-left text-[11px] font-semibold hover:text-amber-300"
                        >
                          {p.name}
                        </button>
                        <span className="shrink-0 font-mono text-[9px] text-muted-foreground">{p.layers.length} layer{p.layers.length === 1 ? "" : "s"}</span>
                        <button
                          type="button"
                          onClick={() => { setRenamingId(p.id); setRenameValue(p.name); }}
                          aria-label={`Rename ${p.name}`}
                          className="focus-ring cursor-pointer rounded-sm text-muted-foreground/60 hover:text-foreground"
                        >
                          <Pencil className="size-2.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => deletePreset(p.id)}
                          aria-label={`Delete ${p.name}`}
                          className="focus-ring cursor-pointer rounded-sm text-muted-foreground/60 hover:text-rose-300"
                        >
                          <X className="size-2.5" />
                        </button>
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <>
            {/* Studio — EQ */}
            <p className="mb-1 font-mono text-[9px] uppercase tracking-wider text-muted-foreground/70">EQ character</p>
            <div className="mb-3 flex flex-wrap gap-1">
              {(Object.keys(EQ_PRESETS) as EqPreset[]).map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setEq(preset)}
                  aria-pressed={eqPreset === preset}
                  className={cn(
                    "focus-ring cursor-pointer rounded-lg px-2 py-0.5 text-[10px] font-semibold transition",
                    eqPreset === preset ? "bg-primary/15 text-primary" : "bg-white/5 text-muted-foreground hover:text-foreground",
                  )}
                >
                  {EQ_PRESETS[preset].label}
                </button>
              ))}
            </div>

            {/* Fades */}
            <div className="mb-3">
              <div className="mb-1 flex items-center justify-between">
                <label htmlFor="flowstate-fade" className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground/70">Fade</label>
                <span className="font-mono text-[9px] text-muted-foreground">{fadeSeconds === 0 ? "instant" : `${fadeSeconds.toFixed(1)}s`}</span>
              </div>
              <input
                id="flowstate-fade"
                type="range"
                min={0}
                max={3}
                step={0.1}
                value={fadeSeconds}
                onChange={(e) => setFade(Number(e.target.value))}
                aria-label="Fade duration in seconds"
                className="focus-ring h-1 w-full cursor-pointer accent-[var(--primary)]"
              />
            </div>

            {/* Sleep timer */}
            <p className="mb-1 flex items-center gap-1 font-mono text-[9px] uppercase tracking-wider text-muted-foreground/70">
              <BedDouble className="size-3" /> Sleep timer
            </p>
            <div className="mb-3 flex flex-wrap gap-1">
              {[0, 15, 30, 45, 60].map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setSleepMinutes(m)}
                  aria-pressed={sleepMinutes === m}
                  className={cn(
                    "focus-ring cursor-pointer rounded-lg px-2 py-0.5 text-[10px] font-semibold transition",
                    sleepMinutes === m ? "bg-primary/15 text-primary" : "bg-white/5 text-muted-foreground hover:text-foreground",
                  )}
                >
                  {m === 0 ? "Off" : `${m}m`}
                </button>
              ))}
              {sleepMinutes > 0 && (
                <span className="ml-1 self-center font-mono text-[9px] text-amber-300/80">
                  <Moon className="mr-0.5 inline size-2.5" /> audio fades out then stops
                </span>
              )}
            </div>

            {/* Stereo balance */}
            <div className="mb-3">
              <div className="mb-1 flex items-center justify-between">
                <label htmlFor="flowstate-pan" className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground/70">Balance</label>
                <span className="font-mono text-[9px] text-muted-foreground">{pan === 0 ? "center" : pan < 0 ? `L ${Math.round(-pan * 100)}` : `R ${Math.round(pan * 100)}`}</span>
              </div>
              <input
                id="flowstate-pan"
                type="range"
                min={-1}
                max={1}
                step={0.05}
                value={pan}
                onChange={(e) => setPan(Number(e.target.value))}
                aria-label="Stereo balance, left to right"
                className="focus-ring h-1 w-full cursor-pointer accent-[var(--primary)]"
              />
            </div>

            {/* Tutor ducking */}
            <div className="mb-3 flex items-center justify-between gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-2 py-2">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold">Dip under Tutor speech</p>
                <p className="text-[9px] text-muted-foreground">Volume softly lowers while your tutor's voice plays.</p>
              </div>
              <Switch
                checked={ducking}
                onCheckedChange={(checked) => setDucking(checked)}
                aria-label="Dip volume while the Tutor speaks"
              />
            </div>

            {/* Output status */}
            <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-2 py-1.5">
              <p className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground/70">Output</p>
              {!audioSupported ? (
                <p className="mt-0.5 text-[10px] text-amber-300/80">Web Audio unavailable in this browser — timers and missions still work.</p>
              ) : status ? (
                <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                  {status.state}
                  {status.sampleRate ? ` · ${(status.sampleRate / 1000).toFixed(1)} kHz` : ""}
                  {status.baseLatencyMs !== null ? ` · ~${status.baseLatencyMs} ms` : ""}
                </p>
              ) : (
                <p className="mt-0.5 text-[10px] text-muted-foreground">Tap play once to activate audio.</p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── The floating player (capsule unchanged) ───────────────────────────

export function MusicPlayer() {
  const {
    playing,
    track,
    volume,
    toggle,
    cycleTrack,
    setVolume,
    activeLayers,
    youtubeUrl,
    setYoutubeUrl,
    youtubePlaying,
    audioSource,
  } = useMusic();

  // Admin de-obstruction: on /admin the floating player only renders while a
  // listening session is actually active (audio or YouTube playing). An idle
  // player used to sit at `fixed bottom-4 z-40` over admin panels, dialogs
  // and the bulk-upload save bar. Outside /admin behavior is unchanged.

  // Executive fix — on phones the expanded 2-row deck floats over immersive
  // page furniture (the Tutor composer). Start COLLAPSED under sm: the pill
  // is a single compact row; the user can still expand to the full deck.
  // Desktop keeps the expanded default.
  const [expanded, setExpanded] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(min-width: 640px)").matches,
  );
  const [showMixer, setShowMixer] = useState(false);
  const [showBrowser, setShowBrowser] = useState(false);
  const [showYoutube, setShowYoutube] = useState(false);
  const [timeSuggestion, setTimeSuggestion] = useState<string | null>(null);

  // MOBILE 3.0 — keyboard coordination: while the virtual keyboard is open
  // on a phone, drop to the elegant mini pill so the Tutor composer keeps
  // the stage and the deck never fights it for the bottom dock. Playback
  // state is deliberately untouched — audio continues uninterrupted, and
  // the pill's tap-to-expand keeps the full deck one tap away afterwards.
  const kbOpen = useKbOpen();
  useEffect(() => {
    if (!kbOpen) return;
    if (window.matchMedia("(max-width: 639px)").matches) setExpanded(false);
  }, [kbOpen]);

  // Time-of-day suggestion (kept from the original player)
  useEffect(() => {
    const hour = new Date().getHours();
    if (hour >= 5 && hour < 11) setTimeSuggestion("Focus Rituals");
    else if (hour >= 11 && hour < 17) setTimeSuggestion("Noise");
    else if (hour >= 17 && hour < 22) setTimeSuggestion("Instrumental");
    else setTimeSuggestion("Wind-down");
    // Auto-dismiss after 8 seconds
    const timer = setTimeout(() => setTimeSuggestion(null), 8000);
    return () => clearTimeout(timer);
  }, []);

  // Hook-safe placement: this runs after every hook, so navigating between
  // /admin and student routes never changes the hook execution order.
  const onAdminRoute = useLocation().pathname.startsWith("/admin");
  const sessionActive = playing || youtubePlaying || audioSource === "youtube";

  // Publish the player's REAL rendered height as `--music-player-h` on the
  // root element, so immersive pages (Tutor study room) can reserve exact
  // bottom clearance instead of guessing with magic numbers. ResizeObserver
  // tracks every state that changes the footprint (expand/collapse, mixer,
  // browser, YouTube panel, suggestion banner). Listeners are cleaned up;
  // the admin idle-return and unmount both reset the variable to 0.
  const playerRef = useRef<HTMLDivElement>(null);
  // DESKTOP WORKSPACE — separate ref on the main bar so its height can be
  // published independently of the panels above it (see header comment).
  const barRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = document.documentElement;
    if (onAdminRoute && !sessionActive) {
      root.style.setProperty("--music-player-h", "0px");
      root.style.setProperty("--music-player-bar-h", "0px");
      return;
    }
    const el = playerRef.current;
    if (!el) return;
    const bar = barRef.current;
    const publish = () => {
      root.style.setProperty("--music-player-h", `${Math.ceil(el.getBoundingClientRect().height)}px`);
      root.style.setProperty(
        "--music-player-bar-h",
        bar ? `${Math.ceil(bar.getBoundingClientRect().height)}px` : "0px",
      );
    };
    publish();
    const ro = new ResizeObserver(publish);
    ro.observe(el);
    if (bar) ro.observe(bar);
    return () => {
      ro.disconnect();
      root.style.setProperty("--music-player-h", "0px");
      root.style.setProperty("--music-player-bar-h", "0px");
    };
  }, [onAdminRoute, sessionActive]);

  const ytParsed = youtubeUrl ? parseYoutubeUrl(youtubeUrl) : null;

  if (onAdminRoute && !sessionActive) return null;
  return (
    <div
      ref={playerRef}
      // Mobile: width-constrained to viewport - 1.5rem, capped at 28rem
      // (max-w-md) so the expanded 2-row layout never overflows. Desktop:
      // sm:w-auto + sm:max-w-none lets the bar grow to its natural content
      // width so all controls (prev/play/next/track-name/visualizer/volume/
      // 3 action buttons/minimize) have proper breathing room on a single row.
      className="fixed bottom-[calc(max(1rem,env(safe-area-inset-bottom,0px))+var(--kb-h,0px))] left-1/2 z-40 -translate-x-1/2 w-[calc(100vw-1.5rem)] max-w-md sm:w-auto sm:max-w-none"
      data-scroll-contain
    >
      {/* Time-of-day suggestion banner */}
      {timeSuggestion && !playing && (
        <div className="mb-2 flex items-center gap-2 rounded-full border border-amber-400/20 bg-amber-400/[0.06] px-3 py-1 text-[11px] text-amber-200">
          {new Date().getHours() < 11 ? <Sun className="size-3" /> : new Date().getHours() < 17 ? <Sparkles className="size-3" /> : new Date().getHours() < 22 ? <Cloud className="size-3" /> : <Moon className="size-3" />}
          <span>Mood suggestion: <strong>{timeSuggestion}</strong></span>
          <button onClick={() => setTimeSuggestion(null)} aria-label="Dismiss suggestion" className="focus-ring cursor-pointer rounded-sm text-amber-300/60 hover:text-amber-200"><X className="size-3" /></button>
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

      {/* FLOWSTATE Atmosphere Mixer */}
      {showMixer && (
        <AtmosphereMixer
          onClose={() => setShowMixer(false)}
          onOpenVault={() => { setShowBrowser(true); setShowMixer(false); }}
        />
      )}

      {/* FLOWSTATE Sound Vault */}
      {showBrowser && <SoundVault onClose={() => setShowBrowser(false)} />}

      {/* YouTube panel */}
      {showYoutube && (
        <div className="mb-2 w-80 max-w-[calc(100vw-1.5rem)] rounded-2xl border border-white/10 bg-background/95 p-3 shadow-2xl backdrop-blur-xl" data-scroll-contain role="group" aria-label="YouTube study music">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-bold uppercase tracking-wider text-amber-300">YouTube study music</p>
            <button onClick={() => setShowYoutube(false)} aria-label="Close YouTube panel" className="focus-ring cursor-pointer rounded-sm text-muted-foreground hover:text-foreground"><X className="size-3.5" /></button>
          </div>
          <input type="text" value={youtubeUrl} onChange={(e) => setYoutubeUrl(e.target.value)} placeholder="Paste a YouTube URL…" aria-label="YouTube URL" className="focus-ring h-8 w-full rounded-lg bg-white/5 px-2 text-[11px] outline-none" />
          <p className="mt-1.5 text-[10px] text-muted-foreground">Paste any public YouTube video or playlist URL. Audio plays through YouTube's own player — we never store or host the audio.</p>
          {youtubeUrl && !ytParsed && <p className="mt-1 text-[10px] text-rose-300">Could not parse that URL. Try a standard youtube.com/watch or youtu.be link.</p>}
        </div>
      )}

      {/* Main player bar — responsive: wraps to 2 rows on mobile, single row on desktop.
          barRef publishes this bar's own height as --music-player-bar-h.
          Layout breakdown:
            • Mobile collapsed: [icon + "vibe"/track-label] pill — fits viewport
            • Mobile expanded: row 1 = [prev][play][next][track-name][minimize],
                                row 2 = [volume-slider-flex-1][browse][mixer][youtube]
            • Desktop collapsed: same as mobile
            • Desktop expanded: single row with everything inline (no wrapping).
              gap-3 (desktop) gives comfortable breathing room between the play
              cluster + track name + volume cluster + action cluster — wider
              than mobile's gap-2 to avoid visual cramping on wide screens. */}
      <div
        ref={barRef}
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
                <span className="hidden shrink-0 rounded-md border border-white/10 bg-white/5 px-1 py-px font-mono text-[8px] font-semibold uppercase tracking-wider text-muted-foreground sm:inline">{track.category}</span>
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
              <input type="range" min={0} max={1} step={0.01} value={volume} onChange={(e) => setVolume(Number(e.target.value))} aria-label="Volume" className="focus-ring h-1 w-20 cursor-pointer accent-[var(--primary)]" />
            </div>

            {/* Action buttons — desktop inline. Grouped in their own flex
                container with gap-1 so the cluster reads as one unit, with
                a left border separator to visually distinguish from the
                volume cluster. The parent's gap-3 still applies between
                this group and its siblings. */}
            <div className="hidden items-center gap-1 border-l border-white/10 pl-2 sm:flex">
              <button onClick={() => { setShowBrowser(s => !s); setShowMixer(false); setShowYoutube(false); }} title="Sound Vault" aria-label="Sound Vault" aria-expanded={showBrowser} className={cn("flex size-7 cursor-pointer items-center justify-center rounded-full transition-colors", showBrowser ? "text-primary" : "text-muted-foreground hover:text-foreground")}>
                <AudioLines className="size-3.5" />
              </button>
              <button onClick={() => { setShowMixer(s => !s); setShowBrowser(false); setShowYoutube(false); }} title="Atmosphere mixer" aria-label="Atmosphere mixer" aria-expanded={showMixer} className={cn("flex size-7 cursor-pointer items-center justify-center rounded-full transition-colors", showMixer ? "text-primary" : "text-muted-foreground hover:text-foreground")}>
                <Layers className="size-3.5" />
              </button>
              <button onClick={() => { setShowYoutube(s => !s); setShowBrowser(false); setShowMixer(false); }} title="YouTube" aria-label="YouTube" aria-expanded={showYoutube} className={cn("flex size-7 cursor-pointer items-center justify-center rounded-full transition-colors", showYoutube ? "text-rose-400" : "text-muted-foreground hover:text-foreground")}>
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
              <input type="range" min={0} max={1} step={0.01} value={volume} onChange={(e) => setVolume(Number(e.target.value))} aria-label="Volume" className="focus-ring h-1 min-w-0 flex-1 cursor-pointer accent-[var(--primary)]" />
              <button onClick={() => { setShowBrowser(s => !s); setShowMixer(false); setShowYoutube(false); }} title="Sound Vault" aria-label="Sound Vault" aria-expanded={showBrowser} className={cn("flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-full transition-colors", showBrowser ? "text-primary" : "text-muted-foreground hover:text-foreground")}>
                <AudioLines className="size-3.5" />
              </button>
              <button onClick={() => { setShowMixer(s => !s); setShowBrowser(false); setShowYoutube(false); }} title="Atmosphere mixer" aria-label="Atmosphere mixer" aria-expanded={showMixer} className={cn("flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-full transition-colors", showMixer ? "text-primary" : "text-muted-foreground hover:text-foreground")}>
                <Layers className="size-3.5" />
              </button>
              <button onClick={() => { setShowYoutube(s => !s); setShowBrowser(false); setShowMixer(false); }} title="YouTube" aria-label="YouTube" aria-expanded={showYoutube} className={cn("flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-full transition-colors", showYoutube ? "text-rose-400" : "text-muted-foreground hover:text-foreground")}>
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
