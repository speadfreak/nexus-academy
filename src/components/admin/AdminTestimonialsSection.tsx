// Admin Testimonials section — full control over the public landing page
// testimonials. Visible to admins (moderator+).
//
// Features:
//   • Review queue — pending submissions with Approve/Reject
//   • Full edit capability on any testimonial (length/clarity/grammar —
//     the underlying story/sentiment stays genuinely reflective of what
//     the real person said)
//   • Feature/unfeature toggle (controls whether an approved testimonial
//     actually shows on the public landing page)
//   • Reorder via up/down arrows (displayOrder field)
//   • Manual add — for genuine testimonials collected outside the app
//     (WhatsApp message, in-person conversation)
//   • Internal "Verified student" badge — true if userId is set (came from
//     a real in-app account). Honest internal record-keeping, NOT shown
//     on the public landing page.

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowDown,
  ArrowUp,
  BadgeCheck,
  Check,
  Edit3,
  Loader2,
  MessageSquareQuote,
  Plus,
  Star,
  Trash2,
  X,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useFriendlyError } from "@/lib/errors";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types (mirror the backend's AdminTestimonial)
// ---------------------------------------------------------------------------

type AdminTestimonial = {
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
  isVerifiedStudent: boolean;
  submitterEmail: string | null;
};

// ---------------------------------------------------------------------------
// Section
// ---------------------------------------------------------------------------

export function AdminTestimonialsSection() {
  const friendlyError = useFriendlyError();
  const [filter, setFilter] = useState<"pending" | "approved" | "rejected" | "all">("pending");
  const [editing, setEditing] = useState<AdminTestimonial | null>(null);
  const [manualAddOpen, setManualAddOpen] = useState(false);

  const list = useQuery(api.testimonials.listAllAdmin, {
    status: filter === "all" ? undefined : filter,
  });

  const approveMut = useMutation(api.testimonials.approve);
  const rejectMut = useMutation(api.testimonials.reject);
  const featureMut = useMutation(api.testimonials.feature);
  const unfeatureMut = useMutation(api.testimonials.unfeature);
  const setDisplayOrderMut = useMutation(api.testimonials.setDisplayOrder);
  const removeMut = useMutation(api.testimonials.remove);
  const bulkFeatureApprovedMut = useMutation(api.testimonials.bulkFeatureApproved);
  const [bulkFixing, setBulkFixing] = useState(false);

  const handleApprove = async (id: Id<"testimonials">) => {
    try {
      await approveMut({ testimonialId: id });
      toast.success("Testimonial approved + featured — it's now on the landing page. 🎉");
    } catch (e) {
      toast.error(friendlyError(e, "Could not approve."));
    }
  };

  const handleReject = async (id: Id<"testimonials">) => {
    try {
      await rejectMut({ testimonialId: id });
      toast.success("Testimonial rejected.");
    } catch (e) {
      toast.error(friendlyError(e, "Could not reject."));
    }
  };

  const handleFeature = async (id: Id<"testimonials">) => {
    try {
      await featureMut({ testimonialId: id });
      toast.success("Testimonial featured — it's now on the landing page.");
    } catch (e) {
      toast.error(friendlyError(e, "Could not feature."));
    }
  };

  const handleUnfeature = async (id: Id<"testimonials">) => {
    try {
      await unfeatureMut({ testimonialId: id });
      toast.success("Testimonial unfeatured.");
    } catch (e) {
      toast.error(friendlyError(e, "Could not unfeature."));
    }
  };

  const handleReorder = async (t: AdminTestimonial, direction: "up" | "down") => {
    if (!list) return;
    // Reorder only within featured+approved testimonials (those that show on the landing page)
    const featured = list
      .filter((x) => x.featured && x.status === "approved")
      .sort((a, b) => a.displayOrder - b.displayOrder);
    const idx = featured.findIndex((x) => x._id === t._id);
    if (idx === -1) return;
    if (direction === "up" && idx === 0) return;
    if (direction === "down" && idx === featured.length - 1) return;
    const swapWith = direction === "up" ? featured[idx - 1]! : featured[idx + 1]!;
    try {
      await Promise.all([
        setDisplayOrderMut({ testimonialId: t._id, displayOrder: swapWith.displayOrder }),
        setDisplayOrderMut({ testimonialId: swapWith._id, displayOrder: t.displayOrder }),
      ]);
    } catch (e) {
      toast.error(friendlyError(e, "Could not reorder."));
    }
  };

  const handleDelete = async (t: AdminTestimonial) => {
    if (!window.confirm(`Permanently delete "${t.submitterName}"'s testimonial? This can't be undone.`)) return;
    try {
      await removeMut({ testimonialId: t._id });
      toast.success("Testimonial deleted.");
    } catch (e) {
      toast.error(friendlyError(e, "Could not delete."));
    }
  };

  // Pending count for the queue header
  const pendingCount = list?.filter((t) => t.status === "pending").length ?? 0;
  // Detect approved-but-not-featured testimonials — surfaces the "Feature all
  // approved" bulk-fix button (for testimonials approved BEFORE the auto-
  // feature-on-approve change).
  const hasUnfeaturedApproved = (list?.filter((t) => t.status === "approved" && !t.featured).length ?? 0) > 0;

  const handleBulkFeatureApproved = async () => {
    setBulkFixing(true);
    try {
      const result = await bulkFeatureApprovedMut({});
      if (result.flipped > 0) {
        toast.success(`Featured ${result.flipped} approved testimonial${result.flipped === 1 ? "" : "s"} — they're now on the landing page. 🎉`);
      } else {
        toast.success("All approved testimonials are already featured.");
      }
    } catch (e) {
      toast.error(friendlyError(e, "Could not bulk-feature."));
    } finally {
      setBulkFixing(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 font-mono text-[10px] font-bold uppercase tracking-wider text-amber-300">
            <MessageSquareQuote className="size-3.5" /> Testimonials
          </p>
          <h2 className="mt-1 type-h2">Student testimonials</h2>
          <p className="mt-1 max-w-xl type-caption text-muted-foreground">
            Review submissions, curate the public landing page set, and add real testimonials
            collected outside the app. Every testimonial must reflect a real person&apos;s
            real words — never invented.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {/* Bulk-fix button — surfaces when there are approved-but-not-featured
              testimonials (i.e. approved BEFORE the auto-feature change). One
              click flips them all to featured=true so they appear on the
              landing page. */}
          {hasUnfeaturedApproved && (
            <Button
              variant="outline"
              className="interactive-press cursor-pointer rounded-xl border-amber-400/30 bg-amber-400/10 text-amber-300 hover:bg-amber-400/20"
              onClick={() => void handleBulkFeatureApproved()}
              disabled={bulkFixing}
              title="One-click fix — brings existing approved testimonials in line with the new auto-feature-on-approve behavior"
            >
              {bulkFixing ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Star className="size-4" />
              )}
              Feature all approved
            </Button>
          )}
          <Button
            className="interactive-press cursor-pointer rounded-xl"
            onClick={() => setManualAddOpen(true)}
          >
            <Plus className="size-4" /> Add manually
          </Button>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex flex-wrap gap-1.5">
        {([
          ["pending", `Pending${pendingCount > 0 ? ` · ${pendingCount}` : ""}`],
          ["approved", "Approved"],
          ["rejected", "Rejected"],
          ["all", "All"],
        ] as const).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setFilter(value)}
            className={cn(
              "interactive-press cursor-pointer rounded-lg border px-3 py-1.5 type-caption font-bold uppercase tracking-wider transition",
              filter === value
                ? "border-primary/40 bg-primary/15 text-primary"
                : "border-white/10 bg-white/[0.04] text-muted-foreground hover:border-primary/30 hover:text-foreground",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {/* List */}
      {!list ? (
        <div className="glass-soft flex h-40 items-center justify-center rounded-2xl">
          <Loader2 className="size-5 animate-spin text-amber-300/60" />
        </div>
      ) : list.length === 0 ? (
        <div className="glass-soft flex flex-col items-center gap-2 rounded-2xl px-6 py-12 text-center">
          <MessageSquareQuote className="size-7 text-muted-foreground/40" />
          <p className="type-body text-muted-foreground">
            {filter === "pending"
              ? "No pending testimonials — submissions will show up here for review."
              : `No ${filter} testimonials.`}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <AnimatePresence mode="popLayout">
            {list.map((t, i) => (
              <motion.div
                key={t._id}
                layout
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8, scale: 0.97 }}
                transition={{ duration: 0.3, delay: i * 0.03, ease: [0.22, 1, 0.36, 1] }}
                className={cn(
                  "glass-soft rounded-2xl border p-4",
                  t.status === "pending"
                    ? "border-amber-400/25 bg-amber-400/[0.03]"
                    : t.status === "approved"
                      ? "border-emerald-400/15"
                      : "border-rose-400/15 opacity-70",
                )}
              >
                <TestimonialRow
                  t={t}
                  onApprove={handleApprove}
                  onReject={handleReject}
                  onFeature={handleFeature}
                  onUnfeature={handleUnfeature}
                  onEdit={() => setEditing(t)}
                  onReorder={handleReorder}
                  onDelete={handleDelete}
                />
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      {/* Edit dialog */}
      {editing && (
        <EditDialog
          testimonial={editing}
          open={!!editing}
          onOpenChange={(v) => !v && setEditing(null)}
        />
      )}

      {/* Manual add dialog */}
      <ManualAddDialog open={manualAddOpen} onOpenChange={setManualAddOpen} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Testimonial row — one card per testimonial in the admin queue
// ---------------------------------------------------------------------------

function TestimonialRow({
  t,
  onApprove,
  onReject,
  onFeature,
  onUnfeature,
  onEdit,
  onReorder,
  onDelete,
}: {
  t: AdminTestimonial;
  onApprove: (id: Id<"testimonials">) => Promise<void>;
  onReject: (id: Id<"testimonials">) => Promise<void>;
  onFeature: (id: Id<"testimonials">) => Promise<void>;
  onUnfeature: (id: Id<"testimonials">) => Promise<void>;
  onEdit: () => void;
  onReorder: (t: AdminTestimonial, dir: "up" | "down") => Promise<void>;
  onDelete: (t: AdminTestimonial) => Promise<void>;
}) {
  return (
    <div className="flex flex-col gap-3">
      {/* Header — name + role + status + verified badge */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="type-body font-bold">{t.submitterName}</p>
            {t.isVerifiedStudent && (
              <Badge className="border-emerald-400/30 bg-emerald-400/10 text-emerald-300" title="Submitted by a real in-app user — has a verifiable account behind it">
                <BadgeCheck className="size-2.5" /> Verified student
              </Badge>
            )}
            {!t.isVerifiedStudent && (
              <Badge className="border-white/10 bg-white/5 text-muted-foreground" title="Manually added by an admin — collected outside the app">
                Manual
              </Badge>
            )}
            <StatusBadge status={t.status} />
            {t.featured && (
              <Badge className="border-amber-400/30 bg-amber-400/10 text-amber-300">
                Featured
              </Badge>
            )}
          </div>
          <p className="mt-0.5 type-caption text-muted-foreground">{t.roleLabel}</p>
          {t.submitterEmail && (
            <p className="mt-0.5 font-mono text-[10px] text-muted-foreground/70">{t.submitterEmail}</p>
          )}
        </div>
        {/* Star rating */}
        {t.starRating !== null && t.starRating > 0 && (
          <div className="flex items-center gap-0.5">
            {[1, 2, 3, 4, 5].map((s) => (
              <Star
                key={s}
                className={cn(
                  "size-3",
                  s <= t.starRating! ? "fill-amber-400 text-amber-400" : "text-white/15",
                )}
              />
            ))}
          </div>
        )}
      </div>

      {/* Message */}
      <p className="rounded-xl border border-white/5 bg-white/[0.02] px-3 py-2.5 type-body text-foreground/90">
        &ldquo;{t.messageText}&rdquo;
      </p>

      {/* Footer — actions */}
      <div className="flex flex-wrap items-center gap-1.5">
        {t.status === "pending" && (
          <>
            <Button
              size="sm"
              className="interactive-press cursor-pointer rounded-lg bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25"
              onClick={() => void onApprove(t._id)}
            >
              <Check className="size-3.5" /> Approve
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="interactive-press cursor-pointer rounded-lg bg-rose-500/10 text-rose-300 hover:bg-rose-500/20"
              onClick={() => void onReject(t._id)}
            >
              <X className="size-3.5" /> Reject
            </Button>
          </>
        )}
        {t.status === "approved" && !t.featured && (
          <Button
            size="sm"
            className="interactive-press cursor-pointer rounded-lg bg-amber-500/15 text-amber-300 hover:bg-amber-500/25"
            onClick={() => void onFeature(t._id)}
          >
            <Star className="size-3.5" /> Feature
          </Button>
        )}
        {t.status === "approved" && t.featured && (
          <>
            <Button
              size="sm"
              variant="outline"
              className="interactive-press cursor-pointer rounded-lg"
              onClick={() => void onUnfeature(t._id)}
            >
              <Star className="size-3.5" /> Unfeature
            </Button>
            {/* Reorder arrows — only meaningful for featured testimonials */}
            <div className="flex items-center gap-0.5 rounded-lg border border-white/10 bg-white/[0.03] p-0.5">
              <button
                type="button"
                onClick={() => void onReorder(t, "up")}
                className="flex size-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition hover:bg-white/5 hover:text-foreground"
                title="Move up"
              >
                <ArrowUp className="size-3.5" />
              </button>
              <button
                type="button"
                onClick={() => void onReorder(t, "down")}
                className="flex size-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition hover:bg-white/5 hover:text-foreground"
                title="Move down"
              >
                <ArrowDown className="size-3.5" />
              </button>
            </div>
          </>
        )}
        <Button
          size="sm"
          variant="ghost"
          className="interactive-press cursor-pointer rounded-lg"
          onClick={onEdit}
        >
          <Edit3 className="size-3.5" /> Edit
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="interactive-press ml-auto cursor-pointer rounded-lg text-rose-300/70 hover:bg-rose-400/10 hover:text-rose-300"
          onClick={() => void onDelete(t)}
        >
          <Trash2 className="size-3.5" /> Delete
        </Button>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: "pending" | "approved" | "rejected" }) {
  const cls = {
    pending: "border-amber-400/30 bg-amber-400/10 text-amber-300",
    approved: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
    rejected: "border-rose-400/30 bg-rose-400/10 text-rose-300",
  }[status];
  return <Badge className={cls}>{status}</Badge>;
}

// ---------------------------------------------------------------------------
// Edit dialog
// ---------------------------------------------------------------------------

function EditDialog({
  testimonial,
  open,
  onOpenChange,
}: {
  testimonial: AdminTestimonial;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const friendlyError = useFriendlyError();
  const updateMut = useMutation(api.testimonials.update);
  const [submitterName, setSubmitterName] = useState(testimonial.submitterName);
  const [roleLabel, setRoleLabel] = useState(testimonial.roleLabel);
  const [messageText, setMessageText] = useState(testimonial.messageText);
  const [starRating, setStarRating] = useState<string>(
    testimonial.starRating !== null ? String(testimonial.starRating) : "",
  );
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload: Parameters<typeof updateMut>[0] = {
        testimonialId: testimonial._id,
        submitterName,
        roleLabel,
        messageText,
      };
      if (starRating === "") {
        payload.starRating = undefined;
      } else {
        const n = Number(starRating);
        if (!isNaN(n) && n >= 1 && n <= 5) {
          payload.starRating = n;
        }
      }
      await updateMut(payload);
      toast.success("Testimonial updated.");
      onOpenChange(false);
    } catch (e) {
      toast.error(friendlyError(e, "Could not save."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="glass-panel max-w-lg rounded-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Edit3 className="size-4 text-amber-300" /> Edit testimonial
          </DialogTitle>
          <DialogDescription>
            Light edits for length/clarity/grammar are OK — the underlying story
            must stay genuinely reflective of what the real person said.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <span className="text-[11px] font-semibold text-muted-foreground">Name</span>
              <Input
                value={submitterName}
                onChange={(e) => setSubmitterName(e.target.value)}
                className="h-10 rounded-xl bg-white/5"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-[11px] font-semibold text-muted-foreground">Star rating (1-5, blank=none)</span>
              <Input
                type="number"
                min={1}
                max={5}
                value={starRating}
                onChange={(e) => setStarRating(e.target.value)}
                className="h-10 rounded-xl bg-white/5"
              />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] font-semibold text-muted-foreground">Role label</span>
            <Input
              value={roleLabel}
              onChange={(e) => setRoleLabel(e.target.value)}
              placeholder="e.g. Grade 12 student, Addis Ababa"
              className="h-10 rounded-xl bg-white/5"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] font-semibold text-muted-foreground">
              Message ({messageText.length}/600)
            </span>
            <Textarea
              value={messageText}
              onChange={(e) => setMessageText(e.target.value)}
              maxLength={600}
              rows={4}
              className="rounded-xl bg-white/5"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" className="cursor-pointer rounded-xl bg-white/5" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button className="cursor-pointer rounded-xl" onClick={() => void handleSave()} disabled={saving}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Manual add dialog
// ---------------------------------------------------------------------------

function ManualAddDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const friendlyError = useFriendlyError();
  const createMut = useMutation(api.testimonials.createManual);
  const generateUploadUrl = useMutation(api.testimonials.generateAdminPhotoUploadUrl);
  const [submitterName, setSubmitterName] = useState("");
  const [roleLabel, setRoleLabel] = useState("");
  const [messageText, setMessageText] = useState("");
  const [starRating, setStarRating] = useState<string>("");
  const [featured, setFeatured] = useState(false);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setSubmitterName("");
    setRoleLabel("");
    setMessageText("");
    setStarRating("");
    setFeatured(false);
    setPhotoFile(null);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      let photoStorageId: string | undefined;
      if (photoFile) {
        const uploadUrl = await generateUploadUrl();
        const res = await fetch(uploadUrl, {
          method: "POST",
          body: photoFile,
        });
        if (!res.ok) throw new Error("Upload failed");
        // Extract storageId from the upload response URL
        const uploaded = (await res.json()) as { storageId?: string };
        photoStorageId = uploaded.storageId;
      }
      await createMut({
        submitterName,
        roleLabel,
        messageText,
        starRating: starRating === "" ? undefined : Number(starRating),
        submitterPhotoStorageId: photoStorageId,
        featured,
      });
      toast.success("Testimonial added — it's now on the landing page (if featured).");
      reset();
      onOpenChange(false);
    } catch (e) {
      toast.error(friendlyError(e, "Could not add testimonial."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="glass-panel max-w-lg rounded-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plus className="size-4 text-amber-300" /> Add testimonial manually
          </DialogTitle>
          <DialogDescription>
            For genuine testimonials collected outside the app — a WhatsApp message,
            an in-person conversation, etc. The admin is the conduit, NOT the author.
            The name + words must reflect a real person&apos;s real statement.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <span className="text-[11px] font-semibold text-muted-foreground">Submitter name</span>
              <Input
                value={submitterName}
                onChange={(e) => setSubmitterName(e.target.value)}
                placeholder="Real person's name"
                className="h-10 rounded-xl bg-white/5"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-[11px] font-semibold text-muted-foreground">Star rating (1-5, blank=none)</span>
              <Input
                type="number"
                min={1}
                max={5}
                value={starRating}
                onChange={(e) => setStarRating(e.target.value)}
                className="h-10 rounded-xl bg-white/5"
              />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] font-semibold text-muted-foreground">Role label</span>
            <Input
              value={roleLabel}
              onChange={(e) => setRoleLabel(e.target.value)}
              placeholder="e.g. Grade 12 student, Addis Ababa"
              className="h-10 rounded-xl bg-white/5"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] font-semibold text-muted-foreground">
              Message ({messageText.length}/600)
            </span>
            <Textarea
              value={messageText}
              onChange={(e) => setMessageText(e.target.value)}
              maxLength={600}
              rows={4}
              placeholder="The real person's actual words — never invented."
              className="rounded-xl bg-white/5"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] font-semibold text-muted-foreground">Photo (optional)</span>
            <input
              type="file"
              accept="image/*"
              onChange={(e) => setPhotoFile(e.target.files?.[0] ?? null)}
              className="cursor-pointer text-xs text-muted-foreground"
            />
            {photoFile && (
              <p className="font-mono text-[10px] text-muted-foreground/70">{photoFile.name}</p>
            )}
          </div>
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={featured}
              onChange={(e) => setFeatured(e.target.checked)}
              className="cursor-pointer accent-amber-400"
            />
            <span className="type-caption text-foreground/85">Feature on landing page immediately</span>
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" className="cursor-pointer rounded-xl bg-white/5" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            className="cursor-pointer rounded-xl"
            onClick={() => void handleSave()}
            disabled={saving || !submitterName.trim() || !roleLabel.trim() || !messageText.trim()}
          >
            {saving ? <Loader2 className="size-4 animate-spin" /> : "Add testimonial"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
