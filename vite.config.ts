import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
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
        // This is a safety net; our fetch calls already send literal > / <
        // via string concatenation, but proxies can re-encode them.
        configure: (proxy) => {
          proxy.on("proxyReq", (proxyReq) => {
            const raw = proxyReq.path;
            const fixed = raw.replace(/%3E/gi, ">").replace(/%3C/gi, "<");
            if (fixed !== raw) proxyReq.path = fixed;
          });
        },
      },
      // Forward /api/token to the local Vercel dev server when running `vercel dev`.
      // Not needed when running plain `npm run dev` (unauthenticated free tier).
      "/api/token": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
    },
  },
});
