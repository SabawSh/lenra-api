
import { cache } from "react";
import { getBlogApiBaseUrl } from "./config";
import { parseArticleResponse, parseArticlesResponse } from "./parse";
import type {
  BlogArticleResult,
  BlogArticlesResult,
  BlogFetchError,
} from "./types";

/** Published blog content — revalidate on a short interval so CMS publishes show up soon. */
const BLOG_REVALIDATE_SECONDS = 300;

async function blogFetch(path: string): Promise<
  | { ok: true; json: unknown }
  | { ok: false; error: BlogFetchError }
> {
  const base = getBlogApiBaseUrl();
  if (!base) {
    return {
      ok: false,
      error: {
        kind: "config",
        message: "BLOG_API_URL is not configured",
      },
    };
  }

  const url = `${base}${path.startsWith("/") ? path : `/${path}`}`;

  try {
    const res = await fetch(url, {
      next: { revalidate: BLOG_REVALIDATE_SECONDS, tags: ["blog"] },
    });

    if (!res.ok) {
      return {
        ok: false,
        error: {
          kind: "http",
          message: `Blog API responded with ${res.status}`,
          status: res.status,
        },
      };
    }

    const json: unknown = await res.json();
    return { ok: true, json };
  } catch {
    return {
      ok: false,
      error: {
        kind: "network",
        message: "Failed to reach the Blog API",
      },
    };
  }
}

export const getBlogArticles = cache(async (): Promise<BlogArticlesResult> => {
  const result = await blogFetch("/api/blog/articles");
  if (!result.ok) return result;

  const parsed = parseArticlesResponse(result.json);
  if (!parsed) {
    return {
      ok: false,
      error: { kind: "parse", message: "Invalid articles response from Blog API" },
    };
  }

  return { ok: true, articles: parsed.articles };
});

export const getBlogArticle = cache(
  async (slug: string): Promise<BlogArticleResult> => {
  const encoded = encodeURIComponent(slug);
  const result = await blogFetch(`/api/blog/articles/${encoded}`);
  if (!result.ok) {
    if (result.error.kind === "http" && result.error.status === 404) {
      return { ok: false, error: result.error, notFound: true };
    }
    return result;
  }

  const parsed = parseArticleResponse(result.json);
  if (!parsed) {
    return {
      ok: false,
      error: { kind: "parse", message: "Invalid article response from Blog API" },
    };
  }

  return {
    ok: true,
    article: parsed.article,
    blocks: parsed.blocks,
  };
  },
);
