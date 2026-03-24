import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

/** Convex HTTP URL for dev; E2E sets this to the isolated backend (see scripts/test-e2e.sh). */
const convexUrl = process.env.VITE_CONVEX_URL ?? "http://localhost:3210";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  server: {
    proxy: {
      "/api/storage": {
        target: convexUrl,
        changeOrigin: true,
      },
    },
    watch: {
      ignored: ["**/.claude/**", "**/.git/**"],
    },
  },
});
