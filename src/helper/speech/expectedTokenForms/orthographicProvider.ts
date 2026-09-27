import { normalizeSpeechToken } from "@/helper/speech/normalizer";
import type {
  ExpectedTokenFormProvider,
  ExpectedTokenFormProviderContext,
} from "./types";

function normalizeLexiconKey(token: string): string {
  return normalizeSpeechToken(token);
}

/** Orthographic tile spelling only — never includes CMUdict or learned forms. */
export function createOrthographicProvider(): ExpectedTokenFormProvider {
  return {
    id: "canonical",
    formsForToken(
      token: string,
      context: ExpectedTokenFormProviderContext,
    ): readonly string[] {
      const key = normalizeLexiconKey(token);
      if (!key || !context.closedVocabulary.has(key)) return [];
      return [key];
    },
  };
}
