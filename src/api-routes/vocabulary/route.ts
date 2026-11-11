import { syncUserAchievements } from "@/lib/achievements/engine";
import { requireLearningUser } from "@/lib/auth/requireLearningAccess";
import { savedCardToJson } from "@/lib/db/queries/savedVocabularyCards";
import {
  resolveContextualCardWords,
  upsertContextualSavedCardForClip,
} from "@/lib/learning/vocabularySaveBridge";
import { NextResponse } from "next/server";

/**
 * Contextual clip-card save (Learning bookmark / legacy clients).
 * Does not write `user_vocabulary` — that remains dictionary-owned via
 * `/api/user-vocabulary`.
 */
export async function POST(req: Request) {
  try {
    const auth = await requireLearningUser();
    if (!auth.ok) return auth.response;
    const user = auth.user;

    const body = (await req.json()) as Record<string, unknown>;
    const clipId =
      typeof body?.clipId === "string"
        ? body.clipId.trim()
        : typeof body?.clipId === "number"
          ? String(body.clipId)
          : "";
    const words = resolveContextualCardWords({
      word: typeof body?.word === "string" ? body.word : null,
    });

    if (!clipId || !words) {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    }

    const sentence =
      typeof body?.sentence === "string" && body.sentence.trim()
        ? body.sentence.trim()
        : null;
    const translation =
      typeof body?.translation === "string" && body.translation.trim()
        ? body.translation.trim()
        : null;

    let card;
    try {
      card = await upsertContextualSavedCardForClip({
        userId: user.id,
        clipId,
        word: words.word,
        normalizedWord: words.normalizedWord,
        sentence,
        translation,
      });
    } catch (err) {
      if (err instanceof Error && err.message.includes("Clip not found")) {
        return NextResponse.json({ error: "Clip not found" }, { status: 404 });
      }
      if (err instanceof Error && err.message.includes("Missing sentence")) {
        return NextResponse.json({ error: "Missing sentence" }, { status: 400 });
      }
      throw err;
    }

    const achievementSync = await syncUserAchievements(user.id);

    return NextResponse.json({
      success: true,
      card: savedCardToJson(card),
      achievementsUnlocked: achievementSync.newlyUnlocked,
      achievementXpAwarded: achievementSync.totalXpAwarded,
    });
  } catch (err) {
    console.error("Vocabulary save API error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
