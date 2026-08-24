// Audit Log section — visible ONLY to super_admin.
// Read-only view of all admin actions with filters.

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useQuery } from "convex/react";
import { relativeTime } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { ScrollText, Clock, ChevronDown, ChevronRight, Loader2, Filter } from "lucide-react";
import { useState, useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
/* ── Constants ──────────────────────────────────────────────────── */

const ACTION_OPTIONS = [
  { value: "", label: "All actions" },
  { value: "admin.role_changed", label: "admin.role_changed" },
  { value: "admin.removed", label: "admin.removed" },
  { value: "admin.invited", label: "admin.invited" },
  { value: "admin.invite_claimed", label: "admin.invite_claimed" },
  { value: "content.deleted", label: "content.deleted" },
  { value: "payment.status_changed", label: "payment.status_changed" },
  { value: "user.premium_granted", label: "user.premium_granted" },
] as const;

const ACTION_BADGE_STYLES: Record<string, string> = {
  "admin.role_changed": "bg-amber-400/15 text-amber-300 border-amber-400/25",
  "admin.removed": "bg-amber-400/15 text-amber-300 border-amber-400/25",
  "admin.invited": "bg-amber-400/15 text-amber-300 border-amber-400/25",
  "admin.invite_claimed": "bg-amber-400/15 text-amber-300 border-amber-400/25",
  "content.deleted": "bg-primary/15 text-primary border-primary/25",
  "payment.status_changed": "bg-emerald-400/15 text-emerald-300 border-emerald-400/25",
  "user.premium_granted": "bg-violet-400/15 text-violet-300 border-violet-400/25",
};

function getActionBadgeStyle(action: string): string {
  // Use prefix matching for unknown actions
  if (ACTION_BADGE_STYLES[action]) return ACTION_BADGE_STYLES[action];
  if (action.startsWith("admin.")) return ACTION_BADGE_STYLES["admin.role_changed"];
  if (action.startsWith("content.")) return ACTION_BADGE_STYLES["content.deleted"];
  if (action.startsWith("payment.")) return ACTION_BADGE_STYLES["payment.status_changed"];
  if (action.startsWith("user.")) return ACTION_BADGE_STYLES["user.premium_granted"];
  return "bg-white/5 text-muted-foreground border-white/10";
}

/* ── Expandable JSON detail ─────────────────────────────────────── */

function DetailCell({ details }: { details: string | null | undefined }) {
  const [expanded, setExpanded] = useState(false);

  if (!details) return <span className="text-muted-foreground">—</span>;

  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = JSON.parse(details);
  } catch {
    return <span className="font-mono text-[11px] text-muted-foreground">{details}</span>;
  }

  if (!parsed) return <span className="text-muted-foreground">—</span>;

  const entries = Object.entries(parsed);

  return (
    <div>
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
      >
        {expanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
        {entries.length} {entries.length === 1 ? "field" : "fields"}
      </button>
      {expanded && (
        <div className="mt-1.5 space-y-0.5 rounded-lg border border-white/5 bg-white/[0.03] p-2">
          {entries.map(([key, value]) => (
            <div key={key} className="flex gap-2 font-mono text-[10px]">
              <span className="shrink-0 text-muted-foreground">{key}:</span>
              <span className="truncate text-foreground">
                {typeof value === "string" ? value : JSON.stringify(value)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Main component ──────────────────────────────────────────────── */

export function AdminAuditLogSection() {
  const [actionFilter, setActionFilter] = useState<string>("");
  const [actorFilter, setActorFilter] = useState<string>("");

  const auditLog = useQuery(api.adminManagement.listAuditLog, {
    limit: 100,
    actionType: actionFilter || undefined,
    actorId: (actorFilter || undefined) as Id<"users"> | undefined,
  });

  // Build actor options from log entries
  const actorOptions = useMemo(() => {
    if (!auditLog) return [];
    const seen = new Map<string, { id: string; label: string }>();
    for (const entry of auditLog) {
      const key = entry.actorUserId;
      const label = entry.actorEmail ?? entry.actorName ?? key;
      if (!seen.has(key)) {
        seen.set(key, { id: key, label });
      }
    }
    return Array.from(seen.values());
  }, [auditLog]);

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {/* ── Header ── */}
      <div className="glass-panel rounded-2xl p-5">
        <div className="mb-4 flex items-center gap-2">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-amber-400/15">
            <ScrollText className="size-4 text-amber-300" />
          </div>
          <div>
            <h2 className="text-sm font-extrabold tracking-tight">Audit log</h2>
            <p className="text-[11px] text-muted-foreground">
              Append-only record of all privileged operations
            </p>
          </div>
        </div>

        {/* ── Filters ── */}
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-56">
            <label className="type-mono mb-1.5 flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
              <Filter className="size-3" /> Action type
            </label>
            <Select value={actionFilter} onValueChange={setActionFilter}>
              <SelectTrigger className="h-9 rounded-lg bg-white/5 font-mono text-[11px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ACTION_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value || "all"} value={opt.value || "all"}>
                    <span className="font-mono text-[11px]">{opt.label}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="w-48">
            <label className="type-mono mb-1.5 flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
              <Filter className="size-3" /> Actor
            </label>
            <Select value={actorFilter || "all"} onValueChange={(v) => setActorFilter(v === "all" ? "" : v)}>
              <SelectTrigger className="h-9 rounded-lg bg-white/5 font-mono text-[11px]">
                <SelectValue placeholder="All actors" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">
                  <span className="font-mono text-[11px]">All actors</span>
                </SelectItem>
                {actorOptions.map((actor) => (
                  <SelectItem key={actor.id} value={actor.id}>
                    <span className="font-mono text-[11px]">{actor.label}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* ── Table ── */}
      <div className="glass-panel rounded-2xl p-5">
        {auditLog === undefined ? (
          <div className="flex h-40 items-center justify-center">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : auditLog.length === 0 ? (
          <div className="flex flex-col items-center py-10 text-muted-foreground">
            <ScrollText className="mb-2 size-8 opacity-30" />
            <p className="text-sm">No audit entries yet</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-white/5 hover:bg-transparent">
                  <TableHead className="type-mono h-9 w-24 text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                    Timestamp
                  </TableHead>
                  <TableHead className="type-mono h-9 text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                    Actor
                  </TableHead>
                  <TableHead className="type-mono h-9 text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                    Action
                  </TableHead>
                  <TableHead className="type-mono h-9 text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                    Target
                  </TableHead>
                  <TableHead className="type-mono h-9 text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                    Details
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {auditLog.map((entry: { _id: string; actorUserId: string; actorEmail?: string | null; actorName?: string | null; action: string; targetType?: string | null; targetId?: string | null; details?: string | null; createdAt: number }) => (
                  <TableRow
                    key={entry._id}
                    className="border-white/5 hover:bg-white/[0.03]"
                  >
                    <TableCell className="whitespace-nowrap font-mono text-[11px] text-muted-foreground">
                      <span className="flex items-center gap-1.5">
                        <Clock className="size-3" />
                        {relativeTime(entry.createdAt)}
                      </span>
                    </TableCell>
                    <TableCell className="font-mono text-sm">
                      {entry.actorEmail ?? entry.actorName ?? "—"}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={cn(
                          "font-mono text-[9px] font-bold uppercase tracking-wider",
                          getActionBadgeStyle(entry.action),
                        )}
                      >
                        {entry.action}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-[11px] text-muted-foreground">
                      {entry.targetType
                        ? `${entry.targetType}:${(entry.targetId ?? "—").length > 16 ? (entry.targetId ?? "—").slice(0, 8) + "…" : (entry.targetId ?? "—")}`
                        : "—"}
                    </TableCell>
                    <TableCell>
                      <DetailCell details={entry.details} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}
