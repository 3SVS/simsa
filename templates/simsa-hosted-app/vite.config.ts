import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 클라이언트만 Vite로. Worker(src/worker.ts)는 wrangler가 번들한다.
export default defineConfig({
  plugins: [react()],
  build: { outDir: "dist/client", emptyOutDir: true },
});
