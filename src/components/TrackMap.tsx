import { useMemo, useEffect, useRef, useState } from "react";
import { useCircuit } from "../hooks/useCircuit";
import { normalizeCoords, computeBoundsFromArrays } from "../utils/coordinates";
import { driverTeamColor } from "../utils/teamColors";
import { DriverDot } from "./DriverDot";
import type { TrackMapProps } from "../types/f1";

// ─── SVG viewport constants ───────────────────────────────────────────────────

/**
 * Target size (px) for the longer of the two inner-area axes. Picked so that
 * stroke widths and dot radii (which are absolute viewBox units) look
 * consistent across circuits of different aspect ratios. The shorter axis is
 * computed per-circuit so the SVG viewBox tracks the circuit's natural shape
 * rather than letterboxing it inside a hardcoded 1.6:1 rectangle.
 */
const TARGET_MAX_INNER_DIM = 720;

/** Padding (px) around the inner drawing area so dots never clip the edge. */
const PADDING = 40;

/**
 * Fallback viewBox for skeleton / error states, before circuit bounds are
 * known. Once the circuit loads, `derived.svgW` / `derived.svgH` replace these.
 */
const FALLBACK_SVG_WIDTH = TARGET_MAX_INNER_DIM + PADDING * 2;
const FALLBACK_SVG_HEIGHT = Math.round(FALLBACK_SVG_WIDTH / 1.6);
const FALLBACK_INNER_WIDTH = FALLBACK_SVG_WIDTH - PADDING * 2;
const FALLBACK_INNER_HEIGHT = FALLBACK_SVG_HEIGHT - PADDING * 2;

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
      {/* Checkered flag rect — 7 px along track, 24 px across (bumped from 5×20
          for slightly better screenshot legibility). */}
      <rect
        x={-3.5}
        y={-12}
        width={7}
        height={24}
        fill="url(#f1-finish-checker)"
        transform={`translate(${p0.svgX.toFixed(2)},${p0.svgY.toFixed(2)}) rotate(${angleDeg.toFixed(1)})`}
      />
      {/* SF label offset to the outside of the first path point */}
      <text
        x={p0.svgX + (-dy / len) * 20}
        y={p0.svgY + (dx / len) * 20}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={9}
        fontFamily="'JetBrains Mono', 'Roboto Mono', monospace"
        fontWeight="700"
        fill="#AAAAAA"
        letterSpacing={1}
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
      height="100%"
      viewBox={`0 0 ${FALLBACK_SVG_WIDTH} ${FALLBACK_SVG_HEIGHT}`}
      preserveAspectRatio="xMidYMid meet"
      aria-label="Loading circuit…"
      role="img"
      style={{ display: "block" }}
    >
      <style>{`
        ${SVG_KEYFRAMES}
        .f1-skel { animation: f1-skel-pulse 1.6s ease-in-out infinite; }
      `}</style>
      <rect
        x={0}
        y={0}
        width={FALLBACK_SVG_WIDTH}
        height={FALLBACK_SVG_HEIGHT}
        fill="#0A0A0A"
      />
      <rect
        className="f1-skel"
        x={PADDING}
        y={PADDING}
        width={FALLBACK_INNER_WIDTH}
        height={FALLBACK_INNER_HEIGHT}
        rx={FALLBACK_INNER_HEIGHT / 2}
        fill="none"
        stroke="#2A2A2A"
        strokeWidth={18}
      />
      <rect
        x={PADDING + 50}
        y={PADDING + 50}
        width={FALLBACK_INNER_WIDTH - 100}
        height={FALLBACK_INNER_HEIGHT - 100}
        rx={(FALLBACK_INNER_HEIGHT - 100) / 2}
        fill="#0A0A0A"
      />
      <text
        x={FALLBACK_SVG_WIDTH / 2}
        y={FALLBACK_SVG_HEIGHT / 2}
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
      height="100%"
      viewBox={`0 0 ${FALLBACK_SVG_WIDTH} ${FALLBACK_SVG_HEIGHT}`}
      preserveAspectRatio="xMidYMid meet"
      role="alert"
      style={{ display: "block" }}
    >
      <rect
        x={0}
        y={0}
        width={FALLBACK_SVG_WIDTH}
        height={FALLBACK_SVG_HEIGHT}
        fill="#0A0A0A"
      />
      <text
        x={FALLBACK_SVG_WIDTH / 2}
        y={FALLBACK_SVG_HEIGHT / 2 - 14}
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
        x={FALLBACK_SVG_WIDTH / 2}
        y={FALLBACK_SVG_HEIGHT / 2 + 14}
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

    // ── Dynamic viewBox sized to the circuit's natural aspect ratio ─────────
    // Previously the viewBox was hardcoded to 800×500 (1.6:1) and the circuit
    // was letterboxed inside a 720×420 inner area, producing dead space top/
    // bottom on wide circuits (Miami) and dead space sides on tall ones
    // (Hungaroring). Compute the inner area per-circuit so the path always
    // fills its bounding box tightly.
    const circuitW = Math.max(bounds.maxX - bounds.minX, 1);
    const circuitH = Math.max(bounds.maxY - bounds.minY, 1);
    const aspect = circuitW / circuitH;
    const innerW =
      aspect >= 1 ? TARGET_MAX_INNER_DIM : TARGET_MAX_INNER_DIM * aspect;
    const innerH =
      aspect >= 1 ? TARGET_MAX_INNER_DIM / aspect : TARGET_MAX_INNER_DIM;
    const svgW = innerW + PADDING * 2;
    const svgH = innerH + PADDING * 2;

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
        innerW,
        innerH,
      );
      normalizedPath.push({ svgX, svgY });
      parts.push(
        `${i === 0 ? "M" : "L"} ${svgX.toFixed(2)} ${svgY.toFixed(2)}`,
      );
    }

    return {
      bounds,
      pathPoints: parts.join(" ") + " Z",
      normalizedPath,
      innerW,
      innerH,
      svgW,
      svgH,
    };
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

    const { normalizedPath, bounds, innerW, innerH } = derived;

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
        innerW,
        innerH,
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

  // ── Badge geometry (anchored to dynamic SVG width) ─────────────────────────

  const BADGE_X = derived.svgW - 12;
  const BADGE_Y = 14;

  // ── SVG output ─────────────────────────────────────────────────────────────

  return (
    <svg
      width="100%"
      height="100%"
      viewBox={`0 0 ${derived.svgW} ${derived.svgH}`}
      preserveAspectRatio="xMidYMid meet"
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
        {/* Racing line — bumped from #333 → #555 so the circuit reads cleanly
            against the dark background without stealing focus from dots. */}
        <path
          d={pathPoints}
          fill="none"
          stroke="#555555"
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
        width={derived.svgW}
        height={derived.svgH}
        fill="url(#f1-vignette)"
        style={{ pointerEvents: "none" }}
      />

      {/* ── Session badge — top-right corner (LIVE only; REPLAY badge lives in StatusBar) ── */}
      {isLive && (
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
      )}
    </svg>
  );
}
