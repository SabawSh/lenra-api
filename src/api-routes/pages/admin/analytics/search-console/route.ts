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
  // .env often stores PEM with literal \n escapes
  const privateKey = (process.env.GSC_PRIVATE_KEY ?? "")
    .trim()
    .replace(/\\n/g, "\n");
  const siteUrl = process.env.GSC_SITE_URL?.trim() ?? "";

  const configured = Boolean(
    clientEmail && privateKey.includes("BEGIN PRIVATE KEY") && siteUrl,
  );

  return NextResponse.json({
    provider: "google_search_console",
    connected: false,
    configured,
    clientEmail: configured ? clientEmail : null,
    siteUrl: siteUrl || null,
    message: configured
      ? "Service account credentials are loaded. Add this client_email as a user on the Search Console property, then live GSC queries can be enabled. Metrics stay null until query wiring is turned on — never fabricated."
      : "Set GSC_CLIENT_EMAIL, GSC_PRIVATE_KEY, and GSC_SITE_URL to enable Search Console. No SEO metrics are fabricated.",
    metrics: null,
  });
}
