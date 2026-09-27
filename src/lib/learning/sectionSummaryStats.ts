import type { SectionPartProgressRow } from "@/lib/db/sectionProgress";
import {
  CLIP_XP_MAX,
  clipXpAmount,
  clipXpContextFromStoredProgress,
} from "@/lib/gamification/clipXp";
import { VISIBLE_UNITS_PER_SECTION } from "@/lib/learning/sections";
import type { LearningUnit } from "@/lib/skill-engine/learning-units";

export type SectionSummaryStats = {
  completedInSection: number;
  totalInSection: number;
  attemptedCount: number;
  skippedCount: number;
  avgBestScore: number;
  highScores: number;
  sectionXp: number;
  /** Theoretical max XP if every line earned top clip XP (10 × 12). */
  maxSectionXp: number;
  /** Completed lines solved with voice on the best attempt. */
  voiceCompletedCount: number;
  /** Completed lines solved with drag on the best attempt. */
  dragCompletedCount: number;
  /** Sum of wrong moves across all attempted lines in the section. */
  totalWrongMoves: number;
  /** Sum of attempts across all attempted lines in the section. */
  totalAttempts: number;
};

type VisibleUnitPartRef = { id: string; order: number };

type VisibleUnitSnapshot = {
  attempted: boolean;
  isComplete: boolean;
  bestScore: number;
  wrongMoves: number;
  attempts: number;
  inputMode: "drag" | "voice" | null;
  accuracy: number | null;
  speed: number | null;
  xpEarned: number;
};

function storedUnitXp(unit: VisibleUnitSnapshot): number {
  if (!unit.isComplete) return 0;
  // Always derive from best-attempt metrics. `xp_earned` on the row can
  // accumulate across replays (wallet still awards each run); the section
  // ring is capped at 10×12 and must not sum lifetime replay XP.
  return clipXpAmount(
    unit.inputMode ?? undefined,
    clipXpContextFromStoredProgress({
      inputMode: unit.inputMode,
      bestScore: unit.bestScore,
      wrongMoves: unit.wrongMoves,
      accuracy: unit.accuracy,
      speed: unit.speed,
    }),
  );
}

function isQualifiedCompletion(row: SectionPartProgressRow): boolean {
  return row.completedAt != null && row.bestScore > 0;
}

function progressByOrderFromRows(
  rows: SectionPartProgressRow[],
): Map<number, SectionPartProgressRow> {
  return new Map(rows.map((row) => [row.order, row]));
}

/** Progress / XP anchor — last atomic clip in the unit (matches Learn player). */
function primaryPartRow(
  unit: LearningUnit<VisibleUnitPartRef>,
  byOrder: Map<number, SectionPartProgressRow>,
): SectionPartProgressRow | null {
  const primary = unit.parts[unit.parts.length - 1];
  if (!primary) return null;
  return byOrder.get(primary.order) ?? null;
}

function isVisibleUnitComplete(
  unit: LearningUnit<VisibleUnitPartRef>,
  byOrder: Map<number, SectionPartProgressRow>,
): boolean {
  return unit.parts.every((part) => {
    const row = byOrder.get(part.order);
    return row != null && isQualifiedCompletion(row);
  });
}

function isVisibleUnitAttempted(
  unit: LearningUnit<VisibleUnitPartRef>,
  byOrder: Map<number, SectionPartProgressRow>,
): boolean {
  return unit.parts.some((part) => byOrder.get(part.order)?.attempted);
}

function summarizeVisibleUnit(
  unit: LearningUnit<VisibleUnitPartRef>,
  byOrder: Map<number, SectionPartProgressRow>,
): VisibleUnitSnapshot {
  const primary = primaryPartRow(unit, byOrder);
  const attempted = isVisibleUnitAttempted(unit, byOrder);
  const isComplete = isVisibleUnitComplete(unit, byOrder);

  return {
    attempted,
    isComplete,
    bestScore: primary?.bestScore ?? 0,
    wrongMoves: primary?.wrongMoves ?? 0,
    attempts: primary?.attempts ?? 0,
    inputMode: primary?.lastSentenceInputMode ?? null,
    accuracy: primary?.accuracy ?? null,
    speed: primary?.speed ?? null,
    xpEarned: primary?.xpEarned ?? 0,
  };
}

function emptySectionSummaryStats(
  totalInSection: number,
): SectionSummaryStats {
  return {
    completedInSection: 0,
    totalInSection,
    attemptedCount: 0,
    skippedCount: 0,
    avgBestScore: 0,
    highScores: 0,
    sectionXp: 0,
    maxSectionXp: totalInSection * CLIP_XP_MAX,
    voiceCompletedCount: 0,
    dragCompletedCount: 0,
    totalWrongMoves: 0,
    totalAttempts: 0,
  };
}

export function buildSectionSummaryStats(
  rows: SectionPartProgressRow[],
  opts?: {
    /** Learner-visible steps — same progressionUnits model as the Learn page. */
    progressionUnits?: ReadonlyArray<LearningUnit<VisibleUnitPartRef>>;
  },
): SectionSummaryStats {
  const totalInSection = VISIBLE_UNITS_PER_SECTION;
  const visibleUnits = (opts?.progressionUnits ?? []).slice(
    0,
    VISIBLE_UNITS_PER_SECTION,
  );

  if (visibleUnits.length === 0) {
    return emptySectionSummaryStats(totalInSection);
  }

  const byOrder = progressByOrderFromRows(rows);
  const unitSnapshots = visibleUnits.map((unit) =>
    summarizeVisibleUnit(unit, byOrder),
  );

  const attemptedUnits = unitSnapshots.filter((unit) => unit.attempted);
  const completedUnits = unitSnapshots.filter((unit) => unit.isComplete);

  const attemptedCount = attemptedUnits.length;
  const completedInSection = completedUnits.length;
  const skippedCount = attemptedUnits.filter((unit) => unit.bestScore === 0)
    .length;
  const avgBestScore =
    attemptedCount > 0
      ? Math.round(
          attemptedUnits.reduce((sum, unit) => sum + unit.bestScore, 0) /
            attemptedCount,
        )
      : 0;
  const highScores = attemptedUnits.filter((unit) => unit.bestScore >= 88)
    .length;

  const sectionXp = completedUnits.reduce(
    (sum, unit) => sum + storedUnitXp(unit),
    0,
  );
  const maxSectionXp = totalInSection * CLIP_XP_MAX;

  const voiceCompletedCount = completedUnits.filter(
    (unit) => unit.inputMode === "voice",
  ).length;
  const dragCompletedCount = completedUnits.filter(
    (unit) => unit.inputMode === "drag",
  ).length;
  const totalWrongMoves = attemptedUnits.reduce(
    (sum, unit) => sum + unit.wrongMoves,
    0,
  );
  const totalAttempts = attemptedUnits.reduce(
    (sum, unit) => sum + unit.attempts,
    0,
  );

  return {
    completedInSection,
    totalInSection,
    attemptedCount,
    skippedCount,
    avgBestScore,
    highScores,
    sectionXp,
    maxSectionXp,
    voiceCompletedCount,
    dragCompletedCount,
    totalWrongMoves,
    totalAttempts,
  };
}

/** XP earned as a fraction of the section ceiling (0–100). */
export function sectionXpProgress(stats: SectionSummaryStats): number {
  if (stats.maxSectionXp <= 0) return 0;
  return Math.round(
    Math.min(100, (stats.sectionXp / stats.maxSectionXp) * 100),
  );
}

/** Share of completed lines solved with voice (0–100). */
export function sectionVoiceShare(stats: SectionSummaryStats): number {
  const completed = stats.voiceCompletedCount + stats.dragCompletedCount;
  if (completed <= 0) return 0;
  return Math.round((stats.voiceCompletedCount / completed) * 100);
}

/** @deprecated Dashboard-only blend — not shown on the section summary screen. */
export function sectionLevel(stats: SectionSummaryStats): number {
  const completionPct =
    stats.totalInSection > 0
      ? (stats.attemptedCount / stats.totalInSection) * 100
      : 0;
  const qualityPct = Math.min(100, Math.max(0, stats.avgBestScore));
  return Math.round(completionPct * 0.35 + qualityPct * 0.65);
}

export function sectionLevelKey(
  level: number,
): "building" | "growing" | "strong" {
  if (level < 40) return "building";
  if (level < 70) return "growing";
  return "strong";
}
