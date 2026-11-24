/// <reference types="vitest" />
/**
 * SPDX-License-Identifier: MIT
 * The dashboard is a static SPA: vite build emits dist/ and nothing runs server-side.
 */
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, host: true },
  preview: { port: 4173, host: true },
  build: { outDir: "dist", sourcemap: true, target: "es2022" },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
