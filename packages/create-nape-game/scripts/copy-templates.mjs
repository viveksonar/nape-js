#!/usr/bin/env node
/**
 * Copies the repo's `templates/` directory into the create-nape-game
 * package so it ships with `npm publish`. Runs as both `prepare` (so
 * local `npm install` populates it) and `prepublishOnly` (so CI publishes
 * a complete tarball).
 *
 * Skips silently when the source directory is missing — the package was
 * installed from npm and already contains its own copy.
 */
import { cp, rm, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const pkgRoot = resolve(__dirname, "..");
const repoRoot = resolve(pkgRoot, "..", "..");
const src = resolve(repoRoot, "templates");
const dst = resolve(pkgRoot, "templates");

try {
  await stat(src);
} catch {
  // Source missing — we're inside an installed npm tarball, nothing to do.
  process.exit(0);
}

await rm(dst, { recursive: true, force: true });
await cp(src, dst, {
  recursive: true,
  filter: (p) => !/\bnode_modules\b|\bdist\b|\.vite\b|package-lock\.json$|\.DS_Store$/.test(p),
});
console.log(`copy-templates: ${src} -> ${dst}`);
