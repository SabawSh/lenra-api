export type DictionaryEntryType = "word" | "phrase";

export type DictionaryExample = {
  en: string;
  fa: string;
};

export type DictionarySense = {
  id?: string | null;
  partOfSpeech: string | null;
  cefrLevel: string | null;
  ipa?: string | null;
  definitionEn: string | null;
  definitionFa: string | null;
  examples: DictionaryExample[];
};
