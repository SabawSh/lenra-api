/**
 * Returns the currently signed-in user, or `null` if the visitor is anonymous
 * or the session cookie is invalid/expired.
 */
import { withMysqlConnectionRetry } from "@/lib/db/withMysqlConnectionRetry";
import { getUserById } from "@/lib/db/queries/users";
import type { User } from "@/lib/db/queries/users";
import type { UserId } from "@/types/schema";
import { unstable_cache } from "next/cache";
import { cache } from "react";
import { getApiRequest } from "./apiRequestContext";
import { readSessionFromRequest } from "./readSessionFromRequest";
import { readSessionFromCookies } from "./sessionCookie";

const getUserByIdCached = unstable_cache(
  async (userId: UserId): Promise<User | null> =>
    withMysqlConnectionRetry(() => getUserById(userId)),
  ["user-by-id"],
  { revalidate: 300, tags: ["user"] },
);

async function loadUserForSession(userId: UserId): Promise<User | null> {
  const apiRequest = getApiRequest();
  if (apiRequest) {
    return withMysqlConnectionRetry(() => getUserById(userId));
  }
  return getUserByIdCached(userId);
}

async function resolveCurrentUser(): Promise<User | null> {
  const apiRequest = getApiRequest();
  if (apiRequest) {
    const session = await readSessionFromRequest(apiRequest);
    if (!session) return null;
    return loadUserForSession(session.userId);
  }

  const session = await readSessionFromCookies();
  if (!session) return null;
  return loadUserForSession(session.userId);
}

/** Used by lenra-api (no React request cache). */
export async function getCurrentUserUncached(): Promise<User | null> {
  return resolveCurrentUser();
}

export const getCurrentUser = cache(async () => resolveCurrentUser());
