// Harness-only Vite config — serves tutor-harness.html with the REAL pages
// mounted on STUBBED backend modules. The default `npm run dev` config is
// untouched; this exists so the tutor experience can be verified in a real
// browser without credentials, a Convex deployment or network access.
//
//   npx vite --config vite.config.harness.ts --port 5199
//   open http://localhost:5199/tutor-harness.html
//
// Aliases make every page graph import resolve to the harness stubs:
//   convex/react               → fixture-backed useQuery/useAction/useMutation
//   @/convex/_generated/api    → path-leaf proxy matched against fixtures
//   @/hooks/use-auth           → always signed-in stub user
//   @/components/music-player  → inert player shell
// The app's production build never touches this file.

import { defineConfig, mergeConfig, type Alias } from "vite";
import path from "path";
import baseConfig from "./vite.config";

// The base config declares alias as an object map — normalize both shapes
// into one array with the harness stubs FIRST (stubs win over the generic
// "@" → ./src mapping).
const baseAlias = baseConfig.resolve?.alias;
const baseAliasEntries: Alias[] = Array.isArray(baseAlias)
  ? baseAlias
  : baseAlias
    ? Object.entries(baseAlias).map(([find, replacement]) => ({
        find,
        replacement: String(replacement),
      }))
    : [{ find: "@", replacement: path.resolve(__dirname, "./src") }];

// mergeConfig(defaults, overrides) — the harness config MUST be the second
// argument, otherwise the base alias map wins and the real generated api
// module leaks into the page (its proxy FunctionReferences then blow up the
// fixture stub with "Cannot convert object to primitive value").
export default mergeConfig(
  baseConfig,
  defineConfig({
    resolve: {
      alias: [
        // Order matters: specific module stubs first, then the generic ones.
        {
          find: "@/convex/_generated/api",
          replacement: path.resolve(__dirname, "./src/dev/tutor-harness/stub-api.ts"),
        },
        {
          find: "convex/react",
          replacement: path.resolve(__dirname, "./src/dev/tutor-harness/stub-convex-react.tsx"),
        },
        {
          find: "@/hooks/use-auth",
          replacement: path.resolve(__dirname, "./src/dev/tutor-harness/stub-use-auth.ts"),
        },
        {
          find: "@/components/music-player",
          replacement: path.resolve(__dirname, "./src/dev/tutor-harness/stub-music-player.tsx"),
        },
        ...baseAliasEntries,
      ],
    },
  }),
);
