/**
 * Development-only learner state reset after destructive content refresh.
 * Removes content-derived progression for a user (or all users) on one video.
 * Does NOT delete catalog/parts/translations/vocab/grammar/media or global XP/profile.
 */
import type {
  Pool,
  PoolConnection,
  ResultSetHeader,
  RowDataPacket,
} from "mysql2/promise";
import { getContentSyncPool } from "@/lib/content-sync/syncDb";

export type DbExecutor = Pool | PoolConnection;

export type LearningResetTarget = {
  videoId: string;
  userId?: string | null;
  /** When true, reset every user with state on this video. */
  allUsers?: boolean;
};

export type LearningResetImpact = {
  videoId: string;
  videoName: string | null;
  userIds: string[];
  episodeIds: string[];
  /** Live catalog part rows for this video (must remain unchanged by reset). */
  currentParts: number;
  /** Headers with zero atomic child rows (classic post-rebuild 404 cause). */
  hollowMaterializedSections: number;
  willDeleteUserMaterializedSections: number;
  willDeleteUserLearningResume: number;
  willDeleteUserVideoLastSeen: number;
  willDeleteUserAdaptiveSkillSections: number;
  willDeleteAdaptiveTeacherEvents: number;
  willDeleteUserPartProgress: number;
  willDeleteUserTokenMarks: number;
  willDeleteUserReminders: number;
  willDeleteSavedVocabularyCards: number;
};

/** Refuse mutating learner reset outside development/test. */
export function assertDevelopmentLearningResetAllowed(
  nodeEnv: string | undefined = process.env.NODE_ENV,
): void {
  if (nodeEnv === "development" || nodeEnv === "test") return;
  throw new Error(
    `dev:reset-learning is development-only (NODE_ENV=${nodeEnv ?? "undefined"})`,
  );
}

async function tableExists(db: DbExecutor, table: string): Promise<boolean> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `
    SELECT 1 AS ok
    FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = ?
    LIMIT 1
    `,
    [table],
  );
  return rows.length > 0;
}

async function assertVideo(
  db: DbExecutor,
  videoId: string,
): Promise<{ id: string; name: string | null }> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT CAST(id AS CHAR) AS id, name FROM videos WHERE id = ? LIMIT 1`,
    [videoId],
  );
  if (rows.length === 0) {
    throw new Error(`Video not found: ${videoId}`);
  }
  return {
    id: String(rows[0]!.id),
    name: rows[0]!.name ? String(rows[0]!.name) : null,
  };
}

async function listEpisodeIdsForVideo(
  db: DbExecutor,
  videoId: string,
): Promise<string[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `
    SELECT CAST(e.id AS CHAR) AS id
    FROM episodes e
    INNER JOIN seasons s ON s.id = e.season_id
    WHERE s.video_id = ?
    `,
    [videoId],
  );
  return rows.map((r) => String(r.id));
}

function userFilter(
  column: string,
  userIds: string[] | null,
): { clause: string; params: string[] } {
  if (!userIds || userIds.length === 0) {
    return { clause: "1=1", params: [] };
  }
  return {
    clause: `${column} IN (${userIds.map(() => "?").join(",")})`,
    params: userIds,
  };
}

async function resolveUserIds(
  db: DbExecutor,
  target: LearningResetTarget,
): Promise<string[]> {
  if (target.allUsers) {
    const ids = new Set<string>();
    if (await tableExists(db, "user_materialized_sections")) {
      const [rows] = await db.execute<RowDataPacket[]>(
        `SELECT DISTINCT CAST(user_id AS CHAR) AS userId FROM user_materialized_sections WHERE video_id = ?`,
        [target.videoId],
      );
      for (const r of rows) ids.add(String(r.userId));
    }
    if (await tableExists(db, "user_learning_resume")) {
      const [rows] = await db.execute<RowDataPacket[]>(
        `SELECT DISTINCT CAST(user_id AS CHAR) AS userId FROM user_learning_resume WHERE video_id = ?`,
        [target.videoId],
      );
      for (const r of rows) ids.add(String(r.userId));
    }
    if (await tableExists(db, "user_video_last_seen")) {
      const [rows] = await db.execute<RowDataPacket[]>(
        `SELECT DISTINCT CAST(user_id AS CHAR) AS userId FROM user_video_last_seen WHERE video_id = ?`,
        [target.videoId],
      );
      for (const r of rows) ids.add(String(r.userId));
    }
    if (await tableExists(db, "user_adaptive_skill_sections")) {
      const [rows] = await db.execute<RowDataPacket[]>(
        `
        SELECT DISTINCT CAST(user_id AS CHAR) AS userId
        FROM user_adaptive_skill_sections
        WHERE section_key LIKE ?
        `,
        [`video:${target.videoId}:%`],
      );
      for (const r of rows) ids.add(String(r.userId));
    }
    return [...ids];
  }

  const userId = target.userId?.trim();
  if (!userId) {
    throw new Error("Provide --user-id or --all-users");
  }
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT CAST(id AS CHAR) AS id FROM users WHERE id = ? LIMIT 1`,
    [userId],
  );
  if (rows.length === 0) {
    throw new Error(`User not found: ${userId}`);
  }
  return [userId];
}

export async function countLearningResetImpact(
  target: LearningResetTarget,
  db: DbExecutor = getContentSyncPool(),
): Promise<LearningResetImpact> {
  const video = await assertVideo(db, target.videoId);
  const userIds = await resolveUserIds(db, target);
  const episodeIds = await listEpisodeIdsForVideo(db, target.videoId);
  const users = userFilter("user_id", target.allUsers ? null : userIds);

  let currentParts = 0;
  if (episodeIds.length > 0) {
    const epPh = episodeIds.map(() => "?").join(",");
    const [partRows] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS c FROM parts WHERE episode_id IN (${epPh})`,
      episodeIds,
    );
    currentParts = Number(partRows[0]?.c ?? 0);
  }

  let willDeleteUserMaterializedSections = 0;
  let hollowMaterializedSections = 0;
  if (await tableExists(db, "user_materialized_sections")) {
    const [rows] = await db.execute<RowDataPacket[]>(
      `
      SELECT COUNT(*) AS c
      FROM user_materialized_sections
      WHERE video_id = ?
        AND ${users.clause}
      `,
      [target.videoId, ...users.params],
    );
    willDeleteUserMaterializedSections = Number(rows[0]?.c ?? 0);

    const [hollowRows] = await db.execute<RowDataPacket[]>(
      `
      SELECT COUNT(*) AS c
      FROM user_materialized_sections ums
      WHERE ums.video_id = ?
        AND ${users.clause}
        AND (
          SELECT COUNT(*)
          FROM user_materialized_section_atomic_parts a
          WHERE a.section_id = ums.id
        ) = 0
      `,
      [target.videoId, ...users.params],
    );
    hollowMaterializedSections = Number(hollowRows[0]?.c ?? 0);
  }

  let willDeleteUserLearningResume = 0;
  if (await tableExists(db, "user_learning_resume")) {
    const [rows] = await db.execute<RowDataPacket[]>(
      `
      SELECT COUNT(*) AS c FROM user_learning_resume
      WHERE video_id = ? AND ${users.clause}
      `,
      [target.videoId, ...users.params],
    );
    willDeleteUserLearningResume = Number(rows[0]?.c ?? 0);
  }

  let willDeleteUserVideoLastSeen = 0;
  if (await tableExists(db, "user_video_last_seen")) {
    const [rows] = await db.execute<RowDataPacket[]>(
      `
      SELECT COUNT(*) AS c FROM user_video_last_seen
      WHERE video_id = ? AND ${users.clause}
      `,
      [target.videoId, ...users.params],
    );
    willDeleteUserVideoLastSeen = Number(rows[0]?.c ?? 0);
  }

  let willDeleteUserAdaptiveSkillSections = 0;
  if (await tableExists(db, "user_adaptive_skill_sections")) {
    const [rows] = await db.execute<RowDataPacket[]>(
      `
      SELECT COUNT(*) AS c FROM user_adaptive_skill_sections
      WHERE section_key LIKE ?
        AND ${users.clause}
      `,
      [`video:${target.videoId}:%`, ...users.params],
    );
    willDeleteUserAdaptiveSkillSections = Number(rows[0]?.c ?? 0);
  }

  let willDeleteAdaptiveTeacherEvents = 0;
  if (await tableExists(db, "adaptive_teacher_events")) {
    const [rows] = await db.execute<RowDataPacket[]>(
      `
      SELECT COUNT(*) AS c FROM adaptive_teacher_events
      WHERE scope_id LIKE ?
        AND ${users.clause}
      `,
      [`video:${target.videoId}:%`, ...users.params],
    );
    willDeleteAdaptiveTeacherEvents = Number(rows[0]?.c ?? 0);
  }

  // Part-scoped leftovers for this video (usually already 0 after content refresh)
  let willDeleteUserPartProgress = 0;
  let willDeleteUserTokenMarks = 0;
  let willDeleteUserReminders = 0;
  let willDeleteSavedVocabularyCards = 0;

  if (episodeIds.length > 0) {
    const epPh = episodeIds.map(() => "?").join(",");
    if (await tableExists(db, "user_part_progress")) {
      const [rows] = await db.execute<RowDataPacket[]>(
        `
        SELECT COUNT(*) AS c
        FROM user_part_progress upp
        INNER JOIN parts p ON p.id = upp.part_id
        WHERE p.episode_id IN (${epPh})
          AND ${userFilter("upp.user_id", target.allUsers ? null : userIds).clause}
        `,
        [
          ...episodeIds,
          ...userFilter("upp.user_id", target.allUsers ? null : userIds).params,
        ],
      );
      willDeleteUserPartProgress = Number(rows[0]?.c ?? 0);
    }
    if (await tableExists(db, "user_token_marks")) {
      const uf = userFilter("utm.user_id", target.allUsers ? null : userIds);
      const [rows] = await db.execute<RowDataPacket[]>(
        `
        SELECT COUNT(*) AS c
        FROM user_token_marks utm
        INNER JOIN parts p ON p.id = utm.part_id
        WHERE p.episode_id IN (${epPh})
          AND ${uf.clause}
        `,
        [...episodeIds, ...uf.params],
      );
      willDeleteUserTokenMarks = Number(rows[0]?.c ?? 0);
    }
    if (await tableExists(db, "user_reminders")) {
      const uf = userFilter("ur.user_id", target.allUsers ? null : userIds);
      const [rows] = await db.execute<RowDataPacket[]>(
        `
        SELECT COUNT(*) AS c
        FROM user_reminders ur
        INNER JOIN parts p ON p.id = ur.part_id
        WHERE p.episode_id IN (${epPh})
          AND ${uf.clause}
        `,
        [...episodeIds, ...uf.params],
      );
      willDeleteUserReminders = Number(rows[0]?.c ?? 0);
    }
    if (await tableExists(db, "saved_vocabulary_cards")) {
      const uf = userFilter("svc.user_id", target.allUsers ? null : userIds);
      const [rows] = await db.execute<RowDataPacket[]>(
        `
        SELECT COUNT(*) AS c
        FROM saved_vocabulary_cards svc
        INNER JOIN parts p ON p.id = svc.clip_id
        WHERE p.episode_id IN (${epPh})
          AND ${uf.clause}
        `,
        [...episodeIds, ...uf.params],
      );
      willDeleteSavedVocabularyCards = Number(rows[0]?.c ?? 0);
    }
  }

  return {
    videoId: video.id,
    videoName: video.name,
    userIds,
    episodeIds,
    currentParts,
    hollowMaterializedSections,
    willDeleteUserMaterializedSections,
    willDeleteUserLearningResume,
    willDeleteUserVideoLastSeen,
    willDeleteUserAdaptiveSkillSections,
    willDeleteAdaptiveTeacherEvents,
    willDeleteUserPartProgress,
    willDeleteUserTokenMarks,
    willDeleteUserReminders,
    willDeleteSavedVocabularyCards,
  };
}

async function deleteCount(
  db: DbExecutor,
  sql: string,
  params: unknown[],
): Promise<number> {
  const [result] = await db.execute<ResultSetHeader>(sql, params);
  return result.affectedRows;
}

/**
 * Apply learner reset inside an existing transaction connection when provided.
 */
export async function applyLearningReset(
  target: LearningResetTarget,
  db: DbExecutor = getContentSyncPool(),
): Promise<LearningResetImpact> {
  const impact = await countLearningResetImpact(target, db);
  if (impact.userIds.length === 0 && !target.allUsers) {
    throw new Error("No target users resolved");
  }

  const users = userFilter("user_id", target.allUsers ? null : impact.userIds);
  const episodeIds = impact.episodeIds;

  if (await tableExists(db, "user_materialized_sections")) {
    await deleteCount(
      db,
      `
      DELETE FROM user_materialized_sections
      WHERE video_id = ?
        AND ${users.clause}
      `,
      [target.videoId, ...users.params],
    );
  }

  if (await tableExists(db, "user_learning_resume")) {
    await deleteCount(
      db,
      `
      DELETE FROM user_learning_resume
      WHERE video_id = ?
        AND ${users.clause}
      `,
      [target.videoId, ...users.params],
    );
  }

  if (await tableExists(db, "user_video_last_seen")) {
    await deleteCount(
      db,
      `
      DELETE FROM user_video_last_seen
      WHERE video_id = ?
        AND ${users.clause}
      `,
      [target.videoId, ...users.params],
    );
  }

  if (await tableExists(db, "user_adaptive_skill_sections")) {
    await deleteCount(
      db,
      `
      DELETE FROM user_adaptive_skill_sections
      WHERE section_key LIKE ?
        AND ${users.clause}
      `,
      [`video:${target.videoId}:%`, ...users.params],
    );
  }

  if (await tableExists(db, "adaptive_teacher_events")) {
    await deleteCount(
      db,
      `
      DELETE FROM adaptive_teacher_events
      WHERE scope_id LIKE ?
        AND ${users.clause}
      `,
      [`video:${target.videoId}:%`, ...users.params],
    );
  }

  if (episodeIds.length > 0) {
    const epPh = episodeIds.map(() => "?").join(",");

    if (await tableExists(db, "user_part_progress")) {
      const uf = userFilter("upp.user_id", target.allUsers ? null : impact.userIds);
      await deleteCount(
        db,
        `
        DELETE upp FROM user_part_progress upp
        INNER JOIN parts p ON p.id = upp.part_id
        WHERE p.episode_id IN (${epPh})
          AND ${uf.clause}
        `,
        [...episodeIds, ...uf.params],
      );
    }
    if (await tableExists(db, "user_token_marks")) {
      const uf = userFilter("utm.user_id", target.allUsers ? null : impact.userIds);
      await deleteCount(
        db,
        `
        DELETE utm FROM user_token_marks utm
        INNER JOIN parts p ON p.id = utm.part_id
        WHERE p.episode_id IN (${epPh})
          AND ${uf.clause}
        `,
        [...episodeIds, ...uf.params],
      );
    }
    if (await tableExists(db, "user_reminders")) {
      const uf = userFilter("ur.user_id", target.allUsers ? null : impact.userIds);
      await deleteCount(
        db,
        `
        DELETE ur FROM user_reminders ur
        INNER JOIN parts p ON p.id = ur.part_id
        WHERE p.episode_id IN (${epPh})
          AND ${uf.clause}
        `,
        [...episodeIds, ...uf.params],
      );
    }
    if (await tableExists(db, "saved_vocabulary_cards")) {
      const uf = userFilter("svc.user_id", target.allUsers ? null : impact.userIds);
      await deleteCount(
        db,
        `
        DELETE svc FROM saved_vocabulary_cards svc
        INNER JOIN parts p ON p.id = svc.clip_id
        WHERE p.episode_id IN (${epPh})
          AND ${uf.clause}
        `,
        [...episodeIds, ...uf.params],
      );
    }
  }

  return impact;
}

export async function runLearningReset(params: {
  target: LearningResetTarget;
  dryRun?: boolean;
}): Promise<{ dryRun: boolean; impact: LearningResetImpact }> {
  assertDevelopmentLearningResetAllowed();

  const pool = getContentSyncPool();
  const impact = await countLearningResetImpact(params.target, pool);

  if (params.dryRun) {
    return { dryRun: true, impact };
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await applyLearningReset(params.target, conn);
    await conn.commit();
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }

  return { dryRun: false, impact };
}

/**
 * Called from content refresh: drop all materialized section headers for an episode
 * (and its video) so hollow playlists cannot 404 after parts rebuild.
 */
export async function deleteMaterializedSectionsForEpisode(
  episodeId: string,
  db: DbExecutor = getContentSyncPool(),
): Promise<number> {
  if (!(await tableExists(db, "user_materialized_sections"))) return 0;

  const [byEpisode] = await db.execute<ResultSetHeader>(
    `DELETE FROM user_materialized_sections WHERE episode_id = ?`,
    [episodeId],
  );

  // Standalone movies may store headers with episode_id NULL but video_id set.
  const [videoRows] = await db.execute<RowDataPacket[]>(
    `
    SELECT CAST(s.video_id AS CHAR) AS videoId
    FROM episodes e
    INNER JOIN seasons s ON s.id = e.season_id
    WHERE e.id = ?
    LIMIT 1
    `,
    [episodeId],
  );
  const videoId = videoRows[0]?.videoId ? String(videoRows[0].videoId) : null;
  let byVideo = 0;
  if (videoId) {
    const [result] = await db.execute<ResultSetHeader>(
      `
      DELETE FROM user_materialized_sections
      WHERE video_id = ?
        AND (episode_id IS NULL OR episode_id = ?)
      `,
      [videoId, episodeId],
    );
    byVideo = result.affectedRows;
  }

  return (byEpisode.affectedRows || 0) + byVideo;
}
