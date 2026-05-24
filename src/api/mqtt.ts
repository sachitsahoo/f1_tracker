/**
 * Shared MQTT client for OpenF1 live data.
 *
 * Background
 * ----------
 * OpenF1 sponsor tier exposes live data via two transports:
 *   • REST polling (works for historical data, returns empty for live in 2026)
 *   • MQTT push at wss://mqtt.openf1.org:8084/mqtt (the only working live path)
 *
 * As of the 2025 Dutch GP, OpenF1's REST `/location`, `/position`, `/intervals`,
 * `/laps`, `/stints`, and `/race_control` return empty arrays for any session
 * inside its live window. MQTT push is the only working live source. Each
 * hook that needs live data subscribes to its topic through this module.
 *
 * Design
 * ------
 * One WebSocket per browser tab, reference-counted across topic subscribers.
 * Many hooks subscribing to many topics all share the same connection. The
 * client lazily connects on the first subscribe and stays open until the
 * last subscriber unsubscribes.
 *
 * Each topic can have multiple handlers (e.g. usePositions and the leaderboard
 * preview both want `v1/position`). Messages are JSON-parsed once and dispatched
 * to every registered handler for that topic.
 *
 * Session filtering happens in the hook, not here — the hook knows which
 * sessionKey it cares about, the broker emits messages for all sessions.
 */

import mqtt, { type MqttClient } from "mqtt";

import { getMqttCredentials, hasAuthKey } from "./auth";
import { emitApiEvent } from "../utils/apiEvents";

const BROKER_URL = "wss://mqtt.openf1.org:8084/mqtt";
const CONNECT_TIMEOUT_MS = 10_000;
const RECONNECT_PERIOD_MS = 5_000;

/** Handler invoked with a parsed JSON message body. Shape varies per topic. */
export type MqttMessageHandler<T = unknown> = (msg: T) => void;

// ─── Module-level singletons ─────────────────────────────────────────────────

let client: MqttClient | null = null;
/** Promise of the in-flight `mqtt.connect()` call so concurrent callers share it. */
let connecting: Promise<MqttClient | null> | null = null;
/** Reverse-counted listeners per topic: many hooks → many handlers → one MQTT sub. */
const handlers = new Map<string, Set<MqttMessageHandler>>();

// ─── Internal ────────────────────────────────────────────────────────────────

async function ensureConnected(): Promise<MqttClient | null> {
  if (client && client.connected) return client;
  if (connecting) return connecting;
  if (!hasAuthKey) return null; // token proxy disabled — no auth available

  connecting = (async () => {
    const creds = await getMqttCredentials();
    if (!creds) return null;

    const c = mqtt.connect(BROKER_URL, {
      username: creds.username,
      password: creds.password,
      reconnectPeriod: RECONNECT_PERIOD_MS,
      connectTimeout: CONNECT_TIMEOUT_MS,
    });

    c.on("message", (topic, payload) => {
      const subs = handlers.get(topic);
      if (!subs || subs.size === 0) return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(payload.toString());
      } catch {
        return; // malformed JSON — silently skip
      }
      subs.forEach((h) => {
        try {
          h(parsed);
        } catch {
          // a single failing handler should not break others on the same topic
        }
      });
    });

    c.on("error", (err: Error) => {
      emitApiEvent("network-error", `MQTT error: ${err.message}`);
    });

    c.on("offline", () => {
      emitApiEvent("network-error", "MQTT offline — reconnecting");
    });

    c.on("reconnect", () => {
      // Re-subscribe to all known topics after a reconnect; the broker forgets
      // subscriptions on disconnect.
      for (const topic of handlers.keys()) {
        c.subscribe(topic);
      }
    });

    // Wait for the initial connect before returning the client so callers can
    // assume subscribe() will fire as soon as ensureConnected resolves.
    await new Promise<void>((resolve) => {
      c.once("connect", () => {
        emitApiEvent("success", "");
        resolve();
      });
      // If the connection never completes within the timeout, resolve anyway —
      // the client will keep trying in the background via reconnectPeriod.
      setTimeout(resolve, CONNECT_TIMEOUT_MS);
    });

    client = c;
    return c;
  })().finally(() => {
    connecting = null;
  });

  return connecting;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Subscribe to an MQTT topic. Returns an `unsubscribe` function that, when
 * called, removes this handler from the topic. The MQTT broker subscription
 * is dropped once the last handler unsubscribes.
 *
 * Calling this function multiple times for the same topic only subscribes
 * once with the broker; handlers are stored in a Set per topic and dispatched
 * in parallel on every incoming message.
 */
export function subscribeTopic<T = unknown>(
  topic: string,
  handler: MqttMessageHandler<T>,
): () => void {
  const wrapped = handler as MqttMessageHandler;

  let bucket = handlers.get(topic);
  if (!bucket) {
    bucket = new Set();
    handlers.set(topic, bucket);
  }
  bucket.add(wrapped);

  // Wire up the broker subscription on first handler. Re-subscribes are
  // idempotent (mqtt.js doesn't double-deliver) so it's safe even if a
  // race lets two handlers add for the same topic before the broker SUB
  // round-trips.
  void ensureConnected().then((c) => {
    if (c && handlers.get(topic)?.has(wrapped)) {
      c.subscribe(topic);
    }
  });

  return () => {
    const set = handlers.get(topic);
    if (!set) return;
    set.delete(wrapped);
    if (set.size === 0) {
      handlers.delete(topic);
      client?.unsubscribe(topic);
    }
  };
}

/**
 * Returns true when the client is currently connected to the broker.
 * Hooks can use this to decide whether MQTT is covering their data and
 * REST polling can stand down.
 */
export function isMqttConnected(): boolean {
  return !!client && client.connected;
}
