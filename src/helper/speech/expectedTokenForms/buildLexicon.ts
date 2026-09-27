import type { VoiceMatchLexicon } from "@/helper/speech/voiceMatchLexicon";
import type { CmuDict } from "@/helper/speech/cmuDictLookup";
import {
  buildCanonicalLexicon,
  buildLexiconFromProviders,
  buildMergedLexiconView,
  mergeCanonicalWithTokenKnowledge,
  resolveTokenMatchLexicon,
} from "./mergedView";
import type { ExpectedTokenFormProvider } from "./types";

export function buildTokenMatchLexicon(
  tokens: Iterable<string>,
  providers: readonly ExpectedTokenFormProvider[],
): VoiceMatchLexicon {
  return buildLexiconFromProviders(tokens, providers);
}

export {
  buildCanonicalLexicon,
  buildMergedLexiconView,
  mergeCanonicalWithTokenKnowledge,
  resolveTokenMatchLexicon,
};

export function buildTokenMatchLexiconFromCmuDict(
  tokens: Iterable<string>,
  dict: CmuDict,
): VoiceMatchLexicon {
  return buildCanonicalLexicon(tokens, dict);
}
