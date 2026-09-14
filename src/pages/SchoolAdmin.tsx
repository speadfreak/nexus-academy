// SchoolAdmin — the director's dashboard for managing classes + bulk seats.
// Gated on SCHOOL_FEATURE_ENABLED at the route level (main.tsx SchoolFeatureGate).
// Only renders for users who are designated as a school director.

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { motion } from "framer-motion";
import {
  Building2,
  Calendar,
  CheckCircle2,
  Copy,
  GraduationCap,
  Loader2,
  Plus,
  Users,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { DashboardShell } from "@/components/DashboardShell";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useFriendlyError } from "@/lib/errors";
import { cn } from "@/lib/utils";

export default function SchoolAdmin() {
  const friendlyError = useFriendlyError();
  const school = useQuery(api.schools.directorGetMySchool);
  const [createOpen, setCreateOpen] = useState(false);

  if (school === undefined) {
    return (
      <DashboardShell>
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="size-6 animate-spin text-amber-300/60" />
        </div>
      </DashboardShell>
    );
  }

  if (school === null) {
    return (
      <DashboardShell>
        <div className="glass-soft mx-auto mt-20 max-w-md rounded-3xl p-8 text-center">
          <Building2 className="mx-auto size-10 text-muted-foreground/40" />
          <h2 className="mt-4 type-h2">Not a school director</h2>
          <p className="mt-2 type-body text-muted-foreground">
            This dashboard is for designated school directors. If you believe
            this is an error, contact the platform admin.
          </p>
        </div>
      </DashboardShell>
    );
  }

  return (
    <DashboardShell>
      <div className="flex flex-col gap-5 sm:gap-6">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
        >
          <p className="uppercase tracking-[0.22em] text-violet-300 font-semibold type-caption">
            // school admin
          </p>
          <h1 className="mt-1 type-h1 text-gradient">{school.name}</h1>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Badge className="border-violet-400/30 bg-violet-400/10 text-violet-300">
              <Users className="size-2.5" /> {school.seatsPurchased} seats
            </Badge>
            {school.seatsExpireAt && (
              <Badge className={cn(
                "border",
                school.seatsExpireAt > Date.now()
                  ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300"
                  : "border-rose-400/30 bg-rose-400/10 text-rose-300",
              )}>
                <Calendar className="size-2.5" /> Expires {new Date(school.seatsExpireAt).toLocaleDateString()}
              </Badge>
            )}
          </div>
        </motion.div>

        {/* Classes */}
        <div className="glass-panel rounded-3xl p-5 sm:p-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-foreground">
                Classes
              </p>
              <p className="mt-0.5 type-caption text-muted-foreground">
                Create classes and share the code with your students
              </p>
            </div>
            <Button className="interactive-press cursor-pointer rounded-xl" onClick={() => setCreateOpen(true)}>
              <Plus className="size-4" /> New class
            </Button>
          </div>
          <div className="mt-4 flex flex-col gap-2">
            {school.classes.length === 0 ? (
              <div className="glass-soft flex flex-col items-center rounded-2xl px-6 py-10 text-center">
                <GraduationCap className="size-7 text-muted-foreground/40" />
                <p className="mt-2 type-body text-muted-foreground">No classes yet.</p>
                <p className="type-caption text-muted-foreground/70">
                  Create your first class — students join with the shareable code.
                </p>
              </div>
            ) : (
              school.classes.map((c, i) => (
                <motion.div
                  key={c._id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, delay: i * 0.05, ease: "easeOut" }}
                  className="glass-soft flex items-center gap-3 rounded-2xl border border-white/5 px-4 py-3.5"
                >
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-violet-400/10 text-violet-300">
                    <GraduationCap className="size-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate type-body font-bold">{c.name}</p>
                    <p className="type-caption text-muted-foreground">
                      Grade {c.gradeLevel} · {c.stream} · {c.memberCount} member{c.memberCount === 1 ? "" : "s"}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(c.classCode);
                        toast.success("Class code copied.");
                      } catch {
                        toast.error("Could not copy.");
                      }
                    }}
                    className="flex items-center gap-1.5 rounded-lg border border-violet-400/30 bg-violet-400/10 px-3 py-1.5 font-mono text-xs font-bold text-violet-300 transition hover:bg-violet-400/20"
                  >
                    <Copy className="size-3" /> {c.classCode}
                  </button>
                </motion.div>
              ))
            )}
          </div>
        </div>
      </div>

      <CreateClassDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        schoolId={school._id}
      />
    </DashboardShell>
  );
}

function CreateClassDialog({
  open,
  onOpenChange,
  schoolId: _schoolId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  schoolId: Id<"schools">;
}) {
  const friendlyError = useFriendlyError();
  const createClass = useMutation(api.schools.directorCreateClass);
  const [name, setName] = useState("");
  const [grade, setGrade] = useState<string>("9");
  const [stream, setStream] = useState<string>("natural");
  const [creating, setCreating] = useState(false);

  const handleCreate = async () => {
    if (!name.trim()) {
      toast.error("Class name is required.");
      return;
    }
    setCreating(true);
    try {
      const result = await createClass({
        name: name.trim(),
        gradeLevel: Number(grade) as 9 | 10 | 11 | 12,
        stream: stream as "natural" | "social" | "common",
      });
      toast.success(`Class created! Share code ${result.classCode} with your students.`);
      onOpenChange(false);
      setName("");
    } catch (e) {
      toast.error(friendlyError(e, "Could not create the class."));
    } finally {
      setCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="glass-panel max-w-md rounded-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plus className="size-4 text-violet-300" /> Create a class
          </DialogTitle>
          <DialogDescription>
            Students join with the auto-generated shareable code — they're
            pre-configured with the right grade and stream automatically.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] font-semibold text-muted-foreground">Class name</span>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Grade 12 Natural — Section A"
              className="h-10 rounded-xl bg-white/5"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <span className="text-[11px] font-semibold text-muted-foreground">Grade</span>
              <Select value={grade} onValueChange={setGrade}>
                <SelectTrigger className="h-10 rounded-xl bg-white/5">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[9, 10, 11, 12].map((g) => (
                    <SelectItem key={g} value={String(g)}>Grade {g}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-[11px] font-semibold text-muted-foreground">Stream</span>
              <Select value={stream} onValueChange={setStream}>
                <SelectTrigger className="h-10 rounded-xl bg-white/5">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="natural">Natural</SelectItem>
                  <SelectItem value="social">Social</SelectItem>
                  <SelectItem value="common">Common</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" className="cursor-pointer rounded-xl bg-white/5" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button className="cursor-pointer rounded-xl" onClick={() => void handleCreate()} disabled={creating}>
            {creating ? <Loader2 className="size-4 animate-spin" /> : "Create class"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
