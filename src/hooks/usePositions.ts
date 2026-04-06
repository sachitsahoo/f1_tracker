import { useState, useEffect, useRef, useCallback } from "react";
import { getBackendPositions, getBackendIntervals } from "../api/backend";
import type { Position, Interval, ApiError } from "../types/f1";
import { useInterval } from "./useInterval";

const POLL_INTERVAL_MS = 4_000;

export interface UsePositionsResult {
  positions: Record<number, Position>;
  intervals: Record<number, Interval>;
  /** Full position history for the session. Only populated when isLive=false. */
  allPositions: Position[];
  /** Full interval history for the session. Only populated when isLive=false. */
  allIntervals: Interval[];
  loading: boolean;
  error: ApiError | null;
}

/**
 * Fetches /api/positions and /api/intervals for the given session.
 *
 * When `isLive` is true (default): polls every 4 s via useInterval.
 * When `isLive` is false (historical session): fires one immediate fetch
 * to load existing data, then stops — no point hammering a finished race.
 *
 * The backend returns all rows ordered by date ascending on every call.
 * This hook tracks a per-endpoint cursor (ISO timestamp of the last row seen)
 * and skips rows at or before that cursor so state updates are incremental.
 *
 * Pass `driverNumber` to scope both endpoints to a single driver — useful for
 * detail views. Omit it (the default) to receive the full 20-car dataset.
 */
export function usePositions(
  sessionKey: number | null,
  isLive = true,
  driverNumber?: number,
): UsePositionsResult {
  const [positions, setPositions] = useState<Record<number, Position>>({});
  const [intervals, setIntervals] = useState<Record<number, Interval>>({});
  const [allPositions, setAllPositions] = useState<Position[]>([]);
  const [allIntervals, setAllIntervals] = useState<Interval[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const positionCursorRef = useRef<string | undefined>(undefined);
  const intervalCursorRef = useRef<string | undefined>(undefined);
  const initialFetchDoneRef = useRef(false);
  // Keep isLive accessible inside poll without re-creating the callback
  const isLiveRef = useRef(isLive);
  isLiveRef.current = isLive;

  // Reset everything when the session or driver filter changes
  useEffect(() => {
    positionCursorRef.current = undefined;
    intervalCursorRef.current = undefined;
    initialFetchDoneRef.current = false;
    setPositions({});
    setIntervals({});
    setAllPositions([]);
    setAllIntervals([]);
  }, [sessionKey, driverNumber]);

  const poll = useCallback(async (): Promise<void> => {
    if (sessionKey === null) return;

    if (positionCursorRef.current === undefined) setLoading(true);
    setError(null);

    try {
      const [rawPositions, rawIntervals] = await Promise.all([
        getBackendPositions(sessionKey, driverNumber),
        getBackendIntervals(sessionKey, driverNumber),
      ]);

      // ── Positions ────────────────────────────────────────────────────────────
      // The backend returns full session history ordered by date ascending.
      // Skip rows already processed (date <= cursor) so each poll is incremental.
      const cursor = positionCursorRef.current;
      const newPositions = cursor
        ? rawPositions.filter((p) => p.date > cursor)
        : rawPositions;

      if (newPositions.length > 0) {
        // Data is ordered ascending — last element holds the latest timestamp.
        positionCursorRef.current = newPositions[newPositions.length - 1].date;

        setPositions((prev) => {
          const next = { ...prev };
          for (const p of newPositions) {
            const existing = next[p.driver_number];
            if (!existing || p.date >= existing.date) next[p.driver_number] = p;
          }
          return next;
        });

        // Accumulate full history only for replay (historical) sessions.
        // Live sessions only need the latest-per-driver map.
        if (!isLiveRef.current) {
          setAllPositions((prev) => [...prev, ...newPositions]);
        }
      }

      // ── Intervals ────────────────────────────────────────────────────────────
      const iCursor = intervalCursorRef.current;
      const newIntervals = iCursor
        ? rawIntervals.filter((i) => i.date > iCursor)
        : rawIntervals;

      if (newIntervals.length > 0) {
        intervalCursorRef.current = newIntervals[newIntervals.length - 1].date;

        setIntervals((prev) => {
          const next = { ...prev };
          for (const i of newIntervals) {
            const existing = next[i.driver_number];
            if (!existing || i.date >= existing.date) next[i.driver_number] = i;
          }
          return next;
        });

        if (!isLiveRef.current) {
          setAllIntervals((prev) => [...prev, ...newIntervals]);
        }
      }
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setLoading(false);
    }
  }, [sessionKey, driverNumber]);

  // Initial fetch — fires immediately regardless of isLive so historical
  // sessions still load their data before the interval would otherwise kick in.
  useEffect(() => {
    if (sessionKey === null || initialFetchDoneRef.current) return;
    initialFetchDoneRef.current = true;
    void poll();
  }, [sessionKey, poll]);

  // Ongoing polling — only while the session is live.
  useInterval(poll, isLive && sessionKey !== null ? POLL_INTERVAL_MS : null);

  return { positions, intervals, allPositions, allIntervals, loading, error };
}
