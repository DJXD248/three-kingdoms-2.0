// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  createFragmentState,
  decodeFrames,
  encodeFrame,
  normalizeRoomCode,
  parseUpgradeTarget,
  routeFrame,
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

describe('传话程序：握手网址的两段＋一串进场字（切片⑥＋⑦第一档）', () => {
  it('/房间码/身份号?k=进场字 ⇒ 三段各归各位', () => {
    expect(parseUpgradeTarget('/K7M2QX/p-1-2-aabbccdd?k=ABCDEFGHJKLM')).toEqual({
      code: 'K7M2QX', peer: 'p-1-2-aabbccdd', ticket: 'ABCDEFGHJKLM',
    });
    expect(parseUpgradeTarget('/k7m2qx/3f8a9b0c-1d2e-4f30-9a1b-2c3d4e5f6071?k=KMNPKMNPABCD')).toEqual({
      code: 'K7M2QX',
      peer: '3f8a9b0c-1d2e-4f30-9a1b-2c3d4e5f6071',
      ticket: 'KMNPKMNPABCD',
    });
  });

  /**
   * 抄写宽容：屏幕上给的是 `ABCD-EFGH-JKMN`，客人手打可能带短横、也可能打成小写。
   * 归一化在**门外**就做（与客户端 `normalizeRoomTicket` 同一口径），比对的是归一化后那串。
   */
  it('进场字认小写与短横：形状一样就算同一串', () => {
    expect(parseUpgradeTarget('/K7M2QX/GUEST-B?k=abcd-efgh-jkmn').ticket).toBe('ABCDEFGHJKMN');
    expect(parseUpgradeTarget('/K7M2QX/GUEST-B?k=ABCDEFGHJKMN').ticket).toBe('ABCDEFGHJKMN');
  });

  /**
   * ⚠️ 这一条改掉了切片⑦之前的既有期望值（原来 `/K7M2QX/身份号` 也算有效握手），不是"照红改绿"：
   * 门装了就必须锁——不带进场字的老网址如果还能连上，那串字就成了摆设。
   * 老证人那句"查询串与井号不算进身份号"仍然逐句留着（下面两条各一枚），只是多带一个 `ticket: null`。
   */
  it('没带进场字的老网址＝形状还在、钥匙没有 ⇒ ticket 给 null（上层据此拒握手）', () => {
    expect(parseUpgradeTarget('/K7M2QX/p-1-2-aabbccdd')).toEqual({ code: 'K7M2QX', peer: 'p-1-2-aabbccdd', ticket: null });
    expect(parseUpgradeTarget('/K7M2QX/GUEST-B?x=1')).toEqual({ code: 'K7M2QX', peer: 'GUEST-B', ticket: null });
    expect(parseUpgradeTarget('/K7M2QX/GUEST-B#frag')).toEqual({ code: 'K7M2QX', peer: 'GUEST-B', ticket: null });
    // 井号后面那一段整个不算数（老形状里 `#` 就是被丢掉的），所以 `?` 出现在它后面也别想当钥匙。
    expect(parseUpgradeTarget('/K7M2QX/GUEST-B#frag?k=ABCDEFGHJKLM').ticket).toBeNull();
  });

  it('进场字形状不对（少一个／多一个／混进易混字符／半个转义）⇒ null，不猜', () => {
    for (const bad of ['ABCDEFGHJKL', 'ABCDEFGHJKLMN', 'ABCDEFGHIJKLMN', 'ABCD-EFGH-JKM0', 'ABCDEFGHJKM%']) {
      expect(parseUpgradeTarget(`/K7M2QX/GUEST-B?k=${bad}`).ticket).toBeNull();
    }
    // 带了 `k=` 但是空串，与根本没带同一处置：门不认空钥匙。
    expect(parseUpgradeTarget('/K7M2QX/GUEST-B?k=').ticket).toBeNull();
    // 同一个网址写了两遍 `k` ⇒ 认后一个（与 `routeFrame` 那条"重复 to 键取最后一个"同一套规矩）。
    expect(parseUpgradeTarget('/K7M2QX/GUEST-B?k=ZZZZZZZZZZZZ&k=ABCDEFGHJKLM').ticket).toBe('ABCDEFGHJKLM');
    // 百分号转义进来的那串一样认（客户端那边是原样拼上去的，这里不能只认明文）。
    expect(parseUpgradeTarget('/K7M2QX/GUEST-B?k=%41BCDEFGHJKLM').ticket).toBe('ABCDEFGHJKLM');
  });

  it('老网址（只有一段）＝没有身份号 ⇒ 拒：那条连接没法按人投递，任何一份指名快照都落不到它手里', () => {
    expect(parseUpgradeTarget('/K7M2QX').peer).toBeNull();
    expect(parseUpgradeTarget('/').peer).toBeNull();
    expect(parseUpgradeTarget('').peer).toBeNull();
    expect(parseUpgradeTarget(undefined).code).toBeNull();
  });

  it('房间码坏、或多出第三段、或身份号形状不对 ⇒ 一样给 null（上层据此拒握手，不猜）', () => {
    expect(parseUpgradeTarget('/AB-CD/GUEST-B')).toEqual({ code: null, peer: null, ticket: null });
    expect(parseUpgradeTarget('/K7M2QX/GUEST-B/extra')).toEqual({ code: null, peer: null, ticket: null });
    // 带斜杠的号会把路径拆成三段；带空格/中文的号一进 URL 就变形；65 个字符越过协议那条 isId 的界。
    for (const bad of ['a%2Fb', 'a%20b', '%E7%94%B2', 'x'.repeat(65)]) {
      expect(parseUpgradeTarget(`/K7M2QX/${bad}?k=ABCDEFGHJKLM`)).toEqual({ code: 'K7M2QX', peer: null, ticket: 'ABCDEFGHJKLM' });
    }
    // 半个转义（'%4'）decode 会抛：宁可拒握手，也不把一条读不懂的网址猜成某个身份号。
    expect(parseUpgradeTarget('/K7M2QX/%4').peer).toBeNull();
  });
});

describe('传话程序：一帧该投给谁（切片⑥的投递判据）', () => {
  it('写了 to ⇒ 只认那一个收件人；没写 to ⇒ 全屋（观战通道）', () => {
    expect(routeFrame(JSON.stringify({ t: 'snapshot', from: 'HOST', to: 'GUEST-B', state: {} }))).toEqual({ to: 'GUEST-B' });
    expect(routeFrame(JSON.stringify({ t: 'seatmap', from: 'HOST', seats: [] }))).toEqual({ to: null, broadcast: true });
    expect(routeFrame(JSON.stringify({ t: 'roster', from: 'HOST', peers: [] }))).toEqual({ to: null, broadcast: true });
  });

  /**
   * ⚠️ 这一条是 ㈣ 的硬证人，理由是"两边必须用同一套解析语义"：
   * 传话程序这里读 `to` 靠 `JSON.parse`，客户端 `parseEnvelope` 也靠 `JSON.parse`，
   * 而 `JSON.parse` 对重复键的规定是**取最后一个**。
   * 一旦传话程序自己写一套找 `"to"` 的代码（正则、手搓扫描），它就可能认第一个：
   * `{"to":"B","to":"C"}` 里本该只给 C 的那份交给了 B，而 B 那边解析出的收件人是自己 ⇒ 采纳 ⇒ 墙被绕过。
   * 这里把"取最后一个"钉死，并且当场拿 `JSON.parse` 自己对账（不是拿我的期望值对账）。
   */
  it('重复 to 键：投递认的那一个 ＝ JSON.parse 认的那一个（最后一个）', () => {
    const text = '{"t":"snapshot","from":"HOST","to":"GUEST-B","to":"GUEST-C","state":{}}';
    expect(routeFrame(text)).toEqual({ to: 'GUEST-C' });
    expect(routeFrame(text).to).toBe(JSON.parse(text).to);
  });

  it('解析不出的帧 ⇒ 不发（不是"照旧群发"，也不是"发一半"）', () => {
    for (const bad of ['不是 JSON', '', '{', 'null,null', '{"to":"B"', 'undefined']) {
      expect(routeFrame(bad)).toEqual({ drop: true });
    }
  });

  it('to 写了但不是一个可用身份号 ⇒ 丢掉：这样一帧客户端自己也一定判假，投不到就群发正是这堵墙最不该有的退路', () => {
    // 注意这里挑的都是"形状越界"的字符串：'null' / '0' 这类字面量反而是合法形状（就当成一个号），
    // 真正的判据在非字符串那一行——`to` 不是字符串时没有"号"可对，只能丢。
    for (const bad of ['', 'x'.repeat(65), 'a b', '甲', 'a/b', 'a%b']) {
      expect(routeFrame(`{"t":"snapshot","from":"HOST","to":${JSON.stringify(bad)},"state":{}}`)).toEqual({ drop: true });
    }
    expect(routeFrame('{"t":"snapshot","from":"HOST","to":42,"state":{}}')).toEqual({ drop: true });
    expect(routeFrame('{"t":"snapshot","from":"HOST","to":null,"state":{}}')).toEqual({ drop: true });
    expect(routeFrame('{"t":"snapshot","from":"HOST","to":{"who":"B"},"state":{}}')).toEqual({ drop: true });
  });

  it('JSON 里那些没写成字符串收件人的怪形状 ⇒ 按"没写 to"处理（全屋），客户端那侧自会把它判成假消息', () => {
    expect(routeFrame('42')).toEqual({ to: null, broadcast: true });
    expect(routeFrame('[1,2,3]')).toEqual({ to: null, broadcast: true });
    expect(routeFrame('null')).toEqual({ to: null, broadcast: true });
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

describe('传话程序：真连接投递（Node 自带 WebSocket 客户端）', () => {
  /**
   * ⚠️ 这里改掉了切片⑥之前那条既有证人（原第 122 行「同房间互相收到、发话人自己收不到、别的房间收不到」），
   * 不是"照红改绿"，理由写在下面三条里：
   *  1. 那条钉的正是"每条话抄给全屋"，而这一版要的是"写了收件人的话只给那一个人"——判据本身变了，留着它就是把墙钉回去。
   *  2. 它发的是裸句子（`a.ws.send('给 b 的话')`）。这一版要先解析得出才投，裸句子成了"解析不出＝不发"的对象，
   *     所以那句话照旧留着，只是改成正面控制（见「解析不出的一帧不转发」那条），并给"没写收件人"另配一条合法 JSON 的证人。
   *  3. 老网址 `/房间码` 这一版会拒握手（那条连接没法按人投递，任何一份指名快照都落不到它手里），
   *     所以每条连接都带上了自己的第二段；"没带身份号"本身也成了新证人。
   * 原证人里的三句实话——同屋互收、发话人自己听不见、别的房间收不到——逐句拆进下面第一条，一句没丢。
   */
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  /**
   * 切片⑦第一档以后，每条连接都得带进场字，否则一律在门外被拒。
   * 所以下面 `open` 的第三个参数给了默认值：老证人只管"投给谁"，不该被这道门绊倒——
   * 门本身另有专门的证人（见「进门这道门」那一段），一条都不混进这里。
   */
  const KEY = 'ABCDEFGHJKLM';

  async function stage() {
    const { createRelay } = await import('./net-relay.mjs');
    const { server, rooms } = createRelay();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const port = server.address().port;

    const open = (code, peer, ticket = KEY) => new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/${code}/${peer}?k=${ticket}`);
      const inbox = [];
      ws.addEventListener('message', (ev) => inbox.push(String(ev.data)));
      ws.addEventListener('open', () => resolve({ ws, inbox }));
      ws.addEventListener('error', () => reject(new Error('连不上传话程序')));
    });
    const refused = async (path) => {
      await expect(new Promise((resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`);
        ws.addEventListener('open', () => resolve('opened'));
        ws.addEventListener('error', () => reject(new Error('refused')));
      })).rejects.toThrow('refused');
    };
    const teardown = (...conns) => new Promise((resolve) => {
      for (const c of conns) { try { c.ws?.close(); } catch { /* 已经断了 */ } }
      server.close(() => resolve());
    });
    return { port, rooms, open, refused, teardown };
  }

  it('没写收件人的话照旧全屋收得到（观战通道留着）、发话人自己收不到、别的房间收不到', async () => {
    const { rooms, open, teardown } = await stage();
    const host = await open('ROOMAA', 'HOST-1');
    const b = await open('ROOMAA', 'GUEST-B');
    const c = await open('ROOMAA', 'GUEST-C');
    const d = await open('ROOMBB', 'GUEST-D');

    const frame = JSON.stringify({ t: 'seatmap', from: 'HOST-1', seats: [] });
    host.ws.send(frame);
    await wait(140);
    expect(b.inbox).toEqual([frame]);
    expect(c.inbox).toEqual([frame]);
    expect(host.inbox).toEqual([]); // 发话人自己听不见（原行为）
    expect(d.inbox).toEqual([]); // 别的房间收不到（原行为）
    expect(rooms.size).toBe(2); // 两个房间各开各的（原行为）

    await teardown(host, b, c, d);
  });

  it('写了 to ⇒ 只交给绑了这个身份号的那条连接，屋里其他人一格也没收到', async () => {
    const { open, teardown } = await stage();
    const host = await open('ROOMAA', 'HOST-1');
    const b = await open('ROOMAA', 'GUEST-B');
    const c = await open('ROOMAA', 'GUEST-C');

    // 客人交回给房主的那一步是指名给房主的：另外两位客人绝不该看见它。
    const step = JSON.stringify({ t: 'act', from: 'GUEST-B', to: 'HOST-1', seat: 2, key: '0-END_TURN:abcd1234' });
    b.ws.send(step);
    await wait(140);
    expect(host.inbox).toEqual([step]);
    expect(c.inbox).toEqual([]);
    expect(b.inbox).toEqual([]);

    // 反方向同样：房主算给某一席的私有画面，只有那一席收得到。
    const view = JSON.stringify({ t: 'snapshot', from: 'HOST-1', to: 'GUEST-C', state: { players: [] } });
    host.ws.send(view);
    await wait(140);
    expect(c.inbox).toEqual([view]);
    expect(b.inbox).toEqual([]);

    await teardown(host, b, c);
  });

  it('to 查不到收件人 ⇒ 整帧丢掉，绝不回落成全房群发（这一条是整堵墙的全部价值）', async () => {
    const { open, teardown } = await stage();
    const host = await open('ROOMAA', 'HOST-1');
    const b = await open('ROOMAA', 'GUEST-B');
    const c = await open('ROOMAA', 'GUEST-C');

    const frame = JSON.stringify({ t: 'snapshot', from: 'HOST-1', to: 'NO-SUCH-PEER', state: { players: [{ hand: [{ id: 'p1-h1' }] }] } });
    host.ws.send(frame);
    await wait(140);
    expect(b.inbox).toEqual([]);
    expect(c.inbox).toEqual([]);

    // 同一条线紧接着的"没写收件人"那一帧照常全房 ⇒ 证明上面那两个空是"丢了"，不是"投递整条坏了"。
    const bc = JSON.stringify({ t: 'netstatus', from: 'HOST-1', rows: [] });
    host.ws.send(bc);
    await wait(140);
    expect(b.inbox).toEqual([bc]);
    expect(c.inbox).toEqual([bc]);

    await teardown(host, b, c);
  });

  it('那位退房以后，指名给他的信谁也收不到（绑定跟着连接走，不会转到别人手里）', async () => {
    const { open, teardown } = await stage();
    const host = await open('ROOMAA', 'HOST-1');
    const b = await open('ROOMAA', 'GUEST-B');
    const c = await open('ROOMAA', 'GUEST-C');

    c.ws.close();
    await wait(220);
    const frame = JSON.stringify({ t: 'snapshot', from: 'HOST-1', to: 'GUEST-C', state: { players: [] } });
    host.ws.send(frame);
    await wait(140);
    expect(b.inbox).toEqual([]);

    await teardown(host, b);
  });

  it('重复 to 键：真机上投给 JSON.parse 认的那一个（后者），不是正则扫描认的那一个（前者）', async () => {
    const { open, teardown } = await stage();
    const host = await open('ROOMAA', 'HOST-1');
    const b = await open('ROOMAA', 'GUEST-B');
    const c = await open('ROOMAA', 'GUEST-C');

    host.ws.send('{"t":"snapshot","from":"HOST-1","to":"GUEST-B","to":"GUEST-C","state":{"players":[]}}');
    await wait(140);
    expect(c.inbox).toHaveLength(1);
    expect(JSON.parse(c.inbox[0]).to).toBe('GUEST-C');
    expect(b.inbox).toEqual([]);

    await teardown(host, b, c);
  });

  it('解析不出的一帧不转发（老证人那句裸句子现在正是这一类，留着它当正面控制的反面）', async () => {
    const { open, teardown } = await stage();
    const host = await open('ROOMAA', 'HOST-1');
    const b = await open('ROOMAA', 'GUEST-B');

    host.ws.send('给 b 的话'); // 不是 JSON ⇒ 不发
    const good = JSON.stringify({ t: 'roster', from: 'HOST-1', peers: [] });
    host.ws.send(good); // 紧跟着一条合法的 ⇒ 断线不是因为坏了整条线
    await wait(140);
    expect(b.inbox).toEqual([good]);

    await teardown(host, b);
  });

  it('绑定只在本房间内认人：两个房间可以有同一个身份号，也各收各的信', async () => {
    const { open, teardown } = await stage();
    const a1 = await open('ROOMAA', 'SHARED-1');
    const a2 = await open('ROOMAA', 'SHARED-2');
    const b1 = await open('ROOMBB', 'SHARED-1');

    const frame = JSON.stringify({ t: 'snapshot', from: 'SHARED-2', to: 'SHARED-1', state: { players: [] } });
    a2.ws.send(frame);
    await wait(140);
    expect(a1.inbox).toEqual([frame]);
    expect(b1.inbox).toEqual([]); // 隔壁房间那个同号的收不到

    await teardown(a1, a2, b1);
  });

  it('握手网址没带身份号（老形状 /房间码）⇒ 拒，不开房', async () => {
    const { rooms, refused, open, teardown } = await stage();
    // 带上合法进场字，确保拒它是缺第二段那一条判据在起作用，不是这道门误伤。
    await refused(`/ROOMAA?k=${KEY}`);
    expect(rooms.size).toBe(0);

    // 同一次运行里带上身份号就连得上 ⇒ 拒的是那一段，不是别的什么。
    const one = await open('ROOMAA', 'GUEST-B');
    expect(rooms.size).toBe(1);
    await teardown(one);
  });

  it('同一个身份号来第二条连接 ⇒ 拒后来那条，先来的照常收信（顶掉会让人一声不响地收不到东西）', async () => {
    const { open, refused, teardown } = await stage();
    const first = await open('ROOMAA', 'GUEST-B');
    const host = await open('ROOMAA', 'HOST-1');

    await refused(`/ROOMAA/GUEST-B?k=${KEY}`);

    const frame = JSON.stringify({ t: 'netstatus', from: 'HOST-1', rows: [] });
    host.ws.send(frame);
    await wait(140);
    expect(first.inbox).toEqual([frame]);

    await teardown(first, host);
  });

  it('房间码不对 ⇒ 拒绝握手，不开房', async () => {
    const { rooms, refused } = await stage();
    await refused(`/x/GUEST-B?k=${KEY}`);
    expect(rooms.size).toBe(0);
  });
});

/**
 * 切片⑦第一档：进门这道门。
 * 立的判据是"外人只知道房间码，连握手都过不了，一个字也收不到"，
 * 所以这里的证人全部盯着"收不到"那一侧：门外的连接没有 inbox 可查，它压根没连上。
 */
describe('传话程序：进门要进场字（切片⑦第一档）', () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const KEY = 'ABCDEFGHJKLM';
  const OTHER = 'ZZZZ2222YYYY';

  async function stage() {
    const { createRelay } = await import('./net-relay.mjs');
    const { server, rooms } = createRelay();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const port = server.address().port;

    const dial = (path) => new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`);
      const inbox = [];
      ws.addEventListener('message', (ev) => inbox.push(String(ev.data)));
      ws.addEventListener('open', () => resolve({ ws, inbox }));
      ws.addEventListener('error', () => reject(new Error('refused')));
    });
    const open = (code, peer, ticket = KEY) => dial(`/${code}/${peer}?k=${ticket}`);
    const refused = async (path) => {
      await expect(dial(path)).rejects.toThrow('refused');
    };
    const teardown = (...conns) => new Promise((resolve) => {
      for (const c of conns) { try { c.ws?.close(); } catch { /* 已经断了 */ } }
      server.close(() => resolve());
    });
    return { rooms, open, refused, teardown };
  }

  it('没带进场字 ⇒ 拒，而且不开房（一间房也没被陌生人占上）', async () => {
    const { rooms, refused, open, teardown } = await stage();
    await refused('/ROOMAA/HOST-1');
    await refused('/ROOMAA/HOST-1?k=');
    expect(rooms.size).toBe(0);

    const host = await open('ROOMAA', 'HOST-1');
    expect(rooms.size).toBe(1);
    await teardown(host);
  });

  it('形状不对的进场字（短一截、含字母表外的 I/O/0/1、含中文）⇒ 一律当"没带"，拒', async () => {
    const { refused, teardown } = await stage();
    for (const bad of ['ABCDEFGHJKL', 'ABCDEFGHIJKLM', 'IOIOIOIOIOIO', '010101010101', '中文中文中文']) {
      await refused(`/ROOMAA/HOST-1?k=${bad}`);
    }
    await teardown();
  });

  it('第一条带进场字的连接把这一间房的字定下来；后来的必须一字不差，不对的在门外被拒', async () => {
    const { rooms, open, refused, teardown } = await stage();
    const host = await open('ROOMAA', 'HOST-1', KEY);

    await refused(`/ROOMAA/GUEST-B?k=${OTHER}`);
    expect(host.inbox).toEqual([]); // 被拒的那条连一句也递不进来
    expect(rooms.get('ROOMAA').ticket).toBe(KEY); // 也没被那一条改掉

    const b = await open('ROOMAA', 'GUEST-B', KEY);
    const frame = JSON.stringify({ t: 'netstatus', from: 'HOST-1', rows: [] });
    host.ws.send(frame);
    await wait(140);
    expect(b.inbox).toEqual([frame]); // 门开后正常投递 ⇒ 上面那个空是"拒在门外"，不是投递坏了

    await teardown(host, b);
  });

  it('大小写与短横/空格随意 ⇒ 同一串字认成同一个（照页面口径归一）', async () => {
    const { open, refused, teardown } = await stage();
    const host = await open('ROOMAA', 'HOST-1', 'abcd-efgh-jklm');
    const b = await open('ROOMAA', 'GUEST-B', ' ABCDEFGHJKLM ');
    await refused(`/ROOMAA/GUEST-C?k=${OTHER}`);
    expect(host.inbox).toEqual([]);
    await teardown(host, b);
  });

  it('屋里全空了仍然记得自己的进场字：陌生人不能趁房间码空着把它占走（占了就等于把房主锁在门外）', async () => {
    const { rooms, open, refused, teardown } = await stage();
    const host = await open('ROOMAA', 'HOST-1', KEY);
    const first = rooms.get('ROOMAA').ticket;
    host.ws.close();
    await wait(220);

    await refused('/ROOMAA/STRANGER?k=QQQQQQQQQQQQ'); // 空房也不认陌生字
    await refused('/ROOMAA/STRANGER'); // 空房也不认"没带字"
    expect(rooms.get('ROOMAA')?.ticket).toBe(first); // 也没被改掉

    const back = await open('ROOMAA', 'HOST-1', KEY); // 房主拿原样那串回来，照进
    expect(back.inbox).toEqual([]);
    await teardown(back);
  });

  it('两个房间各认各的进场字：拿隔壁那串来敲这间门的，同样拒', async () => {
    const { open, refused, teardown } = await stage();
    const a = await open('ROOMAA', 'HOST-1', KEY);
    const b = await open('ROOMBB', 'HOST-1', OTHER);

    await refused('/ROOMAA/GUEST-X?k=' + OTHER);
    await refused('/ROOMBB/GUEST-X?k=' + KEY);
    expect(a.inbox).toEqual([]);
    expect(b.inbox).toEqual([]);

    await teardown(a, b);
  });

  it('进场字只在握手那一次用：连上以后线上传什么都与它无关（它不是消息内容，也不是游戏里的凭据）', async () => {
    const { open, teardown } = await stage();
    const host = await open('ROOMAA', 'HOST-1');
    const b = await open('ROOMAA', 'GUEST-B');

    const frame = JSON.stringify({ t: 'netstatus', from: 'HOST-1', rows: [], k: '不是那串字' });
    host.ws.send(frame);
    await wait(140);
    expect(b.inbox).toEqual([frame]); // 帧里写什么"k"都照投 ⇒ 门只管进门那一刻

    await teardown(host, b);
  });
});
