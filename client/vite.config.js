import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        // Split heavy, infrequently-changing vendor libs into their own
        // cacheable chunks instead of one shared vendor blob — added
        // proactively (current chunks are already reasonably sized since
        // jsPDF is lazy-imported and xlsx/html2canvas aren't in the client
        // bundle) so this doesn't regress as more heavy libs get added.
        manualChunks: {
          react: ["react", "react-dom", "react-router-dom"],
          charts: ["recharts"],
          motion: ["framer-motion"],
        },
      },
    },
  },
});
