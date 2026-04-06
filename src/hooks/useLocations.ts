import { useState, useEffect, useRef, useCallback } from "react";
import type { Location, ApiError } from "../types/f1";
import { useInterval } from "./useInterval";

const BASE_URL = "/api/locations";
const POLL_INTERVAL_MS = 1_000;

export interface UseLocationsResult {
  /**
   * Latest known telemetry position per driver, keyed by driver_number.
   * Raw X/Y/Z values — MUST be normalised via src/utils/coordinates.ts
   * before rendering into SVG (Rule 4).
   */
  locations: Record<number, Location>;
  loading: boolean;
  error: ApiError | null;
}

/**
 * Polls GET /api/locations every 1 second.
 *
 * Required param:
 *   - sessionKey  — pass null while the session is still resolving;
 *                   polling is paused automatically.
 *
 * Optional filters forwarded as query params:
 *   - driverNumber — restrict results to a single driver
 *   - lapNumber    — restrict results to a specific lap
 *
 * Uses a `date_gt` cursor so only new telemetry records are fetched per tick.
 * Merges updates into a per-driver map, always keeping the most recent entry.
 * State and cursor reset whenever sessionKey changes.
 *
 * Note: Raw coordinates must NEVER be passed to SVG elements directly —
 * always use normalizeCoords() from src/utils/coordinates.ts (Rule 4).
 */
export function useLocations(
  sessionKey: number | null,
  driverNumber?: number,
  lapNumber?: number,
): UseLocationsResult {
  const [locations, setLocations] = useState<Record<number, Location>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  // Cursor ref: ISO timestamp of the last location record received
  const cursorRef = useRef<string | undefined>(undefined);

  // Reset state and cursor whenever the session changes
  useEffect(() => {
    cursorRef.current = undefined;
    setLocations({});
    setError(null);
  }, [sessionKey]);

  const poll = useCallback(async (): Promise<void> => {
    if (sessionKey === null) return;

    // Show loading only on the initial fetch (cursor not yet set)
    if (cursorRef.current === undefined) {
      setLoading(true);
    }
    setError(null);

    try {
      const params = new URLSearchParams({
        session_key: String(sessionKey),
      });

      if (cursorRef.current !== undefined) {
        params.set("date_gt", cursorRef.current);
      }
      if (driverNumber !== undefined) {
        params.set("driver_number", String(driverNumber));
      }
      if (lapNumber !== undefined) {
        params.set("lap_number", String(lapNumber));
      }

      const res = await fetch(`${BASE_URL}?${params}`);

      if (!res.ok) {
        const message = await res.text().catch(() => res.statusText);
        throw {
          status: res.status,
          message,
          isRateLimit: res.status === 429,
        } satisfies ApiError;
      }

      const newLocations: Location[] = await res.json();

      if (newLocations.length > 0) {
        // Advance cursor to the latest timestamp in this batch
        const latestDate = newLocations.reduce(
          (max, l) => (l.date > max ? l.date : max),
          newLocations[0].date,
        );
        cursorRef.current = latestDate;

        setLocations((prev) => {
          const next = { ...prev };
          for (const l of newLocations) {
            const existing = next[l.driver_number];
            // Keep the most recent record per driver
            if (!existing || l.date >= existing.date) {
              next[l.driver_number] = l;
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
  }, [sessionKey, driverNumber, lapNumber]);

  // Pause interval when sessionKey is null
  useInterval(poll, sessionKey !== null ? POLL_INTERVAL_MS : null);

  return { locations, loading, error };
}
