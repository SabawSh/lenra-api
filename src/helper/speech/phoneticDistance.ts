import { normalizeSpeechToken } from "@/helper/speech/normalizer";

/** Bidirectional phoneme confusion groups — low substitution penalty. */
const PHONEME_CONFUSION_GROUPS: readonly string[][] = [
  ["d", "t", "th"],
  ["b", "p"],
  ["v", "f", "w"],
  ["s", "z"],
  ["sh", "ch", "j", "tch"],
  ["g", "k"],
  ["r", "l"],
  ["m", "n"],
  ["ng", "n", "nd"],
];

/** Lax vowel groups — learner / ASR often merges these. */
const VOWEL_CONFUSION_GROUPS: readonly string[][] = [
  ["a", "u", "o", "ow"],
  ["e", "i"],
];

/** Precision guardrails — unrelated words that share surface similarity. */
const PHONETIC_DISTANCE_BLOCKED_PAIRS = new Set([
  "cat|car",
  "car|cat",
  "cap|cat",
  "cat|cap",
  "rod|red",
  "red|rod",
  "cut|cat",
  "cat|cut",
]);

const CONFUSION_SUBSTITUTION_COST = 0.22;
const VOWEL_SUBSTITUTION_COST = 0.15;
const CROSS_VOWEL_SUBSTITUTION_COST = 0.42;
const UNRELATED_SUBSTITUTION_COST = 1;
const INSERT_DELETE_COST = 0.32;
const WEAK_CONSONANT_DELETE_COST = 0.18;

const MULTIGRAPH_PHONEMES = [
  "tion",
  "sion",
  "ough",
  "tch",
  "dge",
  "ght",
  "sch",
  "tia",
  "cia",
  "qu",
  "ng",
  "nd",
  "dg",
  "ck",
  "ph",
  "wh",
  "wr",
  "kn",
  "gn",
  "pn",
  "ps",
  "mb",
  "th",
  "sh",
  "ch",
  "ow",
  "ou",
  "oo",
  "ea",
  "ee",
  "ai",
  "ay",
  "ey",
] as const;

const VOWEL_UNITS = new Set([
  "a",
  "e",
  "i",
  "o",
  "u",
  "y",
  "ow",
  "ou",
  "oo",
  "ea",
  "ee",
  "ai",
  "ay",
  "ey",
]);

const phonemeCache = new Map<string, string[]>();
const confusionLookup = new Map<string, Set<string>>();
const vowelConfusionLookup = new Map<string, Set<string>>();

for (const group of PHONEME_CONFUSION_GROUPS) {
  for (const left of group) {
    const peers = confusionLookup.get(left) ?? new Set<string>();
    for (const right of group) {
      if (right !== left) peers.add(right);
    }
    confusionLookup.set(left, peers);
  }
}

for (const group of VOWEL_CONFUSION_GROUPS) {
  for (const left of group) {
    const peers = vowelConfusionLookup.get(left) ?? new Set<string>();
    for (const right of group) {
      if (right !== left) peers.add(right);
    }
    vowelConfusionLookup.set(left, peers);
  }
}

export type PhonemeConfusionMatch = {
  expected: string;
  spoken: string;
  kind: "confusion" | "vowel";
};

export type PhoneticDistanceResult = {
  /** Normalized distance in [0, 1]. */
  distance: number;
  /** 1 - distance. */
  similarity: number;
  confusionMatches: PhonemeConfusionMatch[];
};

function pairKey(a: string, b: string): string {
  return `${normalizeSpeechToken(a)}|${normalizeSpeechToken(b)}`;
}

function isBlockedPair(a: string, b: string): boolean {
  return PHONETIC_DISTANCE_BLOCKED_PAIRS.has(pairKey(a, b));
}

function isVowelPhoneme(phoneme: string): boolean {
  return VOWEL_UNITS.has(phoneme);
}

function areConfusionPhonemes(a: string, b: string): boolean {
  if (a === b) return true;
  return confusionLookup.get(a)?.has(b) ?? false;
}

function areVowelConfusionPhonemes(a: string, b: string): boolean {
  if (a === b) return true;
  return vowelConfusionLookup.get(a)?.has(b) ?? false;
}

function substitutionCost(a: string, b: string): number {
  if (a === b) return 0;

  if (isVowelPhoneme(a) && isVowelPhoneme(b)) {
    if (areVowelConfusionPhonemes(a, b)) return VOWEL_SUBSTITUTION_COST;
    return CROSS_VOWEL_SUBSTITUTION_COST;
  }

  if (areConfusionPhonemes(a, b)) return CONFUSION_SUBSTITUTION_COST;
  return UNRELATED_SUBSTITUTION_COST;
}

function insertionDeletionCost(
  phoneme: string,
  isDeletion: boolean,
): number {
  void isDeletion;
  if (
    phoneme === "w" ||
    phoneme === "h" ||
    phoneme === "d" ||
    phoneme === "t" ||
    phoneme === "e"
  ) {
    return WEAK_CONSONANT_DELETE_COST;
  }
  if (isVowelPhoneme(phoneme)) return VOWEL_SUBSTITUTION_COST;
  return INSERT_DELETE_COST;
}

function collapseRepeatedPhonemes(phonemes: string[]): string[] {
  const out: string[] = [];
  for (const phoneme of phonemes) {
    if (out.at(-1) === phoneme) continue;
    out.push(phoneme);
  }
  return out;
}

function preprocessWord(norm: string): string {
  return norm
    .replace(/^kn/g, "n")
    .replace(/^gn/g, "n")
    .replace(/^pn/g, "n")
    .replace(/^ps/g, "s")
    .replace(/^wr/g, "r")
    .replace(/^wh/g, "w")
    .replace(/mb$/g, "m")
    .replace(/tion$/g, "shn")
    .replace(/sion$/g, "zhn")
    .replace(/ough/g, "uff")
    .replace(/ght/g, "t")
    .replace(/cia/g, "sh")
    .replace(/tia/g, "sh")
    .replace(/ph/g, "f")
    .replace(/qu/g, "kw")
    .replace(/ck/g, "k")
    .replace(/sch/g, "sk")
    .replace(/dg/g, "j")
    .replace(/([aeiou])\1+/g, "$1")
    .replace(/e$/g, "")
    .replace(/ou/g, "ow")
    .replace(/oo/g, "u")
    .replace(/ea/g, "e")
    .replace(/ee/g, "e")
    .replace(/ai/g, "a")
    .replace(/ay/g, "a")
    .replace(/ey/g, "e");
}

function pushPhoneme(out: string[], phoneme: string, prev: { value: string }): void {
  if (!phoneme || !/[a-zŋ]/.test(phoneme)) return;
  if (phoneme === prev.value) return;
  out.push(phoneme);
  prev.value = phoneme;
}

function finalizePhonemes(raw: string[]): string[] {
  const collapsed = collapseRepeatedPhonemes(raw);

  // Weak word-final /nd/ often heard as /n/ or /ng/.
  if (
    collapsed.length >= 2 &&
    collapsed.at(-2) === "n" &&
    collapsed.at(-1) === "d"
  ) {
    return collapsed.slice(0, -1);
  }

  return collapsed;
}

/**
 * Decompose a token into ordered phoneme units for weighted edit distance.
 * Keeps digraphs (th, sh, ch, ng, ow) as single units.
 */
export function tokenToPhonemes(token: string): string[] {
  const norm = normalizeSpeechToken(token);
  if (!norm) return [];

  const cached = phonemeCache.get(norm);
  if (cached) return cached;

  const w = preprocessWord(norm);
  const out: string[] = [];
  const prev = { value: "" };
  let i = 0;

  while (i < w.length) {
    let matchedMultigraph = false;

    for (const multigraph of MULTIGRAPH_PHONEMES) {
      if (!w.startsWith(multigraph, i)) continue;
      pushPhoneme(out, multigraph, prev);
      i += multigraph.length;
      matchedMultigraph = true;
      break;
    }

    if (matchedMultigraph) continue;

    const c = w[i]!;
    const next = w[i + 1] ?? "";
    i++;

    if (!/[a-zŋ]/.test(c)) continue;

    if (VOWEL_UNITS.has(c)) {
      pushPhoneme(out, c, prev);
      continue;
    }

    let mapped = c;
    if (c === "c") {
      mapped = /[eiy]/.test(next) ? "s" : "k";
    } else if (c === "g") {
      mapped = /[eiy]/.test(next) ? "j" : "g";
    } else if (c === "x") {
      pushPhoneme(out, "k", prev);
      pushPhoneme(out, "s", prev);
      continue;
    }

    pushPhoneme(out, mapped, prev);
  }

  const finalized = finalizePhonemes(out);
  phonemeCache.set(norm, finalized);
  return finalized;
}

/** Join phoneme sequences from multiple spoken tokens (e.g. "which thing"). */
export function tokensToPhonemes(tokens: readonly string[]): string[] {
  return tokens.flatMap((token) => tokenToPhonemes(token));
}

function classifySubstitution(
  left: string,
  right: string,
): PhonemeConfusionMatch | null {
  if (left === right) return null;
  if (isVowelPhoneme(left) && isVowelPhoneme(right)) {
    return { expected: left, spoken: right, kind: "vowel" };
  }
  if (areConfusionPhonemes(left, right)) {
    return { expected: left, spoken: right, kind: "confusion" };
  }
  return null;
}

function backtrackConfusionMatches(
  a: readonly string[],
  b: readonly string[],
  dp: number[][],
  i: number,
  j: number,
): PhonemeConfusionMatch[] {
  const matches: PhonemeConfusionMatch[] = [];

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && dp[i]![j] === dp[i - 1]![j - 1]!) {
      const left = a[i - 1]!;
      const right = b[j - 1]!;
      const match = classifySubstitution(left, right);
      if (match) matches.push(match);
      i--;
      j--;
      continue;
    }

    if (i > 0) {
      const delCost = insertionDeletionCost(a[i - 1]!, true);
      if (dp[i]![j] === dp[i - 1]![j]! + delCost) {
        i--;
        continue;
      }
    }

    if (j > 0) {
      const insCost = insertionDeletionCost(b[j - 1]!, false);
      if (dp[i]![j] === dp[i]![j - 1]! + insCost) {
        j--;
        continue;
      }
    }

    if (i > 0 && j > 0) {
      const left = a[i - 1]!;
      const right = b[j - 1]!;
      const match = classifySubstitution(left, right);
      if (match) matches.push(match);
      i--;
      j--;
      continue;
    }

    break;
  }

  return matches.reverse();
}

/**
 * Weighted phonetic edit distance between two phoneme sequences.
 * Returns normalized distance in [0, 1] and confusion pair annotations.
 */
export function weightedPhoneticEditDistance(
  expectedPhonemes: readonly string[],
  spokenPhonemes: readonly string[],
): PhoneticDistanceResult {
  const a = [...expectedPhonemes];
  const b = [...spokenPhonemes];

  if (a.length === 0 && b.length === 0) {
    return { distance: 0, similarity: 1, confusionMatches: [] };
  }

  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    Array(n + 1).fill(0),
  );

  for (let i = 0; i <= m; i++) {
    dp[i]![0] = i > 0 ? dp[i - 1]![0]! + insertionDeletionCost(a[i - 1]!, true) : 0;
  }
  for (let j = 0; j <= n; j++) {
    dp[0]![j] = j > 0 ? dp[0]![j - 1]! + insertionDeletionCost(b[j - 1]!, false) : 0;
  }

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const subCost = substitutionCost(a[i - 1]!, b[j - 1]!);
      dp[i]![j] = Math.min(
        dp[i - 1]![j]! + insertionDeletionCost(a[i - 1]!, true),
        dp[i]![j - 1]! + insertionDeletionCost(b[j - 1]!, false),
        dp[i - 1]![j - 1]! + subCost,
      );
    }
  }

  const rawCost = dp[m]![n]!;
  const maxLen = Math.max(m, n, 1);
  const maxPossible = maxLen * UNRELATED_SUBSTITUTION_COST;
  const distance = Math.min(1, rawCost / maxPossible);
  const confusionMatches = backtrackConfusionMatches(a, b, dp, m, n);

  return {
    distance,
    similarity: Math.max(0, 1 - distance),
    confusionMatches,
  };
}

/** Token-level phonetic distance via phoneme decomposition. */
export function scoreTokenPhoneticDistance(
  expected: string,
  spoken: string,
): PhoneticDistanceResult {
  const expectedNorm = normalizeSpeechToken(expected);
  const spokenNorm = normalizeSpeechToken(spoken);
  if (!expectedNorm || !spokenNorm) {
    return { distance: 1, similarity: 0, confusionMatches: [] };
  }
  if (isBlockedPair(expectedNorm, spokenNorm)) {
    return { distance: 1, similarity: 0, confusionMatches: [] };
  }
  if (expectedNorm === spokenNorm) {
    return { distance: 0, similarity: 1, confusionMatches: [] };
  }

  return weightedPhoneticEditDistance(
    tokenToPhonemes(expectedNorm),
    tokenToPhonemes(spokenNorm),
  );
}

/** Multi-token spoken phrase vs single expected token (e.g. "which thing" ↔ "witching"). */
export function scoreSpokenPhrasePhoneticDistance(
  expected: string,
  spokenTokens: readonly string[],
): PhoneticDistanceResult {
  const expectedNorm = normalizeSpeechToken(expected);
  if (!expectedNorm || spokenTokens.length === 0) {
    return { distance: 1, similarity: 0, confusionMatches: [] };
  }

  const spokenNorms = spokenTokens
    .map((token) => normalizeSpeechToken(token))
    .filter(Boolean);
  if (spokenNorms.some((token) => isBlockedPair(expectedNorm, token))) {
    return { distance: 1, similarity: 0, confusionMatches: [] };
  }

  return weightedPhoneticEditDistance(
    tokenToPhonemes(expectedNorm),
    tokensToPhonemes(spokenNorms),
  );
}

/** Clear memoized phoneme decompositions (tests only). */
export function clearPhonemeCache(): void {
  phonemeCache.clear();
}
