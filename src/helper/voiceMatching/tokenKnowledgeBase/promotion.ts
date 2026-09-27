import { expectedTokenKey, normalizeExpectedToken } from "./normalizeToken";
import {
  TOKEN_KNOWLEDGE_SCHEMA_VERSION,
  type PromotedTokenForm,
  type TokenKnowledgeEntry,
  type ValidatedTokenObservation,
} from "./types";

function sortPromotedFormsDeterministically(
  forms: readonly PromotedTokenForm[],
): PromotedTokenForm[] {
  return [...forms].sort(
    (left, right) =>
      right.observationCount - left.observationCount ||
      left.observedToken.localeCompare(right.observedToken) ||
      left.source.localeCompare(right.source),
  );
}

function clonePromotedForm(form: PromotedTokenForm): PromotedTokenForm {
  return { ...form };
}

function createKnowledgeEntry(expectedToken: string): TokenKnowledgeEntry {
  return {
    schemaVersion: TOKEN_KNOWLEDGE_SCHEMA_VERSION,
    expectedToken: normalizeExpectedToken(expectedToken),
    promotedForms: [],
  };
}

function createPromotedForm(
  validated: ValidatedTokenObservation,
  promotedAt: number,
): PromotedTokenForm {
  return {
    observedToken: validated.observedToken,
    observationCount: validated.observationCount,
    averageConfidence: validated.averageConfidence,
    source: validated.source,
    createdAt: validated.firstSeenAt || promotedAt,
    lastSeen: validated.lastSeenAt || promotedAt,
    promotedAt,
    lastMatched: null,
    successfulMatches: 0,
    rejectedMatches: 0,
  };
}

/**
 * Promote a validated observation into a knowledge form with full metadata.
 */
export function promoteValidatedObservation(
  validated: ValidatedTokenObservation,
  promotedAt: number = Date.now(),
): PromotedTokenForm {
  return createPromotedForm(validated, promotedAt);
}

export function promoteValidatedObservations(
  validated: readonly ValidatedTokenObservation[],
  promotedAt: number = Date.now(),
): PromotedTokenForm[] {
  return validated.map((entry) => promoteValidatedObservation(entry, promotedAt));
}

/**
 * Update an existing promoted form in place — preserves identity metadata.
 */
export function upsertPromotedForm(
  entry: TokenKnowledgeEntry,
  validated: ValidatedTokenObservation,
  promotedAt: number = Date.now(),
): PromotedTokenForm {
  const existing = entry.promotedForms.find(
    (form) => form.observedToken === validated.observedToken,
  );

  if (!existing) {
    const created = createPromotedForm(validated, promotedAt);
    entry.promotedForms.push(created);
    entry.promotedForms = sortPromotedFormsDeterministically(entry.promotedForms);
    return created;
  }

  const addedCount = validated.observationCount;
  const totalCount = existing.observationCount + addedCount;
  existing.averageConfidence =
    (existing.averageConfidence * existing.observationCount +
      validated.averageConfidence * addedCount) /
    totalCount;
  existing.observationCount = totalCount;
  existing.lastSeen = Math.max(
    existing.lastSeen,
    validated.lastSeenAt || promotedAt,
  );

  entry.promotedForms = sortPromotedFormsDeterministically(entry.promotedForms);
  return existing;
}

/**
 * Evolve knowledge by upserting validated observations into a cloned base.
 */
export function evolveTokenKnowledge(
  base: readonly TokenKnowledgeEntry[],
  validated: readonly ValidatedTokenObservation[],
  promotedAt: number = Date.now(),
): TokenKnowledgeEntry[] {
  const merged = new Map<string, TokenKnowledgeEntry>();

  for (const entry of base) {
    const key = expectedTokenKey(entry.expectedToken);
    if (!key) continue;
    merged.set(key, {
      schemaVersion: TOKEN_KNOWLEDGE_SCHEMA_VERSION,
      expectedToken: normalizeExpectedToken(entry.expectedToken),
      promotedForms: entry.promotedForms.map(clonePromotedForm),
    });
  }

  for (const observation of validated) {
    const key = expectedTokenKey(observation.expectedToken);
    if (!key) continue;

    let entry = merged.get(key);
    if (!entry) {
      entry = createKnowledgeEntry(observation.expectedToken);
      merged.set(key, entry);
    }

    upsertPromotedForm(entry, observation, promotedAt);
  }

  return [...merged.values()].sort((left, right) =>
    expectedTokenKey(left.expectedToken).localeCompare(
      expectedTokenKey(right.expectedToken),
    ),
  );
}

/**
 * Group promoted forms into knowledge entries keyed by expected token.
 */
export function groupPromotedFormsByExpected(
  validated: readonly ValidatedTokenObservation[],
  promotedAt: number = Date.now(),
): TokenKnowledgeEntry[] {
  const grouped = new Map<string, TokenKnowledgeEntry>();

  for (const entry of validated) {
    const key = expectedTokenKey(entry.expectedToken);
    if (!key) continue;

    let knowledge = grouped.get(key);
    if (!knowledge) {
      knowledge = createKnowledgeEntry(entry.expectedToken);
      grouped.set(key, knowledge);
    }

    upsertPromotedForm(knowledge, entry, promotedAt);
  }

  return [...grouped.values()].sort((left, right) =>
    expectedTokenKey(left.expectedToken).localeCompare(
      expectedTokenKey(right.expectedToken),
    ),
  );
}

/**
 * Merge seed knowledge with learned entries. Seed forms win on first insert;
 * existing learned metadata is preserved via upsert semantics.
 */
export function mergePromotedTokenKnowledge(
  seed: readonly TokenKnowledgeEntry[],
  learned: readonly TokenKnowledgeEntry[],
): TokenKnowledgeEntry[] {
  const merged = new Map<string, TokenKnowledgeEntry>();

  for (const entry of seed) {
    const key = expectedTokenKey(entry.expectedToken);
    if (!key) continue;
    merged.set(key, {
      schemaVersion: TOKEN_KNOWLEDGE_SCHEMA_VERSION,
      expectedToken: normalizeExpectedToken(entry.expectedToken),
      promotedForms: entry.promotedForms.map(clonePromotedForm),
    });
  }

  for (const entry of learned) {
    const key = expectedTokenKey(entry.expectedToken);
    if (!key) continue;

    let existing = merged.get(key);
    if (!existing) {
      existing = createKnowledgeEntry(entry.expectedToken);
      merged.set(key, existing);
    }

    const seedObserved = new Set(
      existing.promotedForms.map((form) => form.observedToken),
    );

    for (const form of entry.promotedForms) {
      if (seedObserved.has(form.observedToken)) continue;
      existing.promotedForms.push(clonePromotedForm(form));
      seedObserved.add(form.observedToken);
    }

    existing.promotedForms = sortPromotedFormsDeterministically(
      existing.promotedForms,
    );
  }

  return [...merged.values()].sort((left, right) =>
    expectedTokenKey(left.expectedToken).localeCompare(
      expectedTokenKey(right.expectedToken),
    ),
  );
}
