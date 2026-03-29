import { useState, useEffect, useRef } from "react";
import { getLocations } from "../api/openf1";
import type { Location } from "../types/f1";

/** Milliseconds to wait after the last scrub event before firing the fetch. */
const DEBOUNCE_MS = 250;

/**
 * How many seconds before `atDate` to include in the snapshot window.
 * 30 s gives ≥ 1 location reading per driver (even during a pit stop)
 * while keeping the response size small (≈ 30 s × 3.7 Hz × 20 drivers ≈ 2 200 records).
 */
const WINDOW_SECONDS = 30;

export interface UseLocationSnapshotResult {
  locations: Record<number, Location>;
  loading: boolean;
}

/**
 * Fetches a snapshot of driver locations just before `atDate`.
 *
 * When `atDate` changes the fetch is debounced by 250 ms so rapid slider
 * drags do not hammer the OpenF1 API. Only the most recent location per
 * driver within the [atDate − 30 s, atDate] window is kept.
 *
 * Pass `atDate = null` to disable the hook entirely (e.g. when live or at
 * the end of a replay where the stream data already shows the final state).
 */
export function useLocationSnapshot(
  sessionKey: number | null,
  atDate: string | null,
): UseLocationSnapshotResult {
  const [locations, setLocations] = useState<Record<number, Location>>({});
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear snapshot when the session changes
  useEffect(() => {
    setLocations({});
  }, [sessionKey]);

  useEffect(() => {
    if (sessionKey === null || atDate === null) {
      // Nothing to snapshot — clear any in-flight debounce
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      return;
    }

    // Debounce: cancel the previous timeout on each render with a new atDate
    if (debounceRef.current) clearTimeout(debounceRef.current);

    debounceRef.current = setTimeout(() => {
      setLoading(true);

      const atMs = new Date(atDate).getTime();
      const windowStartMs = atMs - WINDOW_SECONDS * 1_000;

      // Explicitly sort so date_gt is always the earlier bound and
      // date_lt is always the later bound. Prevents inverted windows
      // if atDate is ever computed incorrectly upstream.
      const earlier = new Date(Math.min(windowStartMs, atMs)).toISOString();
      const later = new Date(Math.max(windowStartMs, atMs)).toISOString();

      getLocations(sessionKey, earlier, later)
        .then((batch) => {
          // Reduce to the most recent record per driver within the window
          const map: Record<number, Location> = {};
          for (const loc of batch) {
            const existing = map[loc.driver_number];
            if (!existing || loc.date > existing.date) {
              map[loc.driver_number] = loc;
            }
          }
          setLocations(map);
        })
        .catch(() => {
          // Silent failure — stale dots are better than a crash or blank map
        })
        .finally(() => {
          setLoading(false);
        });
    }, DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
    };
  }, [sessionKey, atDate]);

  return { locations, loading };
}
