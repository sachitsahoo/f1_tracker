import { useState, useEffect } from "react";
import type { Session, ApiError } from "../types/f1";

const BASE_URL = "/api";

export interface UseSessionResult {
  session: Session | null;
  loading: boolean;
  error: ApiError | null;
}

/**
 * Fetches the most recent Race or Sprint session for the current year from
 * the backend API at GET /api/sessions?year=<year>.
 *
 * Runs once on mount — sessions are static within a race weekend.
 * Only considers sessions that have already started (date_start ≤ now) so
 * future scheduled rounds are never accidentally selected.
 */
export function useSession(): UseSessionResult {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchLatestSession(): Promise<void> {
      setLoading(true);
      setError(null);

      try {
        const year = new Date().getFullYear();
        const res = await fetch(`${BASE_URL}/sessions?year=${year}`);

        if (!res.ok) {
          const message = await res.text().catch(() => res.statusText);
          throw {
            status: res.status,
            message,
            isRateLimit: res.status === 429,
          } satisfies ApiError;
        }

        const sessions: Session[] = await res.json();

        // Only Race and Sprint sessions carry live timing data we care about.
        // Filter to those that have already started, then pick the most recent.
        const now = new Date();
        const candidates = sessions
          .filter(
            (s) =>
              (s.session_type === "Race" || s.session_type === "Sprint") &&
              new Date(s.date_start) <= now,
          )
          .sort(
            (a, b) =>
              new Date(a.date_start).getTime() -
              new Date(b.date_start).getTime(),
          );

        const latest = candidates.at(-1) ?? null;

        if (!latest) {
          throw {
            status: 404,
            message: `No Race or Sprint sessions found for ${year}`,
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

    fetchLatestSession();

    return () => {
      cancelled = true;
    };
  }, []);

  return { session, loading, error };
}
