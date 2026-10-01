import { requireLearningUser } from "@/lib/auth/requireLearningAccess";
import {
  attachFlashcardContext,
  getPersonalFlashcardById,
  insertFlashcardEvent,
  listContextsForFlashcard,
  personalFlashcardToJson,
} from "@/lib/db/queries/personalFlashcards";
import { fetchPartVocabularyContext } from "@/lib/db/queries/videos";
import { NextResponse } from "next/server";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, ctx: Ctx) {
  try {
    const auth = await requireLearningUser();
    if (!auth.ok) return auth.response;
    const { id } = await ctx.params;

    const card = await getPersonalFlashcardById(auth.user.id, id);
    if (!card) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    const body = (await req.json()) as Record<string, unknown>;
    const partId = typeof body.partId === "string" ? body.partId.trim() : "";
    if (!partId) {
      return NextResponse.json({ error: "partId_required" }, { status: 400 });
    }

    const partCtx = await fetchPartVocabularyContext(partId);
    if (!partCtx) {
      return NextResponse.json({ error: "clip_not_found" }, { status: 404 });
    }

    const translation =
      partCtx.translations.find((t) => t.language === "fa")?.text ??
      partCtx.translations[0]?.text ??
      null;
    const preview =
      partCtx.episode?.coverUrl ??
      partCtx.episode?.season.coverUrl ??
      partCtx.episode?.season.video.coverUrl ??
      partCtx.directVideo?.coverUrl ??
      null;

    await attachFlashcardContext({
      userId: auth.user.id,
      flashcardId: id,
      partId: partCtx.part.id,
      sentenceSnapshot:
        (typeof body.sentence === "string" && body.sentence.trim()) ||
        partCtx.part.text?.trim() ||
        card.exampleSentence,
      translationSnapshot:
        (typeof body.translation === "string" && body.translation.trim()) ||
        translation,
      previewImageUrl: preview,
    });

    await insertFlashcardEvent({
      userId: auth.user.id,
      flashcardId: id,
      eventType: "context_attached",
      partId: partCtx.part.id,
    });

    const contexts = await listContextsForFlashcard(id);
    const refreshed = await getPersonalFlashcardById(auth.user.id, id);
    return NextResponse.json({
      success: true,
      card: refreshed ? personalFlashcardToJson(refreshed) : null,
      contexts: contexts.map((c) => ({
        id: c.id,
        partId: c.partId,
        sentenceSnapshot: c.sentenceSnapshot,
        translationSnapshot: c.translationSnapshot,
        previewImageUrl: c.previewImageUrl,
        movieTitle: c.movieTitle ?? null,
        episodeTitle: c.episodeTitle ?? null,
        seasonNum: c.seasonNum ?? null,
        episodeNum: c.episodeNum ?? null,
      })),
    });
  } catch (err) {
    console.error("[flashcards] attach context error", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
