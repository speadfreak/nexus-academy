import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { auth } from "./auth";
import { api } from "./_generated/api";

const http = httpRouter();

auth.addHttpRoutes(http);

// One-time seed endpoint for the subjects table. Idempotent (safe to call
// multiple times): POST /seed-subjects
//   curl -X POST <CONVEX_URL>/seed-subjects
http.route({
  path: "/seed-subjects",
  method: "POST",
  handler: httpAction(async (ctx) => {
    const result = await ctx.runMutation(api.subjects.seed);
    return new Response(JSON.stringify({ ok: true, ...result }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }),
});

export default http;
