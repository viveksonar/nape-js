#!/usr/bin/env node
import { scaffold } from "../src/scaffold.mjs";
import { promptName, promptChoice } from "../src/prompt.mjs";

const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const flags = Object.fromEntries(
  process.argv
    .slice(2)
    .filter((a) => a.startsWith("--"))
    .map((a) => {
      const eq = a.indexOf("=");
      if (eq > 0) return [a.slice(2, eq), a.slice(eq + 1)];
      return [a.slice(2), true];
    }),
);

const TEMPLATES = ["platformer"];
const RENDERERS = ["canvas2d", "threejs", "pixi"];

if (flags.help || flags.h) {
  console.log(`Usage: npm create nape-game@latest [project-name] [options]

Scaffolds a new game project using @newkrok/nape-js.

Options:
  --template <name>    one of: ${TEMPLATES.join(", ")} (default: platformer)
  --renderer <name>    one of: ${RENDERERS.join(", ")} (default: canvas2d)
  --help               show this help`);
  process.exit(0);
}

let projectName = args[0];
let template = flags.template;
let renderer = flags.renderer;

if (!projectName) {
  projectName = await promptName("Project name?", "my-game");
}
if (!template) {
  template =
    TEMPLATES.length === 1
      ? TEMPLATES[0]
      : await promptChoice("Template?", TEMPLATES, "platformer");
}
if (!renderer) {
  renderer = await promptChoice("Renderer?", RENDERERS, "canvas2d");
}

if (!TEMPLATES.includes(template)) {
  console.error(`Error: unknown template "${template}". Valid: ${TEMPLATES.join(", ")}`);
  process.exit(1);
}
if (!RENDERERS.includes(renderer)) {
  console.error(`Error: unknown renderer "${renderer}". Valid: ${RENDERERS.join(", ")}`);
  process.exit(1);
}

try {
  const targetDir = await scaffold({ projectName, template, renderer });
  const cdHint = targetDir === process.cwd() ? "" : `cd ${projectName}\n  `;
  console.log(`
✓ Created ${projectName} (template: ${template}, renderer: ${renderer})

Next steps:
  ${cdHint}npm install
  npm run dev

Happy hacking!`);
} catch (err) {
  console.error(`✗ ${err.message}`);
  process.exit(1);
}
