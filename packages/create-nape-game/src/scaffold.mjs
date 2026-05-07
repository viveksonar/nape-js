import { cp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve, basename } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PKG_ROOT = resolve(__dirname, "..");

// Renderer-specific main.js import line, plus extra package.json deps.
const RENDERER_CONFIG = {
  canvas2d: {
    importLine: 'import { Canvas2DRenderer as Renderer } from "./render/canvas2d.js";',
    extraDeps: {},
    keepFiles: ["src/render/canvas2d.js"],
  },
  threejs: {
    importLine: 'import { ThreeJsRenderer as Renderer } from "./render/threejs.js";',
    extraDeps: { three: "^0.170.0" },
    keepFiles: ["src/render/threejs.js"],
  },
  pixi: {
    importLine: 'import { PixiRenderer as Renderer } from "./render/pixi.js";',
    extraDeps: { "pixi.js": "^8.5.0" },
    keepFiles: ["src/render/pixi.js"],
  },
};

const ALL_RENDERER_FILES = [
  "src/render/canvas2d.js",
  "src/render/threejs.js",
  "src/render/pixi.js",
];

const isValidNpmName = (name) =>
  /^(@[a-z0-9-_]+\/)?[a-z0-9][a-z0-9-_]*$/.test(name) && name.length <= 214;

/**
 * Scaffold a new project from `templates/<template>` into `<cwd>/<projectName>`.
 * Returns the absolute path to the created directory.
 */
export async function scaffold({ projectName, template, renderer }) {
  if (!isValidNpmName(projectName)) {
    throw new Error(
      `"${projectName}" is not a valid npm package name (lowercase letters, digits, '-', '_' allowed; cannot start with '_' or '-').`,
    );
  }
  const config = RENDERER_CONFIG[renderer];
  if (!config) throw new Error(`Unknown renderer: ${renderer}`);

  const srcDir = resolve(PKG_ROOT, "templates", template);
  try {
    await stat(srcDir);
  } catch {
    throw new Error(
      `Template "${template}" not found at ${srcDir}. (Did the prepublishOnly hook run?)`,
    );
  }

  const targetDir = resolve(process.cwd(), projectName);
  try {
    const entries = await readdir(targetDir);
    if (entries.length > 0) {
      throw new Error(`Target directory "${projectName}" exists and is not empty. Aborting.`);
    }
  } catch (err) {
    if (err.code !== "ENOENT" && err.code !== "ENOTDIR") {
      // Non-empty or unreadable — bail out.
      if (!err.message.startsWith("Target directory")) throw err;
      throw err;
    }
    // ENOENT = directory doesn't exist yet, good.
  }

  await cp(srcDir, targetDir, {
    recursive: true,
    filter: (p) => !/\bnode_modules\b|\bdist\b|\.vite\b/.test(p),
  });

  // 1. Strip the renderer files we don't need
  for (const f of ALL_RENDERER_FILES) {
    if (!config.keepFiles.includes(f)) {
      await rm(resolve(targetDir, f), { force: true });
    }
  }

  // 2. Patch main.js: replace the canvas2d import line with the chosen renderer
  await patchFile(resolve(targetDir, "src/main.js"), (text) =>
    text.replace(
      /import\s*\{\s*Canvas2DRenderer\s+as\s+Renderer\s*\}\s+from\s+["']\.\/render\/canvas2d\.js["'];?/,
      config.importLine,
    ),
  );

  // 3. Patch package.json: project name + renderer-specific deps
  await patchFile(resolve(targetDir, "package.json"), (text) => {
    const pkg = JSON.parse(text);
    pkg.name = projectName;
    pkg.dependencies = { ...pkg.dependencies, ...config.extraDeps };
    return JSON.stringify(pkg, null, 2) + "\n";
  });

  // 4. Patch index.html: <title> placeholder
  await patchFile(resolve(targetDir, "index.html"), (text) =>
    text.replace(/<title>[^<]*<\/title>/, `<title>${projectName}</title>`),
  );

  return targetDir;
}

async function patchFile(path, fn) {
  const text = await readFile(path, "utf8");
  const next = fn(text);
  if (next !== text) await writeFile(path, next, "utf8");
}
