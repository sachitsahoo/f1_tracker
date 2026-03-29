import React from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ErrorBoundaryProps {
  children: React.ReactNode;
  /**
   * Optional custom fallback element. When provided it replaces the default
   * F1-themed error screen. The retry mechanism is not available when a custom
   * fallback is used — implement your own reset logic if needed.
   */
  fallback?: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Top-level React error boundary for the F1 Live Tracker.
 *
 * Catches unhandled render errors anywhere in the child tree and displays a
 * styled fallback UI with a **Retry** button. Clicking Retry resets the
 * boundary state so the subtree remounts cleanly.
 *
 * Does NOT catch errors inside:
 *  - Async event handlers (use try/catch there)
 *  - The boundary component itself
 *  - Promise rejections that are not thrown from render
 *
 * Errors are logged via `console.error` with the component stack for
 * debugging. In a production setup you would send these to an error
 * reporting service (Sentry, etc.) from `componentDidCatch`.
 */
export default class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error(
      "[F1 Tracker] Uncaught render error:",
      error,
      info.componentStack,
    );
  }

  private handleRetry = (): void => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    // Custom fallback provided by the parent
    if (this.props.fallback) {
      return this.props.fallback;
    }

    // ── Default F1-themed fallback ──────────────────────────────────────────
    const { error } = this.state;

    return (
      <div style={styles.page} role="alert">
        <div style={styles.container}>
          {/* Red flag icon — matches F1 broadcast error colour */}
          <span style={styles.flagIcon} aria-hidden="true">
            🔴
          </span>

          <span style={styles.title}>SOMETHING WENT WRONG</span>

          <span style={styles.message}>
            {error?.message ?? "An unexpected error occurred in the tracker."}
          </span>

          {/* Stack trace (truncated) — collapsed by default via <details> */}
          {error?.stack && (
            <details style={styles.details}>
              <summary style={styles.detailsSummary}>Stack trace</summary>
              <pre style={styles.stack}>
                {error.stack.split("\n").slice(0, 8).join("\n")}
              </pre>
            </details>
          )}

          {/* Retry — resets boundary state, subtree remounts */}
          <button
            style={styles.retryButton}
            onClick={this.handleRetry}
            aria-label="Retry — remount the application"
          >
            ↺&nbsp;&nbsp;RETRY
          </button>

          <span style={styles.hint}>
            If the problem persists, check the console for details.
          </span>
        </div>
      </div>
    );
  }
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const BASE_FONT: React.CSSProperties = {
  fontFamily: "'Roboto Mono', 'Courier New', monospace",
  letterSpacing: "0.05em",
};

const styles: Record<string, React.CSSProperties> = {
  page: {
    ...BASE_FONT,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    minHeight: "100vh",
    backgroundColor: "#0D0D0D",
    color: "#E0E0E0",
    padding: "32px",
    boxSizing: "border-box",
  },

  container: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "16px",
    maxWidth: "520px",
    width: "100%",
    textAlign: "center",
  },

  flagIcon: {
    fontSize: "40px",
    lineHeight: 1,
    marginBottom: "4px",
  },

  title: {
    fontSize: "20px",
    fontWeight: 900,
    letterSpacing: "0.14em",
    color: "#E8002D",
    textTransform: "uppercase" as const,
  },

  message: {
    fontSize: "14px",
    color: "#AAAAAA",
    lineHeight: 1.6,
    letterSpacing: "0.03em",
    maxWidth: "440px",
  },

  details: {
    width: "100%",
    textAlign: "left" as const,
    marginTop: "4px",
  },

  detailsSummary: {
    fontSize: "11px",
    color: "#666666",
    letterSpacing: "0.08em",
    cursor: "pointer",
    userSelect: "none" as const,
    textTransform: "uppercase" as const,
    marginBottom: "6px",
  },

  stack: {
    fontSize: "10px",
    color: "#555555",
    backgroundColor: "#141414",
    border: "1px solid #2A2A2A",
    borderRadius: "4px",
    padding: "10px 12px",
    overflowX: "auto" as const,
    lineHeight: 1.5,
    letterSpacing: "0",
    margin: 0,
    whiteSpace: "pre" as const,
  },

  retryButton: {
    ...BASE_FONT,
    marginTop: "8px",
    padding: "10px 28px",
    backgroundColor: "#E8002D",
    color: "#FFFFFF",
    border: "none",
    borderRadius: "4px",
    fontSize: "13px",
    fontWeight: 900,
    letterSpacing: "0.14em",
    textTransform: "uppercase" as const,
    cursor: "pointer",
    transition: "background-color 0.2s ease",
  },

  hint: {
    fontSize: "11px",
    color: "#444444",
    letterSpacing: "0.05em",
    marginTop: "4px",
  },
};
