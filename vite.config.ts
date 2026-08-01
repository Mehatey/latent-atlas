import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  base: process.env.GITHUB_ACTIONS ? "/latent-atlas/" : "/ai-prototypes/latent-atlas/",
  plugins: [{
    name: "serve-usdz-with-ar-mime",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (request.url?.split("?")[0].endsWith(".usdz")) {
          response.setHeader("Content-Type", "model/vnd.usdz+zip");
        }
        next();
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use((request, response, next) => {
        if (request.url?.split("?")[0].endsWith(".usdz")) {
          response.setHeader("Content-Type", "model/vnd.usdz+zip");
        }
        next();
      });
    },
  }],
  server: {
    port: 5173, open: true,
    proxy: { "/api": "http://localhost:8080" },
  },
  build: {
    target: "esnext",
    assetsInlineLimit: 0,
    rollupOptions: {
      input: {
        atlas: resolve(__dirname, "index.html"),
        ar: resolve(__dirname, "ar.html"),
      },
    },
  },
  // transformers.js ships large wasm/onnx assets; don't try to inline them
  optimizeDeps: { exclude: ["@huggingface/transformers"] },
});
