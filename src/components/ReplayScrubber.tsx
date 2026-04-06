import React, { useId, useState, useEffect, useRef } from "react";
import type { ReplayScrubberProps } from "../types/f1";

// ─── Playback speed ───────────────────────────────────────────────────────────
// Time in milliseconds between each automatic lap advance during playback.
// Lower = faster. Typical values: 600 (fast), 1200 (normal), 2500 (slow).
export const REPLAY_LAP_INTERVAL_MS = 1200;

/**
 * Fixed bottom bar that lets users scrub through a replay session lap-by-lap.
 *
 * Renders:
 * - A play/pause button (▶ / ❚❚)
 * - A lap counter label ("LAP 32 / 57")
 * - A full-width range slider (lap 1 → totalLaps) with event markers
 * - A "END →" button on the right edge
 *
 * Playback behaviour:
 * - Play from current lap; auto-pauses after the last lap.
 * - If already at the last lap when play is pressed, restarts from lap 1.
 * - Dragging the slider while playing does NOT pause — playback continues
 *   from wherever the thumb is dropped.
 * - Speed is controlled by REPLAY_LAP_INTERVAL_MS above.
 *
 * Only rendered by App when !isLive && totalLaps != null.
 */
export default function ReplayScrubber({
  totalLaps,
  replayLap,
  onChange,
  events,
}: ReplayScrubberProps) {
  const sliderId = useId();
  const [isPlaying, setIsPlaying] = useState(false);

  // Ref holds the pending timeout ID so we can cancel it synchronously in the
  // click handler — before React's effect cleanup runs (which is post-paint).
  const pendingRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function cancelPending(): void {
    if (pendingRef.current !== null) {
      clearTimeout(pendingRef.current);
      pendingRef.current = null;
    }
  }

  // ── Auto-advance ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isPlaying) return;

    if (replayLap >= totalLaps) {
      setIsPlaying(false);
      return;
    }

    pendingRef.current = setTimeout(() => {
      pendingRef.current = null;
      onChange(replayLap + 1);
    }, REPLAY_LAP_INTERVAL_MS);

    return cancelPending;
  }, [isPlaying, replayLap, totalLaps, onChange]);

  // ── Play / pause handler ──────────────────────────────────────────────────
  function handlePlayPause(): void {
    if (isPlaying) {
      cancelPending(); // synchronous — fires before any re-render
      setIsPlaying(false);
    } else {
      if (replayLap >= totalLaps) onChange(1);
      setIsPlaying(true);
    }
  }

  // ── Event markers ────────────────────────────────────────────────────────
  const markers = React.useMemo(() => {
    const seen = new Set<string>();
    const result: { lap: number; color: string; title: string }[] = [];

    for (const evt of events) {
      if (evt.lap_number == null) continue;
      if (evt.scope !== "Track" && evt.scope !== null) continue;

      const flag = (evt.flag ?? "").toUpperCase();
      const msg = (evt.message ?? "").toUpperCase();

      let color: string;
      let title: string;

      if (flag === "SAFETY CAR" || msg.includes("SAFETY CAR")) {
        color = "#FFF200";
        title = "Safety Car";
      } else if (
        flag === "VIRTUAL SAFETY CAR" ||
        msg.includes("VIRTUAL SAFETY CAR")
      ) {
        color = "#FFF200";
        title = "Virtual Safety Car";
      } else if (flag === "RED" || msg.includes("RED FLAG")) {
        color = "#E8002D";
        title = "Red Flag";
      } else {
        continue;
      }

      const key = `${evt.lap_number}-${color}`;
      if (!seen.has(key)) {
        seen.add(key);
        result.push({ lap: evt.lap_number, color, title });
      }
    }

    return result;
  }, [events]);

  const atEnd = replayLap >= totalLaps;
  const pct = ((replayLap - 1) / Math.max(totalLaps - 1, 1)) * 100;

  return (
    <>
      {/* Scoped CSS for range input pseudo-elements */}
      <style>{`
        .f1-scrubber__range {
          -webkit-appearance: none;
          appearance: none;
          width: 100%;
          height: 4px;
          border-radius: 2px;
          background: linear-gradient(
            to right,
            #E8002D 0%,
            #E8002D ${pct}%,
            #333333 ${pct}%,
            #333333 100%
          );
          outline: none;
          cursor: pointer;
        }
        .f1-scrubber__range::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 16px;
          height: 16px;
          border-radius: 50%;
          background: #FFFFFF;
          border: 2px solid #555555;
          cursor: pointer;
          transition: transform 0.1s ease, border-color 0.1s ease;
        }
        .f1-scrubber__range::-webkit-slider-thumb:hover {
          transform: scale(1.25);
          border-color: #E8002D;
        }
        .f1-scrubber__range::-moz-range-thumb {
          width: 14px;
          height: 14px;
          border-radius: 50%;
          background: #FFFFFF;
          border: 2px solid #555555;
          cursor: pointer;
        }
        .f1-scrubber__range:focus-visible::-webkit-slider-thumb {
          outline: 2px solid #E8002D;
          outline-offset: 2px;
        }
      `}</style>

      <div style={styles.bar} role="region" aria-label="Replay scrubber">
        {/* ── Play / pause button ────────────────────────────────────────── */}
        <button
          style={styles.playBtn}
          onClick={handlePlayPause}
          title={isPlaying ? "Pause" : atEnd ? "Restart from lap 1" : "Play"}
          aria-label={isPlaying ? "Pause replay" : "Play replay"}
        >
          {isPlaying ? "❚❚" : "▶"}
        </button>

        {/* ── Lap counter ────────────────────────────────────────────────── */}
        <span style={styles.lapLabel} aria-live="polite" aria-atomic="true">
          LAP <span style={styles.lapCurrent}>{replayLap}</span>
          <span style={styles.lapSep}> / </span>
          <span style={styles.lapTotal}>{totalLaps}</span>
        </span>

        {/* ── Slider + markers ───────────────────────────────────────────── */}
        <div style={styles.sliderWrap}>
          {markers.map((m) => (
            <button
              key={`${m.lap}-${m.color}`}
              title={`Lap ${m.lap}: ${m.title}`}
              aria-label={`Jump to lap ${m.lap}: ${m.title}`}
              onClick={() => onChange(m.lap)}
              style={{
                ...styles.marker,
                left: `calc(${((m.lap - 1) / Math.max(totalLaps - 1, 1)) * 100}% + 0px)`,
                backgroundColor: m.color,
              }}
            />
          ))}

          <input
            id={sliderId}
            type="range"
            className="f1-scrubber__range"
            min={1}
            max={totalLaps}
            step={1}
            value={replayLap}
            onChange={(e) => onChange(Number(e.target.value))}
            aria-label={`Replay lap: ${replayLap} of ${totalLaps}`}
            aria-valuemin={1}
            aria-valuemax={totalLaps}
            aria-valuenow={replayLap}
            aria-valuetext={`Lap ${replayLap} of ${totalLaps}`}
          />
        </div>

        {/* ── Jump to end ────────────────────────────────────────────────── */}
        <button
          style={{
            ...styles.endBtn,
            ...(atEnd ? styles.endBtnDisabled : {}),
          }}
          onClick={() => {
            setIsPlaying(false);
            onChange(totalLaps);
          }}
          disabled={atEnd}
          title="Jump to end of race"
          aria-label="Jump to end of race"
        >
          END →
        </button>
      </div>
    </>
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
    position: "fixed",
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 100,
    display: "flex",
    alignItems: "center",
    gap: "12px",
    padding: "10px 20px 12px",
    backgroundColor: "#141414",
    borderTop: "1px solid #2A2A2A",
    boxSizing: "border-box",
  },

  playBtn: {
    ...BASE_FONT,
    flexShrink: 0,
    width: "32px",
    height: "32px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "12px",
    fontWeight: 700,
    backgroundColor: "#E8002D",
    color: "#FFFFFF",
    border: "none",
    borderRadius: "50%",
    cursor: "pointer",
    transition: "background-color 0.15s ease, transform 0.1s ease",
    letterSpacing: 0,
    lineHeight: 1,
  },

  lapLabel: {
    fontSize: "11px",
    fontWeight: 700,
    color: "#AAAAAA",
    letterSpacing: "0.1em",
    whiteSpace: "nowrap",
    flexShrink: 0,
    minWidth: "92px",
  },

  lapCurrent: {
    color: "#FFFFFF",
    fontSize: "13px",
  },

  lapSep: {
    color: "#555555",
  },

  lapTotal: {
    color: "#666666",
  },

  sliderWrap: {
    flex: 1,
    position: "relative",
    display: "flex",
    alignItems: "center",
    paddingTop: "12px",
  },

  marker: {
    position: "absolute",
    top: 0,
    width: "8px",
    height: "8px",
    borderRadius: "50%",
    transform: "translateX(-4px)",
    cursor: "pointer",
    border: "none",
    padding: 0,
    zIndex: 1,
    opacity: 0.9,
  },

  endBtn: {
    ...BASE_FONT,
    flexShrink: 0,
    fontSize: "10px",
    fontWeight: 700,
    letterSpacing: "0.12em",
    padding: "5px 10px",
    backgroundColor: "#222222",
    color: "#AAAAAA",
    border: "1px solid #333333",
    borderRadius: "4px",
    cursor: "pointer",
    transition: "background-color 0.15s ease, color 0.15s ease",
  },

  endBtnDisabled: {
    opacity: 0.3,
    cursor: "default",
  },
};
