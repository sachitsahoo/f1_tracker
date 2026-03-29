import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Load .env so the token is available here in Node context (not just the browser bundle)
  const env = loadEnv(mode, process.cwd(), "");

  return {
    plugins: [react()],
    server: {
      proxy: {
        // All requests to /api/openf1/** are forwarded to https://api.openf1.org/v1/**
        // The Authorization header is injected here (Node → server, no CORS preflight).
        "/api/openf1": {
          target: "https://api.openf1.org",
          changeOrigin: true,
          // Rewrite path only — query string (including date> / date< filters)
          // is forwarded verbatim by http-proxy.
          rewrite: (path) => path.replace(/^\/api\/openf1/, "/v1"),
          // Re-decode %3E → > and %3C → < in the outgoing URL so OpenF1
          // receives the literal comparison operators it expects.
          // This is a safety net; our fetch calls already send literal > / <
          // via string concatenation, but proxies can re-encode them.
          configure: (proxy) => {
            proxy.on("proxyReq", (proxyReq) => {
              const raw = proxyReq.path;
              const fixed = raw.replace(/%3E/gi, ">").replace(/%3C/gi, "<");
              if (fixed !== raw) proxyReq.path = fixed;
            });
          },
          ...(env.VITE_OPENF1_API_KEY
            ? {
                headers: { Authorization: `Bearer ${env.VITE_OPENF1_API_KEY}` },
              }
            : {}),
        },
      },
    },
  };
});
