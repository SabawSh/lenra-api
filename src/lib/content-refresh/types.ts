/** Development full-refresh types — pipeline artifacts → Lenra episode. */

export type TranslationEntry = {
  canonicalKey: string;
  sourceText: string;
  translation: string;
  provider: string | null;
  providerModel: string | null;
  translatedAt: string | null;
};

export type VocabularySenseEntry = {
  senseId: string;
  lemma: string;
  kind: "word" | "phrase";
  partOfSpeech: string | null;
  meaningFa: string;
  meaningEn: string;
  exampleSentence: string | null;
  exampleTranslation: string | null;
  cefr: string | null;
  difficultyScore: number | null;
  reviewStatus: string | null;
};

export type VocabularyOccurrenceItem = {
  senseId: string;
  surface: string | null;
  lemma: string | null;
  kind: string | null;
  evidenceSpan: string | null;
  confidence: number | null;
};

export type VocabularyOccurrenceEntry = {
  canonicalKey: string;
  occurrences: VocabularyOccurrenceItem[];
};

export type GrammarCatalogEntry = {
  id: string;
  displayNameEn: string;
  displayNameFa: string | null;
  category: string | null;
  subcategory: string | null;
  cefrMin: string | null;
  cefrMax: string | null;
  teachingEligible: boolean;
  pedagogicalPriority: number | null;
  explanationEn: string | null;
  explanationFa: string | null;
  payload: Record<string, unknown>;
};

export type GrammarOccurrenceItem = {
  grammarId: string;
  evidenceSpan: string | null;
  confidence: number | null;
  source: string | null;
};

export type GrammarOccurrenceEntry = {
  canonicalKey: string;
  sourceText: string | null;
  occurrences: GrammarOccurrenceItem[];
};

export type ContentRefreshPaths = {
  clips: string;
  learningAnalysis?: string | null;
  translations?: string | null;
  vocabularySenses?: string | null;
  vocabularyOccurrences?: string | null;
  grammarOccurrences?: string | null;
  grammarCatalog?: string | null;
};

/** In-memory pipeline JSON documents (Admin upload / tests). */
export type ContentRefreshArtifactBundle = {
  clips: unknown;
  learningAnalysis?: unknown | null;
  translations?: unknown | null;
  vocabularySenses?: unknown | null;
  vocabularyOccurrences?: unknown | null;
  grammarOccurrences?: unknown | null;
  grammarCatalog?: unknown | null;
};

export type ContentRefreshParams = {
  episodeId: string;
  /** Filesystem paths (CLI). Provide paths or artifacts. */
  paths?: ContentRefreshPaths | null;
  /** Parsed JSON documents (Admin). Provide paths or artifacts. */
  artifacts?: ContentRefreshArtifactBundle | null;
  reset: boolean;
  dryRun?: boolean;
  /**
   * When false and episode already has parts, refuse to write unless reset.
   * Default true for CLI safety; Admin "new content" mode uses reset:false.
   */
  allowEmptyOnly?: boolean;
};

export type ContentRefreshCounts = {
  pipelineClips: number;
  uniqueCanonicalKeys: number;
  duplicateCanonicalKeyGroups: number;
  partsDeleted: number;
  partsInserted: number;
  translationsImported: number;
  translationsSkippedMissingKey: number;
  vocabularySensesUpserted: number;
  vocabularyOccurrencesImported: number;
  vocabularyAssignmentsFromLearningAnalysis: number;
  vocabularyAssignmentsFromOccurrencesFile: number;
  grammarConceptsUpserted: number;
  grammarOccurrencesImported: number;
  grammarStubConceptsCreated: number;
  dictionaryCoverageWordTokenInstances: number;
  dictionaryCoverageEligibleLemmas: number;
  dictionaryCoverageAlreadyCovered: number;
  dictionaryCoveragePendingEntriesEnsured: number;
  dictionaryCoverageJobsCreated: number;
  dictionaryCoverageDuplicateJobsAvoided: number;
};

export type ContentRefreshValidation = {
  episodeId: string;
  pipelineClipCount: number;
  databasePartCount: number;
  uniqueCanonicalKeys: number;
  duplicateCanonicalKeyGroups: number;
  translationCount: number;
  partsMissingTranslation: number;
  vocabularySensesInDb: number;
  vocabularyOccurrencesInDb: number;
  partsMissingVocabulary: number;
  grammarConceptsInDb: number;
  grammarOccurrencesInDb: number;
  partsMissingGrammar: number;
  partsMissingMedia: number;
  notes: string[];
};

export type ContentRefreshDeletePreview = {
  willDeleteParts: number;
  willDeleteUserPartProgress: number;
  willDeleteUserTokenMarks: number;
  willDeleteSavedVocabularyCards: number;
  willDeleteCaptionTranslations: number;
  willDeleteUserReminders: number;
  willDeletePartDictionaryEntries: number;
  willDeletePartGrammarOccurrences: number;
  willDeletePartVocabularyOccurrences: number;
  willDeleteUserMaterializedSectionAtomicParts: number;
  willDeleteUserMaterializedSectionLearningUnitParts: number;
  willDeleteUserMaterializedSectionProgressionUnitParts: number;
  willClearLearningBugReportPartIds: number;
};

export type ContentRefreshResult = {
  dryRun: boolean;
  reset: boolean;
  /** True when replace used progress-preserving sync (not hard wipe). */
  progressPreservingReplace: boolean;
  counts: ContentRefreshCounts;
  validation: ContentRefreshValidation | null;
  notes?: string[];
  preview: ContentRefreshDeletePreview & {
    willInsertParts: number;
    translationEntries: number;
    vocabularySenseEntries: number;
    vocabularyOccurrenceEntriesForClips: number;
    grammarCatalogEntries: number;
    /**
     * Clip-matched grammar-occurrences.json *entries* (one per canonicalKey),
     * including rows with empty `occurrences: []`. Not learner-facing detections.
     */
    grammarOccurrenceEntries: number;
    /** Clip-matched entries that contain ≥1 nested occurrence item. */
    grammarOccurrenceEntriesNonEmpty: number;
    /** Nested occurrence items in the full uploaded artifact (source baseline). */
    grammarOccurrenceSourceItems: number;
    /** Nested items on clip-matched keys (before fan-out). */
    grammarOccurrenceItemsForClips: number;
    /**
     * Estimated `part_grammar_occurrences` rows after teachingEligible filter
     * and canonical-key fan-out to duplicate parts.
     */
    grammarOccurrencesWouldImport: number;
    /** Nested items skipped as catalog teachingEligible=false. */
    grammarOccurrencesSkippedIneligible: number;
    /** Progress-preserving replace accounting */
    existingPartsPreserved: number;
    newPartsCreated: number;
    partsSoftRetired: number;
    partsHardDeleted: number;
    learnerProgressRowsPreserved: number;
    learnerProgressRowsRemapped: number;
    learnerProgressRowsRequiringExplicitPolicy: number;
    learnerProgressRowsOnSoftRetiredParts: number;
    translationsUpdated: number;
    grammarRowsRebuilt: number;
    vocabularyRowsRebuilt: number;
    potentialLearnerStateLoss: number;
    wouldApplyBeSafe: boolean;
    safetyBlockers: string[];
  };
};
