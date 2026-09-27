/** Maps filter genre values from `helper/content` to `contentLibrary.filters.genres` keys. */
export const GENRE_I18N_KEYS: Record<string, string> = {
  "Sci‑Fi": "scifi",
  Mystery: "mystery",
  Crime: "crime",
  Drama: "drama",
  Fantasy: "fantasy",
  Thriller: "thriller",
  Adventure: "adventure",
  Action: "action",
  Comedy: "comedy",
  Romance: "romance",
  Horror: "horror",
  Animation: "animation",
  Biography: "biography",
};

const GENRE_I18N_VALUES = new Set(Object.values(GENRE_I18N_KEYS));

/** Join multiple labels for cover cards and metadata chips (e.g. `A1 - B2`). */
export function joinVideoMetaLabels(labels: string[]): string {
  return labels.filter(Boolean).join(" - ");
}

/** Resolves a stored genre string to a `contentLibrary.filters.genres` translation key. */
export function resolveGenreI18nKey(genre: string): string | null {
  const mapped = GENRE_I18N_KEYS[genre];
  if (mapped) return mapped;

  const title =
    genre.charAt(0).toUpperCase() + genre.slice(1).toLowerCase();
  const fromTitle = GENRE_I18N_KEYS[title];
  if (fromTitle) return fromTitle;

  const lower = genre.toLowerCase();
  return GENRE_I18N_VALUES.has(lower) ? lower : null;
}
