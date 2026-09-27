import { normalizeText } from "@/helper/speech/normalizer";

export function normalizeExpectedPhrase(phrase: string): string {
  return normalizeText(phrase).trim();
}

export function normalizeObservedPhrase(phrase: string): string {
  return normalizeText(phrase).trim();
}

export function expectedPhraseKey(phrase: string): string {
  return normalizeExpectedPhrase(phrase).toLowerCase();
}
