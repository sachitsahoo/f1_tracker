import React from "react";

import type {
  Driver,
  Interval,
  Lap,
  LeaderboardProps,
  Stint,
} from "../types/f1";
import { getTeamColor } from "../utils/teamColors";

// ─── Loading skeleton ─────────────────────────────────────────────────────────

/**
 * Shown while the first batch of position + driver data is still loading.
 * 20 shimmer rows — one per potential grid slot.
 */
function LeaderboardSkeleton() {
  const shimmerStyle: React.CSSProperties = {
    background: "linear-gradient(90deg, #1a1a1a 25%, #252525 50%, #1a1a1a 75%)",
    backgroundSize: "800px 100%",
    animation: "f1-shimmer 1.6s linear infinite",
    borderRadius: "3px",
  };

  return (
    <div
      style={skeletonStyles.container}
      aria-busy="true"
      aria-label="Loading race standings"
    >
      {/* Header mirrors real header */}
      <div style={skeletonStyles.header}>
        <span style={skeletonStyles.headerTitle}>LEADERBOARD</span>
        <div
          style={{
            ...shimmerStyle,
            width: "80px",
            height: "14px",
            borderRadius: "3px",
          }}
        />
      </div>

      {/* Column header row */}
      <div style={skeletonStyles.colRow}>
        {["36px", "1fr", "80px", "68px", "80px"].map((w, i) => (
          <div
            key={i}
            style={{
              ...shimmerStyle,
              width: typeof w === "string" && w.endsWith("fr") ? "60px" : w,
              height: "10px",
              flexShrink: 0,
            }}
          />
        ))}
      </div>

      {/* 20 placeholder rows */}
      {Array.from({ length: 20 }, (_, i) => (
        <div key={i} style={skeletonStyles.row}>
          {/* Position pill */}
          <div
            style={{
              ...shimmerStyle,
              width: "20px",
              height: "16px",
              flexShrink: 0,
            }}
          />
          {/* Team swatch + name */}
          <div style={{ ...skeletonStyles.driverCell }}>
            <div
              style={{
                ...shimmerStyle,
                width: "4px",
                height: "20px",
                flexShrink: 0,
                borderRadius: "2px",
              }}
            />
            <div
              style={{
                ...shimmerStyle,
                width: `${48 + (i % 3) * 8}px`,
                height: "14px",
              }}
            />
          </div>
          {/* Gap */}
          <div
            style={{
              ...shimmerStyle,
              width: "52px",
              height: "12px",
              marginLeft: "auto",
              flexShrink: 0,
            }}
          />
          {/* Tire badge */}
          <div
            style={{
              ...shimmerStyle,
              width: "18px",
              height: "18px",
              borderRadius: "50%",
              flexShrink: 0,
            }}
          />
          {/* Lap time */}
          <div
            style={{
              ...shimmerStyle,
              width: "64px",
              height: "12px",
              flexShrink: 0,
            }}
          />
        </div>
      ))}
    </div>
  );
}

const skeletonStyles: Record<string, React.CSSProperties> = {
  container: {
    fontFamily: "'Roboto Mono', 'Courier New', monospace",
    fontSize: "12px",
    backgroundColor: "#111111",
    color: "#E0E0E0",
    borderRadius: "8px",
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
    minWidth: "420px",
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "10px 16px",
    backgroundColor: "#1A1A1A",
    borderBottom: "2px solid #E8002D",
  },
  headerTitle: {
    fontSize: "13px",
    fontWeight: 700,
    letterSpacing: "0.12em",
    color: "#444444",
    textTransform: "uppercase" as const,
  },
  colRow: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    padding: "5px 16px",
    backgroundColor: "#181818",
    borderBottom: "1px solid #2A2A2A",
  },
  row: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    padding: "9px 16px",
    borderBottom: "1px solid #1A1A1A",
  },
  driverCell: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    flex: 1,
    minWidth: 0,
  },
};

// ─── Tire compound badge colours ─────────────────────────────────────────────
// Distinct from team colours — standard F1 compound palette.

const COMPOUND_COLORS: Record<string, { bg: string; fg: string }> = {
  SOFT: { bg: "#E8002D", fg: "#FFFFFF" },
  MEDIUM: { bg: "#FFF200", fg: "#000000" },
  HARD: { bg: "#FFFFFF", fg: "#000000" },
  INTERMEDIATE: { bg: "#43B02A", fg: "#FFFFFF" },
  WET: { bg: "#0067FF", fg: "#FFFFFF" },
};

const COMPOUND_FALLBACK = { bg: "#555555", fg: "#CCCCCC" };

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Format a lap duration in seconds → "1:23.456". Returns "—" for null. */
function formatLapTime(seconds: number | null): string {
  if (seconds == null) return "—";
  const totalMs = Math.round(seconds * 1000);
  const mins = Math.floor(totalMs / 60000);
  const secs = (totalMs % 60000) / 1000;
  return `${mins}:${secs.toFixed(3).padStart(6, "0")}`;
}

/** Format gap-to-leader. P1 is always "LEADER"; null gaps show "—". */
function formatGap(gap: string | number | null, position: number): string {
  if (position === 1) return "LEADER";
  if (gap == null || gap === "") return "—";
  const str = String(gap);
  // If the API already prefixes with "+", keep it; otherwise add it
  return str.startsWith("+") || str.includes("LAP") ? str : `+${str}`;
}

/**
 * Calculate current tire age in laps.
 * tyre_age_at_start tracks laps already on the tire before this stint began.
 */
function tireAge(stint: Stint, currentLap: number | null): number | null {
  if (currentLap == null) return stint.tyre_age_at_start || null;
  return currentLap - stint.lap_start + (stint.tyre_age_at_start ?? 0);
}

// ─── Sub-components ──────────────────────────────────────────────────────────

interface TireBadgeProps {
  compound: string | undefined;
  age: number | null;
}

function TireBadge({ compound, age }: TireBadgeProps) {
  const colors = compound
    ? (COMPOUND_COLORS[compound] ?? COMPOUND_FALLBACK)
    : COMPOUND_FALLBACK;
  const label = compound ? compound.charAt(0) : "?";

  return (
    <span style={styles.tireCell}>
      <span
        style={{
          ...styles.tireBadge,
          backgroundColor: colors.bg,
          color: colors.fg,
        }}
        title={compound ?? "Unknown"}
      >
        {label}
      </span>
      <span style={styles.tireAge}>{age != null ? age : "—"}</span>
    </span>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function Leaderboard({
  positions,
  drivers,
  intervals,
  stints,
  laps,
  currentLap,
  totalLaps,
  isLive,
}: LeaderboardProps) {
  // Build O(1) lookup maps — avoids Array.find() inside the render loop
  const driverMap = new Map<number, Driver>(
    drivers.map((d) => [d.driver_number, d]),
  );
  const intervalMap: Record<number, Interval> = intervals;
  const stintMap: Record<number, Stint> = stints;
  const lapMap: Record<number, Lap> = laps;

  return (
    <div style={styles.container}>
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div style={styles.header}>
        <span style={styles.headerTitle}>LEADERBOARD</span>
        <div style={styles.headerRight}>
          <span style={styles.lapCounter}>
            LAP <strong>{currentLap ?? "—"}</strong>
            {" / "}
            {totalLaps ?? "—"}
          </span>
          {!isLive && <span style={styles.replayBadge}>REPLAY</span>}
        </div>
      </div>

      {/* ── Column headers ─────────────────────────────────────────────────── */}
      <div style={styles.colHeaderRow}>
        <span style={{ ...styles.colPos, ...styles.colHeaderLabel }}>POS</span>
        <span style={{ ...styles.colDriver, ...styles.colHeaderLabel }}>
          DRIVER
        </span>
        <span style={{ ...styles.colGap, ...styles.colHeaderLabel }}>GAP</span>
        <span style={{ ...styles.colTire, ...styles.colHeaderLabel }}>
          TIRE
        </span>
        <span style={{ ...styles.colLap, ...styles.colHeaderLabel }}>
          LAST LAP
        </span>
      </div>

      {/* ── Rows ───────────────────────────────────────────────────────────── */}
      <div style={styles.rows} role="list" aria-label="Race standings">
        {positions.length === 0 ? (
          // Show shimmer skeleton while awaiting first data from the API.
          // Once positions arrive the skeleton is replaced by real rows.
          <LeaderboardSkeleton />
        ) : (
          positions.map((pos) => {
            const driver = driverMap.get(pos.driver_number);
            const interval = intervalMap[pos.driver_number];
            const stint = stintMap[pos.driver_number];
            const lap = lapMap[pos.driver_number];
            const isFirst = pos.position === 1;

            const teamColor = driver
              ? getTeamColor(driver.team_name)
              : "#FFFFFF";
            const abbrev = driver?.name_acronym ?? String(pos.driver_number);
            const age = stint ? tireAge(stint, currentLap) : null;

            return (
              <div
                key={pos.driver_number}
                style={{ ...styles.row, ...(isFirst ? styles.rowLeader : {}) }}
                role="listitem"
                aria-label={`P${pos.position} ${abbrev}`}
              >
                {/* Position number */}
                <span
                  style={{
                    ...styles.colPos,
                    ...styles.posNum,
                    ...(isFirst ? styles.posNumLeader : {}),
                  }}
                >
                  {pos.position}
                </span>

                {/* Team colour swatch + driver abbreviation */}
                <span style={{ ...styles.colDriver, ...styles.driverCell }}>
                  <span
                    style={{
                      ...styles.colorSwatch,
                      backgroundColor: teamColor,
                    }}
                    aria-hidden="true"
                  />
                  <span style={styles.abbreviation}>{abbrev}</span>
                </span>

                {/* Gap to leader */}
                <span
                  style={{
                    ...styles.colGap,
                    ...styles.gapText,
                    ...(isFirst ? styles.gapLeader : {}),
                  }}
                >
                  {formatGap(interval?.gap_to_leader ?? null, pos.position)}
                </span>

                {/* Tire compound badge + age */}
                <span style={styles.colTire}>
                  <TireBadge compound={stint?.compound} age={age} />
                </span>

                {/* Last lap time */}
                <span style={{ ...styles.colLap, ...styles.lapTime }}>
                  {formatLapTime(lap?.lap_duration ?? null)}
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
// All sizing in px / rem; colours from teamColors.ts or explicit constants
// (never hardcoded team hex values here).

const BASE_FONT: React.CSSProperties = {
  fontFamily: "'Roboto Mono', 'Courier New', monospace",
  fontSize: "12px",
  letterSpacing: "0.04em",
};

const styles: Record<string, React.CSSProperties> = {
  container: {
    ...BASE_FONT,
    backgroundColor: "#111111",
    color: "#E0E0E0",
    borderRadius: "8px",
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
    minWidth: "420px",
    boxShadow: "0 4px 24px rgba(0,0,0,0.6)",
  },

  // ── Header
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "10px 16px",
    backgroundColor: "#1A1A1A",
    borderBottom: "2px solid #E8002D",
  },
  headerTitle: {
    fontSize: "13px",
    fontWeight: 700,
    letterSpacing: "0.12em",
    color: "#FFFFFF",
    textTransform: "uppercase" as const,
  },
  headerRight: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
  },
  lapCounter: {
    fontSize: "12px",
    color: "#AAAAAA",
    letterSpacing: "0.06em",
  },
  replayBadge: {
    fontSize: "10px",
    fontWeight: 700,
    letterSpacing: "0.1em",
    color: "#111111",
    backgroundColor: "#FFF200",
    padding: "2px 7px",
    borderRadius: "3px",
    textTransform: "uppercase" as const,
  },

  // ── Column header row
  colHeaderRow: {
    display: "flex",
    alignItems: "center",
    padding: "5px 16px",
    backgroundColor: "#181818",
    borderBottom: "1px solid #2A2A2A",
  },
  colHeaderLabel: {
    fontSize: "10px",
    fontWeight: 700,
    letterSpacing: "0.1em",
    color: "#666666",
    textTransform: "uppercase" as const,
  },

  // ── Column widths (shared between header and data rows)
  colPos: { width: "36px", flexShrink: 0 },
  colDriver: { flex: 1, minWidth: "80px" },
  colGap: { width: "80px", flexShrink: 0, textAlign: "right" as const },
  colTire: { width: "68px", flexShrink: 0, textAlign: "center" as const },
  colLap: { width: "80px", flexShrink: 0, textAlign: "right" as const },

  // ── Rows
  rows: {
    display: "flex",
    flexDirection: "column",
    overflowY: "auto",
    maxHeight: "640px",
  },
  row: {
    display: "flex",
    alignItems: "center",
    padding: "7px 16px",
    borderBottom: "1px solid #1E1E1E",
    transition: "background-color 0.2s ease",
  },
  rowLeader: {
    backgroundColor: "#1C1C1C",
    borderLeft: "3px solid #E8002D",
    paddingLeft: "13px", // compensate for border-left width
  },

  // ── Position number
  posNum: {
    fontSize: "14px",
    fontWeight: 700,
    color: "#888888",
  },
  posNumLeader: {
    color: "#E8002D",
  },

  // ── Driver cell
  driverCell: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
  },
  colorSwatch: {
    width: "4px",
    height: "20px",
    borderRadius: "2px",
    flexShrink: 0,
  },
  abbreviation: {
    fontSize: "13px",
    fontWeight: 700,
    color: "#FFFFFF",
    letterSpacing: "0.08em",
  },

  // ── Gap
  gapText: {
    fontSize: "12px",
    color: "#AAAAAA",
    fontVariantNumeric: "tabular-nums",
  },
  gapLeader: {
    fontSize: "11px",
    color: "#E8002D",
    fontWeight: 700,
    letterSpacing: "0.06em",
  },

  // ── Tire
  tireCell: {
    display: "inline-flex",
    alignItems: "center",
    gap: "5px",
    justifyContent: "center",
    width: "100%",
  },
  tireBadge: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: "18px",
    height: "18px",
    borderRadius: "50%",
    fontSize: "10px",
    fontWeight: 900,
    letterSpacing: 0,
    flexShrink: 0,
    lineHeight: 1,
  },
  tireAge: {
    fontSize: "11px",
    color: "#888888",
    fontVariantNumeric: "tabular-nums",
    minWidth: "18px",
  },

  // ── Lap time
  lapTime: {
    fontSize: "12px",
    color: "#CCCCCC",
    fontVariantNumeric: "tabular-nums",
  },

  // ── Empty state
  empty: {
    padding: "32px 16px",
    textAlign: "center",
    color: "#555555",
    fontSize: "13px",
    letterSpacing: "0.06em",
  },
};
