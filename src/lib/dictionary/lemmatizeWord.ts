import lemmatize from "wink-lemmatizer";

const IRREGULAR_LEMMAS: Record<string, string> = {
  am: "be",
  is: "be",
  are: "be",
  was: "be",
  were: "be",
  been: "be",
  being: "be",
  went: "go",
  gone: "go",
  did: "do",
  done: "do",
  had: "have",
  has: "have",
  having: "have",
};

export function lemmatizeWord(normalized: string): string {
  const lower = normalized.trim().toLowerCase();
  if (!lower) {
    return lower;
  }

  const irregular = IRREGULAR_LEMMAS[lower];
  if (irregular) {
    return irregular;
  }

  const verbLemma = lemmatize.verb(lower);
  if (verbLemma !== lower) {
    return verbLemma;
  }

  const nounLemma = lemmatize.noun(lower);
  if (nounLemma !== lower) {
    return nounLemma;
  }

  const adjectiveLemma = lemmatize.adjective(lower);
  if (adjectiveLemma !== lower) {
    return adjectiveLemma;
  }

  return lower;
}
