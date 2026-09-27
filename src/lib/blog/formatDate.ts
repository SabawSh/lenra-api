export function formatBlogDate(
  iso: string | null,
  locale: string,
): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(locale === "fa" ? "fa-IR" : "en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date);
}
