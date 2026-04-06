import type { VercelRequest, VercelResponse } from "@vercel/node";

// ─── Module-level token cache (persists across warm invocations) ──────────────

let cachedToken: string | null = null;
let tokenExpiresAt = 0; // Date.now() + 3500 * 1000

// ─── IP rate limiting ─────────────────────────────────────────────────────────

interface IpRecord {
  count: number;
  windowStart: number;
}

const ipLog = new Map<string, IpRecord>();
const RATE_MAX = 10;
const RATE_WINDOW_MS = 60_000;

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const rec = ipLog.get(ip);

  if (!rec || now - rec.windowStart > RATE_WINDOW_MS) {
    ipLog.set(ip, { count: 1, windowStart: now });
    return false;
  }

  rec.count += 1;
  return rec.count > RATE_MAX;
}

function clientIp(req: VercelRequest): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") return forwarded.split(",")[0].trim();
  return req.socket?.remoteAddress ?? "unknown";
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

  const ip = clientIp(req);
  if (isRateLimited(ip)) {
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
