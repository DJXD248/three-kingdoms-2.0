// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  createFragmentState,
  decodeFrames,
  encodeFrame,
  normalizeRoomCode,
  webSocketAccept,
} from './net-relay.mjs';

const TEXT = 0x1;
const CLOSE = 0x8;

/** 客户端帧必须带掩码：手工造一帧，顺便当解码器的反向证人（长度三段编码与传话程序同口径）。 */
function maskedFrame(payload, opts = {}) {
  const body = Buffer.from(payload, 'utf8');
  const mask = Buffer.from([0xaa, 0xbb, 0xcc, 0xdd]);
  const len = body.length;
  const lenBytes = len <= 125 ? 0 : len <= 65535 ? 2 : 8;
  const head = Buffer.alloc(2 + lenBytes + 4);
  head[0] = (opts.fin === false ? 0x00 : 0x80) | (opts.opcode ?? TEXT);
  if (lenBytes === 0) head[1] = 0x80 | len;
  else if (lenBytes === 2) { head[1] = 0x80 | 126; head.writeUInt16BE(len, 2); }
  else { head[1] = 0x80 | 127; head.writeBigUInt64BE(BigInt(len), 2); }
  mask.copy(head, 2 + lenBytes);
  const masked = Buffer.from(body);
  for (let i = 0; i < masked.length; i++) masked[i] ^= mask[i % 4];
  return Buffer.concat([head, masked]);
}

describe('传话程序：房间码与握手', () => {
  it('传话程序按 URL 路径严格判房间码（大小写宽容，内部空格/符号不宽容）', () => {
    expect(normalizeRoomCode('K7M2QX')).toBe('K7M2QX');
    expect(normalizeRoomCode('k7m2qx')).toBe('K7M2QX');
    expect(normalizeRoomCode(' k7m2 qx ')).toBeNull(); // 页面那侧才做"去空格"的宽容归一
    expect(normalizeRoomCode('AB-CD')).toBeNull();
    expect(normalizeRoomCode('abc')).toBeNull();
    expect(normalizeRoomCode('ABCDE123456')).toBeNull();
    expect(normalizeRoomCode('K7M2*X')).toBeNull();
    expect(normalizeRoomCode('')).toBeNull();
  });

  it('Sec-Websocket-Accept 按 RFC 6455 算（固定钥匙的可对照读数）', () => {
    expect(webSocketAccept('dGhlIHNhbXBsZSBub25jZQ==')).toBe('s3pPLMBiTxaQ9kYGzzhZRbK+xOo=');
  });
});

describe('传话程序：帧编解码', () => {
  it('短帧往返：编出去解回来内容一致', () => {
    const { frames } = decodeFrames(maskedFrame('hello'));
    expect(frames).toHaveLength(1);
    expect(frames[0].payload.toString('utf8')).toBe('hello');
  });

  it('服务端出帧不带掩码，长度分三段编码（125 / 126-65535 / 更大）', () => {
    expect(encodeFrame(TEXT, 'x').subarray(0, 2)).toEqual(Buffer.from([0x81, 0x01]));
    expect(encodeFrame(TEXT, 'y'.repeat(300))[1]).toBe(126);
    expect(encodeFrame(TEXT, 'z'.repeat(70000))[1]).toBe(127);
  });

  it('半帧不硬解：留到下一次 data 再拼', () => {
    const whole = maskedFrame('abcdef');
    const first = decodeFrames(whole.subarray(0, 4));
    expect(first.frames).toHaveLength(0);
    const rest = decodeFrames(Buffer.concat([first.rest, whole.subarray(4)]));
    expect(rest.frames).toHaveLength(1);
    expect(rest.frames[0].payload.toString('utf8')).toBe('abcdef');
  });

  it('分片帧合成一条，opcode 取首帧', () => {
    const chunks = [
      maskedFrame('ab', { fin: false, opcode: TEXT }),
      maskedFrame('cd', { opcode: 0 }),
    ];
    const { frames } = decodeFrames(Buffer.concat(chunks));
    expect(frames).toHaveLength(1);
    expect(frames[0].opcode).toBe(TEXT);
    expect(frames[0].payload.toString('utf8')).toBe('abcd');
  });

  it('控制帧单独出来：关闭帧不等分片合并', () => {
    const { frames } = decodeFrames(Buffer.concat([maskedFrame('', { opcode: CLOSE }), maskedFrame('hi')]));
    expect(frames.map((f) => f.opcode)).toEqual([CLOSE, TEXT]);
  });

  it('超长帧标 overflow，让上层断线而不是无限攒', () => {
    const big = Buffer.alloc(10);
    big[0] = 0x81;
    big[1] = 0xff; // 127：后面 8 字节是 64 位长度
    big.writeBigUInt64BE(BigInt(2 * 1024 * 1024), 2);
    expect(decodeFrames(big).overflow).toBe(true);
  });

  it('分片跨两次 data 到达也拼得回原话（攒片状态必须归连接、不归函数局部）', () => {
    const frag = createFragmentState();
    const part1 = maskedFrame('前半句话', { fin: false });
    const part2 = maskedFrame('后半句话', { opcode: 0 });

    const first = decodeFrames(part1, frag);
    expect(first.frames).toHaveLength(0); // 没 FIN ⇒ 先不发
    const second = decodeFrames(part2, frag);

    expect(second.frames).toHaveLength(1);
    expect(second.frames[0].opcode).toBe(TEXT);
    expect(second.frames[0].payload.toString('utf8')).toBe('前半句话后半句话');
    expect(second.overflow).toBe(false);
  });

  it('分片攒起来的总长也受同一个上限管（只查单帧＝"永远不发 FIN"就能攒出无限内存）', () => {
    const frag = createFragmentState();
    const near = maskedFrame('a'.repeat(1024 * 1024 - 6), { fin: false });
    expect(decodeFrames(near, frag).overflow).toBe(false);
    expect(decodeFrames(maskedFrame('0123456789', { opcode: 0 }), frag).overflow).toBe(true);
  });

  it('没头就来的续帧＝协议错，标 overflow 让上层断线（绝不凭 opcode 0 造一条空类型消息）', () => {
    expect(decodeFrames(maskedFrame('x', { opcode: 0 })).overflow).toBe(true);
  });
});

describe('传话程序：真连接转发（Node 自带 WebSocket 客户端）', () => {
  it('同房间互相收到、发话人自己收不到、别的房间收不到', async () => {
    const { createRelay } = await import('./net-relay.mjs');
    const { server, rooms } = createRelay();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const port = server.address().port;

    const open = (code) => new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/${code}`);
      const inbox = [];
      ws.addEventListener('message', (ev) => inbox.push(String(ev.data)));
      ws.addEventListener('open', () => resolve({ ws, inbox }));
      ws.addEventListener('error', () => reject(new Error('连不上传话程序')));
    });

    const a = await open('ROOMAA');
    const b = await open('ROOMAA');
    const c = await open('ROOMBB');

    a.ws.send('给 b 的话');
    await new Promise((r) => setTimeout(r, 120));
    expect(b.inbox).toEqual(['给 b 的话']);
    expect(a.inbox).toEqual([]);
    expect(c.inbox).toEqual([]);

    b.ws.send('回 a 的话');
    await new Promise((r) => setTimeout(r, 120));
    expect(a.inbox).toEqual(['回 a 的话']);

    expect(rooms.size).toBe(2);
    const roomsBefore = rooms.size;
    c.ws.close();
    await new Promise((r) => setTimeout(r, 200));
    expect(rooms.size).toBeLessThanOrEqual(roomsBefore);

    a.ws.close();
    b.ws.close();
    await new Promise((resolve) => server.close(() => resolve()));
  });

  it('房间码不对 ⇒ 拒绝握手，不开房', async () => {
    const { createRelay } = await import('./net-relay.mjs');
    const { server } = createRelay();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const port = server.address().port;

    await expect(new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/x`);
      ws.addEventListener('open', () => resolve('opened'));
      ws.addEventListener('error', () => reject(new Error('refused')));
    })).rejects.toThrow('refused');

    await new Promise((resolve) => server.close(() => resolve()));
  });
});
