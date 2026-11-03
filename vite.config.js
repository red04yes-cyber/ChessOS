import { defineConfig } from "vite";

export default defineConfig({
  // Tauri serves the production frontend from its app URL, not a web server root.
  // Relative asset paths keep JS/CSS loading correctly in the packaged WebView.
  base: "./",
  clearScreen: false,
  server: {
    host: "127.0.0.1",
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
});
