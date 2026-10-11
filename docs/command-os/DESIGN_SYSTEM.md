# Learnyx Command OS — Design-System Specification

The "Obsidian Executive" system: layered obsidian surfaces, restrained
champagne-gold accents, thin low-contrast separators, calm motion.
All tokens live in `src/index.css` (the `LEARNYX COMMAND OS` block) and are
scoped to `.admin-surface` — plus `.cmdos-dark-scope` for portaled surfaces —
so the student app is untouched in both themes.

## 1. The cockpit principle

The admin is a **self-contained dark cockpit in both app themes**. The shell
remaps every semantic theme variable (`--background`, `--foreground`,
`--popover`, `--muted-foreground`, …) inside `.admin-surface`, so any
component using standard Tailwind semantic classes renders correctly on
obsidian regardless of the student app's light/dark setting. Portaled
surfaces (palette, popover, drawer) opt back in with `cmdos-dark-scope`.

## 2. Color tokens

### Surface layers (deepest → most elevated)
| Token | Value | Use |
|---|---|---|
| `--cmdos-bg-0` | `#0b0a08` | cockpit page background |
| `--cmdos-bg-1` | `rgb(17 16 13 / 0.72)` | standard panel (`.cmdos-panel`) |
| `--cmdos-bg-2` | `rgb(24 22 18 / 0.66)` | raised panel / hover tone |
| `--cmdos-bg-3` | `rgb(33 30 24 / 0.7)` | popover / tooltip tone |

### Champagne gold accent (restrained)
| Token | Value |
|---|---|
| `--cmdos-gold` | `#e6a72e` |
| `--cmdos-gold-soft` | `rgb(230 167 46 / 0.14)` |
| `--cmdos-gold-line` | `rgb(230 167 46 / 0.22)` |

Gold is reserved for: primary actions, active navigation, headline figures
(`.cmdos-figure` gold gradient), and the gold-toned metric accent.

### Ink
| Token | Value | Use |
|---|---|---|
| `--cmdos-ink-hi` | `rgb(255 253 247 / 0.95)` | headings |
| `--cmdos-ink` | `rgb(240 235 224 / 0.78)` | body |
| `--cmdos-ink-lo` | `rgb(226 220 205 / 0.5)` | eyebrows, meta |

### Separators — deliberately thin and low-contrast
| Token | Value |
|---|---|
| `--cmdos-line` | `rgb(255 255 255 / 0.07)` |
| `--cmdos-line-strong` | `rgb(255 255 255 / 0.11)` |

### Status — subtle, never neon
| Token | Value | Semantic |
|---|---|---|
| `--cmdos-ok` | `#34d399` | healthy / completed |
| `--cmdos-warn` | `#fbbf24` | waiting / attention |
| `--cmdos-danger` | `#fb7185` | breached / failing |
| `--cmdos-info` | `#7dd3fc` | neutral-informative |

## 3. Typography

- **Eyebrow / kicker**: `.cmdos-eyebrow` — JetBrains Mono 10px, 700,
  `letter-spacing: 0.18em`, uppercase, ink-lo. One per section header.
- **Figures**: `.cmdos-figure` — mono tabular-nums with the gold gradient
  (light `#f7d78a` → `#e6a72e` → deep `#c9871c`).
- **Titles**: Inter-style extrabold tracking-tight, 18–20px for section
  headers (one `h2` per workspace; the shell top bar carries wayfinding).
- **Data**: mono/tabular-nums for every number, timestamp, and ID.

## 4. Spacing & radii

- Radii: `--cmdos-r-sm 0.5rem` · `md 0.75rem` · `lg 1rem` · `xl 1.25rem`
  (panels always `xl`).
- Panel padding `p-4` (dense data) / `p-5` (charts, lists); grid gaps
  `gap-3` (metric grids) / `gap-4` (layout).
- Density: high — eyebrow + value + one-line sub, nothing decorative inside
  metric cards.

## 5. Elevation & borders

Shadows are minimal: `inset 0 1px 0 rgb(255 255 255 / 0.04)` on panels —
the layering comes from surface tones, not glow. The legacy
`admin-rail`/`admin-hero` treatments remain for surfaces that predate
Command OS; new surfaces use `.cmdos-panel` variants:
`--raised` (elevated), `--hover` (interactive), `--accent` (gold-lined).

## 6. Motion

| Token | Value | Use |
|---|---|---|
| `--cmdos-dur-fast` | 140ms | hovers, tooltips |
| `--cmdos-dur` | 220ms | color/border transitions |
| `--cmdos-dur-slow` | 320ms | section enter (`cmdos-enter`: 6px rise + fade) |
| `--cmdos-ease` | `cubic-bezier(0.22, 1, 0.36, 1)` | everything |

Rules: no scroll hijacking, no backdrop-blur stacking, no animation on data
tables, no decorative orbits in new surfaces. `prefers-reduced-motion`
collapses all of it to instant state changes (see the media query in the
token block).

## 7. Accessibility

- Visible focus: gold 2px outline (`:focus-visible`) across the cockpit.
- Keyboard: `1–9` jump sections, `⌘K`/`Ctrl+K` toggles the command palette,
  `Esc` closes overlays; every palette action also exists as a visible nav
  item; icon-rail items expose native `title` + `.cmdos-rail-tip`.
- ARIA: `aria-current="page"` on active nav, `aria-pressed` on filter chips,
  `role="status"` on loading panels, labelled bell/search buttons.
- Contrast: ink on obsidian ≥ WCAG AA for body text; status colors paired
  with text labels, never color-only.

## 8. Core components (`components/admin/cmdos/kit.tsx`)

| Component | Contract |
|---|---|
| `SectionHeader` | eyebrow · title · description · actions — the single heading idiom |
| `Panel` | `.cmdos-panel` wrapper (`raised` / `accent` / `hover`) |
| `MetricCard` | label · value · icon · sub · tone · `loading` skeleton · optional drill-down; renders skeletons while loading, never fake zeros |
| `StatusBadge` / `StatusDot` | semantic tones `ok/warn/danger/info/idle` |
| `ActionRow` | one pending item: icon · title · detail · action → workspace |
| `EmptyState` | icon · title · hint · optional action |
| `LoadingPanel` / `SkeletonRows` | shimmer skeletons |
| `PermissionState` | restricted-workspace notice |

Shell-level: `AdminShell` (rail, drawer, breadcrumbs, notifications,
scroll restoration), `CommandPalette` (⌘K, recents, pins), `CommandCenter`
(reference implementation), `blocks` (FinanceHeroBanner, ChartCard, chart
tokens shared by Command Center + Finance).

## 9. Data presentation rules

1. Every metric has a real query source and a labeled period; deltas shown
   only when the backend provides them (e.g. `revenueChangePercent30d`,
   signups MoM derived from `newUsersByMonth`).
2. Loading = skeleton, never zero. Empty = honest empty state with next-step
   hint. Error = convex error boundary with Retry.
3. Charts: recharts with shared `AXIS_COLOR` / `GRID_COLOR` / `TOOLTIP_STYLE`
   / `CHART_COLORS` from `cmdos/blocks`; sparklines via `StatCard2`.
4. Tables on desktop, record cards under `md` (`AdminUsersSection` is the
   pattern); horizontal scroll only for genuinely wide data grids.
5. Decorative fake status (the old "Admin network 78%" rail widget, the
   "11 modules online" footer) is removed — status shown is status real.
