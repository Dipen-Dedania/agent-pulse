// gRPC-Web framing helpers for the Antigravity IDE's local language server.
//
// The endpoint uses the `application/grpc-web+json` transport, which wraps
// each message in a 5-byte prefix:
//   byte 0      flags  (0x00 = data, 0x80 = trailer)
//   bytes 1..4  length of payload (big-endian uint32)
//   bytes 5..   payload bytes (JSON for grpc-web+json)
//
// A typical response is two frames back-to-back: a DATA frame with the JSON
// body, then a TRAILER frame carrying `grpc-status: 0\r\n` (and friends).
// We only care about the DATA frame here; the trailer is parsed best-effort
// for error reporting.

export const GRPC_DATA_FLAG = 0x00;
export const GRPC_TRAILER_FLAG = 0x80;

export interface GrpcFrame {
  flag: number;
  payload: Uint8Array;
}

/**
 * Wrap a JSON body in a gRPC-Web DATA frame.
 * For our request, body is always `{}` → returns 7 bytes.
 */
export function encodeJsonRequest(body: object): Uint8Array {
  const json = Buffer.from(JSON.stringify(body), 'utf8');
  const out = Buffer.alloc(5 + json.length);
  out.writeUInt8(GRPC_DATA_FLAG, 0);
  out.writeUInt32BE(json.length, 1);
  json.copy(out, 5);
  return out;
}

/**
 * Decode one or more concatenated gRPC-Web frames. Returns each frame's
 * flag + payload. Tolerates truncation by ignoring incomplete trailing
 * bytes (some servers omit the trailer entirely; we still want the data).
 */
export function decodeFrames(buf: Uint8Array): GrpcFrame[] {
  const frames: GrpcFrame[] = [];
  let offset = 0;
  while (offset + 5 <= buf.length) {
    const flag = buf[offset];
    const length =
      (buf[offset + 1] << 24) |
      (buf[offset + 2] << 16) |
      (buf[offset + 3] << 8) |
      buf[offset + 4];
    const dataStart = offset + 5;
    const dataEnd = dataStart + (length >>> 0);
    if (dataEnd > buf.length) break;
    frames.push({ flag, payload: buf.subarray(dataStart, dataEnd) });
    offset = dataEnd;
  }
  return frames;
}

/**
 * Extract the first DATA frame's JSON body. Returns null when no DATA frame
 * is present or its payload doesn't parse as JSON.
 */
export function extractJsonData(buf: Uint8Array): unknown | null {
  const frames = decodeFrames(buf);
  const data = frames.find((f) => (f.flag & GRPC_TRAILER_FLAG) === 0);
  if (!data) return null;
  try {
    return JSON.parse(Buffer.from(data.payload).toString('utf8'));
  } catch {
    return null;
  }
}

/**
 * Parse a TRAILER frame body (CRLF-separated `key: value` pairs) into a map.
 * Returns an empty object when no trailer is present. Useful for surfacing
 * grpc-status / grpc-message when the server returned a transport-level OK
 * but a logical error.
 */
export function extractTrailers(buf: Uint8Array): Record<string, string> {
  const frames = decodeFrames(buf);
  const trailer = frames.find((f) => (f.flag & GRPC_TRAILER_FLAG) !== 0);
  if (!trailer) return {};
  const text = Buffer.from(trailer.payload).toString('utf8');
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i <= 0) continue;
    const k = line.slice(0, i).trim().toLowerCase();
    const v = line.slice(i + 1).trim();
    if (k) out[k] = v;
  }
  return out;
}
