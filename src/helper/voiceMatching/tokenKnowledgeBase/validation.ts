import {
  DEFAULT_TOKEN_PROMOTION_POLICY,
  type TokenPromotionPolicy,
} from "../voiceMatchingConfig";
import {
  expectedTokenKey,
  normalizeExpectedToken,
  normalizeObservedToken,
} from "./normalizeToken";
import type {
  TokenObservationCandidate,
  ValidatedTokenObservation,
} from "./types";

export type TokenPromotionContext = {
  /** Puzzle tokens the promotion batch is scoped to. Empty means no vocabulary guard. */
  closedVocabulary?: ReadonlySet<string>;
  /** Orthographic forms for all known expected tokens in scope. */
  orthographicForms?: ReadonlySet<string>;
  /** Observed form → owning expected token (for ambiguity checks). */
  ownerByObservedForm?: ReadonlyMap<string, string>;
};

export type TokenValidationRejectReason =
  | "EMPTY_TOKEN"
  | "SELF_MATCH"
  | "BELOW_MIN_COUNT"
  | "MISSING_CONFIDENCE"
  | "BELOW_MIN_CONFIDENCE"
  | "OUTSIDE_CLOSED_VOCABULARY"
  | "ORTHOGRAPHIC_COLLISION"
  | "AMBIGUOUS_OWNER";

function resolvePolicy(
  overrides?: Partial<TokenPromotionPolicy>,
): TokenPromotionPolicy {
  return {
    minObservationCount:
      overrides?.minObservationCount ??
      DEFAULT_TOKEN_PROMOTION_POLICY.minObservationCount,
    minConfidence:
      overrides?.minConfidence ?? DEFAULT_TOKEN_PROMOTION_POLICY.minConfidence,
    maxPromotedFormsPerToken:
      overrides?.maxPromotedFormsPerToken ??
      DEFAULT_TOKEN_PROMOTION_POLICY.maxPromotedFormsPerToken,
  };
}

/**
 * Validate a single observation candidate against the promotion policy.
 * Returns null when the observation must not advance to promotion.
 */
export function validateTokenObservationCandidate(
  candidate: TokenObservationCandidate,
  context: TokenPromotionContext = {},
  policy: Partial<TokenPromotionPolicy> = {},
): ValidatedTokenObservation | null {
  const resolved = resolvePolicy(policy);
  const expectedToken = normalizeExpectedToken(candidate.expectedToken);
  const observedToken = normalizeObservedToken(candidate.observedToken);

  if (!expectedToken || !observedToken) return null;
  if (observedToken === expectedToken) return null;

  if (candidate.observationCount < resolved.minObservationCount) return null;

  if (candidate.averageConfidence === null) return null;
  if (candidate.averageConfidence < resolved.minConfidence) return null;

  if (
    context.closedVocabulary &&
    context.closedVocabulary.size > 0 &&
    !context.closedVocabulary.has(expectedToken)
  ) {
    return null;
  }

  if (context.orthographicForms) {
    for (const orthographic of context.orthographicForms) {
      if (orthographic !== expectedToken && orthographic === observedToken) {
        return null;
      }
    }
  }

  const owner = context.ownerByObservedForm?.get(observedToken);
  if (owner && owner !== expectedToken) return null;

  return {
    expectedToken,
    observedToken,
    observationCount: candidate.observationCount,
    averageConfidence: candidate.averageConfidence,
    source: candidate.source,
    firstSeenAt: candidate.firstSeenAt,
    lastSeenAt: candidate.lastSeenAt,
  };
}

export function validateTokenObservationCandidates(
  candidates: readonly TokenObservationCandidate[],
  context: TokenPromotionContext = {},
  policy: Partial<TokenPromotionPolicy> = {},
): ValidatedTokenObservation[] {
  const resolved = resolvePolicy(policy);
  const ownerByObservedForm = new Map(context.ownerByObservedForm ?? []);
  const orthographicForms =
    context.orthographicForms ?? new Set<string>();
  const closedVocabulary = context.closedVocabulary;
  const validated: ValidatedTokenObservation[] = [];
  const promotedCountByExpected = new Map<string, number>();

  const ordered = [...candidates].sort(
    (left, right) =>
      right.observationCount - left.observationCount ||
      expectedTokenKey(left.expectedToken).localeCompare(
        expectedTokenKey(right.expectedToken),
      ) ||
      left.observedToken.localeCompare(right.observedToken),
  );

  for (const candidate of ordered) {
    const entry = validateTokenObservationCandidate(
      candidate,
      {
        closedVocabulary,
        orthographicForms,
        ownerByObservedForm,
      },
      resolved,
    );
    if (!entry) continue;

    const expectedKey = expectedTokenKey(entry.expectedToken);
    const currentCount = promotedCountByExpected.get(expectedKey) ?? 0;
    if (currentCount >= resolved.maxPromotedFormsPerToken) continue;

    validated.push(entry);
    ownerByObservedForm.set(entry.observedToken, entry.expectedToken);
    promotedCountByExpected.set(expectedKey, currentCount + 1);
  }

  return validated;
}

export function describeValidationFailure(
  candidate: TokenObservationCandidate,
  context: TokenPromotionContext = {},
  policy: Partial<TokenPromotionPolicy> = {},
): TokenValidationRejectReason | null {
  const resolved = resolvePolicy(policy);
  const expectedToken = normalizeExpectedToken(candidate.expectedToken);
  const observedToken = normalizeObservedToken(candidate.observedToken);

  if (!expectedToken || !observedToken) return "EMPTY_TOKEN";
  if (observedToken === expectedToken) return "SELF_MATCH";
  if (candidate.observationCount < resolved.minObservationCount) {
    return "BELOW_MIN_COUNT";
  }
  if (candidate.averageConfidence === null) return "MISSING_CONFIDENCE";
  if (candidate.averageConfidence < resolved.minConfidence) {
    return "BELOW_MIN_CONFIDENCE";
  }
  if (
    context.closedVocabulary &&
    context.closedVocabulary.size > 0 &&
    !context.closedVocabulary.has(expectedToken)
  ) {
    return "OUTSIDE_CLOSED_VOCABULARY";
  }
  if (context.orthographicForms) {
    for (const orthographic of context.orthographicForms) {
      if (orthographic !== expectedToken && orthographic === observedToken) {
        return "ORTHOGRAPHIC_COLLISION";
      }
    }
  }
  const owner = context.ownerByObservedForm?.get(observedToken);
  if (owner && owner !== expectedToken) return "AMBIGUOUS_OWNER";
  return null;
}
