import React, { useMemo, useState, useEffect } from "react";

import type { Position, Interval, Session, Stint, Lap } from "./types/f1";
import { useSessions } from "./hooks/useSessions";
import { useDrivers } from "./hooks/useDrivers";
import { usePositions } from "./hooks/usePositions";
import { useLocationStream } from "./hooks/useLocationStream";
import { useLocationSnapshot } from "./hooks/useLocationSnapshot";
import { useStints } from "./hooks/useStints";
import { useLaps } from "./hooks/useLaps";
import { useRaceControl } from "./hooks/useRaceControl";
import StatusBar from "./components/StatusBar";
import TrackMap from "./components/TrackMap";
import Leaderboard from "./components/Leaderboard";
import ReplayScrubber from "./components/ReplayScrubber";
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

/**
 * Given all laps for a session and a target lap number, returns the ISO
 * timestamp after which the race state represents "end of lap N".
 *
 * Strategy: find the last driver to start lap N, then add their lap duration.
 * This ensures we capture position data for every driver finishing that lap.
 */
function lapCutoffDate(laps: Lap[], lapNumber: number): string | null {
  const records = laps.filter((l) => l.lap_number === lapNumber);
  if (records.length === 0) return null;

  // Compare by milliseconds, not strings — string comparison breaks when
  // timestamps have mixed timezone representations (e.g. +00:00 vs Z).
  const latestStartMs = Math.max(
    ...records.map((l) => new Date(l.date_start).getTime()),
  );
  const maxDuration = Math.max(...records.map((l) => l.lap_duration ?? 120));
  return new Date(latestStartMs + maxDuration * 1000).toISOString();
}

/**
 * Reduces a flat array of timestamped records to a map of the most recent
 * record per driver_number. Used to derive leaderboard state at a point in time.
 */
function latestPerDriver<T extends { driver_number: number; date: string }>(
  records: T[],
): Record<number, T> {
  return records.reduce(
    (acc, r) => {
      const existing = acc[r.driver_number];
      if (!existing || r.date > existing.date) acc[r.driver_number] = r;
      return acc;
    },
    {} as Record<number, T>,
  );
}

// ─── App ──────────────────────────────────────────────────────────────────────

export default function App() {
  // ── 1. Session ─────────────────────────────────────────────────────────────
  // Fetches once on mount; resolves to the most recent Race session for the
  // current calendar year (or the last one if we are between race weekends).
  const {
    sessions,
    defaultSession,
    loading: sessionLoading,
    error: sessionError,
  } = useSessions();

  // Tracks the session the user has explicitly chosen from the picker.
  // null means "follow the default" — session always reflects the latest race
  // until the user overrides it. This prevents a stale auto-selection when
  // useSessions resolves its two parallel fetches at different times and
  // defaultSession flips to a newer race after selectedSession was already set.
  const [userPickedSession, setUserPickedSession] = useState<Session | null>(
    null,
  );

  const session = userPickedSession ?? defaultSession;
  const sessionKey = session?.session_key ?? null;

  // isLive must be derived before the data hooks so they can use it to decide
  // whether to keep polling (live) or stop after the initial fetch (historical).
  const isLive = deriveIsLive(session);

  // ── Staggered session keys — prevents startup burst over rate limit ─────────
  //
  // When sessionKey first becomes non-null, every hook fires simultaneously.
  // That's 7 concurrent requests — just over the 6 req/s sponsor-tier limit —
  // causing a 429 which fetchWithRetry backs off for 60 s.
  //
  // Solution: three priority tiers, each gets the session key with a small delay.
  //   Tier 1 (immediate):  drivers + positions/intervals — needed for leaderboard
  //   Tier 2 (+200 ms):    stints + location stream     — tires and track map
  //   Tier 3 (+400 ms):    laps + race control          — scrubber and flags
  //
  // Max concurrent requests per window: 3 at t=0, 2 at t+200ms, 2 at t+400ms.
  // Stays comfortably within 6 req/s · 60 req/min (OpenF1 sponsor tier).
  const [tier2Key, setTier2Key] = useState<number | null>(null);
  const [tier3Key, setTier3Key] = useState<number | null>(null);

  useEffect(() => {
    if (sessionKey === null) {
      setTier2Key(null);
      setTier3Key(null);
      return;
    }
    const t2 = setTimeout(() => setTier2Key(sessionKey), 200);
    const t3 = setTimeout(() => setTier3Key(sessionKey), 400);
    return () => {
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, [sessionKey]);

  // ── 2. Data hooks (all pause when their session key is null) ───────────────
  const { drivers } = useDrivers(sessionKey); // Tier 1 — immediate
  const {
    positions: positionsMap,
    intervals,
    allPositions,
    allIntervals,
  } = usePositions(sessionKey, isLive); // Tier 1 — immediate
  const { locations: streamLocations } = useLocationStream(tier2Key, isLive); // Tier 2 — +400ms
  const { stints: stintsArray } = useStints(tier2Key, isLive); // Tier 2 — +400ms
  const { laps, totalLaps } = useLaps(tier3Key); // Tier 3 — +800ms
  const { messages } = useRaceControl(tier3Key, isLive); // Tier 3 — +800ms

  // ── 3. Replay scrubber state ───────────────────────────────────────────────

  const [replayLap, setReplayLap] = useState<number>(1);

  // Whenever totalLaps resolves or the session changes, jump to the final lap
  // so the default view shows the end-of-race standings.
  useEffect(() => {
    if (totalLaps != null) setReplayLap(totalLaps);
  }, [sessionKey, totalLaps]);

  // ── 4. Derived values ──────────────────────────────────────────────────────

  // For replay mode: compute the ISO cutoff timestamp for the selected lap.
  // null means "show everything" (used when live or scrubbed to the final lap).
  const replayCutoff: string | null = useMemo(() => {
    if (isLive || totalLaps == null) return null;
    if (replayLap >= totalLaps) return null; // final lap → no filtering
    return lapCutoffDate(laps, replayLap);
  }, [isLive, laps, replayLap, totalLaps]);

  // Location snapshot — fetches a 30-second window of X/Y data ending at
  // replayCutoff. Debounced 250 ms so rapid slider drags don't hammer the API.
  // Inactive when replayCutoff is null (live session or scrubber at final lap).
  const { locations: snapshotLocations } = useLocationSnapshot(
    sessionKey,
    replayCutoff,
  );

  // Track-map locations: use snapshot when scrubbing, stream otherwise.
  const displayLocations =
    replayCutoff !== null ? snapshotLocations : streamLocations;

  // Positions to display — filtered to the scrubber lap when in replay mode.
  const displayPositionsMap: Record<number, Position> = useMemo(() => {
    if (replayCutoff === null) return positionsMap;
    return latestPerDriver(allPositions.filter((p) => p.date <= replayCutoff));
  }, [replayCutoff, positionsMap, allPositions]);

  // Intervals to display — same cutoff logic.
  const displayIntervals: Record<number, Interval> = useMemo(() => {
    if (replayCutoff === null) return intervals;
    return latestPerDriver(allIntervals.filter((i) => i.date <= replayCutoff));
  }, [replayCutoff, intervals, allIntervals]);

  // Position[] sorted ascending (P1 first) — Leaderboard expects an array
  const sortedPositions: Position[] = useMemo(
    () =>
      Object.values(displayPositionsMap).sort(
        (a, b) => a.position - b.position,
      ),
    [displayPositionsMap],
  );

  // Stints filtered to those that had started by the selected replay lap,
  // then reduced to the latest (highest lap_start) per driver.
  // Stints where lap_start is null are included unconditionally (they started
  // before the first recorded lap) and treated as lap 0 for ordering purposes.
  const stintMap: Record<number, Stint> = useMemo(() => {
    const source =
      !isLive && replayCutoff !== null
        ? stintsArray.filter((s) => (s.lap_start ?? 0) <= replayLap)
        : stintsArray;
    const map: Record<number, Stint> = {};
    for (const stint of source) {
      const existing = map[stint.driver_number];
      if (!existing || (stint.lap_start ?? 0) > (existing.lap_start ?? 0)) {
        map[stint.driver_number] = stint;
      }
    }
    return map;
  }, [stintsArray, isLive, replayCutoff, replayLap]);

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
              OpenF1 sponsor tier: max 6 req/s · 60 req/min. Refresh in a
              moment.
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
        currentLap={!isLive ? replayLap : null}
        totalLaps={totalLaps}
        isLive={isLive}
        messages={messages}
        sessions={sessions}
        onSessionChange={setUserPickedSession}
      />

      {/* ── Two-panel body ─────────────────────────────────────────────────── */}
      {/* Extra bottom padding when the scrubber is visible so content isn't hidden. */}
      <div
        style={{
          ...styles.body,
          paddingBottom: !isLive && totalLaps != null ? "56px" : 0,
        }}
      >
        {/* Left: SVG track map — ~60% of remaining width */}
        <div style={styles.mapPanel}>
          {session !== null ? (
            <TrackMap
              circuitKey={session.circuit_key}
              year={session.year ?? new Date(session.date_start).getFullYear()}
              drivers={drivers}
              locations={displayLocations}
              isLive={isLive}
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
            intervals={displayIntervals}
            stints={stintMap}
            laps={{}}
            currentLap={!isLive ? replayLap : null}
            totalLaps={totalLaps}
            isLive={isLive}
          />
        </div>
      </div>

      {/* ── Replay scrubber — fixed bottom bar, only for historical sessions ── */}
      {!isLive && totalLaps != null && (
        <ReplayScrubber
          totalLaps={totalLaps}
          replayLap={replayLap}
          onChange={setReplayLap}
          events={messages}
        />
      )}
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
