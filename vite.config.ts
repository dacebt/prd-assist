import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: "src/web",
  build: {
    outDir: "../../dist/web",
  },
  plugins: [react()],
  server: {
    proxy: {
      "/api": "http://127.0.0.1:5174",
    },
  },
});
