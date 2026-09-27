export type SkillSource =
  | "persisted"
  | "cold_start"
  | "no_history"
  | "backfilled";

export type SkillMode = "adaptive" | "canonical";

export type SkillStage = "new_user" | "learning" | "adaptive_ready";

export type BackfillState = "none" | "in_progress" | "done" | "not_needed";

export type LockState =
  | "none"
  | "acquired"
  | "in_progress"
  | "already_complete"
  | "expired_takeover"
  | "not_needed";

export type SkillResult = {
  skill: number;
  source: SkillSource;
  /** System behavior: adaptive ordering vs canonical section order. */
  mode: SkillMode;
  /** UX-facing progression stage. */
  stage: SkillStage;
  lockState: LockState;
  hasPersistedSkill: boolean;
  hasSections: boolean;
  backfillTriggered: boolean;
  skillNeedsBackfill: boolean;
  backfillState: BackfillState;
};

/** Adaptive ordering requires onboarding; otherwise canonical section order. */
export function skillModeForSource(source: SkillSource): SkillMode {
  return source === "no_history" ? "canonical" : "adaptive";
}

export function skillStageForSource(source: SkillSource): SkillStage {
  switch (source) {
    case "no_history":
      return "new_user";
    case "cold_start":
      return "learning";
    case "persisted":
    case "backfilled":
      return "adaptive_ready";
  }
}

export function assertSkillResult(result: SkillResult): void {
  if (!result.source) {
    throw new Error("Missing skill source on SkillResult");
  }
  if (result.mode !== skillModeForSource(result.source)) {
    throw new Error(
      `mode mismatch for source ${result.source}: got ${result.mode}`,
    );
  }
  if (result.stage !== skillStageForSource(result.source)) {
    throw new Error(
      `stage mismatch for source ${result.source}: got ${result.stage}`,
    );
  }
}
