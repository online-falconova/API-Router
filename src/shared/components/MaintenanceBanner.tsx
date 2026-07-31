"use client";

/**
 * Maintenance Banner — Phase 8.4
 *
 * Shows a warning banner at the top of the dashboard when the server
 * is restarting or in maintenance mode. Auto-dismisses when the server
 * comes back online.
 */

import { useState, useEffect } from "react";
import { useRef } from "react";
import { useTranslations } from "next-intl";

export default function MaintenanceBanner() {
  const [show, setShow] = useState(false);
  const [message, setMessage] = useState("");
  const consecutiveFailuresRef = useRef(0);
  const dismissedUntilRecoveryRef = useRef(false);
  const t = useTranslations("common");

  useEffect(() => {
    let cancelled = false;

    // A single probe against the lightweight liveness endpoint (single SELECT 1)
    // rather than the heavy /api/monitoring/health snapshot, which can exceed
    // the client timeout under load and cause false-positive banners.
    // Returns "ok" | "issues" (HTTP non-2xx) | "unreachable" (network/timeout).
    const pingOnce = async (timeoutMs: number): Promise<"ok" | "issues" | "unreachable"> => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort("Health check timeout"), timeoutMs);
      try {
        const res = await fetch("/api/health/ping", {
          signal: controller.signal,
          cache: "no-store",
        });
        return res.ok ? "ok" : "issues";
      } catch {
        return "unreachable";
      } finally {
        clearTimeout(timeoutId);
      }
    };

    const checkHealth = async () => {
      // One immediate in-cycle retry before counting a failure. This smooths
      // over transient blips — dev recompiles, brief GC pauses, a single
      // dropped request — that would otherwise flash a scary "unreachable"
      // banner even though the server is healthy.
      let status = await pingOnce(8000);
      if (status !== "ok" && !cancelled) {
        await new Promise((resolve) => setTimeout(resolve, 1200));
        status = await pingOnce(8000);
      }
      if (cancelled) return;

      if (status === "ok") {
        consecutiveFailuresRef.current = 0;
        dismissedUntilRecoveryRef.current = false;
        setShow(false);
        setMessage("");
        return;
      }

      consecutiveFailuresRef.current += 1;
      // Require 3 consecutive failed cycles (each already retried once) before
      // surfacing the banner — a genuine outage still shows within ~30s, but
      // routine restarts and recompiles never trip it.
      if (consecutiveFailuresRef.current >= 3 && !dismissedUntilRecoveryRef.current) {
        setShow(true);
        setMessage(
          status === "unreachable"
            ? t("maintenanceServerUnreachable")
            : t("maintenanceServerIssues")
        );
      }
    };

    // Run immediately on mount, then every 10 seconds.
    checkHealth();
    const interval = setInterval(checkHealth, 10000);

    // Re-check promptly when the tab regains focus or the network comes back,
    // so a recovered server clears the banner without waiting for the next poll.
    const onWake = () => {
      if (document.visibilityState === "visible") void checkHealth();
    };
    window.addEventListener("online", onWake);
    document.addEventListener("visibilitychange", onWake);

    return () => {
      cancelled = true;
      clearInterval(interval);
      window.removeEventListener("online", onWake);
      document.removeEventListener("visibilitychange", onWake);
    };
  }, [t]);

  if (!show) return null;

  return (
    <div className="bg-amber-500/10 border-b border-amber-500/20 px-4 py-2.5 flex items-center justify-between gap-3 animate-in slide-in-from-top">
      <div className="flex items-center gap-2.5">
        <span className="material-symbols-outlined text-amber-500 text-[18px] animate-pulse">
          warning
        </span>
        <span className="text-sm text-amber-200">{message}</span>
      </div>
      <button
        onClick={() => {
          dismissedUntilRecoveryRef.current = true;
          setShow(false);
        }}
        className="p-1 rounded hover:bg-white/5 text-text-muted hover:text-text-main transition-colors"
        aria-label={t("close")}
      >
        <span className="material-symbols-outlined text-[16px]">close</span>
      </button>
    </div>
  );
}
