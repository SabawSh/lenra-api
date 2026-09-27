/** Public Blog CMS API types (consumer contract — camelCase JSON). */

export type MovieSourceExample = {
  clipId: string;
  english: string;
  persian: string;
};

export type TeachingExample = {
  english: string;
  persian: string;
};

export type ArticleBlock =
  | {
      type: "heading";
      level: 2 | 3;
      text: string;
    }
  | {
      type: "paragraph";
      text: string;
    }
  | {
      type: "expression_lesson";
      expression: string;
      expressionCanonical: string;
      category: string;
      meaningFa: string;
      contextualExplanation: string;
      source: MovieSourceExample;
      commonUses?: string[];
      additionalExamples?: TeachingExample[];
      grammarPattern?: string;
      usageExplanation?: string;
    }
  | {
      type: "vocabulary";
      word: string;
      pronunciation?: string;
      meaningFa: string;
      exampleEnglish?: string;
      examplePersian?: string;
      sourceClipId?: string;
      expressionCanonical?: string;
      expressionCategory?: string;
    }
  | {
      type: "dialogue";
      clipId: string;
      english: string;
      persian?: string;
    }
  | {
      type: "image";
      url: string;
      alt?: string;
    }
  | {
      type: "cta";
      text: string;
      href: string;
    };

export type BlogArticleListItem = {
  id: number;
  slug: string;
  title: string;
  excerpt: string | null;
  coverUrl: string | null;
  coverAlt: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  canonicalUrl: string | null;
  keywords: string[];
  publishedAt: string | null;
  updatedAt: string;
};

export type BlogArticleDetail = {
  slug: string;
  title: string;
  excerpt: string | null;
  coverUrl: string | null;
  coverAlt: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  canonicalUrl: string | null;
  keywords: string[] | null;
  publishedAt: string | null;
  updatedAt: string;
};

export type BlogArticlesResponse = {
  articles: BlogArticleListItem[];
};

export type BlogArticleResponse = {
  article: BlogArticleDetail;
  blocks: ArticleBlock[];
};

export type BlogFetchError = {
  kind: "config" | "network" | "http" | "parse";
  message: string;
  status?: number;
};

export type BlogArticlesResult =
  | { ok: true; articles: BlogArticleListItem[] }
  | { ok: false; error: BlogFetchError };

export type BlogArticleResult =
  | { ok: true; article: BlogArticleDetail; blocks: ArticleBlock[] }
  | { ok: false; error: BlogFetchError; notFound?: boolean };
