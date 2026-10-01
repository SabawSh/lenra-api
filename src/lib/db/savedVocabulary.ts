import { listSavedVocabularyJoinedForUser } from "@/lib/db/queries/savedVocabularyCards";

import type { UserId } from "@/types/schema";
export { bucketSavedVocabulary } from "./savedVocabulary.utils";
export type {
  SavedVocabularyCardSummary,
  SavedVocabularySection,
} from "./savedVocabulary.utils";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export async function getSavedVocabularyForUser(userId: UserId) {
  const rows = await listSavedVocabularyJoinedForUser(userId);

  const now = Date.now();

  return rows.map((row) => {
    const c = row.card;
    const previewImage =
      c.previewImage ??
      row.epCoverUrl ??
      row.seasonCoverUrl ??
      row.seriesVideoCoverUrl ??
      row.directVideoCoverUrl ??
      null;

    const movieTitle =
      row.seriesVideoName ||
      row.directVideoName ||
      c.movieTitle ||
      "Saved scene";

    const due = c.nextReviewAt.getTime() <= now;
    const daysUntilReview = Math.round(
      (c.nextReviewAt.getTime() - now) / ONE_DAY_MS,
    );

    return {
      id: c.id,
      word: c.word,
      sentence: c.sentence,
      translation: c.translation,
      movieTitle,
      episodeTitle: row.episodeTitle,
      episodeNum: row.episodeNum,
      seasonNum: row.seasonNum,
      previewImage: previewImage,
      clipId: c.clipId,
      clipUrl: row.clipUrl,
      clipHlsManifestUrl: row.clipHlsManifestUrl,
      clipDurationMs: row.clipDurationMs,
      subtitleStartMs: c.subtitleStartTime,
      subtitleEndMs: c.subtitleEndTime,
      reviewStrength: c.reviewStrength,
      reviewCount: c.reviewCount,
      nextReviewAt: c.nextReviewAt.toISOString(),
      lastReviewedAt: c.lastReviewedAt?.toISOString() ?? null,
      createdAt: c.createdAt.toISOString(),
      isDue: due,
      daysUntilReview,
    };
  });
}
