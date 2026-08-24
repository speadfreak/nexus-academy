// Admin management — CRUD operations for admin roles, invites, and audit log.
// Actions call internal mutations/queries for all DB writes.

import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import {
  action,
  internalMutation,
  internalQuery,
  query,
  type ActionCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { adminRoleValidator, ROLE_LEVELS, ROLES } from "./schema";
import { requireSuperAdminAction, getUserRoleLevel } from "./admin";

// ── Internal audit log writer ─────────────────────────────────────────

export const internalInsertAuditLog = internalMutation({
  args: {
    actorUserId: v.id("users"),
    action: v.string(),
    targetType: v.optional(v.string()),
    targetId: v.optional(v.string()),
    details: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("adminAuditLog", {
      ...args,
      createdAt: Date.now(),
    });
  },
});

/** Write an audit log entry. Called from actions. */
async function writeAuditLog(
  ctx: ActionCtx,
  params: {
    actorUserId: Id<"users">;
    action: string;
    targetType?: string;
    targetId?: string;
    details?: string;
  },
) {
  await ctx.runMutation(internal.adminManagement.internalInsertAuditLog, params);
}

// ── Invite admin ──────────────────────────────────────────────────────

export const inviteAdmin = action({
  args: {
    email: v.string(),
    role: adminRoleValidator,
  },
  handler: async (ctx, args) => {
    const inviter = await requireSuperAdminAction(ctx);

    const email = args.email.toLowerCase().trim();
    const intendedRole = args.role;

    // super_admin cannot be assigned via invite
    if (intendedRole === ROLES.SUPER_ADMIN) {
      throw new ConvexError({
        message: "Cannot invite a user as super_admin.",
        code: "invalid",
      });
    }

    // Check if user already exists
    const existingUser = await ctx.runQuery(internal.admin.getUserByEmail, {
      email,
    });

    if (existingUser) {
      // Patch role directly
      const oldRole = existingUser.role ?? ROLES.USER;
      await ctx.runMutation(internal.adminManagement.patchUserRole, {
        userId: existingUser._id,
        newRole: intendedRole,
      });

      await writeAuditLog(ctx, {
        actorUserId: inviter._id,
        action: "admin.role_changed",
        targetType: "user",
        targetId: existingUser._id,
        details: JSON.stringify({
          email,
          oldRole,
          newRole: intendedRole,
          method: "direct",
        }),
      });

      return { success: true, userExists: true };
    }

    // User doesn't exist yet — create a pending invite
    await ctx.runMutation(internal.adminManagement.insertPendingInvite, {
      email,
      intendedRole,
      invitedBy: inviter._id,
    });

    await writeAuditLog(ctx, {
      actorUserId: inviter._id,
      action: "admin.invited",
      targetType: "user",
      targetId: email,
      details: JSON.stringify({
        email,
        intendedRole,
      }),
    });

    return { success: true, userExists: false };
  },
});

// ── List admins ───────────────────────────────────────────────────────

export const listAdmins = action({
  args: {},
  handler: async (ctx): Promise<{ admins: Array<{ _id: string; name: string | null; email: string | null; role: string; isAnonymous: boolean; lastActiveAt: number | null }>; pendingInvites: Array<{ _id: string; email: string; intendedRole: string; invitedBy: string; createdAt: number }> }> => {
    await requireSuperAdminAction(ctx);

    // Get all users and filter for admin roles
    const allUsers: Array<Record<string, unknown>> = await ctx.runQuery(internal.adminManagement.getAllUsers);
    const adminUsers = allUsers.filter(
      (u) => getUserRoleLevel(u as Parameters<typeof getUserRoleLevel>[0]) >= ROLE_LEVELS[ROLES.MODERATOR],
    );

    // Get last active timestamp from studySessions for each admin
    const admins = await Promise.all(
      adminUsers.map(async (u) => {
        const lastSession = await ctx.runQuery(
          internal.adminManagement.getLastSession,
          { userId: u._id as string },
        );
        return {
          _id: u._id as string,
          name: (u.name as string | null | undefined) ?? null,
          email: (u.email as string | null | undefined) ?? null,
          role: ((u.role as string | undefined) ?? ROLES.USER),
          isAnonymous: (u.isAnonymous as boolean | undefined) ?? false,
          lastActiveAt: (lastSession as Record<string, unknown> | null)?.endedAt as number | null ?? null,
        };
      }),
    );

    // Get pending invites
    const pendingInvites: Array<Record<string, unknown>> = await ctx.runQuery(
      internal.adminManagement.getPendingInvites,
    );

    return { admins, pendingInvites: pendingInvites as Array<{ _id: string; email: string; intendedRole: string; invitedBy: string; createdAt: number }> };
  },
});

// ── Change admin role ─────────────────────────────────────────────────

export const changeAdminRole = action({
  args: {
    targetUserId: v.id("users"),
    newRole: adminRoleValidator,
  },
  handler: async (ctx, args) => {
    const caller = await requireSuperAdminAction(ctx);
    const { targetUserId, newRole } = args;

    // Cannot change own role
    if (caller._id === targetUserId) {
      throw new ConvexError({
        message: "Cannot change your own role.",
        code: "invalid",
      });
    }

    // Get target user
    const targetUser = await ctx.runQuery(internal.admin.getUserById, {
      userId: targetUserId,
    });
    if (!targetUser) {
      throw new ConvexError({
        message: "User not found.",
        code: "not_found",
      });
    }

    const oldRole = targetUser.role ?? ROLES.USER;

    // Patch the role
    await ctx.runMutation(internal.adminManagement.patchUserRole, {
      userId: targetUserId,
      newRole,
    });

    await writeAuditLog(ctx, {
      actorUserId: caller._id,
      action: "admin.role_changed",
      targetType: "user",
      targetId: targetUserId,
      details: JSON.stringify({
        targetEmail: targetUser.email,
        oldRole,
        newRole,
      }),
    });

    return { success: true };
  },
});

// ── Remove admin ──────────────────────────────────────────────────────

export const removeAdmin = action({
  args: {
    targetUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const caller = await requireSuperAdminAction(ctx);
    const { targetUserId } = args;

    // Cannot remove self
    if (caller._id === targetUserId) {
      throw new ConvexError({
        message: "Cannot remove yourself.",
        code: "invalid",
      });
    }

    // Get target user
    const targetUser = await ctx.runQuery(internal.admin.getUserById, {
      userId: targetUserId,
    });
    if (!targetUser) {
      throw new ConvexError({
        message: "User not found.",
        code: "not_found",
      });
    }

    const previousRole = targetUser.role ?? ROLES.USER;

    // SAFEGUARD: Cannot remove the LAST super_admin
    if (previousRole === ROLES.SUPER_ADMIN) {
      const superAdminCount = await ctx.runQuery(
        internal.admin.countSuperAdmins,
        {},
      );
      if (superAdminCount <= 1) {
        throw new ConvexError({
          message: "At least one super admin must remain.",
          code: "invalid",
        });
      }
    }

    // Set role to regular user
    await ctx.runMutation(internal.adminManagement.patchUserRole, {
      userId: targetUserId,
      newRole: ROLES.USER,
    });

    await writeAuditLog(ctx, {
      actorUserId: caller._id,
      action: "admin.removed",
      targetType: "user",
      targetId: targetUserId,
      details: JSON.stringify({
        targetEmail: targetUser.email,
        previousRole,
      }),
    });

    return { success: true };
  },
});

// ── Audit log query ───────────────────────────────────────────────────

export const listAuditLog = query({
  args: {
    limit: v.optional(v.number()),
    actionType: v.optional(v.string()),
    actorId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    // Require super_admin for audit log access
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new ConvexError({
        message: "Sign in required.",
        code: "unauthorized",
      });
    }
    const user = await ctx.db.get(userId);
    if (!user || user.role !== ROLES.SUPER_ADMIN) {
      throw new ConvexError({
        message: "Super admin access required.",
        code: "unauthorized",
      });
    }

    const limit = args.limit ?? 50;
    let entries = await ctx.db
      .query("adminAuditLog")
      .withIndex("by_createdAt")
      .order("desc")
      .take(limit);

    // Filter by actionType
    if (args.actionType) {
      entries = entries.filter((e) => e.action === args.actionType);
    }

    // Filter by actorId
    if (args.actorId) {
      entries = entries.filter((e) => e.actorUserId === args.actorId);
    }

    // Enrich with actor name/email
    const enriched = await Promise.all(
      entries.map(async (entry) => {
        const actor = await ctx.db.get(entry.actorUserId);
        return {
          ...entry,
          actorName: actor?.name ?? null,
          actorEmail: actor?.email ?? null,
        };
      }),
    );

    return enriched;
  },
});

// ── Claim pending invite ──────────────────────────────────────────────

/**
 * Called when a new user signs up. Checks if there's a pending admin
 * invite for their email and applies it.
 */
export const claimPendingInvite = internalMutation({
  args: {
    userId: v.id("users"),
    email: v.string(),
  },
  handler: async (ctx, { userId, email }) => {
    const normalizedEmail = email.toLowerCase().trim();
    const invite = await ctx.db
      .query("pendingAdminInvites")
      .withIndex("by_email", (q) => q.eq("email", normalizedEmail))
      .first();

    if (!invite || invite.claimed) return;

    // Apply the role
    await ctx.db.patch(userId, { role: invite.intendedRole });

    // Mark invite as claimed
    await ctx.db.patch(invite._id, { claimed: true });

    // Also write an audit log entry
    await ctx.db.insert("adminAuditLog", {
      actorUserId: invite.invitedBy,
      action: "admin.invite_claimed",
      targetType: "user",
      targetId: userId,
      details: JSON.stringify({
        email: normalizedEmail,
        claimedRole: invite.intendedRole,
      }),
      createdAt: Date.now(),
    });
  },
});

// ── Internal mutations (called from actions) ──────────────────────────

export const patchUserRole = internalMutation({
  args: {
    userId: v.id("users"),
    newRole: v.string(),
  },
  handler: async (ctx, { userId, newRole }) => {
    await ctx.db.patch(userId, { role: newRole as ("super_admin" | "admin" | "moderator" | "user" | "member") });
  },
});

export const insertPendingInvite = internalMutation({
  args: {
    email: v.string(),
    intendedRole: adminRoleValidator,
    invitedBy: v.id("users"),
  },
  handler: async (ctx, args) => {
    // Check for existing unclaimed invite for this email
    const existing = await ctx.db
      .query("pendingAdminInvites")
      .withIndex("by_email", (q) => q.eq("email", args.email))
      .first();

    if (existing && !existing.claimed) {
      // Update existing invite
      await ctx.db.patch(existing._id, {
        intendedRole: args.intendedRole,
        invitedBy: args.invitedBy,
        createdAt: Date.now(),
      });
      return;
    }

    await ctx.db.insert("pendingAdminInvites", {
      ...args,
      createdAt: Date.now(),
      claimed: false,
    });
  },
});

// ── Internal queries (called from actions) ────────────────────────────

export const getAllUsers = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("users").take(500);
  },
});

export const getLastSession = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    return await ctx.db
      .query("studySessions")
      .withIndex("by_user_startedAt", (q) => q.eq("userId", userId))
      .order("desc")
      .first();
  },
});

export const getPendingInvites = internalQuery({
  args: {},
  handler: async (ctx) => {
    // We can't filter on `claimed` in an index query since we don't have one.
    // Collect all and filter.
    const all = await ctx.db.query("pendingAdminInvites").collect();
    return all.filter((i) => !i.claimed);
  },
});
