"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/shared/utils/cn";
import { useNetworkStatus } from "@/shared/hooks/useNetworkStatus";

/**
 * NetworkStatusBanner — global, mobile-first connection status bar.
 *
 * - Offline  → assertive red bar with a Retry (reload) action.
 * - Slow     → dismissible amber bar (2g / Data Saver).
 * - Recovery → brief green "Back online" flash that auto-dismisses.
 *
 * Renders nothing on a healthy connection. Motion respects reduced-motion.
 */
type Tone = "offline" | "slow" | "online";

const TONES: Record<Tone, { wrap: string; icon: string; iconColor: string }> = {
  offline: {
    wrap: "bg-red-500/10 border-red-500/30 text-red-600 dark:text-red-300",
    icon: "wifi_off",
    iconColor: "text-red-500",
  },
  slow: {
    wrap: "bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-300",
    icon: "signal_wifi_statusbar_not_connected",
    iconColor: "text-amber-500",
  },
  online: {
    wrap: "bg-green-500/10 border-green-500/30 text-green-700 dark:text-green-300",
    icon: "wifi",
    iconColor: "text-green-500",
  },
};

export default function NetworkStatusBanner() {
  const t = useTranslations("common");
  const { online, slow } = useNetworkStatus();
  const [showBackOnline, setShowBackOnline] = useState(false);
  const [dismissedSlow, setDismissedSlow] = useState(false);
  const wasOffline = useRef(false);

  // Detect offline → online recovery and flash a transient "Back online" bar.
  // State updates are scheduled inside timer callbacks (never synchronously in
  // the effect body) to satisfy react-hooks/set-state-in-effect and avoid the
  // cascading render the rule warns about.
  useEffect(() => {
    if (!online) {
      wasOffline.current = true;
      return;
    }
    if (!wasOffline.current) return;
    wasOffline.current = false;
    const show = setTimeout(() => setShowBackOnline(true), 0);
    const hide = setTimeout(() => setShowBackOnline(false), 3000);
    return () => {
      clearTimeout(show);
      clearTimeout(hide);
    };
  }, [online]);

  // Re-arm the slow banner once the connection is no longer slow (deferred so the
  // reset is not a synchronous setState in the effect body).
  useEffect(() => {
    if (slow) return;
    const id = setTimeout(() => setDismissedSlow(false), 0);
    return () => clearTimeout(id);
  }, [slow]);

  let tone: Tone | null = null;
  let title = "";
  let description = "";
  if (!online) {
    tone = "offline";
    title = t("offlineTitle");
    description = t("offlineDescription");
  } else if (showBackOnline) {
    tone = "online";
    title = t("backOnline");
  } else if (slow && !dismissedSlow) {
    tone = "slow";
    title = t("slowNetworkTitle");
    description = t("slowNetworkDescription");
  }

  if (!tone) return null;
  const style = TONES[tone];
  const assertive = tone === "offline";

  return (
    <div
      role={assertive ? "alert" : "status"}
      aria-live={assertive ? "assertive" : "polite"}
      className={cn(
        "flex items-center gap-3 border-b px-4 py-2.5 sm:px-6",
        "motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-top-2 motion-safe:duration-300",
        style.wrap
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "material-symbols-outlined text-[20px] shrink-0 motion-reduce:animate-none",
          style.iconColor,
          tone === "offline" && "animate-pulse"
        )}
      >
        {style.icon}
      </span>

      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium leading-tight text-text-main">{title}</p>
        {description && <p className="text-xs leading-tight text-text-muted">{description}</p>}
      </div>

      {tone === "offline" && (
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="shrink-0 inline-flex items-center gap-1.5 rounded-control px-3 py-1.5 text-xs font-medium bg-surface text-text-main neu-raised-sm active:neu-pressed transition-transform"
        >
          <span className="material-symbols-outlined text-[16px]" aria-hidden="true">
            refresh
          </span>
          {t("retry")}
        </button>
      )}

      {tone === "slow" && (
        <button
          type="button"
          onClick={() => setDismissedSlow(true)}
          aria-label={t("dismissNotification")}
          className="shrink-0 p-1.5 rounded-control text-text-muted hover:text-text-main hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
        >
          <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
            close
          </span>
        </button>
      )}
    </div>
  );
}
