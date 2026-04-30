import { defineConfig } from "tsup";
import pkg from "./package.json";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/serialization/index.ts",
    "src/replay/index.ts",
    "src/worker/index.ts",
    "src/profiler/index.ts",
  ],
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  minify: true,
  splitting: true,
  treeshake: true,
  target: "es2020",
  define: {
    __PACKAGE_VERSION__: JSON.stringify(pkg.version),
  },
});
