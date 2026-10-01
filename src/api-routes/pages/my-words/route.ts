import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/getCurrentUser";
import { getSavedVocabularyForUser } from "@/lib/db/savedVocabulary";
import {
  listNormalizedWordsInFlashcards,
  listPersonalFlashcardsForUser,
  personalFlashcardToJson,
} from "@/lib/db/queries/personalFlashcards";
import { normalizeSavedVocabularyWord } from "@/lib/learning/vocabularySaveBridgeLogic";

export const runtime = "nodejs";

/**
 * Bundle for /my-words SSR: personal flashcards + From Movies cards.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({
      flashcards: [],
      fromMovies: [],
    });
  }

  const [flashcards, movieCards] = await Promise.all([
    listPersonalFlashcardsForUser(user.id),
    getSavedVocabularyForUser(user.id),
  ]);

  const norms = movieCards.map((c) =>
    normalizeSavedVocabularyWord(c.word),
  );
  const inFlashcards = await listNormalizedWordsInFlashcards(
    user.id,
    norms.filter(Boolean),
  );

  return NextResponse.json({
    flashcards: flashcards.map(personalFlashcardToJson),
    fromMovies: movieCards.map((c) => ({
      ...c,
      normalizedWord: normalizeSavedVocabularyWord(c.word),
      inFlashcards: inFlashcards.has(normalizeSavedVocabularyWord(c.word)),
    })),
  });
}
