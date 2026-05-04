import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";

/**
 * Minimal interactive prompts using only Node built-ins. No external deps.
 */

export async function promptName(question, defaultValue) {
  const rl = readline.createInterface({ input: stdin, output: stdout });
  try {
    const answer = (await rl.question(`? ${question} (${defaultValue}) `)).trim();
    return answer || defaultValue;
  } finally {
    rl.close();
  }
}

export async function promptChoice(question, options, defaultValue) {
  const list = options
    .map((o, i) => `${i + 1}) ${o}${o === defaultValue ? " ← default" : ""}`)
    .join("\n  ");
  const rl = readline.createInterface({ input: stdin, output: stdout });
  try {
    while (true) {
      const answer = (await rl.question(`? ${question}\n  ${list}\n  > `)).trim();
      if (!answer) return defaultValue;
      const asIndex = Number(answer) - 1;
      if (Number.isInteger(asIndex) && asIndex >= 0 && asIndex < options.length) {
        return options[asIndex];
      }
      if (options.includes(answer)) return answer;
      console.log(`  invalid: pick a number 1–${options.length} or one of ${options.join(", ")}`);
    }
  } finally {
    rl.close();
  }
}
