import { useMemo } from "react";
import { useCircuit } from "../hooks/useCircuit";
import { normalizeCoords, computeBoundsFromArrays } from "../utils/coordinates";
import { getTeamColor } from "../utils/teamColors";
import { DriverDot } from "./DriverDot";
import type { TrackMapProps } from "../types/f1";

// ─── SVG viewport constants ───────────────────────────────────────────────────

const SVG_WIDTH = 800;
const SVG_HEIGHT = 500;

/** Padding (px) around the inner drawing area so dots never clip the edge. */
const PADDING = 32;

const INNER_WIDTH = SVG_WIDTH - PADDING * 2;
const INNER_HEIGHT = SVG_HEIGHT - PADDING * 2;

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
        @keyframes f1-pulse {
          0%, 100% { opacity: 0.25; }
          50%       { opacity: 0.55; }
        }
        .f1-skel { animation: f1-pulse 1.6s ease-in-out infinite; }
      `}</style>

      {/* Background */}
      <rect
        x={0}
        y={0}
        width={SVG_WIDTH}
        height={SVG_HEIGHT}
        fill="#0f1117"
        rx={10}
      />

      {/* Outer oval — suggests a circuit ribbon */}
      <rect
        className="f1-skel"
        x={PADDING}
        y={PADDING}
        width={INNER_WIDTH}
        height={INNER_HEIGHT}
        rx={INNER_HEIGHT / 2}
        fill="none"
        stroke="#374151"
        strokeWidth={20}
      />

      {/* Inner cutout to make it look like a track ribbon */}
      <rect
        x={PADDING + 50}
        y={PADDING + 50}
        width={INNER_WIDTH - 100}
        height={INNER_HEIGHT - 100}
        rx={(INNER_HEIGHT - 100) / 2}
        fill="#0f1117"
      />

      {/* Label */}
      <text
        x={SVG_WIDTH / 2}
        y={SVG_HEIGHT / 2}
        textAnchor="middle"
        dominantBaseline="middle"
        fill="#6b7280"
        fontSize={13}
        fontFamily="monospace"
        letterSpacing={2}
      >
        LOADING CIRCUIT…
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
      <rect
        x={0}
        y={0}
        width={SVG_WIDTH}
        height={SVG_HEIGHT}
        fill="#0f1117"
        rx={10}
      />
      <text
        x={SVG_WIDTH / 2}
        y={SVG_HEIGHT / 2 - 12}
        textAnchor="middle"
        dominantBaseline="middle"
        fill="#ef4444"
        fontSize={13}
        fontFamily="monospace"
        letterSpacing={1}
      >
        CIRCUIT UNAVAILABLE
      </text>
      <text
        x={SVG_WIDTH / 2}
        y={SVG_HEIGHT / 2 + 12}
        textAnchor="middle"
        dominantBaseline="middle"
        fill="#6b7280"
        fontSize={10}
        fontFamily="monospace"
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
 */
export default function TrackMap({
  circuitKey,
  year,
  drivers,
  locations,
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

    // Prefer the API-provided team_colour; fall back to our palette.
    const color = driver.team_colour
      ? `#${driver.team_colour}`
      : getTeamColor(driver.team_name);

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

  // ── SVG output ─────────────────────────────────────────────────────────────

  return (
    <svg
      width="100%"
      viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`}
      style={{ display: "block", background: "#0f1117", borderRadius: 10 }}
      aria-label="F1 circuit map with live driver positions"
    >
      {/* All drawing offset by PADDING so dots have breathing room at edges */}
      <g transform={`translate(${PADDING}, ${PADDING})`}>
        {/* Circuit outline */}
        <path
          d={pathPoints}
          fill="none"
          stroke="#374151"
          strokeWidth={10}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* Thinner inner highlight gives the track a ribbon feel */}
        <path
          d={pathPoints}
          fill="none"
          stroke="#4b5563"
          strokeWidth={4}
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Driver dots — rendered on top of the circuit path */}
        {dots}
      </g>
    </svg>
  );
}
