/**
 * Bridge: dictionary ownership (`user_vocabulary`) + optional contextual card
 * (`saved_vocabulary_cards`) when save happens inside a Clip.
 */
import { fetchPartVocabularyContext } from "@/lib/db/queries/videos";
import {
  upsertSavedVocabularyCard,
  type SavedVocabularyCardCamel,
} from "@/lib/db/queries/savedVocabularyCards";
import type { UserId } from "@/types/schema";

export {
  normalizeSavedVocabularyWord,
  resolveContextualCardWords,
  shouldWriteContextualSavedCard,
} from "./vocabularySaveBridgeLogic";

function initialNextReviewAt(): Date {
  const next = new Date();
  next.setDate(next.getDate() + 1);
  return next;
}

/**
 * Upsert `saved_vocabulary_cards` for a Clip-scoped vocabulary save.
 * Idempotent on (user_id, clip_id, normalized_word).
 */
export async function upsertContextualSavedCardForClip(params: {
  userId: UserId;
  clipId: string;
  word: string;
  normalizedWord: string;
  sentence?: string | null;
  translation?: string | null;
}): Promise<SavedVocabularyCardCamel> {
  const ctx = await fetchPartVocabularyContext(params.clipId.trim());
  if (!ctx) {
    throw new Error("Clip not found for contextual vocabulary save");
  }

  const { part, translations, directVideo, episode } = ctx;
  const sentence =
    (typeof params.sentence === "string" && params.sentence.trim()) ||
    part.text?.trim() ||
    "";
  if (!sentence) {
    throw new Error("Missing sentence for contextual vocabulary save");
  }

  const translation =
    (typeof params.translation === "string" && params.translation.trim()) ||
    translations[0]?.text ||
    null;
  const previewImage =
    episode?.coverUrl ??
    episode?.season.coverUrl ??
    directVideo?.coverUrl ??
    episode?.season?.video.coverUrl ??
    null;

  return upsertSavedVocabularyCard({
    userId: params.userId,
    word: params.word,
    normalizedWord: params.normalizedWord,
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
}
