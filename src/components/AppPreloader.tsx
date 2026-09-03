// ═══════════════════════════════════════════════════════════════════════
// AppPreloader — "Quantum Nexus Boot" cinematic sequence
// ═══════════════════════════════════════════════════════════════════════
// Visual layers (bottom → top):
//   1. Deep-void background with radial cyan ambient glow
//   2. Film grain overlay (SVG fractal noise)
//   3. CRT scanline overlay
//   4. Perspective grid floor (Tron-style)
//   5. Energy wave pulses (expanding concentric rings)
//   6. Horizontal scan beam sweep
//   7. 3D Gyroscopic rings (3 rings at different 3D planes with tracker dots)
//   8. Central logo with intense bloom + glassmorphic frame
//   9. Character-by-character holographic text reveal
//  10. Cycling boot status messages (AnimatePresence)
//  11. Energy-shimmer progress line
//  12. HUD corner brackets with data labels
//  13. Floating particle field
//  EXIT: scale 1.1x + brightness flash + blur 30px + fade (warp effect)
// ═══════════════════════════════════════════════════════════════════════

import { AnimatePresence, motion } from "framer-motion";
import React, { useEffect } from "react";

/* ── Boot status messages ── */
const STATUS = [
  "INITIALIZING NEURAL CORE",
  "CONNECTING SYNAPSES",
  "LOADING KNOWLEDGE BASE",
  "SYSTEM READY",
] as const;

/* ── Floating particles (position, size, animation timing) ── */
const PARTICLES = [
  { top: "12%", left: "18%", size: 2, dur: 3, delay: 0, glow: true },
  { top: "20%", left: "85%", size: 1.5, dur: 3.5, delay: 0.8, glow: false },
  { top: "75%", left: "12%", size: 1, dur: 2.8, delay: 1.6, glow: false },
  { top: "82%", left: "80%", size: 2.5, dur: 3.2, delay: 0.4, glow: true },
  { top: "35%", left: "6%", size: 1, dur: 3.8, delay: 1.2, glow: false },
  { top: "30%", left: "93%", size: 1.5, dur: 2.5, delay: 2, glow: false },
  { top: "55%", left: "10%", size: 1, dur: 4, delay: 0.6, glow: false },
  { top: "60%", left: "88%", size: 2, dur: 3.3, delay: 1.4, glow: true },
  { top: "15%", left: "45%", size: 1, dur: 2.7, delay: 1.8, glow: false },
  { top: "70%", left: "30%", size: 1.5, dur: 3.6, delay: 0.2, glow: false },
  { top: "45%", left: "92%", size: 1, dur: 3.1, delay: 0.9, glow: false },
  { top: "8%", left: "65%", size: 1.5, dur: 2.9, delay: 1.5, glow: false },
] as const;

export default function AppPreloader({ ready }: { ready: boolean }) {
  const [statusIdx, setStatusIdx] = React.useState(0);

  useEffect(() => {
    /* Signal mount & hide the CSS-only boot screen from index.html */
    (window as unknown as Record<string, boolean>).__NEXUS_MOUNTED = true;
    const boot = document.getElementById("nexus-boot-screen");
    if (boot) {
      boot.classList.add("nexus-hidden");
      const onEnd = () => boot.remove();
      boot.addEventListener("transitionend", onEnd, { once: true });
      setTimeout(onEnd, 500);
    }
    /* Cycle status text */
    const iv = setInterval(() => setStatusIdx((p) => (p + 1) % STATUS.length), 380);
    return () => clearInterval(iv);
  }, []);

  return (
    <AnimatePresence>
      {!ready && (
        <motion.div
          key="nexus-preloader-v2"
          exit={{
            opacity: 0,
            scale: 1.1,
            filter: "blur(30px) brightness(1.6)",
          }}
          transition={{ duration: 0.65, ease: [0.22, 1, 0.36, 1] }}
          className="fixed inset-0 z-[100] flex flex-col items-center justify-center overflow-hidden"
          style={{ background: "#030308" }}
          role="status"
          aria-label="Loading NexET 🇪🇹"
        >
          {/* ══ LAYER 1: Deep ambient radial glow ══ */}
          <div
            className="absolute inset-0"
            style={{
              background:
                "radial-gradient(ellipse 50% 45% at 50% 48%, rgba(56,189,248,0.07) 0%, transparent 70%)",
            }}
          />

          {/* ══ LAYER 2: Film grain (SVG fractal noise) ══ */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              opacity: 0.035,
              backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.75' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`,
              backgroundSize: "150px 150px",
            }}
          />

          {/* ══ LAYER 3: CRT scanlines ══ */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              background:
                "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.018) 2px, rgba(0,0,0,0.018) 4px)",
            }}
          />

          {/* ══ LAYER 4: Perspective grid floor ══ */}
          <div
            className="absolute bottom-0 left-[-20%] right-[-20%] overflow-hidden"
            style={{ height: "55%" }}
          >
            <div
              style={{
                position: "absolute",
                inset: 0,
                backgroundImage:
                  "linear-gradient(rgba(56,189,248,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(56,189,248,0.04) 1px, transparent 1px)",
                backgroundSize: "48px 48px",
                transform: "perspective(350px) rotateX(65deg)",
                transformOrigin: "bottom center",
                maskImage:
                  "linear-gradient(to top, rgba(0,0,0,0.5) 0%, transparent 70%)",
                WebkitMaskImage:
                  "linear-gradient(to top, rgba(0,0,0,0.5) 0%, transparent 70%)",
              }}
            />
          </div>

          {/* ══ LAYER 5: Energy wave pulses ══ */}
          {[0, 1, 2, 3].map((i) => (
            <div
              key={`ep-${i}`}
              className="absolute rounded-full"
              style={{
                width: 80,
                height: 80,
                top: "50%",
                left: "50%",
                marginTop: -40,
                marginLeft: -40,
                border: "1px solid rgba(56,189,248,0.12)",
                animation: `v2-energy-pulse 2.8s ease-out ${i * 0.7}s infinite`,
              }}
            />
          ))}

          {/* ══ LAYER 6: Horizontal scan beam ══ */}
          <div
            className="absolute left-0 right-0 h-[2px]"
            style={{
              background:
                "linear-gradient(90deg, transparent 5%, rgba(56,189,248,0.3) 30%, rgba(56,189,248,0.55) 50%, rgba(56,189,248,0.3) 70%, transparent 95%)",
              animation: "preloader-scan-beam 1.6s ease-in-out 0.2s 1",
            }}
          />

          {/* ══ LAYER 7: 3D Gyroscopic rings ══ */}
          <div
            className="absolute"
            style={{
              width: 320,
              height: 320,
              top: "50%",
              left: "50%",
              marginTop: -160,
              marginLeft: -160,
              perspective: 900,
              transformStyle: "preserve-3d",
            }}
          >
            {/* Ring 1 — inner, fast, slight tilt */}
            <div
              className="absolute rounded-full"
              style={{
                inset: "40px",
                border: "1px solid rgba(56,189,248,0.18)",
                transformStyle: "preserve-3d",
                willChange: "transform",
                animation: "v2-gyro-1 3.5s linear infinite",
                boxShadow:
                  "0 0 30px rgba(56,189,248,0.04), inset 0 0 30px rgba(56,189,248,0.02)",
              }}
            >
              <div
                className="absolute rounded-full"
                style={{
                  top: -3,
                  left: "50%",
                  transform: "translateX(-50%)",
                  width: 6,
                  height: 6,
                  background: "#38bdf8",
                  boxShadow:
                    "0 0 10px #38bdf8, 0 0 20px rgba(56,189,248,0.5), 0 0 40px rgba(56,189,248,0.2)",
                }}
              />
            </div>

            {/* Ring 2 — middle, medium speed, heavy tilt */}
            <div
              className="absolute rounded-full"
              style={{
                inset: "5px",
                border: "1px solid rgba(56,189,248,0.1)",
                transformStyle: "preserve-3d",
                willChange: "transform",
                animation: "v2-gyro-2 5.5s linear infinite",
                boxShadow: "0 0 20px rgba(56,189,248,0.03)",
              }}
            >
              <div
                className="absolute rounded-full"
                style={{
                  top: -2.5,
                  left: "50%",
                  transform: "translateX(-50%)",
                  width: 5,
                  height: 5,
                  background: "rgba(56,189,248,0.8)",
                  boxShadow:
                    "0 0 8px rgba(56,189,248,0.6), 0 0 16px rgba(56,189,248,0.3)",
                }}
              />
            </div>

            {/* Ring 3 — outer, slow, opposite tilt */}
            <div
              className="absolute rounded-full"
              style={{
                inset: "-35px",
                border: "1px solid rgba(56,189,248,0.055)",
                transformStyle: "preserve-3d",
                willChange: "transform",
                animation: "v2-gyro-3 7.5s linear infinite",
              }}
            >
              <div
                className="absolute rounded-full"
                style={{
                  top: -2,
                  left: "50%",
                  transform: "translateX(-50%)",
                  width: 4,
                  height: 4,
                  background: "rgba(56,189,248,0.5)",
                  boxShadow: "0 0 6px rgba(56,189,248,0.4)",
                }}
              />
            </div>
          </div>

          {/* ══ LAYER 8: Central logo with intense bloom ══ */}
          <motion.div
            initial={{ opacity: 0, scale: 0.4, rotate: -15 }}
            animate={{ opacity: 1, scale: 1, rotate: 0 }}
            transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
            className="relative z-10"
          >
            {/* Bloom glow behind logo */}
            <div
              className="absolute inset-0 -m-14 rounded-full"
              style={{
                background:
                  "radial-gradient(circle, rgba(56,189,248,0.12) 0%, transparent 70%)",
                animation: "v2-bloom 2.2s ease-in-out infinite",
              }}
            />

            {/* Secondary outer bloom ring */}
            <div
              className="absolute inset-0 -m-20 rounded-full"
              style={{
                background:
                  "radial-gradient(circle, rgba(56,189,248,0.04) 0%, transparent 60%)",
                animation: "v2-bloom 3.5s ease-in-out 0.5s infinite",
              }}
            />

            {/* Glassmorphic frame */}
            <div
              className="relative flex size-[88px] items-center justify-center rounded-2xl"
              style={{
                border: "1px solid rgba(56,189,248,0.2)",
                background:
                  "linear-gradient(135deg, rgba(56,189,248,0.08), rgba(56,189,248,0.01))",
                boxShadow:
                  "0 0 80px -15px rgba(56,189,248,0.15), inset 0 1px 0 rgba(255,255,255,0.04), 0 0 0 1px rgba(56,189,248,0.08)",
                backdropFilter: "blur(12px)",
              }}
            >
              <div className="absolute inset-[1px] rounded-[14px] border border-white/[0.03]" />
              <span
                className="relative font-serif text-5xl font-black"
                style={{
                  background:
                    "linear-gradient(135deg, #67e8f9, #22d3ee, #06b6d4)",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                  animation: "v2-n-glow 2s ease-in-out infinite",
                  filter: "drop-shadow(0 0 18px rgba(34,211,238,0.4))",
                }}
              >
                N
              </span>
            </div>
          </motion.div>

          {/* ══ LAYER 9: Holographic text reveal ══ */}
          <div
            className="relative z-10 mt-8 flex items-center justify-center"
            style={{ height: 18 }}
          >
            <div className="flex">
              {"NEXUS ACADEMY".split("").map((char, i) => (
                <span
                  key={i}
                  className="inline-block font-mono text-[11px] font-bold uppercase tracking-[0.14em]"
                  style={{
                    color:
                      char === " "
                        ? "transparent"
                        : "rgba(56,189,248,0.5)",
                    width: char === " " ? "0.45em" : "auto",
                    animation: `v2-letter-in 0.5s ease-out ${0.35 + i * 0.035}s both`,
                  }}
                >
                  {char === " " ? "\u00A0" : char}
                </span>
              ))}
            </div>
          </div>

          {/* ══ LAYER 10: Cycling boot status ══ */}
          <div className="relative z-10 mt-2.5 h-3 overflow-hidden">
            <AnimatePresence mode="wait">
              <motion.span
                key={statusIdx}
                initial={{ opacity: 0, y: 6, filter: "blur(4px)" }}
                animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                exit={{ opacity: 0, y: -6, filter: "blur(4px)" }}
                transition={{ duration: 0.18 }}
                className="block font-mono text-[8px] font-semibold uppercase tracking-[0.22em]"
                style={{ color: "rgba(56,189,248,0.3)" }}
              >
                {STATUS[statusIdx]}
              </motion.span>
            </AnimatePresence>
          </div>

          {/* ══ LAYER 11: Energy-shimmer progress line ══ */}
          <div className="relative z-10 mt-3.5 h-px w-44 overflow-hidden rounded-full bg-white/[0.03]">
            <div
              className="h-full w-full origin-left"
              style={{
                background:
                  "linear-gradient(90deg, transparent 5%, rgba(56,189,248,0.15) 25%, rgba(56,189,248,0.6) 45%, rgba(56,189,248,0.85) 50%, rgba(56,189,248,0.6) 55%, rgba(56,189,248,0.15) 75%, transparent 95%)",
                animation: "preloader-bar-fill 1.8s ease-out 0.1s both",
              }}
            />
          </div>

          {/* ══ LAYER 12: HUD corner brackets ══ */}
          {/* Top-left */}
          <div
            className="absolute top-8 left-8"
            style={{ animation: "v2-fade-in 0.5s ease-out 0.2s both" }}
          >
            <div className="flex flex-col">
              <div className="flex items-center gap-0.5">
                <div className="h-px w-6 bg-gradient-to-r from-cyan-400/40 to-transparent" />
                <div className="w-1 h-1 rounded-full bg-cyan-400/30" />
              </div>
              <div className="flex items-start gap-0.5 mt-0.5">
                <div className="w-px h-6 bg-gradient-to-b from-cyan-400/40 to-transparent" />
                <div className="w-1 h-1 rounded-full bg-cyan-400/25 -ml-[3px] -mt-[3px]" />
              </div>
            </div>
            <div className="mt-2 font-mono text-[6px] font-bold uppercase tracking-[0.2em] text-cyan-400/20">
              NEXUS//BOOT
            </div>
          </div>

          {/* Top-right */}
          <div
            className="absolute top-8 right-8"
            style={{ animation: "v2-fade-in 0.5s ease-out 0.28s both" }}
          >
            <div className="flex flex-col items-end">
              <div className="flex items-center gap-0.5">
                <div className="w-1 h-1 rounded-full bg-cyan-400/30" />
                <div className="h-px w-6 bg-gradient-to-l from-cyan-400/40 to-transparent" />
              </div>
              <div className="flex items-end gap-0.5 mt-0.5">
                <div className="w-1 h-1 rounded-full bg-cyan-400/25 -mr-[3px] -mt-[3px]" />
                <div className="w-px h-6 bg-gradient-to-b from-cyan-400/40 to-transparent" />
              </div>
            </div>
            <div className="mt-2 font-mono text-[6px] font-bold uppercase tracking-[0.2em] text-cyan-400/20">
              v2.0
            </div>
          </div>

          {/* Bottom-left */}
          <div
            className="absolute bottom-8 left-8"
            style={{ animation: "v2-fade-in 0.5s ease-out 0.36s both" }}
          >
            <div className="flex flex-col items-start justify-end">
              <div className="flex items-start gap-0.5">
                <div className="w-px h-6 bg-gradient-to-t from-cyan-400/40 to-transparent" />
                <div className="w-1 h-1 rounded-full bg-cyan-400/25 -ml-[3px] -mb-[3px]" />
              </div>
              <div className="flex items-center gap-0.5 mt-0.5">
                <div className="h-px w-6 bg-gradient-to-r from-cyan-400/40 to-transparent" />
                <div className="w-1 h-1 rounded-full bg-cyan-400/30" />
              </div>
            </div>
          </div>

          {/* Bottom-right */}
          <div
            className="absolute bottom-8 right-8"
            style={{ animation: "v2-fade-in 0.5s ease-out 0.44s both" }}
          >
            <div className="flex flex-col items-end justify-end">
              <div className="flex items-start gap-0.5">
                <div className="w-1 h-1 rounded-full bg-cyan-400/25 -mr-[3px] -mb-[3px]" />
                <div className="w-px h-6 bg-gradient-to-t from-cyan-400/40 to-transparent" />
              </div>
              <div className="flex items-center gap-0.5 mt-0.5">
                <div className="w-1 h-1 rounded-full bg-cyan-400/30" />
                <div className="h-px w-6 bg-gradient-to-l from-cyan-400/40 to-transparent" />
              </div>
            </div>
          </div>

          {/* ══ LAYER 13: Floating particle field ══ */}
          {PARTICLES.map((p, i) => (
            <div
              key={`p-${i}`}
              className="absolute rounded-full"
              style={{
                width: p.size,
                height: p.size,
                top: p.top,
                left: p.left,
                background: "rgba(56,189,248,0.7)",
                boxShadow: p.glow
                  ? `0 0 ${p.size * 4}px rgba(56,189,248,0.4)`
                  : "none",
                animation: `v2-particle-float ${p.dur}s ease-in-out ${p.delay}s infinite`,
              }}
            />
          ))}

          <span className="sr-only">Loading NexET 🇪🇹…</span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
