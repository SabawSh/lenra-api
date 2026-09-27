import type { PhraseKnowledgeEntry } from "./types";

/**
 * Initial seed data — lookup only; no matching logic here.
 *
 * Seed observations are real STT mistakes, kept ONLY until adaptive learning has
 * enough observations to cover the phrase (see migration path in
 * docs/LEARNING-AND-VOICE.md). They map an expected phrase to the corrupted
 * variants STT commonly emits; the matcher's gates handle the rest.
 */
export const SEED_PHRASE_KNOWLEDGE: readonly PhraseKnowledgeEntry[] = [
  {
    expectedPhrase: "mangy thing",
    observations: [
      {
        observedPhrase: "monkey thing",
        count: 1,
        confidence: 1.0,
        source: "seed",
      },
      {
        observedPhrase: "mingy thing",
        count: 1,
        confidence: 0.95,
        source: "seed",
      },
      {
        observedPhrase: "mangey thing",
        count: 1,
        confidence: 0.95,
        source: "seed",
      },
      {
        observedPhrase: "manny thing",
        count: 1,
        confidence: 0.9,
        source: "seed",
      },
    ],
  },
  {
    expectedPhrase: "you mangy thing",
    observations: [
      {
        observedPhrase: "you monkey thing",
        count: 1,
        confidence: 1.0,
        source: "seed",
      },
      {
        observedPhrase: "you made your thing",
        count: 1,
        confidence: 1.0,
        source: "seed",
      },
      {
        observedPhrase: "you mentioned",
        count: 1,
        confidence: 0.8,
        source: "seed",
      },
    ],
  },
  {
    // Gates already accept "an old well" / "old well" / "an old will" / "and old
    // well" via phrase similarity. "old bell" corrupts the content word
    // ("well" -> "bell"), fails the evidence gate, and needs knowledge until
    // learned. NOTE: do NOT map "the well" here — it is itself a puzzle tile, so
    // mapping it would make the literal "the well" tile unreachable.
    expectedPhrase: "an old well",
    observations: [
      {
        observedPhrase: "old bell",
        count: 1,
        confidence: 1.0,
        source: "seed",
      },
    ],
  },
  {
    expectedPhrase: "well",
    observations: [
      {
        observedPhrase: "will",
        count: 1,
        confidence: 0.95,
        source: "seed",
      },
    ],
  },
];
