/**
 * Blog API parsing tests (pure — no network).
 *
 *   npm run test:blog-api
 */
import {
  parseArticleBlock,
  parseArticleListItem,
  parseArticleResponse,
  parseArticlesResponse,
} from "./parse";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

{
  const list = parseArticlesResponse({
    articles: [
      {
        id: 1,
        slug: "hello-world",
        title: "Hello",
        excerpt: "Excerpt",
        coverUrl: "https://example.com/c.jpg",
        coverAlt: "Cover",
        seoTitle: null,
        seoDescription: null,
        canonicalUrl: null,
        keywords: ["a"],
        publishedAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-02T00:00:00.000Z",
      },
    ],
  });
  assert(list != null && list.articles.length === 1, "list parse");
  assert(list!.articles[0]!.slug === "hello-world", "slug");
}

{
  const bad = parseArticlesResponse({ articles: [{ id: "x" }] });
  assert(bad != null && bad.articles.length === 0, "skip invalid list items");
}

{
  const block = parseArticleBlock({
    type: "expression_lesson",
    expression: "close off",
    expressionCanonical: "close off",
    category: "Phrasal verb",
    meaningFa: "مسدود کردن",
    contextualExplanation: "Used in the scene.",
    source: {
      clipId: "c1",
      english: "Close it off.",
      persian: "ببندش.",
    },
    additionalExamples: [{ english: "Close off the road.", persian: "جاده را ببند." }],
    grammarPattern: "close + off + object",
    usageExplanation: "Often imperative.",
  });
  assert(block?.type === "expression_lesson", "expression_lesson");
  assert(
    block && block.type === "expression_lesson" && block.additionalExamples?.length === 1,
    "additional examples",
  );
}

{
  const detail = parseArticleResponse({
    article: {
      slug: "s",
      title: "T",
      excerpt: null,
      coverUrl: null,
      coverAlt: null,
      seoTitle: null,
      seoDescription: null,
      canonicalUrl: null,
      keywords: null,
      publishedAt: null,
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    blocks: [
      { type: "paragraph", text: "Hi" },
      { type: "heading", level: 2, text: "Section" },
      {
        type: "dialogue",
        clipId: "x",
        english: "Hey",
        persian: "سلام",
      },
      { type: "vocabulary", word: "hey", meaningFa: "سلام" },
      { type: "unknown_type", foo: 1 },
    ],
  });
  assert(detail != null && detail.blocks.length === 4, "detail blocks filtered");
}

{
  const item = parseArticleListItem(null);
  assert(item === null, "null item");
}

console.log("blogApi.validation: ok");
