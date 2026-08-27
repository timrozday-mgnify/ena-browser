import { defineConfig } from "vite";

// Two library builds from one entry:
//   default  → ESM, handsontable left external (peer dep, avoids two copies)
//   --mode iife → self-contained bundle for <script src> consumers
export default defineConfig(({ mode }) => {
  const iife = mode === "iife";
  return {
    build: {
      emptyOutDir: !iife,
      sourcemap: true,
      lib: {
        entry: "src/index.ts",
        name: "EnaBrowser",
        formats: iife ? (["iife"] as const) : (["es"] as const),
        fileName: () => (iife ? "ena-browser.iife.js" : "ena-browser.js"),
        cssFileName: "ena-browser",
      },
      rollupOptions: iife ? {} : { external: ["handsontable", /^handsontable\//] },
    },
    test: {
      environment: "jsdom",
      globals: true,
      include: ["tests/unit/**/*.test.ts"],
    },
  };
});
