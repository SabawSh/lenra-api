import { setSessionForUserOnResponse } from "@/lib/auth/setSessionForUser";
import { readSessionFromCookies } from "@/lib/auth/sessionCookie";
import { recordLegalAcceptance } from "@/lib/db/queries/users";
import { postAuthRedirectPath } from "@/lib/auth/postAuthRedirect";
import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

function sanitizeNext(next: unknown): string | null {
  if (typeof next !== "string") return null;
  const n = next.trim();
  if (!n.startsWith("/") || n.startsWith("//")) return null;
  if (removeLegalAcceptPath(n)) return null;
  return n;
}

function removeLegalAcceptPath(path: string): boolean {
  return /^\/legal\/accept(\?|$)/.test(path);
}

/**
 * POST /api/legal/accept
 * Body: { accepted: true, next?: string }
 */
export async function POST(req: Request) {
  const session = await readSessionFromCookies();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: { accepted?: boolean; next?: string | null } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (body.accepted !== true) {
    return NextResponse.json({ error: "acceptance_required" }, { status: 400 });
  }

  const user = await recordLegalAcceptance(session.userId);
  if (!user) {
    return NextResponse.json({ error: "user_not_found" }, { status: 404 });
  }

  revalidateTag("user", { expire: 0 });

  const safeNext = sanitizeNext(body.next);
  const redirectTo = postAuthRedirectPath(user, safeNext);

  const response = NextResponse.json({ ok: true, redirectTo });
  await setSessionForUserOnResponse(response, user);
  return response;
}
