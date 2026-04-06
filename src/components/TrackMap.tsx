import { useMemo } from "react";
import { useCircuit } from "../hooks/useCircuit";
import { normalizeCoords, computeBoundsFromArrays } from "../utils/coordinates";
import { driverTeamColor } from "../utils/teamColors";
import { DriverDot } from "./DriverDot";
import type { TrackMapProps } from "../types/f1";

// ─── SVG viewport constants ───────────────────────────────────────────────────

const SVG_WIDTH = 800;
const SVG_HEIGHT = 500;

/** Padding (px) around the inner drawing area so dots never clip the edge. */
const PADDING = 40;

const INNER_WIDTH = SVG_WIDTH - PADDING * 2;
const INNER_HEIGHT = SVG_HEIGHT - PADDING * 2;

// ─── Shared SVG keyframes ─────────────────────────────────────────────────────
// Injected once into the root <svg> so DriverDot children can reference them.

const SVG_KEYFRAMES = `
  @keyframes f1-dot-pulse {
    0%   { opacity: 0.30; r: 13; }
    60%  { opacity: 0;    r: 20; }
    100% { opacity: 0;    r: 20; }
  }
  @keyframes f1-live-blink {
    0%, 49%  { opacity: 1; }
    50%, 100% { opacity: 0; }
  }
  @keyframes f1-skel-pulse {
    0%, 100% { opacity: 0.20; }
    50%      { opacity: 0.45; }
  }
`;

// ─── Loading skeleton ─────────────────────────────────────────────────────────

function TrackSkeleton() {
  return (
    <svg
      width="100%"
      viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`}
      aria-label="Loading circuit…"
      role="img"
      style={{ display: "block" }}
    >
      <style>{`
        ${SVG_KEYFRAMES}
        .f1-skel { animation: f1-skel-pulse 1.6s ease-in-out infinite; }
      `}</style>

      {/* Deep black background — no border-radius, broadcast aesthetic */}
      <rect x={0} y={0} width={SVG_WIDTH} height={SVG_HEIGHT} fill="#0A0A0A" />

      {/* Placeholder circuit ribbon */}
      <rect
        className="f1-skel"
        x={PADDING}
        y={PADDING}
        width={INNER_WIDTH}
        height={INNER_HEIGHT}
        rx={INNER_HEIGHT / 2}
        fill="none"
        stroke="#2A2A2A"
        strokeWidth={18}
      />
      <rect
        x={PADDING + 50}
        y={PADDING + 50}
        width={INNER_WIDTH - 100}
        height={INNER_HEIGHT - 100}
        rx={(INNER_HEIGHT - 100) / 2}
        fill="#0A0A0A"
      />

      <text
        x={SVG_WIDTH / 2}
        y={SVG_HEIGHT / 2}
        textAnchor="middle"
        dominantBaseline="middle"
        fill="#444444"
        fontSize={11}
        fontFamily="'JetBrains Mono', 'Roboto Mono', monospace"
        letterSpacing={3}
      >
        LOADING CIRCUIT
      </text>
    </svg>
  );
}

// ─── Error state ──────────────────────────────────────────────────────────────

function TrackError({ message }: { message: string }) {
  return (
    <svg
      width="100%"
      viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`}
      role="alert"
      style={{ display: "block" }}
    >
      <rect x={0} y={0} width={SVG_WIDTH} height={SVG_HEIGHT} fill="#0A0A0A" />
      <text
        x={SVG_WIDTH / 2}
        y={SVG_HEIGHT / 2 - 14}
        textAnchor="middle"
        dominantBaseline="middle"
        fill="#E8002D"
        fontSize={11}
        fontFamily="'JetBrains Mono', 'Roboto Mono', monospace"
        letterSpacing={2}
      >
        CIRCUIT UNAVAILABLE
      </text>
      <text
        x={SVG_WIDTH / 2}
        y={SVG_HEIGHT / 2 + 14}
        textAnchor="middle"
        dominantBaseline="middle"
        fill="#555555"
        fontSize={9}
        fontFamily="'JetBrains Mono', 'Roboto Mono', monospace"
        letterSpacing={1}
      >
        {message}
      </text>
    </svg>
  );
}

// ─── TrackMap ─────────────────────────────────────────────────────────────────

/**
 * Renders the SVG circuit outline fetched from MultiViewer, then overlays an
 * animated DriverDot for every driver whose telemetry location is available.
 *
 * All coordinate normalisation happens here — consumers pass raw values from
 * useLocations(); this component is the single point that calls normalizeCoords().
 *
 * The circuit bounds (min/max X/Y from the MultiViewer path) are computed once
 * on circuit load and reused for every driver dot — this keeps all geometries
 * in the same coordinate space (see lessons.md).
 *
 * Circuit Y coordinates from MultiViewer use a Y-up convention (standard math).
 * SVG uses Y-down. The normalisation below flips Y by swapping minY/maxY so
 * the circuit renders with the correct orientation. Driver telemetry from
 * OpenF1 shares the same coordinate space, so the same flip is applied there.
 *
 * Design: F1 Broadcast / Timing Tower aesthetic.
 * - #0A0A0A base, #333 circuit stroke, dark radial vignette overlay
 * - LIVE badge (blinking red dot) or REPLAY badge (amber) top-right
 * - Driver dot keyframes injected via inline <style>
 */
export default function TrackMap({
  circuitKey,
  year,
  drivers,
  locations,
  isLive,
}: TrackMapProps) {
  const { circuit, loading, error } = useCircuit(circuitKey, year);

  // Build a driver lookup map — O(1) access per dot render.
  const driverMap = useMemo(
    () => new Map(drivers.map((d) => [d.driver_number, d])),
    [drivers],
  );

  // Derived values that depend on circuit data being loaded.
  const derived = useMemo(() => {
    if (!circuit || circuit.x.length === 0) return null;

    // Step 1 — compute bounds once from the circuit path arrays.
    const bounds = computeBoundsFromArrays(circuit.x, circuit.y);

    // Step 2 — build the normalised SVG path string.
    // Y is flipped (minY ↔ maxY) so the circuit renders the right way up in SVG.
    const pathPoints =
      circuit.x
        .map((rawX, i) => {
          const { svgX, svgY } = normalizeCoords(
            rawX,
            circuit.y[i],
            bounds.minX,
            bounds.maxX,
            bounds.maxY, // swapped — flip Y axis
            bounds.minY, // swapped — flip Y axis
            INNER_WIDTH,
            INNER_HEIGHT,
          );
          return `${i === 0 ? "M" : "L"} ${svgX.toFixed(2)} ${svgY.toFixed(2)}`;
        })
        .join(" ") + " Z";

    return { bounds, pathPoints };
  }, [circuit]);

  // ── Render states ──────────────────────────────────────────────────────────

  if (loading) return <TrackSkeleton />;

  if (error) {
    return (
      <TrackError
        message={
          error.isRateLimit
            ? "Rate limit hit — retrying…"
            : `HTTP ${error.status}: ${error.message}`
        }
      />
    );
  }

  if (!derived) {
    return <TrackError message="No circuit path data returned." />;
  }

  const { bounds, pathPoints } = derived;

  // ── Driver dots ────────────────────────────────────────────────────────────

  const dots = Object.values(locations).flatMap((loc) => {
    const driver = driverMap.get(loc.driver_number);
    if (!driver) return []; // driver not in roster — skip

    // Normalise telemetry using the same bounds and Y-flip as the circuit path.
    const { svgX, svgY } = normalizeCoords(
      loc.x,
      loc.y,
      bounds.minX,
      bounds.maxX,
      bounds.maxY, // swapped — flip Y axis (matches circuit path)
      bounds.minY, // swapped — flip Y axis
      INNER_WIDTH,
      INNER_HEIGHT,
    );

    const color = driverTeamColor(driver);

    return [
      <DriverDot
        key={driver.driver_number}
        driverNumber={driver.driver_number}
        svgX={svgX}
        svgY={svgY}
        color={color}
        abbreviation={driver.name_acronym}
      />,
    ];
  });

  // ── Badge geometry ─────────────────────────────────────────────────────────
  // Positioned in root SVG coordinates (not inside the PADDING-translated <g>)

  const BADGE_X = SVG_WIDTH - 12;
  const BADGE_Y = 14;

  // ── SVG output ─────────────────────────────────────────────────────────────

  return (
    <svg
      width="100%"
      viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`}
      style={{ display: "block", background: "#0A0A0A" }}
      aria-label="F1 circuit map with live driver positions"
    >
      {/* Keyframes for DriverDot pulse + LIVE blink */}
      <style>{SVG_KEYFRAMES}</style>

      {/* SVG defs: vignette gradient */}
      <defs>
        <radialGradient id="f1-vignette" cx="50%" cy="50%" r="50%">
          <stop offset="65%" stopColor="transparent" />
          <stop offset="100%" stopColor="#0A0A0A" stopOpacity="0.38" />
        </radialGradient>
      </defs>

      {/* All drawing offset by PADDING so dots have breathing room at edges */}
      <g transform={`translate(${PADDING}, ${PADDING})`}>
        {/* Circuit outline — broadcast dark track */}
        <path
          d={pathPoints}
          fill="none"
          stroke="#2A2A2A"
          strokeWidth={14}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* Center line — subtle brightening */}
        <path
          d={pathPoints}
          fill="none"
          stroke="#333333"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Driver dots — rendered on top of the circuit path */}
        {dots}
      </g>

      {/* Dark radial vignette — frames the circuit */}
      <rect
        x={0}
        y={0}
        width={SVG_WIDTH}
        height={SVG_HEIGHT}
        fill="url(#f1-vignette)"
        style={{ pointerEvents: "none" }}
      />

      {/* ── Session badge — top-right corner ─────────────────────────────── */}
      {isLive ? (
        /* LIVE badge: blinking red dot + white text */
        <g aria-label="Live session">
          {/* Badge background pill */}
          <rect
            x={BADGE_X - 56}
            y={BADGE_Y - 10}
            width={56}
            height={20}
            fill="#1A0000"
            stroke="#E8002D"
            strokeWidth={0.75}
          />
          {/* Blinking dot */}
          <circle
            cx={BADGE_X - 46}
            cy={BADGE_Y}
            r={3.5}
            fill="#E8002D"
            style={{ animation: "f1-live-blink 1.1s step-end infinite" }}
          />
          {/* LIVE label */}
          <text
            x={BADGE_X - 36}
            y={BADGE_Y}
            dominantBaseline="central"
            fontSize={9}
            fontFamily="'Inter', 'Roboto', sans-serif"
            fontWeight="700"
            fill="#FFFFFF"
            letterSpacing={1.5}
          >
            LIVE
          </text>
        </g>
      ) : (
        /* REPLAY badge: amber, no blink */
        <g aria-label="Replay session">
          <rect
            x={BADGE_X - 68}
            y={BADGE_Y - 10}
            width={68}
            height={20}
            fill="#1A1200"
            stroke="#D97706"
            strokeWidth={0.75}
          />
          <text
            x={BADGE_X - 34}
            y={BADGE_Y}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={9}
            fontFamily="'Inter', 'Roboto', sans-serif"
            fontWeight="700"
            fill="#D97706"
            letterSpacing={1.5}
          >
            REPLAY
          </text>
        </g>
      )}
    </svg>
  );
}
