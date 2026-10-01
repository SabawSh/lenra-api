import { requireLearningUser } from "@/lib/auth/requireLearningAccess";
import {
  attachFlashcardContext,
  getPersonalFlashcardById,
  insertFlashcardEvent,
  listPersonalFlashcardsForUser,
  personalFlashcardToJson,
  upsertPersonalFlashcard,
  type PersonalFlashcardSource,
} from "@/lib/db/queries/personalFlashcards";
import { upsertUserVocabularyEntry } from "@/lib/db/queries/userVocabulary";
import { fetchPartVocabularyContext } from "@/lib/db/queries/videos";
import { NextResponse } from "next/server";

export async function GET(req: Request) {
  try {
    const auth = await requireLearningUser();
    if (!auth.ok) return auth.response;

    const url = new URL(req.url);
    const q = url.searchParams.get("q");
    const cards = await listPersonalFlashcardsForUser(auth.user.id, q);
    return NextResponse.json({
      cards: cards.map(personalFlashcardToJson),
    });
  } catch (err) {
    console.error("[flashcards] GET list error", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  try {
    const auth = await requireLearningUser();
    if (!auth.ok) return auth.response;

    const body = (await req.json()) as Record<string, unknown>;
    const word = typeof body.word === "string" ? body.word.trim() : "";
    const meaning = typeof body.meaning === "string" ? body.meaning.trim() : "";
    const exampleSentence =
      typeof body.exampleSentence === "string"
        ? body.exampleSentence.trim()
        : "";

    if (!word) {
      return NextResponse.json({ error: "word_required" }, { status: 400 });
    }

    const source =
      typeof body.source === "string"
        ? (body.source as PersonalFlashcardSource)
        : "manual";

    const { card, created } = await upsertPersonalFlashcard({
      userId: auth.user.id,
      word,
      meaning: meaning || "—",
      exampleSentence: exampleSentence || word,
      translation:
        typeof body.translation === "string" ? body.translation : null,
      pronunciationIpa:
        typeof body.pronunciationIpa === "string"
          ? body.pronunciationIpa
          : null,
      dictionaryEntryId:
        typeof body.dictionaryEntryId === "string"
          ? body.dictionaryEntryId
          : null,
      dictionarySenseId:
        typeof body.dictionarySenseId === "string"
          ? body.dictionarySenseId
          : null,
      notes: typeof body.notes === "string" ? body.notes : null,
      source,
      status: "saved",
    });

    await insertFlashcardEvent({
      userId: auth.user.id,
      flashcardId: card.id,
      eventType: created ? "created" : "updated",
    });

    if (card.dictionaryEntryId) {
      try {
        await upsertUserVocabularyEntry(auth.user.id, card.dictionaryEntryId);
      } catch (err) {
        console.warn("[flashcards] user_vocabulary upsert skipped", err);
      }
    }

    const partIds = Array.isArray(body.partIds)
      ? body.partIds.filter((id): id is string => typeof id === "string")
      : typeof body.partId === "string"
        ? [body.partId]
        : [];

    for (const partId of partIds) {
      try {
        const ctx = await fetchPartVocabularyContext(partId.trim());
        if (!ctx) continue;
        const translation =
          ctx.translations.find((t) => t.language === "fa")?.text ??
          ctx.translations[0]?.text ??
          null;
        const preview =
          ctx.episode?.coverUrl ??
          ctx.episode?.season.coverUrl ??
          ctx.episode?.season.video.coverUrl ??
          ctx.directVideo?.coverUrl ??
          null;
        await attachFlashcardContext({
          userId: auth.user.id,
          flashcardId: card.id,
          partId: ctx.part.id,
          sentenceSnapshot: ctx.part.text?.trim() || card.exampleSentence,
          translationSnapshot: translation,
          previewImageUrl: preview,
        });
        await insertFlashcardEvent({
          userId: auth.user.id,
          flashcardId: card.id,
          eventType: "context_attached",
          partId: ctx.part.id,
        });
      } catch (err) {
        console.warn("[flashcards] context attach skipped", partId, err);
      }
    }

    const detailed = await getPersonalFlashcardById(auth.user.id, card.id);
    return NextResponse.json({
      success: true,
      created,
      card: personalFlashcardToJson(detailed ?? card),
    });
  } catch (err) {
    console.error("[flashcards] POST error", err);
    if (err instanceof Error && err.message === "invalid_word") {
      return NextResponse.json({ error: "invalid_word" }, { status: 400 });
    }
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
