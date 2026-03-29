import { useState, useEffect, useRef, useCallback } from "react";
import { getPositions, getIntervals } from "../api/openf1";
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
 * Fetches /v1/position and /v1/intervals for the given session.
 *
 * When `isLive` is true (default): polls every 4 s via useInterval.
 * When `isLive` is false (historical session): fires one immediate fetch
 * to load existing data, then stops — no point hammering a finished race.
 */
export function usePositions(
  sessionKey: number | null,
  isLive = true,
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

  // Reset everything when the session changes
  useEffect(() => {
    positionCursorRef.current = undefined;
    intervalCursorRef.current = undefined;
    initialFetchDoneRef.current = false;
    setPositions({});
    setIntervals({});
    setAllPositions([]);
    setAllIntervals([]);
  }, [sessionKey]);

  const poll = useCallback(async (): Promise<void> => {
    if (sessionKey === null) return;

    if (positionCursorRef.current === undefined) setLoading(true);
    setError(null);

    try {
      const [newPositions, newIntervals] = await Promise.all([
        getPositions(sessionKey, positionCursorRef.current),
        getIntervals(sessionKey, intervalCursorRef.current),
      ]);

      if (newPositions.length > 0) {
        const latestDate = newPositions.reduce(
          (max, p) => (p.date > max ? p.date : max),
          newPositions[0].date,
        );
        positionCursorRef.current = latestDate;

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
  }, [sessionKey]);

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
