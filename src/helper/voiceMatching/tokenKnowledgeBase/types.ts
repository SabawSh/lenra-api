export const TOKEN_KNOWLEDGE_SCHEMA_VERSION = 1;

export type TokenObservationSource = "seed" | "analytics" | "manual";

/** Raw aggregated observation from analytics — not yet validated or promoted. */
export type TokenObservationCandidate = {
  expectedToken: string;
  observedToken: string;
  observationCount: number;
  averageConfidence: number | null;
  source: TokenObservationSource | string;
  firstSeenAt: number;
  lastSeenAt: number;
};

/** Observation that passed validation — eligible for promotion. */
export type ValidatedTokenObservation = {
  expectedToken: string;
  observedToken: string;
  observationCount: number;
  averageConfidence: number;
  source: TokenObservationSource | string;
  firstSeenAt: number;
  lastSeenAt: number;
};

/** Promoted STT spelling variant with metadata for pruning and explainability. */
export type PromotedTokenForm = {
  observedToken: string;
  observationCount: number;
  averageConfidence: number;
  source: TokenObservationSource | string;
  createdAt: number;
  lastSeen: number;
  promotedAt: number;
  /** Last time this form contributed to a successful tile match (future pruning). */
  lastMatched: number | null;
  /** Successful matcher accepts using this form (future pruning). */
  successfulMatches: number;
  /** Rejections where this form was involved (optional future pruning signal). */
  rejectedMatches: number;
};

export type TokenKnowledgeEntry = {
  schemaVersion: typeof TOKEN_KNOWLEDGE_SCHEMA_VERSION;
  expectedToken: string;
  promotedForms: PromotedTokenForm[];
};

export interface TokenKnowledgeBase {
  lookup(expectedToken: string): TokenKnowledgeEntry | null;
  getEntries(): readonly TokenKnowledgeEntry[];
}
