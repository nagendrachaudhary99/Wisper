import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The browser only ever talks to same-origin paths (/v1, /health); vite's dev
// proxy forwards them to the API. Inside the Docker stack the API is the
// "api" compose service - localhost would be the web container itself and the
// dashboard would hang. Set WISPER_API_PROXY_TARGET=http://localhost:3001 only
// when running vite on the host against a host-run API.
const apiProxyTarget = process.env.WISPER_API_PROXY_TARGET ?? "http://api:3001";

export default defineConfig({
  plugins: [react()],
  preview: {
    port: 4173,
    proxy: {
      "/v1": { target: "http://localhost:4123", changeOrigin: true },
      "/health": { target: "http://localhost:4123", changeOrigin: true },
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/v1": { target: apiProxyTarget, changeOrigin: true },
      "/health": { target: apiProxyTarget, changeOrigin: true },
    },
  },
});
