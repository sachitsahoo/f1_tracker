import { useState, useRef, useCallback } from "react";
import { getPositions, getIntervals } from "../api/openf1";
import type { Position, Interval, ApiError } from "../types/f1";
import { useInterval } from "./useInterval";

const POLL_INTERVAL_MS = 4_000;

export interface UsePositionsResult {
  /**
   * Latest known position per driver, keyed by driver_number.
   * Updated incrementally via date_gt filtering.
   */
  positions: Record<number, Position>;
  /**
   * Latest known gap/interval per driver, keyed by driver_number.
   * Updated incrementally via date_gt filtering.
   */
  intervals: Record<number, Interval>;
  loading: boolean;
  error: ApiError | null;
}

/**
 * Polls /v1/position and /v1/intervals together every 4 seconds.
 * Uses a `date_gt` cursor so only new records are fetched on each tick.
 * Merges incremental updates into a per-driver record map, always keeping
 * the most recent entry for each driver_number.
 *
 * Pass `null` for sessionKey while the session is still resolving —
 * the interval is paused automatically until a valid key is provided.
 */
export function usePositions(sessionKey: number | null): UsePositionsResult {
  const [positions, setPositions] = useState<Record<number, Position>>({});
  const [intervals, setIntervals] = useState<Record<number, Interval>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  // Cursor refs: track the latest date seen to filter subsequent polls
  const positionCursorRef = useRef<string | undefined>(undefined);
  const intervalCursorRef = useRef<string | undefined>(undefined);

  const poll = useCallback(async (): Promise<void> => {
    if (sessionKey === null) return;

    // Only show loading spinner on the very first fetch
    if (positionCursorRef.current === undefined) {
      setLoading(true);
    }
    setError(null);

    try {
      const [newPositions, newIntervals] = await Promise.all([
        getPositions(sessionKey, positionCursorRef.current),
        getIntervals(sessionKey, intervalCursorRef.current),
      ]);

      // ── Merge positions ──────────────────────────────────────────────────
      if (newPositions.length > 0) {
        // Advance cursor to the latest date in this batch
        const latestDate = newPositions.reduce(
          (max, p) => (p.date > max ? p.date : max),
          newPositions[0].date,
        );
        positionCursorRef.current = latestDate;

        setPositions((prev) => {
          const next = { ...prev };
          for (const p of newPositions) {
            const existing = next[p.driver_number];
            // Keep whichever record is more recent
            if (!existing || p.date >= existing.date) {
              next[p.driver_number] = p;
            }
          }
          return next;
        });
      }

      // ── Merge intervals ──────────────────────────────────────────────────
      if (newIntervals.length > 0) {
        const latestDate = newIntervals.reduce(
          (max, i) => (i.date > max ? i.date : max),
          newIntervals[0].date,
        );
        intervalCursorRef.current = latestDate;

        setIntervals((prev) => {
          const next = { ...prev };
          for (const i of newIntervals) {
            const existing = next[i.driver_number];
            if (!existing || i.date >= existing.date) {
              next[i.driver_number] = i;
            }
          }
          return next;
        });
      }
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setLoading(false);
    }
  }, [sessionKey]);

  // Pause the interval (delay = null) until sessionKey is available
  useInterval(poll, sessionKey !== null ? POLL_INTERVAL_MS : null);

  return { positions, intervals, loading, error };
}
