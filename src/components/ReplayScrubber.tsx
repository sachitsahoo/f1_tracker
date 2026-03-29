import React, { useId } from "react";
import type { ReplayScrubberProps } from "../types/f1";

/**
 * Fixed bottom bar that lets users scrub through a replay session lap-by-lap.
 *
 * Renders:
 * - A full-width range slider (lap 1 → totalLaps)
 * - A lap counter label above the slider ("LAP 32 / 57")
 * - Colour-coded event markers on the rail (SC = yellow, Red Flag = red)
 * - A "JUMP TO END" button on the right edge
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

  // ── Event markers ────────────────────────────────────────────────────────
  // Filter to track-wide events with a known lap number, deduplicate by lap.
  const markers = React.useMemo(() => {
    const seen = new Set<string>();
    const result: { lap: number; color: string; title: string }[] = [];

    for (const evt of events) {
      if (evt.lap_number == null) continue;
      // Only track-level flags; skip per-driver messages
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
        continue; // not a landmark event
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
            #E8002D ${((replayLap - 1) / Math.max(totalLaps - 1, 1)) * 100}%,
            #333333 ${((replayLap - 1) / Math.max(totalLaps - 1, 1)) * 100}%,
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
        {/* ── Left: lap counter ──────────────────────────────────────────── */}
        <span style={styles.lapLabel} aria-live="polite" aria-atomic="true">
          LAP <span style={styles.lapCurrent}>{replayLap}</span>
          <span style={styles.lapSep}> / </span>
          <span style={styles.lapTotal}>{totalLaps}</span>
        </span>

        {/* ── Centre: slider + markers ───────────────────────────────────── */}
        <div style={styles.sliderWrap}>
          {/* Event markers overlaid above the track */}
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

        {/* ── Right: jump-to-end button ──────────────────────────────────── */}
        <button
          style={{
            ...styles.endBtn,
            ...(atEnd ? styles.endBtnDisabled : {}),
          }}
          onClick={() => onChange(totalLaps)}
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
    gap: "16px",
    padding: "10px 20px 12px",
    backgroundColor: "#141414",
    borderTop: "1px solid #2A2A2A",
    boxSizing: "border-box",
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
    paddingTop: "12px", // room for marker dots above the rail
  },

  // Clickable event marker dot positioned above the rail
  marker: {
    position: "absolute",
    top: 0,
    width: "8px",
    height: "8px",
    borderRadius: "50%",
    transform: "translateX(-4px)", // centre on the lap position
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
