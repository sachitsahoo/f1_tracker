import { useState, useEffect } from "react";
import { getDrivers } from "../api/openf1";
import type { Driver, ApiError } from "../types/f1";

export interface UseDriversResult {
  /** Ordered array of all drivers in the session. */
  drivers: Driver[];
  /** Quick lookup map: driver_number → Driver. */
  driverMap: Record<number, Driver>;
  loading: boolean;
  error: ApiError | null;
}

/**
 * Fetches the driver list for a given session. Driver data is static per
 * session so no polling is needed — the fetch re-runs whenever sessionKey
 * changes (e.g. after useSession resolves).
 *
 * Pass `null` for sessionKey while the session is still loading; the hook
 * will wait and not fire until a valid key is available.
 */
export function useDrivers(sessionKey: number | null): UseDriversResult {
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [driverMap, setDriverMap] = useState<Record<number, Driver>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    if (sessionKey === null) return;

    let cancelled = false;

    async function fetchDrivers(): Promise<void> {
      setLoading(true);
      setError(null);

      try {
        const data = await getDrivers(sessionKey as number);

        if (!cancelled) {
          setDrivers(data);
          // Build lookup map for O(1) access by driver number
          const map: Record<number, Driver> = {};
          for (const d of data) {
            map[d.driver_number] = d;
          }
          setDriverMap(map);
        }
      } catch (err) {
        if (!cancelled) setError(err as ApiError);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchDrivers();

    return () => {
      cancelled = true;
    };
  }, [sessionKey]);

  return { drivers, driverMap, loading, error };
}
