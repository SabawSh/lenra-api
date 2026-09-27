import { syncUserAchievements } from "@/lib/achievements/engine";
import { requireLearningUser } from "@/lib/auth/requireLearningAccess";
import { fetchPartVocabularyContext } from "@/lib/db/queries/videos";
import {
  deleteSavedVocabularyCardsForUserClip,
  listSavedCardIdByClipForUserParts,
  savedCardToJson,
  upsertSavedVocabularyCard,
} from "@/lib/db/queries/savedVocabularyCards";
import { NextResponse } from "next/server";

function initialNextReviewAt() {
  const next = new Date();
  next.setDate(next.getDate() + 1);
  return next;
}

/** Card-level save: persist the learning clip as a saved vocabulary card. */
function cardWordFromSentence(sentence: string): string {
  const token =
    sentence
      .normalize("NFKC")
      .match(/[\p{L}\p{N}']+/u)?.[0]
      ?.trim() ?? "";
  return token || "card";
}

/**
 * POST { clipId } — save the learning card for this clip.
 * DELETE { clipId } — remove saved cards for this clip.
 */
export async function POST(req: Request) {
  try {
    const auth = await requireLearningUser();
    if (!auth.ok) return auth.response;
    const user = auth.user;

    const body = (await req.json()) as { clipId?: unknown };
    const clipId =
      typeof body?.clipId === "string"
        ? body.clipId.trim()
        : typeof body?.clipId === "number"
          ? String(body.clipId)
          : "";
    if (!clipId) {
      return NextResponse.json({ error: "Invalid clipId" }, { status: 400 });
    }

    const ctx = await fetchPartVocabularyContext(clipId);
    if (!ctx) {
      return NextResponse.json({ error: "Clip not found" }, { status: 404 });
    }

    const { part, translations, directVideo, episode } = ctx;
    const sentence = part.text?.trim();
    if (!sentence) {
      return NextResponse.json({ error: "Missing sentence" }, { status: 400 });
    }

    const word = cardWordFromSentence(sentence);
    const normalizedWord = word.toLowerCase();
    const translation = translations[0]?.text ?? null;
    const previewImage =
      episode?.coverUrl ??
      episode?.season.coverUrl ??
      directVideo?.coverUrl ??
      episode?.season?.video.coverUrl ??
      null;

    const card = await upsertSavedVocabularyCard({
      userId: user.id,
      word,
      normalizedWord,
      sentence,
      translation,
      clipId: part.id,
      episodeId: part.episodeId,
      seasonId: episode?.seasonId ?? null,
      subtitleStartTime: part.speechStartMs ?? null,
      subtitleEndTime: part.speechEndMs ?? null,
      previewImage,
      nextReviewAtOnInsert: initialNextReviewAt(),
    });

    const achievementSync = await syncUserAchievements(user.id);

    return NextResponse.json({
      success: true,
      saved: true,
      card: savedCardToJson(card),
      achievementsUnlocked: achievementSync.newlyUnlocked,
      achievementXpAwarded: achievementSync.totalXpAwarded,
    });
  } catch (err) {
    console.error("Learning card save API error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

export async function DELETE(req: Request) {
  try {
    const auth = await requireLearningUser();
    if (!auth.ok) return auth.response;
    const user = auth.user;

    const body = (await req.json()) as { clipId?: unknown };
    const clipId =
      typeof body?.clipId === "string"
        ? body.clipId.trim()
        : typeof body?.clipId === "number"
          ? String(body.clipId)
          : "";
    if (!clipId) {
      return NextResponse.json({ error: "Invalid clipId" }, { status: 400 });
    }

    const existing = await listSavedCardIdByClipForUserParts(user.id, [clipId]);
    if (!existing.has(clipId)) {
      return NextResponse.json({ success: true, saved: false });
    }

    await deleteSavedVocabularyCardsForUserClip(user.id, clipId);
    return NextResponse.json({ success: true, saved: false });
  } catch (err) {
    console.error("Learning card unsave API error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
