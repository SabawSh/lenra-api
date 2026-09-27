import { removeAuthMethodForUser } from "@/lib/auth/linking";
import { readSessionFromCookies } from "@/lib/auth/sessionCookie";
import type { AuthProvider } from "@/lib/db/queries/authMethods";
import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const VALID: AuthProvider[] = ["google", "phone"];

/**
 * DELETE /api/auth/methods/google|phone
 * Disconnect a secondary login method (never the last one).
 */
export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ provider: string }> },
) {
  const { provider: raw } = await ctx.params;
  if (!VALID.includes(raw as AuthProvider)) {
    return NextResponse.json({ error: "invalid_provider" }, { status: 400 });
  }
  const provider = raw as AuthProvider;

  const session = await readSessionFromCookies();
  if (!session) {
    return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
  }

  const result = await removeAuthMethodForUser(session.userId, provider);
  if (!result.ok) {
    const status = result.code === "last_method" ? 409 : 400;
    return NextResponse.json({ error: result.code }, { status });
  }

  revalidateTag("user", { expire: 0 });
  return NextResponse.json({ ok: true });
}
