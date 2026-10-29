import { isSiteMediaAdmin } from "@/lib/auth/siteAdmin";
import {
  getActiveSubscription,
  getActiveSubscriptionExpiresAt,
} from "@/lib/db/queries/subscriptions";
import type { User } from "@/lib/db/queries/users";
import { cache } from "react";

const DEFAULT_TRIAL_DAYS = 30;

function toDate(value: Date | string | number): Date {
  if (value instanceof Date) return value;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("Invalid date value");
  }
  return parsed;
}

function trialDays(): number {
  const raw = process.env.LEARNING_TRIAL_DAYS?.trim();
  if (!raw) return DEFAULT_TRIAL_DAYS;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) return DEFAULT_TRIAL_DAYS;
  return parsed;
}

export function getTrialEndsAt(createdAt: Date | string | number): Date {
  const days = trialDays();
  const created = toDate(createdAt);
  return new Date(created.getTime() + days * 24 * 60 * 60 * 1000);
}

export function isWithinFreeTrial(
  createdAt: Date | string | number,
  now: Date = new Date(),
): boolean {
  return now.getTime() < getTrialEndsAt(createdAt).getTime();
}

const getCachedActiveSubscriptionExpiresAt = cache(getActiveSubscriptionExpiresAt);

export type MembershipTier = "premium" | "trial" | "free";

export type Membership = {
  tier: MembershipTier;
  planKey: string | null;
  expiresAt: string | null;
  trialEndsAt: string;
  memberSince: string;
};

const getCachedActiveSubscription = cache(getActiveSubscription);

export async function getUserMembership(user: User): Promise<Membership> {
  const subscription = await getCachedActiveSubscription(user.id);
  const trialEndsAt = getTrialEndsAt(user.createdAt);
  const tier: MembershipTier = subscription
    ? "premium"
    : isWithinFreeTrial(user.createdAt)
      ? "trial"
      : "free";
  return {
    tier,
    planKey: subscription?.planKey ?? null,
    expiresAt: subscription?.expiresAt.toISOString() ?? null,
    trialEndsAt: trialEndsAt.toISOString(),
    memberSince: toDate(user.createdAt).toISOString(),
  };
}

export async function userCanAccessLearning(user: User): Promise<boolean> {
  if (isSiteMediaAdmin(user)) return true;
  if (isWithinFreeTrial(user.createdAt)) return true;
  const expiresAt = await getCachedActiveSubscriptionExpiresAt(user.id);
  return (
    expiresAt !== null && toDate(expiresAt).getTime() > Date.now()
  );
}
