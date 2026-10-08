import { defineConfig } from "vite";
export default defineConfig({ server: { proxy: { "/api": "http://localhost:4000", "/health": "http://localhost:4000" } } });
