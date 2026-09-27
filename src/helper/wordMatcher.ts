import { normalizeText } from "./speech/normalizer";

export function matchWords(targetSentence: string, userSentence: string) {
  const targetWords = normalizeText(targetSentence).trim().split(/\s+/).filter(Boolean);
  const userWords = normalizeText(userSentence).trim().split(/\s+/).filter(Boolean);

  const result = targetWords.map((word) => ({
    target: word,
    matched: userWords.includes(word),
  }));

  return result;
}
