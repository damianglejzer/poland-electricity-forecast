import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
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
