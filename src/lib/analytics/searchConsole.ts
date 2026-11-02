import { SignJWT, importPKCS8 } from "jose";

const GSC_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SITES_URL = "https://www.googleapis.com/webmasters/v3/sites";

export type GscCredentials = {
  clientEmail: string;
  privateKey: string;
  siteUrl: string;
};

export type GscMetrics = {
  startDate: string;
  endDate: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
  topQueries: {
    query: string;
    clicks: number;
    impressions: number;
    ctr: number;
    position: number;
  }[];
  topPages: {
    page: string;
    clicks: number;
    impressions: number;
    ctr: number;
    position: number;
  }[];
  byDevice: {
    device: string;
    clicks: number;
    impressions: number;
    ctr: number;
    position: number;
  }[];
};

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function defaultRange(): { startDate: string; endDate: string } {
  // GSC data is typically delayed ~2–3 days; end at 3 days ago.
  const end = new Date();
  end.setUTCDate(end.getUTCDate() - 3);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 27);
  return { startDate: ymd(start), endDate: ymd(end) };
}

export function readGscCredentialsFromEnv(): GscCredentials | null {
  const clientEmail = process.env.GSC_CLIENT_EMAIL?.trim() ?? "";
  const privateKey = (process.env.GSC_PRIVATE_KEY ?? "")
    .trim()
    .replace(/\\n/g, "\n");
  const siteUrl = process.env.GSC_SITE_URL?.trim() ?? "";
  if (!clientEmail || !privateKey.includes("BEGIN PRIVATE KEY") || !siteUrl) {
    return null;
  }
  return { clientEmail, privateKey, siteUrl };
}

async function getAccessToken(creds: GscCredentials): Promise<string> {
  const key = await importPKCS8(creds.privateKey, "RS256");
  const now = Math.floor(Date.now() / 1000);
  const assertion = await new SignJWT({
    scope: GSC_SCOPE,
  })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(creds.clientEmail)
    .setSubject(creds.clientEmail)
    .setAudience(TOKEN_URL)
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(key);

  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion,
  });

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = (await res.json()) as {
    access_token?: string;
    error?: string;
    error_description?: string;
  };
  if (!res.ok || !json.access_token) {
    throw new Error(
      json.error_description || json.error || `token_http_${res.status}`,
    );
  }
  return json.access_token;
}

async function gscFetch(
  accessToken: string,
  url: string,
  init?: RequestInit,
): Promise<Response> {
  return fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
}

type AnalyticsRow = {
  keys?: string[];
  clicks?: number;
  impressions?: number;
  ctr?: number;
  position?: number;
};

async function querySearchAnalytics(
  accessToken: string,
  siteUrl: string,
  body: Record<string, unknown>,
): Promise<AnalyticsRow[]> {
  const url = `${SITES_URL}/${encodeURIComponent(siteUrl)}/searchAnalytics/query`;
  const res = await gscFetch(accessToken, url, {
    method: "POST",
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as {
    rows?: AnalyticsRow[];
    error?: { message?: string; status?: string };
  };
  if (!res.ok) {
    throw new Error(
      json.error?.message || json.error?.status || `gsc_http_${res.status}`,
    );
  }
  return json.rows ?? [];
}

/**
 * Verifies the service account can access the configured property and
 * returns live aggregate metrics. Never invents numbers.
 */
export async function fetchSearchConsoleStatus(input?: {
  startDate?: string;
  endDate?: string;
}): Promise<{
  configured: boolean;
  connected: boolean;
  clientEmail: string | null;
  siteUrl: string | null;
  message: string;
  metrics: GscMetrics | null;
  error?: string;
}> {
  const creds = readGscCredentialsFromEnv();
  if (!creds) {
    return {
      configured: false,
      connected: false,
      clientEmail: null,
      siteUrl: null,
      message:
        "Set GSC_CLIENT_EMAIL, GSC_PRIVATE_KEY, and GSC_SITE_URL to enable Search Console. No SEO metrics are fabricated.",
      metrics: null,
    };
  }

  try {
    const accessToken = await getAccessToken(creds);

    // Confirm property is visible to this service account.
    const sitesRes = await gscFetch(accessToken, SITES_URL);
    const sitesJson = (await sitesRes.json()) as {
      siteEntry?: { siteUrl?: string; permissionLevel?: string }[];
      error?: { message?: string };
    };
    if (!sitesRes.ok) {
      throw new Error(
        sitesJson.error?.message || `sites_http_${sitesRes.status}`,
      );
    }
    const sites = sitesJson.siteEntry ?? [];
    const matched = sites.find((s) => s.siteUrl === creds.siteUrl);
    if (!matched) {
      const available = sites.map((s) => s.siteUrl).filter(Boolean);
      return {
        configured: true,
        connected: false,
        clientEmail: creds.clientEmail,
        siteUrl: creds.siteUrl,
        message: available.length
          ? `Authenticated, but GSC_SITE_URL (${creds.siteUrl}) is not in this service account's site list. Available: ${available.join(", ")}. Add the service account as a user on the correct property, or fix GSC_SITE_URL.`
          : `Authenticated, but this service account has no Search Console properties. In Search Console → Users, add ${creds.clientEmail} to the property.`,
        metrics: null,
        error: "site_not_accessible",
      };
    }

    const range =
      input?.startDate && input?.endDate
        ? { startDate: input.startDate, endDate: input.endDate }
        : defaultRange();

    const [totals, queries, pages, devices] = await Promise.all([
      querySearchAnalytics(accessToken, creds.siteUrl, {
        startDate: range.startDate,
        endDate: range.endDate,
        dimensions: [],
        rowLimit: 1,
      }),
      querySearchAnalytics(accessToken, creds.siteUrl, {
        startDate: range.startDate,
        endDate: range.endDate,
        dimensions: ["query"],
        rowLimit: 15,
      }),
      querySearchAnalytics(accessToken, creds.siteUrl, {
        startDate: range.startDate,
        endDate: range.endDate,
        dimensions: ["page"],
        rowLimit: 15,
      }),
      querySearchAnalytics(accessToken, creds.siteUrl, {
        startDate: range.startDate,
        endDate: range.endDate,
        dimensions: ["device"],
        rowLimit: 10,
      }),
    ]);

    const total = totals[0];
    const metrics: GscMetrics = {
      startDate: range.startDate,
      endDate: range.endDate,
      clicks: Number(total?.clicks ?? 0),
      impressions: Number(total?.impressions ?? 0),
      ctr: Number(total?.ctr ?? 0),
      position: Number(total?.position ?? 0),
      topQueries: queries.map((r) => ({
        query: String(r.keys?.[0] ?? ""),
        clicks: Number(r.clicks ?? 0),
        impressions: Number(r.impressions ?? 0),
        ctr: Number(r.ctr ?? 0),
        position: Number(r.position ?? 0),
      })),
      topPages: pages.map((r) => ({
        page: String(r.keys?.[0] ?? ""),
        clicks: Number(r.clicks ?? 0),
        impressions: Number(r.impressions ?? 0),
        ctr: Number(r.ctr ?? 0),
        position: Number(r.position ?? 0),
      })),
      byDevice: devices.map((r) => ({
        device: String(r.keys?.[0] ?? ""),
        clicks: Number(r.clicks ?? 0),
        impressions: Number(r.impressions ?? 0),
        ctr: Number(r.ctr ?? 0),
        position: Number(r.position ?? 0),
      })),
    };

    return {
      configured: true,
      connected: true,
      clientEmail: creds.clientEmail,
      siteUrl: creds.siteUrl,
      message: `Connected to Search Console (${matched.permissionLevel ?? "ok"}). Showing live data for ${range.startDate} → ${range.endDate}.`,
      metrics,
    };
  } catch (err) {
    const detail = err instanceof Error ? err.message : "gsc_failed";
    return {
      configured: true,
      connected: false,
      clientEmail: creds.clientEmail,
      siteUrl: creds.siteUrl,
      message: `Credentials are present but the Search Console API call failed: ${detail}. Enable “Google Search Console API” in Google Cloud, and ensure the service account is a user on the property.`,
      metrics: null,
      error: detail,
    };
  }
}
