/** Client-safe browser / PWA detection for Web Push. */

export function detectIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

export function detectStandalonePWA(): boolean {
  if (typeof window === "undefined") return false;
  const nav = window.navigator as Navigator & {
    standalone?: boolean;
  };
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    nav.standalone === true
  );
}

export function detectSafari(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return /Safari/i.test(ua) && !/Chrome|CriOS|FxiOS|EdgiOS/i.test(ua);
}

export function detectChrome(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return /Chrome|CriOS/i.test(ua) && !/Edg|OPR/i.test(ua);
}

/** True when running on http(s)://localhost (or 127.0.0.1) during local dev. */
export function detectLocalhostDev(): boolean {
  if (typeof window === "undefined") return false;
  const host = window.location.hostname;
  return host === "localhost" || host === "127.0.0.1";
}

export type PushSupportReason =
  | "supported"
  | "no_service_worker"
  | "no_push_manager"
  | "no_notification"
  | "ios_requires_install"
  | "insecure_context";

export type PushSupport = {
  supported: boolean;
  reason: PushSupportReason;
  ios: boolean;
  standalone: boolean;
  safari: boolean;
};

/**
 * Whether Web Push can be used in this environment.
 * iOS Safari only supports push in an installed PWA (standalone).
 */
export function detectPushSupport(): PushSupport {
  if (typeof window === "undefined") {
    return {
      supported: false,
      reason: "no_service_worker",
      ios: false,
      standalone: false,
      safari: false,
    };
  }

  const ios = detectIOS();
  const standalone = detectStandalonePWA();
  const safari = detectSafari();

  if (!window.isSecureContext) {
    return {
      supported: false,
      reason: "insecure_context",
      ios,
      standalone,
      safari,
    };
  }

  if (!("serviceWorker" in navigator)) {
    return {
      supported: false,
      reason: "no_service_worker",
      ios,
      standalone,
      safari,
    };
  }

  if (!("PushManager" in window)) {
    return {
      supported: false,
      reason: "no_push_manager",
      ios,
      standalone,
      safari,
    };
  }

  if (!("Notification" in window)) {
    return {
      supported: false,
      reason: "no_notification",
      ios,
      standalone,
      safari,
    };
  }

  if (ios && !standalone) {
    return {
      supported: false,
      reason: "ios_requires_install",
      ios,
      standalone,
      safari,
    };
  }

  return {
    supported: true,
    reason: "supported",
    ios,
    standalone,
    safari,
  };
}

export function canRequestPushPermission(): boolean {
  const support = detectPushSupport();
  return support.supported && support.reason !== "ios_requires_install";
}
