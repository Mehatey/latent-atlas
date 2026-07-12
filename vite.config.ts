import { defineConfig } from "vite";

export default defineConfig({
  base: "/ai-prototypes/latent-atlas/",
  server: {
    port: 5173, open: true,
    proxy: { "/api": "http://localhost:8080" },
  },
  build: { target: "esnext", assetsInlineLimit: 0 },
  // transformers.js ships large wasm/onnx assets; don't try to inline them
  optimizeDeps: { exclude: ["@huggingface/transformers"] },
});
