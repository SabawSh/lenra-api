export type SavedVocabularyCardDto = {
  id: number;
  word: string;
  normalizedWord: string;
  sentence: string;
  translation: string | null;
  clipId: string;
  episodeId: string | null;
  seasonId: string | null;
  movieTitle: string;
  subtitleStartTime: number | null;
  subtitleEndTime: number | null;
  previewImage: string | null;
  reviewStrength: number;
  nextReviewAt: string;
  lastReviewedAt: string | null;
  reviewCount: number;
  createdAt: string;
  updatedAt: string;
};

export type SaveContextualVocabularyInput = {
  word: string;
  sentence: string;
  translation?: string;
  clipId: string;
};

export type VocabularyReviewOutcome = "got-it" | "almost" | "need-practice";

async function readErrorReason(res: Response): Promise<string> {
  try {
    const text = await res.text();
    if (!text) return `HTTP ${res.status}`;
    try {
      const parsed = JSON.parse(text) as { error?: string };
      return parsed.error ? `${parsed.error} (HTTP ${res.status})` : text;
    } catch {
      return text;
    }
  } catch {
    return `HTTP ${res.status}`;
  }
}

export async function saveContextualVocabularyCard(
  input: SaveContextualVocabularyInput,
) {
  const res = await fetch("/api/vocabulary", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  if (!res.ok) {
    const reason = await readErrorReason(res);
    throw new Error(`Failed to save contextual vocabulary card: ${reason}`);
  }

  return (await res.json()) as {
    success: true;
    card: SavedVocabularyCardDto;
  };
}

export async function reviewContextualVocabularyCard(
  cardId: number,
  outcome: VocabularyReviewOutcome,
) {
  const res = await fetch(`/api/vocabulary/${cardId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ outcome }),
  });

  if (!res.ok) {
    const reason = await readErrorReason(res);
    throw new Error(`Failed to update contextual vocabulary review: ${reason}`);
  }

  return (await res.json()) as {
    success: true;
    card: SavedVocabularyCardDto;
  };
}

export async function removeContextualVocabularyCard(cardId: number) {
  const res = await fetch(`/api/vocabulary/${cardId}`, {
    method: "DELETE",
  });

  if (!res.ok) {
    const reason = await readErrorReason(res);
    throw new Error(`Failed to remove contextual vocabulary card: ${reason}`);
  }

  return (await res.json()) as { success: true };
}
