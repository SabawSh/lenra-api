/**
 * Regression coverage for learner reset after destructive content refresh.
 *
 * Cases:
 * A) Hollow/stale materialized headers after rebuilt parts → reset clears them
 * B) Fresh learner impact preview is zero-ish / route prerequisites intact
 * C) Reset video A does not delete learner state for video B
 * D) Shared content (parts/grammar/vocab) preserved
 * E) Transaction failure rolls back
 * F) Non-development environment refuses execution
 *
 *   npm run test:reset-learning
 */
import assert from "node:assert/strict";
import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import {
  closeContentSyncPool,
  getContentSyncPool,
} from "@/lib/content-sync/syncDb";
import {
  assertDevelopmentLearningResetAllowed,
  applyLearningReset,
  countLearningResetImpact,
  deleteMaterializedSectionsForEpisode,
  runLearningReset,
} from "./resetLearningState";

const CORALINE_VIDEO = "6784f213-3b74-45a0-8c20-b45860557324";
const CORALINE_EPISODE = "446df68d-bd18-439b-90ff-d8eb7c5012d2";
const FAKE_USER = "00000000-0000-4000-8000-0000000000aa";
const FAKE_USER_B = "00000000-0000-4000-8000-0000000000bb";

async function main() {
  assert.equal(typeof deleteMaterializedSectionsForEpisode, "function");
  assert.equal(typeof countLearningResetImpact, "function");

  // Case F — non-development must refuse
  assert.throws(
    () => assertDevelopmentLearningResetAllowed("production"),
    /development-only/i,
  );
  assert.doesNotThrow(() =>
    assertDevelopmentLearningResetAllowed("development"),
  );
  assert.doesNotThrow(() => assertDevelopmentLearningResetAllowed("test"));

  try {
    await countLearningResetImpact({
      videoId: "00000000-0000-0000-0000-000000000000",
      userId: "00000000-0000-0000-0000-000000000001",
    });
    assert.fail("expected missing video to throw");
  } catch (error) {
    assert.match(
      error instanceof Error ? error.message : String(error),
      /Video not found|DATABASE_URL|ECONNREFUSED|Connection lost/i,
    );
  }

  if (!process.env.DATABASE_URL) {
    console.log("resetLearningState: ok (skipped live DB checks — no DATABASE_URL)");
    return;
  }

  // Ensure NODE_ENV allows reset during this script
  if (!process.env.NODE_ENV) process.env.NODE_ENV = "development";

  const pool = getContentSyncPool();
  try {
    const [partRows] = await pool.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS c FROM parts WHERE episode_id = ?`,
      [CORALINE_EPISODE],
    );
    const partCount = Number(partRows[0]?.c ?? 0);
    if (partCount < 1) {
      console.log(
        "resetLearningState: ok (skipped Coraline checks — no parts for episode)",
      );
      return;
    }

    const preview = await countLearningResetImpact({
      videoId: CORALINE_VIDEO,
      allUsers: true,
    });
    assert.equal(preview.videoId, CORALINE_VIDEO);
    assert.ok(preview.episodeIds.includes(CORALINE_EPISODE));
    assert.equal(preview.currentParts, partCount);

    // Dry-run must not mutate.
    const before = await pool.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS c FROM user_materialized_sections WHERE video_id = ?`,
      [CORALINE_VIDEO],
    );
    const beforeCount = Number((before[0] as RowDataPacket[])[0]?.c ?? 0);
    await runLearningReset({
      target: { videoId: CORALINE_VIDEO, allUsers: true },
      dryRun: true,
    });
    const afterDry = await pool.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS c FROM user_materialized_sections WHERE video_id = ?`,
      [CORALINE_VIDEO],
    );
    assert.equal(
      Number((afterDry[0] as RowDataPacket[])[0]?.c ?? 0),
      beforeCount,
    );

    // Case B — fresh user with no rows: impact counts for that user are 0
    await pool.execute(
      `
      INSERT IGNORE INTO users (id, email, name)
      VALUES (?, ?, 'reset-test-a')
      `,
      [FAKE_USER, `reset-a-${FAKE_USER}@example.invalid`],
    );
    await pool.execute(
      `
      INSERT IGNORE INTO users (id, email, name)
      VALUES (?, ?, 'reset-test-b')
      `,
      [FAKE_USER_B, `reset-b-${FAKE_USER_B}@example.invalid`],
    );

    const fresh2 = await countLearningResetImpact({
      videoId: CORALINE_VIDEO,
      userId: FAKE_USER,
    });
    assert.equal(fresh2.willDeleteUserMaterializedSections, 0);
    assert.equal(fresh2.willDeleteUserLearningResume, 0);
    assert.equal(fresh2.currentParts, partCount);

    // Case A — insert hollow materialized header (post-CASCADE failure mode)
    const scopeKey = `video:${CORALINE_VIDEO}`;
    await pool.execute(
      `DELETE FROM user_materialized_sections WHERE user_id = ? AND video_id = ?`,
      [FAKE_USER, CORALINE_VIDEO],
    );
    await pool.execute(
      `
      INSERT INTO user_materialized_sections
        (user_id, video_id, episode_id, scope_key, section_index, curriculum_version, created_at, updated_at)
      VALUES (?, ?, NULL, ?, 1, 'stale-hollow-test', NOW(3), NOW(3))
      `,
      [FAKE_USER, CORALINE_VIDEO, scopeKey],
    );
    await pool.execute(
      `
      INSERT INTO user_learning_resume
        (user_id, video_id, season_id, episode_id, resume_section, resume_part, highest_unlocked_section, created_at, updated_at)
      SELECT ?, ?, CAST(s.id AS CHAR), ?, 2, 1, 2, NOW(3), NOW(3)
      FROM seasons s
      WHERE s.video_id = ?
      LIMIT 1
      ON DUPLICATE KEY UPDATE resume_section = 2, resume_part = 1, highest_unlocked_section = 2
      `,
      [FAKE_USER, CORALINE_VIDEO, CORALINE_EPISODE, CORALINE_VIDEO],
    );

    const impactA = await countLearningResetImpact({
      videoId: CORALINE_VIDEO,
      userId: FAKE_USER,
    });
    assert.ok(impactA.hollowMaterializedSections >= 1);
    assert.ok(impactA.willDeleteUserMaterializedSections >= 1);

    const grammarBefore = await pool.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS c FROM grammar_concepts`,
    );
    const grammarCountBefore = Number(
      (grammarBefore[0] as RowDataPacket[])[0]?.c ?? 0,
    );
    const partsBefore = partCount;

    await runLearningReset({
      target: { videoId: CORALINE_VIDEO, userId: FAKE_USER },
      dryRun: false,
    });

    const [headersAfter] = await pool.execute<RowDataPacket[]>(
      `
      SELECT COUNT(*) AS c FROM user_materialized_sections
      WHERE user_id = ? AND video_id = ?
      `,
      [FAKE_USER, CORALINE_VIDEO],
    );
    assert.equal(Number(headersAfter[0]?.c ?? 0), 0);

    const [resumeAfter] = await pool.execute<RowDataPacket[]>(
      `
      SELECT COUNT(*) AS c FROM user_learning_resume
      WHERE user_id = ? AND video_id = ?
      `,
      [FAKE_USER, CORALINE_VIDEO],
    );
    assert.equal(Number(resumeAfter[0]?.c ?? 0), 0);

    // Case D — shared content preserved
    const [partsAfter] = await pool.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS c FROM parts WHERE episode_id = ?`,
      [CORALINE_EPISODE],
    );
    assert.equal(Number(partsAfter[0]?.c ?? 0), partsBefore);
    const grammarAfter = await pool.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS c FROM grammar_concepts`,
    );
    assert.equal(
      Number((grammarAfter[0] as RowDataPacket[])[0]?.c ?? 0),
      grammarCountBefore,
    );

    // Case C — reset video A must not delete state for another video
    const [otherVideo] = await pool.execute<RowDataPacket[]>(
      `
      SELECT CAST(id AS CHAR) AS id FROM videos
      WHERE id <> ?
      LIMIT 1
      `,
      [CORALINE_VIDEO],
    );
    if (otherVideo[0]?.id) {
      const otherId = String(otherVideo[0].id);
      await pool.execute(
        `
        INSERT INTO user_learning_resume
          (user_id, video_id, resume_section, resume_part, highest_unlocked_section, created_at, updated_at)
        VALUES (?, ?, 1, 1, 1, NOW(3), NOW(3))
        ON DUPLICATE KEY UPDATE resume_section = 1, resume_part = 1
        `,
        [FAKE_USER_B, otherId],
      );
      await pool.execute(
        `
        INSERT INTO user_materialized_sections
          (user_id, video_id, episode_id, scope_key, section_index, curriculum_version, created_at, updated_at)
        VALUES (?, ?, NULL, ?, 1, 'other-video-keep', NOW(3), NOW(3))
        ON DUPLICATE KEY UPDATE curriculum_version = 'other-video-keep'
        `,
        [FAKE_USER_B, otherId, `video:${otherId}`],
      );

      await runLearningReset({
        target: { videoId: CORALINE_VIDEO, userId: FAKE_USER_B },
        dryRun: false,
      });

      const [otherResume] = await pool.execute<RowDataPacket[]>(
        `
        SELECT COUNT(*) AS c FROM user_learning_resume
        WHERE user_id = ? AND video_id = ?
        `,
        [FAKE_USER_B, otherId],
      );
      assert.equal(
        Number(otherResume[0]?.c ?? 0),
        1,
        "unrelated video resume must survive",
      );
      const [otherMat] = await pool.execute<RowDataPacket[]>(
        `
        SELECT COUNT(*) AS c FROM user_materialized_sections
        WHERE user_id = ? AND video_id = ?
        `,
        [FAKE_USER_B, otherId],
      );
      assert.equal(
        Number(otherMat[0]?.c ?? 0),
        1,
        "unrelated video materialized header must survive",
      );

      // cleanup B
      await pool.execute(
        `DELETE FROM user_materialized_sections WHERE user_id = ?`,
        [FAKE_USER_B],
      );
      await pool.execute(
        `DELETE FROM user_learning_resume WHERE user_id = ?`,
        [FAKE_USER_B],
      );
    }

    // Case E — transaction rollback leaves no partial delete
    await pool.execute(
      `
      INSERT INTO user_materialized_sections
        (user_id, video_id, episode_id, scope_key, section_index, curriculum_version, created_at, updated_at)
      VALUES (?, ?, NULL, ?, 1, 'rollback-test', NOW(3), NOW(3))
      `,
      [FAKE_USER, CORALINE_VIDEO, scopeKey],
    );
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await applyLearningReset(
        { videoId: CORALINE_VIDEO, userId: FAKE_USER },
        conn,
      );
      // Force failure after successful deletes inside the same transaction.
      await conn.execute(`SELECT * FROM __reset_learning_force_fail__`);
      await conn.commit();
      assert.fail("expected forced failure");
    } catch (error) {
      await conn.rollback();
      assert.match(
        error instanceof Error ? error.message : String(error),
        /__reset_learning_force_fail__|doesn't exist|ER_NO_SUCH_TABLE/i,
      );
    } finally {
      conn.release();
    }

    const [rolled] = await pool.execute<RowDataPacket[]>(
      `
      SELECT COUNT(*) AS c FROM user_materialized_sections
      WHERE user_id = ? AND video_id = ? AND curriculum_version = 'rollback-test'
      `,
      [FAKE_USER, CORALINE_VIDEO],
    );
    assert.equal(
      Number(rolled[0]?.c ?? 0),
      1,
      "rollback must restore hollow header",
    );

    // cleanup A
    await pool.execute(
      `DELETE FROM user_materialized_sections WHERE user_id = ?`,
      [FAKE_USER],
    );
    await pool.execute(
      `DELETE FROM user_learning_resume WHERE user_id = ?`,
      [FAKE_USER],
    );

    console.log("resetLearningState: ok", {
      coralineParts: partCount,
      previewMaterialized: preview.willDeleteUserMaterializedSections,
      hollow: preview.hollowMaterializedSections,
    });
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? String((error as { code?: string }).code)
        : "";
    if (
      code === "ECONNREFUSED" ||
      code === "ENOTFOUND" ||
      code === "ETIMEDOUT"
    ) {
      console.log(
        `resetLearningState: ok (skipped live DB — ${code} MySQL unavailable)`,
      );
      return;
    }
    throw error;
  } finally {
    await closeContentSyncPool().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
