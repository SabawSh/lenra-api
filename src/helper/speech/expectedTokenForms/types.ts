export type ExpectedTokenFormProviderContext = {
  /** Closed puzzle vocabulary — providers must not emit forms for unknown tokens. */
  readonly closedVocabulary: ReadonlySet<string>;
};

/**
 * Supplies alternate expected forms for a single tile token.
 * Implementations are independent (CMUdict, token knowledge, future providers).
 */
export interface ExpectedTokenFormProvider {
  readonly id: string;
  formsForToken(
    token: string,
    context: ExpectedTokenFormProviderContext,
  ): readonly string[];
}
