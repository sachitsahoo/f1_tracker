import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import type { Plugin, ViteDevServer } from "vite";
import type { IncomingMessage, ServerResponse } from "node:http";

// ─── Dev-only token plugin ────────────────────────────────────────────────────
//
// When running `npm run dev`, there is no Vercel runtime to serve the
// `api/token.ts` function.  This plugin wires up the same endpoint directly
// inside the Vite dev server using server-side credentials from .env — the
// browser never sees OPENF1_USERNAME or OPENF1_PASSWORD.
//
// When running `vercel dev`, Vercel intercepts /api/token before it ever
// reaches Vite, so this middleware is a no-op in that context.

let devToken: string | null = null;
let devTokenExpiry = 0;
let devTokenInflight: Promise<string | null> | null = null;

async function getDevToken(): Promise<string | null> {
  const { OPENF1_USERNAME, OPENF1_PASSWORD } = process.env;
  if (!OPENF1_USERNAME || !OPENF1_PASSWORD) return null;

  // Cache hit
  if (devToken && Date.now() < devTokenExpiry) return devToken;

  // Deduplicate concurrent callers — same pattern as api/token.ts
  if (devTokenInflight) return devTokenInflight;

  const p: Promise<string | null> = (async () => {
    try {
      const res = await fetch("https://api.openf1.org/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          username: OPENF1_USERNAME,
          password: OPENF1_PASSWORD,
        }),
      });
      if (!res.ok) return null;
      const body = (await res.json()) as { access_token?: string };
      if (!body.access_token) return null;
      devToken = body.access_token;
      devTokenExpiry = Date.now() + 3_500_000; // 3500 s — 100 s safety margin
      return devToken;
    } catch {
      return null;
    }
  })().finally(() => {
    devTokenInflight = null;
  });

  devTokenInflight = p;
  return p;
}

function openf1TokenPlugin(): Plugin {
  return {
    name: "openf1-token-dev",
    apply: "serve", // dev server only — excluded from production build
    configureServer(server: ViteDevServer) {
      server.middlewares.use(
        "/api/token",
        async (_req: IncomingMessage, res: ServerResponse) => {
          const token = await getDevToken();

          if (!token) {
            res.writeHead(503, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({ error: "Auth credentials not configured" }),
            );
            return;
          }

          res.writeHead(200, {
            "Content-Type": "application/json",
            "Cache-Control": "no-store",
          });
          res.end(JSON.stringify({ token }));
        },
      );
    },
  };
}

// ─── /api/openf1/* dev proxy with server-side auth injection ──────────────────
//
// Mirrors the prod handler in api/openf1/[...path].ts: dev fetches a JWT
// from OpenF1 using the same credentials, attaches it to the upstream request,
// and forwards. Browser never sees the JWT in dev either.
//
// Replaces the previous vite proxy that forwarded /api/openf1/** transparently
// to api.openf1.org. That worked for off-session traffic but 401'd as soon as
// OpenF1 entered live-session mode.

function openf1ProxyPlugin(): Plugin {
  return {
    name: "openf1-proxy-dev",
    apply: "serve",
    configureServer(server: ViteDevServer) {
      server.middlewares.use(
        "/api/openf1",
        async (req: IncomingMessage, res: ServerResponse) => {
          if (req.method !== "GET") {
            res.writeHead(405, { Allow: "GET" });
            res.end(JSON.stringify({ error: "Only GET is supported" }));
            return;
          }

          // Re-decode %3E → > and %3C → < so OpenF1 receives the literal
          // comparison operators its date_gt / date_lt params expect.
          const incoming = (req.url ?? "")
            .replace(/%3E/gi, ">")
            .replace(/%3C/gi, "<");
          if (!incoming || incoming === "/") {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Missing OpenF1 path" }));
            return;
          }

          const token = await getDevToken();
          if (!token) {
            res.writeHead(503, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({ error: "Auth credentials not configured" }),
            );
            return;
          }

          // Note: the middleware mount point /api/openf1 means req.url starts
          // AFTER that prefix here (e.g. "/sessions?year=2026"). No stripping needed.
          const upstream = `https://api.openf1.org/v1${incoming}`;

          try {
            const upstreamRes = await fetch(upstream, {
              headers: { Authorization: `Bearer ${token}` },
            });
            const body = await upstreamRes.text();
            res.writeHead(upstreamRes.status, {
              "Content-Type":
                upstreamRes.headers.get("content-type") ?? "application/json",
              "Cache-Control": "no-store",
            });
            res.end(body);
          } catch (err) {
            res.writeHead(502, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                error: "Upstream OpenF1 fetch failed",
                detail: err instanceof Error ? err.message : String(err),
              }),
            );
          }
        },
      );
    },
  };
}

// ─── /api/location-snapshot dev plugin ───────────────────────────────────────
//
// Mirrors api/location-snapshot.ts (the prod Vercel function) so `npm run dev`
// works standalone, without a second terminal running `vercel dev` on :3000.
//
// Historical telemetry is immutable, so we keep an in-memory cache keyed by
// (session_key, date_gt, date_lt). Cache lives for the lifetime of the dev
// server process — fine for development.

const locationSnapshotCache = new Map<string, unknown>();
const LOCATION_SNAPSHOT_CACHE_MAX = 150;

function locationSnapshotPlugin(): Plugin {
  return {
    name: "location-snapshot-dev",
    apply: "serve",
    configureServer(server: ViteDevServer) {
      server.middlewares.use(
        "/api/location-snapshot",
        async (req: IncomingMessage, res: ServerResponse) => {
          if (req.method !== "GET") {
            res.writeHead(405, { Allow: "GET" });
            res.end(JSON.stringify({ error: "Only GET is supported" }));
            return;
          }

          // Parse query off req.url. The mount point trims "/api/location-snapshot"
          // so req.url is like "?session_key=…&date_gt=…&date_lt=…".
          const url = new URL(req.url ?? "", "http://localhost");
          const sessionKeyRaw = url.searchParams.get("session_key");
          const dateGt = url.searchParams.get("date_gt") ?? "";
          const dateLt = url.searchParams.get("date_lt") ?? "";

          const sessionKey = Number(sessionKeyRaw);
          if (!Number.isInteger(sessionKey) || sessionKey <= 0) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                error: "session_key must be a positive integer",
              }),
            );
            return;
          }

          const cacheKey = `${sessionKey}:${dateGt}:${dateLt}`;
          if (locationSnapshotCache.has(cacheKey)) {
            res.writeHead(200, {
              "Content-Type": "application/json",
              "Cache-Control": "public, max-age=86400, immutable",
            });
            res.end(JSON.stringify(locationSnapshotCache.get(cacheKey)));
            return;
          }

          const token = await getDevToken();
          if (!token) {
            res.writeHead(503, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({ error: "Auth credentials not configured" }),
            );
            return;
          }

          // OpenF1 requires literal `date>` / `date<` operators — not percent-encoded.
          let upstreamUrl = `https://api.openf1.org/v1/location?session_key=${sessionKey}`;
          if (dateGt) upstreamUrl += `&date>${dateGt}`;
          if (dateLt) upstreamUrl += `&date<${dateLt}`;

          try {
            const upstreamRes = await fetch(upstreamUrl, {
              headers: { Authorization: `Bearer ${token}` },
            });
            if (!upstreamRes.ok) {
              res.writeHead(502, { "Content-Type": "application/json" });
              res.end(
                JSON.stringify({
                  error: `OpenF1 returned ${upstreamRes.status}`,
                }),
              );
              return;
            }
            const data = (await upstreamRes.json()) as unknown;

            if (locationSnapshotCache.size >= LOCATION_SNAPSHOT_CACHE_MAX) {
              const oldest = locationSnapshotCache.keys().next().value;
              if (oldest !== undefined) locationSnapshotCache.delete(oldest);
            }
            locationSnapshotCache.set(cacheKey, data);

            res.writeHead(200, {
              "Content-Type": "application/json",
              "Cache-Control": "public, max-age=86400, immutable",
            });
            res.end(JSON.stringify(data));
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            res.writeHead(502, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: `Upstream fetch failed: ${msg}` }));
          }
        },
      );
    },
  };
}

// ─── Vite config ──────────────────────────────────────────────────────────────

export default defineConfig(({ mode }) => {
  // Vite only auto-exposes VITE_-prefixed vars to client code; it does NOT
  // populate process.env from .env files. Server-side middleware in this file
  // (openf1TokenPlugin / openf1ProxyPlugin) reads OPENF1_USERNAME/PASSWORD via
  // process.env, so we load every key from .env / .env.local and merge it in.
  // The empty-string prefix tells loadEnv to return all keys, not just VITE_*.
  const env = loadEnv(mode, process.cwd(), "");
  for (const [key, value] of Object.entries(env)) {
    if (process.env[key] === undefined) process.env[key] = value;
  }

  return {
    plugins: [
      react(),
      openf1TokenPlugin(),
      openf1ProxyPlugin(),
      locationSnapshotPlugin(),
    ],
  };
});
