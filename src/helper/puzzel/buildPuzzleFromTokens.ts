import {
  cleanChunkDisplay,
  formatDisplayText,
  normalizeSpeechToken,
  normalizeText,
} from "@/helper/speech/normalizer";
import { tokenize } from "@/helper/speech/tokenizer";
import { normalizePartTokens } from "@/lib/learning/normalizePartLearningData";
import type { PuzzlePart } from "@/types/puzzle";
import type { PartToken } from "@/types/video";
import { seededShuffle } from "./seededShuffle";

type IndexedToken = PartToken & {
  norm: string;
  streamIndex: number;
};

const CONJUNCTIONS = new Set([
  "and",
  "but",
  "or",
  "so",
  "because",
  "while",
  "when",
  "if",
  "than",
]);

const CLAUSE_BREAK_AFTER = new Set([
  "is",
  "are",
  "was",
  "were",
  "am",
  "be",
  "been",
  "being",
  "do",
  "does",
  "did",
  "have",
  "has",
  "had",
]);

const PREPOSITIONS = new Set([
  "in",
  "on",
  "at",
  "for",
  "with",
  "from",
  "to",
  "of",
  "by",
  "about",
  "into",
  "through",
  "after",
  "before",
  "over",
  "under",
  "as",
]);

const ARTICLES = new Set(["a", "an", "the"]);

/**
 * Discourse markers and interjections that are valid as a standalone leading
 * chunk even though they contain only a single word.
 */
const INTERJECTIONS = new Set([
  "wait",
  "well",
  "oh",
  "hey",
  "listen",
  "look",
  "wow",
  "god",
  "okay",
  "ok",
  "yeah",
  "no",
  "really",
  "so",
  "right",
  "now",
  "alright",
  "sure",
  "hmm",
  "hm",
  "uh",
  "um",
]);

/**
 * Words that naturally begin a question or subordinate clause — good place to
 * start a new right-side chunk.
 */
const QUESTION_STARTERS = new Set([
  "do",
  "does",
  "did",
  "is",
  "are",
  "was",
  "were",
  "have",
  "has",
  "can",
  "could",
  "would",
  "should",
  "will",
  "what",
  "why",
  "how",
  "where",
  "when",
  "who",
  "which",
]);

/**
 * Auxiliary / modal verbs that must NOT be left dangling at the end of a
 * left-side chunk (e.g. "So does" | "he have a hump" is bad).
 */
const AUXILIARY_VERBS = new Set([
  "do",
  "does",
  "did",
  "is",
  "are",
  "was",
  "were",
  "have",
  "has",
  "had",
  "can",
  "could",
  "would",
  "should",
  "will",
  "may",
  "might",
  "must",
  "shall",
]);

/**
 * Never split these collocations.
 */
const HARD_BIGRAMS: readonly [string, string][] = [
  ["first", "kiss"],
  ["each", "other"],
  ["in", "that"],
  ["in", "this"],
  ["in", "the"],
  ["on", "the"],
  ["at", "the"],
  ["part", "of"],
  ["one", "of"],
  ["kind", "of"],
  ["lot", "of"],
];

/**
 * Never split phrasal verbs.
 */
const PHRASAL_VERBS: readonly [string, string][] = [
  ["give", "up"],
  ["look", "up"],
  ["look", "for"],
  ["look", "after"],
  ["break", "up"],
  ["figure", "out"],
  ["find", "out"],
  ["come", "back"],
  ["go", "on"],
  ["go", "out"],
  ["hang", "out"],
  ["hold", "on"],
  ["pick", "up"],
  ["put", "on"],
  ["take", "off"],
  ["turn", "on"],
  ["turn", "off"],
  ["wake", "up"],
  ["work", "out"],
  ["pay", "off"],
  ["run", "out"],
  ["set", "up"],
  ["show", "up"],
  ["stand", "up"],
  ["throw", "away"],
];

const WEAK_SINGLE_WORDS = new Set([
  "wait",
  "yeah",
  "okay",
  "ok",
  "oh",
  "hey",
  "well",
  "huh",
  "umm",
]);

const WEAK_TWO_WORD_PATTERNS = new Set([
  "does he",
  "does she",
  "did you",
  "are you",
  "is it",
  "can you",
  "will you",
  "have you",
  "do you",
]);

function tokenDisplayText(t: PartToken): string {
  const raw = t as PartToken & { value?: string };

  return formatDisplayText(String(t.text ?? raw.value ?? "").trim());
}

function tokenNorm(t: PartToken): string {
  return normalizeSpeechToken(t.normalized ?? tokenDisplayText(t));
}

function wordNorm(word: string): string {
  return normalizeSpeechToken(word);
}

/**
 * Split multi-word visible tokens into one indexed entry per word so chunking
 * and boundary scoring work when the pipeline stores phrase-level tiles.
 */
function expandVisibleToWords(visible: IndexedToken[]): IndexedToken[] {
  const out: IndexedToken[] = [];

  for (const t of visible) {
    const display = tokenDisplayText(t);
    const displayWords = tokenize(display);

    if (displayWords.length === 0) continue;

    if (displayWords.length === 1) {
      out.push({
        ...t,
        text: displayWords[0],
        norm: wordNorm(displayWords[0]),
      });
      continue;
    }

    for (let wi = 0; wi < displayWords.length; wi++) {
      out.push({
        ...t,
        id: `${t.id}#w${wi}`,
        text: displayWords[wi],
        norm: wordNorm(displayWords[wi]),
      });
    }
  }

  return out;
}

function sortTokens(tokens: PartToken[]): PartToken[] {
  return [...tokens].sort((a, b) => a.order - b.order);
}

function matchesPattern(
  tokens: IndexedToken[],
  start: number,
  pattern: readonly string[],
): boolean {
  if (start + pattern.length > tokens.length) return false;

  return pattern.every((w, j) => tokens[start + j].norm === w);
}

function collectProtectedSpans(
  tokens: IndexedToken[],
): Array<{ start: number; end: number }> {
  const spans: Array<{ start: number; end: number }> = [];

  const add = (start: number, len: number) => {
    spans.push({
      start,
      end: start + len,
    });
  };

  for (let i = 0; i < tokens.length; i++) {
    for (const pattern of [...PHRASAL_VERBS, ...HARD_BIGRAMS]) {
      if (matchesPattern(tokens, i, pattern)) {
        add(i, pattern.length);
      }
    }

    /**
     * infinitive verb:
     * to know
     * to eat
     */
    if (
      tokens[i].norm === "to" &&
      i + 1 < tokens.length &&
      tokens[i + 1].norm.length > 0
    ) {
      add(i, 2);
    }
  }

  spans.sort((a, b) => a.start - b.start);

  const merged: typeof spans = [];

  for (const span of spans) {
    const last = merged[merged.length - 1];

    if (last && span.start <= last.end) {
      last.end = Math.max(last.end, span.end);
    } else {
      merged.push({ ...span });
    }
  }

  return merged;
}

function splitForbidden(
  splitAt: number,
  spans: Array<{ start: number; end: number }>,
): boolean {
  return spans.some((s) => splitAt > s.start && splitAt < s.end);
}

const SENTENCE_END_PUNCTUATION = new Set([
  "period",
  "ellipsis",
  "exclamation",
  "question",
]);

function isSentenceEndPunctuationToken(t: PartToken): boolean {
  if (t.type !== "punctuation") {
    const raw = (t.normalized ?? t.text).trim();
    if (raw === "..." || /^…+$/.test(raw)) return true;
    return /^[.!?]$/.test(raw);
  }

  const pt = t.punctuationType ?? "";
  if (SENTENCE_END_PUNCTUATION.has(pt)) return true;

  const raw = (t.normalized ?? t.text).trim();
  if (raw === "..." || /^…+$/.test(raw)) return true;
  return /^[.!?]$/.test(raw);
}

/** True when `tokens[index]` starts a new sentence (previous token ends one). */
function isSentenceBoundary(tokens: PartToken[], index: number): boolean {
  if (index === 0) return false;
  const prev = tokens[index - 1];
  return isSentenceEndPunctuationToken(prev);
}

function hasPunctuationBetween(
  stream: PartToken[],
  leftStreamIdx: number,
  rightStreamIdx: number,
): boolean {
  for (let i = leftStreamIdx + 1; i < rightStreamIdx; i++) {
    const t = stream[i];

    if (t.visibleInPuzzle) continue;

    const raw = (t.normalized ?? t.text).trim();

    if (/^[,;:.!?…]+$/.test(raw) || raw === "...") {
      return true;
    }
  }

  return false;
}

function collectSentenceBoundaryIndices(
  visible: IndexedToken[],
  fullStream: PartToken[],
): number[] {
  const indices: number[] = [];
  for (let i = 1; i < visible.length; i++) {
    if (isSentenceBoundary(fullStream, visible[i].streamIndex)) {
      indices.push(i);
    }
  }
  return indices;
}

/** Single-word tile allowed on long sentences (discourse markers, not articles). */
function isStandaloneSingleWordChunk(norm: string): boolean {
  return INTERJECTIONS.has(norm);
}

function isWeakChunk(words: string[]): boolean {
  if (words.length === 0) return true;

  if (words.length === 1) {
    return WEAK_SINGLE_WORDS.has(words[0]);
  }

  if (words.length === 2) {
    return WEAK_TWO_WORD_PATTERNS.has(words.join(" ").toLowerCase());
  }

  return false;
}

function boundaryScore(
  visible: IndexedToken[],
  splitAt: number,
  protectedSpans: Array<{ start: number; end: number }>,
  fullStream: PartToken[],
): number {
  if (splitAt <= 0 || splitAt >= visible.length) return -Infinity;
  if (splitForbidden(splitAt, protectedSpans)) return -Infinity;

  const left = visible[splitAt - 1];
  const right = visible[splitAt];

  const l = left.norm;
  const r = right.norm;

  const leftSize = splitAt;
  const rightSize = visible.length - splitAt;

  let score = 0;

  // -----------------------------
  // Fragment size penalties
  // -----------------------------
  // A single leading interjection/discourse-marker is a valid chunk.
  // Everything else that creates a 1-word fragment is heavily penalised.
  if (leftSize === 1) {
    if (INTERJECTIONS.has(l)) {
      score += 30;
    } else {
      score -= 100;
    }
  } else if (leftSize === 2) {
    score -= 18;
  }

  if (rightSize === 1) {
    score -= 100;
  } else if (rightSize === 2) {
    score -= 18;
  }

  // -----------------------------
  // Prefer balanced chunks (softer than before)
  // -----------------------------
  const imbalance = Math.abs(leftSize - rightSize);
  score -= imbalance * 2.5;

  // -----------------------------
  // Grammar-aware splits
  // -----------------------------
  // "mouth" | "and tied it…"
  if (CONJUNCTIONS.has(r) && rightSize >= 2) {
    score += 16;
  }

  // "…mouth and" | "tied" — dangling conjunction on the left
  if (CONJUNCTIONS.has(l) && rightSize >= 2) {
    score -= 28;
  }

  if (CLAUSE_BREAK_AFTER.has(l)) score += 10;

  // Good to split immediately before a question / subordinate clause
  // (right side must be long enough to form a real clause)
  if (QUESTION_STARTERS.has(r) && rightSize >= 3) score += 15;

  // Orphaned auxiliary: "So does" | "he have a hump" — strongly penalised
  if (AUXILIARY_VERBS.has(l)) score -= 30;

  // split BEFORE preposition sounds weird
  if (PREPOSITIONS.has(r)) score -= 8;

  // don't end chunk with article
  if (ARTICLES.has(l)) score -= 14;

  // don't split after infinitive marker
  if (l === "to") score -= 20;

  // avoid tiny right fragment that starts with an existential pronoun
  if (
    ["something", "someone", "anything", "nothing", "everything"].includes(r) &&
    rightSize <= 2
  ) {
    score -= 18;
  }

  // -----------------------------
  // Punctuation boundaries
  // -----------------------------
  if (hasPunctuationBetween(fullStream, left.streamIndex, right.streamIndex)) {
    score += 18;
  }

  if (isSentenceBoundary(fullStream, right.streamIndex)) {
    return Infinity;
  }

  return score;
}

function getIdealChunkCount(
  wordCount: number,
  difficulty: string,
): number {
  if (difficulty === "easy") {
    // Easy: always 3 tiles when there are at least 3 visible words (e.g. 2+2+1 or 1+2+2).
    if (wordCount >= 3) return 3;
    return wordCount;
  }
  if (difficulty === "medium") {
    if (wordCount <= 4) return 1;
    if (wordCount <= 10) return 2;
    if (wordCount <= 16) return 3;
    return 4;
  }
  // hard
  if (wordCount <= 5) return 2;
  if (wordCount <= 12) return 3;
  return 4;
}

function partitionIndices(
  visible: IndexedToken[],
  chunkCount: number,
  fullStream: PartToken[],
  minChunkSize: number,
  /** When true, never collapse to a single chunk due to the short-sentence quality gate. */
  requireMinimumSplits: boolean,
): number[] {
  const n = visible.length;

  if (chunkCount <= 1) {
    return [0, n];
  }

  const protectedSpans = collectProtectedSpans(visible);
  const sentenceBoundaries = collectSentenceBoundaryIndices(visible, fullStream);
  const sentenceBoundarySet = new Set(sentenceBoundaries);

  const candidates: Array<{
    index: number;
    score: number;
  }> = [];

  for (let i = 1; i < n; i++) {
    let score = boundaryScore(visible, i, protectedSpans, fullStream);
    if (sentenceBoundarySet.has(i)) {
      score = Infinity;
    }

    if (score > -Infinity) {
      candidates.push({
        index: i,
        score,
      });
    }
  }

  candidates.sort((a, b) => b.score - a.score);

  const mandatorySplits = sentenceBoundaries.filter(
    (idx) => !splitForbidden(idx, protectedSpans),
  );
  const targetSplitCount = Math.max(
    chunkCount - 1,
    mandatorySplits.length,
  );

  // For short sentences require a semantically meaningful boundary.
  // If the best candidate doesn't clear the bar, stay as a single chunk
  // rather than falling back to a balanced-but-meaningless split.
  const MIN_SPLIT_QUALITY = 0;

  if (
    !requireMinimumSplits &&
    n <= 7 &&
    (candidates.length === 0 || candidates[0].score < MIN_SPLIT_QUALITY)
  ) {
    return [0, n];
  }

  // Greedily pick the highest-scoring splits while enforcing that every
  // resulting chunk spans at least minChunkSize visible tokens.
  // This prevents clusters of adjacent splits that create micro-chunks
  // which only get filtered out later (e.g. picking [4,5,6] for a 11-word sentence).
  const MIN_CHUNK_SIZE = minChunkSize;
  const chosen: number[] = [...mandatorySplits];

  const canAddSplit = (idx: number, force: boolean) => {
    const boundaries = [0, ...chosen, n].sort((a, b) => a - b);
    let leftBound = 0;
    let rightBound = n;
    for (const b of boundaries) {
      if (b < idx) leftBound = b;
      if (b > idx) {
        rightBound = b;
        break;
      }
    }
    if (force) return true;
    return (
      idx - leftBound >= MIN_CHUNK_SIZE && rightBound - idx >= MIN_CHUNK_SIZE
    );
  };

  for (const candidate of candidates) {
    if (chosen.length >= targetSplitCount) break;
    if (chosen.includes(candidate.index)) continue;

    if (!canAddSplit(candidate.index, sentenceBoundarySet.has(candidate.index))) {
      continue;
    }

    chosen.push(candidate.index);
  }

  chosen.sort((a, b) => a - b);

  /**
   * fallback balancing (only reached for longer sentences)
   */
  if (chosen.length < targetSplitCount) {
    const step = n / (targetSplitCount + 1);

    for (let i = 1; i < chunkCount; i++) {
      const idx = Math.round(step * i);

      if (
        idx > 0 &&
        idx < n &&
        !chosen.includes(idx) &&
        !splitForbidden(idx, protectedSpans)
      ) {
        chosen.push(idx);
      }
    }

    chosen.sort((a, b) => a - b);
  }

  return [0, ...chosen, n];
}

function mergeWeakChunks(parts: PuzzlePart[]): PuzzlePart[] {
  if (parts.length <= 1) {
    return parts;
  }

  const merged: PuzzlePart[] = [];

  let i = 0;

  while (i < parts.length) {
    const current = parts[i];

    const words = current.tokens.map((t) => t.toLowerCase());

    if (isWeakChunk(words) && i > 0) {
      const prev = merged[merged.length - 1];

      prev.text = `${prev.text} ${current.text}`.trim();

      prev.tokens = [...prev.tokens, ...current.tokens];

      i++;
      continue;
    }

    merged.push({
      ...current,
    });

    i++;
  }

  return merged;
}

function buildPartsFromSpans(
  visible: IndexedToken[],
  splits: number[],
): PuzzlePart[] {
  const parts: PuzzlePart[] = [];

  for (let c = 0; c < splits.length - 1; c++) {
    const start = splits[c];
    const end = splits[c + 1];

    const slice = visible.slice(start, end);

    if (slice.length === 0) continue;

    const text = cleanChunkDisplay(
      slice
        .map((t) => tokenDisplayText(t))
        .join(" ")
        .trim(),
    );

    if (!text) continue;

    const speechTokens = slice.flatMap((t) =>
      tokenize(normalizeText(t.normalized ?? tokenDisplayText(t))),
    );

    const wordCount = speechTokens.length;
    const locked = slice.every((t) => t.locked);

    // Fold stray single-word fragments (e.g. a lone article) into the previous
    // tile on long sentences. Discourse markers like "Really" stay as their own
    // tile. Never DROP a leading single word (parts.length === 0) — that lost
    // sentence-initial names like a lone "Wybie." before "And I'm…".
    if (
      wordCount <= 1 &&
      visible.length >= 8 &&
      !isStandaloneSingleWordChunk(speechTokens[0] ?? wordNorm(text))
    ) {
      if (parts.length > 0) {
        const prev = parts[parts.length - 1];
        prev.text = cleanChunkDisplay(`${prev.text} ${text}`);
        prev.tokens = [...prev.tokens, ...speechTokens];
      } else {
        // Leading orphan — keep as its own tile so content is not lost.
        parts.push({
          id: `chunk-${c}-${slice[0].id}-${slice[slice.length - 1].id}`,
          text,
          tokens: speechTokens,
          locked,
        });
      }
      continue;
    }

    parts.push({
      id: `chunk-${c}-${slice[0].id}-${slice[slice.length - 1].id}`,
      text,
      tokens: speechTokens,
      locked,
    });
  }

  // fallback
  if (parts.length === 0) {
    return [
      {
        id: "fallback",
        text: cleanChunkDisplay(
          visible.map((t) => tokenDisplayText(t)).join(" "),
        ),
        tokens: visible.flatMap((t) =>
          tokenize(normalizeText(t.normalized ?? tokenDisplayText(t))),
        ),
        locked: false,
      },
    ];
  }

  return parts;
}


/** Locked + hidden from pool — shown as fixed text before/after the puzzle placeholder. */
function isEdgeFixedToken(t: PartToken): boolean {
  return t.locked === true && t.visibleInPuzzle === false;
}

function joinEdgeFixedTexts(parts: string[]): string {
  let out = "";
  for (const text of parts) {
    if (!out) {
      out = text;
      continue;
    }
    const attachesWithoutSpace =
      /^[,.!?;:'")\]-]/.test(text) || /[("\[]$/.test(out);
    out += attachesWithoutSpace ? "" : " ";
    out += text;
  }
  return out;
}

export type SentenceEdgeFixed = {
  /** Fixed text before the puzzle dot placeholder. */
  leading: string;
  /** Fixed text after the puzzle dot placeholder. */
  trailing: string;
  /** Dot count for the draggable puzzle area (visible tokens only). */
  puzzlePlaceholderLength: number;
};

/**
 * Tokens with `locked` + `visibleInPuzzle: false` at stream edges.
 * Rendered beside the dot placeholder — never removed from the full sentence.
 */
export function extractSentenceEdgeFixed(
  tokens: PartToken[] | null | undefined,
): SentenceEdgeFixed {
  const normalized = normalizePartTokens(tokens ?? []) ?? [];
  if (normalized.length === 0) {
    return { leading: "", trailing: "", puzzlePlaceholderLength: 0 };
  }

  const stream = sortTokens(
    normalized.filter((t) => tokenDisplayText(t).length > 0),
  );

  const leadingParts: string[] = [];
  for (const t of stream) {
    if (!isEdgeFixedToken(t)) break;
    leadingParts.push(tokenDisplayText(t));
  }

  const trailingParts: string[] = [];
  for (let i = stream.length - 1; i >= 0; i--) {
    const t = stream[i];
    if (!isEdgeFixedToken(t)) break;
    trailingParts.unshift(tokenDisplayText(t));
  }

  const visibleTexts = stream
    .filter((t) => t.visibleInPuzzle)
    .map((t) => tokenDisplayText(t));

  return {
    leading: joinEdgeFixedTexts(leadingParts),
    trailing: joinEdgeFixedTexts(trailingParts),
    puzzlePlaceholderLength: visibleTexts.join(" ").length,
  };
}

/** @deprecated Use `extractSentenceEdgeFixed`. */
export function extractSentenceEdgePunctuation(
  tokens: PartToken[] | null | undefined,
): { leading: string; trailing: string } {
  const { leading, trailing } = extractSentenceEdgeFixed(tokens);
  return { leading, trailing };
}

export function buildPuzzleFromTokens(
  tokens: PartToken[] | unknown[],
  difficulty: "easy" | "medium" | "hard" = "medium",
  difficultyScore: number = 50,
  shuffleSeed?: string,
): {
  parts: PuzzlePart[];
  shuffled: PuzzlePart[];
} {
  void difficultyScore;

  const normalized = normalizePartTokens(tokens) ?? [];

  const stream = sortTokens(
    normalized.filter((t) => tokenDisplayText(t).length > 0),
  );

  const visibleRaw = stream.filter((t) => t.visibleInPuzzle);

  if (visibleRaw.length === 0) {
    return {
      parts: [],
      shuffled: [],
    };
  }

  const streamIndexById = new Map(stream.map((t, i) => [t.id, i]));

  const visible: IndexedToken[] = visibleRaw.map((t) => ({
    ...t,
    text: tokenDisplayText(t),
    norm: tokenNorm(t),
    streamIndex: streamIndexById.get(t.id) ?? 0,
  }));

  const visibleWords = expandVisibleToWords(visible);
  const wordCount = visibleWords.length;

  const ideal = getIdealChunkCount(wordCount, difficulty);
  let chunkCount = Math.min(ideal, wordCount);

  if (difficulty === "easy" && wordCount >= 3) {
    chunkCount = Math.max(3, Math.min(chunkCount, wordCount));
  }

  // Shorter easy sentences need min gap 1 so 5 words can split as 2+2+1 or 1+2+2.
  const minChunkSize =
    difficulty === "easy" && wordCount < 6 ? 1 : 2;

  const requireMinimumSplits =
    (difficulty === "easy" && chunkCount >= 3) ||
    (difficulty !== "easy" && wordCount >= 8 && chunkCount >= 2);

  const splits = partitionIndices(
    visibleWords,
    chunkCount,
    stream,
    minChunkSize,
    requireMinimumSplits,
  );

  const parts = buildPartsFromSpans(visibleWords, splits);

  const seed =
    shuffleSeed ??
    parts.map((p) => p.id).join("\0") + `\0${difficulty}`;

  return {
    parts,
    shuffled: seededShuffle(parts, seed),
  };
}

/**
 * @deprecated
 */
export function buildPuzzleFromDbTokens(tokens: PartToken[]) {
  return buildPuzzleFromTokens(tokens);
}
