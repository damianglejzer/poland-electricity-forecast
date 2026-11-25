import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  // Shown in the sidebar, so it's always clear which build a browser is running.
  define: { __BUILD_TIME__: JSON.stringify(new Date().toISOString()) },
  server: { proxy: { "/api": "http://localhost:8000" } },
  build: {
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        manualChunks: {
          echarts: [
            "echarts/core",
            "echarts/charts",
            "echarts/components",
            "echarts/renderers",
            "echarts-for-react/lib/core",
          ],
        },
      },
    },
  },
});
