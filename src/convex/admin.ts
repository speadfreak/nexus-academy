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
import { isCanonicalSuperAdminEmail } from "./canonicalAdmin";

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

// ── Admin existence (indexed, scan-free) ─────────────────────────────
// "Does any admin/moderator+ exist?" used to be answered by scanning the
// first 200 user documents. Two problems:
//   1. VOLUME: every isCurrentUserAdmin subscriber re-ran the scan, and the
//      scan's read set (200 user docs) was invalidated by ANY write to ANY
//      of those users — every OAuth sign-in patch of an early account
//      re-fired admin checks for every open client.
//   2. The read-set churn fed the Convex free-plan query spike.
// The users table now has a by_role index; three indexed first() lookups
// answer the question and the reactive read set only contains users whose
// role field actually matches an elevated role.

/** Roles at or above the admin threshold (moderator = 60). */
const ELEVATED_ROLES = [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.MODERATOR] as const;

/** Indexed existence check — three point lookups, zero scans. */
async function adminExistsIndexed(
  ctx: QueryCtx | MutationCtx | ActionCtx,
): Promise<boolean> {
  for (const role of ELEVATED_ROLES) {
    const row =
      "db" in ctx
        ? await ctx.db
            .query("users")
            .withIndex("by_role", (q) => q.eq("role", role))
            .first()
        : await ctx.runQuery(internal.admin.anyAdminRoleExists, { role });
    if (row) return true;
  }
  return false;
}

export const anyAdminRoleExists = internalQuery({
  args: { role: v.string() },
  handler: async (ctx, { role }) => {
    const row = await ctx.db
      .query("users")
      .withIndex("by_role", (q) => q.eq("role", role as Doc<"users">["role"]))
      .first();
    return row !== null;
  },
});

export const anyAdminExists = internalQuery({
  args: {},
  handler: async (ctx) => adminExistsIndexed(ctx),
});

/** All admin/moderator+ user ids — used to route safety reports. */
export const listAdminUserIds = internalQuery({
  args: {},
  handler: async (ctx) => {
    // Indexed per elevated role (by_role) — never scan the whole users table.
    const ids: Id<"users">[] = [];
    for (const role of ELEVATED_ROLES) {
      const rows = await ctx.db
        .query("users")
        .withIndex("by_role", (q) => q.eq("role", role))
        .collect();
      for (const row of rows) ids.push(row._id);
    }
    return ids;
  },
});

/** Count super_admins (used by removeAdmin safeguard) — indexed, scan-free. */
export const countSuperAdmins = internalQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("users")
      .withIndex("by_role", (q) => q.eq("role", ROLES.SUPER_ADMIN))
      .collect();
    return rows.length;
  },
});

// ── Admin check with bootstrap ───────────────────────────────────────

/**
 * Read-only admin check (safe from queries AND actions — never writes).
 *
 * Two ways to be an admin:
 *   1. CANONICAL OWNER: the user's email is on SUPER_ADMIN_EMAILS — always
 *      true, even before the role is persisted. Gated mutations persist
 *      super_admin lazily via requireRoleInternal.
 *   2. PERSISTED ROLE: role level >= 60 (moderator+).
 *
 * The old "first non-anonymous user becomes admin" bootstrap is GONE —
 * ownership is pinned to the canonical email allowlist, so nobody can
 * claim the admin surface by merely being first.
 */
export async function isAdmin(
  ctx: AnyCtx,
  user: UserDoc | null,
): Promise<boolean> {
  if (!user || user.isAnonymous) return false;
  if (isCanonicalSuperAdminEmail(user.email)) return true;
  return isAdminDoc(user);
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
    // Canonical owners are super_admins even before the role is persisted
    // (persistence happens on the first gated mutation/action).
    const role = admin ? (user?.role ?? ROLES.SUPER_ADMIN) : null;
    return { isAdmin: admin, role };
  },
});

/**
 * Rich admin identity for the Admin workspace shell:
 * { isAdmin, role, isCanonical, email }. The workspace uses isCanonical to
 * run the one-time canonical enforcement sweep (enforceCanonicalAdmins).
 */
export const getCurrentAdminInfo = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUserFromDb(ctx);
    if (!user) return { isAdmin: false, role: null, isCanonical: false, email: null };
    const admin = await isAdmin(ctx, user);
    return {
      isAdmin: admin,
      role: admin ? (user.role ?? ROLES.SUPER_ADMIN) : null,
      isCanonical: isCanonicalSuperAdminEmail(user.email),
      email: user.email ?? null,
    };
  },
});

/**
 * CANONICAL ENFORCEMENT SWEEP — one idempotent mutation that makes the
 * platform ownership match the allowlist:
 *
 *   1. Caller must be signed in with a canonical owner email.
 *   2. Caller is promoted to super_admin (persisted).
 *   3. EVERY other elevated account (super_admin/admin/moderator) is
 *      demoted to plain "user" via the by_role index.
 *   4. Unclaimed pending admin invites for non-canonical emails are voided.
 *   5. One audit entry records exactly what changed.
 *
 * Safe to call repeatedly (the Admin page calls it once per session when
 * the canonical owner signs in) — the second run finds nothing to change.
 */
export const enforceCanonicalAdmins = mutation({
  args: {},
  handler: async (ctx): Promise<{
    ok: boolean;
    promotedSelf: boolean;
    demoted: { email: string | null; role: string }[];
    invitesVoided: number;
  }> => {
    const user = await getCurrentUserFromDb(ctx);
    if (!user || user.isAnonymous) {
      throw new ConvexError({ message: "Sign in required.", code: "unauthorized" });
    }
    if (!isCanonicalSuperAdminEmail(user.email)) {
      throw new ConvexError({ message: "Admin access required.", code: "unauthorized" });
    }

    // 1. Persist the owner's super_admin role.
    let promotedSelf = false;
    if (getUserRoleLevel(user) < (ROLE_LEVELS[ROLES.SUPER_ADMIN] ?? 100)) {
      await ctx.db.patch(user._id, { role: ROLES.SUPER_ADMIN });
      promotedSelf = true;
    }

    // 2. Demote every non-canonical elevated account (indexed by role).
    const demoted: { email: string | null; role: string }[] = [];
    for (const role of ELEVATED_ROLES) {
      const rows = await ctx.db
        .query("users")
        .withIndex("by_role", (q) => q.eq("role", role))
        .collect();
      for (const row of rows) {
        if (row._id === user._id) continue;
        if (isCanonicalSuperAdminEmail(row.email)) continue; // never demote an owner
        await ctx.db.patch(row._id, { role: ROLES.USER });
        demoted.push({ email: row.email ?? null, role });
      }
    }

    // 3. Void unclaimed pending admin invites for non-canonical emails.
    let invitesVoided = 0;
    const invites = await ctx.db.query("pendingAdminInvites").collect();
    for (const invite of invites) {
      if (invite.claimed) continue;
      if (isCanonicalSuperAdminEmail(invite.email)) continue;
      await ctx.db.patch(invite._id, { claimed: true });
      invitesVoided += 1;
    }

    // 4. Audit (one entry, exact changes).
    await ctx.db.insert("adminAuditLog", {
      actorUserId: user._id,
      action: "admin.canonical_enforced",
      targetType: "user",
      targetId: user._id,
      details: JSON.stringify({
        ownerEmail: user.email ?? null,
        promotedSelf,
        demoted,
        invitesVoided,
      }),
      createdAt: Date.now(),
    });
    await ctx.runMutation(internal.systemEvents.logEvent, {
      eventType: "auth_event",
      source: "admin.canonicalEnforced",
      status: "success",
      userId: user._id,
      metadata: JSON.stringify({ promotedSelf, demotedCount: demoted.length, invitesVoided }),
    });

    return { ok: true, promotedSelf, demoted, invitesVoided };
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

  // Canonical platform owner: persist super_admin on first gated call.
  if (isCanonicalSuperAdminEmail(user.email)) {
    if (getUserRoleLevel(user) < (ROLE_LEVELS[ROLES.SUPER_ADMIN] ?? 100)) {
      await promote(user._id);
      const promoted = await getUser();
      if (promoted) return promoted;
    }
    return user;
  }

  const userLevel = getUserRoleLevel(user);
  const minLevel = ROLE_LEVELS[minRole] ?? 0;

  // If user already has sufficient role, return immediately.
  if (userLevel >= minLevel) return user;

  // NOTE: the old "no admin exists yet → first user becomes super_admin"
  // bootstrap is intentionally gone. Ownership is pinned to the canonical
  // email allowlist; everybody else gets a hard denial.
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
 * Public mutation so the canonical owner can persist their super_admin role
 * from the admin page itself. Only the canonical owner email is eligible —
 * there is no other promotion path.
 */
export const promoteSelfIfBootstrap = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUserFromDb(ctx);
    if (!user) return { promoted: false, reason: "signed-out" as const };
    if (!isCanonicalSuperAdminEmail(user.email)) {
      return { promoted: false, reason: "not-canonical" as const };
    }
    if (user.role !== ROLES.SUPER_ADMIN && user.role !== ROLES.ADMIN && user.role !== ROLES.MODERATOR) {
      await ctx.db.patch(user._id, { role: ROLES.SUPER_ADMIN });
    }
    return { promoted: true, reason: "canonical" as const };
  },
});
