import { useConvex } from "convex/react";
import { useEffect, useState } from "react";
import type { FunctionArgs, FunctionReference, FunctionReturnType } from "convex/server";

/**
 * Convex `useQuery` that never throws server errors into React render.
 *
 * Why this exists: the frontend on Vercel can briefly reference Convex
 * functions the live backend doesn't have yet — Vercel serves a new build in
 * ~30 seconds while the Convex deploy (GitHub Actions) lands a few minutes
 * later. During that window plain `useQuery` throws
 * "Could not find public function" and the nearest error boundary kills the
 * whole page. Students must never see that.
 *
 * Behavior: identical to `useQuery` while things are healthy (fully reactive
 * via the same watch subscription). When a query errors on the server —
 * missing function, version skew, transient backend error — it silently keeps
 * the last good value (or `undefined`, which looks exactly like "loading").
 * Every call site of this hook already handles `undefined` with `?.` / `??`
 * fallbacks, so the page stays fully alive and the affected feature just
 * degrades until the backend catches up (a page reload resubscribes).
 */
export function useQuerySafe<Query extends FunctionReference<"query">>(
  funcRef: Query,
  args?: FunctionArgs<Query> | "skip",
): FunctionReturnType<Query> | undefined {
  const client = useConvex();
  const [value, setValue] = useState<FunctionReturnType<Query> | undefined>(
    undefined,
  );
  const skip = args === "skip";
  // Stable identity for the effect; Convex args are plain JSON values.
  const argsKey = skip ? "skip" : JSON.stringify(args ?? {});

  useEffect(() => {
    if (skip) {
      setValue(undefined);
      return;
    }
    let alive = true;
    let unsubscribe: (() => void) | undefined;
    try {
      const watch = client.watchQuery(
        funcRef,
        (args ?? ({} as FunctionArgs<Query>)) as FunctionArgs<Query>,
      );
      unsubscribe = watch.onUpdate(() => {
        try {
          const result = watch.localQueryResult();
          if (alive) setValue(result);
        } catch {
          // Server-side query error: keep the last good value, never throw.
        }
      });
      try {
        setValue(watch.localQueryResult());
      } catch {
        // Same handling for the first (possibly errored) snapshot.
      }
    } catch {
      // Subscription setup failed — value stays undefined, page stays alive.
    }
    return () => {
      alive = false;
      try {
        unsubscribe?.();
      } catch {
        // noop
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, funcRef, argsKey, skip]);

  return value;
}
