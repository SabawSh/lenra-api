import type { AchievementUnlockToastPayload } from "@/components/achievements/AchievementUnlockToast";
import type { XpToastPayload } from "@/components/gamification/XpToast";
import type { UnlockedAchievementPayload } from "@/lib/achievements/engine";
import type { AchievementIconId } from "@/lib/achievements/types";
import type { AchievementRarity } from "@/lib/dashboard/tokens";
import type { ClipXpAwardResult } from "@/lib/gamification/xp";
import type { XpReason } from "@/lib/gamification/xp";

const ICON_IDS = new Set<string>([
  "play",
  "film",
  "tv",
  "clapperboard",
  "mic",
  "volume2",
  "timer",
  "bookOpen",
  "bookMarked",
  "crown",
  "flame",
  "moon",
  "sun",
  "zap",
  "target",
  "sparkles",
  "theater",
  "laugh",
  "clock",
]);

function asIconId(icon: string): AchievementIconId | undefined {
  return ICON_IDS.has(icon) ? (icon as AchievementIconId) : undefined;
}

function asRarity(rarity: string): AchievementRarity {
  if (
    rarity === "common" ||
    rarity === "rare" ||
    rarity === "epic" ||
    rarity === "legendary"
  ) {
    return rarity;
  }
  return "common";
}

export function unlockedToAchievementToast(
  item: UnlockedAchievementPayload,
): AchievementUnlockToastPayload {
  return {
    title: item.title,
    xp: item.xpReward,
    rarity: asRarity(item.rarity),
    iconId: asIconId(item.icon),
  };
}

export function gamificationToToasts(
  data: ClipXpAwardResult | null | undefined,
): XpToastPayload[] {
  if (!data || data.totalXpGained <= 0) return [];

  const reason =
    (data.reasons[0] as XpReason | undefined) ?? "complete_clip";

  const toasts: XpToastPayload[] = [
    { kind: "xp", amount: data.totalXpGained, reason },
  ];

  if (data.leveledUp) {
    toasts.push({
      kind: "levelUp",
      previousLevel: data.previousLevel,
      newLevel: data.newLevel,
    });
  }

  return toasts;
}

export function emitGamificationToasts(
  showToast: (payload: XpToastPayload) => void,
  data: ClipXpAwardResult | null | undefined,
) {
  const toasts = gamificationToToasts(data);
  toasts.forEach((toast, index) => {
    window.setTimeout(() => showToast(toast), index * 450);
  });
}

export function emitAchievementUnlockToasts(
  showAchievementUnlock: (payload: AchievementUnlockToastPayload) => void,
  unlocked: UnlockedAchievementPayload[] | null | undefined,
  startDelayMs = 500,
) {
  if (!unlocked?.length) return;
  unlocked.forEach((item, index) => {
    window.setTimeout(
      () => showAchievementUnlock(unlockedToAchievementToast(item)),
      startDelayMs + index * 550,
    );
  });
}
