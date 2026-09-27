import type { CmuDict } from "@/helper/speech/cmuDictLookup";
import type { VoiceMatchLexicon } from "@/helper/speech/voiceMatchLexicon";
import { normalizeSpeechToken } from "@/helper/speech/normalizer";
import type { TokenKnowledgeBase } from "@/helper/voiceMatching/tokenKnowledgeBase/types";
import { createCmuDictProviderFromDict } from "./cmuDictProvider";
import { buildMergedLexiconView } from "./mergedView";
import { createOrthographicProvider } from "./orthographicProvider";
import { createTokenKnowledgeProvider } from "./tokenKnowledgeProvider";
import { createVariantFormProvider } from "./variantFormProvider";
import type { ExpectedTokenFormProviderContext } from "./types";

export type ExplainedTokenForms = {
  token: string;
  canonical: readonly string[];
  variants: readonly string[];
  cmu: readonly string[];
  learned: readonly string[];
  final: readonly string[];
};

export type ExplainExpectedFormsInput = {
  canonicalLexicon?: VoiceMatchLexicon;
  dict?: CmuDict;
  tokenKnowledge?: TokenKnowledgeBase;
  closedVocabulary?: ReadonlySet<string>;
};

/**
 * Diagnostics-only breakdown of expected forms by provider layer.
 * Not used by the matcher and not on the speech hot path.
 */
export function explainExpectedForms(
  token: string,
  input: ExplainExpectedFormsInput = {},
): ExplainedTokenForms {
  const key = normalizeSpeechToken(token);
  if (!key) {
    return {
      token,
      canonical: [],
      variants: [],
      cmu: [],
      learned: [],
      final: [],
    };
  }

  const closedVocabulary =
    input.closedVocabulary ??
    (input.canonicalLexicon ? new Set(input.canonicalLexicon.keys()) : new Set([key]));
  const context: ExpectedTokenFormProviderContext = { closedVocabulary };

  const orthographic = createOrthographicProvider();
  const canonical = orthographic.formsForToken(key, context);
  const variants = createVariantFormProvider().formsForToken(key, context);
  const cmu = input.dict
    ? createCmuDictProviderFromDict(input.dict).formsForToken(key, context)
    : [];
  const learned = input.tokenKnowledge
    ? createTokenKnowledgeProvider(input.tokenKnowledge).formsForToken(key, context)
    : [];

  const final =
    input.canonicalLexicon && input.tokenKnowledge
      ? (buildMergedLexiconView(input.canonicalLexicon, input.tokenKnowledge).get(
          key,
        ) ?? [])
      : [...new Set([...canonical, ...variants, ...cmu, ...learned])].sort(
          (left, right) => {
            if (left === key) return -1;
            if (right === key) return 1;
            return left.localeCompare(right);
          },
        );

  return {
    token: key,
    canonical,
    variants,
    cmu,
    learned,
    final,
  };
}