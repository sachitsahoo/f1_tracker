/**
 * Lightweight synchronous event bus for API lifecycle signals.
 *
 * The API layer (pure async functions, no React) calls `emitApiEvent()` to
 * broadcast rate-limit warnings and network errors. React wires up the single
 * listener via `setApiEventListener()` inside NetworkStatusContext.
 *
 * Design: single-listener model — only NetworkStatusContext should register.
 * All other callers should consume state through the context.
 */

export type ApiEventType = "rate-limit" | "network-error" | "success";

type ApiEventListener = (type: ApiEventType, message: string) => void;

let _listener: ApiEventListener | null = null;

/**
 * Register the active listener. Pass `null` to unsubscribe.
 * NetworkStatusContext calls this on mount and passes null on unmount.
 */
export function setApiEventListener(fn: ApiEventListener | null): void {
  _listener = fn;
}

/**
 * Broadcast an API lifecycle event to the registered listener.
 * No-op when no listener is registered (e.g. during SSR or before mount).
 */
export function emitApiEvent(type: ApiEventType, message: string): void {
  _listener?.(type, message);
}
