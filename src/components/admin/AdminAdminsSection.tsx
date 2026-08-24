// Admin Management section — visible ONLY to super_admin.
// Invite admins, view current admins, manage roles, view pending invites.

import { api } from "@/convex/_generated/api";
import { useAction, useQuery } from "convex/react";
import { ROLES } from "@/convex/schema";
import { relativeTime } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  UserPlus,
  Shield,
  ShieldCheck,
  ShieldAlert,
  Trash2,
  Pencil,
  Clock,
  Mail,
  Loader2,
  AlertTriangle,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { Id } from "@/convex/_generated/dataModel";

/* ── Role badge styling ──────────────────────────────────────────── */

const ROLE_BADGE_STYLES: Record<string, string> = {
  [ROLES.SUPER_ADMIN]: "bg-amber-400/15 text-amber-300 border-amber-400/25",
  [ROLES.ADMIN]: "bg-primary/15 text-primary border-primary/25",
  [ROLES.MODERATOR]: "bg-emerald-400/15 text-emerald-300 border-emerald-400/25",
};

function RoleBadge({ role }: { role: string }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "gap-1.5 font-mono text-[10px] font-bold uppercase tracking-wider",
        ROLE_BADGE_STYLES[role] ?? "bg-white/5 text-muted-foreground border-white/10",
      )}
    >
      {role === ROLES.SUPER_ADMIN && <ShieldAlert className="size-3" />}
      {role === ROLES.ADMIN && <ShieldCheck className="size-3" />}
      {role === ROLES.MODERATOR && <Shield className="size-3" />}
      {role.replace(/_/g, " ")}
    </Badge>
  );
}

/* ── Types ──────────────────────────────────────────────────────── */

interface AdminEntry {
  _id: Id<"users">;
  name: string | null;
  email: string | null;
  role: string;
  isAnonymous: boolean;
  lastActiveAt: number | null;
}

interface PendingInvite {
  _id: string;
  email: string;
  intendedRole: string;
  invitedBy: Id<"users">;
  createdAt: number;
}

/* ── Main component ──────────────────────────────────────────────── */

export function AdminAdminsSection() {
  const listAdminsAction = useAction(api.adminManagement.listAdmins);
  const inviteAdminAction = useAction(api.adminManagement.inviteAdmin);
  const changeRoleAction = useAction(api.adminManagement.changeAdminRole);
  const removeAdminAction = useAction(api.adminManagement.removeAdmin);
  const currentUser = useQuery(api.users.currentUser);

  const [admins, setAdmins] = useState<AdminEntry[]>([]);
  const [pendingInvites, setPendingInvites] = useState<PendingInvite[]>([]);
  const [loading, setLoading] = useState(true);

  // Invite form state
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<string>(ROLES.ADMIN);
  const [inviting, setInviting] = useState(false);

  // Edit role dialog state
  const [editTarget, setEditTarget] = useState<{
    _id: Id<"users">;
    name: string | null;
    email: string | null;
    currentRole: string;
  } | null>(null);
  const [editNewRole, setEditNewRole] = useState<string>(ROLES.ADMIN);
  const [editSaving, setEditSaving] = useState(false);

  // Super admin confirmation for role changes involving super_admin
  const [superAdminEmailInput, setSuperAdminEmailInput] = useState("");

  // Remove dialog state
  const [removeTarget, setRemoveTarget] = useState<{
    _id: Id<"users">;
    name: string | null;
    email: string | null;
    role: string;
  } | null>(null);
  const [removing, setRemoving] = useState(false);

  // Load admins on mount
  const loadAdmins = async () => {
    setLoading(true);
    try {
      const result = await listAdminsAction();
      setAdmins(result.admins as AdminEntry[]);
      setPendingInvites(result.pendingInvites as PendingInvite[]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load admins.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadAdmins();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Invite handler ──
  const handleInvite = async () => {
    if (!inviteEmail.trim()) return;
    setInviting(true);
    try {
      await inviteAdminAction({ email: inviteEmail.trim(), role: inviteRole as never });
      toast.success(inviteEmail.trim() + (inviteRole === ROLES.ADMIN ? " promoted to admin." : " invited as moderator."));
      setInviteEmail("");
      setInviteRole(ROLES.ADMIN);
      await loadAdmins();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to invite.");
    } finally {
      setInviting(false);
    }
  };

  // ── Edit role handler ──
  const handleEditRole = async () => {
    if (!editTarget) return;

    // P4 SAFEGUARD: If changing TO or FROM super_admin, require email confirmation
    const involvesSuperAdmin =
      editTarget.currentRole === ROLES.SUPER_ADMIN || editNewRole === ROLES.SUPER_ADMIN;
    if (involvesSuperAdmin && superAdminEmailInput !== (editTarget.email ?? "")) {
      toast.error("Email does not match. Type the admin's email exactly to confirm.");
      return;
    }

    setEditSaving(true);
    try {
      await changeRoleAction({
        targetUserId: editTarget._id,
        newRole: editNewRole as never,
      });
      toast.success(`Role changed to ${editNewRole.replace(/_/g, " ")} for ${editTarget.email ?? editTarget.name ?? "user"}.`);
      setEditTarget(null);
      setSuperAdminEmailInput("");
      await loadAdmins();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to change role.");
    } finally {
      setEditSaving(false);
    }
  };

  // ── Remove handler ──
  const handleRemove = async () => {
    if (!removeTarget) return;
    setRemoving(true);
    try {
      await removeAdminAction({ targetUserId: removeTarget._id });
      toast.success(`${removeTarget.email ?? removeTarget.name ?? "User"} removed from admin.`);
      setRemoveTarget(null);
      await loadAdmins();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to remove admin.");
    } finally {
      setRemoving(false);
    }
  };

  // ── Open edit dialog ──
  const openEditDialog = (admin: AdminEntry) => {
    setEditTarget({
      _id: admin._id,
      name: admin.name,
      email: admin.email,
      currentRole: admin.role,
    });
    setEditNewRole(admin.role === ROLES.SUPER_ADMIN ? ROLES.ADMIN : admin.role);
    setSuperAdminEmailInput("");
  };

  const currentUserId = currentUser?._id;

  if (loading) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {/* ── Invite section ── */}
      <div className="glass-panel rounded-2xl p-5">
        <div className="mb-4 flex items-center gap-2">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/15">
            <UserPlus className="size-4 text-primary" />
          </div>
          <div>
            <h2 className="text-sm font-extrabold tracking-tight">Invite admin</h2>
            <p className="text-[11px] text-muted-foreground">
              Add an existing user as admin/moderator, or create a pending invite.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[200px] flex-1">
            <label className="type-mono mb-1.5 block text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
              Email
            </label>
            <Input
              type="email"
              placeholder="user@example.com"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              className="h-9 rounded-lg bg-white/5 font-mono text-sm"
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleInvite();
              }}
            />
          </div>
          <div className="w-40">
            <label className="type-mono mb-1.5 block text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
              Role
            </label>
            <Select value={inviteRole} onValueChange={setInviteRole}>
              <SelectTrigger className="h-9 rounded-lg bg-white/5 font-mono text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ROLES.ADMIN}>
                  <span className="flex items-center gap-2">
                    <ShieldCheck className="size-3.5 text-primary" /> Admin
                  </span>
                </SelectItem>
                <SelectItem value={ROLES.MODERATOR}>
                  <span className="flex items-center gap-2">
                    <Shield className="size-3.5 text-emerald-400" /> Moderator
                  </span>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button
            size="sm"
            className="h-9 rounded-lg"
            onClick={() => void handleInvite()}
            disabled={inviting || !inviteEmail.trim()}
          >
            {inviting ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <UserPlus className="size-3.5" />
            )}
            Invite
          </Button>
        </div>
      </div>

      {/* ── Current admins table ── */}
      <div className="glass-panel rounded-2xl p-5">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-amber-400/15">
              <ShieldAlert className="size-4 text-amber-300" />
            </div>
            <div>
              <h2 className="text-sm font-extrabold tracking-tight">Current admins</h2>
              <p className="text-[11px] text-muted-foreground">
                {admins.length} {admins.length === 1 ? "member" : "members"} with elevated access
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 rounded-lg bg-white/5 text-[11px]"
            onClick={() => void loadAdmins()}
          >
            <Loader2 className={cn("size-3", loading && "animate-spin")} /> Refresh
          </Button>
        </div>

        {admins.length === 0 ? (
          <div className="flex flex-col items-center py-10 text-muted-foreground">
            <Shield className="mb-2 size-8 opacity-30" />
            <p className="text-sm">No admins yet</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-white/5 hover:bg-transparent">
                  <TableHead className="type-mono h-9 text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Email</TableHead>
                  <TableHead className="type-mono h-9 text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Name</TableHead>
                  <TableHead className="type-mono h-9 text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Role</TableHead>
                  <TableHead className="type-mono h-9 text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Last Active</TableHead>
                  <TableHead className="type-mono h-9 text-right text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {admins.map((admin) => {
                  const isSelf = admin._id === currentUserId;
                  return (
                    <TableRow
                      key={admin._id}
                      className="border-white/5 hover:bg-white/[0.03]"
                    >
                      <TableCell className="font-mono text-sm">
                        <div className="flex items-center gap-2">
                          <Mail className="size-3.5 text-muted-foreground" />
                          {admin.email ?? "—"}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm">
                        {admin.name ?? (admin.isAnonymous ? "(anonymous)" : "—")}
                      </TableCell>
                      <TableCell>
                        <RoleBadge role={admin.role} />
                      </TableCell>
                      <TableCell className="font-mono text-[11px] text-muted-foreground">
                        {admin.lastActiveAt ? (
                          <span className="flex items-center gap-1.5">
                            <Clock className="size-3" /> {relativeTime(admin.lastActiveAt)}
                          </span>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 gap-1.5 rounded-lg px-2 text-[11px] hover:bg-white/5"
                            onClick={() => openEditDialog(admin)}
                          >
                            <Pencil className="size-3" /> Edit
                          </Button>
                          {!isSelf && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 gap-1.5 rounded-lg px-2 text-[11px] text-rose-300 hover:bg-rose-400/10 hover:text-rose-200"
                              onClick={() =>
                                setRemoveTarget({
                                  _id: admin._id,
                                  name: admin.name,
                                  email: admin.email,
                                  role: admin.role,
                                })
                              }
                            >
                              <Trash2 className="size-3" /> Remove
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {/* ── Pending invites ── */}
      <div className="glass-panel rounded-2xl p-5">
        <div className="mb-4 flex items-center gap-2">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-white/5">
            <Mail className="size-4 text-muted-foreground" />
          </div>
          <div>
            <h2 className="text-sm font-extrabold tracking-tight">Pending invites</h2>
            <p className="text-[11px] text-muted-foreground">
              {pendingInvites.length} unclaimed {pendingInvites.length === 1 ? "invite" : "invites"}
            </p>
          </div>
        </div>

        {pendingInvites.length === 0 ? (
          <div className="rounded-xl border border-dashed border-white/10 py-8 text-center text-sm text-muted-foreground">
            No pending invites
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {pendingInvites.map((invite) => (
              <div
                key={invite._id}
                className="flex flex-wrap items-center gap-3 rounded-xl border border-white/5 bg-white/[0.03] px-3.5 py-3"
              >
                <Mail className="size-4 text-muted-foreground" />
                <span className="font-mono text-sm">{invite.email}</span>
                <RoleBadge role={invite.intendedRole} />
                <span className="ml-auto flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground">
                  <Clock className="size-3" /> invited {relativeTime(invite.createdAt)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ═══ Edit Role Dialog ═══ */}
      <Dialog
        open={!!editTarget}
        onOpenChange={(open) => {
          if (!open) {
            setEditTarget(null);
            setSuperAdminEmailInput("");
          }
        }}
      >
        <DialogContent className="glass-panel rounded-2xl border-white/10 bg-popover sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pencil className="size-4 text-primary" />
              Change role
            </DialogTitle>
            <DialogDescription>
              Change role for <span className="font-mono font-semibold text-foreground">{editTarget?.email ?? editTarget?.name}</span>
              {" "}from <strong>{editTarget?.currentRole?.replace(/_/g, " ")}</strong>.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4 py-2">
            <div>
              <label className="type-mono mb-1.5 block text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                New role
              </label>
              <Select value={editNewRole} onValueChange={setEditNewRole}>
                <SelectTrigger className="h-9 rounded-lg bg-white/5 font-mono text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ROLES.SUPER_ADMIN}>
                    <span className="flex items-center gap-2">
                      <ShieldAlert className="size-3.5 text-amber-300" /> Super Admin
                    </span>
                  </SelectItem>
                  <SelectItem value={ROLES.ADMIN}>
                    <span className="flex items-center gap-2">
                      <ShieldCheck className="size-3.5 text-primary" /> Admin
                    </span>
                  </SelectItem>
                  <SelectItem value={ROLES.MODERATOR}>
                    <span className="flex items-center gap-2">
                      <Shield className="size-3.5 text-emerald-400" /> Moderator
                    </span>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* P4 SAFEGUARD: super_admin confirmation */}
            {editTarget &&
              (editTarget.currentRole === ROLES.SUPER_ADMIN || editNewRole === ROLES.SUPER_ADMIN) && (
                <div className="rounded-xl border border-amber-400/25 bg-amber-400/[0.08] p-4">
                  <div className="mb-2 flex items-center gap-2 text-amber-300">
                    <AlertTriangle className="size-4" />
                    <span className="type-mono text-[10px] font-bold uppercase tracking-wider">
                      Super admin operation
                    </span>
                  </div>
                  <p className="mb-3 text-[12px] leading-relaxed text-muted-foreground">
                    {editTarget.currentRole === ROLES.SUPER_ADMIN
                      ? "Demoting a super admin is a high-privilege operation."
                      : "Promoting to super admin grants full platform control."}
                    {" "}Type the admin's email to confirm.
                  </p>
                  <Input
                    type="email"
                    placeholder={editTarget.email ?? ""}
                    value={superAdminEmailInput}
                    onChange={(e) => setSuperAdminEmailInput(e.target.value)}
                    className="h-9 rounded-lg bg-white/5 font-mono text-sm"
                  />
                  {superAdminEmailInput && superAdminEmailInput !== (editTarget.email ?? "") && (
                    <p className="mt-1.5 text-[11px] text-rose-300">
                      Email does not match
                    </p>
                  )}
                </div>
              )}
          </div>

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              size="sm"
              className="rounded-lg bg-white/5"
              onClick={() => {
                setEditTarget(null);
                setSuperAdminEmailInput("");
              }}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              className="rounded-lg"
              disabled={
                editSaving ||
                !editNewRole ||
                editNewRole === editTarget?.currentRole ||
                !!(editTarget &&
                  (editTarget.currentRole === ROLES.SUPER_ADMIN || editNewRole === ROLES.SUPER_ADMIN) &&
                  superAdminEmailInput !== (editTarget.email ?? ""))
              }
              onClick={() => void handleEditRole()}
            >
              {editSaving ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <ShieldCheck className="size-3.5" />
              )}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ═══ Remove Admin Alert Dialog ═══ */}
      <AlertDialog
        open={!!removeTarget}
        onOpenChange={(open) => !open && setRemoveTarget(null)}
      >
        <AlertDialogContent className="glass-panel rounded-2xl border-white/10 bg-popover sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Trash2 className="size-4 text-rose-300" />
              Remove admin access
            </AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to remove admin access for{" "}
              <span className="font-mono font-semibold text-foreground">
                {removeTarget?.email ?? removeTarget?.name}
              </span>
              ? They will be downgraded to a regular user.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel className="rounded-lg bg-white/5">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="rounded-lg bg-rose-400/90 text-rose-50 hover:bg-rose-400"
              onClick={() => void handleRemove()}
              disabled={removing}
            >
              {removing ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Trash2 className="size-3.5" />
              )}
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
