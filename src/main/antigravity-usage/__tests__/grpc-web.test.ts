import { describe, it, expect } from 'vitest';
import {
  encodeJsonRequest,
  decodeFrames,
  extractJsonData,
  extractTrailers,
  GRPC_DATA_FLAG,
  GRPC_TRAILER_FLAG,
} from '../grpc-web';

function frame(flag: number, payload: string): Uint8Array {
  const body = Buffer.from(payload, 'utf8');
  const out = Buffer.alloc(5 + body.length);
  out.writeUInt8(flag, 0);
  out.writeUInt32BE(body.length, 1);
  body.copy(out, 5);
  return out;
}

describe('encodeJsonRequest', () => {
  it('wraps {} into the canonical 7-byte frame', () => {
    const out = encodeJsonRequest({});
    expect(Array.from(out)).toEqual([0x00, 0x00, 0x00, 0x00, 0x02, 0x7b, 0x7d]);
  });

  it('big-endian length for >255 byte payloads', () => {
    const body = 'x'.repeat(300);
    const out = encodeJsonRequest({ x: body });
    expect(out[0]).toBe(0x00);
    const length = (out[1] << 24) | (out[2] << 16) | (out[3] << 8) | out[4];
    expect(length).toBe(out.length - 5);
  });
});

describe('decodeFrames', () => {
  it('decodes a single DATA frame', () => {
    const f = frame(GRPC_DATA_FLAG, '{"a":1}');
    const frames = decodeFrames(f);
    expect(frames).toHaveLength(1);
    expect(frames[0].flag).toBe(GRPC_DATA_FLAG);
    expect(Buffer.from(frames[0].payload).toString()).toBe('{"a":1}');
  });

  it('decodes DATA + TRAILER concatenated', () => {
    const combined = Buffer.concat([
      frame(GRPC_DATA_FLAG, '{"ok":true}'),
      frame(GRPC_TRAILER_FLAG, 'grpc-status:0\r\n'),
    ]);
    const frames = decodeFrames(combined);
    expect(frames).toHaveLength(2);
    expect(frames[0].flag).toBe(GRPC_DATA_FLAG);
    expect(frames[1].flag).toBe(GRPC_TRAILER_FLAG);
  });

  it('ignores trailing truncated frame', () => {
    const good = frame(GRPC_DATA_FLAG, '{}');
    const truncated = Buffer.from([0x00, 0x00, 0x00, 0x00]); // only 4 of 5 header bytes
    const frames = decodeFrames(Buffer.concat([good, truncated]));
    expect(frames).toHaveLength(1);
  });

  it('ignores frame whose length runs past the buffer end', () => {
    const partial = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x10, 0x7b]); // claims 16 bytes, gives 1
    expect(decodeFrames(partial)).toEqual([]);
  });
});

describe('extractJsonData', () => {
  it('returns the DATA frame body parsed as JSON', () => {
    const buf = Buffer.concat([
      frame(GRPC_DATA_FLAG, JSON.stringify({ response: { models: {} } })),
      frame(GRPC_TRAILER_FLAG, 'grpc-status:0\r\n'),
    ]);
    expect(extractJsonData(buf)).toEqual({ response: { models: {} } });
  });

  it('returns null when only a trailer frame is present', () => {
    const buf = frame(GRPC_TRAILER_FLAG, 'grpc-status:0\r\n');
    expect(extractJsonData(buf)).toBeNull();
  });

  it('returns null when the data payload is not valid JSON', () => {
    const buf = frame(GRPC_DATA_FLAG, 'not-json');
    expect(extractJsonData(buf)).toBeNull();
  });

  it('returns null on empty input', () => {
    expect(extractJsonData(new Uint8Array(0))).toBeNull();
  });
});

describe('extractTrailers', () => {
  it('parses key:value pairs into a lowercased map', () => {
    const buf = frame(GRPC_TRAILER_FLAG, 'grpc-status:0\r\nGrpc-Message:ok\r\n');
    expect(extractTrailers(buf)).toEqual({ 'grpc-status': '0', 'grpc-message': 'ok' });
  });

  it('returns {} when no trailer is present', () => {
    expect(extractTrailers(frame(GRPC_DATA_FLAG, '{}'))).toEqual({});
  });
});
