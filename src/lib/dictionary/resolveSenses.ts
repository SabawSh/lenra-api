import type { DictionarySense } from "@/lib/dictionary/types";

const CEFR_SORT_ORDER: Record<string, number> = {
  A1: 0,
  A2: 1,
  B1: 2,
  B2: 3,
  C1: 4,
  C2: 5,
};

export type DictionaryPresentation = {
  /** Sense matched from the caption token's senseId. */
  contextualSense: DictionarySense | null;
  /** Remaining senses from the same lemma, or all senses when not contextual. */
  otherSenses: DictionarySense[];
  /** True when a caption senseId matched a sense on this entry. */
  isContextual: boolean;
};

export type ResolveDictionaryPresentationOptions = {
  preferredSenseId?: string | null;
};

function sortSensesByUsefulness(senses: DictionarySense[]): DictionarySense[] {
  return [...senses].sort((a, b) => {
    const aOrder =
      CEFR_SORT_ORDER[a.cefrLevel?.trim().toUpperCase() ?? ""] ?? 99;
    const bOrder =
      CEFR_SORT_ORDER[b.cefrLevel?.trim().toUpperCase() ?? ""] ?? 99;
    if (aOrder !== bOrder) return aOrder - bOrder;
    return 0;
  });
}

function senseHasContent(sense: DictionarySense): boolean {
  return Boolean(
    sense.definitionEn?.trim() ||
      sense.definitionFa?.trim() ||
      sense.examples.length > 0 ||
      sense.partOfSpeech?.trim(),
  );
}

/**
 * Resolve an entry's senses into contextual (caption) vs other meanings.
 * All meaning data lives on senses — there are no lemma-level definitions.
 */
export function resolveDictionaryPresentation(
  entry: { senses?: DictionarySense[] | null },
  options?: ResolveDictionaryPresentationOptions,
): DictionaryPresentation {
  const senses = sortSensesByUsefulness(
    (entry.senses ?? []).filter(senseHasContent),
  );

  if (!senses.length) {
    return { contextualSense: null, otherSenses: [], isContextual: false };
  }

  const preferredId = options?.preferredSenseId?.trim();
  if (preferredId) {
    const matchIndex = senses.findIndex(
      (sense) => sense.id?.trim() === preferredId,
    );
    if (matchIndex >= 0) {
      return {
        contextualSense: senses[matchIndex],
        otherSenses: senses.filter((_, index) => index !== matchIndex),
        isContextual: true,
      };
    }
  }

  return {
    contextualSense: null,
    otherSenses: senses,
    isContextual: false,
  };
}

/** @deprecated Use resolveDictionaryPresentation */
export function resolveDictionarySenses(
  entry: { senses?: DictionarySense[] | null },
  options?: ResolveDictionaryPresentationOptions,
): DictionarySense[] {
  const presentation = resolveDictionaryPresentation(entry, options);
  return presentation.contextualSense
    ? [presentation.contextualSense, ...presentation.otherSenses]
    : presentation.otherSenses;
}
