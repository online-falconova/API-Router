"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/shared/utils/cn";
import Button from "./Button";
import { Spinner } from "./Loading";

/**
 * StateView — one cohesive, animated, mobile-first component for every non-content
 * screen state: loading, empty, error, offline, slow network, permission denied, and
 * success. Neumorphic soft-UI styling, motion that respects `prefers-reduced-motion`,
 * and correct live-region semantics per state (assertive for errors/permission,
 * polite otherwise).
 *
 * Text is caller-provided; sensible i18n fallbacks are used when a prop is omitted.
 */
export type StateVariant =
  "loading" | "empty" | "error" | "offline" | "slow" | "forbidden" | "success";

interface StateViewProps {
  variant: StateVariant;
  title?: ReactNode;
  description?: ReactNode;
  /** Override the default Material Symbols icon name. */
  icon?: string;
  actionLabel?: string;
  onAction?: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
  /** Fill the available height and center (page-level). Default is inline/compact. */
  fullscreen?: boolean;
  className?: string;
  children?: ReactNode;
}

type VariantStyle = {
  icon: string;
  /** Tailwind classes for the icon tile tint. */
  tile: string;
  iconColor: string;
  /** Continuous icon motion class (all gated by motion-reduce). */
  motion: string;
  assertive?: boolean;
};

const VARIANTS: Record<StateVariant, VariantStyle> = {
  loading: {
    icon: "progress_activity",
    tile: "bg-accent/10",
    iconColor: "text-accent",
    motion: "",
  },
  empty: {
    icon: "inbox",
    tile: "bg-accent/10",
    iconColor: "text-accent",
    motion: "state-float",
  },
  error: {
    icon: "error",
    tile: "bg-red-500/12",
    iconColor: "text-red-500",
    motion: "animate-pulse",
    assertive: true,
  },
  offline: {
    icon: "wifi_off",
    tile: "bg-amber-500/12",
    iconColor: "text-amber-500",
    motion: "animate-pulse",
    assertive: true,
  },
  slow: {
    icon: "signal_wifi_statusbar_not_connected",
    tile: "bg-amber-500/12",
    iconColor: "text-amber-500",
    motion: "state-float",
  },
  forbidden: {
    icon: "lock",
    tile: "bg-red-500/12",
    iconColor: "text-red-500",
    motion: "",
    assertive: true,
  },
  success: {
    icon: "check_circle",
    tile: "bg-green-500/12",
    iconColor: "text-green-500",
    motion: "state-pop",
  },
};

export default function StateView({
  variant,
  title,
  description,
  icon,
  actionLabel,
  onAction,
  secondaryLabel,
  onSecondary,
  fullscreen = false,
  className,
  children,
}: StateViewProps) {
  const t = useTranslations("common");
  const style = VARIANTS[variant];

  const fallbackTitles: Record<StateVariant, string> = {
    loading: t("loading"),
    empty: t("nothingHere"),
    error: t("somethingWentWrong"),
    offline: t("offlineTitle"),
    slow: t("slowNetworkTitle"),
    forbidden: t("permissionDenied"),
    success: t("success"),
  };
  const resolvedTitle = title ?? fallbackTitles[variant];

  return (
    <div
      role={style.assertive ? "alert" : "status"}
      aria-live={style.assertive ? "assertive" : "polite"}
      aria-busy={variant === "loading" ? true : undefined}
      className={cn(
        "flex flex-col items-center justify-center text-center",
        "px-6 py-10 sm:py-12",
        "motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-95 motion-safe:duration-300",
        fullscreen ? "min-h-[60vh] w-full flex-1" : "min-h-[200px]",
        className
      )}
    >
      {/* Icon tile — neumorphic raised circle */}
      <div
        aria-hidden="true"
        className={cn(
          "flex items-center justify-center rounded-full neu-raised",
          "size-16 sm:size-[72px]",
          style.tile
        )}
      >
        {variant === "loading" ? (
          <Spinner size="lg" />
        ) : (
          <span
            className={cn(
              "material-symbols-outlined text-[34px] sm:text-[38px] motion-reduce:animate-none",
              style.iconColor,
              style.motion
            )}
          >
            {icon ?? style.icon}
          </span>
        )}
      </div>

      <h3 className="mt-5 text-base sm:text-lg font-semibold text-text-main">{resolvedTitle}</h3>

      {description && (
        <p className="mt-2 max-w-sm text-sm leading-relaxed text-text-muted">{description}</p>
      )}

      {children && <div className="mt-4 w-full max-w-sm">{children}</div>}

      {(actionLabel || secondaryLabel) && (
        <div className="mt-6 flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-center gap-2.5 w-full max-w-xs">
          {secondaryLabel && onSecondary && (
            <Button variant="ghost" fullWidth onClick={onSecondary}>
              {secondaryLabel}
            </Button>
          )}
          {actionLabel && onAction && (
            <Button
              variant="primary"
              icon={variant === "offline" || variant === "slow" ? "refresh" : undefined}
              fullWidth
              onClick={onAction}
            >
              {actionLabel}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
