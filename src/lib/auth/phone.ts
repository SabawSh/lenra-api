/**
 * Pure phone helpers (no DB). Safe to import from Client Components.
 */

const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
const ARABIC_INDIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";

/** Map Persian/Arabic-Indic numerals to ASCII before normalization. */
export function convertPersianDigitsToAscii(input: string): string {
  return input.replace(/[۰-۹٠-٩]/g, (ch) => {
    const p = PERSIAN_DIGITS.indexOf(ch);
    if (p >= 0) return String(p);
    const a = ARABIC_INDIC_DIGITS.indexOf(ch);
    if (a >= 0) return String(a);
    return ch;
  });
}

/**
 * Normalize an Iranian phone number into E.164 (+98...).
 * Accepts: "+989123456789", "989123456789", "09123456789", "9123456789",
 * and Persian/Arabic digit variants with spaces or dashes.
 * Returns null if the shape doesn't look like a valid mobile.
 */
export function normalizeIranPhone(input: string): string | null {
  const ascii = convertPersianDigitsToAscii(input);
  const digits = ascii.replace(/[\s\-–—()]/g, "").replace(/[^\d+]/g, "");
  if (!digits) return null;

  let local: string;
  if (digits.startsWith("+98")) local = digits.slice(3);
  else if (digits.startsWith("0098")) local = digits.slice(4);
  else if (digits.startsWith("98") && digits.length === 12)
    local = digits.slice(2);
  else if (digits.startsWith("0")) local = digits.slice(1);
  else local = digits;

  if (!/^9\d{9}$/.test(local)) return null;
  return `+98${local}`;
}
