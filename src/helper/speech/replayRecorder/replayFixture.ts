/**
 * Replay fixture shape accepted by npm run speech:replay.
 * Kept in helper so production export does not import from tests/.
 */
import type { SpeechReplayEvent } from "@/helper/speech/voiceSession";

export type ReplayFixtureTile = {
  id: string;
  text: string;
};

export type ReplayFixtureExpectation = {
  acceptedTileIds: string[];
  orderedTileIds?: string[];
  finalSentence?: string;
  knownFailure?: boolean;
  bugRef?: string;
};

export type ReplayFixtureMeta = {
  id: string;
  createdFrom: "production" | "handwritten" | "telemetry" | string;
  browser?: string;
  platform?: string;
  engine?: string;
  locale?: string;
  appVersion?: string;
  exerciseId?: string;
  captionId?: string;
  expectedSentence?: string;
  failureReason?: string;
  startedAt?: string;
  endedAt?: string;
  notes?: string;
  /** Overall speech pipeline provenance stamp (bump on coordinated changes). */
  pipelineVersion?: string;
  /** Git SHA at build/dev time; null when unavailable. */
  gitCommit?: string | null;
  captionVersion?: string;
  adaptiveTeacherVersion?: string;
  lexiconVersion?: string;
  normalizerVersion?: string;
  matcherVersion?: string;
  placementVersion?: string;
  /** ISO timestamp when the fixture JSON was exported. */
  exportedAt?: string;
  /**
   * Deterministic digest of runtime speech configuration at export time.
   * Prefer this over version labels when verifying historical provenance.
   */
  pipelineFingerprint?: string;
  /** Readable runtime speech config snapshot used to compute the fingerprint. */
  speechConfigSnapshot?: Record<string, unknown>;
};

export type ReplayFixture = {
  sessionId: string;
  description?: string;
  movie?: string;
  caption: string;
  tiles: ReplayFixtureTile[];
  events: SpeechReplayEvent[];
  expected: ReplayFixtureExpectation;
  tags?: string[];
  notes?: string;
  meta?: ReplayFixtureMeta;
};
