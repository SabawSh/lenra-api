import { redirect } from "@/i18n/navigation";
import { getCurrentUser } from "@/lib/auth/getCurrentUser";
import type { User } from "@/lib/db/queries/users";
import { userCanAccessLearning } from "@/lib/payments/access";
import { NextResponse } from "next/server";

export async function redirectIfLearningBlocked(
  user: User | null,
  locale: string,
): Promise<void> {
  if (!user) return;
  if (!(await userCanAccessLearning(user))) {
    redirect({ href: "/dashboard/plans", locale });
  }
}

export async function requireLearningUser():
  Promise<
    | { ok: true; user: User }
    | { ok: false; response: NextResponse }
  > {
  const user = await getCurrentUser();
  if (!user) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  if (!(await userCanAccessLearning(user))) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "subscription_required" },
        { status: 403 },
      ),
    };
  }
  return { ok: true, user };
}
