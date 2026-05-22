/**
 * Server-side proxy to OpenF1.
 *
 * Replaces the prior `vercel.json` rewrite which forwarded /api/openf1/* to
 * https://api.openf1.org/v1/* transparently. Under that design the browser
 * had to attach the Authorization header itself, which meant /api/token had
 * to be a public endpoint anyone could hit — exposing the project's OpenF1
 * JWT (and therefore its sponsor-tier quota) to scrapers.
 *
 * This handler keeps the JWT entirely server-side:
 *
 *   1. Browser calls /api/openf1/sessions?year=2026  (no auth needed)
 *   2. This function fetches/caches a JWT from OpenF1 using OPENF1_USERNAME /
 *      OPENF1_PASSWORD (env vars, never exposed to the client).
 *   3. It re-issues the GET to https://api.openf1.org/v1/<path><query> with the
 *      Authorization header attached.
 *   4. The response body and Content-Type are streamed back to the browser.
 *
 * Rate limiting: enforced per client IP using the shared "data" tier (120
 * req/min). Token endpoint isn't directly callable any more, so the prior
 * /api/token rate limiter no longer matters for OpenF1 traffic.
 *
 * Only GET is supported — OpenF1 is read-only for the use case here.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { checkRateLimit, clientIp } from "../lib/shared.js";

const OPENF1_BASE = "https://api.openf1.org/v1";
const OPENF1_TOKEN_URL = "https://api.openf1.org/token";

// ─── Token cache (per function instance) ─────────────────────────────────────

let cachedToken: string | null = null;
let tokenExpiresAt = 0;
let tokenInflight: Promise<string | null> | null = null;

async function fetchFreshToken(): Promise<string | null> {
  const { OPENF1_USERNAME, OPENF1_PASSWORD } = process.env;
  if (!OPENF1_USERNAME || !OPENF1_PASSWORD) return null;

  const res = await fetch(OPENF1_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      username: OPENF1_USERNAME,
      password: OPENF1_PASSWORD,
    }),
  });
  if (!res.ok) return null;
  const body = (await res.json()) as { access_token?: string };
  return body.access_token ?? null;
}

async function getToken(): Promise<string | null> {
  if (cachedToken && Date.now() < tokenExpiresAt) return cachedToken;
  if (tokenInflight) return tokenInflight;

  tokenInflight = fetchFreshToken()
    .then((tok) => {
      if (tok) {
        cachedToken = tok;
        tokenExpiresAt = Date.now() + 3_500_000; // 100s safety margin
      }
      return tok;
    })
    .finally(() => {
      tokenInflight = null;
    });

  return tokenInflight;
}

function invalidateToken(): void {
  cachedToken = null;
  tokenExpiresAt = 0;
}

// ─── Handler ─────────────────────────────────────────────────────────────────

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res.status(405).json({ error: "Only GET is supported" });
    return;
  }

  if (checkRateLimit(clientIp(req), "data")) {
    res.status(429).json({ error: "Too many requests" });
    return;
  }

  // ── Build upstream URL ─────────────────────────────────────────────────────
  // Wired via the vercel.json rewrite:
  //   /api/openf1/:path*  →  /api/openf1-proxy?path=:path*
  // After the rewrite this handler sees req.query.path = the OpenF1 path
  // segments (joined by /) and all OTHER query params (year, session_key,
  // date_gt, …) preserved alongside.
  const pathParam = req.query["path"];
  const pathStr = Array.isArray(pathParam) ? pathParam.join("/") : pathParam;
  if (typeof pathStr !== "string" || pathStr.length === 0) {
    res.status(400).json({ error: "Missing OpenF1 path" });
    return;
  }

  // Rebuild the query string for OpenF1 from every param except "path".
  // OpenF1 expects literal > and < (not URL-encoded) in date_gt / date_lt.
  const upstreamQuery = new URLSearchParams();
  for (const [k, v] of Object.entries(req.query)) {
    if (k === "path") continue;
    if (typeof v === "string") upstreamQuery.append(k, v);
    else if (Array.isArray(v)) for (const s of v) upstreamQuery.append(k, s);
  }
  const qs = upstreamQuery
    .toString()
    .replace(/%3E/gi, ">")
    .replace(/%3C/gi, "<");
  const upstream = `${OPENF1_BASE}/${pathStr}${qs ? `?${qs}` : ""}`;

  // ── Auth ───────────────────────────────────────────────────────────────────
  let token = await getToken();
  if (!token) {
    res.status(503).json({ error: "OpenF1 auth not configured" });
    return;
  }

  // ── Forward + handle 401 with one refresh-retry ────────────────────────────
  let upstreamRes = await fetch(upstream, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (upstreamRes.status === 401) {
    invalidateToken();
    token = await getToken();
    if (!token) {
      res.status(503).json({ error: "OpenF1 auth refresh failed" });
      return;
    }
    upstreamRes = await fetch(upstream, {
      headers: { Authorization: `Bearer ${token}` },
    });
  }

  // ── Return ─────────────────────────────────────────────────────────────────
  const contentType =
    upstreamRes.headers.get("content-type") ?? "application/json";
  res.setHeader("Content-Type", contentType);
  res.setHeader("Cache-Control", "no-store");
  res.status(upstreamRes.status);

  const body = await upstreamRes.text();
  res.send(body);
}
