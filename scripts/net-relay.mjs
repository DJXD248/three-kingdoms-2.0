// 联机传话程序（J1）：按 URL 路径里的房间码收人，再按**每条话自己写明的收件人**投递。
// 它不懂玩法、不算牌、不存局面——房主那台机器才是裁判（契约：服务器只传话）。
// 切片⑥（v2.9.25）加的是"投递"而不是"裁判"：握手时把这条连接绑在网址带来的那串身份号上，
// 帧里写了 `to` ⇒ 只交给绑到这个身份号的那条连接，查不到收件人就丢掉（绝不退回全房群发）；
// 没写 `to` ⇒ 照旧发给全屋（观战那条路必须留着）。
// 防作弊·第一档（v2.9.27）加的还是"投递与收人"，不是"裁判"：握手网址多带一串进场字（`?k=`），
// 一间房认下第一个进房的人（正常就是房主）带来的那一串，之后逐字符对不上的一律在门外拒掉——
// 它仍然不懂玩法、不算牌，也不会去查"这个人是不是房主本人"（谁先带字进来，那串就算这间房的）。
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
 * 一间房空了以后，它还把认下的那串进场字记住多久。
 * 为什么要记住：人一走光就忘，那么只打听到房间码的人可以抢在房主回来之前用一个乱填的字
 * 把这间房占下来，房主反倒被自己的门锁在门外。10 分钟足够覆盖"房主切个窗口、重连一趟"，
 * 又不至于让废弃的房间码长期占着那 64 格。
 */
const IDLE_ROOM_RETENTION_MS = 10 * 60 * 1000;
/**
 * 身份号的形状：**与客户端 `netProtocol.ts` 里那条 `isId` 同一个数、同一个理由**
 * （非空、不超过 64 个字符）。两边不共用一个模块（这个文件必须零依赖），所以这里抄一份，
 * 抄错了的表现是"客户端连得上、传话程序拒握手"——不会静默半连。
 * 允许的字符就是 `netRandom.ts` 那两种号用到的：UUID 的十六进制与短横、兜底号的前缀与数字。
 */
const PEER_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
/**
 * 进场字（防作弊·第一档，v2.9.27）：**与客户端 `netProtocol.ts` 那一串同一个数、同一个字母表**
 * （12 位，去掉易混的 I O 0 1）。这里必须自己抄一份——本文件零依赖，不能去 import 浏览器侧的模块。
 * 抄错了的表现是"客人填了房主给的字仍被拒"，所以两边各有一份测试钉住同一形状。
 */
const TICKET_PATTERN = /^[A-HJ-NP-Z2-9]{12}$/;

export function webSocketAccept(key) {
  return crypto.createHash('sha1').update(String(key) + WS_GUID).digest('base64');
}

export function normalizeRoomCode(raw) {
  const code = String(raw ?? '').trim().toUpperCase();
  return ROOM_PATTERN.test(code) ? code : null;
}

/**
 * 与客户端 `normalizeRoomTicket` 同一口径：大小写、空格、短横都不算数，筛完必须整整 12 位。
 * 传话程序比的是**归一化后的那串**，所以"抄的时候多打了两个短横"进得来、"少打一个字符"进不来。
 */
export function normalizeTicket(raw) {
  const ticket = String(raw ?? '').trim().toUpperCase().replace(/[\s-]/g, '');
  return TICKET_PATTERN.test(ticket) ? ticket : null;
}

/**
 * 握手网址：`/<房间码>/<身份号>?k=<进场字>`。
 * 房间码取**第一段**（切片⑥之前它是最后一段，那时路径里只有它）。
 * 身份号取第二段，必须先百分号解码再验形状：`crypto.randomUUID` 那种号本来就只用十六进制与短横，
 * 兜底号（`netRandom.ts`）也一样，所以正常情况下解码前后是同一串；这里做严格校验，
 * 是为了"形状不对就连不上"而不是"连上了但收不到指名给他的那份"。
 * 进场字取查询串里那个 `k`，同样先归一化；**没有/形状不对就是 null**，交给外面那句"没带钥匙就拒"。
 * ⚠️ 这一版**不**接受路径里只有房间码的老网址：那条连接没法按人投递，
 * 收不到任何一份快照（快照全都指名），留着它只会让人对着一块空屏猜原因。
 * ⚠️ 也不接受**没带 `k` 的老两段网址**（v2.9.27 起）：那就等于门装了却没锁。
 * 一个房间码里只认**第一个进房的人带来的那一串**（房主先开房，所以那串就是房主的），
 * 之后每一条必须与它逐字符相等——传话程序不懂玩法，它只做这一件事，仍然不算牌、不存局面。
 */
export function parseUpgradeTarget(rawUrl) {
  const full = String(rawUrl ?? '');
  // 先去掉 `#` 后面那一段（老网址也是这么处理的），剩下的才分路径与查询串。
  const [pathPart = '', ...queryParts] = full.split('#')[0].split('?');
  const parts = pathPart.split('/').filter(Boolean);
  if (parts.length !== 2) return { code: null, peer: null, ticket: null };
  const code = normalizeRoomCode(parts[0]);
  if (!code) return { code: null, peer: null, ticket: null };
  let peer;
  try {
    peer = decodeURIComponent(parts[1]);
  } catch {
    return { code, peer: null, ticket: null }; // 半个百分号转义＝坏网址，别猜
  }
  let raw = null;
  for (const item of queryParts.join('&').split('&')) {
    const eq = item.indexOf('=');
    if (eq < 0) continue;
    if (item.slice(0, eq) === 'k') {
      // 同一个网址里写了两个 `k` ⇒ 认后一个（与 `routeFrame` 那条"重复 to 键"同一套规矩，
      // 别让门这边和投递那边各信一半）。
      raw = item.slice(eq + 1);
    }
  }
  let ticket = null;
  if (raw !== null) {
    try {
      ticket = normalizeTicket(decodeURIComponent(raw));
    } catch {
      ticket = null;
    }
  }
  return { code, peer: PEER_ID_PATTERN.test(peer) ? peer : null, ticket };
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
   * 房间码 → 那一间房。按身份号存是这堵墙的全部结构：
   * 投递时查的是"这个号在这儿绑着谁"，而不是"屋里有哪些 socket"。
   *
   * 防作弊·第一档（v2.9.27）给每一间房多带了一格 `ticket`：那串进场字由**第一个进房的人**
   * （正常流程就是房主）带来并被这间房认下，此后每一条必须逐字符相等才让进。
   * `emptySince`＝屋里最后一个人离开的那一刻（0＝还在用人）。这一格存在的理由是别的一种坑：
   * 人一走光就把这间房连同它认下的字一起忘掉，那么只打听到房间码的人可以**抢在房主回来之前**
   * 用一个乱填的字把这间房占下来，房主反倒被自己的门锁在门外。所以空房要留一段时间
   * （见 `IDLE_ROOM_RETENTION_MS` 与那个 30 秒的清扫），到期再忘。
   * @type {Map<string, { ticket: string, peers: Map<string, { socket: import('node:net').Socket, peer: string }>, emptySince: number }>}
   */
  const rooms = new Map();

  /** 这一间房现在的人（没人住过就是 0）——容量与"身份号重了"两道检查都读它。 */
  const peersOf = (code) => rooms.get(code)?.peers ?? new Map();

  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(
      '三国卡牌 联机传话程序正在运行。\n'
      + '它只转发文字消息，不算牌；牌由房主那台机器算。\n'
      + '写了收件人的话只交给那一个人，查不到收件人就丢掉。\n'
      + '进房要两样：房间码＋房主给的那串进场字，缺一样或不对都在门外被拒。\n'
      + '游戏里请填地址：ws://<本机IP>:<端口>，再填房间码与进场字。\n',
    );
  });

  server.on('upgrade', (req, socket) => {
    const key = req.headers['sec-websocket-key'];
    const { code, peer, ticket } = parseUpgradeTarget(req.url);
    if (!key || socket.destroyed) return void socket.destroy();
    if (!code) return void rejectUpgrade(socket, '房间码格式不对：需要 4-10 位字母或数字');
    if (!peer) return void rejectUpgrade(socket, '握手网址里没有可用的身份号：需要 /房间码/身份号 两段');
    // 门的两句判据，顺序也有讲究：先问"你有没有带字"，再问"这间房认不认这个字"。
    // 没带字＝连老网址都没了这条路（v2.9.27 起），所以这里明确说一句，别让人以为是不匹配。
    if (!ticket) return void rejectUpgrade(socket, '没带进场字：请填房主屏幕上那 12 个字符');
    const room = rooms.get(code);
    if (room && room.ticket !== ticket) {
      return void rejectUpgrade(socket, '进场字不对，进不了这个房间');
    }
    if (peersOf(code).size >= MAX_PEERS_PER_ROOM) return void rejectUpgrade(socket, '这个房间人满了');
    if (rooms.size >= MAX_ROOMS && !room) return void rejectUpgrade(socket, '传话程序房间数已满');
    // 两条连接报同一个身份号 ⇒ 指名给他的那份会分成两份信箱。这里拒后来那一个，
    // 而不是"顶掉"前一个：被顶掉的那位会一声不响地收不到东西，那比连不上更难查。
    if (room?.peers.has(peer)) return void rejectUpgrade(socket, '这个身份号已经在这间房里了');

    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n'
      + 'Upgrade: websocket\r\n'
      + 'Connection: Upgrade\r\n'
      + `Sec-Websocket-Accept: ${webSocketAccept(key)}\r\n`
      + '\r\n',
    );
    socket.setNoDelay(true);

    if (!room) {
      // 这间房现在才成立，认下这一条带来的字（判据在上面：走到这里的一定带了字）。
      rooms.set(code, { ticket, peers: new Map(), emptySince: 0 });
    }
    const held = rooms.get(code);
    held.emptySince = 0;
    // close 里删的那一格必须是"我自己这一格"：同一秒里若有同房间码的新连接占了这格，
    // 无脑 peers.delete(peer) 会把人家的绑定删掉，那位就成了查不到收件人的信。
    const conn = { socket, peer };
    held.peers.set(peer, conn);
    const roomPeers = held.peers;

    let carry = Buffer.alloc(0);
    const frag = createFragmentState();
    const close = () => {
      if (roomPeers.get(peer) === conn) roomPeers.delete(peer);
      if (roomPeers.size === 0 && rooms.get(code)?.peers === roomPeers) {
        const stillThere = rooms.get(code);
        if (stillThere) stillThere.emptySince = Date.now();
      }
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
        for (const [id, other] of roomPeers) {
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
      for (const [peer, conn] of room.peers) if (conn.socket.destroyed) room.peers.delete(peer);
      if (room.peers.size === 0) {
        // 空房不立刻忘：它还得记着认下的那串进场字（见 `IDLE_ROOM_RETENTION_MS` 那段理由）。
        if (room.emptySince === 0) room.emptySince = Date.now();
        else if (Date.now() - room.emptySince >= IDLE_ROOM_RETENTION_MS) rooms.delete(code);
      } else {
        console.log(`[${code}] 在场 ${room.peers.size} 人`);
      }
    }
  }, 30_000).unref();
}
