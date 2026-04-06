import { defineConfig } from "vite";
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

// ─── Vite config ──────────────────────────────────────────────────────────────

export default defineConfig({
  plugins: [react(), openf1TokenPlugin()],
  server: {
    proxy: {
      // All requests to /api/openf1/** are forwarded to https://api.openf1.org/v1/**
      // The browser sends the Authorization header directly — no server-side injection.
      "/api/openf1": {
        target: "https://api.openf1.org",
        changeOrigin: true,
        // Rewrite path only — query string (including date> / date< filters)
        // is forwarded verbatim by http-proxy.
        rewrite: (path) => path.replace(/^\/api\/openf1/, "/v1"),
        // Re-decode %3E → > and %3C → < in the outgoing URL so OpenF1
        // receives the literal comparison operators it expects.
        configure: (proxy) => {
          proxy.on("proxyReq", (proxyReq) => {
            const raw = proxyReq.path;
            const fixed = raw.replace(/%3E/gi, ">").replace(/%3C/gi, "<");
            if (fixed !== raw) proxyReq.path = fixed;
          });
        },
      },
      // /api/token is handled by the openf1TokenPlugin middleware above when
      // running `npm run dev`.  This proxy entry is kept as a fallback for
      // `vercel dev`, which serves the route from api/token.ts instead.
      "/api/token": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
    },
  },
});
