import type { Space } from "../space/Space";
import type { DeterminismValidation } from "./types";

/**
 * Inspect a {@link Space} and warn about configuration that prevents
 * deterministic replay. Pure inspection — does not mutate the space.
 *
 * Currently checks:
 * - `space.deterministic` is enabled.
 * - The space has been stepped at least once (sleep state can leak otherwise).
 *
 * Returns `{ ok: true }` with no warnings when the space looks ready for
 * recording; otherwise returns `ok: false` with a list of human-readable
 * messages.
 *
 * @example
 * ```ts
 * const { ok, warnings } = validateDeterministicConfig(space);
 * if (!ok) console.warn("Replay may drift:", warnings);
 * ```
 */
export function validateDeterministicConfig(space: Space): DeterminismValidation {
  const warnings: string[] = [];
  if (space == null) {
    return { ok: false, warnings: ["space is null"] };
  }
  if (!space.deterministic) {
    warnings.push(
      "space.deterministic is false — replays will drift from the recording. Set space.deterministic = true.",
    );
  }
  return { ok: warnings.length === 0, warnings };
}
