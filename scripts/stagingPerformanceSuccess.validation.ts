/**
 * Staging API integration: success semantics for POST /api/performance.
 *
 *   npx tsx scripts/stagingPerformanceSuccess.validation.ts
 */
import { config } from "dotenv";
import { resolve } from "node:path";

config({ path: resolve(process.cwd(), ".env") });

const { pool } = await import("../src/lib/db/connection.ts");
const { calculatePerformance } = await import(
  "../src/lib/performance/calculatePerformance.ts"
);
const { createSessionToken } = await import("../src/lib/auth/session.ts");

const PART_ID = "37e31b2d-95e2-4e0f-81cc-8574f68c1350";
const VIDEO_ID = "b8cfd2b0-413f-478f-a153-45d02dd08cbf";
const API = process.env.STAGING_API_URL ?? "http://127.0.0.1:4000";
/** Known onboarded staging user with phone auth. */
const USER_ID = "744d56da-5bb0-411f-b0bb-2cb2359748a6";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

async function prepareUser(): Promise<string> {
  // Ensure a non-expired subscription so requireLearningUser passes.
  await pool.execute(
    `INSERT INTO user_subscriptions (
       id, user_id, plan_code, status, current_period_start, current_period_end, created_at, updated_at
     )
     SELECT ?, ?, 'pro', 'active', NOW(3), DATE_ADD(NOW(3), INTERVAL 30 DAY), NOW(3), NOW(3)
     FROM DUAL
     WHERE NOT EXISTS (
       SELECT 1 FROM user_subscriptions
       WHERE user_id = ? AND status = 'active' AND current_period_end > NOW(3)
     )`,
    [
      "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff",
      USER_ID,
      USER_ID,
    ],
  ).catch(async () => {
    // Schema variants — try minimal columns
    await pool.execute(
      `UPDATE users SET onboarding_completed_at = COALESCE(onboarding_completed_at, NOW(3)) WHERE id = ?`,
      [USER_ID],
    );
  });

  await pool.execute(`DELETE FROM user_part_progress WHERE user_id = ? AND part_id = ?`, [
    USER_ID,
    PART_ID,
  ]);
  await pool.execute(
    `DELETE FROM analytics_events WHERE user_id = ? AND event_name IN (
      'exercise_attempt','lesson_complete','first_lesson_completed',
      'sentence_rebuild_completed','sentence_rebuild_failed','xp_earned','speaking_completed','speaking_failed'
    )`,
    [USER_ID],
  );

  return createSessionToken({ userId: USER_ID });
}

async function postPerformance(token: string, raw: Record<string, unknown>) {
  const res = await fetch(`${API}/api/performance`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: `lenra_session=${token}`,
    },
    body: JSON.stringify({
      partId: PART_ID,
      videoId: VIDEO_ID,
      raw,
    }),
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

async function countEvents(name: string) {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS c FROM analytics_events WHERE user_id = ? AND event_name = ?`,
    [USER_ID, name],
  );
  return Number((rows as Array<{ c: number }>)[0]?.c ?? 0);
}

async function progressRow() {
  const [rows] = await pool.query(
    `SELECT best_score, accuracy, completed_at IS NOT NULL AS completed
     FROM user_part_progress WHERE user_id = ? AND part_id = ?`,
    [USER_ID, PART_ID],
  );
  return (rows as Array<Record<string, unknown>>)[0] ?? null;
}

const now = Date.now();
const token = await prepareUser();
const report: string[] = [];

// --- Zero correct words ---
{
  const raw = {
    unitId: PART_ID,
    totalWords: 4,
    correctWords: 0,
    attemptedWords: 4,
    wrongMoves: 0,
    hintsUsed: 0,
    videoDurationMs: 4000,
    inputMode: "drag" as const,
    startedAt: now - 8000,
    finishedAt: now,
    attempts: 1,
  };
  const local = calculatePerformance(raw);
  assert(local.score === 0, `zero-correct local score=${local.score}`);
  const beforeLesson = await countEvents("lesson_complete");
  const beforeFirst = await countEvents("first_lesson_completed");
  const beforeFail = await countEvents("sentence_rebuild_failed");
  const { status, body } = await postPerformance(token, raw);
  assert(status === 200, `zero HTTP ${status} ${JSON.stringify(body)}`);
  await new Promise((r) => setTimeout(r, 1800));
  const afterLesson = await countEvents("lesson_complete");
  const afterFirst = await countEvents("first_lesson_completed");
  const afterFail = await countEvents("sentence_rebuild_failed");
  const prog = await progressRow();
  assert(afterLesson === beforeLesson, "zero must not emit lesson_complete");
  assert(afterFirst === beforeFirst, "zero must not emit first_lesson_completed");
  assert(afterFail > beforeFail, "zero must emit sentence_rebuild_failed");
  assert(
    !prog || Number(prog.best_score) === 0 || prog.completed === 0 || prog.completed === false,
    `zero must not mark completed progress: ${JSON.stringify(prog)}`,
  );
  report.push(
    `PASS | Zero correct words | score=${local.score} failΔ=${afterFail - beforeFail} progress=${JSON.stringify(prog)}`,
  );
}

// --- Partial correctness (first successful lesson for this cleared user/part) ---
{
  const raw = {
    unitId: PART_ID,
    totalWords: 4,
    correctWords: 1,
    attemptedWords: 4,
    wrongMoves: 1,
    hintsUsed: 0,
    videoDurationMs: 4000,
    inputMode: "drag" as const,
    startedAt: now - 7000,
    finishedAt: now + 10,
    attempts: 1,
  };
  const local = calculatePerformance(raw);
  assert(local.score > 0, `partial local score=${local.score}`);
  const beforeLesson = await countEvents("lesson_complete");
  const beforeFirst = await countEvents("first_lesson_completed");
  const beforeOk = await countEvents("sentence_rebuild_completed");
  const { status, body } = await postPerformance(token, raw);
  assert(status === 200, `partial HTTP ${status} ${JSON.stringify(body)}`);
  await new Promise((r) => setTimeout(r, 1800));
  const afterLesson = await countEvents("lesson_complete");
  const afterFirst = await countEvents("first_lesson_completed");
  const afterOk = await countEvents("sentence_rebuild_completed");
  const prog = await progressRow();
  assert(afterOk > beforeOk, "partial must emit sentence_rebuild_completed");
  assert(afterLesson > beforeLesson, "partial must emit lesson_complete");
  assert(
    Number(prog?.best_score ?? 0) > 0,
    `partial must persist best_score>0: ${JSON.stringify(prog)}`,
  );
  report.push(
    `PASS | Partial correctness | score=${local.score} lessonΔ=${afterLesson - beforeLesson} firstΔ=${afterFirst - beforeFirst} progress=${JSON.stringify(prog)}`,
  );
}

// --- Repeated submission (idempotent milestones) ---
{
  const raw = {
    unitId: PART_ID,
    totalWords: 4,
    correctWords: 4,
    attemptedWords: 4,
    wrongMoves: 0,
    hintsUsed: 0,
    videoDurationMs: 4000,
    inputMode: "drag" as const,
    startedAt: now - 6000,
    finishedAt: now + 40,
    attempts: 1,
  };
  const beforeLesson = await countEvents("lesson_complete");
  const beforeFirst = await countEvents("first_lesson_completed");
  const r1 = await postPerformance(token, raw);
  assert(r1.status === 200, `retry1 ${r1.status}`);
  await new Promise((r) => setTimeout(r, 1500));
  const midLesson = await countEvents("lesson_complete");
  const midFirst = await countEvents("first_lesson_completed");
  const r2 = await postPerformance(token, { ...raw, finishedAt: now + 90 });
  assert(r2.status === 200, `retry2 ${r2.status}`);
  await new Promise((r) => setTimeout(r, 1500));
  const afterLesson = await countEvents("lesson_complete");
  const afterFirst = await countEvents("first_lesson_completed");
  assert(
    afterLesson === midLesson,
    `retry must not duplicate lesson_complete (${midLesson}→${afterLesson}); before=${beforeLesson}`,
  );
  assert(
    afterFirst === midFirst,
    `retry must not duplicate first_lesson_completed (${midFirst}→${afterFirst}); before=${beforeFirst}`,
  );
  report.push(
    `PASS | Repeated submission | lesson=${beforeLesson}/${midLesson}/${afterLesson} first=${beforeFirst}/${midFirst}/${afterFirst}`,
  );
}

for (const line of report) console.log(line);
console.log("stagingPerformanceSuccess.validation: PASS");
await pool.end();
process.exit(0);
