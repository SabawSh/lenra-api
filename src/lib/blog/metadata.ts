import type { BlogArticleDetail, BlogArticleListItem } from "./types";

function siteBaseUrl(): string {
  const base =
    process.env.NEXT_PUBLIC_BASE_URL?.trim() || "https://lenra.ir";
  return base.replace(/\/+$/, "");
}

export function blogListingCanonical(locale: string): string {
  const base = siteBaseUrl();
  return locale === "fa" ? `${base}/blog` : `${base}/${locale}/blog`;
}

export function blogArticleCanonical(
  article: BlogArticleDetail | BlogArticleListItem,
  locale: string,
): string {
  if (article.canonicalUrl?.trim()) {
    return article.canonicalUrl.trim();
  }
  const base = siteBaseUrl();
  const path = `/blog/${article.slug}`;
  return locale === "fa" ? `${base}${path}` : `${base}/${locale}${path}`;
}

export function blogArticleOpenGraphImage(
  article: BlogArticleDetail | BlogArticleListItem,
): string | undefined {
  const url = article.coverUrl?.trim();
  return url || undefined;
}
