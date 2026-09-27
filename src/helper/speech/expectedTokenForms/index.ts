export type {
  ExpectedTokenFormProvider,
  ExpectedTokenFormProviderContext,
} from "./types";

export {
  buildCmuDictTokenForms,
  buildCmuDictSurfacesOnly,
  buildTokenMatchForms,
  createCmuDictProvider,
  createCmuDictProviderFromDict,
  getCmuDictProvider,
} from "./cmuDictProvider";

export { createOrthographicProvider } from "./orthographicProvider";

export {
  clearEnglishNormalizationVariantIndexForTests,
  createVariantFormProvider,
  getEnglishNormalizationVariantIndex,
} from "./variantFormProvider";

export { createTokenKnowledgeProvider } from "./tokenKnowledgeProvider";

export {
  closedVocabularyFromTokens,
  mergeExpectedTokenForms,
} from "./mergeForms";

export {
  buildCanonicalLexicon,
  buildMergedLexiconView,
  buildTokenMatchLexicon,
  buildTokenMatchLexiconFromCmuDict,
  mergeCanonicalWithTokenKnowledge,
  resolveTokenMatchLexicon,
} from "./buildLexicon";

export {
  explainExpectedForms,
  type ExplainedTokenForms,
  type ExplainExpectedFormsInput,
} from "./explainForms";

export {
  cacheMergedVoiceMatchLexicon,
  clearVoiceMatchLexiconSession,
  createVoiceMatchLexiconSession,
  refreshCachedMergedVoiceMatchLexicon,
  type VoiceMatchLexiconSession,
} from "./lexiconCache";
