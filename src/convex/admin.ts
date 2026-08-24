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
import { ROLE_LEVELS, ROLES } from "./schema";

type DbCtx = QueryCtx | MutationCtx;
type AnyCtx = DbCtx | ActionCtx;
export type UserDoc = Doc<"users">;

// ── Role helpers ─────────────────────────────────────────────────────

/** Minimum role level that counts as "admin" (moderator and above). */
const ADMIN_MIN_LEVEL = ROLE_LEVELS[ROLES.MODERATOR]; // 60

/** Get a user's numeric role level (defaults to user level for no role). */
export function getUserRoleLevel(user: UserDoc | null | undefined): number {
  if (!user?.role) return ROLE_LEVELS[ROLES.USER];
  return ROLE_LEVELS[user.role] ?? ROLE_LEVELS[ROLES.USER];
}

/** True if the user's role level meets or exceeds the given minimum role. */
export function hasMinRole(
  user: UserDoc | null | undefined,
  minRole: string,
): boolean {
  const userLevel = getUserRoleLevel(user);
  const minLevel = ROLE_LEVELS[minRole] ?? 0;
  return userLevel >= minLevel;
}

/** Direct role-field check: true if user is moderator or above. */
export function isAdminDoc(user: UserDoc | null | undefined): boolean {
  return getUserRoleLevel(user) >= ADMIN_MIN_LEVEL;
}

// ── Internal DB reads ────────────────────────────────────────────────

async function getCurrentUserFromDb(ctx: DbCtx): Promise<UserDoc | null> {
  const userId = await getAuthUserId(ctx);
  if (userId === null) return null;
  return (await ctx.db.get(userId)) ?? null;
}

export const getUserById = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => (await ctx.db.get(userId)) ?? null,
});

/** Internal: get user by email (for invite claiming). */
export const getUserByEmail = internalQuery({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    return await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", email))
      .first();
  },
});

export const anyAdminExists = internalQuery({
  args: {},
  handler: async (ctx) => {
    const users = await ctx.db.query("users").take(200);
    return users.some((u) => getUserRoleLevel(u) >= ADMIN_MIN_LEVEL);
  },
});

/** All admin/moderator+ user ids — used to route safety reports. */
export const listAdminUserIds = internalQuery({
  args: {},
  handler: async (ctx) => {
    const allUsers = await ctx.db.query("users").take(200);
    return allUsers
      .filter((u) => getUserRoleLevel(u) >= ADMIN_MIN_LEVEL)
      .map((u) => u._id);
  },
});

async function adminExistsFromDb(ctx: DbCtx): Promise<boolean> {
  const allUsers = await ctx.db.query("users").take(200);
  return allUsers.some((u) => getUserRoleLevel(u) >= ADMIN_MIN_LEVEL);
}

/** Count super_admins (used by removeAdmin safeguard). */
export const countSuperAdmins = internalQuery({
  args: {},
  handler: async (ctx) => {
    const allUsers = await ctx.db.query("users").take(200);
    return allUsers.filter((u) => u.role === ROLES.SUPER_ADMIN).length;
  },
});

// ── Admin check with bootstrap ───────────────────────────────────────

/**
 * Read-only admin check (safe from queries AND actions — never writes).
 *
 * A user is an admin when their role level >= 60 (moderator+). As a
 * bootstrap, when NO admin exists yet, the first non-anonymous user is
 * treated as an admin so the platform owner can get started. The promotion
 * is persisted to super_admin the first time a gated mutation/action runs.
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

// ── Frontend-facing queries ──────────────────────────────────────────

/**
 * Returns the current user's role (or null). Used by the frontend to
 * determine which admin tabs/features are available.
 */
export const getCurrentAdminRole = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUserFromDb(ctx);
    if (!user) return null;
    if (isAdminDoc(user)) return user.role ?? null;
    return null;
  },
});

/** True if the current user is a super_admin. */
export const isCurrentUserSuperAdmin = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUserFromDb(ctx);
    return user?.role === ROLES.SUPER_ADMIN;
  },
});

/**
 * Returns { isAdmin: boolean, role: string | null } for the current user.
 * Kept under the old name for backward compatibility.
 */
export const isCurrentUserAdmin = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUserFromDb(ctx);
    const admin = await isAdmin(ctx, user);
    // Bootstrap admins are super_admins — report the role immediately
    // even before it's persisted to the DB (persistence happens on first
    // gated mutation/action).
    const role = admin ? (user?.role ?? ROLES.SUPER_ADMIN) : null;
    return { isAdmin: admin, role };
  },
});

/** New name, same function for clarity in new code. */
export const getAdminInfo = isCurrentUserAdmin;

// ── Action context helpers ───────────────────────────────────────────

async function getCurrentUserFromAction(ctx: ActionCtx): Promise<UserDoc | null> {
  const userId = await getAuthUserId(ctx);
  if (userId === null) return null;
  return ctx.runQuery(internal.admin.getUserById, { userId });
}

// ── Require-role patterns ────────────────────────────────────────────

/**
 * Require the caller to have at least `minRole` level.
 * Returns the user doc. Works in MutationCtx and ActionCtx.
 */
async function requireRoleInternal(
  ctx: MutationCtx | ActionCtx,
  minRole: string,
  getUser: () => Promise<UserDoc | null>,
  promote: (userId: Id<"users">) => Promise<void>,
): Promise<UserDoc> {
  const user = await getUser();

  // Bootstrap: first non-anonymous user becomes super_admin
  if (!user || user.isAnonymous) {
    throw new ConvexError({
      message: "Sign in required.",
      code: "unauthorized",
    });
  }

  const userLevel = getUserRoleLevel(user);
  const minLevel = ROLE_LEVELS[minRole] ?? 0;

  // If user already has sufficient role, return immediately.
  if (userLevel >= minLevel) return user;

  // User's role is too low — try bootstrap promotion.
  const isBootstrap = "db" in ctx
    ? !(await adminExistsFromDb(ctx))
    : !(await ctx.runQuery(internal.admin.anyAdminExists));

  if (isBootstrap) {
    // No admin exists yet — promote this user to super_admin.
    await promote(user._id);
    const promoted = await getUser();
    if (!promoted || getUserRoleLevel(promoted) < minLevel) {
      throw new ConvexError({
        message: `Access denied. Required: ${minRole}.`,
        code: "unauthorized",
      });
    }
    return promoted;
  }

  throw new ConvexError({
    message: `Access denied. Required: ${minRole}.`,
    code: "unauthorized",
  });
}

/**
 * For mutations: verifies admin (moderator+) and persists bootstrap.
 * Returns the user doc AND their role.
 */
export async function requireAdminMutation(
  ctx: MutationCtx,
): Promise<{ user: UserDoc; role: string }> {
  const user = await requireRoleInternal(
    ctx,
    ROLES.MODERATOR,
    () => getCurrentUserFromDb(ctx),
    (userId) => ctx.db.patch(userId, { role: ROLES.SUPER_ADMIN }),
  );
  return { user, role: user.role ?? ROLES.USER };
}

/**
 * For actions: verifies admin (moderator+) and persists bootstrap.
 * Returns the user doc AND their role.
 */
export async function requireAdminAction(
  ctx: ActionCtx,
): Promise<{ user: UserDoc; role: string }> {
  const user = await requireRoleInternal(
    ctx,
    ROLES.MODERATOR,
    () => getCurrentUserFromAction(ctx),
    async (userId) => {
      await ctx.runMutation(internal.admin.promoteToAdmin, { userId });
    },
  );
  return { user, role: user.role ?? ROLES.USER };
}

/**
 * Require super_admin specifically. For mutations.
 */
export async function requireSuperAdminMutation(
  ctx: MutationCtx,
): Promise<UserDoc> {
  const user = await requireRoleInternal(
    ctx,
    ROLES.SUPER_ADMIN,
    () => getCurrentUserFromDb(ctx),
    (userId) => ctx.db.patch(userId, { role: ROLES.SUPER_ADMIN }),
  );
  return user;
}

/**
 * Require super_admin specifically. For actions.
 */
export async function requireSuperAdminAction(
  ctx: ActionCtx,
): Promise<UserDoc> {
  const user = await requireRoleInternal(
    ctx,
    ROLES.SUPER_ADMIN,
    () => getCurrentUserFromAction(ctx),
    async (userId) => {
      await ctx.runMutation(internal.admin.promoteToAdmin, { userId });
    },
  );
  return user;
}

/** Internal mutation used by actions to persist bootstrap promotion. */
export const promoteToAdmin = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    await ctx.db.patch(userId, { role: ROLES.SUPER_ADMIN });
  },
});

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
    if (user.role !== ROLES.SUPER_ADMIN && user.role !== ROLES.ADMIN && user.role !== ROLES.MODERATOR) {
      await ctx.db.patch(user._id, { role: ROLES.SUPER_ADMIN });
    }
    return { promoted: true, reason: "bootstrap" as const };
  },
});
