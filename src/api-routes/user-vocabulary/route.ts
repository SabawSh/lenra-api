import { syncUserAchievements } from "@/lib/achievements/engine";
import { requireLearningUser } from "@/lib/auth/requireLearningAccess";
import { pool } from "@/lib/db/connection";
import {
  upsertUserVocabularyEntry,
  userVocabularyToJson,
} from "@/lib/db/queries/userVocabulary";
import { savedCardToJson } from "@/lib/db/queries/savedVocabularyCards";
import {
  resolveContextualCardWords,
  shouldWriteContextualSavedCard,
  upsertContextualSavedCardForClip,
} from "@/lib/learning/vocabularySaveBridge";
import type { RowDataPacket } from "mysql2/promise";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const auth = await requireLearningUser();
    if (!auth.ok) return auth.response;
    const user = auth.user;

    const body = (await req.json()) as Record<string, unknown>;
    const dictionaryEntryId =
      typeof body?.dictionaryEntryId === "string"
        ? body.dictionaryEntryId.trim()
        : "";

    if (!dictionaryEntryId) {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    }

    const clipIdRaw =
      typeof body?.clipId === "string"
        ? body.clipId.trim()
        : typeof body?.clipId === "number"
          ? String(body.clipId)
          : "";
    const clipId = shouldWriteContextualSavedCard(clipIdRaw)
      ? clipIdRaw
      : null;

    const wordHint =
      typeof body?.word === "string"
        ? body.word
        : typeof body?.lemma === "string"
          ? body.lemma
          : null;
    const sentenceHint =
      typeof body?.sentence === "string" ? body.sentence : null;

    const [rows] = await pool.execute<RowDataPacket[]>(
      `
      SELECT id, lemma
      FROM dictionary_entries
      WHERE id = ?
      LIMIT 1
      `,
      [dictionaryEntryId],
    );

    const dictionaryRow = rows[0];
    if (!dictionaryRow) {
      return NextResponse.json(
        { error: "Dictionary entry not found" },
        { status: 404 },
      );
    }

    const { row, created } = await upsertUserVocabularyEntry(
      user.id,
      dictionaryEntryId,
    );

    let contextualCard = null as ReturnType<typeof savedCardToJson> | null;
    if (clipId) {
      const lemma =
        dictionaryRow.lemma != null ? String(dictionaryRow.lemma) : null;
      const words = resolveContextualCardWords({
        word: wordHint,
        lemma,
      });
      if (!words) {
        return NextResponse.json(
          { error: "Invalid word for contextual card" },
          { status: 400 },
        );
      }

      try {
        const card = await upsertContextualSavedCardForClip({
          userId: user.id,
          clipId,
          word: words.word,
          normalizedWord: words.normalizedWord,
          sentence: sentenceHint,
        });
        contextualCard = savedCardToJson(card);
      } catch (err) {
        console.error("Contextual vocabulary bridge failed:", err);
        return NextResponse.json(
          {
            error:
              err instanceof Error && err.message.includes("Clip not found")
                ? "Clip not found"
                : "Failed to save contextual card",
          },
          {
            status:
              err instanceof Error && err.message.includes("Clip not found")
                ? 404
                : 500,
          },
        );
      }
    }

    const achievementSync = created
      ? await syncUserAchievements(user.id)
      : { newlyUnlocked: [], totalXpAwarded: 0 };

    return NextResponse.json({
      success: true,
      created,
      entry: userVocabularyToJson(row),
      contextualCard,
      achievementsUnlocked: achievementSync.newlyUnlocked,
      achievementXpAwarded: achievementSync.totalXpAwarded,
    });
  } catch (err) {
    console.error("User vocabulary save API error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
