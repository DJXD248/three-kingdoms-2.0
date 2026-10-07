// 联机传话程序（J1）：只按 URL 路径里的房间码把文字消息原样转给同一房间的其他人。
// 它不懂玩法、不算牌、不存局面——房主那台机器才是裁判（契约：服务器只传话）。
// 零依赖 Node 内置模块：浏览器页面的 WebSocket 握手与帧格式在这里手工实现，
// 目的是不往游戏依赖里加第三方包（依赖安全闸必须保持零高危）。
import http from 'node:http';
import crypto from 'node:crypto';
import os from 'node:os';

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const ROOM_PATTERN = /^[A-Z0-9]{4,10}$/;
const MAX_FRAME_BYTES = 1024 * 1024;
const MAX_PEERS_PER_ROOM = 8;
const MAX_ROOMS = 64;

export function webSocketAccept(key) {
  return crypto.createHash('sha1').update(String(key) + WS_GUID).digest('base64');
}

export function normalizeRoomCode(raw) {
  const code = String(raw ?? '').trim().toUpperCase();
  return ROOM_PATTERN.test(code) ? code : null;
}

/** 服务端→客户端：不掩码；文本帧(0x1)与关闭帧(0x8)。 */
export function encodeFrame(opcode, payload) {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload), 'utf8');
  const len = body.length;
  let head;
  if (len < 126) {
    head = Buffer.alloc(2);
    head[1] = len;
  } else if (len < 65536) {
    head = Buffer.alloc(4);
    head[1] = 126;
    head.writeUInt16BE(len, 2);
  } else {
    head = Buffer.alloc(10);
    head[1] = 127;
    head.writeBigUInt64BE(BigInt(len), 2);
  }
  head[0] = 0x80 | opcode;
  return Buffer.concat([head, body]);
}

/**
 * 一条被分片的消息会跨帧、甚至跨多次 data 到达，所以"攒到哪了"必须存在调用方给的
 * state 里（每条连接一份）。若把这份状态当函数局部变量，第二次 data 就会把前半截丢掉，
 * 拼出一条缺头缺尾的话——这是本文件第一轮独立复算逮到的真 bug（判据见 HANDOFF §12-115②）。
 */
export function createFragmentState() {
  return { opcode: 0, chunks: [], bytes: 0 };
}

/**
 * 客户端→服务端：帧带掩码，可能分片。返回 { frames, rest, overflow }。
 * 控制帧（关闭/ping/pong）不与其他帧合并；分片续帧的 opcode 为 0，首帧的 opcode 才是内容类型。
 */
export function decodeFrames(buffer, state = createFragmentState()) {
  const frames = [];
  let overflow = false;
  let offset = 0;

  const tooBig = (len) => len > MAX_FRAME_BYTES;
  const reset = () => { state.opcode = 0; state.chunks = []; state.bytes = 0; };

  while (buffer.length - offset >= 2) {
    const first = buffer[offset];
    const second = buffer[offset + 1];
    const fin = (first & 0x80) !== 0;
    const opcode = first & 0x0f;
    const masked = (second & 0x80) !== 0;
    let length = second & 0x7f;
    let cursor = offset + 2;

    if (length === 126) {
      if (buffer.length - cursor < 2) break;
      length = buffer.readUInt16BE(cursor);
      cursor += 2;
    } else if (length === 127) {
      if (buffer.length - cursor < 8) break;
      const big = buffer.readBigUInt64BE(cursor);
      if (tooBig(Number(big))) { overflow = true; break; }
      length = Number(big);
      cursor += 8;
    }
    if (tooBig(length)) { overflow = true; break; }
    // 单帧不超限还不够：分片攒起来的总长同样要有上限，否则"永远不发 FIN"能攒出无限内存
    if (state.bytes + length > MAX_FRAME_BYTES) { overflow = true; break; }
    if (masked && buffer.length - cursor < 4) break;
    if (buffer.length - cursor - (masked ? 4 : 0) < length) break;

    let mask = null;
    if (masked) {
      mask = buffer.subarray(cursor, cursor + 4);
      cursor += 4;
    }
    const payload = Buffer.from(buffer.subarray(cursor, cursor + length));
    if (mask) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
    cursor += length;
    offset = cursor;

    if (opcode >= 0x8) {
      frames.push({ opcode, payload });
      continue;
    }
    if (opcode === 0) {
      if (state.chunks.length === 0) { overflow = true; break; } // 没头就来的续帧＝协议错，断线
    } else {
      state.opcode = opcode;
      state.chunks = [];
      state.bytes = 0;
    }
    state.chunks.push(payload);
    state.bytes += payload.length;
    if (fin) {
      frames.push({ opcode: state.opcode, payload: Buffer.concat(state.chunks) });
      reset();
    }
  }

  return { frames, rest: buffer.subarray(offset), overflow };
}

export function createRelay() {
  /** @type {Map<string, Set<import('node:net').Socket>>} */
  const rooms = new Map();

  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(
      '三国卡牌 联机传话程序正在运行。\n'
      + '它只转发文字消息，不算牌；牌由房主那台机器算。\n'
      + '游戏里请填地址：ws://<本机IP>:<端口>，再填房间码。\n',
    );
  });

  server.on('upgrade', (req, socket) => {
    const key = req.headers['sec-websocket-key'];
    const code = normalizeRoomCode((req.url || '').split('/').filter(Boolean).pop());
    if (!key || socket.destroyed) return void socket.destroy();
    if (!code) return void rejectUpgrade(socket, '房间码格式不对：需要 4-10 位字母或数字');
    if ((rooms.get(code)?.size ?? 0) >= MAX_PEERS_PER_ROOM) return void rejectUpgrade(socket, '这个房间人满了');
    if (rooms.size >= MAX_ROOMS && !rooms.has(code)) return void rejectUpgrade(socket, '传话程序房间数已满');

    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n'
      + 'Upgrade: websocket\r\n'
      + 'Connection: Upgrade\r\n'
      + `Sec-Websocket-Accept: ${webSocketAccept(key)}\r\n`
      + '\r\n',
    );
    socket.setNoDelay(true);

    let peers = rooms.get(code);
    if (!peers) {
      peers = new Set();
      rooms.set(code, peers);
    }
    peers.add(socket);

    let carry = Buffer.alloc(0);
    const frag = createFragmentState();
    const close = () => {
      peers.delete(socket);
      if (peers.size === 0) rooms.delete(code);
      if (!socket.destroyed) {
        try { socket.write(encodeFrame(0x8, Buffer.alloc(0))); } catch { /* 对端已走 */ }
        socket.destroy();
      }
    };

    socket.on('data', (chunk) => {
      carry = Buffer.concat([carry, chunk]);
      const { frames, rest, overflow } = decodeFrames(carry, frag);
      carry = rest;
      if (overflow) return void close();
      for (const frame of frames) {
        if (frame.opcode === 0x8) return void close();
        if (frame.opcode === 0x9) { socket.write(encodeFrame(0xa, frame.payload)); continue; }
        if (frame.opcode !== 0x1) continue;
        const text = frame.payload.toString('utf8');
        for (const peer of peers) {
          if (peer === socket || peer.destroyed) continue;
          try { peer.write(encodeFrame(0x1, text)); } catch { /* 交给下一次的 data/close 事件清理 */ }
        }
      }
    });
    socket.on('error', close);
    socket.on('close', close);
    socket.on('end', close);
  });

  return { server, rooms };
}

function rejectUpgrade(socket, why) {
  try {
    socket.end(`HTTP/1.1 403 Forbidden\r\nContent-Type: text/plain; charset=utf-8\r\nX-Refuse-Reason: ${encodeURIComponent(why)}\r\n\r\n${why}\n`);
  } catch { /* 已断开 */ }
}

const isMain = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('net-relay.mjs');
if (isMain) {
  const port = Number(process.env.TK_RELAY_PORT || process.argv[2] || 8787);
  const { server, rooms } = createRelay();
  server.on('error', (err) => {
    console.error('[传话程序] 启动失败：', err.message);
    process.exitCode = 1;
  });
  server.listen(port, '0.0.0.0', () => {
    const ips = Object.values(os.networkInterfaces()).flat()
      .filter((i) => i && i.family === 'IPv4' && !i.internal)
      .map((i) => i.address);
    console.log(`[传话程序] 已在端口 ${port} 传话中（只转发，不算牌）。`);
    console.log(`  自己这台机器的游戏里填：ws://127.0.0.1:${port}`);
    if (ips.length) console.log(`  别人连你这台机器时填：${ips.map((ip) => `ws://${ip}:${port}`).join('  或  ')}`);
    console.log('  关掉这个窗口就等于停掉传话。');
  });
  setInterval(() => {
    for (const [code, peers] of rooms) {
      for (const peer of peers) if (peer.destroyed) peers.delete(peer);
      if (!peers.size) rooms.delete(code);
      else console.log(`[${code}] 在场 ${peers.size} 人`);
    }
  }, 30_000).unref();
}
