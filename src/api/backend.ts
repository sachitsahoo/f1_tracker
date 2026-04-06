/**
 * Fetch functions for our own backend API routes (Vercel Serverless Functions
 * backed by Supabase). These are NOT proxied OpenF1 calls — no rate limiter,
 * no Bearer token. Data is always returned ordered by `date` ascending.
 */

import type { Position, Interval, ApiError } from "../types/f1";
import { emitApiEvent } from "../utils/apiEvents";

// ─── Internal helpers ─────────────────────────────────────────────────────────

async function backendFetch(url: string): Promise<Response> {
  try {
    const res = await fetch(url);
    return res;
  } catch (_err) {
    emitApiEvent(
      "network-error",
      "Network connection lost — showing last known data",
    );
    const error: ApiError = {
      status: 0,
      message: "Network request failed — check your connection",
      isRateLimit: false,
    };
    throw error;
  }
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const message = await res.text().catch(() => res.statusText);
    const error: ApiError = {
      status: res.status,
      message,
      isRateLimit: res.status === 429,
    };
    throw error;
  }
  emitApiEvent("success", "");
  const data: unknown = await res.json();
  return data as T;
}

// ─── Positions ────────────────────────────────────────────────────────────────

/**
 * Fetches race positions from our backend `/api/positions` route.
 * Data is ordered by `date` ascending (full session history every call).
 * Pass `driverNumber` to scope the response to a single driver.
 *
 * The hook is responsible for cursor-based filtering to skip already-seen rows.
 */
export async function getBackendPositions(
  sessionKey: number,
  driverNumber?: number,
): Promise<Position[]> {
  const params = new URLSearchParams({ session_key: String(sessionKey) });
  if (driverNumber !== undefined) {
    params.set("driver_number", String(driverNumber));
  }
  const res = await backendFetch(`/api/positions?${params.toString()}`);
  return handleResponse<Position[]>(res);
}

// ─── Intervals ────────────────────────────────────────────────────────────────

/**
 * Fetches gap/interval data from our backend `/api/intervals` route.
 * Data is ordered by `date` ascending (full session history every call).
 * Pass `driverNumber` to scope the response to a single driver.
 *
 * The hook is responsible for cursor-based filtering to skip already-seen rows.
 */
export async function getBackendIntervals(
  sessionKey: number,
  driverNumber?: number,
): Promise<Interval[]> {
  const params = new URLSearchParams({ session_key: String(sessionKey) });
  if (driverNumber !== undefined) {
    params.set("driver_number", String(driverNumber));
  }
  const res = await backendFetch(`/api/intervals?${params.toString()}`);
  return handleResponse<Interval[]>(res);
}
