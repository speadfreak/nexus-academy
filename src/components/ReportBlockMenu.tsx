// Safety menu — Report + Block, deliberately easy to find (one tap from any
// participant tile or group member row). Report opens a quick form with a
// fixed reason set; Block hides the person from you everywhere (server-side
// enforced in rooms + group contexts). Built as a shared component so the
// same honest flow exists in rooms and groups — no dead ends.

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useMutation } from "convex/react";
import { Ban, Flag, MoreVertical, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { errorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";

const REPORT_REASONS: { value: string; label: string }[] = [
  { value: "harassment", label: "Harassment or bullying" },
  { value: "inappropriate_content", label: "Inappropriate content" },
  { value: "spam", label: "Spam or disruptive behavior" },
  { value: "other", label: "Something else" },
];

interface ReportBlockMenuProps {
  targetUserId: Id<"users">;
  targetName: string;
  roomId?: Id<"studyRooms">;
  initiallyBlocked?: boolean;
  onBlockedChange?: (blocked: boolean) => void;
  /** Smaller trigger for tight rows. */
  compact?: boolean;
  /** Hide the trigger when the target is the viewer themself. */
  disabled?: boolean;
}

export function ReportBlockMenu({
  targetUserId,
  targetName,
  roomId,
  initiallyBlocked = false,
  onBlockedChange,
  compact = false,
  disabled = false,
}: ReportBlockMenuProps) {
  const reportUser = useMutation(api.safety.reportUser);
  const blockUser = useMutation(api.safety.blockUser);
  const unblockUser = useMutation(api.safety.unblockUser);

  const [reportOpen, setReportOpen] = useState(false);
  const [reason, setReason] = useState("harassment");
  const [details, setDetails] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [blocked, setBlocked] = useState(initiallyBlocked);
  const [blocking, setBlocking] = useState(false);

  if (disabled) return null;

  const handleReport = async () => {
    setSubmitting(true);
    try {
      await reportUser({
        reportedUserId: targetUserId,
        roomId,
        reason: reason as "harassment" | "inappropriate_content" | "spam" | "other",
        details: details.trim() || undefined,
      });
      toast.success("Report submitted — a moderator will review it.");
      setReportOpen(false);
      setDetails("");
      setReason("harassment");
    } catch (error) {
      toast.error(errorMessage(error, "Could not submit the report."));
    } finally {
      setSubmitting(false);
    }
  };

  const handleBlock = async () => {
    setBlocking(true);
    try {
      if (blocked) {
        await unblockUser({ blockedUserId: targetUserId });
        setBlocked(false);
        onBlockedChange?.(false);
        toast.success(`Unblocked ${targetName}.`);
      } else {
        await blockUser({ blockedUserId: targetUserId });
        setBlocked(true);
        onBlockedChange?.(true);
        toast.success(
          `${targetName} is now blocked — they can't see you in rooms or shared groups, and you won't see them.`,
        );
      }
    } catch (error) {
      toast.error(errorMessage(error, "Could not update the block."));
    } finally {
      setBlocking(false);
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`Safety options for ${targetName}`}
            className={cn(
              "flex shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground",
              compact ? "size-7" : "size-8",
            )}
          >
            <MoreVertical className={compact ? "size-3.5" : "size-4"} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="glass-panel w-56 rounded-xl border-white/10">
          <DropdownMenuItem
            className="cursor-pointer gap-2.5 rounded-lg focus:bg-white/5"
            onSelect={() => setReportOpen(true)}
          >
            <Flag className="size-4 text-destructive" /> Report {targetName}
          </DropdownMenuItem>
          <DropdownMenuSeparator className="bg-white/5" />
          <DropdownMenuItem
            className="cursor-pointer gap-2.5 rounded-lg focus:bg-white/5"
            onSelect={() => void handleBlock()}
            disabled={blocking}
          >
            {blocked ? (
              <>
                <ShieldCheck className="size-4 text-emerald-300" /> Unblock {targetName}
              </>
            ) : (
              <>
                <Ban className="size-4 text-amber-300" /> Block {targetName}
              </>
            )}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Report dialog */}
      <Dialog open={reportOpen} onOpenChange={setReportOpen}>
        <DialogContent className="glass-panel max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Flag className="size-4 text-destructive" /> Report {targetName}
            </DialogTitle>
            <DialogDescription>
              Reports go straight to a moderator. They won&apos;t be told who reported them.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <span className="text-[11px] font-semibold text-muted-foreground">Reason</span>
              <Select value={reason} onValueChange={setReason}>
                <SelectTrigger className="h-10 rounded-xl bg-white/5">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {REPORT_REASONS.map((r) => (
                    <SelectItem key={r.value} value={r.value}>
                      {r.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-[11px] font-semibold text-muted-foreground">
                Details (optional)
              </span>
              <Input
                value={details}
                onChange={(e) => setDetails(e.target.value)}
                placeholder="What happened? A short note helps us act."
                className="h-20 items-start rounded-xl bg-white/5 py-3"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              className="cursor-pointer rounded-xl bg-white/5"
              onClick={() => setReportOpen(false)}
            >
              Cancel
            </Button>
            <Button
              className="cursor-pointer rounded-xl"
              onClick={() => void handleReport()}
              disabled={submitting}
            >
              {submitting ? "Submitting…" : "Submit report"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
