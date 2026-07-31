"use client";

import { cn } from "@/shared/utils/cn";

// Filled variants get the neumorphic soft elevation + a pressed-in state on
// tap. Ghost/outline stay flat so dense icon toolbars don't get noisy.
const variants = {
  primary: "bg-[image:var(--grad-brand)] text-white neu-raised-sm hover:brightness-105",
  accent: "bg-accent text-white neu-raised-sm hover:bg-accent-hover",
  secondary:
    "bg-surface border border-black/5 dark:border-white/10 text-text-main neu-raised-sm hover:bg-black/5 dark:hover:bg-white/5",
  outline: "border border-black/15 dark:border-white/15 text-text-main hover:bg-black/5",
  ghost: "text-text-muted hover:bg-black/5 dark:hover:bg-white/5 hover:text-text-main",
  warning: "bg-amber-500 text-white neu-raised-sm hover:bg-amber-600",
  danger: "bg-red-500 text-white neu-raised-sm hover:bg-red-600",
};

export type ButtonVariant = keyof typeof variants;

const sizes = {
  sm: "h-7 px-3 text-xs rounded-control",
  md: "h-9 px-4 text-sm rounded-control",
  lg: "h-11 px-6 text-sm rounded-control",
};

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children?: React.ReactNode;
  variant?: ButtonVariant;
  size?: keyof typeof sizes;
  icon?: string;
  iconRight?: string;
  loading?: boolean;
  fullWidth?: boolean;
  className?: string;
}

export default function Button({
  children,
  variant = "primary",
  size = "md",
  icon,
  iconRight,
  disabled = false,
  loading = false,
  fullWidth = false,
  className,
  ...props
}: ButtonProps) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex min-h-11 min-w-11 items-center justify-center gap-2 font-medium transition-all duration-200 cursor-pointer sm:min-h-0 sm:min-w-0",
        "active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100",
        variants[variant],
        sizes[size],
        fullWidth && "w-full",
        className
      )}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? (
        <span
          className="material-symbols-outlined animate-spin text-[18px] pointer-events-none"
          aria-hidden="true"
        >
          progress_activity
        </span>
      ) : icon ? (
        <span
          className="material-symbols-outlined text-[18px] pointer-events-none"
          aria-hidden="true"
        >
          {icon}
        </span>
      ) : null}
      {children}
      {iconRight && !loading && (
        <span
          className="material-symbols-outlined text-[18px] pointer-events-none"
          aria-hidden="true"
        >
          {iconRight}
        </span>
      )}
    </button>
  );
}
