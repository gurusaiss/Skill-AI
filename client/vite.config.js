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
        // A function (not the object form) so shared helpers land with the library
        // that every route needs. With the object form Rollup parked react/jsx-runtime
        // and the CJS interop helper inside the framer-motion chunk, so the 115 kB motion
        // chunk was statically imported by the ENTRY and loaded on every page.
        manualChunks(id) {
          const p = id.split('\\').join('/');
          if (p.includes('commonjsHelpers') || /node_modules\/(react|react-dom|react-router|react-router-dom|scheduler|@remix-run\/router)\//.test(p)) return 'react';
          if (/node_modules\/(recharts|recharts-scale|victory-vendor|d3-[a-z-]+|decimal\.js-light|react-smooth|react-transition-group|fast-equals)\//.test(p)) return 'charts';
          if (/node_modules\/(framer-motion|motion-dom|motion-utils)\//.test(p)) return 'motion';
          return undefined;
        },
      },
    },
  },
});
