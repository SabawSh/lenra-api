import {
  expectedPhraseKey,
  normalizeExpectedPhrase,
  normalizeObservedPhrase,
} from "./normalizePhrase";
import type {
  Observation,
  PhraseKnowledgeCandidate,
  PhraseKnowledgeEntry,
} from "./types";

function sortObservationsDeterministically(
  observations: readonly Observation[],
): Observation[] {
  return [...observations].sort(
    (left, right) =>
      right.count - left.count ||
      left.observedPhrase.localeCompare(right.observedPhrase) ||
      left.source.localeCompare(right.source),
  );
}

function cloneObservation(observation: Observation): Observation {
  return { ...observation };
}

/**
 * Merge seed knowledge with learned candidates deterministically.
 * Seed observations win when the same normalized observed phrase appears in both.
 */
export function mergePhraseKnowledge(
  seed: readonly PhraseKnowledgeEntry[],
  learned: readonly PhraseKnowledgeCandidate[],
): PhraseKnowledgeEntry[] {
  const merged = new Map<string, PhraseKnowledgeEntry>();

  for (const entry of seed) {
    const key = expectedPhraseKey(entry.expectedPhrase);
    if (!key) continue;

    merged.set(key, {
      expectedPhrase: normalizeExpectedPhrase(entry.expectedPhrase),
      observations: entry.observations.map(cloneObservation),
    });
  }

  for (const candidate of learned) {
    const key = expectedPhraseKey(candidate.expectedPhrase);
    if (!key) continue;

    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, {
        expectedPhrase: normalizeExpectedPhrase(candidate.expectedPhrase),
        observations: candidate.observations.map(cloneObservation),
      });
      continue;
    }

    const seedObserved = new Set(
      existing.observations.map((observation) =>
        normalizeObservedPhrase(observation.observedPhrase),
      ),
    );

    for (const observation of candidate.observations) {
      const observedKey = normalizeObservedPhrase(observation.observedPhrase);
      if (!observedKey || seedObserved.has(observedKey)) continue;
      existing.observations.push(cloneObservation(observation));
    }
  }

  return [...merged.values()]
    .map((entry) => ({
      expectedPhrase: entry.expectedPhrase,
      observations: sortObservationsDeterministically(entry.observations),
    }))
    .sort((left, right) =>
      expectedPhraseKey(left.expectedPhrase).localeCompare(
        expectedPhraseKey(right.expectedPhrase),
      ),
    );
}
