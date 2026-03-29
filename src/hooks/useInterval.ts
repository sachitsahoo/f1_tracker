import { useEffect, useRef } from "react";

/**
 * Shared polling primitive. Wraps setInterval with a stable callback ref so
 * callers never need to worry about stale closures. Pass `delay: null` to
 * pause the interval (e.g. while sessionKey is not yet known).
 *
 * All polling hooks in this project MUST use this hook — no raw setInterval.
 */
export function useInterval(callback: () => void, delay: number | null): void {
  // Keep a mutable ref to the latest callback so the interval itself never
  // needs to be torn down and re-created when the callback changes.
  const savedCallback = useRef<() => void>(callback);

  useEffect(() => {
    savedCallback.current = callback;
  }, [callback]);

  useEffect(() => {
    if (delay === null) return;

    const id = setInterval(() => {
      savedCallback.current();
    }, delay);

    // Mandatory cleanup — Rule 3
    return () => clearInterval(id);
  }, [delay]);
}
