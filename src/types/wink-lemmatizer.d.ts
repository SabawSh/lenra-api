declare module "wink-lemmatizer" {
  const lemmatize: {
    noun(word: string): string;
    verb(word: string): string;
    adjective(word: string): string;
  };

  export default lemmatize;
}
