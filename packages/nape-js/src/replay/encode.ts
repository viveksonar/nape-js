/**
 * Binary encoding for {@link Replay} — pairs with {@link decodeReplay}.
 *
 * Format (little-endian unless noted):
 *   - Magic   "RPLY" (4 B, big-endian u32 0x52504C59)
 *   - Version u16
 *   - Frame count u32
 *   - Initial snapshot: length u32, bytes
 *   - Input count u32, then for each input: frame u32, JSON byte-length u32, UTF-8 bytes
 *   - Keyframe count u32, then for each keyframe: frame u32, snapshot length u32, bytes
 *
 * The user payload is encoded as UTF-8 JSON. Binary payloads (e.g. ArrayBuffer)
 * are not supported directly — the user can base64-encode them into strings if
 * needed.
 */

import type { Replay, ReplayKeyframe, ReplayFrameInput } from "./types";
import { REPLAY_VERSION } from "./Recorder";

/** Magic bytes identifying a nape-js replay. */
const REPLAY_MAGIC = 0x52504c59; // "RPLY"

const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();

/** Encode a {@link Replay} into a compact `Uint8Array`. */
export function encodeReplay<T>(replay: Replay<T>): Uint8Array {
  // Pre-encode all input payloads so we can compute the final size up front.
  const encodedInputs: Array<{ frame: number; bytes: Uint8Array }> = [];
  for (const entry of replay.inputs) {
    const json = JSON.stringify(entry.payload);
    encodedInputs.push({
      frame: entry.frame,
      bytes: TEXT_ENCODER.encode(json ?? "null"),
    });
  }

  // Compute total size.
  let size = 4 + 2 + 4 + 4 + replay.initialSnapshot.byteLength; // header + initial
  size += 4; // input count
  for (const e of encodedInputs) size += 4 + 4 + e.bytes.byteLength;
  size += 4; // keyframe count
  for (const k of replay.keyframes) size += 4 + 4 + k.snapshot.byteLength;

  const buf = new ArrayBuffer(size);
  const view = new DataView(buf);
  const u8 = new Uint8Array(buf);
  let pos = 0;

  // Magic — written big-endian so the bytes spell "RPLY" in a hex dump.
  view.setUint32(pos, REPLAY_MAGIC, false);
  pos += 4;
  view.setUint16(pos, replay.version, true);
  pos += 2;
  view.setUint32(pos, replay.frameCount, true);
  pos += 4;

  // Initial snapshot
  view.setUint32(pos, replay.initialSnapshot.byteLength, true);
  pos += 4;
  u8.set(replay.initialSnapshot, pos);
  pos += replay.initialSnapshot.byteLength;

  // Inputs
  view.setUint32(pos, encodedInputs.length, true);
  pos += 4;
  for (const e of encodedInputs) {
    view.setUint32(pos, e.frame, true);
    pos += 4;
    view.setUint32(pos, e.bytes.byteLength, true);
    pos += 4;
    u8.set(e.bytes, pos);
    pos += e.bytes.byteLength;
  }

  // Keyframes
  view.setUint32(pos, replay.keyframes.length, true);
  pos += 4;
  for (const k of replay.keyframes) {
    view.setUint32(pos, k.frame, true);
    pos += 4;
    view.setUint32(pos, k.snapshot.byteLength, true);
    pos += 4;
    u8.set(k.snapshot, pos);
    pos += k.snapshot.byteLength;
  }

  return u8;
}

/** Decode a `Uint8Array` produced by {@link encodeReplay} into a {@link Replay}. */
export function decodeReplay<T = unknown>(bytes: Uint8Array): Replay<T> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let pos = 0;

  const magic = view.getUint32(pos, false);
  pos += 4;
  if (magic !== REPLAY_MAGIC) {
    throw new Error(
      `decodeReplay: invalid magic 0x${magic.toString(16).padStart(8, "0")} (expected 0x${REPLAY_MAGIC.toString(16)})`,
    );
  }
  const version = view.getUint16(pos, true);
  pos += 2;
  if (version !== REPLAY_VERSION) {
    throw new Error(`decodeReplay: unsupported version ${version} (expected ${REPLAY_VERSION})`);
  }
  const frameCount = view.getUint32(pos, true);
  pos += 4;

  // Initial snapshot
  const initLen = view.getUint32(pos, true);
  pos += 4;
  const initialSnapshot = bytes.slice(pos, pos + initLen);
  pos += initLen;

  // Inputs
  const inputCount = view.getUint32(pos, true);
  pos += 4;
  const inputs: ReplayFrameInput<T>[] = new Array(inputCount);
  for (let i = 0; i < inputCount; i++) {
    const frame = view.getUint32(pos, true);
    pos += 4;
    const len = view.getUint32(pos, true);
    pos += 4;
    const json = TEXT_DECODER.decode(bytes.subarray(pos, pos + len));
    pos += len;
    inputs[i] = { frame, payload: JSON.parse(json) as T };
  }

  // Keyframes
  const keyframeCount = view.getUint32(pos, true);
  pos += 4;
  const keyframes: ReplayKeyframe[] = new Array(keyframeCount);
  for (let i = 0; i < keyframeCount; i++) {
    const frame = view.getUint32(pos, true);
    pos += 4;
    const len = view.getUint32(pos, true);
    pos += 4;
    const snapshot = bytes.slice(pos, pos + len);
    pos += len;
    keyframes[i] = { frame, snapshot };
  }

  return {
    version,
    initialSnapshot,
    inputs,
    keyframes,
    frameCount,
  };
}
