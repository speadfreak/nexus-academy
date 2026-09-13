// Testimonials — real student testimonials, curated from the admin.
//
// Honesty discipline (consistent with the rest of the platform — the
// honest landing copy, the real-numbers coverage map, the no-fabricated-
// stats principle): EVERY testimonial here must reflect a REAL person's
// REAL words. Two creation paths:
//
//   1. In-app submission — a real user submits via the "Share your
//      experience" flow. userId is set. Creates a "pending" row that
//      NEVER goes live automatically. Admin reviews → approves →
//      optionally features.
//
//   2. Manual admin add — for genuine testimonials collected outside
//      the app (WhatsApp message, in-person conversation, etc.). userId
//      is null but submitterName is the real person's name, with their
//      actual words. The admin is the conduit, NOT the author — this is
//      for surfacing real students' real statements, not inventing them.
//
// Only approved + featured testimonials appear on the public landing
// page, in displayOrder sequence. The admin may lightly edit for
// length/clarity/grammar (normal editorial practice) but the underlying
// story/sentiment must stay genuinely reflective of what the real
// person said.

import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { requireAdminMutation, isAdmin } from "./admin";
import type { Doc } from "./_generated/dataModel";

// ---------------------------------------------------------------------------
// Types (shared between queries + the admin UI)
// ---------------------------------------------------------------------------

interface PublicTestimonial {
  _id: Id<"testimonials">;
  submitterName: string;
  roleLabel: string;
  messageText: string;
  starRating: number | null;
  // Resolved photo URL (null = render initials avatar)
  photoUrl: string | null;
  displayOrder: number;
}

interface AdminTestimonial {
  _id: Id<"testimonials">;
  userId: Id<"users"> | null;
  submitterName: string;
  roleLabel: string;
  messageText: string;
  starRating: number | null;
  status: "pending" | "approved" | "rejected";
  featured: boolean;
  displayOrder: number;
  submittedAt: number;
  reviewedAt: number | null;
  // Internal "verified student" flag — true if userId is set (came from a
  // real in-app account). Surfaced in admin UI for honest record-keeping;
  // NOT shown on the public landing page (the distinction is internal).
  isVerifiedStudent: boolean;
  // Email of the submitting user (for admin context — helps identify the
  // real account if needed). Null for manual admin-added testimonials.
  submitterEmail: string | null;
}

// ---------------------------------------------------------------------------
// Public reads (no auth — the landing page is public)
// ---------------------------------------------------------------------------

/**
 * List ONLY featured + approved testimonials, in displayOrder sequence.
 * Used by the public landing page. Returns the resolved photo URLs.
 *
 * If there are zero featured testimonials, returns [] — the landing page
 * renders NOTHING in that case (honest empty state, same principle as the
 * honest live-stats coverage map — no awkward placeholder).
 */
export const listFeaturedPublic = query({
  args: {},
  handler: async (ctx): Promise<PublicTestimonial[]> => {
    const rows = await ctx.db
      .query("testimonials")
      .withIndex("by_featured", (q) => q.eq("featured", true))
      .collect();
    // Filter to approved only (featured + rejected shouldn't show even if
    // the admin flipped the featured flag by mistake)
    const approved = rows.filter((r) => r.status === "approved");
    // Sort by displayOrder asc, then by submittedAt desc as a tiebreaker
    approved.sort((a, b) => {
      if (a.displayOrder !== b.displayOrder) return a.displayOrder - b.displayOrder;
      return b.submittedAt - a.submittedAt;
    });
    // Resolve photo URLs in a single pass
    const result: PublicTestimonial[] = [];
    for (const r of approved) {
      let photoUrl: string | null = null;
      if (r.submitterPhotoStorageId) {
        photoUrl = (await ctx.storage.getUrl(r.submitterPhotoStorageId)) ?? null;
      }
      result.push({
        _id: r._id,
        submitterName: r.submitterName,
        roleLabel: r.roleLabel,
        messageText: r.messageText,
        starRating: r.starRating ?? null,
        photoUrl,
        displayOrder: r.displayOrder,
      });
    }
    return result;
  },
});

// ---------------------------------------------------------------------------
// In-app submission (signed-in user submits their own testimonial)
// ---------------------------------------------------------------------------

const MAX_MESSAGE_LENGTH = 600;

/**
 * Submit a testimonial from a signed-in user. Creates a row with status
 * "pending" — it NEVER goes live automatically. The admin reviews +
 * approves + optionally features.
 *
 * The student sees a confirmation toast: "Thanks for sharing — our team
 * will review it before it's featured." — set explicitly in the UI; this
 * mutation just returns the new ID.
 */
export const submit = mutation({
  args: {
    submitterName: v.string(),
    roleLabel: v.string(),
    messageText: v.string(),
    starRating: v.optional(v.number()),
    submitterPhotoStorageId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new ConvexError({ message: "Sign in required.", code: "unauthorized" });
    }
    const name = args.submitterName.trim();
    const role = args.roleLabel.trim();
    const message = args.messageText.trim();
    if (!name) {
      throw new ConvexError({ message: "Please enter your name.", code: "invalid" });
    }
    if (name.length > 80) {
      throw new ConvexError({ message: "Name is too long (max 80 characters).", code: "invalid" });
    }
    if (!role) {
      throw new ConvexError({ message: "Please tell us your role (e.g. 'Grade 12 student').", code: "invalid" });
    }
    if (role.length > 120) {
      throw new ConvexError({ message: "Role label is too long (max 120 characters).", code: "invalid" });
    }
    if (!message) {
      throw new ConvexError({ message: "Please share a few words about your experience.", code: "invalid" });
    }
    if (message.length > MAX_MESSAGE_LENGTH) {
      throw new ConvexError({
        message: `Message is too long (max ${MAX_MESSAGE_LENGTH} characters).`,
        code: "invalid",
      });
    }
    if (args.starRating !== undefined && args.starRating !== null) {
      if (args.starRating < 1 || args.starRating > 5) {
        throw new ConvexError({ message: "Star rating must be between 1 and 5.", code: "invalid" });
      }
    }
    // Anti-spam: a user can have at most 3 pending submissions at a time.
    // (Prevents a disgruntled user from flooding the admin queue.)
    const pending = await ctx.db
      .query("testimonials")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .filter((q) => q.eq(q.field("userId"), userId))
      .take(4);
    if (pending.length >= 3) {
      throw new ConvexError({
        message: "You have 3 pending submissions already — our team will review them soon.",
        code: "rate_limited",
      });
    }
    return await ctx.db.insert("testimonials", {
      userId,
      submitterName: name,
      submitterPhotoStorageId: args.submitterPhotoStorageId,
      roleLabel: role,
      messageText: message,
      starRating: args.starRating,
      status: "pending",
      featured: false,
      displayOrder: 0,
      submittedAt: Date.now(),
    });
  },
});

/**
 * Generate a one-time upload URL for the submitter's photo. Same pattern
 * as the existing avatar upload (generateAvatarUploadUrl in profile.ts).
 */
export const generatePhotoUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new ConvexError({ message: "Sign in required.", code: "unauthorized" });
    }
    return await ctx.storage.generateUploadUrl();
  },
});

// ---------------------------------------------------------------------------
// Admin reads + management
// ---------------------------------------------------------------------------

/**
 * Admin: list ALL testimonials (pending + approved + rejected), with
 * isVerifiedStudent + submitterEmail for admin context. Sorted by status
 * (pending first), then by submittedAt desc.
 */
export const listAllAdmin = query({
  args: {
    status: v.optional(v.union(
      v.literal("pending"),
      v.literal("approved"),
      v.literal("rejected"),
    )),
  },
  handler: async (ctx, args): Promise<AdminTestimonial[]> => {
    // Admin gate — read-only query, can't use requireAdminMutation (which
    // expects MutationCtx). Use isAdmin directly.
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new ConvexError({ message: "Sign in required.", code: "unauthorized" });
    }
    const user = await ctx.db.get(userId);
    if (!user || !(await isAdmin(ctx, user))) {
      throw new ConvexError({
        message: "Admin access required.",
        code: "forbidden",
      });
    }
    const rows = args.status
      ? await ctx.db
          .query("testimonials")
          .withIndex("by_status", (q) => q.eq("status", args.status!))
          .collect()
      : await ctx.db.query("testimonials").collect();
    // Resolve submitter email (for verified-student testimonials only)
    const result: AdminTestimonial[] = [];
    for (const r of rows) {
      let submitterEmail: string | null = null;
      if (r.userId) {
        const user = await ctx.db.get(r.userId);
        submitterEmail = user?.email ?? null;
      }
      result.push({
        _id: r._id,
        userId: r.userId ?? null,
        submitterName: r.submitterName,
        roleLabel: r.roleLabel,
        messageText: r.messageText,
        starRating: r.starRating ?? null,
        status: r.status,
        featured: r.featured,
        displayOrder: r.displayOrder,
        submittedAt: r.submittedAt,
        reviewedAt: r.reviewedAt ?? null,
        isVerifiedStudent: r.userId !== null,
        submitterEmail,
      });
    }
    // Sort: pending first, then approved, then rejected. Within each, newest first.
    const statusOrder: Record<string, number> = { pending: 0, approved: 1, rejected: 2 };
    result.sort((a, b) => {
      const s = statusOrder[a.status] - statusOrder[b.status];
      if (s !== 0) return s;
      return b.submittedAt - a.submittedAt;
    });
    return result;
  },
});

/**
 * Admin: approve a pending testimonial. Sets status=approved, reviewedAt,
 * reviewedBy, AND featured=true (auto-feature). The admin's intent when
 * approving is "yes, show this" — so we surface it on the landing page
 * immediately. If the admin wants to curate down later, they can click
 * Unfeature on the row (the featured flag is still independently
 * controllable after approval).
 *
 * The previous two-step flow (approve → then feature) was confusing —
 * admins approved but saw nothing on the landing page because they
 * didn't realize they also needed to click Feature. Auto-featuring on
 * approve is the natural workflow.
 */
export const approve = mutation({
  args: { testimonialId: v.id("testimonials") },
  handler: async (ctx, { testimonialId }) => {
    const { user } = await requireAdminMutation(ctx);
    const row = await ctx.db.get(testimonialId);
    if (!row) {
      throw new ConvexError({ message: "Testimonial not found.", code: "not_found" });
    }
    await ctx.db.patch(testimonialId, {
      status: "approved",
      featured: true, // Auto-feature — the admin's intent when approving is "show this"
      reviewedAt: Date.now(),
      reviewedBy: user._id,
    });
    await ctx.runMutation(internal.adminManagement.internalInsertAuditLog, {
      actorUserId: user._id,
      action: "testimonial.approve",
      targetType: "testimonial",
      targetId: testimonialId,
      details: JSON.stringify({ submitterName: row.submitterName, autoFeatured: true }),
    });
    return { ok: true };
  },
});

/**
 * Admin: reject a pending testimonial. Sets status=rejected, reviewedAt,
 * reviewedBy. The rejected testimonial stays in the table for record-keeping
 * but never appears on the landing page.
 */
export const reject = mutation({
  args: { testimonialId: v.id("testimonials") },
  handler: async (ctx, { testimonialId }) => {
    const { user } = await requireAdminMutation(ctx);
    const row = await ctx.db.get(testimonialId);
    if (!row) {
      throw new ConvexError({ message: "Testimonial not found.", code: "not_found" });
    }
    await ctx.db.patch(testimonialId, {
      status: "rejected",
      reviewedAt: Date.now(),
      reviewedBy: user._id,
      // Rejected testimonials can't be featured — flip off if it was on.
      featured: false,
    });
    await ctx.runMutation(internal.adminManagement.internalInsertAuditLog, {
      actorUserId: user._id,
      action: "testimonial.reject",
      targetType: "testimonial",
      targetId: testimonialId,
      details: JSON.stringify({ submitterName: row.submitterName }),
    });
    return { ok: true };
  },
});

/**
 * Admin: feature an approved testimonial. Sets featured=true. Only featured
 * + approved testimonials appear on the public landing page.
 */
export const feature = mutation({
  args: { testimonialId: v.id("testimonials") },
  handler: async (ctx, { testimonialId }) => {
    const { user } = await requireAdminMutation(ctx);
    const row = await ctx.db.get(testimonialId);
    if (!row) {
      throw new ConvexError({ message: "Testimonial not found.", code: "not_found" });
    }
    if (row.status !== "approved") {
      throw new ConvexError({
        message: "Only approved testimonials can be featured. Approve it first.",
        code: "invalid",
      });
    }
    await ctx.db.patch(testimonialId, { featured: true });
    await ctx.runMutation(internal.adminManagement.internalInsertAuditLog, {
      actorUserId: user._id,
      action: "testimonial.feature",
      targetType: "testimonial",
      targetId: testimonialId,
    });
    return { ok: true };
  },
});

/**
 * Admin: unfeature a testimonial. Sets featured=false. The testimonial
 * stays approved (in the table) but doesn't show on the public landing page.
 */
export const unfeature = mutation({
  args: { testimonialId: v.id("testimonials") },
  handler: async (ctx, { testimonialId }) => {
    const { user } = await requireAdminMutation(ctx);
    await ctx.db.patch(testimonialId, { featured: false });
    await ctx.runMutation(internal.adminManagement.internalInsertAuditLog, {
      actorUserId: user._id,
      action: "testimonial.unfeature",
      targetType: "testimonial",
      targetId: testimonialId,
    });
    return { ok: true };
  },
});

/**
 * Admin: edit a testimonial (any field). Light editorial changes for
 * length/clarity/grammar are OK — the underlying story/sentiment must
 * stay genuinely reflective of what the real person said.
 */
export const update = mutation({
  args: {
    testimonialId: v.id("testimonials"),
    submitterName: v.optional(v.string()),
    roleLabel: v.optional(v.string()),
    messageText: v.optional(v.string()),
    starRating: v.optional(v.number()),
    submitterPhotoStorageId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireAdminMutation(ctx);
    const row = await ctx.db.get(args.testimonialId);
    if (!row) {
      throw new ConvexError({ message: "Testimonial not found.", code: "not_found" });
    }
    const patch: Record<string, unknown> = {};
    if (args.submitterName !== undefined) {
      const name = args.submitterName.trim();
      if (!name) throw new ConvexError({ message: "Name cannot be empty.", code: "invalid" });
      if (name.length > 80) throw new ConvexError({ message: "Name too long (max 80).", code: "invalid" });
      patch.submitterName = name;
    }
    if (args.roleLabel !== undefined) {
      const role = args.roleLabel.trim();
      if (!role) throw new ConvexError({ message: "Role label cannot be empty.", code: "invalid" });
      if (role.length > 120) throw new ConvexError({ message: "Role label too long (max 120).", code: "invalid" });
      patch.roleLabel = role;
    }
    if (args.messageText !== undefined) {
      const message = args.messageText.trim();
      if (!message) throw new ConvexError({ message: "Message cannot be empty.", code: "invalid" });
      if (message.length > MAX_MESSAGE_LENGTH) {
        throw new ConvexError({ message: `Message too long (max ${MAX_MESSAGE_LENGTH}).`, code: "invalid" });
      }
      patch.messageText = message;
    }
    if (args.starRating !== undefined) {
      if (args.starRating < 1 || args.starRating > 5) {
        throw new ConvexError({ message: "Star rating must be 1-5.", code: "invalid" });
      }
      patch.starRating = args.starRating;
    }
    if (args.submitterPhotoStorageId !== undefined) {
      patch.submitterPhotoStorageId = args.submitterPhotoStorageId || undefined;
    }
    await ctx.db.patch(args.testimonialId, patch);
    await ctx.runMutation(internal.adminManagement.internalInsertAuditLog, {
      actorUserId: user._id,
      action: "testimonial.update",
      targetType: "testimonial",
      targetId: args.testimonialId,
      details: JSON.stringify({ changedFields: Object.keys(patch) }),
    });
    return { ok: true };
  },
});

/**
 * Admin: set displayOrder for one testimonial. Used by the up/down reorder
 * controls in the admin UI.
 */
export const setDisplayOrder = mutation({
  args: {
    testimonialId: v.id("testimonials"),
    displayOrder: v.number(),
  },
  handler: async (ctx, { testimonialId, displayOrder }) => {
    const { user } = await requireAdminMutation(ctx);
    await ctx.db.patch(testimonialId, { displayOrder });
    await ctx.runMutation(internal.adminManagement.internalInsertAuditLog, {
      actorUserId: user._id,
      action: "testimonial.reorder",
      targetType: "testimonial",
      targetId: testimonialId,
      details: JSON.stringify({ displayOrder }),
    });
    return { ok: true };
  },
});

/**
 * Admin: bulk-reorder. Takes an array of {id, displayOrder} pairs and applies
 * them in one transaction. Used by drag-and-drop reorder if implemented.
 */
export const bulkReorder = mutation({
  args: {
    updates: v.array(v.object({
      testimonialId: v.id("testimonials"),
      displayOrder: v.number(),
    })),
  },
  handler: async (ctx, { updates }) => {
    const { user } = await requireAdminMutation(ctx);
    for (const u of updates) {
      await ctx.db.patch(u.testimonialId, { displayOrder: u.displayOrder });
    }
    await ctx.runMutation(internal.adminManagement.internalInsertAuditLog, {
      actorUserId: user._id,
      action: "testimonial.bulkReorder",
      targetType: "testimonials",
      details: JSON.stringify({ count: updates.length }),
    });
    return { ok: true };
  },
});

/**
 * Admin: bulk-fix for testimonials that were approved BEFORE the
 * auto-feature-on-approve change. Sets featured=true on every approved
 * testimonial that's currently not featured. One-shot migration — the
 * admin runs this once to bring existing approved testimonials in line
 * with the new "approve = show on landing page" workflow.
 *
 * Returns the count of testimonials that were flipped.
 */
export const bulkFeatureApproved = mutation({
  args: {},
  handler: async (ctx) => {
    const { user } = await requireAdminMutation(ctx);
    const approved = await ctx.db
      .query("testimonials")
      .withIndex("by_status", (q) => q.eq("status", "approved"))
      .collect();
    let flipped = 0;
    for (const t of approved) {
      if (!t.featured) {
        await ctx.db.patch(t._id, { featured: true });
        flipped++;
      }
    }
    if (flipped > 0) {
      await ctx.runMutation(internal.adminManagement.internalInsertAuditLog, {
        actorUserId: user._id,
        action: "testimonial.bulkFeatureApproved",
        targetType: "testimonials",
        details: JSON.stringify({ flipped }),
      });
    }
    return { flipped };
  },
});

/**
 * Admin: manually add a testimonial collected outside the app (WhatsApp
 * message, in-person conversation, etc.). userId is null — the admin is
 * the conduit, NOT the author. The submitterName + messageText must
 * reflect a real person's real words.
 *
 * Created as approved + featured=true by default (matches the new auto-
 * feature-on-approve behavior — admin's intent when adding manually is
 * "show this on the landing page"). The admin can unfeature after if
 * they want to curate down.
 */
export const createManual = mutation({
  args: {
    submitterName: v.string(),
    roleLabel: v.string(),
    messageText: v.string(),
    starRating: v.optional(v.number()),
    submitterPhotoStorageId: v.optional(v.string()),
    // Admin can create-as-approved+featured in one shot if they want.
    featured: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireAdminMutation(ctx);
    const name = args.submitterName.trim();
    const role = args.roleLabel.trim();
    const message = args.messageText.trim();
    if (!name) throw new ConvexError({ message: "Name is required.", code: "invalid" });
    if (name.length > 80) throw new ConvexError({ message: "Name too long (max 80).", code: "invalid" });
    if (!role) throw new ConvexError({ message: "Role label is required.", code: "invalid" });
    if (role.length > 120) throw new ConvexError({ message: "Role label too long (max 120).", code: "invalid" });
    if (!message) throw new ConvexError({ message: "Message is required.", code: "invalid" });
    if (message.length > MAX_MESSAGE_LENGTH) {
      throw new ConvexError({ message: `Message too long (max ${MAX_MESSAGE_LENGTH}).`, code: "invalid" });
    }
    if (args.starRating !== undefined && (args.starRating < 1 || args.starRating > 5)) {
      throw new ConvexError({ message: "Star rating must be 1-5.", code: "invalid" });
    }
    const newId = await ctx.db.insert("testimonials", {
      userId: undefined, // Manual add — no real account behind it.
      submitterName: name,
      submitterPhotoStorageId: args.submitterPhotoStorageId,
      roleLabel: role,
      messageText: message,
      starRating: args.starRating,
      status: "approved", // Auto-approved — admin added it directly.
      featured: args.featured ?? true, // Auto-featured by default (matches new approve behavior)
      displayOrder: 0,
      submittedAt: Date.now(),
      reviewedAt: Date.now(),
      reviewedBy: user._id,
    });
    await ctx.runMutation(internal.adminManagement.internalInsertAuditLog, {
      actorUserId: user._id,
      action: "testimonial.createManual",
      targetType: "testimonial",
      targetId: newId,
      details: JSON.stringify({ submitterName: name }),
    });
    return { testimonialId: newId };
  },
});

/**
 * Admin: generate an upload URL for a manually-added testimonial's photo
 * (when the admin has a real photo they have permission to use).
 */
export const generateAdminPhotoUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await requireAdminMutation(ctx);
    return await ctx.storage.generateUploadUrl();
  },
});

/**
 * Admin: permanently delete a testimonial. Use sparingly — the typical
 * workflow is to reject rather than delete (preserves the record).
 */
export const remove = mutation({
  args: { testimonialId: v.id("testimonials") },
  handler: async (ctx, { testimonialId }) => {
    const { user } = await requireAdminMutation(ctx);
    const row = await ctx.db.get(testimonialId);
    if (!row) {
      throw new ConvexError({ message: "Testimonial not found.", code: "not_found" });
    }
    await ctx.db.delete(testimonialId);
    await ctx.runMutation(internal.adminManagement.internalInsertAuditLog, {
      actorUserId: user._id,
      action: "testimonial.delete",
      targetType: "testimonial",
      targetId: testimonialId,
      details: JSON.stringify({ submitterName: row.submitterName }),
    });
    return { ok: true };
  },
});
