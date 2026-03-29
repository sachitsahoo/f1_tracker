import { useState, useEffect } from "react";
import type { Session, ApiError } from "../types/f1";

const BASE_URL = "https://api.openf1.org/v1";

export interface UseSessionResult {
  session: Session | null;
  loading: boolean;
  error: ApiError | null;
}

/**
 * Fetches the latest Race-type session for the current year.
 * Runs once on mount — sessions are static within a race weekend.
 * Filters explicitly for session_type=Race so qualifying / practice
 * sessions are excluded.
 */
export function useSession(): UseSessionResult {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchLatestRaceSession(): Promise<void> {
      setLoading(true);
      setError(null);

      try {
        const year = new Date().getFullYear();
        const res = await fetch(
          `${BASE_URL}/sessions?year=${year}&session_type=Race`,
        );

        if (!res.ok) {
          const message = await res.text().catch(() => res.statusText);
          throw {
            status: res.status,
            message,
            isRateLimit: res.status === 429,
          } satisfies ApiError;
        }

        const sessions: Session[] = await res.json();

        // Pick the session with the latest start date
        const latest = sessions.reduce<Session | null>((best, s) => {
          if (!best) return s;
          return new Date(s.date_start) > new Date(best.date_start) ? s : best;
        }, null);

        if (!latest) {
          throw {
            status: 404,
            message: `No Race sessions found for ${year}`,
            isRateLimit: false,
          } satisfies ApiError;
        }

        if (!cancelled) setSession(latest);
      } catch (err) {
        if (!cancelled) setError(err as ApiError);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchLatestRaceSession();

    return () => {
      cancelled = true;
    };
  }, []);

  return { session, loading, error };
}
