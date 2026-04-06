import { useMemo, useEffect, useRef, useState } from "react";
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

/** Duration of the replay lap-change path animation in milliseconds. */
const REPLAY_ANIM_MS = 600;

// ─── Shared SVG keyframes ─────────────────────────────────────────────────────

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

// ─── Animation helpers ────────────────────────────────────────────────────────

interface NormPos {
  svgX: number;
  svgY: number;
  /** Index into the normalised circuit path array for this position. */
  pathIdx: number;
}

interface AnimState {
  from: Record<number, NormPos>;
  to: Record<number, NormPos>;
  startTime: number;
  duration: number;
}

/** Smooth ease-in-out curve: t ∈ [0,1] → [0,1]. */
function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
}

/** O(n) nearest-index scan on the normalised path. Fast enough for ≤800 pts × 20 drivers at 60 fps. */
function findNearestIdx(
  path: ReadonlyArray<{ svgX: number; svgY: number }>,
  svgX: number,
  svgY: number,
): number {
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < path.length; i++) {
    const d = (path[i].svgX - svgX) ** 2 + (path[i].svgY - svgY) ** 2;
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

/**
 * Interpolates a position along the circuit path between `fromIdx` and `toIdx`
 * at progress `t ∈ [0,1]`.
 *
 * Chooses the shorter arc (CW vs CCW) using modular arithmetic, which correctly
 * handles the wrap-around case where a driver crosses the start/finish line.
 */
function interpolateAlongPath(
  path: ReadonlyArray<{ svgX: number; svgY: number }>,
  fromIdx: number,
  toIdx: number,
  t: number,
): { svgX: number; svgY: number } {
  const n = path.length;
  if (n === 0) return { svgX: 0, svgY: 0 };

  const fwd = (toIdx - fromIdx + n) % n;
  const bwd = (fromIdx - toIdx + n) % n;

  if (fwd === 0 && bwd === 0) return path[fromIdx];

  const dir = fwd <= bwd ? 1 : -1;
  const steps = Math.min(fwd, bwd);

  const targetStep = t * steps;
  const stepFloor = Math.floor(targetStep);
  const frac = targetStep - stepFloor;

  const idxA = (((fromIdx + dir * stepFloor) % n) + n) % n;
  const idxB = (((fromIdx + dir * (stepFloor + 1)) % n) + n) % n;

  return {
    svgX: path[idxA].svgX * (1 - frac) + path[idxB].svgX * frac,
    svgY: path[idxA].svgY * (1 - frac) + path[idxB].svgY * frac,
  };
}

// ─── FinishLine ───────────────────────────────────────────────────────────────

/**
 * Checkered start/finish line drawn at path index 0, perpendicular to the
 * circuit direction (path[0] → path[1]).
 */
function FinishLine({
  path,
}: {
  path: ReadonlyArray<{ svgX: number; svgY: number }>;
}) {
  if (path.length < 2) return null;

  const p0 = path[0];
  const p1 = path[1];
  const dx = p1.svgX - p0.svgX;
  const dy = p1.svgY - p0.svgY;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len === 0) return null;

  // Angle of the track at path[0] — the finish rect is rotated to match,
  // so its long axis (height) spans perpendicular to the track direction.
  const angleDeg = Math.atan2(dy, dx) * (180 / Math.PI);

  return (
    <g aria-label="Start/finish line">
      {/* Checkered flag rect — 5 px along track, 20 px across */}
      <rect
        x={-2.5}
        y={-10}
        width={5}
        height={20}
        fill="url(#f1-finish-checker)"
        transform={`translate(${p0.svgX.toFixed(2)},${p0.svgY.toFixed(2)}) rotate(${angleDeg.toFixed(1)})`}
      />
      {/* SF label offset to the outside of the first path point */}
      <text
        x={p0.svgX + (-dy / len) * 16}
        y={p0.svgY + (dx / len) * 16}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={7}
        fontFamily="'JetBrains Mono', 'Roboto Mono', monospace"
        fontWeight="700"
        fill="#666666"
        style={{ userSelect: "none" }}
      >
        SF
      </text>
    </g>
  );
}

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
      <rect x={0} y={0} width={SVG_WIDTH} height={SVG_HEIGHT} fill="#0A0A0A" />
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
 * **Live mode** (`isLive=true`):
 *   Positions are updated directly from the `locations` prop on each poll.
 *   `DriverDot` applies a CSS `transition: 0.8 s ease` to interpolate smoothly
 *   between 1 s polling updates. Behaviour unchanged from before.
 *
 * **Replay mode** (`isLive=false`):
 *   When `locations` changes (lap scrubber moved), each car is animated from its
 *   previous SVG position to the new one *along the circuit path* via
 *   `requestAnimationFrame` over `REPLAY_ANIM_MS` ms. The CSS transition is
 *   disabled (`transitionMs=0`) so it doesn't fight the rAF loop.
 *
 * A checkered start/finish line is drawn at `normalizedPath[0]`, perpendicular
 * to the circuit direction.
 */
export default function TrackMap({
  circuitKey,
  year,
  drivers,
  locations,
  isLive,
}: TrackMapProps) {
  const { circuit, loading, error } = useCircuit(circuitKey, year);

  // O(1) driver lookup
  const driverMap = useMemo(
    () => new Map(drivers.map((d) => [d.driver_number, d])),
    [drivers],
  );

  // ── Derived circuit geometry ───────────────────────────────────────────────
  // Extended to also expose the normalised path array so the animation effect
  // can snap drivers to their nearest path index.

  const derived = useMemo(() => {
    if (!circuit || circuit.x.length === 0) return null;

    const bounds = computeBoundsFromArrays(circuit.x, circuit.y);
    const normalizedPath: Array<{ svgX: number; svgY: number }> = [];
    const parts: string[] = [];

    for (let i = 0; i < circuit.x.length; i++) {
      const { svgX, svgY } = normalizeCoords(
        circuit.x[i],
        circuit.y[i],
        bounds.minX,
        bounds.maxX,
        bounds.maxY, // swapped — flip Y axis so circuit renders right-side-up
        bounds.minY, // swapped
        INNER_WIDTH,
        INNER_HEIGHT,
      );
      normalizedPath.push({ svgX, svgY });
      parts.push(
        `${i === 0 ? "M" : "L"} ${svgX.toFixed(2)} ${svgY.toFixed(2)}`,
      );
    }

    return { bounds, pathPoints: parts.join(" ") + " Z", normalizedPath };
  }, [circuit]);

  // ── Replay path animation state ────────────────────────────────────────────
  //
  // `dotPositions` is what actually drives DriverDot rendering in both modes:
  //   • Live:   updated directly from locations prop, CSS transition smooths.
  //   • Replay: updated at ~60 fps by rAF, CSS transition disabled.

  const [dotPositions, setDotPositions] = useState<
    Record<number, { svgX: number; svgY: number }>
  >({});

  const rafRef = useRef<number | null>(null);
  const animRef = useRef<AnimState | null>(null);
  // Stores the NormPos of each driver after the last completed animation so
  // the next animation knows where to start from.
  const prevNormRef = useRef<Record<number, NormPos>>({});

  // Clear animation state whenever the circuit changes (new session / circuit).
  useEffect(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    animRef.current = null;
    prevNormRef.current = {};
    setDotPositions({});
  }, [derived]);

  // Core effect: react to `locations` changes and either update directly (live)
  // or kick off a path-following animation (replay).
  useEffect(() => {
    if (!derived || Object.keys(locations).length === 0) return;

    const { normalizedPath, bounds } = derived;

    // ── Compute normalised target positions for every driver ─────────────────
    const toNorm: Record<number, NormPos> = {};
    for (const loc of Object.values(locations)) {
      const { svgX, svgY } = normalizeCoords(
        loc.x,
        loc.y,
        bounds.minX,
        bounds.maxX,
        bounds.maxY, // Y-flip matches circuit path
        bounds.minY,
        INNER_WIDTH,
        INNER_HEIGHT,
      );
      toNorm[loc.driver_number] = {
        svgX,
        svgY,
        pathIdx: findNearestIdx(normalizedPath, svgX, svgY),
      };
    }

    // ── Live mode: update directly, CSS transition handles visual smoothing ──
    if (isLive) {
      const pos: Record<number, { svgX: number; svgY: number }> = {};
      for (const [k, v] of Object.entries(toNorm)) {
        pos[Number(k)] = { svgX: v.svgX, svgY: v.svgY };
      }
      setDotPositions(pos);
      prevNormRef.current = toNorm;
      return;
    }

    // ── Replay mode ──────────────────────────────────────────────────────────

    // First load: snap to position without animation (no prev to animate from).
    if (Object.keys(prevNormRef.current).length === 0) {
      const pos: Record<number, { svgX: number; svgY: number }> = {};
      for (const [k, v] of Object.entries(toNorm)) {
        pos[Number(k)] = { svgX: v.svgX, svgY: v.svgY };
      }
      setDotPositions(pos);
      prevNormRef.current = toNorm;
      return;
    }

    // Cancel any in-flight animation. Start the next one from the target of
    // the cancelled one so rapid scrubbing stays spatially coherent.
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      if (animRef.current) prevNormRef.current = animRef.current.to;
    }

    animRef.current = {
      from: { ...prevNormRef.current },
      to: toNorm,
      startTime: performance.now(),
      duration: REPLAY_ANIM_MS,
    };

    function tick(now: number): void {
      const anim = animRef.current;
      if (!anim) return;

      const raw = Math.min((now - anim.startTime) / anim.duration, 1);
      const t = easeInOut(raw);

      const pos: Record<number, { svgX: number; svgY: number }> = {};
      for (const [key, to] of Object.entries(anim.to)) {
        const n = Number(key);
        const from = anim.from[n];
        if (!from || from.pathIdx === to.pathIdx) {
          pos[n] = { svgX: to.svgX, svgY: to.svgY };
        } else {
          pos[n] = interpolateAlongPath(
            normalizedPath,
            from.pathIdx,
            to.pathIdx,
            t,
          );
        }
      }
      setDotPositions(pos);

      if (raw < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        rafRef.current = null;

        prevNormRef.current = anim.to;
      }
    }

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [locations, isLive, derived]);

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

  const { pathPoints, normalizedPath } = derived;

  // ── Driver dots ────────────────────────────────────────────────────────────
  // Rendered from `dotPositions` state (not raw `locations`) so that both live
  // CSS-transition smoothing and replay rAF animation use the same code path.

  const dots = Object.entries(dotPositions).flatMap(([key, pos]) => {
    const driverNum = Number(key);
    const driver = driverMap.get(driverNum);
    if (!driver) return [];

    return [
      <DriverDot
        key={driverNum}
        driverNumber={driverNum}
        svgX={pos.svgX}
        svgY={pos.svgY}
        color={driverTeamColor(driver)}
        abbreviation={driver.name_acronym}
        // Live: 800 ms CSS transition smooths 1 s polling gaps.
        // Replay: 0 — rAF drives position; CSS transition must not interfere.
        transitionMs={isLive ? 800 : 0}
      />,
    ];
  });

  // ── Badge geometry ─────────────────────────────────────────────────────────

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
      <style>{SVG_KEYFRAMES}</style>

      <defs>
        {/* Vignette gradient — dark corners, frames the circuit */}
        <radialGradient id="f1-vignette" cx="50%" cy="50%" r="50%">
          <stop offset="65%" stopColor="transparent" />
          <stop offset="100%" stopColor="#0A0A0A" stopOpacity="0.38" />
        </radialGradient>

        {/* Checkered pattern for start/finish line */}
        <pattern
          id="f1-finish-checker"
          x="0"
          y="0"
          width="5"
          height="5"
          patternUnits="userSpaceOnUse"
        >
          <rect width="5" height="5" fill="#FFFFFF" />
          <rect width="2.5" height="2.5" fill="#111111" />
          <rect x="2.5" y="2.5" width="2.5" height="2.5" fill="#111111" />
        </pattern>
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

        {/* Start/finish line — checkered rect at path index 0 */}
        <FinishLine path={normalizedPath} />

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
        <g aria-label="Live session">
          <rect
            x={BADGE_X - 56}
            y={BADGE_Y - 10}
            width={56}
            height={20}
            fill="#1A0000"
            stroke="#E8002D"
            strokeWidth={0.75}
          />
          <circle
            cx={BADGE_X - 46}
            cy={BADGE_Y}
            r={3.5}
            fill="#E8002D"
            style={{ animation: "f1-live-blink 1.1s step-end infinite" }}
          />
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
