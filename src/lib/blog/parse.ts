import type {
  ArticleBlock,
  BlogArticleDetail,
  BlogArticleListItem,
  BlogArticleResponse,
  BlogArticlesResponse,
} from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function parseMovieSourceExample(
  value: unknown,
): { clipId: string; english: string; persian: string } | null {
  if (!isRecord(value)) return null;
  const clipId = asString(value.clipId);
  const english = asString(value.english);
  const persian = asString(value.persian);
  if (!clipId || !english || !persian) return null;
  return { clipId, english, persian };
}

function parseTeachingExample(
  value: unknown,
): { english: string; persian: string } | null {
  if (!isRecord(value)) return null;
  const english = asString(value.english);
  const persian = asString(value.persian);
  if (!english || !persian) return null;
  return { english, persian };
}

export function parseArticleBlock(value: unknown): ArticleBlock | null {
  if (!isRecord(value) || typeof value.type !== "string") return null;

  switch (value.type) {
    case "heading": {
      const text = asString(value.text);
      const level = value.level === 2 || value.level === 3 ? value.level : null;
      if (!text || level == null) return null;
      return { type: "heading", level, text };
    }
    case "paragraph": {
      const text = asString(value.text);
      if (!text) return null;
      return { type: "paragraph", text };
    }
    case "expression_lesson": {
      const expression = asString(value.expression);
      const expressionCanonical = asString(value.expressionCanonical);
      const category = asString(value.category);
      const meaningFa = asString(value.meaningFa);
      const contextualExplanation = asString(value.contextualExplanation);
      const source = parseMovieSourceExample(value.source);
      if (
        !expression ||
        !expressionCanonical ||
        !category ||
        !meaningFa ||
        !contextualExplanation ||
        !source
      ) {
        return null;
      }
      const commonUses = Array.isArray(value.commonUses)
        ? value.commonUses.filter((u): u is string => typeof u === "string")
        : undefined;
      const additionalExamples = Array.isArray(value.additionalExamples)
        ? value.additionalExamples
            .map(parseTeachingExample)
            .filter((x): x is NonNullable<typeof x> => x != null)
        : undefined;
      const grammarPattern = asString(value.grammarPattern) ?? undefined;
      const usageExplanation = asString(value.usageExplanation) ?? undefined;
      return {
        type: "expression_lesson",
        expression,
        expressionCanonical,
        category,
        meaningFa,
        contextualExplanation,
        source,
        commonUses,
        additionalExamples,
        grammarPattern,
        usageExplanation,
      };
    }
    case "vocabulary": {
      const word = asString(value.word);
      const meaningFa = asString(value.meaningFa);
      if (!word || !meaningFa) return null;
      return {
        type: "vocabulary",
        word,
        meaningFa,
        pronunciation: asString(value.pronunciation) ?? undefined,
        exampleEnglish: asString(value.exampleEnglish) ?? undefined,
        examplePersian: asString(value.examplePersian) ?? undefined,
        sourceClipId: asString(value.sourceClipId) ?? undefined,
        expressionCanonical: asString(value.expressionCanonical) ?? undefined,
        expressionCategory: asString(value.expressionCategory) ?? undefined,
      };
    }
    case "dialogue": {
      const clipId = asString(value.clipId);
      const english = asString(value.english);
      if (!clipId || !english) return null;
      return {
        type: "dialogue",
        clipId,
        english,
        persian: asString(value.persian) ?? undefined,
      };
    }
    case "image": {
      const url = asString(value.url);
      if (!url) return null;
      return {
        type: "image",
        url,
        alt: asString(value.alt) ?? undefined,
      };
    }
    case "cta": {
      const text = asString(value.text);
      const href = asString(value.href);
      if (!text || !href) return null;
      return { type: "cta", text, href };
    }
    default:
      return null;
  }
}

export function parseArticleListItem(value: unknown): BlogArticleListItem | null {
  if (!isRecord(value)) return null;
  const id = asNumber(value.id);
  const slug = asString(value.slug);
  const title = asString(value.title);
  const updatedAt = asString(value.updatedAt);
  if (id == null || !slug || !title || !updatedAt) return null;

  return {
    id,
    slug,
    title,
    excerpt: asString(value.excerpt),
    coverUrl: asString(value.coverUrl),
    coverAlt: asString(value.coverAlt),
    seoTitle: asString(value.seoTitle),
    seoDescription: asString(value.seoDescription),
    canonicalUrl: asString(value.canonicalUrl),
    keywords: asStringArray(value.keywords),
    publishedAt: asString(value.publishedAt),
    updatedAt,
  };
}

export function parseArticleDetail(value: unknown): BlogArticleDetail | null {
  if (!isRecord(value)) return null;
  const slug = asString(value.slug);
  const title = asString(value.title);
  const updatedAt = asString(value.updatedAt);
  if (!slug || !title || !updatedAt) return null;

  const keywordsRaw = value.keywords;
  const keywords =
    keywordsRaw == null
      ? null
      : asStringArray(keywordsRaw);

  return {
    slug,
    title,
    excerpt: asString(value.excerpt),
    coverUrl: asString(value.coverUrl),
    coverAlt: asString(value.coverAlt),
    seoTitle: asString(value.seoTitle),
    seoDescription: asString(value.seoDescription),
    canonicalUrl: asString(value.canonicalUrl),
    keywords,
    publishedAt: asString(value.publishedAt),
    updatedAt,
  };
}

export function parseArticlesResponse(body: unknown): BlogArticlesResponse | null {
  if (!isRecord(body) || !Array.isArray(body.articles)) return null;
  const articles = body.articles
    .map(parseArticleListItem)
    .filter((a): a is BlogArticleListItem => a != null);
  return { articles };
}

export function parseArticleResponse(body: unknown): BlogArticleResponse | null {
  if (!isRecord(body) || !isRecord(body.article) || !Array.isArray(body.blocks)) {
    return null;
  }
  const article = parseArticleDetail(body.article);
  if (!article) return null;
  const blocks = body.blocks
    .map(parseArticleBlock)
    .filter((b): b is ArticleBlock => b != null);
  return { article, blocks };
}
