/** Coerce JSON column / parsed JSON to `string[]`. */
export function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

/** Serialize `string[]` for MySQL JSON columns. */
export function toJsonStringArray(value: string[]): string {
  return JSON.stringify(value);
}

export function mapVideoGenres<T extends { genres: unknown }>(
  row: T,
): Omit<T, "genres"> & { genres: string[] } {
  const { genres, ...rest } = row;
  return { ...rest, genres: asStringArray(genres) };
}

export function mapVideoLevels<T extends { levels: unknown }>(
  row: T,
): Omit<T, "levels"> & { levels: string[] } {
  const { levels, ...rest } = row;
  return { ...rest, levels: asStringArray(levels) };
}
