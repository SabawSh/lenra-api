/**
 * CaptionAwareRecovery — preprocessing between Normalizer and Matcher.
 *
 * Bounded token rewriter for caption entities (names / OOV) only.
 * Entity spans are immutable: recovery may repair ONE entity mishearing, never
 * surrounding grammar ("caroline named" must not become "Caroline").
 *
 * Matcher / resolver / placement stay unaware.
 */

import { normalizeText } from "@/helper/speech/normalizer";
import {
  scoreSpokenPhrasePhoneticDistance,
  scoreTokenPhoneticDistance,
} from "@/helper/speech/phoneticDistance";
import { resolveSttFallbackConfig } from "@/helper/speech/sttConfig";
import { tokenize } from "@/helper/speech/tokenizer";
import { levenshtein } from "@/utils/pronunciation";

/** Minimum confidence to rewrite a spoken span → caption vocabulary. */
export const CAPTION_RECOVERY_MIN_SCORE = 0.9;

/** Rare caption / puzzle OOV (e.g. mangy) — ASR is often ~0.79–0.87 phonetic. */
export const CAPTION_OOV_RECOVERY_MIN_SCORE = 0.78;

/** Multi-token OOV phrases anchored on a rare word (e.g. mangy thing). */
export const CAPTION_OOV_PHRASE_RECOVERY_MIN_SCORE = 0.86;

/** Ordinary words that must not form split-tile recovery phrases (e.g. "scared me"). */
const ADJACENT_RECOVERY_LEAD_BLOCKLIST = new Set([
  "scared",
  "death",
  "heard",
  "house",
  "going",
  "people",
  "almost",
  "little",
  "great",
  "really",
]);

/** Max spoken tokens collapsed into one vocabulary phrase. */
const MAX_SPOKEN_WINDOW = 4;

/**
 * Ordinary English that must never be recovery targets.
 * False positives are worse than misses.
 */
const COMMON_WORD_BLOCKLIST = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "but",
  "if",
  "to",
  "of",
  "in",
  "on",
  "at",
  "for",
  "from",
  "with",
  "as",
  "by",
  "is",
  "am",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "i",
  "im",
  "ive",
  "id",
  "ill",
  "you",
  "youre",
  "youve",
  "he",
  "she",
  "it",
  "its",
  "we",
  "they",
  "them",
  "their",
  "this",
  "that",
  "these",
  "those",
  "what",
  "when",
  "where",
  "who",
  "whom",
  "which",
  "why",
  "how",
  "yes",
  "no",
  "not",
  "do",
  "does",
  "did",
  "done",
  "have",
  "has",
  "had",
  "can",
  "could",
  "would",
  "should",
  "will",
  "just",
  "so",
  "too",
  "very",
  "really",
  "almost",
  "short",
  "long",
  "hey",
  "oh",
  "ok",
  "okay",
  "well",
  "now",
  "then",
  "here",
  "there",
  "all",
  "any",
  "some",
  "one",
  "two",
  "my",
  "your",
  "his",
  "her",
  "our",
  "out",
  "up",
  "down",
  "about",
  "into",
  "over",
  "after",
  "before",
  "than",
  "me",
  "him",
  "us",
  "got",
  "get",
  "let",
  "put",
  "say",
  "see",
  "know",
  "think",
  "want",
  "like",
  "love",
  "born",
  "people",
  "kids",
  "mean",
  "heard",
  "house",
  "home",
  "come",
  "came",
  "go",
  "went",
  "going",
  "gone",
  "make",
  "made",
  "take",
  "took",
  "look",
  "looked",
  "tell",
  "told",
  "ask",
  "asked",
  "give",
  "gave",
  "keep",
  "kept",
  "call",
  "called",
  "try",
  "tried",
  "need",
  "needed",
  "feel",
  "felt",
  "leave",
  "left",
  "put",
  "set",
  "run",
  "ran",
  "move",
  "moved",
  "live",
  "lived",
  "believe",
  "something",
  "nothing",
  "everything",
  "someone",
  "anyone",
  "everyone",
  "thing",
  "things",
  "time",
  "way",
  "day",
  "man",
  "men",
  "woman",
  "women",
  "child",
  "children",
  "mother",
  "father",
  "friend",
  "friends",
  "right",
  "left",
  "good",
  "bad",
  "little",
  "big",
  "old",
  "new",
  "first",
  "last",
  "own",
  "other",
  "another",
  "same",
  "different",
  "back",
  "still",
  "even",
  "also",
  "only",
  "much",
  "many",
  "more",
  "most",
  "such",
  "through",
  "during",
  "without",
  "again",
  "never",
  "always",
  "often",
  "once",
  "twice",
]);

export type CaptionVocabularyEntry = {
  /** Surface form used when rewriting the transcript. */
  original: string;
  /** Normalized comparison form. */
  normalized: string;
  /** Normalized tokens of the phrase. */
  tokens: readonly string[];
  /** Why this entry is recoverable (entity gate). */
  reason: "capitalized" | "oov" | "proper_noun";
  /** Per-entry floor; defaults to {@link CAPTION_RECOVERY_MIN_SCORE}. */
  recoveryMinScore?: number;
};

export type CaptionRecoveryReplacement = {
  from: string;
  to: string;
  start: number;
  end: number;
  score: number;
};

export type RecoverCaptionVocabularyInput = {
  /** Normalized transcript text (post-Normalizer). */
  transcript: string;
  captionVocabulary: readonly CaptionVocabularyEntry[];
  /** Optional full caption tokens for local context scoring. */
  captionTokens?: readonly string[];
  minScore?: number;
};

export type RecoverCaptionVocabularyResult = {
  recoveredTranscript: string;
  replacements: readonly CaptionRecoveryReplacement[];
};

function recoveryDebugEnabled(): boolean {
  return (
    process.env.VOICE_MATCH_DEBUG === "1" ||
    process.env.NEXT_PUBLIC_STT_FALLBACK_DEBUG === "1" ||
    resolveSttFallbackConfig().debug
  );
}

function logRecoveries(replacements: readonly CaptionRecoveryReplacement[]): void {
  if (!recoveryDebugEnabled() || replacements.length === 0) return;
  // eslint-disable-next-line no-console -- debug-gated recovery trace
  console.log("Recovered:");
  for (const row of replacements) {
    // eslint-disable-next-line no-console -- debug-gated recovery trace
    console.log(`${row.from}\n→ ${row.to}`);
  }
}

function isCommonWord(normalized: string): boolean {
  return COMMON_WORD_BLOCKLIST.has(normalized);
}

function stripSurfacePunctuation(surface: string): string {
  return surface.replace(/^[^\w]+|[^\w]+$/g, "");
}

function isCapitalizedSurface(surface: string): boolean {
  const cleaned = stripSurfacePunctuation(surface);
  return cleaned.length > 0 && /^[A-Z]/.test(cleaned);
}

/**
 * Caption tokens that look like proper nouns / entities in the original
 * caption (capitalized, excluding ordinary sentence-initial common words).
 */
function collectCaptionEntityNorms(caption: string): Map<
  string,
  { surface: string; reason: "capitalized" | "oov" | "proper_noun" }
> {
  const entities = new Map<
    string,
    { surface: string; reason: "capitalized" | "oov" | "proper_noun" }
  >();
  const re = /[A-Za-z][A-Za-z']*/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(caption)) !== null) {
    const surface = match[0]!;
    const start = match.index;
    const before = caption.slice(0, start);
    const sentenceStart =
      before.trim().length === 0 || /[.!?…]["']?\s*$/.test(before);
    const normalized = normalizeText(surface);
    if (!normalized || isCommonWord(normalized)) continue;

    if (isCapitalizedSurface(surface)) {
      // Sentence-initial "Short" / "The" are common and already blocked.
      // Keep capitalized names even at sentence start (Wybie, Lovat, …).
      entities.set(normalized, {
        surface: stripSurfacePunctuation(surface) || surface,
        reason: sentenceStart ? "proper_noun" : "capitalized",
      });
      continue;
    }

    // Lowercase OOV / caption-specific rare tokens (not ordinary English).
    if (normalized.length >= 5 && !isCommonWord(normalized)) {
      if (!entities.has(normalized)) {
        entities.set(normalized, {
          surface: stripSurfacePunctuation(surface) || surface,
          reason: "oov",
        });
      }
    }
  }
  return entities;
}

function contiguousIndexOf(
  haystack: readonly string[],
  needle: readonly string[],
): number {
  if (needle.length === 0 || needle.length > haystack.length) return -1;
  for (let start = 0; start <= haystack.length - needle.length; start++) {
    const matches = needle.every(
      (token, offset) => haystack[start + offset] === token,
    );
    if (matches) return start;
  }
  return -1;
}

function phraseKey(tokens: readonly string[]): string {
  return tokens.join(" ");
}

function recoveryMinScoreForEntry(entry: CaptionVocabularyEntry): number {
  if (entry.recoveryMinScore != null) return entry.recoveryMinScore;
  if (entry.reason === "oov") {
    return entry.tokens.length > 1
      ? CAPTION_OOV_PHRASE_RECOVERY_MIN_SCORE
      : CAPTION_OOV_RECOVERY_MIN_SCORE;
  }
  return CAPTION_RECOVERY_MIN_SCORE;
}

/**
 * True when a longer spoken span is just an ordinary English phrase that
 * contains the target as an exact subspan (e.g. "to people" → "people").
 * Those must never be collapsed by recovery.
 */
export function isOrdinaryPhraseCollapse(
  spokenTokens: readonly string[],
  entryTokens: readonly string[],
): boolean {
  if (spokenTokens.length <= entryTokens.length) return false;
  const at = contiguousIndexOf(spokenTokens, entryTokens);
  if (at < 0) return false;
  const remaining = [
    ...spokenTokens.slice(0, at),
    ...spokenTokens.slice(at + entryTokens.length),
  ];
  return remaining.length > 0 && remaining.every((token) => isCommonWord(token));
}

/**
 * Build caption vocabulary for the loaded exercise.
 *
 * Recovery targets must appear in the caption and satisfy at least one of:
 * proper noun / capitalized in caption / OOV / explicit caption entity.
 * Ordinary English tiles (e.g. "to people") are never recovery targets.
 */
export function buildCaptionVocabulary(input: {
  caption: string;
  tileTexts?: readonly string[];
}): CaptionVocabularyEntry[] {
  const captionNorm = normalizeText(input.caption).trim();
  const captionTokens = tokenize(captionNorm);
  if (captionTokens.length === 0) return [];

  const entityNorms = collectCaptionEntityNorms(input.caption);
  if (entityNorms.size === 0) return [];

  const tileTexts =
    input.tileTexts && input.tileTexts.length > 0
      ? input.tileTexts
      : [input.caption];

  const byKey = new Map<string, CaptionVocabularyEntry>();

  const tryAdd = (
    original: string,
    tokens: readonly string[],
    reason: CaptionVocabularyEntry["reason"],
  ) => {
    if (tokens.length === 0) return;
    // Only pure entity phrases (e.g. "Wybie Lovat"). Never "I almost" —
    // recovering "almost" → "I almost" duplicates the leading "I".
    if (tokens.some((token) => isCommonWord(token))) return;
    if (contiguousIndexOf(captionTokens, tokens) < 0) return;
    // Every token must be a caption entity; no ordinary English targets.
    if (!tokens.every((token) => entityNorms.has(token))) return;

    const normalized = phraseKey(tokens);
    const existing = byKey.get(normalized);
    if (!existing || original.length > existing.original.length) {
      byKey.set(normalized, {
        original,
        normalized,
        tokens: [...tokens],
        reason,
      });
    }
  };

  for (const tileText of tileTexts) {
    const original = tileText.trim().replace(/\s+/g, " ");
    if (!original) continue;
    const tokens = tokenize(normalizeText(original));
    if (tokens.length === 0) continue;

    if (tokens.length === 1) {
      const meta = entityNorms.get(tokens[0]!);
      if (!meta) continue;
      tryAdd(meta.surface || original, tokens, meta.reason);
      continue;
    }

    // Multi-token tile in caption (e.g. "mangy thing", "Wybie Lovat").
    // Common glue ("thing") is allowed when entity/OOV tokens anchor the phrase.
    const content = tokens.filter((token) => !isCommonWord(token));
    if (content.length === 0) continue;
    if (!content.every((token) => entityNorms.has(token))) continue;
    if (contiguousIndexOf(captionTokens, tokens) < 0) continue;
    const reason =
      entityNorms.get(content[0]!)?.reason ?? ("proper_noun" as const);
    const normalized = phraseKey(tokens);
    const existing = byKey.get(normalized);
    if (!existing || original.length > existing.original.length) {
      byKey.set(normalized, {
        original,
        normalized,
        tokens: [...tokens],
        reason,
      });
    }

    for (const token of content) {
      const meta = entityNorms.get(token);
      if (!meta) continue;
      tryAdd(meta.surface, [token], meta.reason);
    }
  }

  // Split tiles that are adjacent in the caption (e.g. "mangy" + "thing").
  const singleTokenTileNorms = new Set<string>();
  for (const tileText of tileTexts) {
    const tt = tokenize(normalizeText(tileText));
    if (tt.length === 1) singleTokenTileNorms.add(tt[0]!);
  }
  for (let i = 0; i < captionTokens.length - 1; i++) {
    const lead = captionTokens[i]!;
    const tail = captionTokens[i + 1]!;
    if (!entityNorms.has(lead)) continue;
    if (ADJACENT_RECOVERY_LEAD_BLOCKLIST.has(lead)) continue;
    if (!singleTokenTileNorms.has(lead)) continue;
    if (!singleTokenTileNorms.has(tail)) continue;
    const tokens = [lead, tail];
    const normalized = phraseKey(tokens);
    if (byKey.has(normalized)) continue;
    const surf0 = entityNorms.get(lead)?.surface ?? lead;
    byKey.set(normalized, {
      original: `${surf0} ${tail}`,
      normalized,
      tokens: [...tokens],
      reason: entityNorms.get(lead)!.reason,
    });
  }

  // Caption entities that never appear as their own tile still recover
  // (e.g. name only inside a longer line).
  for (const [normalized, meta] of entityNorms) {
    if (byKey.has(normalized)) continue;
    if (contiguousIndexOf(captionTokens, [normalized]) < 0) continue;
    tryAdd(meta.surface, [normalized], meta.reason);
  }

  return [...byKey.values()].sort((left, right) => {
    if (right.tokens.length !== left.tokens.length) {
      return right.tokens.length - left.tokens.length;
    }
    return right.normalized.length - left.normalized.length;
  });
}

function editSimilarity(a: string, b: string): number {
  if (!a && !b) return 1;
  if (!a || !b) return 0;
  const dist = levenshtein(a, b);
  const maxLen = Math.max(a.length, b.length, 1);
  return Math.max(0, 1 - dist / maxLen);
}

function prefixSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;
  if (!longer.startsWith(shorter)) return 0;
  return shorter.length / longer.length;
}

function consonantSkeleton(normalized: string): string {
  return normalized.replace(/[aeiou]/g, "");
}

function initialismSimilarity(
  spokenJoined: string,
  targetNormalized: string,
): number {
  if (spokenJoined.length < 2 || targetNormalized.length < 3) return 0;
  const spoken = spokenJoined.replace(/[^a-z0-9]/g, "");
  if (spoken.length < 2) return 0;

  const skeleton = consonantSkeleton(targetNormalized);
  if (skeleton.length >= 2 && spoken === skeleton) return 0.96;
  if (skeleton.startsWith(spoken) && spoken.length >= 2) return 0.93;
  if (spoken === skeleton.replace(/w/g, "") && spoken.length >= 2) return 0.94;

  // Syllable initials: "wybie" → "wb" / allow y-drop "yb"
  const compact = targetNormalized.replace(/[^a-z]/g, "");
  const initials = compact.replace(/([aeiou])+/g, " ").trim().split(/\s+/)
    .map((chunk) => chunk[0] ?? "")
    .join("");
  if (initials.length >= 2 && (spoken === initials || spoken === initials.replace(/w/g, "y") || spoken === `y${initials.slice(1)}`)) {
    return 0.94;
  }

  return 0;
}

function contextBoost(input: {
  captionTokens: readonly string[] | undefined;
  vocabTokens: readonly string[];
  transcriptTokens: readonly string[];
  start: number;
  end: number;
}): number {
  const caption = input.captionTokens;
  if (!caption || caption.length === 0) return 0;

  const at = contiguousIndexOf(caption, input.vocabTokens);
  if (at < 0) return 0;

  let hits = 0;
  let checks = 0;
  const prevCap = caption[at - 1];
  const nextCap = caption[at + input.vocabTokens.length];
  const prevSpoken = input.transcriptTokens[input.start - 1];
  const nextSpoken = input.transcriptTokens[input.end + 1];

  if (prevCap) {
    checks += 1;
    if (prevSpoken && prevSpoken === prevCap) hits += 1;
  }
  if (nextCap) {
    checks += 1;
    if (nextSpoken && nextSpoken === nextCap) hits += 1;
  }
  if (checks === 0) return 0;
  return (hits / checks) * 0.05;
}

function scoreSpokenAgainstVocab(input: {
  spokenTokens: readonly string[];
  entry: CaptionVocabularyEntry;
  captionTokens?: readonly string[];
  transcriptTokens: readonly string[];
  start: number;
  end: number;
}): number {
  const spokenJoined = phraseKey(input.spokenTokens);
  const target = input.entry.normalized;

  if (!spokenJoined || !target) return 0;
  if (spokenJoined === target) return 1;
  if (isCommonWord(spokenJoined)) return 0;

  const edit = editSimilarity(spokenJoined, target);
  const phonetic =
    input.spokenTokens.length > 1
      ? scoreSpokenPhrasePhoneticDistance(target, input.spokenTokens).similarity
      : scoreTokenPhoneticDistance(target, spokenJoined).similarity;
  const prefix = prefixSimilarity(spokenJoined, target);
  const initialism = initialismSimilarity(spokenJoined, target);
  const context = contextBoost({
    captionTokens: input.captionTokens,
    vocabTokens: input.entry.tokens,
    transcriptTokens: input.transcriptTokens,
    start: input.start,
    end: input.end,
  });

  const blended =
    Math.max(
      phonetic,
      initialism,
      phonetic * 0.7 + edit * 0.2 + prefix * 0.1,
    ) + context;

  return Math.min(1, blended);
}

/**
 * True when `spokenTokens` over-consumes grammar around an entity:
 * a STRICT contiguous subspan already matches the same entity well enough
 * that the full window is not required (e.g. "caroline named", "the wybie").
 */
export function isEntityBoundaryViolation(
  spokenTokens: readonly string[],
  entry: CaptionVocabularyEntry,
  minScore: number,
  scoreSpan: (tokens: readonly string[]) => number,
): boolean {
  if (spokenTokens.length <= 1) return false;

  // Exact entity inside with only common leftovers — ordinary collapse.
  if (isOrdinaryPhraseCollapse(spokenTokens, entry.tokens)) return true;

  // Any proper subspan that already qualifies as this entity → neighbors are
  // outside the entity boundary and must not be swallowed.
  for (let size = 1; size < spokenTokens.length; size++) {
    for (let offset = 0; offset <= spokenTokens.length - size; offset++) {
      const sub = spokenTokens.slice(offset, offset + size);
      if (scoreSpan(sub) >= minScore) return true;
    }
  }
  return false;
}

/**
 * True when the user already said this span exactly as the caption has it —
 * either as a vocabulary entity or verbatim in the caption tokens.
 *
 * Recovery repairs *mishearings*. A span the caption itself contains was not
 * misheard, so rewriting it into a different, merely similar entity would be the
 * caption overruling the speaker ("famous" → "mouse", "mouse" → "Famous").
 *
 * Checks the whole window only: a legitimate multi-token repair whose subspan is
 * a caption word ("wybie lovet" → "Wybie Lovat") stays recoverable.
 */
export function isAlreadyCaptionVerbatim(input: {
  spokenTokens: readonly string[];
  vocabularyPhrases: ReadonlySet<string>;
  captionTokens: readonly string[] | undefined;
}): boolean {
  if (input.spokenTokens.length === 0) return false;
  if (input.vocabularyPhrases.has(phraseKey(input.spokenTokens))) return true;
  return (
    input.captionTokens != null &&
    contiguousIndexOf(input.captionTokens, input.spokenTokens) >= 0
  );
}

type ScoredCandidate = CaptionRecoveryReplacement & {
  entry: CaptionVocabularyEntry;
};

/**
 * Bounded token rewriter: repair ONE caption entity span at a time.
 * Never rewrites surrounding grammar. False negatives > corrupted structure.
 */
export function recoverCaptionVocabulary(
  input: RecoverCaptionVocabularyInput,
): RecoverCaptionVocabularyResult {
  const minScore = input.minScore ?? CAPTION_RECOVERY_MIN_SCORE;
  const transcript = input.transcript.trim();
  if (!transcript || input.captionVocabulary.length === 0) {
    return { recoveredTranscript: transcript, replacements: [] };
  }

  const transcriptTokens = tokenize(normalizeText(transcript));
  if (transcriptTokens.length === 0) {
    return { recoveredTranscript: transcript, replacements: [] };
  }

  // Single-token entities first for boundary checks; keep stable order.
  const vocab = [...input.captionVocabulary].sort((left, right) => {
    if (left.tokens.length !== right.tokens.length) {
      return left.tokens.length - right.tokens.length;
    }
    return right.normalized.length - left.normalized.length;
  });

  const vocabularyPhrases = new Set(
    input.captionVocabulary.map((entry) => entry.normalized),
  );

  const candidates: ScoredCandidate[] = [];

  for (const entry of vocab) {
    const entryMinScore =
      entry.recoveryMinScore ?? input.minScore ?? recoveryMinScoreForEntry(entry);

    const scoreSpan = (tokens: readonly string[]): number => {
      if (tokens.length === 0) return 0;
      // Synthetic indices — context boost is optional for subspan checks.
      return scoreSpokenAgainstVocab({
        spokenTokens: tokens,
        entry,
        captionTokens: input.captionTokens,
        transcriptTokens,
        start: 0,
        end: Math.max(0, tokens.length - 1),
      });
    };

    for (let start = 0; start < transcriptTokens.length; start++) {
      const maxWindow = Math.min(
        MAX_SPOKEN_WINDOW,
        transcriptTokens.length - start,
      );

      // Smallest valid entity span wins for this start+entity (never expand
      // into neighbors once a tighter span already qualifies).
      let bestForStart: ScoredCandidate | null = null;

      for (let size = 1; size <= maxWindow; size++) {
        const spokenTokens = transcriptTokens.slice(start, start + size);
        const spokenJoined = phraseKey(spokenTokens);
        if (!spokenJoined) continue;

        // Already this entity (normalized) — leave span untouched.
        // Surface casing is irrelevant to the matcher; never expand into neighbors.
        if (spokenJoined === entry.normalized) {
          break;
        }

        // The speaker already said a caption word — nothing to repair here.
        if (
          isAlreadyCaptionVerbatim({
            spokenTokens,
            vocabularyPhrases,
            captionTokens: input.captionTokens,
          })
        ) {
          continue;
        }

        if (isCommonWord(spokenJoined)) continue;

        if (
          isEntityBoundaryViolation(
            spokenTokens,
            entry,
            entryMinScore,
            scoreSpan,
          )
        ) {
          continue;
        }

        const score = scoreSpokenAgainstVocab({
          spokenTokens,
          entry,
          captionTokens: input.captionTokens,
          transcriptTokens,
          start,
          end: start + size - 1,
        });
        if (score < entryMinScore) continue;

        bestForStart = {
          from: spokenTokens.join(" "),
          to: entry.original,
          start,
          end: start + size - 1,
          score,
          entry,
        };
        // Smallest qualifying window only — never grow into grammar.
        break;
      }

      if (bestForStart) candidates.push(bestForStart);
    }
  }

  // Prefer higher score, then shorter spans (tighter entity bounds), then left-to-right.
  candidates.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    const leftSpan = left.end - left.start;
    const rightSpan = right.end - right.start;
    if (leftSpan !== rightSpan) return leftSpan - rightSpan;
    return left.start - right.start;
  });

  const occupied = new Set<number>();
  const chosen: CaptionRecoveryReplacement[] = [];

  for (const candidate of candidates) {
    let overlaps = false;
    for (let index = candidate.start; index <= candidate.end; index++) {
      if (occupied.has(index)) {
        overlaps = true;
        break;
      }
    }
    if (overlaps) continue;

    // Skip pure no-ops.
    const fromNorm = phraseKey(tokenize(normalizeText(candidate.from)));
    const toNorm = phraseKey(tokenize(normalizeText(candidate.to)));
    if (fromNorm === toNorm) continue;

    // Already have the full target covering this span — do not expand a
    // subspan (e.g. "almost" → "I almost" when transcript is already "I almost").
    const targetTokens = candidate.entry.tokens;
    if (targetTokens.length > candidate.end - candidate.start + 1) {
      const existingAt = contiguousIndexOf(transcriptTokens, targetTokens);
      if (
        existingAt >= 0 &&
        existingAt <= candidate.start &&
        existingAt + targetTokens.length - 1 >= candidate.end
      ) {
        continue;
      }
    }

    for (let index = candidate.start; index <= candidate.end; index++) {
      occupied.add(index);
    }
    chosen.push({
      from: candidate.from,
      to: candidate.to,
      start: candidate.start,
      end: candidate.end,
      score: candidate.score,
    });
  }

  chosen.sort((left, right) => left.start - right.start);

  if (chosen.length === 0) {
    return { recoveredTranscript: transcriptTokens.join(" "), replacements: [] };
  }

  const out: string[] = [];
  let cursor = 0;
  for (const replacement of chosen) {
    while (cursor < replacement.start) {
      out.push(transcriptTokens[cursor]!);
      cursor += 1;
    }
    // Preserve entity surface form; do not swallow neighbors into normalize join.
    const entityTokens = tokenize(replacement.to.trim());
    if (entityTokens.length > 0) out.push(...entityTokens);
    cursor = replacement.end + 1;
  }
  while (cursor < transcriptTokens.length) {
    out.push(transcriptTokens[cursor]!);
    cursor += 1;
  }

  logRecoveries(chosen);

  return {
    recoveredTranscript: out.join(" "),
    replacements: chosen,
  };
}
