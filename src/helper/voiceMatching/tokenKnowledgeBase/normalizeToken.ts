import { normalizeSpeechToken } from "@/helper/speech/normalizer";

export function normalizeExpectedToken(token: string): string {
  return normalizeSpeechToken(token);
}

export function normalizeObservedToken(token: string): string {
  return normalizeSpeechToken(token);
}

export function expectedTokenKey(token: string): string {
  return normalizeExpectedToken(token);
}
