export type ObservationSource = "seed" | "analytics" | "manual";

export type Observation = {
  observedPhrase: string;
  count: number;
  confidence: number;
  source: ObservationSource | string;
};

export type PhraseKnowledgeEntry = {
  expectedPhrase: string;
  observations: Observation[];
};

/** Analytics-derived observations — not enabled in the matcher until merged explicitly. */
export type PhraseKnowledgeCandidate = {
  expectedPhrase: string;
  observations: Observation[];
};

export interface PhraseKnowledgeBase {
  lookup(expectedPhrase: string): PhraseKnowledgeEntry | null;
  getEntries(): readonly PhraseKnowledgeEntry[];
}
