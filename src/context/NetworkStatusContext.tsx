import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

import { setApiEventListener } from "../utils/apiEvents";
import type { NetworkStatusContextValue, Toast } from "../types/f1";

// ─── Context ──────────────────────────────────────────────────────────────────

const NetworkStatusContext = createContext<NetworkStatusContextValue>({
  toasts: [],
  dismissToast: () => {},
  connectionLost: false,
});

// ─── Hook ─────────────────────────────────────────────────────────────────────

/** Consume network status (toasts, connection-lost flag) from any component. */
export function useNetworkStatus(): NetworkStatusContextValue {
  return useContext(NetworkStatusContext);
}

// ─── Provider ─────────────────────────────────────────────────────────────────

let _idCounter = 0;

/**
 * Wraps the app and listens to API lifecycle events emitted by
 * `src/utils/apiEvents.ts`. Manages:
 *
 * - A list of `Toast` notifications (rate-limit and network-error events)
 * - A `connectionLost` boolean (cleared on the next successful API response)
 *
 * Mount once at the application root so the listener is active before any
 * fetch fires.
 */
export function NetworkStatusProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [connectionLost, setConnectionLost] = useState(false);

  // Keep a stable ref to dismissToast so addToast's closure captures it
  // without needing it as a dep (avoids re-registering the API listener).
  const dismissRef = useRef<(id: number) => void>(() => {});

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // Keep the ref up-to-date
  dismissRef.current = dismissToast;

  const addToast = useCallback((type: Toast["type"], message: string): void => {
    const id = ++_idCounter;

    // Rate-limit toasts expire after ~65 s (back-off window + 5 s buffer)
    const expiresAt = type === "rate-limit" ? Date.now() + 65_000 : undefined;

    setToasts((prev) => {
      // Cap the list at 5 to avoid overflow
      const trimmed = prev.length >= 5 ? prev.slice(-4) : prev;
      return [...trimmed, { id, type, message, expiresAt }];
    });

    // Network-error and info toasts auto-dismiss after 8 s.
    // Rate-limit toasts persist until dismissed or the backoff window elapses.
    if (type !== "rate-limit") {
      setTimeout(() => dismissRef.current(id), 8_000);
    } else {
      setTimeout(() => dismissRef.current(id), 65_000);
    }
  }, []);

  // ── Subscribe to API events ───────────────────────────────────────────────
  useEffect(() => {
    setApiEventListener((type, message) => {
      switch (type) {
        case "network-error":
          setConnectionLost(true);
          addToast("network-error", message);
          break;

        case "rate-limit":
          addToast("rate-limit", message);
          break;

        case "success":
          // A good response came back — connection restored.
          setConnectionLost(false);
          // Remove any lingering network-error toasts immediately.
          setToasts((prev) => prev.filter((t) => t.type !== "network-error"));
          break;
      }
    });

    return () => setApiEventListener(null);
  }, [addToast]);

  return (
    <NetworkStatusContext.Provider
      value={{ toasts, dismissToast, connectionLost }}
    >
      {children}
    </NetworkStatusContext.Provider>
  );
}
