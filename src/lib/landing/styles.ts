import { card, color, container } from "@/lib/layout/layout";

/** Shared landing layout tokens — cinematic dark Lenra design system */
export const landing = {
  page: "dashboard-app relative min-h-screen overflow-x-clip bg-app text-app-fg antialiased",
  pageAmbient:
    "pointer-events-none fixed inset-0 -z-10 bg-[radial-gradient(ellipse_80%_50%_at_50%_-10%,rgba(36,214,143,0.09),transparent_55%),radial-gradient(ellipse_60%_40%_at_90%_20%,rgba(45,212,191,0.06),transparent_50%),radial-gradient(ellipse_50%_35%_at_10%_60%,rgba(36,214,143,0.05),transparent_45%)]",
  section: "relative py-16 md:py-24 lg:py-28",
  sectionWarm:
    "border-t border-app-border bg-linear-to-b from-app via-[#0a1520] to-[#0c1824]",
  sectionSurface:
    "border-t border-app-border bg-linear-to-b from-[#0c1824] via-app-surface/50 to-app",
  container: `${container.wide} mx-auto px-5 md:px-8`,
  glow: "pointer-events-none absolute inset-0 overflow-hidden",
  glowOrb: "absolute rounded-full blur-3xl bg-app-accent/[0.08]",
  glowOrbTeal: "absolute rounded-full blur-3xl bg-teal-400/[0.07]",
  glowOrbStrong: "absolute rounded-full blur-[100px] bg-app-accent/[0.14]",
  glassCard: `${card.elevated} border border-app-border bg-app-card/80 backdrop-blur-md shadow-[0_8px_32px_rgba(0,0,0,0.35)]`,
  featureCard: `${card.elevated} border border-app-border bg-app-card/60 backdrop-blur-sm transition-colors hover:border-app-border-active hover:bg-app-card/80`,
  eyebrow: `${color.accent} text-[13px] font-semibold uppercase tracking-[0.16em] text-app-accent/80`,
  sectionTitle:
    "text-3xl font-bold tracking-tight text-app-fg md:text-4xl lg:text-[2.5rem]",
  sectionSubtitle:
    "mt-4 max-w-2xl text-base leading-relaxed text-app-fg-secondary md:text-lg",
  primaryBtn:
    "inline-flex items-center justify-center gap-2 rounded-full bg-app-accent px-6 py-3.5 text-base font-semibold text-[#04120c] transition hover:brightness-105 hover:shadow-[0_0_24px_rgba(36,214,143,0.25)]",
  headerBtn:
    "inline-flex h-8 items-center justify-center rounded-full bg-app-accent px-3.5 text-sm font-semibold text-[#04120c] transition hover:brightness-105 hover:shadow-[0_0_16px_rgba(36,214,143,0.2)]",
  secondaryBtn:
    "inline-flex items-center gap-2.5 rounded-full border border-app-border-active bg-white/[0.04] px-5 py-3.5 text-base font-medium text-app-fg transition hover:border-app-accent/30 hover:bg-white/[0.06]",
  ghostLink:
    "text-sm font-medium text-app-fg-secondary transition hover:text-app-fg",
} as const;
