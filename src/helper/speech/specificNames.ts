import { normalizeSpeechToken } from "@/helper/speech/normalizer";
import { levenshtein } from "@/utils/pronunciation";

/**
 * Proper nouns and nicknames that ASR often mis-hears or spells differently
 * from puzzle tiles (especially Friends character names).
 *
 * First entry in each group is the canonical form used when rewriting voice text.
 */
export const SPECIFIC_NAME_ALIAS_GROUPS: readonly string[][] = [
  [
    "pheebs",
    "phoebe",
    "pheebe",
    "pheebi",
    "phebe",
    "feebs",
    "fees",
    "feeds",
    "fibs",
    "fibbs",
    "fib",
    "fiv",
    "fivs",
    "fives",
    "libs",
    "lips",
    "febus",
    "phebus",
  ],
  ["rachel", "rach"],
  ["ross", "rosss"],
  ["monica", "mon"],
  ["chandler", "chan"],
  ["joey", "joe"],
  ["janice"],
  ["gunther", "gunter"],
  ["carol"],
  ["susan"],
  ["ben"],
  ["emma"],
  ["richard"],
];

const SPECIFIC_NAME_GROUP_BY_TOKEN = new Map<string, number>();
const CANONICAL_BY_GROUP = new Map<number, string>();

/** Max edit distance when matching ASR output to a known alias (e.g. fib → fibs). */
/** Shared with pipeline fingerprint — traced rewrite path only. */
export const FUZZY_NAME_LEVENSHTEIN_MAX = 2;
const MIN_FUZZY_ALIAS_LENGTH = 3;

/** Never fuzzy-rewrite or fuzzy-match these — they collide with name aliases (hey ≈ joe). */
const COMMON_WORD_BLOCKLIST = new Set([
  "hey",
  "you",
  "the",
  "yes",
  "no",
  "so",
  "oh",
  "ok",
  "okay",
  "well",
  "now",
  "why",
  "how",
  "who",
  "her",
  "him",
  "his",
  "she",
  "our",
  "out",
  "one",
  "two",
  "too",
  "all",
  "any",
  "can",
  "may",
  "got",
  "get",
  "let",
  "put",
  "say",
  "see",
  "way",
  "day",
  "man",
  "men",
  "new",
  "old",
  "big",
  "bad",
  "god",
]);

for (let groupId = 0; groupId < SPECIFIC_NAME_ALIAS_GROUPS.length; groupId++) {
  const group = SPECIFIC_NAME_ALIAS_GROUPS[groupId];
  CANONICAL_BY_GROUP.set(groupId, normalizeSpeechToken(group[0]));
  for (const alias of group) {
    SPECIFIC_NAME_GROUP_BY_TOKEN.set(normalizeSpeechToken(alias), groupId);
  }
}

function nameGroupIdExact(norm: string): number | undefined {
  return SPECIFIC_NAME_GROUP_BY_TOKEN.get(norm);
}

function nameGroupIdFuzzyInGroup(
  norm: string,
  groupId: number,
): boolean {
  if (COMMON_WORD_BLOCKLIST.has(norm)) return false;
  if (norm.length < MIN_FUZZY_ALIAS_LENGTH) return false;

  for (const alias of SPECIFIC_NAME_ALIAS_GROUPS[groupId]) {
    const aliasNorm = normalizeSpeechToken(alias);
    if (Math.abs(norm.length - aliasNorm.length) > FUZZY_NAME_LEVENSHTEIN_MAX) {
      continue;
    }
    if (levenshtein(norm, aliasNorm) <= FUZZY_NAME_LEVENSHTEIN_MAX) {
      return true;
    }
  }
  return false;
}

/** True when spoken and puzzle tokens refer to the same known name identity. */
export function specificNameTokensMatch(
  spokenNorm: string,
  partNorm: string,
): boolean {
  if (!spokenNorm || !partNorm) return false;

  const partGroup = nameGroupIdExact(partNorm);
  if (partGroup === undefined) return false;
  if (nameGroupIdExact(spokenNorm) === partGroup) return true;
  return nameGroupIdFuzzyInGroup(spokenNorm, partGroup);
}

/** Canonical puzzle form for a spoken alias (exact alias hits only). */
export function resolveCanonicalNameFromSpeech(norm: string): string | null {
  if (COMMON_WORD_BLOCKLIST.has(norm)) return null;
  const groupId = nameGroupIdExact(norm);
  if (groupId === undefined) return null;
  return CANONICAL_BY_GROUP.get(groupId) ?? null;
}

/**
 * Rewrite voice transcript tokens so ASR nicknames (e.g. fibs, fib) become
 * canonical names (pheebs) before chunk matching.
 */
export function rewriteSpeechTextWithKnownNames(text: string): string {
  if (!text) return text;
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => {
      const canonical = resolveCanonicalNameFromSpeech(
        normalizeSpeechToken(word),
      );
      return canonical ?? word;
    })
    .join(" ");
}

/** All normalized aliases for a group id (for debugging / future UI hints). */
export function getSpecificNameAliases(groupId: number): string[] {
  const group = SPECIFIC_NAME_ALIAS_GROUPS[groupId];
  return group ? group.map((a) => normalizeSpeechToken(a)) : [];
}
