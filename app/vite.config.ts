import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const PROXY_TARGET = process.env.AIRSHOW_SERVER ?? "http://localhost:8787";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: PROXY_TARGET,
        changeOrigin: true,
      },
    },
  },
});
