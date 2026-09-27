"use client";

import { formatDecimal, formatNumber, getNumberLocale } from "@/helper/number";
import { useLocale } from "next-intl";
import { useCallback, useMemo } from "react";

export type UseLocalizedNumberOptions = {
  /** When false, formats 1994 instead of 1,994. Default true. */
  useGrouping?: boolean;
};

export function useLocalizedNumber({
  useGrouping: useGroupingDefault = true,
}: UseLocalizedNumberOptions = {}) {
  const locale = useLocale();
  const localeNum = useMemo(() => getNumberLocale(locale), [locale]);

  const num = useCallback(
    (value: number, options?: Intl.NumberFormatOptions) =>
      formatNumber(value, locale, {
        useGrouping: useGroupingDefault,
        ...options,
      }),
    [locale, useGroupingDefault],
  );

  const numDecimal = useCallback(
    (value: number, fractionDigits = 1, options?: Intl.NumberFormatOptions) =>
      formatDecimal(value, locale, fractionDigits, {
        useGrouping: useGroupingDefault,
        ...options,
      }),
    [locale, useGroupingDefault],
  );

  return { num, numDecimal, localeNum };
}
