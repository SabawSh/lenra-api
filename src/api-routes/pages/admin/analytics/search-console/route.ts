import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/getCurrentUser";
import { isSiteMediaAdmin } from "@/lib/auth/siteAdmin";

export const runtime = "nodejs";

/**
 * Google Search Console integration scaffold.
 * Returns connection status only — never fabricates SEO metrics.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user || !isSiteMediaAdmin(user)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const clientEmail = process.env.GSC_CLIENT_EMAIL?.trim() ?? "";
  const privateKey = process.env.GSC_PRIVATE_KEY?.trim() ?? "";
  const siteUrl = process.env.GSC_SITE_URL?.trim() ?? "";

  const configured = Boolean(clientEmail && privateKey && siteUrl);

  return NextResponse.json({
    provider: "google_search_console",
    connected: false,
    configured,
    siteUrl: siteUrl || null,
    message: configured
      ? "Credentials are present. OAuth/service-account data fetch is scaffolded but not yet connected to live GSC queries in this environment."
      : "Set GSC_CLIENT_EMAIL, GSC_PRIVATE_KEY, and GSC_SITE_URL to enable Search Console. No SEO metrics are fabricated.",
    metrics: null,
  });
}
