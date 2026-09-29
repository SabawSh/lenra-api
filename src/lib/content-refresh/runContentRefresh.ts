import { existsSync } from "fs";
import {
  applyContentSyncPlanOnConnection,
  listPartsForContentSync,
} from "../content-sync/applyContentSyncPlan";
import {
  loadPipelineClipsFromFile,
  parsePipelineClipsDocument,
} from "../content-sync/loadPipelineClips";
import { getContentSyncPool } from "../content-sync/syncDb";
import type { PipelineClip } from "../content-sync/types";
import { deleteMaterializedSectionsForEpisode } from "@/lib/dev/resetLearningState";
import { insertPartsFromClips } from "./importClips";
import {
  importGrammarOccurrencesForEpisode,
  summarizeGrammarOccurrenceImportPreview,
  upsertGrammarConcepts,
} from "./importGrammar";
import { importTranslationsForEpisode } from "./importTranslations";
import {
  importVocabularyOccurrencesForEpisode,
  upsertVocabularySenses,
} from "./importVocabulary";
import {
  loadGrammarCatalogFile,
  loadGrammarOccurrencesFile,
  loadLearningAnalysisVocabulary,
  loadTranslationsFile,
  loadVocabularyOccurrencesFile,
  loadVocabularySensesFile,
  mergeVocabularyOccurrences,
  parseGrammarCatalogDocument,
  parseGrammarOccurrencesDocument,
  parseLearningAnalysisVocabulary,
  parseTranslationsDocument,
  parseVocabularyOccurrencesDocument,
  parseVocabularySensesDocument,
} from "./loadArtifacts";
import {
  assertEpisodeExists,
  countPartsForEpisode,
  type EpisodeResetImpact,
} from "./resetEpisodeParts";
import {
  assertPreservedPartIds,
  buildSafeReplacePreview,
  deleteContentAttachmentsForActiveParts,
  planSafeContentReplace,
  type SafeReplacePreview,
} from "./safeContentReplace";
import type {
  ContentRefreshArtifactBundle,
  ContentRefreshParams,
  ContentRefreshPaths,
  ContentRefreshResult,
  GrammarCatalogEntry,
  GrammarOccurrenceEntry,
  TranslationEntry,
  VocabularyOccurrenceEntry,
  VocabularySenseEntry,
} from "./types";
import { buildContentRefreshValidation } from "./validateRefresh";
import { ContentImportRunTimer } from "@/lib/admin/contentImportDebug";
import { buildClipDictionaryLemmaInventory } from "@/lib/dictionary/buildClipDictionaryLemmaInventory";
import { ensureDictionaryCoverageForLemmas } from "@/lib/dictionary/ensureDictionaryCoverage";

function requireFile(path: string, label: string): void {
  if (!existsSync(path)) {
    throw new Error(`${label} not found: ${path}`);
  }
}

function countDuplicateGroups(keys: string[]): {
  unique: number;
  duplicateGroups: number;
} {
  const counts = new Map<string, number>();
  for (const key of keys) {
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return {
    unique: counts.size,
    duplicateGroups: [...counts.values()].filter((n) => n > 1).length,
  };
}

function emptyImpact(): EpisodeResetImpact {
  return {
    willDeleteParts: 0,
    willDeleteUserPartProgress: 0,
    willDeleteUserTokenMarks: 0,
    willDeleteSavedVocabularyCards: 0,
    willDeleteCaptionTranslations: 0,
    willDeleteUserReminders: 0,
    willDeletePartDictionaryEntries: 0,
    willDeletePartGrammarOccurrences: 0,
    willDeletePartVocabularyOccurrences: 0,
    willDeleteUserMaterializedSectionAtomicParts: 0,
    willDeleteUserMaterializedSectionLearningUnitParts: 0,
    willDeleteUserMaterializedSectionProgressionUnitParts: 0,
    willClearLearningBugReportPartIds: 0,
  };
}

function emptySafePreview(): SafeReplacePreview {
  const plan = planSafeContentReplace({
    episodeId: "",
    pipelineClips: [],
    existingParts: [],
    dryRun: true,
  });
  return {
    existingPartsPreserved: 0,
    newPartsCreated: 0,
    partsSoftRetired: 0,
    partsHardDeleted: 0,
    learnerProgressRowsPreserved: 0,
    learnerProgressRowsRemapped: 0,
    learnerProgressRowsRequiringExplicitPolicy: 0,
    learnerProgressRowsOnSoftRetiredParts: 0,
    translationsUpdated: 0,
    grammarRowsRebuilt: 0,
    vocabularyRowsRebuilt: 0,
    potentialLearnerStateLoss: 0,
    ambiguousMatchCount: 0,
    wouldApplyBeSafe: true,
    safetyBlockers: [],
    learnerImpact: {
      progressOnPreservedParts: 0,
      tokenMarksOnPreservedParts: 0,
      savedCardsOnPreservedParts: 0,
      remindersOnPreservedParts: 0,
      progressOnRetiredParts: 0,
      tokenMarksOnRetiredParts: 0,
      savedCardsOnRetiredParts: 0,
      remindersOnRetiredParts: 0,
      potentialLearnerStateLoss: 0,
      learnerProgressRowsRequiringExplicitPolicy: 0,
    },
    plan,
  };
}

type LoadedBundle = {
  clips: PipelineClip[];
  translations: TranslationEntry[];
  vocabularySenses: VocabularySenseEntry[];
  learningVocab: VocabularyOccurrenceEntry[];
  fileVocab: VocabularyOccurrenceEntry[];
  grammarCatalog: GrammarCatalogEntry[];
  grammarOccurrences: GrammarOccurrenceEntry[];
};

function loadBundleFromPaths(paths: ContentRefreshPaths): LoadedBundle {
  requireFile(paths.clips, "clips.json");
  return {
    clips: loadPipelineClipsFromFile(paths.clips).clips,
    translations: paths.translations
      ? (requireFile(paths.translations, "translations.json"),
        loadTranslationsFile(paths.translations))
      : [],
    vocabularySenses: paths.vocabularySenses
      ? (requireFile(paths.vocabularySenses, "vocabulary-senses.json"),
        loadVocabularySensesFile(paths.vocabularySenses))
      : [],
    learningVocab: paths.learningAnalysis
      ? (requireFile(paths.learningAnalysis, "learning-analysis.json"),
        loadLearningAnalysisVocabulary(paths.learningAnalysis))
      : [],
    fileVocab: paths.vocabularyOccurrences
      ? (requireFile(
          paths.vocabularyOccurrences,
          "vocabulary-occurrences.json",
        ),
        loadVocabularyOccurrencesFile(paths.vocabularyOccurrences))
      : [],
    grammarCatalog: paths.grammarCatalog
      ? (requireFile(paths.grammarCatalog, "grammar.json"),
        loadGrammarCatalogFile(paths.grammarCatalog))
      : [],
    grammarOccurrences: paths.grammarOccurrences
      ? (requireFile(paths.grammarOccurrences, "grammar-occurrences.json"),
        loadGrammarOccurrencesFile(paths.grammarOccurrences))
      : [],
  };
}

function loadBundleFromArtifacts(
  artifacts: ContentRefreshArtifactBundle,
): LoadedBundle {
  if (artifacts.clips == null) {
    throw new Error("clips.json is required");
  }
  return {
    clips: parsePipelineClipsDocument(artifacts.clips).clips,
    translations:
      artifacts.translations != null
        ? parseTranslationsDocument(artifacts.translations)
        : [],
    vocabularySenses:
      artifacts.vocabularySenses != null
        ? parseVocabularySensesDocument(artifacts.vocabularySenses)
        : [],
    learningVocab:
      artifacts.learningAnalysis != null
        ? parseLearningAnalysisVocabulary(artifacts.learningAnalysis)
        : [],
    fileVocab:
      artifacts.vocabularyOccurrences != null
        ? parseVocabularyOccurrencesDocument(artifacts.vocabularyOccurrences)
        : [],
    grammarCatalog:
      artifacts.grammarCatalog != null
        ? parseGrammarCatalogDocument(artifacts.grammarCatalog)
        : [],
    grammarOccurrences:
      artifacts.grammarOccurrences != null
        ? parseGrammarOccurrencesDocument(artifacts.grammarOccurrences)
        : [],
  };
}

function mergePreview(
  impact: EpisodeResetImpact,
  clipsLength: number,
  translationsLength: number,
  vocabularySensesLength: number,
  vocabForClipsLength: number,
  grammarCatalogLength: number,
  grammarOccPreview: ReturnType<typeof summarizeGrammarOccurrenceImportPreview>,
  safe: SafeReplacePreview,
): ContentRefreshResult["preview"] {
  return {
    ...impact,
    willInsertParts: clipsLength,
    translationEntries: translationsLength,
    vocabularySenseEntries: vocabularySensesLength,
    vocabularyOccurrenceEntriesForClips: vocabForClipsLength,
    grammarCatalogEntries: grammarCatalogLength,
    grammarOccurrenceEntries: grammarOccPreview.grammarOccurrenceEntries,
    grammarOccurrenceEntriesNonEmpty:
      grammarOccPreview.grammarOccurrenceEntriesNonEmpty,
    grammarOccurrenceSourceItems: grammarOccPreview.grammarOccurrenceSourceItems,
    grammarOccurrenceItemsForClips:
      grammarOccPreview.grammarOccurrenceItemsForClips,
    grammarOccurrencesWouldImport:
      grammarOccPreview.grammarOccurrencesWouldImport,
    grammarOccurrencesSkippedIneligible:
      grammarOccPreview.grammarOccurrencesSkippedIneligible,
    existingPartsPreserved: safe.existingPartsPreserved,
    newPartsCreated: safe.newPartsCreated,
    partsSoftRetired: safe.partsSoftRetired,
    partsHardDeleted: safe.partsHardDeleted,
    learnerProgressRowsPreserved: safe.learnerProgressRowsPreserved,
    learnerProgressRowsRemapped: safe.learnerProgressRowsRemapped,
    learnerProgressRowsRequiringExplicitPolicy:
      safe.learnerProgressRowsRequiringExplicitPolicy,
    learnerProgressRowsOnSoftRetiredParts:
      safe.learnerProgressRowsOnSoftRetiredParts,
    translationsUpdated: safe.translationsUpdated,
    grammarRowsRebuilt: safe.grammarRowsRebuilt,
    vocabularyRowsRebuilt: safe.vocabularyRowsRebuilt,
    potentialLearnerStateLoss: safe.potentialLearnerStateLoss,
    wouldApplyBeSafe: safe.wouldApplyBeSafe,
    safetyBlockers: safe.safetyBlockers,
  };
}

/**
 * Shared content refresh/import for CLI and Admin.
 *
 * Replace mode is progress-preserving:
 * - matching canonicalKeys keep the same parts.id
 * - new keys insert new UUIDs
 * - removed keys are soft-retired (learner state kept as historical)
 * - translations / vocab / grammar attachments are rebuilt on active parts
 *
 * Hard wipe via resetEpisodeParts is NOT used by replace.
 */
export async function runContentRefresh(
  params: ContentRefreshParams,
): Promise<ContentRefreshResult> {
  const dryRun = params.dryRun === true;
  const notes: string[] = [];
  const progressPreservingReplace = params.reset === true;

  if (!params.paths?.clips && params.artifacts?.clips == null) {
    throw new Error("Provide clips via paths.clips or artifacts.clips");
  }

  await assertEpisodeExists(params.episodeId);

  const loaded =
    params.artifacts?.clips != null
      ? loadBundleFromArtifacts(params.artifacts)
      : loadBundleFromPaths(params.paths!);

  const {
    clips,
    translations,
    vocabularySenses,
    learningVocab,
    fileVocab,
    grammarCatalog,
    grammarOccurrences,
  } = loaded;

  const clipKeys = clips.map((c) => c.canonicalKey);
  const clipKeySet = new Set(clipKeys);
  const keyStats = countDuplicateGroups(clipKeys);

  const existingPartCount = await countPartsForEpisode(params.episodeId);

  if (!params.reset && existingPartCount > 0 && !dryRun) {
    throw new Error(
      `Episode ${params.episodeId} already has ${existingPartCount} parts. ` +
        `Use replace mode for progress-preserving rebuild.`,
    );
  }

  const mergedVocab = mergeVocabularyOccurrences(learningVocab, fileVocab);
  const vocabForClips = mergedVocab.filter((e) =>
    clipKeySet.has(e.canonicalKey),
  );

  if (
    fileVocab.length > 0 &&
    vocabForClips.filter((e) =>
      fileVocab.some((f) => f.canonicalKey === e.canonicalKey),
    ).length <= 1
  ) {
    notes.push(
      "vocabulary-occurrences.json has few keys overlapping clips; " +
        "only clip-overlapping assignments are imported.",
    );
  }
  if (
    learningVocab.length <= 1 &&
    (params.artifacts?.learningAnalysis != null ||
      params.paths?.learningAnalysis)
  ) {
    notes.push(
      `learning-analysis vocabulary assignments are sparse (${learningVocab.length} unit(s) with items).`,
    );
  }

  if (translations.length > 0) {
    const missing = translations.filter((t) => !clipKeySet.has(t.canonicalKey));
    if (missing.length > 0) {
      throw new Error(
        `translations.json has ${missing.length} canonicalKey(s) not present in clips.json ` +
          `(example: ${missing[0]?.canonicalKey})`,
      );
    }
  }

  const partCountByCanonicalKey = new Map<string, number>();
  for (const clip of clips) {
    partCountByCanonicalKey.set(
      clip.canonicalKey,
      (partCountByCanonicalKey.get(clip.canonicalKey) ?? 0) + 1,
    );
  }
  const grammarOccPreview = summarizeGrammarOccurrenceImportPreview({
    entries: grammarOccurrences,
    catalog: grammarCatalog,
    clipCanonicalKeys: clipKeySet,
    partCountByCanonicalKey,
  });

  const pool = getContentSyncPool();
  let safePreview = emptySafePreview();

  if (progressPreservingReplace && existingPartCount > 0) {
    const existingParts = await listPartsForContentSync(params.episodeId);
    const plan = planSafeContentReplace({
      episodeId: params.episodeId,
      pipelineClips: clips,
      existingParts,
      dryRun: true,
    });
    safePreview = await buildSafeReplacePreview({
      plan,
      db: pool,
      translationEntries: translations.length,
      grammarRowsWouldImport: grammarOccPreview.grammarOccurrencesWouldImport,
      vocabularyRowsWouldImport: vocabForClips.reduce(
        (n, e) => n + e.occurrences.length,
        0,
      ),
    });
    notes.push(
      `Progress-preserving replace: preserve=${safePreview.existingPartsPreserved}, ` +
        `insert=${safePreview.newPartsCreated}, soft-retire=${safePreview.partsSoftRetired}, ` +
        `hard-delete=${safePreview.partsHardDeleted}, ` +
        `progress-preserved=${safePreview.learnerProgressRowsPreserved}, ` +
        `progress-on-retired=${safePreview.learnerProgressRowsOnSoftRetiredParts}, ` +
        `potential-loss=${safePreview.potentialLearnerStateLoss}, ` +
        `wouldApplyBeSafe=${safePreview.wouldApplyBeSafe}`,
    );
    if (safePreview.partsSoftRetired > 0) {
      notes.push(
        `${safePreview.partsSoftRetired} part(s) will be soft-retired (retired_at). ` +
          `Learner state on those parts is preserved as historical and is not hard-deleted.`,
      );
    }
  } else if (progressPreservingReplace && existingPartCount === 0) {
    safePreview = {
      ...emptySafePreview(),
      newPartsCreated: clips.length,
      translationsUpdated: translations.length,
      grammarRowsRebuilt: grammarOccPreview.grammarOccurrencesWouldImport,
      vocabularyRowsRebuilt: vocabForClips.reduce(
        (n, e) => n + e.occurrences.length,
        0,
      ),
      wouldApplyBeSafe: true,
    };
    notes.push(
      "Replace on empty episode: inserting all clips as new parts (no prior progress).",
    );
  } else {
    safePreview = {
      ...emptySafePreview(),
      newPartsCreated: clips.length,
      translationsUpdated: translations.length,
      grammarRowsRebuilt: grammarOccPreview.grammarOccurrencesWouldImport,
      vocabularyRowsRebuilt: vocabForClips.reduce(
        (n, e) => n + e.occurrences.length,
        0,
      ),
      wouldApplyBeSafe: true,
    };
  }

  // Content rebuild impact (active attachments only — not learner progress).
  const impact: EpisodeResetImpact = progressPreservingReplace
    ? {
        ...emptyImpact(),
        willDeleteCaptionTranslations:
          safePreview.translationsUpdated > 0
            ? safePreview.translationsUpdated
            : 0,
        willDeletePartGrammarOccurrences: safePreview.grammarRowsRebuilt,
        willDeletePartVocabularyOccurrences: safePreview.vocabularyRowsRebuilt,
        // No hard delete of parts or learner FK tables.
        willDeleteParts: 0,
        willDeleteUserPartProgress: 0,
        willDeleteUserTokenMarks: 0,
        willDeleteSavedVocabularyCards: 0,
      }
    : emptyImpact();

  const preview = mergePreview(
    impact,
    clips.length,
    translations.length,
    vocabularySenses.length,
    vocabForClips.length,
    grammarCatalog.length,
    grammarOccPreview,
    safePreview,
  );

  if (grammarOccPreview.grammarOccurrenceOrphanGrammarIds.length > 0) {
    notes.push(
      `Grammar orphan ids (would create teaching_eligible=0 stubs): ${grammarOccPreview.grammarOccurrenceOrphanGrammarIds.join(", ")}`,
    );
  }
  notes.push(
    `Grammar counts: source items=${grammarOccPreview.grammarOccurrenceSourceItems}, ` +
      `clip-matched entries=${grammarOccPreview.grammarOccurrenceEntries} ` +
      `(non-empty=${grammarOccPreview.grammarOccurrenceEntriesNonEmpty}), ` +
      `clip-matched items=${grammarOccPreview.grammarOccurrenceItemsForClips}, ` +
      `would import rows=${grammarOccPreview.grammarOccurrencesWouldImport} ` +
      `(skipped ineligible=${grammarOccPreview.grammarOccurrencesSkippedIneligible}). ` +
      `Entry count includes empty occurrence arrays and is not learner-facing.`,
  );

  console.log(
    JSON.stringify(
      {
        episodeId: params.episodeId,
        dryRun,
        reset: params.reset,
        progressPreservingReplace,
        preview,
        keyStats,
        replaceStrategy: progressPreservingReplace
          ? {
              parts: "preserve-by-canonicalKey / insert-new / soft-retire-removed",
              learnerState: "PRESERVE_BY_PART_ID (never hard-deleted)",
              contentAttachments: "DELETE_AND_REBUILD on active parts",
              resumeAndAdaptiveTeacher: "MUST_NOT_BE_DELETED",
            }
          : { mode: "insert-only" },
      },
      null,
      2,
    ),
  );

  if (dryRun) {
    return {
      dryRun: true,
      reset: params.reset,
      progressPreservingReplace,
      counts: {
        pipelineClips: clips.length,
        uniqueCanonicalKeys: keyStats.unique,
        duplicateCanonicalKeyGroups: keyStats.duplicateGroups,
        partsDeleted: 0,
        partsInserted: 0,
        translationsImported: 0,
        translationsSkippedMissingKey: 0,
        vocabularySensesUpserted: 0,
        vocabularyOccurrencesImported: 0,
        vocabularyAssignmentsFromLearningAnalysis: learningVocab.length,
        vocabularyAssignmentsFromOccurrencesFile: fileVocab.filter((e) =>
          clipKeySet.has(e.canonicalKey),
        ).length,
        grammarConceptsUpserted: 0,
        grammarOccurrencesImported: 0,
        grammarStubConceptsCreated: 0,
        dictionaryCoverageWordTokenInstances: 0,
        dictionaryCoverageEligibleLemmas: 0,
        dictionaryCoverageAlreadyCovered: 0,
        dictionaryCoveragePendingEntriesEnsured: 0,
        dictionaryCoverageJobsCreated: 0,
        dictionaryCoverageDuplicateJobsAvoided: 0,
      },
      validation: null,
      notes,
      preview,
    };
  }

  if (progressPreservingReplace && !safePreview.wouldApplyBeSafe) {
    throw new Error(
      `Refusing Apply: progress-preserving replace is not safe. ` +
        `Blockers: ${safePreview.safetyBlockers.join("; ") || "unknown"}. ` +
        `potentialLearnerStateLoss=${safePreview.potentialLearnerStateLoss}`,
    );
  }

  const runTimer = new ContentImportRunTimer(params.episodeId, false);
  const vocabularyOccurrenceRows = vocabForClips.reduce(
    (n, e) => n + e.occurrences.length,
    0,
  );
  runTimer.phase("apply-start", {
    pipelineClips: clips.length,
    translations: translations.length,
    vocabularySenses: vocabularySenses.length,
    vocabularyOccurrenceEntries: vocabForClips.length,
    vocabularyOccurrenceRows,
    grammarCatalogEntries: grammarCatalog.length,
    grammarOccurrenceEntries: grammarOccurrences.length,
    progressPreservingReplace,
    existingPartCount,
  });

  const conn = await pool.getConnection();
  let partsDeleted = 0;
  let partsInserted = 0;
  let translationResult = { imported: 0, skippedMissingKey: 0 };
  let vocabularySensesUpserted = 0;
  let vocabularyOccurrencesImported = 0;
  let grammarConceptsUpserted = 0;
  let grammarOccurrencesImported = 0;
  let grammarStubConceptsCreated = 0;
  let dictionaryCoverageWordTokenInstances = 0;
  let dictionaryCoverageEligibleLemmas = 0;
  let dictionaryCoverageAlreadyCovered = 0;
  let dictionaryCoveragePendingEntriesEnsured = 0;
  let dictionaryCoverageJobsCreated = 0;
  let dictionaryCoverageDuplicateJobsAvoided = 0;
  const preservedPartIds =
    progressPreservingReplace && existingPartCount > 0
      ? safePreview.plan.matches.map((m) => m.partId)
      : [];

  try {
    await conn.beginTransaction();
    runTimer.phase("transaction-open");

    if (progressPreservingReplace && existingPartCount > 0) {
      const existingParts = await listPartsForContentSync(params.episodeId);
      // Re-plan against latest DB inside the transaction window (read via pool;
      // apply uses conn). Ambiguity already gated by wouldApplyBeSafe.
      const applyPlan = planSafeContentReplace({
        episodeId: params.episodeId,
        pipelineClips: clips,
        existingParts,
        dryRun: false,
      });
      if (applyPlan.ambiguousMatches.length > 0) {
        throw new Error(
          `Refusing apply: ${applyPlan.ambiguousMatches.length} ambiguous match(es)`,
        );
      }

      const clipsByOrder = new Map(clips.map((c) => [c.order, c] as const));
      await applyContentSyncPlanOnConnection(conn, applyPlan, clipsByOrder);
      partsInserted = applyPlan.inserts.length;
      partsDeleted = 0; // soft-retire only
      console.log(
        `Safe replace: preserved=${applyPlan.matches.length}, ` +
          `inserted=${applyPlan.inserts.length}, retired=${applyPlan.retires.length}`,
      );

      await assertPreservedPartIds(
        conn,
        applyPlan.matches.map((m) => m.partId),
      );

      // Rebuild content attachments on active parts only.
      await deleteContentAttachmentsForActiveParts(params.episodeId, conn);
      await deleteMaterializedSectionsForEpisode(params.episodeId, conn);
      runTimer.phase("parts-sync-complete", {
        matches: applyPlan.matches.length,
        inserts: applyPlan.inserts.length,
        retires: applyPlan.retires.length,
      });
    } else {
      // Empty episode insert (new content or replace on empty).
      partsInserted = await insertPartsFromClips(
        params.episodeId,
        clips,
        conn,
      );
      console.log(`Inserted ${partsInserted} parts`);
      runTimer.phase("parts-insert-complete", { partsInserted });
    }

    if (translations.length > 0) {
      translationResult = await importTranslationsForEpisode(
        params.episodeId,
        translations,
        conn,
      );
      console.log(
        `Imported ${translationResult.imported} caption translations (fa)`,
      );
      runTimer.phase("translations-complete", translationResult);
    }

    if (vocabularySenses.length > 0) {
      vocabularySensesUpserted = await upsertVocabularySenses(
        vocabularySenses,
        conn,
      );
      console.log(`Upserted ${vocabularySensesUpserted} vocabulary senses`);
      runTimer.phase("vocabulary-senses-complete", {
        vocabularySensesUpserted,
      });
    }

    if (vocabForClips.length > 0) {
      const vocabOcc = await importVocabularyOccurrencesForEpisode(
        params.episodeId,
        vocabForClips,
        clipKeySet,
        conn,
      );
      vocabularyOccurrencesImported = vocabOcc.imported;
      console.log(
        `Imported ${vocabularyOccurrencesImported} vocabulary occurrence row(s)`,
      );
      runTimer.phase("vocabulary-occurrences-complete", {
        vocabularyOccurrencesImported,
      });
    }

    if (grammarCatalog.length > 0) {
      grammarConceptsUpserted = await upsertGrammarConcepts(
        grammarCatalog,
        conn,
      );
      console.log(`Upserted ${grammarConceptsUpserted} grammar concepts`);
      runTimer.phase("grammar-catalog-complete", { grammarConceptsUpserted });
    }

    if (grammarOccurrences.length > 0) {
      const grammarResult = await importGrammarOccurrencesForEpisode(
        params.episodeId,
        grammarOccurrences,
        grammarCatalog,
        clipKeySet,
        conn,
      );
      grammarOccurrencesImported = grammarResult.occurrencesImported;
      grammarStubConceptsCreated = grammarResult.stubConceptsCreated;
      console.log(
        `Imported ${grammarOccurrencesImported} grammar occurrence row(s)` +
          (grammarStubConceptsCreated
            ? ` (${grammarStubConceptsCreated} stub concept(s))`
            : ""),
      );
      runTimer.phase("grammar-occurrences-complete", {
        grammarOccurrencesImported,
        grammarStubConceptsCreated,
      });
    }

    if (preservedPartIds.length > 0) {
      await assertPreservedPartIds(conn, preservedPartIds);
    }

    const dictionaryInventory = buildClipDictionaryLemmaInventory(clips);
    dictionaryCoverageWordTokenInstances =
      dictionaryInventory.totalWordTokenInstances;
    dictionaryCoverageEligibleLemmas =
      dictionaryInventory.eligibleLemmas.length;
    runTimer.phase("dictionary-coverage-start", {
      eligibleLemmas: dictionaryCoverageEligibleLemmas,
      wordTokenInstances: dictionaryCoverageWordTokenInstances,
    });
    const coverageResult = await ensureDictionaryCoverageForLemmas(
      conn,
      dictionaryInventory.eligibleLemmas.map((entry) => entry.lemma),
    );
    dictionaryCoverageAlreadyCovered = coverageResult.alreadyCovered;
    dictionaryCoveragePendingEntriesEnsured =
      coverageResult.pendingEntriesEnsured;
    dictionaryCoverageJobsCreated = coverageResult.generationJobsCreated;
    dictionaryCoverageDuplicateJobsAvoided =
      coverageResult.duplicateJobsAvoided;
    console.log(
      `Dictionary coverage: eligible lemmas=${dictionaryCoverageEligibleLemmas}, ` +
        `already covered=${dictionaryCoverageAlreadyCovered}, ` +
        `pending entries ensured=${dictionaryCoveragePendingEntriesEnsured}, ` +
        `jobs created=${dictionaryCoverageJobsCreated}, ` +
        `duplicate jobs avoided=${dictionaryCoverageDuplicateJobsAvoided}`,
    );
    runTimer.phase("dictionary-coverage-complete", coverageResult);

    await conn.commit();
    runTimer.phase("transaction-committed");
  } catch (error) {
    runTimer.phase("transaction-failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }

  const validation = await buildContentRefreshValidation(
    params.episodeId,
    notes,
  );
  validation.pipelineClipCount = clips.length;

  // Post-commit validation must not silently imply learner-state corruption.
  // Progress is keyed by preserved parts.id; failures here are content completeness only.
  if (validation.notes.length > 0) {
    notes.push(
      "Post-import validation notes are content-completeness checks only; " +
        "learner progress UUIDs were not remapped or wiped by this replace.",
    );
  }

  runTimer.phase("apply-complete");

  return {
    dryRun: false,
    reset: params.reset,
    progressPreservingReplace,
    counts: {
      pipelineClips: clips.length,
      uniqueCanonicalKeys: keyStats.unique,
      duplicateCanonicalKeyGroups: keyStats.duplicateGroups,
      partsDeleted,
      partsInserted,
      translationsImported: translationResult.imported,
      translationsSkippedMissingKey: translationResult.skippedMissingKey,
      vocabularySensesUpserted,
      vocabularyOccurrencesImported,
      vocabularyAssignmentsFromLearningAnalysis: learningVocab.length,
      vocabularyAssignmentsFromOccurrencesFile: fileVocab.filter((e) =>
        clipKeySet.has(e.canonicalKey),
      ).length,
      grammarConceptsUpserted,
      grammarOccurrencesImported,
      grammarStubConceptsCreated,
      dictionaryCoverageWordTokenInstances,
      dictionaryCoverageEligibleLemmas,
      dictionaryCoverageAlreadyCovered,
      dictionaryCoveragePendingEntriesEnsured,
      dictionaryCoverageJobsCreated,
      dictionaryCoverageDuplicateJobsAvoided,
    },
    validation,
    notes,
    preview,
  };
}

export { buildContentRefreshValidation } from "./validateRefresh";
