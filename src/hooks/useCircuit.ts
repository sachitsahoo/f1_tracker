import { useState, useEffect } from "react";
import { getCircuit } from "../api/multiviewer";
import type { CircuitData, ApiError } from "../types/f1";

export interface UseCircuitResult {
  /** Parsed circuit path data from MultiViewer. Null while loading or on error. */
  circuit: CircuitData | null;
  loading: boolean;
  error: ApiError | null;
}

/**
 * Fetches the circuit outline from the MultiViewer API once on mount (or when
 * circuitKey / year change). No polling — circuit geometry is static per event.
 *
 * Raw coordinates in CircuitData.x[] / CircuitData.y[] MUST be normalised via
 * computeBoundsFromArrays() + normalizeCoords() before rendering to SVG (Rule 4).
 */
export function useCircuit(circuitKey: number, year: number): UseCircuitResult {
  const [circuit, setCircuit] = useState<CircuitData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    let cancelled = false;

    setLoading(true);
    setError(null);
    setCircuit(null);

    getCircuit(circuitKey, year)
      .then((data) => {
        if (!cancelled) {
          setCircuit(data);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err as ApiError);
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [circuitKey, year]);

  return { circuit, loading, error };
}
