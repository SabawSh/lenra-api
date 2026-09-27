import { normalizeToken } from "./textUtils";

export const STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "is",
  "are",
  "was",
  "were",
  "you",
  "i",
  "he",
  "she",
  "it",
  "they",
  "to",
  "of",
  "for",
  "in",
  "on",
  "at",
  "as",
  "or",
  "so",
  "do",
  "be",
  "by",
  "if",
  "no",
  "my",
  "we",
  "us",
  "am",
  "and",
]);

export function isStopword(token: string): boolean {
  return STOPWORDS.has(normalizeToken(token));
}

export function contentWords(tokens: readonly string[]): string[] {
  return tokens
    .map((token) => normalizeToken(token))
    .filter((token) => token.length > 0 && !isStopword(token));
}

export function isStopwordOnlyTile(tokens: readonly string[]): boolean {
  return tokens.length > 0 && contentWords(tokens).length === 0;
}

export function evidenceTokens(tileTokens: readonly string[]): string[] {
  if (isStopwordOnlyTile(tileTokens)) {
    return tileTokens.map((token) => normalizeToken(token)).filter(Boolean);
  }
  return contentWords(tileTokens);
}
