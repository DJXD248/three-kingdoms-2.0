// 联机传话程序（J1）：按 URL 路径里的房间码收人，再按**每条话自己写明的收件人**投递。
// 它不懂玩法、不算牌、不存局面——房主那台机器才是裁判（契约：服务器只传话）。
// 切片⑥（v2.9.25）加的是"投递"而不是"裁判"：握手时把这条连接绑在网址带来的那串身份号上，
// 帧里写了 `to` ⇒ 只交给绑到这个身份号的那条连接，查不到收件人就丢掉（绝不退回全房群发）；
// 没写 `to` ⇒ 照旧发给全屋（观战那条路必须留着）。
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
/**
 * 身份号的形状：**与客户端 `netProtocol.ts` 里那条 `isId` 同一个数、同一个理由**
 * （非空、不超过 64 个字符）。两边不共用一个模块（这个文件必须零依赖），所以这里抄一份，
 * 抄错了的表现是"客户端连得上、传话程序拒握手"——不会静默半连。
 * 允许的字符就是 `netRandom.ts` 那两种号用到的：UUID 的十六进制与短横、兜底号的前缀与数字。
 */
const PEER_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export function webSocketAccept(key) {
  return crypto.createHash('sha1').update(String(key) + WS_GUID).digest('base64');
}

export function normalizeRoomCode(raw) {
  const code = String(raw ?? '').trim().toUpperCase();
  return ROOM_PATTERN.test(code) ? code : null;
}

/**
 * 握手网址的两段：`/<房间码>/<身份号>`。
 * 房间码取**第一段**（切片⑥之前它是最后一段，那时路径里只有它）。
 * 身份号取第二段，必须先百分号解码再验形状：`crypto.randomUUID` 那种号本来就只用十六进制与短横，
 * 兜底号（`netRandom.ts`）也一样，所以正常情况下解码前后是同一串；这里做严格校验，
 * 是为了"形状不对就连不上"而不是"连上了但收不到指名给他的那份"。
 * ⚠️ 这一版**不**接受路径里只有房间码的老网址：那条连接没法按人投递，
 * 收不到任何一份快照（快照全都指名），留着它只会让人对着一块空屏猜原因。
 */
export function parseUpgradeTarget(rawUrl) {
  const parts = String(rawUrl ?? '').split('?')[0].split('#')[0].split('/').filter(Boolean);
  if (parts.length !== 2) return { code: null, peer: null };
  const code = normalizeRoomCode(parts[0]);
  if (!code) return { code: null, peer: null };
  let peer;
  try {
    peer = decodeURIComponent(parts[1]);
  } catch {
    return { code, peer: null }; // 半个百分号转义＝坏网址，别猜
  }
  return { code, peer: PEER_ID_PATTERN.test(peer) ? peer : null };
}

/**
 * 这一帧该投给谁。三种结果：
 *  - `{ to: null, broadcast: true }` ＝帧里没写收件人 ⇒ 全屋（观战通道）
 *  - `{ to: '<身份号>' }`            ⇒ 只投给绑了这个号的那条连接
 *  - `{ drop: true }`                ⇒ 丢掉
 *
 * ⚠️ 解析语义必须与客户端 `parseEnvelope` **同一套**：两边都是 `JSON.parse`。
 * 自己拿正则去找 `"to"` 会出这样的事——`{"to":"甲","to":"乙"}` 里 `JSON.parse` 认后者（语言规定：重复键取最后一个），
 * 而正则常常认第一个 ⇒ 传话程序把本该只给乙的那份交给甲，甲那边解析出的收件人却是自己 ⇒ 采纳。
 * 墙就是这么被绕过的，所以这一条用测试钉住（判据见 net-relay.test.mjs「重复 to 键」那条）。
 *
 * 写了 `to` 但它不是个可用身份号（不是字符串／空串／超长）⇒ 丢：
 * 这样的帧客户端自己也一定会判成假消息，发给谁都是噪音，而"投不到就群发"正是这堵墙最不该有的一条退路。
 */
export function routeFrame(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { drop: true };
  }
  if (parsed === null || typeof parsed !== 'object') return { to: null, broadcast: true };
  const raw = parsed.to;
  if (raw === undefined) return { to: null, broadcast: true };
  if (typeof raw !== 'string' || !PEER_ID_PATTERN.test(raw)) return { drop: true };
  return { to: raw };
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
  /**
   * 房间码 → (身份号 → 那条连接)。按身份号存是这堵墙的全部结构：
   * 投递时查的是"这个号在这儿绑着谁"，而不是"屋里有哪些 socket"。
   * @type {Map<string, Map<string, { socket: import('node:net').Socket, peer: string }>>}
   */
  const rooms = new Map();

  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(
      '三国卡牌 联机传话程序正在运行。\n'
      + '它只转发文字消息，不算牌；牌由房主那台机器算。\n'
      + '写了收件人的话只交给那一个人，查不到收件人就丢掉。\n'
      + '游戏里请填地址：ws://<本机IP>:<端口>，再填房间码。\n',
    );
  });

  server.on('upgrade', (req, socket) => {
    const key = req.headers['sec-websocket-key'];
    const { code, peer } = parseUpgradeTarget(req.url);
    if (!key || socket.destroyed) return void socket.destroy();
    if (!code) return void rejectUpgrade(socket, '房间码格式不对：需要 4-10 位字母或数字');
    if (!peer) return void rejectUpgrade(socket, '握手网址里没有可用的身份号：需要 /房间码/身份号 两段');
    if ((rooms.get(code)?.size ?? 0) >= MAX_PEERS_PER_ROOM) return void rejectUpgrade(socket, '这个房间人满了');
    if (rooms.size >= MAX_ROOMS && !rooms.has(code)) return void rejectUpgrade(socket, '传话程序房间数已满');
    // 两条连接报同一个身份号 ⇒ 指名给他的那份会分成两份信箱。这里拒后来那一个，
    // 而不是"顶掉"前一个：被顶掉的那位会一声不响地收不到东西，那比连不上更难查。
    if (rooms.get(code)?.has(peer)) return void rejectUpgrade(socket, '这个身份号已经在这间房里了');

    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n'
      + 'Upgrade: websocket\r\n'
      + 'Connection: Upgrade\r\n'
      + `Sec-Websocket-Accept: ${webSocketAccept(key)}\r\n`
      + '\r\n',
    );
    socket.setNoDelay(true);

    let room = rooms.get(code);
    if (!room) {
      room = new Map();
      rooms.set(code, room);
    }
    // close 里删的那一格必须是"我自己这一格"：同一秒里若有同房间码的新连接占了这格，
    // 无脑 room.delete(peer) 会把人家的绑定删掉，那位就成了查不到收件人的信。
    const conn = { socket, peer };
    room.set(peer, conn);

    let carry = Buffer.alloc(0);
    const frag = createFragmentState();
    const close = () => {
      if (room.get(peer) === conn) room.delete(peer);
      if (room.size === 0) rooms.delete(code);
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
        const route = routeFrame(text);
        if (route.drop) continue;
        const named = route.broadcast ? null : route.to;
        for (const [id, other] of room) {
          if (named !== null && id !== named) continue; // 写了收件人 ⇒ 别人一格也不给
          if (other.socket === socket || other.socket.destroyed) continue; // 发话人自己听不见（原行为）
          try { other.socket.write(encodeFrame(0x1, text)); } catch { /* 交给下一次的 data/close 事件清理 */ }
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
    for (const [code, room] of rooms) {
      for (const [peer, conn] of room) if (conn.socket.destroyed) room.delete(peer);
      if (!room.size) rooms.delete(code);
      else console.log(`[${code}] 在场 ${room.size} 人`);
    }
  }, 30_000).unref();
}
