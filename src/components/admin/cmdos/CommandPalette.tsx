// Learnyx Command OS — global command palette (⌘K / Ctrl+K).
// Jump to any section, revisit recent destinations, manage pins.
// Built on ui/command (cmdk). Keyboard-first but fully clickable;
// every item also has a visible alternative in the nav rail.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  ALL_SECTIONS,
  ADMIN_GROUPS,
  getSection,
  visibleSections,
  type AdminTabId,
} from "./nav";
import { cn } from "@/lib/utils";

const RECENTS_KEY = "nexus-admin-recent";
const PINS_KEY = "nexus-admin-pins";
const MAX_RECENTS = 5;

export function readAdminRecents(): AdminTabId[] {
  try {
    const raw = window.localStorage.getItem(RECENTS_KEY);
    if (!raw) return [];
    const ids = JSON.parse(raw) as string[];
    return ids.filter((id) => ALL_SECTIONS.some((s) => s.id === id)).slice(0, MAX_RECENTS) as AdminTabId[];
  } catch {
    return [];
  }
}

export function recordAdminRecent(id: AdminTabId) {
  try {
    const next = [id, ...readAdminRecents().filter((r) => r !== id)].slice(0, MAX_RECENTS);
    window.localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
  } catch {
    // Storage may be unavailable — recents are non-critical.
  }
}

export function readAdminPins(): AdminTabId[] {
  try {
    const raw = window.localStorage.getItem(PINS_KEY);
    if (!raw) return [];
    const ids = JSON.parse(raw) as string[];
    return ids.filter((id) => ALL_SECTIONS.some((s) => s.id === id)) as AdminTabId[];
  } catch {
    return [];
  }
}

function writeAdminPins(ids: AdminTabId[]) {
  try {
    window.localStorage.setItem(PINS_KEY, JSON.stringify(ids));
  } catch {
    // Non-critical.
  }
}

export function toggleAdminPin(id: AdminTabId): AdminTabId[] {
  const pins = readAdminPins();
  const next = pins.includes(id)
    ? pins.filter((p) => p !== id)
    : [...pins, id];
  writeAdminPins(next);
  return next;
}

export function useAdminPins() {
  const [pins, setPins] = useState<AdminTabId[]>(() => readAdminPins());
  const toggle = useCallback((id: AdminTabId) => {
    setPins(toggleAdminPin(id));
  }, []);
  return { pins, toggle };
}

export function CommandPalette({
  open,
  onOpenChange,
  role,
  onNavigate,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  role?: string | null;
  /** Called with the chosen tab id so the shell can navigate in-place. */
  onNavigate: (id: AdminTabId) => void;
}) {
  const navigate = useNavigate();
  const [recents, setRecents] = useState<AdminTabId[]>([]);
  const [pins, setPinsState] = useState<AdminTabId[]>([]);

  useEffect(() => {
    if (open) {
      setRecents(readAdminRecents());
      setPinsState(readAdminPins());
    }
  }, [open]);

  const sections = useMemo(() => visibleSections(role), [role]);

  const go = useCallback(
    (id: AdminTabId) => {
      onOpenChange(false);
      onNavigate(id);
    },
    [onNavigate, onOpenChange],
  );

  const runPin = useCallback(
    (id: AdminTabId) => {
      const next = toggleAdminPin(id);
      setPinsState(next);
      toast.success(
        next.includes(id)
          ? `${getSection(id).label} pinned to the top of your palette.`
          : `${getSection(id).label} unpinned.`,
      );
    },
    [],
  );

  const openLibrary = useCallback(() => {
    onOpenChange(false);
    navigate("/dashboard");
  }, [navigate, onOpenChange]);

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Learnyx Command OS"
      description="Jump to a section, run an action…"
      className="cmdos-dark-scope border-white/10 bg-[#16130e]"
    >
      <CommandInput placeholder="Search sections and actions…" />
      <CommandList className="min-h-72">
        <CommandEmpty>No matching section.</CommandEmpty>

        {recents.length > 0 && (
          <CommandGroup heading="Recent">
            {recents.map((id) => {
              const s = getSection(id);
              if (!sections.some((x) => x.id === id)) return null;
              return (
                <CommandItem
                  key={`recent-${id}`}
                  value={`recent ${s.label} ${s.description}`}
                  onSelect={() => go(id)}
                >
                  <s.icon className="size-4 text-muted-foreground" />
                  <span>{s.label}</span>
                  <span className="ml-auto font-mono text-[10px] text-muted-foreground/60">
                    recent
                  </span>
                </CommandItem>
              );
            })}
          </CommandGroup>
        )}

        {pins.length > 0 && (
          <CommandGroup heading="Pinned">
            {pins.map((id) => {
              const s = getSection(id);
              if (!sections.some((x) => x.id === id)) return null;
              return (
                <CommandItem
                  key={`pin-${id}`}
                  value={`pinned ${s.label} ${s.description}`}
                  onSelect={() => go(id)}
                >
                  <s.icon className="size-4 text-primary" />
                  <span>{s.label}</span>
                  <span
                    role="button"
                    tabIndex={-1}
                    onClick={(e) => {
                      e.stopPropagation();
                      runPin(id);
                    }}
                    className="ml-auto rounded px-1.5 font-mono text-[10px] text-muted-foreground hover:bg-white/10 hover:text-foreground"
                  >
                    unpin
                  </span>
                </CommandItem>
              );
            })}
          </CommandGroup>
        )}

        {ADMIN_GROUPS.map((group) => {
          const items = group.sections.filter((s) =>
            sections.some((x) => x.id === s.id),
          );
          if (items.length === 0) return null;
          return (
            <CommandGroup
              key={group.id}
              heading={`${group.label} · ${group.hint}`}
            >
              {items.map((s) => (
                <CommandItem
                  key={s.id}
                  value={`${s.label} ${s.description} ${group.label}`}
                  onSelect={() => go(s.id)}
                >
                  <s.icon className="size-4 text-muted-foreground" />
                  <span className="flex flex-col">
                    <span>{s.label}</span>
                    <span className="text-[10px] text-muted-foreground/70">
                      {s.description}
                    </span>
                  </span>
                  <span
                    role="button"
                    tabIndex={-1}
                    onClick={(e) => {
                      e.stopPropagation();
                      runPin(s.id);
                    }}
                    className={cn(
                      "ml-auto rounded px-1.5 font-mono text-[10px] text-muted-foreground hover:bg-white/10 hover:text-foreground",
                      pins.includes(s.id) && "text-primary",
                    )}
                  >
                    {pins.includes(s.id) ? "pinned" : "pin"}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          );
        })}

        <CommandSeparator />
        <CommandGroup heading="Actions">
          <CommandItem onSelect={openLibrary}>
            <span className="size-4 text-center text-muted-foreground">←</span>
            <span>Open the student library</span>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
