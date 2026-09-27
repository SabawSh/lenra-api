import { DEFAULT_LOCALE } from "@/config/i18n.js";

/** Canonical public origin for BitPay callbacks (must match bitpay.ir panel). */
export function getBitpayPublicOrigin(req: Request): string {
  const explicit = process.env.BITPAY_REDIRECT_BASE_URL?.trim();
  if (explicit) {
    try {
      return new URL(explicit).origin;
    } catch {
      /* fall through */
    }
  }

  const base = process.env.NEXT_PUBLIC_BASE_URL?.trim();
  if (base) {
    try {
      return new URL(base).origin;
    } catch {
      /* fall through */
    }
  }

  const forwardedHost = req.headers
    .get("x-forwarded-host")
    ?.split(",")[0]
    ?.trim();
  const forwardedProto = req.headers
    .get("x-forwarded-proto")
    ?.split(",")[0]
    ?.trim();
  if (forwardedHost && forwardedProto) {
    return `${forwardedProto}://${forwardedHost}`;
  }

  return new URL(req.url).origin;
}

export function pricingPath(locale: string): string {
  return locale === DEFAULT_LOCALE ? "/pricing" : `/${locale}/pricing`;
}

export function pricingUrl(locale: string, origin: string, params?: URLSearchParams) {
  const url = new URL(pricingPath(locale), origin);
  if (params) {
    for (const [key, value] of params.entries()) {
      url.searchParams.set(key, value);
    }
  }
  return url;
}
