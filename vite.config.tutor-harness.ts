// TUTOR MOBILE HARNESS — vite config. Reuses the app's plugin stack but
// injects stub-module aliases ahead of the "@" catch-all so the REAL
// Tutor page mounts against canned backend data. Dev-only; never used by
// the production build.

import path from "path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const stub = (file: string) =>
  path.resolve(__dirname, "src/dev/tutor-harness", file);

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    dedupe: ["react", "react/jsx-runtime", "react-dom", "react-dom/client"],
    // Order matters: exact stub specifiers first, the "@" prefix last.
    alias: [
      { find: "@/convex/_generated/api", replacement: stub("stub-api.ts") },
      { find: "convex/react", replacement: stub("stub-convex-react.tsx") },
      { find: "@convex-dev/auth/react", replacement: stub("stub-convex-auth.tsx") },
      { find: "@/hooks/use-auth", replacement: stub("stub-use-auth.ts") },
      { find: "@/components/music-player", replacement: stub("stub-music-player.tsx") },
      { find: "@", replacement: path.resolve(__dirname, "./src") },
    ],
  },
  optimizeDeps: {
    // Only scan the harness entry — the real index.html pulls main.tsx and
    // the full production graph into the prebundle pass.
    entries: ["tutor-harness.html"],
    include: ["react", "react/jsx-runtime", "react-dom", "react-dom/client", "react-router", "framer-motion"],
  },
  server: {
    host: true,
    port: 5199,
    hmr: false,
  },
});
