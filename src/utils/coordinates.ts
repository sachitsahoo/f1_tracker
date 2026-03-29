import type { Location } from "../types/f1";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface Bounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export interface SvgPoint {
  svgX: number;
  svgY: number;
}

// ─── normalizeCoords ─────────────────────────────────────────────────────────

/**
 * Maps a raw OpenF1 telemetry (x, y) integer pair into SVG viewport
 * coordinates, clamped to [0, svgWidth] × [0, svgHeight].
 *
 * Call computeBounds() once on the full location dataset (or circuit path)
 * to get the min/max values, then reuse them for every subsequent point.
 */
export function normalizeCoords(
  x: number,
  y: number,
  minX: number,
  maxX: number,
  minY: number,
  maxY: number,
  svgWidth: number,
  svgHeight: number,
): SvgPoint {
  const rangeX = maxX - minX;
  const rangeY = maxY - minY;

  // Guard against degenerate ranges (all points identical on an axis)
  const svgX = rangeX === 0 ? svgWidth / 2 : ((x - minX) / rangeX) * svgWidth;
  // OpenF1 Y increases downward on the circuit, which matches SVG convention,
  // so no Y-flip is needed here. Flip the subtraction if the circuit renders
  // upside-down for a specific track.
  const svgY = rangeY === 0 ? svgHeight / 2 : ((y - minY) / rangeY) * svgHeight;

  return { svgX, svgY };
}

// ─── computeBounds ───────────────────────────────────────────────────────────

/**
 * Derives {minX, maxX, minY, maxY} from an array of Location points.
 * Intended to be called once on the circuit's full location history so that
 * normalizeCoords() has stable bounds for the entire session.
 *
 * Throws if locations is empty, because bounds are undefined for 0 points.
 */
export function computeBounds(locations: Location[]): Bounds {
  if (locations.length === 0) {
    throw new Error("computeBounds: locations array must not be empty");
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (const loc of locations) {
    if (loc.x < minX) minX = loc.x;
    if (loc.x > maxX) maxX = loc.x;
    if (loc.y < minY) minY = loc.y;
    if (loc.y > maxY) maxY = loc.y;
  }

  return { minX, maxX, minY, maxY };
}

// ─── computeBoundsFromArrays ─────────────────────────────────────────────────

/**
 * Convenience overload for MultiViewer CircuitData, which exposes coordinates
 * as separate x[] and y[] arrays rather than Location objects.
 */
export function computeBoundsFromArrays(xs: number[], ys: number[]): Bounds {
  if (xs.length === 0 || ys.length === 0) {
    throw new Error(
      "computeBoundsFromArrays: coordinate arrays must not be empty",
    );
  }

  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}
