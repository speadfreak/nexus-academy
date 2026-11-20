// Convex app configuration — component registrations.
//
// The AI tutor uses the @convex-dev/rate-limiter component for per-user
// fairness limits (messages/hour). See aiRouter.ts for the limits and
// README.md ("AI Tutor reliability layer") for the env vars the router
// itself needs.
//
// NOTE: `npx convex deploy` / `npx convex dev` regenerates _generated/api.*
// from this file. The checked-in stub keeps local `tsc -b` typechecks green
// between deploys; deploy-time codegen replaces it with the identical shape.

import { defineApp } from "convex/server";
import rateLimiter from "@convex-dev/rate-limiter/convex.config.js";

const app = defineApp();
app.use(rateLimiter, { name: "rateLimiter" });

export default app;
