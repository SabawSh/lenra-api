import type { UserId } from "@/types/schema";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUserId(value: unknown): value is UserId {
  return typeof value === "string" && UUID_RE.test(value);
}

export function assertUserId(userId: unknown): asserts userId is UserId {
  if (!isUserId(userId)) {
    throw new Error("Invalid userId");
  }
}
