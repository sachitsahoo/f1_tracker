import React from "react";

import type {
  Driver,
  Interval,
  Lap,
  LeaderboardProps,
  Stint,
} from "../types/f1";
import { getDriverFlagUrl } from "../utils/countryFlags";
import { driverTeamColor } from "../utils/teamColors";

// ─── Design tokens ────────────────────────────────────────────────────────────
// F1 Broadcast / Timing Tower aesthetic.
// Carbon fiber panels, sharp edges, monochrome + team-color-only accents.

const CARBON_FIBER_BG = [
  "repeating-linear-gradient(",
  "  45deg,",
  "  rgba(255,255,255,0.013) 0px,",
  "  rgba(255,255,255,0.013) 1px,",
  "  transparent 1px,",
  "  transparent 50%",
  "),",
  "repeating-linear-gradient(",
  "  -45deg,",
  "  rgba(255,255,255,0.013) 0px,",
  "  rgba(255,255,255,0.013) 1px,",
  "  transparent 1px,",
  "  transparent 50%",
  ")",
].join("\n");

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Convert a hex colour string to rgba() for use in box-shadow / glow effects.
 * Handles 6-digit hex with or without leading #.
 */
function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.startsWith("#") ? hex.slice(1) : hex;
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

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
  // lap_start is nullable (stints recorded before the first tracked lap).
  // Treat null as 0 so the age calculation degrades gracefully.
  return currentLap - (stint.lap_start ?? 0) + (stint.tyre_age_at_start ?? 0);
}

// ─── Global keyframes (injected once) ────────────────────────────────────────

const GLOBAL_STYLES = `
  @keyframes f1-shimmer {
    0%   { background-position: -800px 0; }
    100% { background-position:  800px 0; }
  }
  .f1-flag {
    display: inline-block;
    width: 22px;
    height: 15px;
    object-fit: cover;
    border-radius: 2px;
    flex-shrink: 0;
    opacity: 0.88;
    box-shadow: 0 0 0 1px rgba(255,255,255,0.10), 0 1px 3px rgba(0,0,0,0.55);
    transition: opacity 0.2s ease;
    vertical-align: middle;
  }
  .f1-flag:hover { opacity: 1; }
  .f1-flag-placeholder {
    display: inline-block;
    width: 22px;
    height: 15px;
    border-radius: 2px;
    flex-shrink: 0;
    background: #222;
    border: 1px solid #333;
  }
`;

// ─── Loading skeleton ─────────────────────────────────────────────────────────

/**
 * Shimmer rows rendered inside the existing <rows> div — no wrapper header.
 * The outer Leaderboard already renders the header and column labels above.
 */
function LeaderboardSkeleton() {
  const shimmerStyle: React.CSSProperties = {
    background: "linear-gradient(90deg, #111111 25%, #1E1E1E 50%, #111111 75%)",
    backgroundSize: "800px 100%",
    animation: "f1-shimmer 1.6s linear infinite",
    borderRadius: 0,
  };

  return (
    <>
      {Array.from({ length: 20 }, (_, i) => (
        <div key={i} style={skeletonStyles.row} aria-hidden="true">
          {/* Position pill */}
          <div
            style={{
              ...shimmerStyle,
              width: "20px",
              height: "15px",
              flexShrink: 0,
            }}
          />

          {/* Team border + driver name */}
          <div style={skeletonStyles.driverCell}>
            <div
              style={{
                ...shimmerStyle,
                width: "4px",
                height: "22px",
                flexShrink: 0,
              }}
            />
            <div
              style={{
                ...shimmerStyle,
                width: `${48 + (i % 3) * 8}px`,
                height: "13px",
              }}
            />
          </div>

          {/* Gap */}
          <div
            style={{
              ...shimmerStyle,
              width: "52px",
              height: "11px",
              marginLeft: "auto",
              flexShrink: 0,
            }}
          />

          {/* Tire dot */}
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
              height: "11px",
              flexShrink: 0,
            }}
          />
        </div>
      ))}
    </>
  );
}

// Only the row + driverCell shapes are still used — header/colRow lived
// in the old standalone skeleton and have been removed.
const skeletonStyles: Record<string, React.CSSProperties> = {
  row: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    padding: "9px 16px 9px 12px",
    borderBottom: "1px solid #1E1E1E",
    // 4px left gap to align with real rows that have a team-color border
    paddingLeft: "16px",
  },
  driverCell: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    flex: 1,
    minWidth: 0,
  },
};

// ─── Tire compound badge colours ─────────────────────────────────────────────
// Standard F1 compound palette — distinct from team colours.

const COMPOUND_COLORS: Record<string, { bg: string; fg: string }> = {
  SOFT: { bg: "#E8002D", fg: "#FFFFFF" },
  MEDIUM: { bg: "#FFF200", fg: "#000000" },
  HARD: { bg: "#FFFFFF", fg: "#000000" },
  INTERMEDIATE: { bg: "#43B02A", fg: "#FFFFFF" },
  WET: { bg: "#0067FF", fg: "#FFFFFF" },
};

const COMPOUND_FALLBACK = { bg: "#333333", fg: "#888888" };

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
      {/* Tire compound circle — colored dot, no rounded square */}
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
      {/* Inject shimmer keyframes once */}
      <style>{GLOBAL_STYLES}</style>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div style={styles.header}>
        <span style={styles.headerTitle}>TIMING TOWER</span>
        <div style={styles.headerRight}>
          <span style={styles.lapCounter}>
            {"LAP "}
            <strong style={styles.lapNumber}>{currentLap ?? "—"}</strong>
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
      <div
        style={styles.rows}
        role="list"
        aria-label="Race standings"
        aria-busy={positions.length === 0}
      >
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

            const teamColor = driver ? driverTeamColor(driver) : "#FFFFFF";
            const abbrev = driver?.name_acronym ?? String(pos.driver_number);
            const age = stint ? tireAge(stint, currentLap) : null;

            // Leader row gets a subtle team-color glow
            const leaderGlow = isFirst
              ? `inset 0 0 24px ${hexToRgba(teamColor, 0.07)}, inset 4px 0 0 ${teamColor}`
              : undefined;

            return (
              <div
                key={pos.driver_number}
                style={{
                  ...styles.row,
                  borderLeft: `4px solid ${teamColor}`,
                  ...(isFirst
                    ? {
                        ...styles.rowLeader,
                        boxShadow: leaderGlow,
                      }
                    : {}),
                }}
                role="listitem"
                aria-label={`P${pos.position} ${abbrev}`}
              >
                {/* Position number — large, muted */}
                <span
                  style={{
                    ...styles.colPos,
                    ...styles.posNum,
                    ...(isFirst ? styles.posNumLeader : {}),
                  }}
                >
                  {pos.position}
                </span>

                {/* Driver abbreviation + nationality flag */}
                <span style={{ ...styles.colDriver, ...styles.driverCell }}>
                  {/* Country flag — falls back to acronym map when API returns null */}
                  {(() => {
                    const flag1x = getDriverFlagUrl(
                      driver?.country_code,
                      driver?.name_acronym,
                      1,
                    );
                    const flag2x = getDriverFlagUrl(
                      driver?.country_code,
                      driver?.name_acronym,
                      2,
                    );
                    return flag1x ? (
                      <img
                        className="f1-flag"
                        src={flag1x}
                        srcSet={`${flag1x} 1x, ${flag2x ?? flag1x} 2x`}
                        alt={driver?.country_code ?? driver?.name_acronym ?? ""}
                        title={
                          driver?.country_code ?? driver?.name_acronym ?? ""
                        }
                        aria-hidden="true"
                      />
                    ) : (
                      <span
                        className="f1-flag-placeholder"
                        aria-hidden="true"
                      />
                    );
                  })()}
                  <span style={styles.abbreviation}>{abbrev}</span>
                </span>

                {/* Gap to leader — monospace, tabular */}
                <span
                  style={{
                    ...styles.colGap,
                    ...styles.gapText,
                    ...(isFirst ? styles.gapLeader : {}),
                  }}
                >
                  {formatGap(interval?.gap_to_leader ?? null, pos.position)}
                </span>

                {/* Tire compound circle + age */}
                <span style={styles.colTire}>
                  <TireBadge compound={stint?.compound} age={age} />
                </span>

                {/* Last lap time — monospace, tabular */}
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
// F1 Broadcast / Timing Tower aesthetic.
// Sharp edges throughout (borderRadius: 0 on all data elements).
// Font: Inter for UI labels, JetBrains Mono for all numeric data.

const MONO_FONT = "'JetBrains Mono', 'Roboto Mono', 'Courier New', monospace";
const LABEL_FONT = "'Inter', 'Roboto', sans-serif";

const styles: Record<string, React.CSSProperties> = {
  // ── Container — carbon fiber panel
  container: {
    fontFamily: MONO_FONT,
    fontSize: "12px",
    backgroundColor: "#0A0A0A",
    backgroundImage: CARBON_FIBER_BG,
    backgroundSize: "4px 4px",
    color: "#E0E0E0",
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
    minWidth: "420px",
    boxShadow: "0 0 0 1px #1E1E1E, 0 8px 32px rgba(0,0,0,0.8)",
  },

  // ── Header — carbon panel, thick red bottom border
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "11px 16px",
    backgroundColor: "#111111",
    backgroundImage: CARBON_FIBER_BG,
    backgroundSize: "4px 4px",
    borderBottom: "2px solid #E8002D",
  },
  headerTitle: {
    fontFamily: LABEL_FONT,
    fontSize: "11px",
    fontWeight: 700,
    letterSpacing: "0.18em",
    color: "#AAAAAA",
    textTransform: "uppercase" as const,
  },
  headerRight: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
  },
  lapCounter: {
    fontFamily: MONO_FONT,
    fontSize: "11px",
    color: "#777777",
    letterSpacing: "0.05em",
    fontVariantNumeric: "tabular-nums",
  },
  lapNumber: {
    color: "#CCCCCC",
    fontWeight: 700,
  },
  // Replay badge — amber, sharp edges
  replayBadge: {
    fontFamily: LABEL_FONT,
    fontSize: "9px",
    fontWeight: 800,
    letterSpacing: "0.16em",
    color: "#D97706",
    backgroundColor: "#1A1200",
    border: "1px solid #D97706",
    padding: "2px 7px",
    borderRadius: 0,
    textTransform: "uppercase" as const,
  },

  // ── Column header row
  colHeaderRow: {
    display: "flex",
    alignItems: "center",
    padding: "5px 16px",
    paddingLeft: "20px", // compensates for the 4px team-color border on rows
    backgroundColor: "#0D0D0D",
    borderBottom: "1px solid #1E1E1E",
  },
  colHeaderLabel: {
    fontFamily: LABEL_FONT,
    fontSize: "9px",
    fontWeight: 700,
    letterSpacing: "0.14em",
    color: "#444444",
    textTransform: "uppercase" as const,
  },

  // ── Column widths (shared between header and data rows)
  colPos: { width: "32px", flexShrink: 0 },
  colDriver: { flex: 1, minWidth: "110px" },
  colGap: { width: "80px", flexShrink: 0, textAlign: "right" as const },
  colTire: { width: "68px", flexShrink: 0, textAlign: "center" as const },
  colLap: { width: "84px", flexShrink: 0, textAlign: "right" as const },

  // ── Rows — sharp edges, 1px #222 dividers, 300ms transition
  rows: {
    display: "flex",
    flexDirection: "column",
    overflowY: "auto",
    maxHeight: "640px",
  },
  row: {
    display: "flex",
    alignItems: "center",
    padding: "8px 16px 8px 12px",
    borderBottom: "1px solid #222222",
    transition: "background-color 0.3s ease, box-shadow 0.3s ease",
    // borderLeft is set dynamically per-row in team color
  },
  rowLeader: {
    backgroundColor: "#141414",
  },

  // ── Position number — large, muted
  posNum: {
    fontFamily: MONO_FONT,
    fontSize: "15px",
    fontWeight: 700,
    color: "#555555",
    letterSpacing: 0,
  },
  posNumLeader: {
    color: "#DDDDDD",
  },

  // ── Driver cell
  driverCell: {
    display: "flex",
    alignItems: "center",
    gap: "7px",
  },
  // Driver abbreviation — bold white, generous letter-spacing
  abbreviation: {
    fontFamily: MONO_FONT,
    fontSize: "13px",
    fontWeight: 700,
    color: "#EEEEEE",
    letterSpacing: "0.10em",
  },

  // ── Gap — monospace, tabular-nums, right-aligned
  gapText: {
    fontFamily: MONO_FONT,
    fontSize: "11px",
    color: "#777777",
    fontVariantNumeric: "tabular-nums",
    letterSpacing: "0.02em",
  },
  gapLeader: {
    fontSize: "10px",
    color: "#E8002D",
    fontWeight: 700,
    letterSpacing: "0.08em",
  },

  // ── Tire compound dot
  tireCell: {
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
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
    fontFamily: MONO_FONT,
  },
  tireAge: {
    fontFamily: MONO_FONT,
    fontSize: "10px",
    color: "#666666",
    fontVariantNumeric: "tabular-nums",
    minWidth: "16px",
  },

  // ── Lap time — monospace, tabular-nums
  lapTime: {
    fontFamily: MONO_FONT,
    fontSize: "11px",
    color: "#BBBBBB",
    fontVariantNumeric: "tabular-nums",
    letterSpacing: "0.02em",
  },

  // ── Empty / error state
  empty: {
    padding: "32px 16px",
    textAlign: "center",
    color: "#444444",
    fontFamily: MONO_FONT,
    fontSize: "11px",
    letterSpacing: "0.08em",
  },
};
