"use client";

import { useEffect, useState } from "react";

/**
 * Network status for building offline / slow-connection UI states.
 *
 * - `online`  — reflects `navigator.onLine` and the window `online`/`offline` events.
 * - `slow`    — true on 2g / slow-2g effective connection types or when the user has
 *               enabled Data Saver (`saveData`). Uses the Network Information API where
 *               available; on browsers without it, `slow` stays `false` (fail-open).
 *
 * SSR-safe: starts optimistic (online, not slow) and reconciles on mount, so it never
 * flashes an offline banner during hydration.
 */
export interface NetworkStatus {
  online: boolean;
  slow: boolean;
  effectiveType: string | null;
  saveData: boolean;
}

type ConnectionLike = {
  effectiveType?: string;
  saveData?: boolean;
  addEventListener?: (type: "change", listener: () => void) => void;
  removeEventListener?: (type: "change", listener: () => void) => void;
};

function getConnection(): ConnectionLike | null {
  if (typeof navigator === "undefined") return null;
  const nav = navigator as Navigator & {
    connection?: ConnectionLike;
    mozConnection?: ConnectionLike;
    webkitConnection?: ConnectionLike;
  };
  return nav.connection || nav.mozConnection || nav.webkitConnection || null;
}

const SLOW_TYPES = new Set(["slow-2g", "2g"]);

function readStatus(): NetworkStatus {
  if (typeof navigator === "undefined") {
    return { online: true, slow: false, effectiveType: null, saveData: false };
  }
  const conn = getConnection();
  const effectiveType = conn?.effectiveType ?? null;
  const saveData = Boolean(conn?.saveData);
  const slow = saveData || (effectiveType != null && SLOW_TYPES.has(effectiveType));
  return {
    online: navigator.onLine !== false,
    slow,
    effectiveType,
    saveData,
  };
}

export function useNetworkStatus(): NetworkStatus {
  const [status, setStatus] = useState<NetworkStatus>({
    online: true,
    slow: false,
    effectiveType: null,
    saveData: false,
  });

  useEffect(() => {
    const update = () => setStatus(readStatus());
    update(); // reconcile the optimistic SSR default with the real state

    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    const conn = getConnection();
    conn?.addEventListener?.("change", update);

    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
      conn?.removeEventListener?.("change", update);
    };
  }, []);

  return status;
}

export default useNetworkStatus;
