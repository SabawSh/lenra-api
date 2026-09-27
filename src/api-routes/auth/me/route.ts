import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/getCurrentUser";
import { userCanAccessLearning } from "@/lib/payments/access";

export const runtime = "nodejs";

/**
 * GET /api/auth/me — returns the signed-in user, or `null`.
 * Handy for client components that need the current identity without
 * calling Prisma themselves.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ user: null, canAccessLearning: false });
  const canAccessLearning = await userCanAccessLearning(user);
  /** Full profile for SSR in the Next app (dates → ISO strings in JSON). */
  return NextResponse.json({
    user: JSON.parse(JSON.stringify(user)),
    canAccessLearning,
  });
}
