import {
  findUserOverallSkill,
  isAdaptiveSkillSectionApplied,
  setUserOverallSkill,
  tryRecordAdaptiveSkillSection,
} from "@/lib/db/queries/userAdaptiveSkill";
import { insertAdaptiveTeacherEvent } from "@/lib/db/queries/adaptiveTeacherEvents";
import { findUserEnglishLevelById } from "@/lib/db/queries/users";
import { getStreakForUser } from "@/lib/db/learningStreak";
import {
  aggregateSectionMastery,
  type SectionMasteryBreakdown,
} from "@/lib/skill/partMasteryScore";
import { pool } from "@/lib/db/connection";
import {
  clampSkill,
  priorFromEnglishLevel,
  SKILL_SECTION_EMA_ALPHA,
  SKILL_SECTION_MAX_DELTA,
} from "@/lib/skill/constants";
import { calibrateSkillTarget } from "@/lib/skill/calibrateSkillTarget";
import { buildAdaptiveTeacherDecision } from "@/lib/skill/adaptiveTeacherDecision";
import type { PartSectionAdaptiveContext } from "@/lib/skill/resolvePartSectionScope";
import {
  getAdaptiveEpisodeOrder,
  type AdaptiveOrderUser,
} from "@/lib/learning/adaptiveEpisodeOrdering";
import {
  buildSectionPlaylistForIndex,
  evaluateCatalogVisibleCompletion,
  loadCurriculumGlobalOrder,
  loadVisibleSectionCatalog,
  type SectionCurriculumScope,
} from "@/lib/learning/sectionCurriculum";
import {
  countPartsForEpisodeId,
  countPartsForVideoId,
  isStandaloneVideoType,
} from "@/lib/db/queries/videos";
import {
  getEpisodePartsOrderMeta,
  getVideoPartsOrderMeta,
} from "@/lib/db/parts";
import { listProgressSliceForParts } from "@/lib/db/queries/userPartProgress";
import type { UserId } from "@/types/schema";
import type { RowDataPacket } from "mysql2/promise";
import type { VideoType } from "@/types/video";

function roundMetric(value: number): number {
  return Math.round(value * 10) / 10;
}

async function resolveAdaptiveOrderUser(
  userId: UserId,
): Promise<AdaptiveOrderUser> {
  const englishLevel = await findUserEnglishLevelById(userId);
  return { id: userId, englishLevel };
}

function curriculumScopeForContext(
  ctx: PartSectionAdaptiveContext,
): SectionCurriculumScope {
  return ctx.scope.kind === "episode"
    ? {
        episodeId: ctx.scope.episodeId,
        curriculumId: `episode:${ctx.scope.episodeId}`,
      }
    : {
        videoId: ctx.scope.videoId,
        curriculumId: `video:${ctx.scope.videoId}`,
      };
}

/** Mastery-based section metrics for skill EMA (avg partMasteryScore). */
export async function computeSectionMasteryBreakdown(
  userId: UserId,
  ctx: PartSectionAdaptiveContext,
): Promise<SectionMasteryBreakdown> {
  const user = await resolveAdaptiveOrderUser(userId);
  const scope = curriculumScopeForContext(ctx);
  const globalOrder = await loadCurriculumGlobalOrder(
    scope,
    user,
    ctx.totalParts,
  );
  const playlist = await buildSectionPlaylistForIndex(
    globalOrder,
    ctx.sectionIndex,
    user,
  );
  const progressionUnits =
    playlist.progressionUnits.length > 0
      ? playlist.progressionUnits
      : playlist.learningUnits;
  const visibleParts = progressionUnits.flatMap((unit) => unit.parts);
  if (visibleParts.length === 0) return aggregateSectionMastery([]);

  const slices = await listProgressSliceForParts(
    userId,
    visibleParts.map((p) => p.id),
  );
  const byPart = new Map(slices.map((s) => [s.partId, s]));

  return aggregateSectionMastery(
    visibleParts.map((p) => {
      const row = byPart.get(p.id);
      return {
        bestScore: row?.bestScore ?? 0,
        attempts: row?.attempts ?? 0,
        wrongMoves: row?.wrongMoves ?? 0,
        completedAt: row?.completedAt ?? null,
        difficultyScore: p.difficultyScore ?? null,
      };
    }),
  );
}

/** Average partMasteryScore for qualified completions in a section. */
export async function computeSectionScore(
  userId: UserId,
  ctx: PartSectionAdaptiveContext,
): Promise<number> {
  const breakdown = await computeSectionMasteryBreakdown(userId, ctx);
  return breakdown.sectionScore;
}

type CompletedSectionCandidate = {
  sectionKey: string;
  sectionId: string;
  ctx: PartSectionAdaptiveContext;
  completedAt: Date;
};

type ProgressPartRow = RowDataPacket & {
  part_id: string;
  part_order: number;
  episode_id: string;
  video_id: string;
  video_type: VideoType;
  best_score: number;
  completed_at: Date;
};

async function listQualifiedProgressParts(
  userId: UserId,
): Promise<ProgressPartRow[]> {
  const [rows] = await pool.execute<ProgressPartRow[]>(
    `
    SELECT
      CAST(upp.part_id AS CHAR) AS part_id,
      p.\`order\` AS part_order,
      CAST(p.episode_id AS CHAR) AS episode_id,
      CAST(s.video_id AS CHAR) AS video_id,
      v.type AS video_type,
      upp.best_score,
      upp.completed_at
    FROM user_part_progress upp
    INNER JOIN parts p ON p.id = upp.part_id
    INNER JOIN episodes e ON e.id = p.episode_id
    INNER JOIN seasons s ON s.id = e.season_id
    INNER JOIN videos v ON v.id = s.video_id
    WHERE upp.user_id = ?
      AND upp.completed_at IS NOT NULL
      AND upp.best_score > 0
    `,
    [userId],
  );
  return rows;
}

function buildSectionCandidate(
  scopeKind: "episode" | "video",
  scopeId: string,
  sectionIndex: number,
  totalParts: number,
  completedAt: Date,
): CompletedSectionCandidate {
  const scope =
    scopeKind === "episode"
      ? { kind: "episode" as const, episodeId: scopeId }
      : { kind: "video" as const, videoId: scopeId };
  const prefix = scopeKind === "episode" ? "episode" : "video";
  return {
    sectionKey: `${prefix}:${scopeId}:s${sectionIndex}`,
    sectionId: `${prefix}:${scopeId}:section:${sectionIndex}`,
    ctx: {
      sectionIndex,
      totalParts,
      sectionKey: `${prefix}:${scopeId}:s${sectionIndex}`,
      sectionId: `${prefix}:${scopeId}:section:${sectionIndex}`,
      scope,
    },
    completedAt,
  };
}

type ScopeBucket = {
  kind: "episode" | "video";
  scopeId: string;
  totalParts: number;
};

async function listScopeBucketsFromProgress(
  userId: UserId,
): Promise<ScopeBucket[]> {
  const rows = await listQualifiedProgressParts(userId);
  if (rows.length === 0) return [];

  const buckets = new Map<string, ScopeBucket>();

  for (const r of rows) {
    const standalone = isStandaloneVideoType(r.video_type);
    const kind = standalone ? "video" : "episode";
    const scopeId = standalone ? String(r.video_id) : String(r.episode_id);
    const bucketKey = `${kind}:${scopeId}`;

    if (buckets.has(bucketKey)) continue;

    const totalParts =
      kind === "video"
        ? await countPartsForVideoId(scopeId)
        : await countPartsForEpisodeId(scopeId);
    if (totalParts < 1) continue;
    buckets.set(bucketKey, { kind, scopeId, totalParts });
  }

  return [...buckets.values()];
}

async function latestCompletionInVisibleSection(
  userId: UserId,
  catalogEntry: {
    progressionUnits?: ReadonlyArray<{
      parts: ReadonlyArray<{ id: string }>;
    }>;
    learningUnits: ReadonlyArray<{
      parts: ReadonlyArray<{ id: string }>;
    }>;
  },
): Promise<Date | null> {
  const units =
    catalogEntry.progressionUnits ?? catalogEntry.learningUnits;
  const partIds = units.flatMap((unit) => unit.parts.map((part) => part.id));
  if (partIds.length === 0) return null;

  const slices = await listProgressSliceForParts(userId, partIds);
  let latest: Date | null = null;
  for (const slice of slices) {
    if (slice.completedAt == null || slice.bestScore <= 0) continue;
    if (!latest || slice.completedAt > latest) {
      latest = slice.completedAt;
    }
  }
  return latest;
}

/**
 * Fully completed visible sections, ordered by section completion time.
 */
export async function listFullyCompletedSectionsOrdered(
  userId: UserId,
): Promise<CompletedSectionCandidate[]> {
  const buckets = await listScopeBucketsFromProgress(userId);
  if (buckets.length === 0) return [];

  const user = await resolveAdaptiveOrderUser(userId);
  const candidates: CompletedSectionCandidate[] = [];

  for (const bucket of buckets) {
    const scope: SectionCurriculumScope =
      bucket.kind === "episode"
        ? {
            episodeId: bucket.scopeId,
            curriculumId: `episode:${bucket.scopeId}`,
          }
        : {
            videoId: bucket.scopeId,
            curriculumId: `video:${bucket.scopeId}`,
          };

    const curriculumParts =
      bucket.kind === "episode"
        ? await getEpisodePartsOrderMeta(bucket.scopeId)
        : await getVideoPartsOrderMeta(bucket.scopeId);
    if (curriculumParts.length === 0) continue;

    // Authoritative pool size is the loaded curriculum rows. A separate COUNT
    // can disagree with a stale/wrong cache and must not abort skill updates.
    const totalParts = curriculumParts.length;
    if (totalParts !== bucket.totalParts) {
      console.warn(
        "[section-skill] curriculum pool size != countParts; using loaded pool",
        {
          scopeId: bucket.scopeId,
          kind: bucket.kind,
          loaded: totalParts,
          counted: bucket.totalParts,
        },
      );
    }

    const globalOrder = await getAdaptiveEpisodeOrder({
      episodeParts: curriculumParts,
      user,
      context: {
        curriculumId: scope.curriculumId,
        totalParts,
      },
    });

    const catalog = await loadVisibleSectionCatalog(globalOrder, user);
    const completions = await evaluateCatalogVisibleCompletion(catalog, userId);

    for (let i = 0; i < catalog.length; i++) {
      if (!completions[i]) continue;
      const latestCompleted = await latestCompletionInVisibleSection(
        userId,
        catalog[i]!,
      );
      if (!latestCompleted) continue;

      candidates.push(
        buildSectionCandidate(
          bucket.kind,
          bucket.scopeId,
          catalog[i]!.sectionIndex,
          totalParts,
          latestCompleted,
        ),
      );
    }
  }

  candidates.sort((a, b) => a.completedAt.getTime() - b.completedAt.getTime());
  return candidates;
}

export async function countFullyCompletedSections(
  userId: UserId,
): Promise<number> {
  const list = await listFullyCompletedSectionsOrdered(userId);
  return list.length;
}

export async function userHasFullyCompletedSection(
  userId: UserId,
): Promise<boolean> {
  return (await countFullyCompletedSections(userId)) > 0;
}

/** Most recently completed qualified section (for migration backfill entry). */
export async function getLastQualifiedCompletedSection(
  userId: UserId,
): Promise<CompletedSectionCandidate | null> {
  const completed = await listFullyCompletedSectionsOrdered(userId);
  return completed.length > 0 ? completed[completed.length - 1]! : null;
}

/**
 * One-time catch-up: apply section EMA for every qualified section missing from the skill log.
 * Caller MUST hold the DB backfill lock from `acquireSkillBackfillLock` before invoking.
 * Returns true if at least one section was applied.
 */
export async function backfillSkillFromCompletedSections(
  userId: UserId,
): Promise<boolean> {
  const completed = await listFullyCompletedSectionsOrdered(userId);
  if (completed.length === 0) return false;

  let anyApplied = false;

  for (const item of completed) {
    const applied = await isAdaptiveSkillSectionApplied(
      userId,
      item.sectionKey,
    );
    if (!applied) {
      const result = await applyEmaForSection(userId, item.ctx);
      if (result) anyApplied = true;
    }
  }

  return anyApplied;
}

async function sumSectionAttempts(
  userId: UserId,
  ctx: PartSectionAdaptiveContext,
): Promise<number> {
  const user = await resolveAdaptiveOrderUser(userId);
  const scope = curriculumScopeForContext(ctx);
  const globalOrder = await loadCurriculumGlobalOrder(
    scope,
    user,
    ctx.totalParts,
  );
  const playlist = await buildSectionPlaylistForIndex(
    globalOrder,
    ctx.sectionIndex,
    user,
  );
  if (playlist.atomicParts.length === 0) return 0;

  const slices = await listProgressSliceForParts(
    userId,
    playlist.atomicParts.map((p) => p.id),
  );
  return slices.reduce((sum, row) => sum + row.attempts, 0);
}

async function resolvePreviousSkill(userId: UserId): Promise<number> {
  const stored = await findUserOverallSkill(userId);
  if (stored != null) return clampSkill(stored);
  const englishLevel = await findUserEnglishLevelById(userId);
  return clampSkill(priorFromEnglishLevel(englishLevel));
}

async function applyEmaForSection(
  userId: UserId,
  ctx: PartSectionAdaptiveContext,
): Promise<{ previousSkill: number; sectionScore: number; newSkill: number } | null> {
  const inserted = await tryRecordAdaptiveSkillSection(userId, ctx.sectionKey);
  if (!inserted) return null;

  const previousSkill = await resolvePreviousSkill(userId);
  const mastery = await computeSectionMasteryBreakdown(userId, ctx);
  const sectionScore = mastery.sectionScore;

  if (mastery.qualified) {
  }

  // Anchor the EMA target to the DIFFICULTY the learner handled, not their raw
  // score, then cap how far skill can move in one section. Together these stop
  // the "aced easy content → jumped to intermediate" cliff.
  const calibratedTarget = calibrateSkillTarget(
    mastery.averageDifficulty,
    sectionScore,
  );
  const emaStepRaw =
    SKILL_SECTION_EMA_ALPHA * (calibratedTarget - previousSkill);
  const emaStep = Math.max(
    -SKILL_SECTION_MAX_DELTA,
    Math.min(SKILL_SECTION_MAX_DELTA, emaStepRaw),
  );
  const newSkill = clampSkill(previousSkill + emaStep);
  const skillDelta = newSkill - previousSkill;
  const totalAttempts = await sumSectionAttempts(userId, ctx);

  await setUserOverallSkill(userId, newSkill);

  const streak = await getStreakForUser(userId);
  const teacherDecision = buildAdaptiveTeacherDecision({
    previousSkill,
    newSkill,
    mastery,
    calibratedTarget,
    emaStep,
    totalAttempts,
    streak: streak.current,
  });

  await insertAdaptiveTeacherEvent({
    userId,
    scopeId: ctx.sectionId,
    decision: teacherDecision,
  }).catch((err) => {
    console.error("[adaptive-teacher-event] persist failed", {
      userId,
      sectionId: ctx.sectionId,
      err,
    });
  });

  return { previousSkill, sectionScore, newSkill };
}

/**
 * Apply section EMA updates after a section transitions incomplete → complete.
 * Also catches up any earlier completed sections missing from the skill log (migration).
 * Must NOT be called per-clip — only from the performance route transition guard.
 */
export async function applySectionSkillUpdateOnTransition(
  userId: UserId,
  ctx: PartSectionAdaptiveContext,
): Promise<void> {
  let completed: CompletedSectionCandidate[];
  try {
    completed = await listFullyCompletedSectionsOrdered(userId);
  } catch (err) {
    console.error("[section-skill] listFullyCompletedSectionsOrdered failed", {
      userId,
      sectionKey: ctx.sectionKey,
      err,
    });
    return;
  }
  for (const item of completed) {
    const applied = await isAdaptiveSkillSectionApplied(
      userId,
      item.sectionKey,
    );
    if (!applied) {
      await applyEmaForSection(userId, item.ctx);
    }
    if (item.sectionKey === ctx.sectionKey) break;
  }
}
