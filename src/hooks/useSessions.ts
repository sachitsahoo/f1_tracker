import { useState, useEffect } from "react";
import type { Session, ApiError } from "../types/f1";
import { getRaceSessions } from "../api/openf1";

export interface UseSessionsResult {
  /** All Race sessions for 2025–2026 that have started, newest first. */
  sessions: Session[];
  /** The most recently started session — the auto-selected default. */
  defaultSession: Session | null;
  loading: boolean;
  error: ApiError | null;
}

/**
 * Fetches all Race sessions for 2025 and 2026 in parallel.
 * Returns them sorted newest-first for the session picker.
 * Uses Promise.allSettled so one year failing doesn't block the other.
 */
export function useSessions(): UseSessionsResult {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load(): Promise<void> {
      setLoading(true);
      setError(null);

      const results = await Promise.allSettled([
        getRaceSessions(2025),
        getRaceSessions(2026),
      ]);

      if (cancelled) return;

      const all: Session[] = [];
      let firstError: ApiError | null = null;

      for (const result of results) {
        if (result.status === "fulfilled") {
          all.push(...result.value);
        } else if (!firstError) {
          firstError = result.reason as ApiError;
        }
      }

      // Sort newest-first for the dropdown
      all.sort(
        (a, b) =>
          new Date(b.date_start).getTime() - new Date(a.date_start).getTime(),
      );

      setSessions(all);
      if (all.length === 0 && firstError) setError(firstError);
      setLoading(false);
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const defaultSession = sessions[0] ?? null;

  return { sessions, defaultSession, loading, error };
}
