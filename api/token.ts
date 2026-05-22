import type { VercelRequest, VercelResponse } from "@vercel/node";
import { checkRateLimit, clientIp } from "../lib/shared.js";

// ─── Module-level token cache (persists across warm invocations) ──────────────

let cachedToken: string | null = null;
let tokenExpiresAt = 0; // Date.now() + 3500 * 1000

// ─── Origin allowlist ────────────────────────────────────────────────────────
//
// The OpenF1 read path no longer needs /api/token (proxied server-side via
// api/openf1-proxy.ts). The remaining caller is the browser MQTT client in
// src/hooks/useLocationStream.ts, which authenticates directly to OpenF1's
// MQTT broker using the JWT as the password. That browser-direct flow can't
// be eliminated without standing up a long-lived WebSocket relay, so we keep
// /api/token and gate it by Origin/Referer instead.
//
// This is NOT cryptographic protection — `curl -H "Origin: …"` defeats it.
// What it does buy: casual scrapers, automated bots, and one-line scripts
// like `curl https://.../api/token` all fail. An attacker willing to spoof
// the header is on the same level as one with a stolen JWT — at which point
// OpenF1's own rate limits (6 req/s, 60 req/min) are the real cap.

const ALLOWED_ORIGIN_EXACT = [
  "https://f1-live-tracker.vercel.app",
  "http://localhost:5173", // `npm run dev`
  "http://localhost:3000", // `vercel dev`
];

/** Allow this scope's preview deploys: *-sachitsahoos-projects.vercel.app */
const ALLOWED_ORIGIN_SUFFIX = "-sachitsahoos-projects.vercel.app";

function isAllowedOrigin(originOrReferer: string | undefined): boolean {
  if (!originOrReferer) return false;
  let host: string;
  try {
    // Referer is a full URL; Origin is just scheme://host. URL() handles both.
    host = new URL(originOrReferer).origin;
  } catch {
    return false;
  }
  if (ALLOWED_ORIGIN_EXACT.includes(host)) return true;
  if (host.endsWith(ALLOWED_ORIGIN_SUFFIX)) return true;
  return false;
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  res.setHeader("Cache-Control", "no-store");

  // Reject calls that aren't coming from a browser on our own pages.
  // `Origin` is sent by every modern browser fetch; `Referer` is the fallback.
  const origin =
    (typeof req.headers.origin === "string" ? req.headers.origin : undefined) ??
    (typeof req.headers.referer === "string" ? req.headers.referer : undefined);
  if (!isAllowedOrigin(origin)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  if (checkRateLimit(clientIp(req), "token")) {
    res.status(429).json({ error: "Too many requests" });
    return;
  }

  const { OPENF1_USERNAME, OPENF1_PASSWORD } = process.env;
  if (!OPENF1_USERNAME || !OPENF1_PASSWORD) {
    res.status(503).json({ error: "Auth credentials not configured" });
    return;
  }

  // Return cached token if still valid
  if (cachedToken && Date.now() < tokenExpiresAt) {
    res.status(200).json({ token: cachedToken });
    return;
  }

  // Fetch a fresh token from OpenF1
  const upstream = await fetch("https://api.openf1.org/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      username: OPENF1_USERNAME,
      password: OPENF1_PASSWORD,
    }),
  });

  if (!upstream.ok) {
    res
      .status(502)
      .json({ error: `OpenF1 token endpoint returned ${upstream.status}` });
    return;
  }

  const body = (await upstream.json()) as { access_token?: string };
  if (!body.access_token) {
    res.status(502).json({ error: "OpenF1 did not return an access_token" });
    return;
  }

  cachedToken = body.access_token;
  tokenExpiresAt = Date.now() + 3_500_000; // 3500 s — 100 s safety margin

  res.status(200).json({ token: cachedToken });
}
