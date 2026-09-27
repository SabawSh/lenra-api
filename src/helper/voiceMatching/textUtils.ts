import { normalizeSpeechToken, normalizeText } from "@/helper/speech/normalizer";
import { tokenize } from "@/helper/speech/tokenizer";

export function normalizeToken(token: string): string {
  return normalizeSpeechToken(token);
}

export function tokenizeTileText(text: string): string[] {
  const normalized = normalizeText(text);
  const tokens = tokenize(normalized);
  return tokens.length > 0 ? tokens : tokenize(text);
}

export function tileTokenCount(text: string): number {
  return tokenizeTileText(text).length;
}
