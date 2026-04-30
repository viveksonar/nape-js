/**
 * Minimal text-encoding declarations for the replay sub-package.
 *
 * The main nape-js library deliberately excludes "dom" from `lib` to enforce
 * zero DOM dependencies. `TextEncoder` / `TextDecoder` are universally
 * available in Node ≥ 11 and every modern browser; we declare just the
 * narrow surface we use.
 */

declare class TextEncoder {
  encode(input?: string): Uint8Array;
}

declare class TextDecoder {
  constructor(label?: string, options?: { fatal?: boolean; ignoreBOM?: boolean });
  decode(input?: ArrayBuffer | ArrayBufferView): string;
}
