import { cn } from "@/lib/cn";

/**
 * Lenra design system — Tailwind class strings.
 * Use inside `.dashboard-app` (authenticated shell) unless noted as `journey`.
 *
 * Spacing scale: xs | sm | md | lg | xl | 2xl
 * Breakpoints: mobile (default) | sm/tablet | md/laptop | lg/desktop | xl/ultra-wide
 */

// ── Breakpoints (reference) ─────────────────────────────────────────────────
// mobile: default
// tablet: sm (640px)
// laptop: md (768px)
// desktop: lg (1024px)
// ultra-wide: xl (1280px), 2xl (1536px)

// ── Spacing scale ───────────────────────────────────────────────────────────
export const space = {
  xs: "gap-1 p-1",
  sm: "gap-2 p-2",
  md: "gap-4 p-4",
  lg: "gap-6 p-6",
  xl: "gap-8 p-8",
  "2xl": "gap-10 p-10",
  /** Section vertical rhythm between major blocks */
  section: "space-y-8 md:space-y-10",
  /** Inner section (title → content) */
  sectionInner: "space-y-4 md:space-y-5",
  /** Form field stacks */
  form: "space-y-4",
  /** Button groups */
  buttonGroup: "gap-2",
} as const;

// ── App shell (HomeLayoutClient) ────────────────────────────────────────────
export const shell = {
  root: "min-h-screen dashboard-app bg-app text-app-fg",
  main: "min-h-[calc(100vh-52px)]",
  sidebarOffset: "lg:ml-[200px]",
} as const;

// ── Page layout ───────────────────────────────────────────────────────────
export const page = {
  /** Full page wrapper — standard dashboard feature pages */
  outer: "min-h-full bg-app text-app-fg",
  /** Canonical horizontal + vertical page padding */
  pad: "px-4 py-6 md:px-7 md:py-8 xl:px-8",
  /** Home dashboard — inherits shell bg, uniform padding */
  home: "w-full p-4 md:p-7 xl:p-8 space-y-8",
  /** Standard inner content column */
  inner: "w-full px-4 py-6 md:px-7 md:py-8 xl:px-8",
  innerSpaced: "w-full px-4 py-6 md:px-7 md:py-8 xl:px-8 space-y-8",
  innerSpacedLoose: "w-full px-4 py-6 md:px-7 md:py-8 xl:px-8 space-y-10",
  /** Wide catalog (videos library) — same gutters, optional max width */
  catalog: "w-full px-4 py-6 md:px-7 md:py-8 xl:px-8",
  catalogMax: "mx-auto w-full max-w-7xl px-4 py-6 md:px-7 md:py-8 xl:px-8",
  /** Page header block spacing */
  headerGap: "mb-6 md:mb-8",
  /** Primary action row below header */
  actions: "flex flex-wrap items-center gap-2 md:gap-3",
} as const;

// ── Containers ──────────────────────────────────────────────────────────────
export const container = {
  full: "w-full",
  content: "mx-auto w-full max-w-5xl",
  wide: "mx-auto w-full max-w-7xl",
  narrow: "mx-auto w-full max-w-lg",
  prose: "mx-auto w-full max-w-2xl",
} as const;

// ── Typography ──────────────────────────────────────────────────────────────
export const type = {
  pageTitle: "ds-page-title",
  pageDescription: "ds-page-description",
  sectionTitle: "ds-section-title",
  sectionDescription: "ds-section-description",
  cardTitle: "ds-card-title",
  cardDescription: "ds-card-description",
  label: "ds-label",
  caption: "ds-caption",
  metadata: "ds-metadata",
  eyebrow: "ds-eyebrow",
  /** Inline Tailwind fallbacks when CSS classes aren't loaded */
  pageTitleTw:
    "text-2xl font-semibold tracking-tight text-app-fg md:text-[1.65rem]",
  pageDescriptionTw: "mt-2 max-w-xl text-sm leading-relaxed text-app-fg-muted",
  sectionTitleTw: "text-lg font-semibold tracking-tight text-app-fg",
  sectionDescriptionTw: "text-sm text-app-fg-muted",
  kicker:
    "text-[11px] font-semibold uppercase tracking-[0.16em] text-app-accent/80",
  link: "text-[13px] font-medium text-app-accent/80 transition-colors hover:text-app-accent",
} as const;

// ── Semantic colors (Tailwind utilities from @theme) ──────────────────────
export const color = {
  textPrimary: "text-app-fg",
  textSecondary: "text-app-fg-secondary",
  textMuted: "text-app-fg-muted",
  bgPrimary: "bg-app",
  bgSecondary: "bg-app-surface",
  bgCard: "bg-app-card",
  bgElevated: "bg-app-elevated",
  borderMuted: "border-app-border",
  borderActive: "border-app-border-active",
  accent: "text-app-accent",
  accentBg: "bg-app-accent",
} as const;

// ── Cards ───────────────────────────────────────────────────────────────────
export const card = {
  /** Legacy dash-card + hover — existing dashboard components */
  legacy: "dash-card dash-card-hover rounded-2xl",
  base: "dash-card rounded-2xl",
  hover: "dash-card-hover",
  /** Design system variants */
  default: "ds-card rounded-2xl",
  elevated: "ds-card-elevated rounded-2xl",
  compact: "ds-card-compact",
  interactive: "ds-card-interactive rounded-2xl",
  active: "ds-card-active rounded-2xl",
  locked: "ds-card-locked rounded-2xl",
  /** Hero / stat surface (achievements, favorites) */
  hero: "rounded-2xl border border-app-border bg-app-elevated px-6 py-7 md:px-8 md:py-8",
  /** Inner card padding */
  pad: "p-4 md:p-5",
  padCompact: "p-3 md:p-4",
  padLoose: "p-5 md:p-6",
} as const;

// ── Grids ───────────────────────────────────────────────────────────────────
export const grid = {
  /** Standard responsive card grid */
  cards: "grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:gap-5",
  cards2: "grid grid-cols-1 gap-4 sm:grid-cols-2",
  cards4: "grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4",
  stats: "grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-4",
  split: "grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_300px] lg:gap-x-8",
} as const;

// ── Buttons ─────────────────────────────────────────────────────────────────
export const btn = {
  base: "ds-btn inline-flex items-center justify-center gap-2",
  primary: "ds-btn ds-btn-primary",
  secondary: "ds-btn ds-btn-secondary",
  ghost: "ds-btn ds-btn-ghost",
  destructive: "ds-btn ds-btn-destructive",
  locked: "ds-btn ds-btn-locked",
  sm: "ds-btn-sm",
  lg: "ds-btn-lg",
  /** Filter / tab chips */
  chip: "rounded-xl border px-3 py-1.5 text-xs font-semibold transition-all",
  chipInactive:
    "border-app-border bg-app-card text-app-fg-muted hover:border-app-border-active hover:text-app-fg",
  chipActive:
    "border-app-accent/40 bg-app-accent/15 text-app-accent ring-1 ring-app-accent/30",
} as const;

// ── Empty state ─────────────────────────────────────────────────────────────
export const empty = {
  /** Fills remaining page height and centers content (parent must be flex column) */
  viewport: "flex flex-1 items-center justify-center px-4 py-6",
  wrap: "flex w-full max-w-lg flex-col items-center text-center",
  wrapSurface:
    "rounded-2xl border border-white/10 bg-white/3 px-6 py-12 backdrop-blur-sm sm:px-10 sm:py-14",
  icon: "mb-5 flex size-14 items-center justify-center rounded-2xl border border-white/15 bg-white/5 text-white/45",
  iconAccent:
    "mb-5 flex size-14 items-center justify-center rounded-2xl border border-[#24D68F]/25 bg-[#24D68F]/10 text-[#24D68F] shadow-[0_0_24px_rgba(36,214,143,0.12)]",
  title: "text-lg font-semibold text-white sm:text-xl",
  description: "mt-2 max-w-md text-sm leading-relaxed text-white/55",
  action: "mt-6",
  actionLink:
    "inline-flex items-center gap-2 rounded-xl border border-[#24D68F]/30 bg-[#24D68F]/15 px-5 py-2.5 text-sm font-semibold text-[#24D68F] transition hover:bg-[#24D68F]/25 hover:text-white",
} as const;

// ── Learning journey (separate emotional tone — NOT dashboard grid) ───────────
export const journey = {
  layout: "min-h-screen bg-gray-950 text-slate-100",
  sectionMap:
    "min-h-screen bg-linear-to-b from-slate-950 via-slate-900 to-slate-950 p-6 md:p-8",
  player:
    "relative flex h-dvh w-full flex-col overflow-hidden bg-[#050505] lg:flex-row",
  summary:
    "relative flex min-h-screen flex-col overflow-hidden bg-journey text-slate-100",
  loader:
    "flex flex-col items-center justify-center overflow-hidden bg-[#07060a]",
  /** Journey cards — progression, not dash-card */
  pathCard:
    "relative overflow-hidden rounded-3xl border transition-all duration-300",
  pathCardActive:
    "border-emerald-500/40 bg-linear-to-br from-emerald-950/80 to-slate-900/90 shadow-lg shadow-emerald-900/20",
  pathCardLocked: "border-white/10 bg-slate-900/60 opacity-70 saturate-75",
} as const;

// ── Decorative (use sparingly — reduced visual noise) ─────────────────────
export const decor = {
  /** Subtle top glow for progress-style pages */
  topGlow:
    "pointer-events-none absolute -top-24 left-1/2 h-64 w-[min(100%,720px)] -translate-x-1/2 rounded-full opacity-50",
  topGlowStyle:
    "radial-gradient(ellipse 80% 60% at 50% 0%, rgba(139,92,246,0.12) 0%, rgba(36,214,143,0.06) 40%, transparent 70%)",
  /** Vocabulary — very subtle accent only */
  bgGlow:
    "pointer-events-none absolute inset-x-0 top-0 h-[320px] bg-[radial-gradient(ellipse_75%_55%_at_50%_-10%,rgba(36,214,143,0.1),transparent)]",
} as const;

/** Compose page shell + padding + section rhythm */
export function pageClasses(options?: {
  spaced?: "default" | "loose";
  maxWidth?: keyof typeof container;
}) {
  const spaced =
    options?.spaced === "loose" ? page.innerSpacedLoose : page.innerSpaced;
  const max = options?.maxWidth ? container[options.maxWidth] : "";
  return cn(page.outer, spaced, max);
}

export { cn };
