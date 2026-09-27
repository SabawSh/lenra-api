import { SKILL_SECTION_MAX_DELTA } from "@/lib/skill/constants";
import type { SectionMasteryBreakdown } from "@/lib/skill/partMasteryScore";

export const ADAPTIVE_TEACHER_MODEL_VERSION = "section-ema-v1";

export type AdaptiveTeacherDecisionType = "UPGRADE" | "DOWNGRADE" | "KEEP";

export type AdaptiveTeacherDisplayLevel =
  | "Beginner"
  | "Elementary"
  | "Intermediate"
  | "Upper Intermediate"
  | "Advanced";

const LEVEL_ORDER: readonly AdaptiveTeacherDisplayLevel[] = [
  "Beginner",
  "Elementary",
  "Intermediate",
  "Upper Intermediate",
  "Advanced",
] as const;

/** Maps continuous skill (0–100) to admin-facing level bands. */
export function skillToDisplayLevel(skill: number): AdaptiveTeacherDisplayLevel {
  if (skill < 30) return "Beginner";
  if (skill < 45) return "Elementary";
  if (skill < 60) return "Intermediate";
  if (skill < 75) return "Upper Intermediate";
  return "Advanced";
}

function levelIndex(level: AdaptiveTeacherDisplayLevel): number {
  return LEVEL_ORDER.indexOf(level);
}

export function classifySkillTransition(
  previousSkill: number,
  newSkill: number,
): AdaptiveTeacherDecisionType {
  const previousLevel = skillToDisplayLevel(previousSkill);
  const newLevel = skillToDisplayLevel(newSkill);
  const delta = levelIndex(newLevel) - levelIndex(previousLevel);
  if (delta > 0) return "UPGRADE";
  if (delta < 0) return "DOWNGRADE";
  return "KEEP";
}

export type AdaptiveTeacherMetrics = {
  accuracy: number;
  averageAttempts: number;
  recentMistakes: number;
  difficultyScore: number | null;
  estimatedSkill: number;
  confidence: number;
  sectionScore: number;
  averageMasteryScore: number;
  calibratedTarget: number;
  emaStep: number;
  skillDelta: number;
  totalAttempts: number;
  qualified: boolean;
  previousSkill: number;
  newSkill: number;
  streak: number;
};

function roundMetric(value: number): number {
  return Math.round(value * 10) / 10;
}

export function computeDecisionConfidence(
  mastery: SectionMasteryBreakdown,
  emaStep: number,
): number {
  if (!mastery.qualified) return 0.35;

  const masteryFactor = Math.min(1, mastery.sectionScore / 100);
  const stabilityFactor =
    1 - Math.min(1, Math.abs(emaStep) / SKILL_SECTION_MAX_DELTA);
  const attemptFactor = Math.max(
    0,
    1 - Math.min(1, mastery.averageAttempts / 4),
  );
  const mistakeFactor = Math.max(
    0,
    1 - Math.min(1, mastery.averageWrongMoves / 6),
  );

  const raw =
    0.35 +
    masteryFactor * 0.3 +
    stabilityFactor * 0.15 +
    attemptFactor * 0.1 +
    mistakeFactor * 0.1;

  return roundMetric(Math.max(0.35, Math.min(0.99, raw)));
}

export function buildAdaptiveTeacherExplanation(params: {
  decision: AdaptiveTeacherDecisionType;
  previousLevel: AdaptiveTeacherDisplayLevel;
  newLevel: AdaptiveTeacherDisplayLevel;
  metrics: AdaptiveTeacherMetrics;
}): string {
  const { decision, previousLevel, newLevel, metrics } = params;

  if (!metrics.qualified) {
    return "Section was not fully qualified — skill estimate held steady pending complete section data.";
  }

  const accuracyPhrase =
    metrics.accuracy >= 94
      ? `Accuracy remained above ${Math.round(metrics.accuracy)}%`
      : `Accuracy averaged ${Math.round(metrics.accuracy)}%`;

  const difficultyPhrase =
    metrics.difficultyScore != null
      ? ` on difficulty-${Math.round(metrics.difficultyScore)} content`
      : "";

  const effortPhrase =
    metrics.recentMistakes <= 1.5
      ? " with consistently low mistake counts"
      : ` with ${roundMetric(metrics.recentMistakes)} average wrong moves per clip`;

  const performanceLead = `${accuracyPhrase}${difficultyPhrase}${effortPhrase}.`;

  if (decision === "UPGRADE") {
    return `${performanceLead} Skill moved from ${previousLevel} toward ${newLevel} after the section EMA update (+${roundMetric(metrics.skillDelta)}).`;
  }
  if (decision === "DOWNGRADE") {
    return `${performanceLead} Performance signals suggest easing expectations from ${previousLevel} to ${newLevel} (${roundMetric(metrics.skillDelta)} skill delta).`;
  }
  return `${performanceLead} Learner remains stable at ${newLevel} with a modest ${metrics.skillDelta >= 0 ? "+" : ""}${roundMetric(metrics.skillDelta)} skill adjustment.`;
}

export type AdaptiveTeacherDecision = {
  previousLevel: AdaptiveTeacherDisplayLevel;
  newLevel: AdaptiveTeacherDisplayLevel;
  decision: AdaptiveTeacherDecisionType;
  confidence: number;
  metrics: AdaptiveTeacherMetrics;
  explanation: string;
  modelVersion: string;
};

export function buildAdaptiveTeacherDecision(params: {
  previousSkill: number;
  newSkill: number;
  mastery: SectionMasteryBreakdown;
  calibratedTarget: number;
  emaStep: number;
  totalAttempts: number;
  streak: number;
}): AdaptiveTeacherDecision {
  const {
    previousSkill,
    newSkill,
    mastery,
    calibratedTarget,
    emaStep,
    totalAttempts,
    streak,
  } = params;

  const previousLevel = skillToDisplayLevel(previousSkill);
  const newLevel = skillToDisplayLevel(newSkill);
  const decision = classifySkillTransition(previousSkill, newSkill);
  const confidence = computeDecisionConfidence(mastery, emaStep);

  const metrics: AdaptiveTeacherMetrics = {
    accuracy: roundMetric(mastery.averageBestScore),
    averageAttempts: roundMetric(mastery.averageAttempts),
    recentMistakes: roundMetric(mastery.averageWrongMoves),
    difficultyScore:
      mastery.averageDifficulty != null
        ? roundMetric(mastery.averageDifficulty)
        : null,
    estimatedSkill: roundMetric(newSkill),
    confidence,
    sectionScore: roundMetric(mastery.sectionScore),
    averageMasteryScore: roundMetric(mastery.averageMasteryScore),
    calibratedTarget: roundMetric(calibratedTarget),
    emaStep: roundMetric(emaStep),
    skillDelta: roundMetric(newSkill - previousSkill),
    totalAttempts,
    qualified: mastery.qualified,
    previousSkill: roundMetric(previousSkill),
    newSkill: roundMetric(newSkill),
    streak,
  };

  const explanation = buildAdaptiveTeacherExplanation({
    decision,
    previousLevel,
    newLevel,
    metrics,
  });

  return {
    previousLevel,
    newLevel,
    decision,
    confidence,
    metrics,
    explanation,
    modelVersion: ADAPTIVE_TEACHER_MODEL_VERSION,
  };
}
