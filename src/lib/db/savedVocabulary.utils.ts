export type SavedVocabularySection =
  | "continueReviewing"
  | "recentlySaved"
  | "strongMemories"
  | "needsPractice";

export type SavedVocabularyCardSummary = {
  id: number;
  word: string;
  sentence: string;
  translation: string | null;
  movieTitle: string;
  episodeTitle: string | null;
  episodeNum: number | null;
  seasonNum: number | null;
  previewImage: string | null;
  clipUrl: string;
  clipHlsManifestUrl: string | null;
  clipDurationMs: number;
  subtitleStartMs: number | null;
  subtitleEndMs: number | null;
  reviewStrength: number;
  reviewCount: number;
  nextReviewAt: string;
  lastReviewedAt: string | null;
  createdAt: string;
  isDue: boolean;
  daysUntilReview: number;
};

function isStrongMemory(card: SavedVocabularyCardSummary): boolean {
  return card.reviewStrength >= 3;
}

export function bucketSavedVocabulary(
  cards: SavedVocabularyCardSummary[],
): Record<SavedVocabularySection, SavedVocabularyCardSummary[]> {
  const buckets: Record<SavedVocabularySection, SavedVocabularyCardSummary[]> =
    {
      continueReviewing: [],
      recentlySaved: [],
      strongMemories: [],
      needsPractice: [],
    };

  const assigned = new Set<number>();

  const assign = (
    section: SavedVocabularySection,
    list: SavedVocabularyCardSummary[],
  ) => {
    for (const card of list) {
      if (assigned.has(card.id)) continue;
      buckets[section].push(card);
      assigned.add(card.id);
    }
  };

  assign(
    "continueReviewing",
    cards
      .filter((c) => c.isDue)
      .sort((a, b) => a.daysUntilReview - b.daysUntilReview),
  );

  assign(
    "strongMemories",
    cards
      .filter((c) => isStrongMemory(c))
      .sort(
        (a, b) =>
          b.reviewStrength - a.reviewStrength ||
          b.reviewCount - a.reviewCount,
      ),
  );

  assign(
    "needsPractice",
    cards
      .filter((c) => c.reviewStrength <= 1)
      .sort((a, b) => a.daysUntilReview - b.daysUntilReview),
  );

  assign(
    "recentlySaved",
    [...cards]
      .filter((c) => !isStrongMemory(c))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 12),
  );

  assign(
    "recentlySaved",
    [...cards]
      .filter((c) => !assigned.has(c.id) && !isStrongMemory(c))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  );

  return buckets;
}
