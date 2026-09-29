/**
 * Shared Content Import service used by CLI and Admin.
 * Thin facade over lib/content-refresh — do not duplicate import logic.
 *
 * Do not close the shared MySQL pool here — Admin handlers run concurrently
 * in Next.js and closing the pool races with sibling requests.
 */
import {
  buildContentRefreshValidation,
  runContentRefresh,
} from "@/lib/content-refresh";
import {
  columnExists,
  tableExists,
} from "@/lib/content-refresh/validateRefresh";
import type {
  ContentRefreshArtifactBundle,
  ContentRefreshResult,
} from "@/lib/content-refresh/types";
import { getContentSyncPool } from "@/lib/content-sync/syncDb";
import type { RowDataPacket } from "mysql2/promise";
import type {
  ContentImportMode,
  EpisodeContentOverview,
  EpisodePartSummary,
  PartLearningDetail,
} from "./types";

export type {
  ContentImportMode,
  EpisodeContentOverview,
  EpisodePartSummary,
  PartLearningDetail,
} from "./types";
export type {
  ContentRefreshArtifactBundle,
  ContentRefreshResult,
} from "@/lib/content-refresh/types";

export type PreviewContentImportParams = {
  episodeId: string;
  artifacts: ContentRefreshArtifactBundle;
  mode: ContentImportMode;
};

export type ExecuteContentImportParams = PreviewContentImportParams & {
  confirmReplace?: boolean;
};

export async function previewContentImport(
  params: PreviewContentImportParams,
): Promise<ContentRefreshResult> {
  return runContentRefresh({
    episodeId: params.episodeId,
    artifacts: params.artifacts,
    reset: params.mode === "replace",
    dryRun: true,
  });
}

export async function executeContentImport(
  params: ExecuteContentImportParams,
): Promise<ContentRefreshResult> {
  if (params.mode === "replace" && params.confirmReplace !== true) {
    throw new Error(
      "Replace mode requires confirmReplace: true — content attachments will be rebuilt; " +
        "matching parts.id and learner progress are preserved.",
    );
  }
  const result = await runContentRefresh({
    episodeId: params.episodeId,
    artifacts: params.artifacts,
    reset: params.mode === "replace",
    dryRun: false,
  });
  if (
    params.mode === "replace" &&
    result.preview.potentialLearnerStateLoss > 0
  ) {
    throw new Error(
      `Refusing Apply: potentialLearnerStateLoss=${result.preview.potentialLearnerStateLoss}. ` +
        `Resolve learner-state policy before importing.`,
    );
  }
  if (params.mode === "replace" && !result.preview.wouldApplyBeSafe) {
    throw new Error(
      `Refusing Apply: wouldApplyBeSafe=false. ` +
        `Blockers: ${result.preview.safetyBlockers.join("; ") || "unknown"}`,
    );
  }
  return result;
}

export async function getEpisodeContentOverview(
  episodeId: string,
): Promise<EpisodeContentOverview> {
  const validation = await buildContentRefreshValidation(episodeId, []);
  const partCount = validation.databasePartCount;

  return {
    episodeId,
    partCount,
    uniqueCanonicalKeys: validation.uniqueCanonicalKeys,
    duplicateCanonicalKeyGroups: validation.duplicateCanonicalKeyGroups,
    translationCount: validation.translationCount,
    partsMissingTranslation: validation.partsMissingTranslation,
    vocabularyOccurrences: validation.vocabularyOccurrencesInDb,
    partsWithVocabulary: Math.max(
      0,
      partCount - validation.partsMissingVocabulary,
    ),
    grammarOccurrences: validation.grammarOccurrencesInDb,
    partsWithGrammar: Math.max(0, partCount - validation.partsMissingGrammar),
    partsMissingMedia: validation.partsMissingMedia,
  };
}

export async function listEpisodePartSummaries(
  episodeId: string,
  limit = 100,
  offset = 0,
): Promise<EpisodePartSummary[]> {
  const pool = getContentSyncPool();
  const hasCanonicalKey = await columnExists("parts", "canonical_key");
  const hasCaptionTranslations = await tableExists("caption_translations");
  const hasVocabOcc = await tableExists("part_vocabulary_occurrences");
  const hasGrammarOcc = await tableExists("part_grammar_occurrences");
  const hasVideoUrl = await columnExists("parts", "video_url");
  const hasHlsManifest = await columnExists("parts", "hls_manifest_url");
  const hasMediaExpr =
    hasVideoUrl && hasHlsManifest
      ? "(p.video_url IS NOT NULL OR p.hls_manifest_url IS NOT NULL)"
      : hasVideoUrl
        ? "(p.video_url IS NOT NULL)"
        : hasHlsManifest
          ? "(p.hls_manifest_url IS NOT NULL)"
          : "0";

  const [rows] = await pool.execute<RowDataPacket[]>(
    `
    SELECT
      CAST(p.id AS CHAR) AS id,
      p.\`order\` AS partOrder,
      ${hasCanonicalKey ? "p.canonical_key" : "NULL"} AS canonicalKey,
      p.text AS text,
      p.difficulty AS difficulty,
      ${hasCaptionTranslations ? "(ct.id IS NOT NULL)" : "0"} AS hasTranslation,
      ${
        hasVocabOcc
          ? `(SELECT COUNT(*) FROM part_vocabulary_occurrences pvo WHERE pvo.part_id = p.id)`
          : "0"
      } AS vocabularyCount,
      ${
        hasGrammarOcc
          ? `(SELECT COUNT(*) FROM part_grammar_occurrences pgo WHERE pgo.part_id = p.id)`
          : "0"
      } AS grammarCount,
      ${hasMediaExpr} AS hasMedia
    FROM parts p
    ${
      hasCaptionTranslations
        ? `LEFT JOIN caption_translations ct
      ON ct.part_id = p.id AND ct.language = 'fa'`
        : ""
    }
    WHERE p.episode_id = ?
    ORDER BY p.\`order\` ASC
    LIMIT ${Number(limit)} OFFSET ${Number(offset)}
    `,
    [episodeId],
  );

  return rows.map((r) => ({
    id: String(r.id),
    order: Number(r.partOrder),
    canonicalKey: r.canonicalKey ? String(r.canonicalKey) : null,
    text: String(r.text ?? ""),
    difficulty: String(r.difficulty ?? "easy"),
    hasTranslation: Boolean(r.hasTranslation),
    vocabularyCount: Number(r.vocabularyCount ?? 0),
    grammarCount: Number(r.grammarCount ?? 0),
    hasMedia: Boolean(r.hasMedia),
  }));
}

export async function getPartLearningDetail(
  partId: string,
): Promise<PartLearningDetail | null> {
  const pool = getContentSyncPool();
  const hasCanonicalKey = await columnExists("parts", "canonical_key");
  const [parts] = await pool.execute<RowDataPacket[]>(
    `
    SELECT
      CAST(p.id AS CHAR) AS id,
      p.\`order\` AS partOrder,
      ${hasCanonicalKey ? "p.canonical_key" : "NULL"} AS canonicalKey,
      p.text AS text
    FROM parts p
    WHERE p.id = ?
    LIMIT 1
    `,
    [partId],
  );
  if (parts.length === 0) return null;
  const part = parts[0]!;

  let tr: RowDataPacket[] = [];
  if (await tableExists("caption_translations")) {
    [tr] = await pool.execute<RowDataPacket[]>(
      `
      SELECT text FROM caption_translations
      WHERE part_id = ? AND language = 'fa'
      LIMIT 1
      `,
      [partId],
    );
  }

  let vocab: RowDataPacket[] = [];
  if (await tableExists("part_vocabulary_occurrences")) {
    [vocab] = await pool.execute<RowDataPacket[]>(
      `
      SELECT
        pvo.sense_id AS senseId,
        pvo.surface AS surface,
        pvo.evidence_span AS evidenceSpan,
        pvo.confidence AS confidence,
        de.lemma AS lemma,
        ds.definition_en AS meaningEn,
        ds.definition_fa AS meaningFa,
        ds.cefr_level AS cefr
      FROM part_vocabulary_occurrences pvo
      LEFT JOIN dictionary_senses ds ON ds.id = pvo.sense_id
      LEFT JOIN dictionary_entries de ON de.id = ds.dictionary_entry_id
      WHERE pvo.part_id = ?
      ORDER BY pvo.created_at ASC
      `,
      [partId],
    );
  }

  let grammar: RowDataPacket[] = [];
  if (await tableExists("part_grammar_occurrences")) {
    [grammar] = await pool.execute<RowDataPacket[]>(
      `
      SELECT
        pgo.grammar_id AS grammarId,
        gc.display_name_en AS displayNameEn,
        pgo.evidence_span AS evidenceSpan,
        pgo.confidence AS confidence,
        pgo.source AS source
      FROM part_grammar_occurrences pgo
      LEFT JOIN grammar_concepts gc ON gc.id = pgo.grammar_id
      WHERE pgo.part_id = ?
      ORDER BY pgo.created_at ASC
      `,
      [partId],
    );
  }

  return {
    id: String(part.id),
    order: Number(part.partOrder),
    canonicalKey: part.canonicalKey ? String(part.canonicalKey) : null,
    text: String(part.text ?? ""),
    translation: tr[0]?.text ? String(tr[0].text) : null,
    vocabulary: vocab.map((r) => ({
      senseId: String(r.senseId),
      surface: r.surface ? String(r.surface) : null,
      evidenceSpan: r.evidenceSpan ? String(r.evidenceSpan) : null,
      confidence:
        r.confidence != null && Number.isFinite(Number(r.confidence))
          ? Number(r.confidence)
          : null,
      lemma: r.lemma ? String(r.lemma) : null,
      meaningEn: r.meaningEn ? String(r.meaningEn) : null,
      meaningFa: r.meaningFa ? String(r.meaningFa) : null,
      cefr: r.cefr ? String(r.cefr) : null,
    })),
    grammar: grammar.map((r) => ({
      grammarId: String(r.grammarId),
      displayNameEn: r.displayNameEn ? String(r.displayNameEn) : null,
      evidenceSpan: r.evidenceSpan ? String(r.evidenceSpan) : null,
      confidence:
        r.confidence != null && Number.isFinite(Number(r.confidence))
          ? Number(r.confidence)
          : null,
      source: r.source ? String(r.source) : null,
    })),
  };
}
