// Schools — bulk class/school onboarding + tiered seat pricing.
//
// Schools let a director bring an entire class onto Learnyx in minutes:
//   1. Platform admin creates a school + designates a director (user)
//   2. Director creates classes (grade + stream + subject focus)
//   3. Each class gets a shareable code
//   4. Students join with the code during onboarding — pre-configured
//      with the right grade + stream, no individual signup friction
//   5. Director purchases bulk premium seats (tiered pricing) —
//      students on a school seat get premium without individual payment
//
// PRIVACY: directors see CLASS-WIDE aggregate progress only, never
// individual student data unless a student explicitly opts in via the
// "share detailed progress with school" toggle in Settings.
//
// GATING: the public-facing feature is gated on SCHOOL_FEATURE_ENABLED.
// The platform admin's management queries here are NOT gated (the admin
// can prepare a school's setup before going live).

import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { requireAdminMutation, isAdmin } from "./admin";
import { getTierRateForSeatCount } from "./configKeys";

const MONTH_MS = 30 * 24 * 60 * 60 * 1000;
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I
const CODE_LENGTH = 6;

function generateClassCode(): string {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]!;
  }
  return code;
}

// ---------------------------------------------------------------------------
// Admin: school CRUD
// ---------------------------------------------------------------------------

/**
 * Admin: list all schools. Used by the /admin → Schools management tab.
 * NOT gated on SCHOOL_FEATURE_ENABLED — the admin can manage schools
 * regardless of the public toggle.
 */
export const adminListSchools = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError({ message: "Sign in required.", code: "unauthorized" });
    const user = await ctx.db.get(userId);
    if (!user || !(await isAdmin(ctx, user))) {
      throw new ConvexError({ message: "Admin access required.", code: "forbidden" });
    }
    const schools = await ctx.db.query("schools").order("desc").collect();
    // Resolve director names + class counts
    const result = [];
    for (const s of schools) {
      const director = await ctx.db.get(s.directorId);
      const classCount = (await ctx.db
        .query("schoolClasses")
        .withIndex("by_school", (q) => q.eq("schoolId", s._id))
        .collect()).length;
      result.push({
        _id: s._id,
        name: s.name,
        directorId: s.directorId,
        directorName: director?.name ?? director?.email ?? "Unknown",
        directorEmail: director?.email ?? null,
        seatsPurchased: s.seatsPurchased,
        seatsExpireAt: s.seatsExpireAt ?? null,
        contactEmail: s.contactEmail ?? null,
        contactPhone: s.contactPhone ?? null,
        location: s.location ?? null,
        classCount,
        createdAt: s.createdAt,
      });
    }
    return result;
  },
});

/**
 * Admin: create a school + designate a director. Sends a welcome
 * notification to the director explaining they're now set up as the
 * school's admin.
 */
export const adminCreateSchool = mutation({
  args: {
    name: v.string(),
    directorId: v.id("users"),
    contactEmail: v.optional(v.string()),
    contactPhone: v.optional(v.string()),
    location: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireAdminMutation(ctx);
    const name = args.name.trim();
    if (!name) throw new ConvexError({ message: "School name is required.", code: "invalid" });
    if (name.length > 120) throw new ConvexError({ message: "School name too long (max 120).", code: "invalid" });
    // Verify the director user exists
    const director = await ctx.db.get(args.directorId);
    if (!director) throw new ConvexError({ message: "Director user not found.", code: "not_found" });
    const schoolId = await ctx.db.insert("schools", {
      name,
      directorId: args.directorId,
      createdBy: user._id,
      seatsPurchased: 0,
      contactEmail: args.contactEmail,
      contactPhone: args.contactPhone,
      location: args.location,
      createdAt: Date.now(),
    });
    // Welcome notification to the director
    await ctx.runMutation(internal.notifications.createNotification, {
      userId: args.directorId,
      type: "school_welcome",
      title: `You're now ${name}'s admin 🎓`,
      body: "Welcome! You can now create classes and share join codes with your students. Open the School Admin dashboard to get started.",
      actionUrl: "/school-admin",
    });
    await ctx.runMutation(internal.adminManagement.internalInsertAuditLog, {
      actorUserId: user._id,
      action: "school.create",
      targetType: "school",
      targetId: schoolId,
      details: JSON.stringify({ name, directorId: args.directorId }),
    });
    return { schoolId };
  },
});

/**
 * Admin: update a school's details (name, contact info, director).
 */
export const adminUpdateSchool = mutation({
  args: {
    schoolId: v.id("schools"),
    name: v.optional(v.string()),
    directorId: v.optional(v.id("users")),
    contactEmail: v.optional(v.string()),
    contactPhone: v.optional(v.string()),
    location: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireAdminMutation(ctx);
    const school = await ctx.db.get(args.schoolId);
    if (!school) throw new ConvexError({ message: "School not found.", code: "not_found" });
    const patch: Record<string, unknown> = {};
    if (args.name !== undefined) {
      const name = args.name.trim();
      if (!name) throw new ConvexError({ message: "Name cannot be empty.", code: "invalid" });
      patch.name = name;
    }
    if (args.directorId !== undefined) {
      const director = await ctx.db.get(args.directorId);
      if (!director) throw new ConvexError({ message: "Director user not found.", code: "not_found" });
      patch.directorId = args.directorId;
      // Welcome the new director too
      await ctx.runMutation(internal.notifications.createNotification, {
        userId: args.directorId,
        type: "school_welcome",
        title: `You're now ${school.name}'s admin 🎓`,
        body: "Welcome! You can now create classes and share join codes with your students. Open the School Admin dashboard to get started.",
        actionUrl: "/school-admin",
      });
    }
    if (args.contactEmail !== undefined) patch.contactEmail = args.contactEmail || undefined;
    if (args.contactPhone !== undefined) patch.contactPhone = args.contactPhone || undefined;
    if (args.location !== undefined) patch.location = args.location || undefined;
    await ctx.db.patch(args.schoolId, patch);
    await ctx.runMutation(internal.adminManagement.internalInsertAuditLog, {
      actorUserId: user._id,
      action: "school.update",
      targetType: "school",
      targetId: args.schoolId,
    });
    return { ok: true };
  },
});

/**
 * Admin: approve a school bulk seat submission. Increments the school's
 * seatsPurchased by the purchased count, sets seatsExpireAt based on the
 * purchased duration. Students on the school seat get premium access
 * until seatsExpireAt.
 */
export const adminApproveSeatSubmission = mutation({
  args: { submissionId: v.id("schoolSeatSubmissions") },
  handler: async (ctx, { submissionId }) => {
    const { user } = await requireAdminMutation(ctx);
    const sub = await ctx.db.get(submissionId);
    if (!sub) throw new ConvexError({ message: "Submission not found.", code: "not_found" });
    if (sub.status !== "pending") {
      throw new ConvexError({ message: "Submission already reviewed.", code: "invalid" });
    }
    const school = await ctx.db.get(sub.schoolId);
    if (!school) throw new ConvexError({ message: "School not found.", code: "not_found" });
    // Increment seatsPurchased + set seatsExpireAt
    const newSeatsPurchased = school.seatsPurchased + sub.seatCount;
    const newExpiry = Date.now() + sub.durationMonths * MONTH_MS;
    await ctx.db.patch(school._id, {
      seatsPurchased: newSeatsPurchased,
      seatsExpireAt: newExpiry,
    });
    await ctx.db.patch(submissionId, {
      status: "approved",
      reviewedAt: Date.now(),
      reviewedBy: user._id,
    });
    // Notify the director
    await ctx.runMutation(internal.notifications.createNotification, {
      userId: sub.directorId,
      type: "school_seat_approved",
      title: "Seat purchase approved 🎉",
      body: `${sub.seatCount} seats for ${sub.durationMonths} months approved. Your students now have premium access until ${new Date(newExpiry).toLocaleDateString()}.`,
      actionUrl: "/school-admin",
    });
    await ctx.runMutation(internal.adminManagement.internalInsertAuditLog, {
      actorUserId: user._id,
      action: "school.seat_approve",
      targetType: "schoolSeatSubmission",
      targetId: submissionId,
      details: JSON.stringify({ schoolId: sub.schoolId, seatCount: sub.seatCount, durationMonths: sub.durationMonths, totalAmount: sub.totalAmount }),
    });
    return { ok: true };
  },
});

/**
 * Admin: reject a school bulk seat submission.
 */
export const adminRejectSeatSubmission = mutation({
  args: {
    submissionId: v.id("schoolSeatSubmissions"),
    rejectionReason: v.optional(v.string()),
  },
  handler: async (ctx, { submissionId, rejectionReason }) => {
    const { user } = await requireAdminMutation(ctx);
    const sub = await ctx.db.get(submissionId);
    if (!sub) throw new ConvexError({ message: "Submission not found.", code: "not_found" });
    if (sub.status !== "pending") {
      throw new ConvexError({ message: "Submission already reviewed.", code: "invalid" });
    }
    await ctx.db.patch(submissionId, {
      status: "rejected",
      reviewedAt: Date.now(),
      reviewedBy: user._id,
      rejectionReason,
    });
    await ctx.runMutation(internal.notifications.createNotification, {
      userId: sub.directorId,
      type: "school_seat_rejected",
      title: "Seat purchase could not be approved",
      body: rejectionReason
        ? `Your seat purchase submission was not approved: ${rejectionReason}`
        : "Your seat purchase submission was not approved. Please check the payment details and try again, or contact support.",
      actionUrl: "/school-admin",
    });
    await ctx.runMutation(internal.adminManagement.internalInsertAuditLog, {
      actorUserId: user._id,
      action: "school.seat_reject",
      targetType: "schoolSeatSubmission",
      targetId: submissionId,
    });
    return { ok: true };
  },
});

/**
 * Admin: list all school seat submissions (for the Payment Reviews queue).
 * Returns submissions with school name resolved, sorted pending-first.
 */
export const adminListSeatSubmissions = query({
  args: {
    status: v.optional(v.union(
      v.literal("pending"),
      v.literal("approved"),
      v.literal("rejected"),
    )),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError({ message: "Sign in required.", code: "unauthorized" });
    const user = await ctx.db.get(userId);
    if (!user || !(await isAdmin(ctx, user))) {
      throw new ConvexError({ message: "Admin access required.", code: "forbidden" });
    }
    const rows = args.status
      ? await ctx.db
          .query("schoolSeatSubmissions")
          .withIndex("by_status", (q) => q.eq("status", args.status!))
          .collect()
      : await ctx.db.query("schoolSeatSubmissions").collect();
    const result = [];
    for (const r of rows) {
      const school = await ctx.db.get(r.schoolId);
      const director = await ctx.db.get(r.directorId);
      result.push({
        _id: r._id,
        schoolId: r.schoolId,
        schoolName: school?.name ?? "Unknown school",
        directorName: director?.name ?? director?.email ?? "Unknown",
        seatCount: r.seatCount,
        durationMonths: r.durationMonths,
        tierRate: r.tierRate,
        totalAmount: r.totalAmount,
        tierUsed: r.tierUsed,
        method: r.method,
        transactionRef: r.transactionRef,
        status: r.status,
        submittedAt: r.submittedAt,
        reviewedAt: r.reviewedAt ?? null,
        rejectionReason: r.rejectionReason ?? null,
      });
    }
    const statusOrder: Record<string, number> = { pending: 0, approved: 1, rejected: 2 };
    result.sort((a, b) => {
      const s = statusOrder[a.status] - statusOrder[b.status];
      if (s !== 0) return s;
      return b.submittedAt - a.submittedAt;
    });
    return result;
  },
});

// ---------------------------------------------------------------------------
// Director: school admin dashboard
// ---------------------------------------------------------------------------

/**
 * Director: get the school this director manages + its classes + seat
 * license state. Returns null if the caller isn't a director of any school.
 */
export const directorGetMySchool = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const school = await ctx.db
      .query("schools")
      .withIndex("by_director", (q) => q.eq("directorId", userId))
      .first();
    if (!school) return null;
    const classes = await ctx.db
      .query("schoolClasses")
      .withIndex("by_school", (q) => q.eq("schoolId", school._id))
      .collect();
    // Resolve member counts per class
    const classesWithCounts = [];
    for (const c of classes) {
      const memberCount = (await ctx.db
        .query("schoolClassMembers")
        .withIndex("by_class", (q) => q.eq("classId", c._id))
        .collect()).length;
      classesWithCounts.push({
        _id: c._id,
        name: c.name,
        gradeLevel: c.gradeLevel,
        stream: c.stream,
        classCode: c.classCode,
        memberCount,
        createdAt: c.createdAt,
      });
    }
    return {
      _id: school._id,
      name: school.name,
      seatsPurchased: school.seatsPurchased,
      seatsExpireAt: school.seatsExpireAt ?? null,
      contactEmail: school.contactEmail ?? null,
      contactPhone: school.contactPhone ?? null,
      location: school.location ?? null,
      classes: classesWithCounts,
    };
  },
});

/**
 * Director: create a class. Generates a unique shareable code.
 */
export const directorCreateClass = mutation({
  args: {
    name: v.string(),
    gradeLevel: v.union(v.literal(9), v.literal(10), v.literal(11), v.literal(12)),
    stream: v.union(v.literal("natural"), v.literal("social"), v.literal("common")),
    subjectFocus: v.optional(v.id("subjects")),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError({ message: "Sign in required.", code: "unauthorized" });
    const school = await ctx.db
      .query("schools")
      .withIndex("by_director", (q) => q.eq("directorId", userId))
      .first();
    if (!school) throw new ConvexError({ message: "You're not a school director.", code: "forbidden" });
    const name = args.name.trim();
    if (!name) throw new ConvexError({ message: "Class name is required.", code: "invalid" });
    if (name.length > 120) throw new ConvexError({ message: "Class name too long (max 120).", code: "invalid" });
    // Generate a unique code (retry on collision)
    let classCode = generateClassCode();
    for (let i = 0; i < 5; i++) {
      const existing = await ctx.db
        .query("schoolClasses")
        .withIndex("by_classCode", (q) => q.eq("classCode", classCode))
        .unique();
      if (!existing) break;
      classCode = generateClassCode();
    }
    const classId = await ctx.db.insert("schoolClasses", {
      schoolId: school._id,
      name,
      gradeLevel: args.gradeLevel,
      stream: args.stream,
      subjectFocus: args.subjectFocus,
      classCode,
      createdBy: userId,
      createdAt: Date.now(),
    });
    return { classId, classCode };
  },
});

/**
 * Director: submit a bulk seat purchase. Snapshots the calculated total,
 * seat count, tier used, and duration at submit time. Admin reviews in
 * the Payment Reviews queue.
 */
export const directorSubmitSeatPurchase = mutation({
  args: {
    seatCount: v.number(),
    durationMonths: v.number(),
    transactionRef: v.string(),
    proofStorageId: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError({ message: "Sign in required.", code: "unauthorized" });
    const school = await ctx.db
      .query("schools")
      .withIndex("by_director", (q) => q.eq("directorId", userId))
      .first();
    if (!school) throw new ConvexError({ message: "You're not a school director.", code: "forbidden" });
    if (args.seatCount < 1 || args.seatCount > 1000) {
      throw new ConvexError({ message: "Seat count must be between 1 and 1000.", code: "invalid" });
    }
    if (args.durationMonths < 1 || args.durationMonths > 12) {
      throw new ConvexError({ message: "Duration must be between 1 and 12 months.", code: "invalid" });
    }
    if (!args.transactionRef.trim()) {
      throw new ConvexError({ message: "Transaction reference is required.", code: "invalid" });
    }
    // Resolve the current tier pricing + calculate the total
    const pricing = await ctx.runQuery(internal.configKeys.getSchoolSeatPricingInternal, {});
    const tierRate = getTierRateForSeatCount(args.seatCount, pricing);
    const tierUsed = args.seatCount >= 100 ? 4 : args.seatCount >= 50 ? 3 : args.seatCount >= 20 ? 2 : 1;
    const totalAmount = tierRate * args.seatCount * args.durationMonths;
    const submissionId = await ctx.db.insert("schoolSeatSubmissions", {
      schoolId: school._id,
      directorId: userId,
      seatCount: args.seatCount,
      durationMonths: args.durationMonths,
      tierRate,
      totalAmount,
      tierUsed,
      method: "telebirr_personal",
      transactionRef: args.transactionRef.trim(),
      proofStorageId: args.proofStorageId,
      status: "pending",
      submittedAt: Date.now(),
    });
    return { submissionId, totalAmount, tierRate, tierUsed };
  },
});

/**
 * Director: generate an upload URL for the payment proof screenshot.
 */
export const directorGenerateProofUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError({ message: "Sign in required.", code: "unauthorized" });
    const school = await ctx.db
      .query("schools")
      .withIndex("by_director", (q) => q.eq("directorId", userId))
      .first();
    if (!school) throw new ConvexError({ message: "You're not a school director.", code: "forbidden" });
    return await ctx.storage.generateUploadUrl();
  },
});

// ---------------------------------------------------------------------------
// Student: join a class with a code
// ---------------------------------------------------------------------------

/**
 * Student: join a class with a shareable code. Pre-configures the student's
 * grade + stream from the class. Idempotent — rejoining the same class is
 * a no-op.
 */
export const studentJoinClass = mutation({
  args: {
    classCode: v.string(),
    shareProgress: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError({ message: "Sign in required.", code: "unauthorized" });
    const code = args.classCode.trim().toUpperCase();
    if (!code) throw new ConvexError({ message: "Enter a class code.", code: "invalid" });
    const classRow = await ctx.db
      .query("schoolClasses")
      .withIndex("by_classCode", (q) => q.eq("classCode", code))
      .unique();
    if (!classRow) {
      throw new ConvexError({ message: "That class code doesn't match any class.", code: "not_found" });
    }
    // Check if already a member
    const existing = await ctx.db
      .query("schoolClassMembers")
      .withIndex("by_class_student", (q) => q.eq("classId", classRow._id).eq("studentId", userId))
      .unique();
    if (existing) {
      // Update shareProgress if changed
      if (args.shareProgress !== undefined && existing.shareProgressWithSchool !== args.shareProgress) {
        await ctx.db.patch(existing._id, { shareProgressWithSchool: args.shareProgress });
      }
      return { alreadyMember: true, classId: classRow._id };
    }
    await ctx.db.insert("schoolClassMembers", {
      classId: classRow._id,
      studentId: userId,
      joinedAt: Date.now(),
      shareProgressWithSchool: args.shareProgress ?? false,
    });
    // Pre-configure the student's grade + stream from the class
    const profile = await ctx.db
      .query("userProfiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
    if (profile) {
      const patch: Record<string, unknown> = {};
      if (!profile.stream) patch.stream = classRow.stream;
      if (profile.gradeLevel === undefined || profile.gradeLevel === null) {
        patch.gradeLevel = classRow.gradeLevel;
      }
      if (Object.keys(patch).length > 0) await ctx.db.patch(profile._id, patch);
    }
    return { alreadyMember: false, classId: classRow._id };
  },
});

/**
 * Student: get all classes I'm a member of (for Settings display).
 */
export const studentGetMyClasses = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const memberships = await ctx.db
      .query("schoolClassMembers")
      .withIndex("by_student", (q) => q.eq("studentId", userId))
      .collect();
    const result = [];
    for (const m of memberships) {
      const classRow = await ctx.db.get(m.classId);
      if (!classRow) continue;
      const school = await ctx.db.get(classRow.schoolId);
      result.push({
        classId: classRow._id,
        className: classRow.name,
        schoolName: school?.name ?? "Unknown school",
        gradeLevel: classRow.gradeLevel,
        stream: classRow.stream,
        classCode: classRow.classCode,
        shareProgressWithSchool: m.shareProgressWithSchool,
        joinedAt: m.joinedAt,
      });
    }
    return result;
  },
});

/**
 * Student: toggle "share detailed progress with school" for a class.
 */
export const studentToggleShareProgress = mutation({
  args: {
    classId: v.id("schoolClasses"),
    share: v.boolean(),
  },
  handler: async (ctx, { classId, share }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError({ message: "Sign in required.", code: "unauthorized" });
    const membership = await ctx.db
      .query("schoolClassMembers")
      .withIndex("by_class_student", (q) => q.eq("classId", classId).eq("studentId", userId))
      .unique();
    if (!membership) throw new ConvexError({ message: "You're not in this class.", code: "not_found" });
    await ctx.db.patch(membership._id, { shareProgressWithSchool: share });
    return { ok: true, shareProgressWithSchool: share };
  },
});

// ---------------------------------------------------------------------------
// Student: school seat premium access check
// ---------------------------------------------------------------------------

/**
 * Student: check if the current user has premium access via a school seat.
 * Returns { hasSchoolSeat, seatsExpireAt, schoolName } — used by the
 * frontend to show the same premium UI as individual subscribers, with
 * graceful expiry messaging when the school's license lapses.
 *
 * A student has a school seat if they're a member of ANY class whose
 * school has seatsExpireAt in the future.
 */
export const studentGetSchoolSeatStatus = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return { hasSchoolSeat: false, seatsExpireAt: null, schoolName: null };
    const memberships = await ctx.db
      .query("schoolClassMembers")
      .withIndex("by_student", (q) => q.eq("studentId", userId))
      .collect();
    const now = Date.now();
    for (const m of memberships) {
      const classRow = await ctx.db.get(m.classId);
      if (!classRow) continue;
      const school = await ctx.db.get(classRow.schoolId);
      if (!school) continue;
      if (school.seatsExpireAt && school.seatsExpireAt > now) {
        return {
          hasSchoolSeat: true,
          seatsExpireAt: school.seatsExpireAt,
          schoolName: school.name,
        };
      }
    }
    return { hasSchoolSeat: false, seatsExpireAt: null, schoolName: null };
  },
});
