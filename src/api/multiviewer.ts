import type { CircuitData, ApiError } from "../types/f1.ts";

const BASE_URL = "https://api.multiviewer.app/api/v1/circuits";

// ─── Circuit ──────────────────────────────────────────────────────────────────

/**
 * Fetches SVG-ready circuit path coordinates from the MultiViewer API.
 *
 * @param circuitKey - The OpenF1 `circuit_key` from `/v1/meetings`.
 * @param year       - The season year (e.g. 2026). Circuit layouts can change
 *                     year-to-year, so always pass the actual season year.
 *
 * Returns `CircuitData` containing `x[]` and `y[]` arrays of path points,
 * plus optional `corners` and marshal sector positions.
 *
 * The raw coordinates are in MultiViewer's internal coordinate space and must
 * be normalised via `src/utils/coordinates.ts` before rendering to SVG.
 */
export async function getCircuit(
  circuitKey: number,
  year: number,
): Promise<CircuitData> {
  const res = await fetch(`${BASE_URL}/${circuitKey}/${year}`);

  if (!res.ok) {
    const message = await res.text().catch(() => res.statusText);
    const error: ApiError = {
      status: res.status,
      message,
      isRateLimit: res.status === 429,
    };
    throw error;
  }

  const data: unknown = await res.json();
  return data as CircuitData;
}
