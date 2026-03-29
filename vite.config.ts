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
          rewrite: (path) => path.replace(/^\/api\/openf1/, "/v1"),
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
