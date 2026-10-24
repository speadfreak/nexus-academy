// LEARNYX FLOWSTATE — single shared audio engine.
//
// There is exactly ONE audio engine in the product. It is an evolution of
// the original AmbientEngine (music-player.tsx) and preserves every sound
// it could make, while adding the studio plumbing FLOWSTATE needs:
//
//   ONE AudioContext          — created lazily on the first user gesture
//                               (autoplay-policy safe), closed on dispose.
//   Master chain              — layers → EQ (low/mid/high shelf) →
//                               DynamicsCompressor (clipping-safe mixing) →
//                               StereoPanner → master gain → destination.
//   Per-layer gain            — independent volume, mute, solo; effective
//                               gain = volume × mute/solo × fade.
//   Fades                     — linear ramps on play/pause/switch; duration
//                               configurable (0 = instant).
//   Ducking                   — setDucking(true) smoothly dips the master
//                               (used so Tutor speech stays audible).
//   Sleep timer               — gentle fade-out, then full stop; cancellable.
//   Lookahead scheduler       — classical pieces are scheduled on the
//                               AudioContext clock up to two minutes ahead,
//                               so background-tab timer throttling can no
//                               longer stall the music (the old engine used
//                               setTimeout chains and audibly drifted).
//   Honest capability reporting — outputStatus() tells the UI whether Web
//                               Audio exists at all; every method no-ops
//                               safely when it does not.
//
// No health claims: nothing here treats frequencies as therapy. It is
// atmosphere, labelled as atmosphere.

import {
  CLASSICAL_PIECES,
  midiToFreq,
  type TrackMeta,
} from "./tracks";

export type EqPreset = "flat" | "warm" | "bright" | "vocal" | "night";

export const EQ_PRESETS: Record<EqPreset, { label: string; low: number; mid: number; high: number }> = {
  flat: { label: "Flat", low: 0, mid: 0, high: 0 },
  warm: { label: "Warm", low: 3, mid: -1, high: -2 },
  bright: { label: "Bright", low: -1, mid: 0.5, high: 3 },
  vocal: { label: "Vocal", low: -2, mid: 3, high: -1 },
  night: { label: "Late-night", low: 2, mid: -2, high: -4 },
};

export const DEFAULT_FADE_SECONDS = 0.8;
export const DUCK_FACTOR = 0.25;

interface LayerRuntime {
  gain: GainNode;
  volume: number; // 0..1 user volume for this layer
  mute: boolean;
  solo: boolean;
  nodes: AudioNode[];
  lfos: OscillatorNode[];
  /** Classical lookahead state for this layer. */
  scheduler?: { intervalId: number; nextLoopStart: number; pieceId: string };
}

export interface EngineOutputStatus {
  supported: boolean;
  state: "running" | "suspended" | "closed" | "unsupported";
  sampleRate: number | null;
  baseLatencyMs: number | null;
}

function nowSeconds(ctx: AudioContext | null): number {
  return ctx ? ctx.currentTime : 0;
}

export class FlowEngine {
  private ctx: AudioContext | null = null;
  private busIn: GainNode | null = null;
  private eqLow: BiquadFilterNode | null = null;
  private eqMid: BiquadFilterNode | null = null;
  private eqHigh: BiquadFilterNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private panner: StereoPannerNode | null = null;
  private master: GainNode | null = null;

  private baseLayer: LayerRuntime | null = null;
  private mixerLayers = new Map<number, LayerRuntime>();

  private volume = 0.55;
  private muted = false;
  private ducked = false;
  private fadeSeconds = DEFAULT_FADE_SECONDS;
  private eq: EqPreset = "flat";
  private pan = 0;

  private sleepTimerId: number | null = null;
  private sleepFadeTimeoutId: number | null = null;
  private onSleepFire: (() => void) | null = null;

  private disposed = false;

  // ── Context & graph ───────────────────────────────────────────────────

  private ensureContext(): AudioContext | null {
    if (this.disposed) return null;
    if (this.ctx) {
      if (this.ctx.state === "suspended") void this.ctx.resume().catch(() => {});
      return this.ctx;
    }
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null; // graceful fallback — UI reports "unsupported"
    try {
      this.ctx = new Ctor();
    } catch {
      return null;
    }
    const ctx = this.ctx;

    this.busIn = ctx.createGain();
    this.eqLow = ctx.createBiquadFilter();
    this.eqLow.type = "lowshelf";
    this.eqLow.frequency.value = 180;
    this.eqMid = ctx.createBiquadFilter();
    this.eqMid.type = "peaking";
    this.eqMid.frequency.value = 1000;
    this.eqMid.Q.value = 0.9;
    this.eqHigh = ctx.createBiquadFilter();
    this.eqHigh.type = "highshelf";
    this.eqHigh.frequency.value = 3800;
    this.compressor = ctx.createDynamicsCompressor();
    // Sum of several layered sources can exceed 1.0 — the compressor keeps
    // the mix free of digital clipping without touching character at low levels.
    this.compressor.threshold.value = -12;
    this.compressor.knee.value = 24;
    this.compressor.ratio.value = 4;
    this.compressor.attack.value = 0.01;
    this.compressor.release.value = 0.25;
    this.panner = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    this.master = ctx.createGain();
    this.master.gain.value = this.effectiveMasterGain();

    this.busIn.connect(this.eqLow);
    this.eqLow.connect(this.eqMid);
    this.eqMid.connect(this.eqHigh);
    this.eqHigh.connect(this.compressor);
    if (this.panner) {
      this.compressor.connect(this.panner);
      this.panner.connect(this.master);
    } else {
      this.compressor.connect(this.master);
    }
    this.master.connect(ctx.destination);

    this.applyEq(this.eq, true);
    if (ctx.state === "suspended") void ctx.resume().catch(() => {});
    return ctx;
  }

  private effectiveMasterGain(): number {
    const base = this.muted ? 0 : this.volume;
    return Math.max(0, Math.min(1, base * (this.ducked ? DUCK_FACTOR : 1)));
  }

  private applyMasterGain(fade = true) {
    if (!this.master || !this.ctx) return;
    const target = this.effectiveMasterGain();
    const t = nowSeconds(this.ctx);
    if (fade && this.fadeSeconds > 0) {
      this.master.gain.cancelScheduledValues(t);
      this.master.gain.setTargetAtTime(target, t, this.fadeSeconds / 3);
    } else {
      this.master.gain.cancelScheduledValues(t);
      this.master.gain.setValueAtTime(target, t);
    }
  }

  // ── Synthesis (every original sound preserved) ────────────────────────

  private noiseBuffer(ctx: AudioContext): AudioBuffer {
    const length = ctx.sampleRate * 2;
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0; // cheap brown-ish seed variation is done by filters below
    for (let i = 0; i < length; i++) {
      const w = Math.random() * 2 - 1;
      last = (last + 0.02 * w) / 1.02;
      data[i] = w * 0.96 + last * 3.2;
    }
    return buffer;
  }

  private addLfo(freq: number, depth: number, target: AudioParam, lfos: OscillatorNode[]) {
    const ctx = this.ctx;
    if (!ctx) return;
    const lfo = ctx.createOscillator();
    const gain = ctx.createGain();
    lfo.frequency.value = freq;
    gain.gain.value = depth;
    lfo.connect(gain);
    gain.connect(target);
    lfo.start();
    lfos.push(lfo);
  }

  /**
   * Build the node graph for one AMBIENT track into `out`. Classical pieces
   * are NOT handled here — they go through startClassicalScheduler (lookahead
   * scheduling) so they are never double-scheduled.
   */
  private synthesizeTrack(trackId: string, out: AudioNode, nodes: AudioNode[], lfos: OscillatorNode[]): void {
    const ctx = this.ctx;
    if (!ctx) return;

    switch (trackId) {
      case "rain": {
        const source = ctx.createBufferSource();
        source.buffer = this.noiseBuffer(ctx); source.loop = true;
        const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 850; lp.Q.value = 0.4;
        const g = ctx.createGain(); g.gain.value = 0.28;
        source.connect(lp); lp.connect(g); g.connect(out); source.start();
        nodes.push(lp, g);
        this.addLfo(0.14, 0.07, g.gain, lfos);
        break;
      }
      case "city_rain": {
        const source = ctx.createBufferSource();
        source.buffer = this.noiseBuffer(ctx); source.loop = true;
        const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 900; lp.Q.value = 0.4;
        const g = ctx.createGain(); g.gain.value = 0.22;
        source.connect(lp); lp.connect(g); g.connect(out); source.start();
        nodes.push(lp, g);
        this.addLfo(0.11, 0.06, g.gain, lfos);
        const rumble = ctx.createBufferSource();
        rumble.buffer = this.noiseBuffer(ctx); rumble.loop = true;
        const rlp = ctx.createBiquadFilter(); rlp.type = "lowpass"; rlp.frequency.value = 110; rlp.Q.value = 0.5;
        const rg = ctx.createGain(); rg.gain.value = 0.12;
        rumble.connect(rlp); rlp.connect(rg); rg.connect(out); rumble.start();
        nodes.push(rlp, rg);
        this.addLfo(0.05, 0.05, rg.gain, lfos);
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
      case "pulse": case "binaural": {
        const base = trackId === "pulse" ? 200 : 200;
        const beat = trackId === "pulse" ? 10 : 4;
        const l = ctx.createOscillator(); l.type = "sine"; l.frequency.value = base;
        const r = ctx.createOscillator(); r.type = "sine"; r.frequency.value = base + beat;
        const g = ctx.createGain(); g.gain.value = trackId === "pulse" ? 0.06 : 0.07;
        if (trackId === "binaural") {
          const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 900;
          l.connect(lp); r.connect(lp); lp.connect(g);
          nodes.push(lp);
        } else {
          l.connect(g); r.connect(g);
        }
        g.connect(out);
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
        nodes.push(bp, lp, g);
        this.addLfo(trackId === "wind" ? 0.12 : 0.2, 0.06, g.gain, lfos);
        break;
      }
      case "forest": {
        const source = ctx.createBufferSource();
        source.buffer = this.noiseBuffer(ctx); source.loop = true;
        const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 520; bp.Q.value = 0.4;
        const g = ctx.createGain(); g.gain.value = 0.13;
        source.connect(bp); bp.connect(g); g.connect(out); source.start();
        nodes.push(bp, g);
        this.addLfo(0.17, 0.05, g.gain, lfos);
        // Sparse high chirps — distant birds
        for (const [f, lfoF] of [[3400, 0.4], [2750, 0.31]] as const) {
          const chirp = ctx.createOscillator(); chirp.type = "sine"; chirp.frequency.value = f;
          const cg = ctx.createGain(); cg.gain.value = 0.004;
          chirp.connect(cg); cg.connect(out); chirp.start();
          nodes.push(chirp, cg);
          this.addLfo(lfoF, 0.0035, cg.gain, lfos);
        }
        break;
      }
      case "white": {
        const source = ctx.createBufferSource();
        source.buffer = this.noiseBuffer(ctx); source.loop = true;
        const hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 120;
        const g = ctx.createGain(); g.gain.value = 0.14;
        source.connect(hp); hp.connect(g); g.connect(out); source.start();
        nodes.push(hp, g);
        this.addLfo(0.07, 0.025, g.gain, lfos);
        break;
      }
      case "pink": {
        const source = ctx.createBufferSource();
        source.buffer = this.noiseBuffer(ctx); source.loop = true;
        const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 3200; lp.Q.value = 0.3;
        const g = ctx.createGain(); g.gain.value = 0.16;
        source.connect(lp); lp.connect(g); g.connect(out); source.start();
        nodes.push(lp, g);
        this.addLfo(0.07, 0.02, g.gain, lfos);
        break;
      }
      case "brown": {
        const source = ctx.createBufferSource();
        source.buffer = this.noiseBuffer(ctx); source.loop = true;
        const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 210; lp.Q.value = 0.3;
        const g = ctx.createGain(); g.gain.value = 0.3;
        source.connect(lp); lp.connect(g); g.connect(out); source.start();
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
        nodes.push(f, g);
        this.addLfo(3.2, 0.12, g.gain, lfos);
        break;
      }
      case "library": {
        // Hushed room tone + sparse page-turn flourishes (band-passed swells)
        const source = ctx.createBufferSource();
        source.buffer = this.noiseBuffer(ctx); source.loop = true;
        const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 300; lp.Q.value = 0.4;
        const g = ctx.createGain(); g.gain.value = 0.17;
        source.connect(lp); lp.connect(g); g.connect(out); source.start();
        nodes.push(lp, g);
        this.addLfo(0.06, 0.02, g.gain, lfos);
        const pages = ctx.createBufferSource();
        pages.buffer = this.noiseBuffer(ctx); pages.loop = true;
        const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 2400; bp.Q.value = 1.6;
        const pg = ctx.createGain(); pg.gain.value = 0.012;
        pages.connect(bp); bp.connect(pg); pg.connect(out); pages.start();
        nodes.push(bp, pg);
        this.addLfo(0.23, 0.011, pg.gain, lfos);
        break;
      }
      case "lofi": case "morning": {
        const g = ctx.createGain(); g.gain.value = 0.055; g.connect(out);
        const notes = trackId === "lofi" ? [146.83, 174.61, 220, 261.63] : [261.63, 329.63, 392, 523.25];
        for (const f of notes) {
          const osc = ctx.createOscillator(); osc.type = "triangle"; osc.frequency.value = f;
          osc.detune.value = (Math.random() - 0.5) * 4; osc.connect(g); osc.start(); nodes.push(osc);
        }
        nodes.push(g);
        this.addLfo(trackId === "lofi" ? 0.16 : 0.08, 0.025, g.gain, lfos);
        break;
      }
      case "cafe": {
        const source = ctx.createBufferSource();
        source.buffer = this.noiseBuffer(ctx); source.loop = true;
        const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 300; bp.Q.value = 0.3;
        const g = ctx.createGain(); g.gain.value = 0.12;
        source.connect(bp); bp.connect(g); g.connect(out); source.start();
        nodes.push(bp, g);
        this.addLfo(0.15, 0.03, g.gain, lfos);
        break;
      }
      case "singing_bowl": {
        const g = ctx.createGain(); g.gain.value = 0.08; g.connect(out);
        const freqs = [196, 294, 392, 490];
        for (const f of freqs) {
          const osc = ctx.createOscillator(); osc.type = "sine"; osc.frequency.value = f;
          osc.detune.value = (Math.random() - 0.5) * 2; osc.connect(g); osc.start(); nodes.push(osc);
        }
        nodes.push(g);
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
      default: {
        // Unknown id → soft rain fallback (never silent-by-accident)
        const source = ctx.createBufferSource();
        source.buffer = this.noiseBuffer(ctx); source.loop = true;
        const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 850;
        const g = ctx.createGain(); g.gain.value = 0.28;
        source.connect(lp); lp.connect(g); g.connect(out); source.start();
        nodes.push(lp, g);
        this.addLfo(0.14, 0.07, g.gain, lfos);
      }
    }
  }

  // ── Classical lookahead scheduler ─────────────────────────────────────
  // Notes are scheduled on the AudioContext clock (immune to JS timer
  // throttling) up to ~2 minutes ahead; a 5s checker tops up loops. The
  // old engine scheduled via setTimeout chains, which drift and stall in
  // background tabs.

  private scheduleClassicalLoop(pieceId: string, out: AudioNode, nodes: AudioNode[], startAt: number): number {
    const ctx = this.ctx;
    const piece = CLASSICAL_PIECES[pieceId];
    if (!ctx || !piece) return 0;
    const beatSec = 60 / piece.tempo;
    const loopStart = startAt > 0 ? startAt : ctx.currentTime + 0.15;

    const voiceGain = ctx.createGain();
    voiceGain.gain.value = 0.12;
    voiceGain.connect(out);
    nodes.push(voiceGain);

    for (const [midi, beats, startBeat] of piece.notes) {
      const startTime = loopStart + startBeat * beatSec;
      const durationSec = beats * beatSec;
      const osc = ctx.createOscillator();
      osc.type = "triangle";
      osc.frequency.value = midiToFreq(midi);
      const noteGain = ctx.createGain();
      noteGain.gain.setValueAtTime(0, startTime);
      noteGain.gain.linearRampToValueAtTime(0.8, startTime + 0.03);
      noteGain.gain.setTargetAtTime(0.4, startTime + 0.1, 0.15);
      noteGain.gain.setTargetAtTime(0, startTime + durationSec, 0.1);
      osc.connect(noteGain);
      noteGain.connect(voiceGain);
      osc.start(startTime);
      osc.stop(startTime + durationSec + 0.3);
      nodes.push(osc, noteGain);
    }
    return loopStart + piece.totalBeats * beatSec;
  }

  private startClassicalScheduler(layer: LayerRuntime, pieceId: string, out: AudioNode) {
    const ctx = this.ctx;
    if (!ctx) return;
    const nodes = layer.nodes;
    let nextLoopStart = this.scheduleClassicalLoop(pieceId, out, nodes, 0);
    // Pre-schedule one extra loop so even a heavily throttled checker
    // interval cannot open an audible gap.
    nextLoopStart = this.scheduleClassicalLoop(pieceId, out, nodes, nextLoopStart);
    const intervalId = window.setInterval(() => {
      const c = this.ctx;
      if (!c || c.state === "closed") return;
      // Top up while less than two minutes of music is scheduled ahead.
      while (nextLoopStart < c.currentTime + 120) {
        nextLoopStart = this.scheduleClassicalLoop(pieceId, out, nodes, nextLoopStart);
      }
    }, 5000);
    layer.scheduler = { intervalId, nextLoopStart, pieceId };
  }

  private stopLayerScheduler(layer: LayerRuntime) {
    if (layer.scheduler) {
      window.clearInterval(layer.scheduler.intervalId);
      layer.scheduler = undefined;
    }
  }

  // ── Layer lifecycle ───────────────────────────────────────────────────

  private createLayer(trackId: string, out: AudioNode, volume: number): LayerRuntime | null {
    const ctx = this.ensureContext();
    if (!ctx || !this.busIn && out !== this.busIn) return null;
    const gain = ctx.createGain();
    gain.gain.value = 0; // fades in
    gain.connect(out);
    const layer: LayerRuntime = { gain, volume, mute: false, solo: false, nodes: [gain], lfos: [] };
    this.synthesizeTrack(trackId, gain, layer.nodes, layer.lfos);
    if (CLASSICAL_PIECES[trackId]) this.startClassicalScheduler(layer, trackId, gain);
    return layer;
  }

  private ensureLayerRuntime(trackId: string, out: AudioNode, volume: number): LayerRuntime | null {
    if (!this.ensureContext()) return null;
    return this.createLayer(trackId, out, volume);
  }

  private teardownLayer(layer: LayerRuntime, fadeOutSeconds: number) {
    this.stopLayerScheduler(layer);
    const ctx = this.ctx;
    const doTeardown = () => {
      for (const lfo of layer.lfos) { try { lfo.stop(); } catch { /* already stopped */ } try { lfo.disconnect(); } catch { /* noop */ } }
      layer.lfos = [];
      for (const n of layer.nodes) { try { n.disconnect(); } catch { /* noop */ } }
      layer.nodes = [];
    };
    if (ctx && fadeOutSeconds > 0) {
      const t = ctx.currentTime;
      layer.gain.gain.cancelScheduledValues(t);
      layer.gain.gain.setValueAtTime(layer.gain.gain.value, t);
      layer.gain.gain.linearRampToValueAtTime(0, t + fadeOutSeconds);
      window.setTimeout(doTeardown, fadeOutSeconds * 1000 + 120);
    } else {
      doTeardown();
    }
  }

  private layerTargetGain(layer: LayerRuntime): number {
    const anySolo = this.baseLayer?.solo || Array.from(this.mixerLayers.values()).some((l) => l.solo);
    const audible = layer.mute ? false : anySolo ? layer.solo : true;
    return audible ? layer.volume : 0;
  }

  private refreshLayerGains(fade = true) {
    const apply = (layer: LayerRuntime) => {
      const target = this.layerTargetGain(layer);
      const t = nowSeconds(this.ctx);
      layer.gain.gain.cancelScheduledValues(t);
      if (fade && this.fadeSeconds > 0 && this.ctx) {
        layer.gain.gain.setTargetAtTime(target, t, this.fadeSeconds / 3);
      } else {
        layer.gain.gain.setValueAtTime(target, t);
      }
    };
    if (this.baseLayer) apply(this.baseLayer);
    for (const layer of this.mixerLayers.values()) apply(layer);
  }

  // ── Public API ────────────────────────────────────────────────────────

  get supported(): boolean {
    return typeof window !== "undefined" &&
      !!(window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
  }

  /** Fade-in duration for play/switch transitions (seconds). */
  setFade(seconds: number) {
    this.fadeSeconds = Math.max(0, Math.min(8, seconds));
  }

  get fade(): number {
    return this.fadeSeconds;
  }

  /** Start (or restart) the base track with a fade-in. */
  playBase(trackId: string, volume: number) {
    if (!this.ensureContext() || !this.busIn) return;
    this.volume = volume;
    this.applyMasterGain(false);
    if (this.baseLayer) {
      const old = this.baseLayer;
      this.baseLayer = null;
      this.teardownLayer(old, this.fadeSeconds); // crossfade: old fades out
    }
    this.baseLayer = this.ensureLayerRuntime(trackId, this.busIn, volume);
    this.refreshLayerGains(true);
  }

  stopBase(fadeOut = this.fadeSeconds) {
    if (this.baseLayer) {
      const old = this.baseLayer;
      this.baseLayer = null;
      this.teardownLayer(old, fadeOut);
    }
  }

  hasBase(): boolean {
    return this.baseLayer !== null;
  }

  startMixerLayer(index: number, trackId: string, volume: number) {
    if (!this.ensureContext() || !this.busIn) return;
    this.stopMixerLayer(index, 0);
    const layer = this.ensureLayerRuntime(trackId, this.busIn, volume);
    if (!layer) return;
    this.mixerLayers.set(index, layer);
    this.refreshLayerGains(true);
  }

  stopMixerLayer(index: number, fadeOut = this.fadeSeconds) {
    const layer = this.mixerLayers.get(index);
    if (!layer) return;
    this.mixerLayers.delete(index);
    this.teardownLayer(layer, fadeOut);
    this.refreshLayerGains();
  }

  stopAllMixerLayers(fadeOut = this.fadeSeconds) {
    for (const index of Array.from(this.mixerLayers.keys())) {
      this.stopMixerLayer(index, fadeOut);
    }
  }

  setLayerVolume(index: number, volume: number) {
    const layer = this.mixerLayers.get(index);
    if (!layer) return;
    layer.volume = Math.max(0, Math.min(1, volume));
    this.refreshLayerGains();
  }

  setLayerMute(index: number, mute: boolean) {
    const layer = this.mixerLayers.get(index);
    if (!layer) return;
    layer.mute = mute;
    this.refreshLayerGains();
  }

  setLayerSolo(index: number, solo: boolean) {
    const layer = this.mixerLayers.get(index);
    if (!layer) return;
    layer.solo = solo;
    this.refreshLayerGains();
  }

  setBaseMute(mute: boolean) {
    if (this.baseLayer) this.baseLayer.mute = mute;
    this.refreshLayerGains();
  }

  setVolume(volume: number) {
    this.volume = Math.max(0, Math.min(1, volume));
    this.applyMasterGain();
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    this.applyMasterGain();
  }

  /** True while Tutor (or any assistant) speech should sit on top. */
  setDucking(ducked: boolean) {
    if (this.ducked === ducked) return;
    this.ducked = ducked;
    this.applyMasterGain();
  }

  setPan(pan: number) {
    this.pan = Math.max(-1, Math.min(1, pan));
    if (this.panner && this.ctx) {
      this.panner.pan.setTargetAtTime(this.pan, this.ctx.currentTime, 0.05);
    }
  }

  get panValue(): number {
    return this.pan;
  }

  setEq(preset: EqPreset) {
    this.eq = preset;
    this.applyEq(preset);
  }

  get eqValue(): EqPreset {
    return this.eq;
  }

  private applyEq(preset: EqPreset, instant = false) {
    const cfg = EQ_PRESETS[preset];
    if (!this.ctx || !this.eqLow || !this.eqMid || !this.eqHigh) return;
    const t = nowSeconds(this.ctx);
    const apply = (node: BiquadFilterNode, db: number) => {
      node.gain.cancelScheduledValues(t);
      if (instant) node.gain.setValueAtTime(db, t);
      else node.gain.setTargetAtTime(db, t, 0.12);
    };
    apply(this.eqLow, cfg.low);
    apply(this.eqMid, cfg.mid);
    apply(this.eqHigh, cfg.high);
  }

  /** Is any sound-producing layer currently alive? */
  get active(): boolean {
    return this.baseLayer !== null || this.mixerLayers.size > 0;
  }

  mixerLayerCount(): number {
    return this.mixerLayers.size;
  }

  // ── Sleep timer ───────────────────────────────────────────────────────

  /**
   * Stop everything after `minutes`. A 5s gentle fade-out precedes the stop
   * and `onSleepFire` fires when the stop happens (so the UI can sync).
   */
  setSleepTimer(minutes: number, onSleepFire?: () => void) {
    this.cancelSleepTimer();
    if (minutes <= 0) return;
    this.onSleepFire = onSleepFire ?? null;
    const ms = minutes * 60_000;
    this.sleepFadeTimeoutId = window.setTimeout(() => {
      this.stopAllMixerLayers(5);
      this.stopBase(5);
    }, Math.max(0, ms - 5000));
    this.sleepTimerId = window.setTimeout(() => {
      this.sleepTimerId = null;
      this.sleepFadeTimeoutId = null;
      const cb = this.onSleepFire;
      this.onSleepFire = null;
      cb?.();
    }, ms);
  }

  cancelSleepTimer() {
    if (this.sleepTimerId !== null) window.clearTimeout(this.sleepTimerId);
    if (this.sleepFadeTimeoutId !== null) window.clearTimeout(this.sleepFadeTimeoutId);
    this.sleepTimerId = null;
    this.sleepFadeTimeoutId = null;
    this.onSleepFire = null;
  }

  get sleepTimerActive(): boolean {
    return this.sleepTimerId !== null;
  }

  // ── Status & cleanup ──────────────────────────────────────────────────

  /** Resume a suspended context (visibility change, OS interruption). */
  resume() {
    if (this.ctx && this.ctx.state === "suspended") {
      void this.ctx.resume().catch(() => {});
    }
  }

  outputStatus(): EngineOutputStatus {
    if (!this.ctx) {
      return { supported: this.supported, state: this.supported ? "suspended" : "unsupported", sampleRate: null, baseLatencyMs: null };
    }
    return {
      supported: true,
      state: this.ctx.state as EngineOutputStatus["state"],
      sampleRate: this.ctx.sampleRate ?? null,
      baseLatencyMs: typeof this.ctx.baseLatency === "number" ? Math.round(this.ctx.baseLatency * 1000) : null,
    };
  }

  /** Release the AudioContext entirely (provider unmount / page hide). */
  dispose() {
    this.disposed = true;
    this.cancelSleepTimer();
    this.stopBase(0);
    this.stopAllMixerLayers(0);
    if (this.ctx && this.ctx.state !== "closed") {
      void this.ctx.close().catch(() => {});
    }
    this.ctx = null;
    this.busIn = null;
    this.eqLow = null;
    this.eqMid = null;
    this.eqHigh = null;
    this.compressor = null;
    this.panner = null;
    this.master = null;
  }
}
