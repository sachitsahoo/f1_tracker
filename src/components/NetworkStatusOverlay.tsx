import React from "react";

import { useNetworkStatus } from "../context/NetworkStatusContext";
import type { Toast } from "../types/f1";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Returns accent colours for a given toast type. */
function toastColors(type: Toast["type"]): {
  bg: string;
  border: string;
  icon: string;
} {
  switch (type) {
    case "rate-limit":
      return { bg: "#2A2600", border: "#FFF200", icon: "⏱" };
    case "network-error":
      return { bg: "#2A0008", border: "#E8002D", icon: "⚡" };
    default:
      return { bg: "#1A1A1A", border: "#444444", icon: "ℹ" };
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Renders two UI elements driven by NetworkStatusContext:
 *
 *  1. **Connection-lost banner** — a full-width strip that appears below the
 *     StatusBar whenever consecutive network errors are being received.
 *     Disappears automatically on the next successful API response.
 *
 *  2. **Toast stack** — a fixed bottom-right notification list for rate-limit
 *     warnings and transient network errors. Each toast has a dismiss button.
 *
 * This component must be rendered inside `<NetworkStatusProvider>`.
 * It contains no fetch logic — pure presentational consumer.
 */
export default function NetworkStatusOverlay(): React.ReactElement | null {
  const { toasts, dismissToast, connectionLost } = useNetworkStatus();

  const hasContent = connectionLost || toasts.length > 0;
  if (!hasContent) return null;

  return (
    <>
      {/* ── Connection lost banner ──────────────────────────────────────────── */}
      {connectionLost && (
        <div
          style={styles.connectionBanner}
          role="status"
          aria-live="assertive"
          aria-label="Connection lost"
        >
          <span style={styles.bannerIcon} aria-hidden="true">
            ⚡
          </span>
          <span style={styles.bannerText}>CONNECTION LOST</span>
          <span style={styles.bannerDivider} aria-hidden="true">
            ·
          </span>
          <span style={styles.bannerDetail}>
            Showing last known data — polling will resume automatically
          </span>
        </div>
      )}

      {/* ── Toast notification stack ────────────────────────────────────────── */}
      {toasts.length > 0 && (
        <div
          style={styles.toastContainer}
          role="log"
          aria-label="API notifications"
          aria-live="polite"
        >
          {toasts.map((toast) => {
            const colors = toastColors(toast.type);
            return (
              <div
                key={toast.id}
                style={{
                  ...styles.toast,
                  backgroundColor: colors.bg,
                  borderColor: colors.border,
                }}
                role="alert"
              >
                {/* Icon + message */}
                <span style={styles.toastIcon} aria-hidden="true">
                  {colors.icon}
                </span>
                <span style={styles.toastMessage}>{toast.message}</span>

                {/* Dismiss button */}
                <button
                  style={styles.dismissButton}
                  onClick={() => dismissToast(toast.id)}
                  aria-label="Dismiss notification"
                  title="Dismiss"
                >
                  ✕
                </button>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const BASE_FONT: React.CSSProperties = {
  fontFamily: "'Roboto Mono', 'Courier New', monospace",
  letterSpacing: "0.05em",
};

const styles: Record<string, React.CSSProperties> = {
  // ── Connection lost banner — full-width, below the StatusBar ─────────────
  connectionBanner: {
    ...BASE_FONT,
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap" as const,
    gap: "8px",
    padding: "7px 16px",
    backgroundColor: "#1A0005",
    borderBottom: "1px solid #E8002D",
    color: "#FFAAAA",
    fontSize: "11px",
    fontWeight: 700,
    letterSpacing: "0.08em",
    zIndex: 100,
  },
  bannerIcon: {
    fontSize: "14px",
    flexShrink: 0,
    color: "#E8002D",
  },
  bannerText: {
    fontSize: "12px",
    fontWeight: 900,
    letterSpacing: "0.16em",
    textTransform: "uppercase" as const,
    color: "#E8002D",
    flexShrink: 0,
  },
  bannerDivider: {
    color: "#660010",
    flexShrink: 0,
  },
  bannerDetail: {
    fontSize: "11px",
    fontWeight: 500,
    color: "#AA4455",
    letterSpacing: "0.04em",
  },

  // ── Toast stack — fixed bottom-right ────────────────────────────────────
  toastContainer: {
    position: "fixed" as const,
    bottom: "20px",
    right: "20px",
    display: "flex",
    flexDirection: "column" as const,
    gap: "8px",
    zIndex: 9999,
    maxWidth: "380px",
    width: "calc(100vw - 40px)",
    pointerEvents: "none" as const, // allow clicks to pass through the gap areas
  },

  toast: {
    ...BASE_FONT,
    display: "flex",
    alignItems: "flex-start",
    gap: "8px",
    padding: "10px 12px",
    borderRadius: "6px",
    border: "1px solid",
    fontSize: "12px",
    fontWeight: 500,
    color: "#DDDDDD",
    letterSpacing: "0.04em",
    lineHeight: 1.45,
    boxShadow: "0 4px 16px rgba(0,0,0,0.6)",
    pointerEvents: "auto" as const, // re-enable clicks on the toast itself
    animation: "slideInRight 0.2s ease",
  },

  toastIcon: {
    flexShrink: 0,
    fontSize: "14px",
    marginTop: "1px",
  },

  toastMessage: {
    flex: 1,
    minWidth: 0,
    wordBreak: "break-word" as const,
  },

  dismissButton: {
    ...BASE_FONT,
    flexShrink: 0,
    alignSelf: "flex-start",
    background: "transparent",
    border: "none",
    color: "#666666",
    cursor: "pointer",
    fontSize: "11px",
    padding: "0 0 0 6px",
    lineHeight: 1,
    marginTop: "1px",
  },
};
