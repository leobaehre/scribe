import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

/** Git commit the build comes from, e.g. "83fc47d" or "83fc47d-dirty" (same as src-tauri/build.rs). */
function commit(): string {
  try {
    const hash = execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    const dirty = execSync("git status --porcelain", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    return dirty ? `${hash}-dirty` : hash;
  } catch {
    return "unknown";
  }
}

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  build: { target: "es2021", chunkSizeWarningLimit: 1500 },
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __APP_COMMIT__: JSON.stringify(commit()),
    // `tauri dev` runs Vite in development mode; `tauri build --debug` sets TAURI_ENV_DEBUG.
    __APP_DEBUG__: JSON.stringify(mode === "development" || process.env.TAURI_ENV_DEBUG === "true"),
  },
}));
