import type { ContentRefreshResult } from "@/lib/content-refresh/types";

export type ContentImportMode = "insert" | "replace";

export type EpisodeContentOverview = {
  episodeId: string;
  partCount: number;
  uniqueCanonicalKeys: number;
  duplicateCanonicalKeyGroups: number;
  translationCount: number;
  partsMissingTranslation: number;
  vocabularyOccurrences: number;
  partsWithVocabulary: number;
  grammarOccurrences: number;
  partsWithGrammar: number;
  partsMissingMedia: number;
};

export type EpisodePartSummary = {
  id: string;
  order: number;
  canonicalKey: string | null;
  text: string;
  difficulty: string;
  hasTranslation: boolean;
  vocabularyCount: number;
  grammarCount: number;
  hasMedia: boolean;
};

export type PartLearningDetail = {
  id: string;
  order: number;
  canonicalKey: string | null;
  text: string;
  translation: string | null;
  vocabulary: Array<{
    senseId: string;
    surface: string | null;
    evidenceSpan: string | null;
    confidence: number | null;
    lemma: string | null;
    meaningEn: string | null;
    meaningFa: string | null;
    cefr: string | null;
  }>;
  grammar: Array<{
    grammarId: string;
    displayNameEn: string | null;
    evidenceSpan: string | null;
    confidence: number | null;
    source: string | null;
  }>;
};

export type { ContentRefreshResult };
