// Learnyx Command OS — navigation registry.
// Single source of truth for admin sections: groups, labels, icons,
// descriptions and moderator restrictions. Tab IDs are UNCHANGED from the
// legacy shell so every /admin?tab=… URL keeps working and the
// `admin:navigate-tab` CustomEvent protocol keeps working.
// Route-preservation map: docs/command-os/AUDIT.md §4.

import {
  Activity,
  GraduationCap,
  Building2,
  CalendarClock,
  FileText,
  Flag,
  Grid3x3,
  KeyRound,
  Megaphone,
  MessageSquareQuote,
  Receipt,
  ScrollText,
  Send,
  ShieldAlert,
  ShieldCheck,
  Terminal,
  TrendingUp,
  UserRound,
  Users,
  Wallet,
  Wand2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type AdminTabId =
  | "dashboard"
  | "users"
  | "admins"
  | "schools"
  | "subscriptions"
  | "content"
  | "coverage"
  | "examengine"
  | "matric"
  | "finance"
  | "payments"
  | "affiliates"
  | "fraud"
  | "reports"
  | "audit"
  | "marketing"
  | "testimonials"
  | "broadcast"
  | "terminal"
  | "keys"
  | "system";

export interface AdminSectionMeta {
  id: AdminTabId;
  label: string;
  description: string;
  icon: LucideIcon;
  /** Hidden from moderators — mirrors the legacy shell exactly. */
  adminOnly?: boolean;
}

export interface AdminGroupMeta {
  id: string;
  label: string;
  /** Short hint shown in the command palette group header. */
  hint: string;
  sections: AdminSectionMeta[];
}

export const ADMIN_SECTIONS: Record<AdminTabId, AdminSectionMeta> = {
  dashboard: {
    id: "dashboard",
    label: "Command Center",
    description: "The whole platform at a glance",
    icon: Activity,
  },
  users: {
    id: "users",
    label: "Users",
    description: "Directory, activity and premium access",
    icon: Users,
  },
  admins: {
    id: "admins",
    label: "Admins",
    description: "Team, roles and invitations",
    icon: ShieldCheck,
    adminOnly: true,
  },
  schools: {
    id: "schools",
    label: "Schools",
    description: "School accounts, seats and licences",
    icon: Building2,
  },
  subscriptions: {
    id: "subscriptions",
    label: "Subscriptions",
    description: "Trials, extensions and premium access",
    icon: CalendarClock,
  },
  content: {
    id: "content",
    label: "Content",
    description: "Library, uploads and taxonomy",
    icon: FileText,
  },
  coverage: {
    id: "coverage",
    label: "Coverage Gaps",
    description: "What the library is missing",
    icon: Grid3x3,
  },
  examengine: {
    id: "examengine",
    label: "Exam Engine",
    description: "Past-paper QC and digitization queue",
    icon: Wand2,
  },
  matric: {
    id: "matric",
    label: "Matric OS",
    description: "Non-AI exam vault, blueprints and session ops",
    icon: GraduationCap,
  },
  finance: {
    id: "finance",
    label: "Finance",
    description: "Revenue, costs and reconciliation",
    icon: Wallet,
    adminOnly: true,
  },
  payments: {
    id: "payments",
    label: "Payment Reviews",
    description: "TeleBirr and school purchase queues",
    icon: Receipt,
  },
  affiliates: {
    id: "affiliates",
    label: "Affiliates",
    description: "Promoters, commissions and payouts",
    icon: Megaphone,
    adminOnly: true,
  },
  fraud: {
    id: "fraud",
    label: "Fraud Patterns",
    description: "Review-only suspicious activity",
    icon: ShieldAlert,
  },
  reports: {
    id: "reports",
    label: "Reports",
    description: "Student safety reports",
    icon: Flag,
  },
  audit: {
    id: "audit",
    label: "Audit Log",
    description: "Every privileged action, recorded",
    icon: ScrollText,
    adminOnly: true,
  },
  marketing: {
    id: "marketing",
    label: "Marketing",
    description: "Referrals, discounts and announcements",
    icon: TrendingUp,
  },
  testimonials: {
    id: "testimonials",
    label: "Testimonials",
    description: "Landing-page social proof queue",
    icon: MessageSquareQuote,
  },
  broadcast: {
    id: "broadcast",
    label: "Broadcast",
    description: "Telegram channels and announcements",
    icon: Send,
  },
  terminal: {
    id: "terminal",
    label: "Terminal",
    description: "Live system event feed",
    icon: Terminal,
  },
  keys: {
    id: "keys",
    label: "Keys",
    description: "API keys and integrations",
    icon: KeyRound,
    adminOnly: true,
  },
  system: {
    id: "system",
    label: "System",
    description: "Platform status and connections",
    icon: UserRound,
  },
};

/** Command OS information architecture — six operating domains. */
export const ADMIN_GROUPS: AdminGroupMeta[] = [
  {
    id: "overview",
    label: "Overview",
    hint: "Executive summary",
    sections: [ADMIN_SECTIONS.dashboard],
  },
  {
    id: "people",
    label: "People",
    hint: "Users, team, schools",
    sections: [
      ADMIN_SECTIONS.users,
      ADMIN_SECTIONS.admins,
      ADMIN_SECTIONS.schools,
      ADMIN_SECTIONS.subscriptions,
    ],
  },
  {
    id: "academics",
    label: "Academics",
    hint: "Library and quality",
    sections: [
      ADMIN_SECTIONS.content,
      ADMIN_SECTIONS.coverage,
      ADMIN_SECTIONS.examengine,
    ],
  },
  {
    id: "revenue",
    label: "Revenue",
    hint: "Money in and out",
    sections: [
      ADMIN_SECTIONS.finance,
      ADMIN_SECTIONS.payments,
      ADMIN_SECTIONS.affiliates,
    ],
  },
  {
    id: "trust",
    label: "Trust & Security",
    hint: "Safety and integrity",
    sections: [
      ADMIN_SECTIONS.fraud,
      ADMIN_SECTIONS.reports,
      ADMIN_SECTIONS.audit,
    ],
  },
  {
    id: "growth",
    label: "Growth & Systems",
    hint: "Promotion and platform",
    sections: [
      ADMIN_SECTIONS.marketing,
      ADMIN_SECTIONS.testimonials,
      ADMIN_SECTIONS.broadcast,
      ADMIN_SECTIONS.terminal,
      ADMIN_SECTIONS.keys,
      ADMIN_SECTIONS.system,
    ],
  },
];

/** Flat ordered list (group order) — used for keyboard shortcuts and palette. */
export const ALL_SECTIONS: AdminSectionMeta[] = ADMIN_GROUPS.flatMap(
  (g) => g.sections,
);

export function getSection(id: AdminTabId): AdminSectionMeta {
  return ADMIN_SECTIONS[id];
}

/**
 * Permission-aware visibility. Mirrors the legacy rule exactly:
 * moderators lose keys / admins / audit / finance / affiliates.
 */
export function visibleSections(role?: string | null): AdminSectionMeta[] {
  return ALL_SECTIONS.filter((s) => !(s.adminOnly && role === "moderator"));
}

export function visibleGroups(role?: string | null): AdminGroupMeta[] {
  return ADMIN_GROUPS.map((g) => ({
    ...g,
    sections: g.sections.filter(
      (s) => !(s.adminOnly && role === "moderator"),
    ),
  })).filter((g) => g.sections.length > 0);
}
