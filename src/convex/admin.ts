import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type ActionCtx,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";

type DbCtx = QueryCtx | MutationCtx;
type AnyCtx = DbCtx | ActionCtx;
export type UserDoc = Doc<"users">;

/** Direct role-field check. */
export function isAdminDoc(user: UserDoc | null | undefined): boolean {
  return user?.role === "admin";
}

async function getCurrentUserFromDb(ctx: DbCtx): Promise<UserDoc | null> {
  const userId = await getAuthUserId(ctx);
  if (userId === null) return null;
  return (await ctx.db.get(userId)) ?? null;
}

// --- Internal read helpers (used by actions via ctx.runQuery) ------------

export const getUserById = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => (await ctx.db.get(userId)) ?? null,
});

export const anyAdminExists = internalQuery({
  args: {},
  handler: async (ctx) => {
    const admins = await ctx.db
      .query("users")
      .filter((q) => q.eq(q.field("role"), "admin"))
      .take(1);
    return admins.length > 0;
  },
});

async function adminExistsFromDb(ctx: DbCtx): Promise<boolean> {
  const admins = await ctx.db
    .query("users")
    .filter((q) => q.eq(q.field("role"), "admin"))
    .take(1);
  return admins.length > 0;
}

/**
 * Read-only admin check (safe from queries AND actions — never writes).
 *
 * A user is an admin when their `role` field is "admin". As a v1 bootstrap
 * (proper RBAC comes later), when NO admin exists yet, the first
 * non-anonymous user (an email account) is treated as an admin so the
 * platform owner can start uploading content immediately. The promotion is
 * persisted the first time an admin-gated mutation/action runs via
 * requireAdminMutation / requireAdminAction.
 */
export async function isAdmin(
  ctx: AnyCtx,
  user: UserDoc | null,
): Promise<boolean> {
  if (isAdminDoc(user)) return true;
  if (!user || user.isAnonymous) return false;
  const adminExists = "db" in ctx
    ? await adminExistsFromDb(ctx)
    : await ctx.runQuery(internal.admin.anyAdminExists);
  return !adminExists;
}

/** Frontend-facing query: is the signed-in user allowed to see admin UI? */
export const isCurrentUserAdmin = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUserFromDb(ctx);
    return isAdmin(ctx, user);
  },
});

async function getCurrentUserFromAction(ctx: ActionCtx): Promise<UserDoc | null> {
  const userId = await getAuthUserId(ctx);
  if (userId === null) return null;
  return ctx.runQuery(internal.admin.getUserById, { userId });
}

async function requireAdminInternal(
  ctx: MutationCtx | ActionCtx,
  getUser: () => Promise<UserDoc | null>,
  promote: (userId: Id<"users">) => Promise<void>,
): Promise<UserDoc> {
  const user = await getUser();
  if (!user || !(await isAdmin(ctx, user))) {
    throw new ConvexError({
      message: "Admin access required. Sign in with an admin account.",
      code: "unauthorized",
    });
  }
  if (user.role !== "admin") {
    // Persist the first-user bootstrap promotion.
    await promote(user._id);
  }
  return user;
}

/** For mutations: verifies admin and persists bootstrap promotion. */
export async function requireAdminMutation(ctx: MutationCtx): Promise<UserDoc> {
  return requireAdminInternal(
    ctx,
    () => getCurrentUserFromDb(ctx),
    (userId) => ctx.db.patch(userId, { role: "admin" }),
  );
}

/** Internal mutation used by actions to persist bootstrap promotion. */
export const promoteToAdmin = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    await ctx.db.patch(userId, { role: "admin" });
  },
});

/** For actions: verifies admin and persists bootstrap promotion via runMutation. */
export async function requireAdminAction(ctx: ActionCtx): Promise<UserDoc> {
  return requireAdminInternal(
    ctx,
    () => getCurrentUserFromAction(ctx),
    async (userId) => {
      await ctx.runMutation(internal.admin.promoteToAdmin, { userId });
    },
  );
}

/**
 * Public mutation so an eligible (first) user can request promotion from the
 * admin page itself. Only works while no admin account exists yet.
 */
export const promoteSelfIfBootstrap = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUserFromDb(ctx);
    if (!user) return { promoted: false, reason: "signed-out" as const };
    if (!(await isAdmin(ctx, user))) {
      return { promoted: false, reason: "admin-exists" as const };
    }
    if (user.role !== "admin") {
      await ctx.db.patch(user._id, { role: "admin" });
    }
    return { promoted: true, reason: "bootstrap" as const };
  },
});
