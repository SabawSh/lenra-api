/** Local persistence for push opt-in UX (no PII). */

const OPT_IN_KEY = "lenra_push_opt_in";
const ELIGIBLE_KEY = "lenra_push_opt_in_eligible";
const DISMISSED_AT_KEY = "lenra_push_opt_in_dismissed_at";
const LOGIN_PROMPT_KEY = "lenra_push_login_prompt";

export type OptInState = "never" | "eligible" | "dismissed" | "granted";

const DISMISS_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

function safeGet(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(key, value);
  } catch {
    /* quota / private mode */
  }
}

export function getOptInState(): OptInState {
  const raw = safeGet(OPT_IN_KEY);
  if (raw === "granted" || raw === "dismissed") return raw;
  if (safeGet(ELIGIBLE_KEY) === "1") return "eligible";
  return "never";
}

export function markReminderOptInEligible(): void {
  if (getOptInState() === "granted") return;
  safeSet(ELIGIBLE_KEY, "1");
  if (safeGet(OPT_IN_KEY) !== "dismissed") {
    safeSet(OPT_IN_KEY, "eligible");
  }
}

export function markOptInGranted(): void {
  safeSet(OPT_IN_KEY, "granted");
  safeSet(ELIGIBLE_KEY, "1");
  clearLoginPushPromptPending();
}

export function markOptInDismissed(): void {
  safeSet(OPT_IN_KEY, "dismissed");
  safeSet(DISMISSED_AT_KEY, String(Date.now()));
  clearLoginPushPromptPending();
}

export function shouldShowOptInModal(): boolean {
  const state = getOptInState();
  if (state === "granted") return false;
  if (safeGet(LOGIN_PROMPT_KEY) === "1") return true;
  if (state === "never") return false;
  if (state === "eligible") return true;
  if (state === "dismissed") {
    const at = Number(safeGet(DISMISSED_AT_KEY) ?? "0");
    if (!at) return false;
    return Date.now() - at > DISMISS_COOLDOWN_MS;
  }
  return false;
}

/** After first sign-in — show push opt-in once permission is still default. */
export function markLoginPushPromptPending(): void {
  if (getOptInState() === "granted") return;
  safeSet(LOGIN_PROMPT_KEY, "1");
  if (safeGet(OPT_IN_KEY) !== "dismissed") {
    safeSet(OPT_IN_KEY, "eligible");
  }
}

export function clearLoginPushPromptPending(): void {
  safeSet(LOGIN_PROMPT_KEY, "");
}
