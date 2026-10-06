import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { defineConfig } from "vite";

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // Strip `crossorigin` from built <script> tags.  Cloudflare CDN (fronting
    // Render) does not always return Access-Control-Allow-Origin for JS assets,
    // and the crossorigin attribute forces the browser into CORS mode for every
    // dynamic import() — producing "Failed to fetch dynamically imported module"
    // even when all chunk files exist and return HTTP 200.
    {
      name: 'strip-crossorigin',
      enforce: 'post',
      transformIndexHtml(html) {
        return html.replace(/ crossorigin(?= |>|\/>)/g, '');
      },
    },
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    // Force a single copy of React across all packages (including vlyPlugin).
    // Without this, @vly-ai/integrations can resolve its own React copy, which
    // triggers "Invalid hook call" errors at runtime.
    dedupe: ["react", "react/jsx-runtime", "react-dom", "react-dom/client"],
  },
  build: {
    // Enable source maps for better debugging (disable in production if needed)
    sourcemap: false,
    // Optimize chunk splitting
    rollupOptions: {
      output: {
        // Manual chunk splitting for better caching and lazy loading.
        // NOTE: no forced 'radix-ui' mega-chunk — forcing all 24 radix
        // packages into one chunk made the BOOT payload download every
        // primitive (dialog, carousel, menubar…) even though the entry
        // graph uses only a handful. Split naturally, each radix package
        // travels with the routes/components that import it.
        //
        // NOTE: no forced 'charts'/'forms' chunks either. Listing recharts
        // (or react-hook-form) as a manual chunk glues the whole library
        // into one file; when the entry graph shares even a few tiny
        // bindings with that file, the browser must download ALL 425KB of
        // recharts at boot before first paint. Natural splitting keeps
        // recharts inside the lazy Admin/Journey chunks where it belongs.
        manualChunks: {
          // Vendor chunks for large libraries
          'react-vendor': ['react', 'react-dom', 'react-router'],
          'convex-vendor': ['convex'],
          'framer-motion': ['framer-motion'],
        },
        // Optimize chunk size
        chunkFileNames: 'assets/[name]-[hash].js',
        entryFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]',
      },
    },
    // Increase chunk size warning limit for better chunking
    chunkSizeWarningLimit: 1000,
    // Target modern browsers for better optimization
    target: 'esnext',
    // Minify options - using esbuild (faster than terser)
    minify: 'esbuild',
    // Disable module preload polyfill to remove the crossorigin attribute from
    // <script> and <link rel=modulepreload> tags.  Cloudflare CDN (fronting
    // Render) doesn't always propagate Access-Control-Allow-Origin for JS
    // modules, and the crossorigin attribute makes the browser enforce CORS on
    // all dynamic import() calls — causing "Failed to fetch dynamically
    // imported module" errors on deployed builds even when every chunk file
    // exists and returns HTTP 200.
    modulePreload: false,
  },
  // Optimize dependencies
  optimizeDeps: {
    // Only scan the app entry HTML; avoids crawling unrelated *.html files
    // if a legacy snapshot accidentally contains leaked package folders.
    entries: ['index.html'],
    include: [
      'react',
      'react/jsx-runtime',
      'react-dom',
      'react-dom/client',
      'react-router',
      '@convex-dev/auth/react',
      'framer-motion',
    ],
  },
  // Performance hints
  server: {
    // Bind to all interfaces so WebContainer's server-ready event fires.
    host: true,
    port: 5173,
    // Freebuff requires HMR to stay disabled: the preview is served through
    // the platform's toolbox proxy, which does not route websocket upgrades
    // (the /upgrade path) to the sandbox container. With hmr: false, Vite
    // does a full-page reload on change instead of opening a websocket, and
    // the preview works through the proxy. Do not re-enable HMR here.
    hmr: false,
  },
});
