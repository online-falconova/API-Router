"use client";

import { useEffect, useRef, useId } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { cn } from "@/shared/utils/cn";
import Button, { type ButtonVariant } from "./Button";

// #6265 — preset for content-heavy modals: caps height on the OUTERMOST dialog
// wrapper only (single scroll owner) and keeps the inner body plain (no
// independent max-h/overflow), avoiding a double height cap that clips content.
export const TALL_MODAL_PROPS = {
  className: "max-h-[calc(100dvh-1.5rem)] overflow-y-auto sm:max-h-[90dvh]",
  bodyClassName: "p-4 sm:p-6",
};

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  size?: "sm" | "md" | "lg" | "xl" | "full";
  closeOnOverlay?: boolean;
  showCloseButton?: boolean;
  className?: string;
  bodyClassName?: string;
  compactHeader?: boolean;
  maxWidth?: string;
}

interface ConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  title?: React.ReactNode;
  message: React.ReactNode;
  confirmText?: React.ReactNode;
  cancelText?: React.ReactNode;
  variant?: ButtonVariant;
  loading?: boolean;
}

export default function Modal({
  isOpen,
  onClose,
  title,
  children,
  footer,
  size = "md",
  closeOnOverlay = true,
  showCloseButton = true,
  className,
  bodyClassName,
  compactHeader = false,
}: ModalProps) {
  const t = useTranslations("common");
  const titleId = useId();
  const dialogRef = useRef(null);
  const portalRoot = typeof document === "undefined" ? null : document.body;

  const sizes = {
    sm: "max-w-sm",
    md: "max-w-md",
    lg: "max-w-lg",
    xl: "max-w-xl",
    full: "max-w-4xl",
  };

  // Lock body scroll when modal is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  // Handle escape key
  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [isOpen, onClose]);

  // Focus trap
  useEffect(() => {
    if (!isOpen || !dialogRef.current) return;

    const dialog = dialogRef.current;
    const focusableSelector =
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

    // Focus first focusable element
    const firstFocusable = dialog.querySelector(focusableSelector);
    if (firstFocusable) {
      setTimeout(() => firstFocusable.focus(), 50);
    }

    const handleTab = (e) => {
      if (e.key !== "Tab") return;

      const focusable = [...dialog.querySelectorAll(focusableSelector)];
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    dialog.addEventListener("keydown", handleTab);
    return () => dialog.removeEventListener("keydown", handleTab);
  }, [isOpen]);

  if (!isOpen || !portalRoot) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center p-3 sm:p-4"
      style={{
        paddingTop: "max(0.75rem, env(safe-area-inset-top))",
        paddingRight: "max(0.75rem, env(safe-area-inset-right))",
        paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))",
        paddingLeft: "max(0.75rem, env(safe-area-inset-left))",
      }}
    >
      {/* Overlay */}
      <div
        className="absolute inset-0 bg-black/30 backdrop-blur-sm"
        onClick={closeOnOverlay ? onClose : undefined}
        aria-hidden="true"
      />

      {/* Modal content */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        className={cn(
          "relative w-full max-h-[calc(100dvh-1.5rem)] bg-surface sm:max-h-[calc(100dvh-2rem)]",
          "border border-black/10 dark:border-white/10",
          "rounded-card neu-raised",
          "animate-in fade-in zoom-in-95 duration-200",
          sizes[size],
          className
        )}
      >
        {/* Header */}
        {(title || showCloseButton) && (
          <div
            className={cn(
              "flex items-center justify-between border-b border-black/5 dark:border-white/5",
              compactHeader ? "px-4 py-2.5" : "p-4 sm:p-6"
            )}
          >
            <div className="flex items-center min-w-0">
              <div
                className={cn(
                  "flex items-center gap-1.5 mr-3 shrink-0",
                  compactHeader ? "" : "gap-2 mr-4"
                )}
                aria-hidden="true"
              >
                <div
                  className={cn(
                    "rounded-full bg-[#FF5F56]",
                    compactHeader ? "w-2.5 h-2.5" : "w-3 h-3"
                  )}
                />
                <div
                  className={cn(
                    "rounded-full bg-[#FFBD2E]",
                    compactHeader ? "w-2.5 h-2.5" : "w-3 h-3"
                  )}
                />
                <div
                  className={cn(
                    "rounded-full bg-[#27C93F]",
                    compactHeader ? "w-2.5 h-2.5" : "w-3 h-3"
                  )}
                />
              </div>
              {title && (
                <h2
                  id={titleId}
                  className={cn(
                    // Wrap instead of truncating so the full title stays readable
                    // on narrow phones (a single-line `truncate` clipped titles
                    // like "Shut down API Router" to "S…" at ≤320px widths).
                    "min-w-0 break-words font-semibold leading-snug text-text-main",
                    compactHeader ? "text-sm" : "text-lg"
                  )}
                >
                  {title}
                </h2>
              )}
            </div>
            {showCloseButton && (
              <button
                onClick={onClose}
                aria-label={t("close")}
                className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-black/5 dark:hover:bg-white/5"
              >
                <span className="material-symbols-outlined text-[20px]" aria-hidden="true">
                  close
                </span>
              </button>
            )}
          </div>
        )}

        {/* Body */}
        <div
          className={
            bodyClassName ??
            "p-4 max-h-[calc(100dvh-10rem)] overflow-y-auto overscroll-contain sm:p-6"
          }
        >
          {children}
        </div>

        {/* Footer */}
        {footer && (
          <div className="flex flex-wrap items-center justify-end gap-3 border-t border-black/5 p-4 dark:border-white/5 sm:p-6">
            {footer}
          </div>
        )}
      </div>
    </div>,
    portalRoot
  );
}

// Confirm Modal helper
export function ConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmText,
  cancelText,
  variant = "danger",
  loading = false,
}: ConfirmModalProps) {
  const t = useTranslations("common");
  const resolvedTitle = title ?? t("confirmTitle");
  const resolvedConfirmText = confirmText ?? t("confirmAction");
  const resolvedCancelText = cancelText ?? t("cancel");

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={resolvedTitle}
      size="sm"
      footer={
        <>
          <Button
            variant="ghost"
            size="lg"
            className="min-w-0 flex-1 sm:min-w-24 sm:flex-none"
            onClick={onClose}
            disabled={loading}
          >
            {resolvedCancelText}
          </Button>
          <Button
            variant={variant}
            size="lg"
            className="min-w-0 flex-1 sm:min-w-24 sm:flex-none"
            onClick={onConfirm}
            loading={loading}
          >
            {resolvedConfirmText}
          </Button>
        </>
      }
    >
      <p className="text-text-muted">{message}</p>
    </Modal>
  );
}
