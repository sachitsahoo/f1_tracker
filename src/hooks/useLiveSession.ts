import { useState, useEffect, useRef, useCallback } from "react";
import { getLiveSession } from "../api/backend";
import type {
  Position,
  Interval,
  Location,
  Stint,
  RaceControl,
  ApiError,
} from "../types/f1";
import { useInterval } from "./useInterval";

const POLL_INTERVAL_MS = 4_000;

// ─── Return shape ─────────────────────────────────────────────────────────────

export interface UseLiveSessionResult {
  /**
   * True while the current time is within the session window
   * (date_start … date_end + 2 h) and OpenF1 is returning live data.
   * Flips to false when /api/live returns `{ live: false }` — polling stops.
   */
  isLive: boolean;
  /** Latest known position per driver, keyed by driver_number. */
  positions: Record<number, Position>;
  /** Latest known interval per driver, keyed by driver_number. */
  intervals: Record<number, Interval>;
  /** Latest known telemetry location per driver, keyed by driver_number. */
  locations: Record<number, Location>;
  /**
   * Current active stint per driver, keyed by driver_number.
   * "Most recent" is the stint with the highest lap_start (null treated as -1).
   */
  stints: Record<number, Stint>;
  /**
   * All race control messages for the session in chronological order.
   * Replaced wholesale on every successful poll.
   */
  raceControl: RaceControl[];
  error: ApiError | null;
}

// ─── Merge helpers ────────────────────────────────────────────────────────────

/** Keep the entry with the more recent `date` string per driver_number. */
function mergeByDate<T extends { driver_number: number; date: string }>(
  items: T[],
): Record<number, T> {
  const result: Record<number, T> = {};
  for (const item of items) {
    const existing = result[item.driver_number];
    if (!existing || item.date > existing.date) {
      result[item.driver_number] = item;
    }
  }
  return result;
}

/** Keep the stint with the highest lap_start per driver_number (null → -1). */
function mergeStints(stints: Stint[]): Record<number, Stint> {
  const result: Record<number, Stint> = {};
  for (const stint of stints) {
    const existing = result[stint.driver_number];
    const existingLap = existing?.lap_start ?? -1;
    const newLap = stint.lap_start ?? -1;
    if (!existing || newLap > existingLap) {
      result[stint.driver_number] = stint;
    }
  }
  return result;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Polls `GET /api/live?session_key=<key>` every 4 s.
 *
 * - Stops polling automatically when the response contains `{ live: false }`,
 *   indicating the session window has not started or has closed.
 * - On each live response, merges the full snapshot from OpenF1 into per-driver
 *   Records, keeping the most recent entry per driver_number (by date / lap_start).
 * - Resets all state and resumes polling when sessionKey changes.
 *
 * Pass `sessionKey: null` to skip polling entirely (e.g. session not yet loaded).
 */
export function useLiveSession(
  sessionKey: number | null,
): UseLiveSessionResult {
  const [isLive, setIsLive] = useState(false);
  const [positions, setPositions] = useState<Record<number, Position>>({});
  const [intervals, setIntervals] = useState<Record<number, Interval>>({});
  const [locations, setLocations] = useState<Record<number, Location>>({});
  const [stints, setStints] = useState<Record<number, Stint>>({});
  const [raceControl, setRaceControl] = useState<RaceControl[]>([]);
  const [error, setError] = useState<ApiError | null>(null);

  // When false, polling is suspended (session window closed or not yet open).
  const [pollingActive, setPollingActive] = useState(true);

  const initialFetchDoneRef = useRef(false);

  // Reset everything when the session changes so stale data never bleeds through.
  useEffect(() => {
    setIsLive(false);
    setPositions({});
    setIntervals({});
    setLocations({});
    setStints({});
    setRaceControl([]);
    setError(null);
    setPollingActive(true);
    initialFetchDoneRef.current = false;
  }, [sessionKey]);

  const poll = useCallback(async (): Promise<void> => {
    if (sessionKey === null) return;

    try {
      const data = await getLiveSession(sessionKey);

      if (!data.live) {
        // Session window has ended (or not yet started) — stop polling.
        setIsLive(false);
        setPollingActive(false);
        return;
      }

      setIsLive(true);
      setError(null);

      // Merge snapshot — most recent entry per driver wins within each batch.
      setPositions(mergeByDate(data.positions));
      setIntervals(mergeByDate(data.intervals));
      setLocations(mergeByDate(data.locations));
      setStints(mergeStints(data.stints));
      // Race control is an event log, not per-driver — replace wholesale.
      setRaceControl(data.raceControl);
    } catch (err) {
      setError(err as ApiError);
    }
  }, [sessionKey]);

  // Fire one immediate fetch so the UI doesn't sit empty for 4 s on mount.
  useEffect(() => {
    if (sessionKey === null || initialFetchDoneRef.current) return;
    initialFetchDoneRef.current = true;
    void poll();
  }, [sessionKey, poll]);

  // Ongoing polling — suspended when sessionKey is null or pollingActive is false.
  useInterval(
    poll,
    sessionKey !== null && pollingActive ? POLL_INTERVAL_MS : null,
  );

  return {
    isLive,
    positions,
    intervals,
    locations,
    stints,
    raceControl,
    error,
  };
}
