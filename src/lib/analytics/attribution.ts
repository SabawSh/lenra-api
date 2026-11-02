export type UtmParams = {
  source?: string;
  medium?: string;
  campaign?: string;
  content?: string;
  term?: string;
};

export type AcquisitionChannel =
  | "organic_search"
  | "direct"
  | "referral"
  | "social"
  | "paid_search"
  | "email"
  | "other";

const SEARCH_HOSTS = [
  "google.",
  "bing.",
  "yahoo.",
  "duckduckgo.",
  "baidu.",
  "yandex.",
];

const SOCIAL_HOSTS = [
  "facebook.",
  "instagram.",
  "twitter.",
  "x.com",
  "t.co",
  "linkedin.",
  "tiktok.",
  "youtube.",
  "reddit.",
  "telegram.",
  "t.me",
  "whatsapp.",
];

function hostOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function parseUtmFromSearch(search: string): UtmParams {
  const params = new URLSearchParams(
    search.startsWith("?") ? search : `?${search}`,
  );
  const pick = (key: string) => params.get(key)?.trim() || undefined;
  return {
    source: pick("utm_source"),
    medium: pick("utm_medium"),
    campaign: pick("utm_campaign"),
    content: pick("utm_content"),
    term: pick("utm_term"),
  };
}

export function classifyAcquisitionChannel(input: {
  utm?: UtmParams;
  referrerUrl?: string | null;
}): AcquisitionChannel {
  const medium = input.utm?.medium?.toLowerCase() ?? "";
  const source = input.utm?.source?.toLowerCase() ?? "";

  if (
    medium.includes("cpc") ||
    medium.includes("ppc") ||
    medium.includes("paid") ||
    medium === "ads"
  ) {
    return "paid_search";
  }
  if (medium === "email" || source === "email" || medium === "newsletter") {
    return "email";
  }
  if (
    medium === "social" ||
    SOCIAL_HOSTS.some((h) => source.includes(h.replace(".", "")))
  ) {
    return "social";
  }
  if (medium === "organic" || medium === "seo") {
    return "organic_search";
  }

  const host = hostOf(input.referrerUrl);
  if (!host) return "direct";
  if (SEARCH_HOSTS.some((h) => host.includes(h))) return "organic_search";
  if (SOCIAL_HOSTS.some((h) => host.includes(h))) return "social";
  return "referral";
}

export function referrerDomain(
  referrerUrl: string | null | undefined,
): string | null {
  return hostOf(referrerUrl);
}
