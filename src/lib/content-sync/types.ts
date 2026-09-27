/** Phase 2 content sync — pipeline clips.json ↔ Lenra parts. */

export type PipelineClipHls = {
  outputKey?: string;
  clipName?: string;
  masterPlaylistRelative?: string;
  playMp4Relative?: string;
  sourceStartMs?: number;
  sourceEndMs?: number;
};

export type PipelineClipToken = {
  value?: string;
  text?: string;
  lemma?: string;
  type?: string;
  punctuationType?: string;
  senseId?: string;
  dictionaryEntryId?: string;
  matchedPhrase?: string;
  visibleInPuzzle?: boolean;
  locked?: boolean;
  normalized?: string;
};

export type PipelineClipMetrics = {
  wordCount?: number;
  speechRate?: number;
  sentenceCount?: number;
};

/** Normalized clip from clips.json with stable 1-based presentation order. */
export type PipelineClip = {
  /** Unstable runtime id from the pipeline — never used as Lenra PK. */
  pipelineId: string;
  /** 1-based presentation order = array index + 1 in clips.json. */
  order: number;
  canonicalKey: string;
  text: string;
  startMs: number;
  endMs: number;
  durationMs: number;
  speechStartMs: number | null;
  speechEndMs: number | null;
  speechDurationMs: number | null;
  level: "easy" | "medium" | "hard";
  difficultyScore: number | null;
  tokens: PipelineClipToken[];
  metrics: PipelineClipMetrics | null;
  sourceCues: string[] | null;
  sourceCueIndexes: number[] | null;
  /** Preserved for a future media sync phase — not written in Phase 2. */
  hls: PipelineClipHls | null;
  encodeStartMs: number | null;
  encodeEndMs: number | null;
};

export type ExistingSyncPart = {
  id: string;
  episodeId: string;
  order: number;
  canonicalKey: string | null;
  text: string;
  retiredAt: Date | null;
  /** Snapshot of pipeline-owned fields for change detection. */
  playbackStartMs: number | null;
  playbackEndMs: number | null;
  playbackDurationMs: number | null;
  speechStartMs: number | null;
  speechEndMs: number | null;
  speechDurationMs: number | null;
  difficulty: "easy" | "medium" | "hard";
  difficultyScore: number | null;
  wordCount: number;
  speechRate: number | null;
  tokensJson: string | null;
};

export type ContentSyncAmbiguity = {
  canonicalKey: string;
  reason: string;
  pipelineOrders: number[];
  partIds: string[];
};

export type ContentSyncMatch = {
  partId: string;
  pipelineOrder: number;
  canonicalKey: string;
  previousOrder: number;
  wasRetired: boolean;
  contentChanged: boolean;
  orderChanged: boolean;
};

export type ContentSyncInsert = {
  pipelineOrder: number;
  canonicalKey: string;
  clip: PipelineClip;
};

export type ContentSyncRetire = {
  partId: string;
  previousOrder: number;
  canonicalKey: string | null;
};

export type ContentSyncPlan = {
  episodeId: string;
  pipelineClipCount: number;
  existingActiveCount: number;
  existingRetiredCount: number;
  matches: ContentSyncMatch[];
  inserts: ContentSyncInsert[];
  retires: ContentSyncRetire[];
  ambiguousMatches: ContentSyncAmbiguity[];
  duplicateCanonicalKeyGroups: number;
  dryRun: boolean;
};

export type ContentSyncReport = {
  episodeId: string;
  pipelineClipCount: number;
  existingPartCount: number;
  existingActiveCount: number;
  matched: number;
  inserted: number;
  updated: number;
  reordered: number;
  restored: number;
  retired: number;
  duplicateCanonicalKeyGroups: number;
  ambiguousMatches: ContentSyncAmbiguity[];
  dryRun: boolean;
};
