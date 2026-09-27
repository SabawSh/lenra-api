import { summarizeAuthMethods } from "@/lib/auth/linking";
import { readSessionFromCookies } from "@/lib/auth/sessionCookie";
import { listAuthMethodsForUser } from "@/lib/db/queries/authMethods";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

/** GET /api/auth/methods — connected login methods for the signed-in user. */
export async function GET() {
  const session = await readSessionFromCookies();
  if (!session) {
    return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
  }

  const methods = await listAuthMethodsForUser(session.userId);
  const summary = summarizeAuthMethods(methods);

  return NextResponse.json({
    methods: methods.map((m) => ({
      id: m.id,
      provider: m.provider,
      email: m.email,
      phone: m.phone,
      verifiedAt: m.verifiedAt?.toISOString() ?? null,
    })),
    ...summary,
    canRemoveGoogle: summary.google && methods.length > 1,
    canRemovePhone: summary.phone && methods.length > 1,
  });
}
