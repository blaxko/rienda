import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Env: only web/.env* is read (never the repo-root .env, which holds private keys).
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, strictPort: true },
});
