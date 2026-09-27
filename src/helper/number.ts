export type NumberLocaleTag = "fa-IR" | "en-US";

/** Intl locale tag for numbers (and dates) from app locale (`fa` | `en`). */
export function getNumberLocale(locale: string): NumberLocaleTag {
  return locale.toLowerCase().startsWith("fa") ? "fa-IR" : "en-US";
}

export function formatNumber(
  value: number,
  locale: string,
  options?: Intl.NumberFormatOptions,
): string {
  return value.toLocaleString(getNumberLocale(locale), options);
}

export function formatDecimal(
  value: number,
  locale: string,
  fractionDigits = 1,
  options?: Intl.NumberFormatOptions,
): string {
  return formatNumber(value, locale, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
    ...options,
  });
}
