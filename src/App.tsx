import React, { useMemo } from "react";

import type { Position, Stint } from "./types/f1";
import { useSession } from "./hooks/useSession";
import { useDrivers } from "./hooks/useDrivers";
import { usePositions } from "./hooks/usePositions";
import { useLocations } from "./hooks/useLocations";
import { useStints } from "./hooks/useStints";
import StatusBar from "./components/StatusBar";
import TrackMap from "./components/TrackMap";
import Leaderboard from "./components/Leaderboard";
import NetworkStatusOverlay from "./components/NetworkStatusOverlay";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Returns true when the current wall-clock time falls within the session
 * window [date_start, date_end]. False for historical / replay data.
 */
function deriveIsLive(
  session: { date_start: string; date_end: string } | null,
): boolean {
  if (!session) return false;
  const now = Date.now();
  return (
    new Date(session.date_start).getTime() <= now &&
    now <= new Date(session.date_end).getTime()
  );
}

// ─── App ──────────────────────────────────────────────────────────────────────

export default function App() {
  // ── 1. Session ─────────────────────────────────────────────────────────────
  // Fetches once on mount; resolves to the most recent Race session for the
  // current calendar year (or the last one if we are between race weekends).
  const {
    session,
    loading: sessionLoading,
    error: sessionError,
  } = useSession();

  const sessionKey = session?.session_key ?? null;

  // ── 2. Data hooks (all pause when sessionKey is null) ──────────────────────
  const { drivers } = useDrivers(sessionKey);
  const { positions: positionsMap, intervals } = usePositions(sessionKey);
  const { locations } = useLocations(sessionKey);
  const { stints: stintsArray } = useStints(sessionKey);

  // ── 3. Derived values ──────────────────────────────────────────────────────

  // isLive: current wall-clock time is inside the session window
  const isLive = deriveIsLive(session);

  // Position[] sorted ascending (P1 first) — Leaderboard expects an array
  const sortedPositions: Position[] = useMemo(
    () => Object.values(positionsMap).sort((a, b) => a.position - b.position),
    [positionsMap],
  );

  // Latest active stint per driver (Record<number, Stint>) for the Leaderboard.
  // useStints returns the full history; we keep whichever stint has the highest
  // lap_start (most recently started) for each driver.
  const stintMap: Record<number, Stint> = useMemo(() => {
    const map: Record<number, Stint> = {};
    for (const stint of stintsArray) {
      const existing = map[stint.driver_number];
      if (!existing || stint.lap_start > existing.lap_start) {
        map[stint.driver_number] = stint;
      }
    }
    return map;
  }, [stintsArray]);

  // ── 4. Loading / error screens ────────────────────────────────────────────

  if (sessionLoading) {
    return (
      <div style={styles.page}>
        <div style={styles.centreScreen}>
          <span style={styles.spinnerRing} aria-hidden="true" />
          <span style={styles.loadingText}>CONNECTING TO F1 LIVE TIMING…</span>
        </div>
      </div>
    );
  }

  if (sessionError) {
    const isRateLimit = sessionError.isRateLimit;
    return (
      <div style={styles.page}>
        <div style={styles.centreScreen}>
          <span style={styles.errorLabel}>
            {isRateLimit ? "RATE LIMITED" : "API ERROR"}
          </span>
          <span style={styles.errorMessage}>{sessionError.message}</span>
          {isRateLimit && (
            <span style={styles.errorHint}>
              OpenF1 free tier: max 3 req/s · 30 req/min. Refresh in a moment.
            </span>
          )}
        </div>
      </div>
    );
  }

  // ── 5. Main layout ────────────────────────────────────────────────────────

  return (
    <div style={styles.page}>
      {/*
       * REPLAY banner — prominent yellow bar shown whenever we are displaying
       * historical data (session exists but its window has already closed).
       * The StatusBar also shows a REPLAY badge, but this banner is more
       * visible when the user first loads a non-live session.
       */}
      {session !== null && !isLive && (
        <div style={styles.replayBanner} role="status" aria-live="polite">
          <span style={styles.replayIcon} aria-hidden="true">
            ⏮
          </span>
          <span style={styles.replayText}>REPLAY</span>
          <span style={styles.replayDivider} aria-hidden="true">
            ·
          </span>
          <span style={styles.replayDetail}>{session.session_name}</span>
          <span style={styles.replayDivider} aria-hidden="true">
            ·
          </span>
          <span style={styles.replayDetail}>
            {session.circuit_short_name}, {session.country_name}
          </span>
          <span style={styles.replayDivider} aria-hidden="true">
            ·
          </span>
          <span style={styles.replayDetail}>{session.year}</span>
          <span style={styles.replayNote}>
            Showing most recent available session — no live session is active.
          </span>
        </div>
      )}

      {/* Off-season state: session is null after a successful fetch (edge case). */}
      {session === null && !sessionLoading && (
        <div style={styles.offSeasonBanner} role="status">
          <span style={styles.offSeasonIcon} aria-hidden="true">
            🏁
          </span>
          <span style={styles.offSeasonText}>
            OFF-SEASON — No race sessions found for the current year.
          </span>
        </div>
      )}

      {/* ── Network status: connection-lost banner + toast stack ─────────── */}
      <NetworkStatusOverlay />

      {/* ── Status bar: full-width top strip ──────────────────────────────── */}
      <StatusBar
        session={session}
        currentLap={null}
        totalLaps={null}
        isLive={isLive}
      />

      {/* ── Two-panel body ─────────────────────────────────────────────────── */}
      <div style={styles.body}>
        {/* Left: SVG track map — ~60% of remaining width */}
        <div style={styles.mapPanel}>
          {session !== null ? (
            <TrackMap
              circuitKey={session.circuit_key}
              year={session.year}
              drivers={drivers}
              locations={locations}
            />
          ) : (
            /* Placeholder when there is genuinely no session to display */
            <div style={styles.noSessionPlaceholder}>
              <span style={styles.noSessionIcon} aria-hidden="true">
                🏎
              </span>
              <span style={styles.noSessionLabel}>No session available</span>
              <span style={styles.noSessionSubLabel}>
                Check back during a race weekend.
              </span>
            </div>
          )}
        </div>

        {/* Right: Ranked leaderboard — ~40% of remaining width */}
        <div style={styles.leaderboardPanel}>
          <Leaderboard
            positions={sortedPositions}
            drivers={drivers}
            intervals={intervals}
            stints={stintMap}
            laps={{}}
            currentLap={null}
            totalLaps={null}
            isLive={isLive}
          />
        </div>
      </div>
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
//
// Layout contract
// ───────────────
// • #page    — full-viewport dark container, vertical flex column
// • #body    — flex row, fills remaining height after StatusBar (48px)
//   – .map-panel         : flex 3 3 0, min-width 560px  (~60%)
//   – .leaderboard-panel : flex 0 0 auto, width 420px   (~40%)
//
// At 1024px: map gets 1024−420 = 604px (~59 %) — exactly within spec.
// Nothing shrinks below 1024px total; overflow-x auto on the page guards
// against viewport widths < 1024px without breaking the layout.

const BASE_FONT: React.CSSProperties = {
  fontFamily: "'Roboto Mono', 'Courier New', monospace",
  letterSpacing: "0.05em",
};

const styles: Record<string, React.CSSProperties> = {
  // ── Root page ──────────────────────────────────────────────────────────────
  page: {
    ...BASE_FONT,
    display: "flex",
    flexDirection: "column",
    backgroundColor: "#0D0D0D",
    color: "#E0E0E0",
    minHeight: "100vh",
    minWidth: "1024px", // responsive floor; prevents layout breakage below
    overflowX: "auto",
    boxSizing: "border-box",
  },

  // ── Two-panel body ─────────────────────────────────────────────────────────
  body: {
    display: "flex",
    flexDirection: "row",
    flex: "1 1 0",
    alignItems: "stretch",
    overflow: "hidden",
    gap: "0",
  },

  // ── Left panel — track map ─────────────────────────────────────────────────
  mapPanel: {
    flex: "3 3 0",
    minWidth: "560px",
    display: "flex",
    flexDirection: "column",
    backgroundColor: "#0D0D0D",
    overflow: "hidden",
    position: "relative",
  },

  // ── Right panel — leaderboard ──────────────────────────────────────────────
  leaderboardPanel: {
    width: "420px",
    flexShrink: 0,
    display: "flex",
    flexDirection: "column",
    borderLeft: "1px solid #222222",
    overflowY: "auto",
  },

  // ── REPLAY banner ──────────────────────────────────────────────────────────
  // High-visibility yellow strip rendered above the StatusBar when viewing
  // historical / non-live session data.
  replayBanner: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: "8px",
    padding: "7px 16px",
    backgroundColor: "#FFF200",
    color: "#111111",
    fontSize: "11px",
    fontWeight: 700,
    letterSpacing: "0.1em",
    borderBottom: "1px solid #C8C000",
    lineHeight: 1.4,
  },
  replayIcon: {
    fontSize: "14px",
    flexShrink: 0,
  },
  replayText: {
    fontSize: "12px",
    fontWeight: 900,
    letterSpacing: "0.16em",
    textTransform: "uppercase" as const,
    flexShrink: 0,
  },
  replayDivider: {
    color: "#666600",
    flexShrink: 0,
  },
  replayDetail: {
    fontSize: "11px",
    fontWeight: 600,
    textTransform: "uppercase" as const,
    letterSpacing: "0.08em",
    flexShrink: 0,
  },
  replayNote: {
    marginLeft: "auto",
    fontSize: "10px",
    fontWeight: 500,
    color: "#555500",
    letterSpacing: "0.04em",
    fontStyle: "italic",
    flexShrink: 0,
    maxWidth: "360px",
    textAlign: "right" as const,
  },

  // ── Off-season banner ──────────────────────────────────────────────────────
  // Shown only when the API returns an empty session list for the year
  // (true off-season, not just historical replay data).
  offSeasonBanner: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    padding: "8px 16px",
    backgroundColor: "#1A1A1A",
    color: "#888888",
    fontSize: "11px",
    fontWeight: 700,
    letterSpacing: "0.1em",
    borderBottom: "1px solid #2A2A2A",
  },
  offSeasonIcon: {
    fontSize: "16px",
  },
  offSeasonText: {
    textTransform: "uppercase" as const,
    letterSpacing: "0.08em",
  },

  // ── Full-screen loading / error ────────────────────────────────────────────
  centreScreen: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: "16px",
    flex: "1 1 0",
    padding: "48px",
  },

  spinnerRing: {
    display: "inline-block",
    width: "40px",
    height: "40px",
    border: "3px solid #333333",
    borderTopColor: "#E8002D",
    borderRadius: "50%",
    animation: "spin 0.8s linear infinite",
  },
  loadingText: {
    fontSize: "13px",
    fontWeight: 700,
    letterSpacing: "0.14em",
    color: "#666666",
    textTransform: "uppercase" as const,
  },

  errorLabel: {
    fontSize: "18px",
    fontWeight: 900,
    letterSpacing: "0.12em",
    color: "#E8002D",
    textTransform: "uppercase" as const,
  },
  errorMessage: {
    fontSize: "13px",
    color: "#AAAAAA",
    letterSpacing: "0.04em",
    maxWidth: "480px",
    textAlign: "center" as const,
    lineHeight: 1.6,
  },
  errorHint: {
    fontSize: "11px",
    color: "#666666",
    letterSpacing: "0.04em",
    maxWidth: "400px",
    textAlign: "center" as const,
    lineHeight: 1.6,
    marginTop: "4px",
  },

  // ── No-session placeholder inside the map panel ───────────────────────────
  noSessionPlaceholder: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: "12px",
    flex: "1 1 0",
    padding: "48px",
  },
  noSessionIcon: {
    fontSize: "48px",
    lineHeight: 1,
    opacity: 0.3,
  },
  noSessionLabel: {
    fontSize: "14px",
    fontWeight: 700,
    letterSpacing: "0.14em",
    color: "#555555",
    textTransform: "uppercase" as const,
  },
  noSessionSubLabel: {
    fontSize: "12px",
    color: "#444444",
    letterSpacing: "0.06em",
  },
};
