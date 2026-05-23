import React from "react";

import type { RaceControl, StatusBarProps, Weather } from "../types/f1";
import SessionPicker from "./SessionPicker";

// ─── Track-status colour palette ─────────────────────────────────────────────
// Matches real F1 broadcast conventions: yellow for SC/VSC, red for red flag,
// green for green/clear track. All other messages use the neutral dark theme.

type TrackStatus = "SC" | "VSC" | "RED" | "GREEN" | "NEUTRAL";

interface StatusColors {
  accent: string; // left border + badge background
  text: string; // badge foreground text
  barBg: string; // overall bar background tint
}

const STATUS_COLORS: Record<TrackStatus, StatusColors> = {
  SC: { accent: "#FFF200", text: "#111111", barBg: "#2A2600" },
  VSC: { accent: "#FFF200", text: "#111111", barBg: "#2A2600" },
  RED: { accent: "#E8002D", text: "#FFFFFF", barBg: "#2A0008" },
  GREEN: { accent: "#27AE60", text: "#FFFFFF", barBg: "#0A1F10" },
  NEUTRAL: { accent: "#444444", text: "#CCCCCC", barBg: "#1A1A1A" },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Derive the current track status from the most recent race control message
 * that carries a meaningful flag or scope-level track status.
 *
 * The `flag` field from OpenF1 can be:
 *   'GREEN' | 'YELLOW' | 'RED' | 'SAFETY CAR' | 'VIRTUAL SAFETY CAR' | null
 * The `message` string also often contains these keywords as a secondary signal.
 */
function deriveTrackStatus(latest: RaceControl | null): TrackStatus {
  if (latest === null) return "NEUTRAL";

  const flag = (latest.flag ?? "").toUpperCase();
  const msg = (latest.message ?? "").toUpperCase();

  if (flag === "SAFETY CAR" || msg.includes("SAFETY CAR")) return "SC";
  if (flag === "VIRTUAL SAFETY CAR" || msg.includes("VIRTUAL SAFETY CAR"))
    return "VSC";
  if (flag === "RED" || msg.includes("RED FLAG")) return "RED";
  if (flag === "GREEN" || msg.includes("GREEN")) return "GREEN";

  return "NEUTRAL";
}

/** Human-readable label shown in the status badge. */
function statusLabel(status: TrackStatus): string {
  switch (status) {
    case "SC":
      return "SAFETY CAR";
    case "VSC":
      return "VSC";
    case "RED":
      return "RED FLAG";
    case "GREEN":
      return "TRACK CLEAR";
    case "NEUTRAL":
      return "—";
  }
}

/**
 * Trim a string to a maximum character budget, snapping back to the
 * nearest preceding space so words are never cut mid-letter. Appends an
 * ellipsis when truncation occurs. If no usable space exists in the
 * second half of the budget (e.g. a single very long token), falls back
 * to a hard cut so the layout still works.
 *
 * The CSS layer also applies `text-overflow: ellipsis` as a safety net
 * for genuinely overlong single tokens (URLs, run-on text).
 */
function truncateAtWordBoundary(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const sliced = text.slice(0, maxChars);
  const lastSpace = sliced.lastIndexOf(" ");
  const safe = lastSpace > maxChars * 0.5 ? sliced.slice(0, lastSpace) : sliced;
  return safe.trimEnd() + "…";
}

// ─── Main Component ──────────────────────────────────────────────────────────

/**
 * Full-width status bar rendered at the top of the app.
 *
 * Displays:
 * - Session name and circuit
 * - Lap counter (current / total)
 * - Session mode badge: LIVE · REPLAY · OFF-SEASON
 * - Track status badge (Safety Car, VSC, Red Flag, Clear)
 * - Most recent race control message text
 *
 * Internally calls `useRaceControl` — no fetch/setInterval here.
 * All props are typed via `StatusBarProps` from `src/types/f1.ts`.
 */
/**
 * Format a lap_duration in seconds → "1:32.770".
 * Shared with Leaderboard's identical helper but kept local to avoid a
 * cross-component import for one helper.
 */
function formatLapTime(seconds: number): string {
  const totalMs = Math.round(seconds * 1000);
  const mins = Math.floor(totalMs / 60000);
  const secs = (totalMs % 60000) / 1000;
  return `${mins}:${secs.toFixed(3).padStart(6, "0")}`;
}

/** Compose the icon + label for the weather pill from a Weather sample. */
function weatherIcon(w: Weather): string {
  // OpenF1 `rainfall` is binary (0 dry / 1 raining); use it as the primary signal.
  if (w.rainfall != null && w.rainfall > 0) return "🌧";
  if (w.humidity != null && w.humidity >= 80) return "☁";
  return "☀";
}

export default function StatusBar({
  session,
  currentLap,
  totalLaps,
  isLive,
  messages,
  sessions,
  onSessionChange,
  fastestLap,
  weather,
}: StatusBarProps) {
  // Most recent message (messages are appended chronologically by App)
  const latestMessage: RaceControl | null =
    messages.length > 0 ? (messages[messages.length - 1] ?? null) : null;

  const status = deriveTrackStatus(latestMessage);
  const colors = STATUS_COLORS[status];

  // ── Session mode ────────────────────────────────────────────────────────
  const sessionMode: "LIVE" | "REPLAY" | "OFF-SEASON" =
    session === null ? "OFF-SEASON" : isLive ? "LIVE" : "REPLAY";

  // ── Derived display strings ─────────────────────────────────────────────
  const sessionTitle = session
    ? `${session.session_name} — ${session.circuit_short_name}, ${session.country_name}`
    : "No Active Session";

  const lapText =
    currentLap != null
      ? `LAP ${currentLap} / ${totalLaps ?? "—"}`
      : totalLaps != null
        ? `— / ${totalLaps}`
        : null;

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <div
      style={{
        ...styles.bar,
        backgroundColor: colors.barBg,
        borderLeftColor: colors.accent,
      }}
      role="banner"
      aria-label="Session status bar"
    >
      {/* Left accent strip — colour-coded to track status */}
      <div
        style={{ ...styles.accentStrip, backgroundColor: colors.accent }}
        aria-hidden="true"
      />

      {/* ── Session info ──────────────────────────────────────────────────── */}
      <div style={styles.sessionBlock}>
        {sessions && sessions.length > 0 && onSessionChange ? (
          <SessionPicker
            sessions={sessions}
            selectedKey={session?.session_key ?? null}
            onSelect={onSessionChange}
          />
        ) : (
          <span style={styles.sessionTitle} aria-label="Session name">
            {sessionTitle}
          </span>
        )}
        {lapText && (
          <span style={styles.lapCounter} aria-label="Lap progress">
            {lapText}
          </span>
        )}
      </div>

      {/* ── Fastest-lap pill — sits between session info and race control.
            Mirrors the FL chip in the leaderboard but adds the lap time so
            the holder + their time are visible without scanning the timing
            tower. Hidden when no eligible lap has been set yet. */}
      {fastestLap && (
        <div
          style={styles.flPill}
          aria-label={`Session fastest lap: ${formatLapTime(fastestLap.time)} by ${fastestLap.abbreviation}`}
        >
          <span style={styles.flPillLabel}>FL</span>
          <span style={styles.flPillTime}>
            {formatLapTime(fastestLap.time)}
          </span>
          <span style={styles.flPillDriver}>{fastestLap.abbreviation}</span>
        </div>
      )}

      {/*
       * ── Race control message ─────────────────────────────────────────────
       * Fills all available horizontal space between the session block and
       * the right-side badges. When no message exists, fall back to a flex
       * spacer so the layout doesn't collapse.
       *
       * JS truncation has a generous 300-char budget — the CSS ellipsis on
       * .rcMessage is the real width clamp, snapping the rendered text to
       * whatever pixel width flex resolves to.
       */}
      {latestMessage ? (
        <div
          style={styles.rcBlock}
          aria-label="Latest race control message"
          aria-live="polite"
        >
          <span style={styles.rcLabel}>RACE CONTROL</span>
          <span style={styles.rcMessage}>
            {/*
             * CSS text-overflow: ellipsis on .rcMessage is the real visual
             * clamp — it cuts at whatever pixel width the flex-resolved
             * .rcBlock ends up. The JS truncation is now purely a
             * defensive safety net for pathological multi-paragraph
             * messages that would inflate the DOM, snapping at the last
             * word boundary inside a 300-char budget. On any normal
             * widescreen render this never fires.
             */}
            {truncateAtWordBoundary(latestMessage.message, 300)}
          </span>
        </div>
      ) : (
        <div style={styles.spacer} />
      )}

      {/* ── Weather pill — air temp + sky icon. Hidden until samples load. */}
      {weather && weather.air_temperature != null && (
        <div
          style={styles.weatherPill}
          aria-label={`Weather: ${weather.air_temperature}°C${weather.rainfall != null && weather.rainfall > 0 ? ", raining" : ""}`}
          title={`Track ${weather.track_temperature ?? "—"}°C · ${weather.humidity ?? "—"}% humidity · wind ${weather.wind_speed ?? "—"} m/s`}
        >
          <span style={styles.weatherIcon} aria-hidden="true">
            {weatherIcon(weather)}
          </span>
          <span style={styles.weatherTemp}>
            {Math.round(weather.air_temperature)}°C
          </span>
        </div>
      )}

      {/* ── Track status badge ────────────────────────────────────────────── */}
      {status !== "NEUTRAL" && (
        <div
          style={{
            ...styles.trackStatusBadge,
            backgroundColor: colors.accent,
            color: colors.text,
          }}
          aria-label={`Track status: ${statusLabel(status)}`}
        >
          {statusLabel(status)}
        </div>
      )}

      {/* ── Session mode badge ────────────────────────────────────────────── */}
      <div
        style={{
          ...styles.modeBadge,
          ...(sessionMode === "LIVE"
            ? styles.modeLive
            : sessionMode === "REPLAY"
              ? styles.modeReplay
              : styles.modeOffSeason),
        }}
        aria-label={`Session mode: ${sessionMode}`}
      >
        {sessionMode === "LIVE" && (
          <span style={styles.liveDot} aria-hidden="true" />
        )}
        {sessionMode}
      </div>
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const BASE_FONT: React.CSSProperties = {
  fontFamily: "'Roboto Mono', 'Courier New', monospace",
  letterSpacing: "0.05em",
};

const styles: Record<string, React.CSSProperties> = {
  bar: {
    ...BASE_FONT,
    display: "flex",
    alignItems: "center",
    gap: "16px",
    padding: "0 20px 0 0",
    height: "56px", // bumped 48→56 so the larger session title doesn't feel cramped
    borderLeft: "4px solid transparent",
    borderBottom: "1px solid #2A2A2A",
    transition: "background-color 0.5s ease, border-left-color 0.5s ease",
    overflow: "hidden",
    position: "relative",
  },

  // Thin left accent strip (colour-coded)
  accentStrip: {
    width: "4px",
    alignSelf: "stretch",
    flexShrink: 0,
    transition: "background-color 0.5s ease",
  },

  // ── Session block
  sessionBlock: {
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    gap: "2px",
    minWidth: 0,
    overflow: "hidden",
  },
  sessionTitle: {
    fontSize: "18px", // 13→18 so the circuit name dominates as the page's primary subject
    fontWeight: 700,
    color: "#FFFFFF",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    letterSpacing: "0.05em",
    textTransform: "uppercase",
  },
  lapCounter: {
    fontSize: "11px",
    color: "#AAAAAA",
    fontVariantNumeric: "tabular-nums",
    letterSpacing: "0.08em",
  },

  // ── Flexible gap
  spacer: {
    flex: 1,
  },

  // ── Race control message (fills available width in the bar)
  rcBlock: {
    flex: "1 1 auto",
    minWidth: 0, // critical: lets the flex item shrink below its content size so CSS ellipsis can engage
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: "1px",
    overflow: "hidden",
    padding: "0 16px",
    borderLeft: "1px solid #2A2A2A",
    borderRight: "1px solid #2A2A2A",
  },
  rcLabel: {
    fontSize: "9px",
    fontWeight: 700,
    letterSpacing: "0.14em",
    color: "#666666",
    textTransform: "uppercase",
  },
  rcMessage: {
    fontSize: "11px",
    fontWeight: 500,
    color: "#DDDDDD",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    maxWidth: "100%",
    letterSpacing: "0.04em",
  },

  // ── Fastest-lap pill — small purple capsule with "FL · 1:32.770 · NOR"
  flPill: {
    display: "inline-flex",
    alignItems: "center",
    gap: "8px",
    padding: "4px 10px",
    border: "1px solid rgba(177, 75, 255, 0.55)",
    backgroundColor: "rgba(177, 75, 255, 0.10)",
    flexShrink: 0,
    whiteSpace: "nowrap",
  },
  flPillLabel: {
    fontSize: "9px",
    fontWeight: 800,
    letterSpacing: "0.16em",
    color: "#B14BFF",
    textTransform: "uppercase" as const,
  },
  flPillTime: {
    fontFamily: "'Roboto Mono', 'Courier New', monospace",
    fontSize: "12px",
    fontWeight: 700,
    color: "#EEEEEE",
    fontVariantNumeric: "tabular-nums",
    letterSpacing: "0.02em",
  },
  flPillDriver: {
    fontSize: "11px",
    fontWeight: 700,
    color: "#AAAAAA",
    letterSpacing: "0.1em",
  },

  // ── Weather pill — small capsule with sky icon + air temperature
  weatherPill: {
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
    padding: "4px 10px",
    border: "1px solid #2A2A2A",
    backgroundColor: "rgba(255,255,255,0.03)",
    flexShrink: 0,
    whiteSpace: "nowrap",
  },
  weatherIcon: {
    fontSize: "13px",
    lineHeight: 1,
  },
  weatherTemp: {
    fontFamily: "'Roboto Mono', 'Courier New', monospace",
    fontSize: "12px",
    fontWeight: 700,
    color: "#DDDDDD",
    fontVariantNumeric: "tabular-nums",
    letterSpacing: "0.04em",
  },

  // ── Track status badge (SC / VSC / RED FLAG / TRACK CLEAR)
  trackStatusBadge: {
    fontSize: "11px",
    fontWeight: 900,
    letterSpacing: "0.1em",
    padding: "4px 10px",
    borderRadius: "4px",
    whiteSpace: "nowrap",
    textTransform: "uppercase",
    flexShrink: 0,
    transition: "background-color 0.5s ease, color 0.5s ease",
  },

  // ── Session mode badge
  modeBadge: {
    ...BASE_FONT,
    display: "flex",
    alignItems: "center",
    gap: "6px",
    fontSize: "11px",
    fontWeight: 900,
    letterSpacing: "0.12em",
    padding: "4px 10px",
    borderRadius: "4px",
    whiteSpace: "nowrap",
    textTransform: "uppercase",
    flexShrink: 0,
  },
  modeLive: {
    backgroundColor: "#E8002D",
    color: "#FFFFFF",
  },
  modeReplay: {
    backgroundColor: "#FFF200",
    color: "#111111",
  },
  modeOffSeason: {
    backgroundColor: "#333333",
    color: "#888888",
  },

  // Animated pulse dot inside LIVE badge
  liveDot: {
    display: "inline-block",
    width: "6px",
    height: "6px",
    borderRadius: "50%",
    backgroundColor: "#FFFFFF",
    animation: "pulse 1.4s ease-in-out infinite",
    flexShrink: 0,
  },
};
