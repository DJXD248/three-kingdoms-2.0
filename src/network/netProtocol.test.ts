import { describe, expect, it } from 'vitest';
import { NETWORK_SNAPSHOT_VERSION } from './StateSerializer';
import {
  MAX_NAME_LENGTH,
  MAX_TRUSTED_PING_MS,
  MAX_WIRE_BYTES,
  NET_PROTOCOL_VERSION,
  checkPeerName,
  composeRoomUrl,
  createRoomCode,
  encodeEnvelope,
  normalizeRoomCode,
  ourVersionStamp,
  parseEnvelope,
  versionMismatch,
  type VersionStamp,
} from './netProtocol';

const STAMP: VersionStamp = ourVersionStamp();

describe('房间码：界面随机绝不借引擎那颗对局种子', () => {
  it('六位、只用不混淆字符表（没有 I O 0 1），连出 200 个也不重复', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const code = createRoomCode();
      expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
      seen.add(code);
    }
    expect(seen.size).toBe(200);
  });

  it('归一化：去空格、连字符、转大写；长度或字符不对就不收', () => {
    expect(normalizeRoomCode(' k7m2-qx ')).toBe('K7M2QX');
    expect(normalizeRoomCode('abc')).toBeNull();
    expect(normalizeRoomCode('K7M2_QX')).toBeNull();
    expect(normalizeRoomCode('ABCDEFGHIJK')).toBeNull();
  });

  it('生成出来的码自己就能通过归一化（两边说法一致）', () => {
    const code = createRoomCode();
    expect(normalizeRoomCode(code.toLowerCase())).toBe(code);
  });
});

describe('地址可填＝A/C 只换这一行', () => {
  it('拼出 ws://地址/房间码，并给出归一化后的码', () => {
    const ok = composeRoomUrl('ws://192.168.1.5:8787/', 'k7m2qx');
    expect(ok).toEqual({ ok: true, url: 'ws://192.168.1.5:8787/K7M2QX', roomCode: 'K7M2QX' });
    const cloud = composeRoomUrl('wss://relay.example.com:9000', 'AB23CD');
    expect(cloud.ok && cloud.url).toBe('wss://relay.example.com:9000/AB23CD');
  });

  it('三种填错各回一句人读的原因，不抛错也不静默兜底', () => {
    expect(composeRoomUrl('', 'ABCD').ok).toBe(false);
    expect((composeRoomUrl('http://127.0.0.1', 'ABCD') as { reason: string }).reason).toContain('ws://');
    expect((composeRoomUrl('ws://127.0.0.1:8787', '12') as { reason: string }).reason).toContain('房间码');
    expect((composeRoomUrl('', 'ABCD') as { reason: string }).reason).toContain('连接地址没填');
  });
});

describe('版本握手：不一致就明确拒，绝不静默半连', () => {
  it('三样都对上 ⇒ 通过', () => {
    expect(versionMismatch(STAMP, STAMP)).toBeNull();
  });

  it('协议版本不同 ⇒ 拒（先于应用版本判，因为它是更硬的那道）', () => {
    const why = versionMismatch({ ...STAMP, proto: STAMP.proto + 1 }, STAMP);
    expect(why).toContain('协议版本对不上');
    expect(why).toContain('同一份游戏文件');
  });

  it('应用版本不同 ⇒ 拒，并把两边版本号都写出来给人看', () => {
    const theirs = '9.9.9-other-build';
    const why = versionMismatch({ ...STAMP, app: theirs }, STAMP);
    expect(why).toContain(`对面 V${theirs}`);
    expect(why).toContain(`本机 V${STAMP.app}`);
  });

  it('快照版本不同 ⇒ 拒（局面数据形状变了就不能凑合连）', () => {
    expect(versionMismatch({ ...STAMP, snapshot: 99 }, STAMP)).toContain('快照版本对不上');
  });

  it('本机读数取自 package.json 与 StateSerializer，不是写死的字面量', () => {
    const ours = ourVersionStamp();
    expect(ours.proto).toBe(NET_PROTOCOL_VERSION);
    expect(ours.app).toMatch(/^\d+\.\d+\.\d+/);
    expect(ours.snapshot).toBe(NETWORK_SNAPSHOT_VERSION);
  });
});

describe('线上证人：信封只认这九种形状', () => {
  it('往返一致', () => {
    const envelope = { t: 'hello', from: 'a', name: '张三', v: STAMP } as const;
    expect(parseEnvelope(encodeEnvelope(envelope))).toEqual(envelope);
  });

  it('不是 JSON／不是对象／数组／未知类型／缺字段／字段类型错 ⇒ 全部拒收', () => {
    expect(parseEnvelope('')).toBeNull();
    expect(parseEnvelope('not json')).toBeNull();
    expect(parseEnvelope('null')).toBeNull();
    expect(parseEnvelope('[]')).toBeNull();
    expect(parseEnvelope('{"t":"chat","from":"a","text":"hi"}')).toBeNull();
    expect(parseEnvelope('{"t":"hello","from":"a"}')).toBeNull();
    expect(parseEnvelope('{"t":"hello","from":"a","name":1,"v":{}}')).toBeNull();
    expect(parseEnvelope('{"t":"welcome","from":"a","to":"","name":"h","v":{}}')).toBeNull();
    expect(parseEnvelope('{"t":"roster","from":"a","peers":[{"id":"b","name":"x"}]}')).toBeNull();
  });

  it('roster 收得下房主那份名单，且人数超过房间上限就整条拒', () => {
    const peers = Array.from({ length: 8 }, (_, i) => ({ id: `p${i}`, name: `玩家${i}`, role: 'guest' as const }));
    expect(parseEnvelope(encodeEnvelope({ t: 'roster', from: 'a', peers }))?.t).toBe('roster');
    expect(parseEnvelope(encodeEnvelope({ t: 'roster', from: 'a', peers: [...peers, { id: 'p9', name: '九', role: 'guest' }] }))).toBeNull();
  });

  it('bye 只要一个来路就够（离开不需要理由）', () => {
    expect(parseEnvelope('{"t":"bye","from":"a"}')).toEqual({ t: 'bye', from: 'a' });
  });
});

describe('名字是客人自报的 ⇒ 房主校验后回提示，不照收也不静默截断', () => {
  it('空名／超长／含尖括号或控制字符 ⇒ 各回一句原因', () => {
    expect(checkPeerName('   ').ok).toBe(false);
    expect(checkPeerName('一'.repeat(MAX_NAME_LENGTH + 1)).ok).toBe(false);
    expect(checkPeerName('<script>').ok).toBe(false);
    expect(checkPeerName('a\tb').ok).toBe(false);
    expect((checkPeerName('<script>') as { reason: string }).reason).toContain('不能用的字符');
    expect(checkPeerName('a\tb').ok).toBe(false);
  });

  it('正常名字前后空格去掉后收下', () => {
    expect(checkPeerName('  诸葛  ')).toEqual({ ok: true, name: '诸葛' });
  });
});

describe('J2 快照信封：协议层只认形状，看不懂的内容不在这里猜', () => {
  const VIEW = { version: 1, phase: 'turn', players: [] };

  it('房主发来的快照原样收下（内容留给客人端那道闸判）', () => {
    expect(parseEnvelope(encodeEnvelope({ t: 'snapshot', from: 'a', state: VIEW })))
      .toEqual({ t: 'snapshot', from: 'a', state: VIEW });
  });

  it('没有来路、或 state 不是对象／是数组／干脆没带 ⇒ 整条拒掉', () => {
    expect(parseEnvelope('{"t":"snapshot","state":{"a":1}}')).toBeNull();
    expect(parseEnvelope('{"t":"snapshot","from":"a","state":[1,2]}')).toBeNull();
    expect(parseEnvelope('{"t":"snapshot","from":"a","state":"局面"}')).toBeNull();
    expect(parseEnvelope('{"t":"snapshot","from":"a"}')).toBeNull();
  });

  it('超过单帧上限的快照直接不解析（房主手滑发了整份牌桌也不会撑爆）', () => {
    const huge = JSON.stringify({ t: 'snapshot', from: 'a', state: { pad: 'x'.repeat(MAX_WIRE_BYTES) } });
    expect(huge.length).toBeGreaterThan(MAX_WIRE_BYTES);
    expect(parseEnvelope(huge)).toBeNull();
  });
});

describe('J3 心跳三枚信封：探测、回话、连线表', () => {
  const ROWS = [
    { id: 'a', name: '房主', pingMs: null, state: 'online' as const },
    { id: 'b', name: '客人甲', pingMs: 37, state: 'online' as const },
    { id: 'c', name: '客人乙', pingMs: null, state: 'lost' as const },
  ];

  it('ping／pong 往返一致（时刻原样带过去，两端都只当它是个数）', () => {
    const ping = { t: 'ping', from: 'a', to: 'b', at: 1_700_000_000_000 } as const;
    const pong = { t: 'pong', from: 'b', to: 'a', at: ping.at } as const;
    expect(parseEnvelope(encodeEnvelope(ping))).toEqual(ping);
    expect(parseEnvelope(encodeEnvelope(pong))).toEqual(pong);
  });

  it('0 毫秒是个合法读数（同一刻回话＝真快，不是缺字段）', () => {
    expect(parseEnvelope('{"t":"pong","from":"b","to":"a","at":0}')).toEqual({ t: 'pong', from: 'b', to: 'a', at: 0 });
  });

  it('探测／回话缺收件人、时刻是字符串／负数／非有限值 ⇒ 整条拒（拿一条坏时刻算出来的毫秒数会污染全桌那张表）', () => {
    expect(parseEnvelope('{"t":"ping","from":"a","at":1}')).toBeNull();
    expect(parseEnvelope('{"t":"ping","from":"a","to":"","at":1}')).toBeNull();
    expect(parseEnvelope('{"t":"ping","from":"a","to":"b","at":"1"}')).toBeNull();
    expect(parseEnvelope('{"t":"ping","from":"a","to":"b","at":-5}')).toBeNull();
    expect(parseEnvelope('{"t":"pong","from":"a","to":"b","at":null}')).toBeNull();
    expect(parseEnvelope('{"t":"pong","from":"a","to":"b"}')).toBeNull();
    const nan = parseEnvelope('{"t":"ping","from":"a","to":"b","at":1e999}');
    expect(nan).toBeNull();
  });

  it('时刻可以是任意正数（它只是那台机器自己的钟，协议层不要求它是"现在"）', () => {
    expect(parseEnvelope('{"t":"ping","from":"a","to":"b","at":123.5}')).toEqual({ t: 'ping', from: 'a', to: 'b', at: 123.5 });
  });

  it('连线表原样收下：null 与数字两种 ping 值、在线与掉线两种状态都认', () => {
    expect(parseEnvelope(encodeEnvelope({ t: 'netstatus', from: 'a', rows: ROWS })))
      .toEqual({ t: 'netstatus', from: 'a', rows: ROWS });
  });

  it('表里混进一个坏字段就整条拒（不半收：宁可这张表晚一轮回，也不能显示一条猜出来的行）', () => {
    expect(parseEnvelope('{"t":"netstatus","from":"a","rows":[]}')).toBeNull();
    expect(parseEnvelope('{"t":"netstatus","from":"a"}')).toBeNull();
    expect(parseEnvelope('{"t":"netstatus","rows":[]}')).toBeNull();
    expect(parseEnvelope('{"t":"netstatus","from":"a","rows":[{"id":"b","name":"甲","state":"online","pingMs":-1}]}')).toBeNull();
    expect(parseEnvelope('{"t":"netstatus","from":"a","rows":[{"id":"b","name":"甲","state":"online","pingMs":1.5}]}')).toBeNull();
    expect(parseEnvelope('{"t":"netstatus","from":"a","rows":[{"id":"b","name":"甲","state":"offline","pingMs":null}]}')).toBeNull();
    expect(parseEnvelope('{"t":"netstatus","from":"a","rows":[{"id":"b","name":"","state":"online","pingMs":null}]}')).toBeNull();
    expect(parseEnvelope('{"t":"netstatus","from":"a","rows":[{"id":"b","state":"online","pingMs":null}]}')).toBeNull();
    expect(parseEnvelope('{"t":"netstatus","from":"a","rows":[{"id":"b","name":"甲","state":"online"}]}')).toBeNull();
  });

  it('ping 数字超过可信上限 ⇒ 整条拒（对面随便填一个天文数字也进不了这张表）', () => {
    expect(parseEnvelope(encodeEnvelope({ t: 'netstatus', from: 'a', rows: [{ id: 'b', name: '甲', pingMs: MAX_TRUSTED_PING_MS, state: 'online' }] }))?.t).toBe('netstatus');
    expect(parseEnvelope(encodeEnvelope({ t: 'netstatus', from: 'a', rows: [{ id: 'b', name: '甲', pingMs: MAX_TRUSTED_PING_MS + 1, state: 'online' }] }))).toBeNull();
  });

  it('名字超过界面那格的上限 ⇒ 拒（连线表里也不能塞进一个超长名字）', () => {
    expect(parseEnvelope(encodeEnvelope({ t: 'netstatus', from: 'a', rows: [{ id: 'b', name: '一'.repeat(MAX_NAME_LENGTH), pingMs: null, state: 'online' }] }))?.t).toBe('netstatus');
    expect(parseEnvelope(encodeEnvelope({ t: 'netstatus', from: 'a', rows: [{ id: 'b', name: '一'.repeat(MAX_NAME_LENGTH + 1), pingMs: null, state: 'online' }] }))).toBeNull();
  });

  it('行数超过房间上限同样整条拒，且未知类型照旧不收', () => {
    const rows = Array.from({ length: 8 }, (_, i) => ({ id: `p${i}`, name: `玩家${i}`, pingMs: null, state: 'online' as const }));
    expect(parseEnvelope(encodeEnvelope({ t: 'netstatus', from: 'a', rows }))?.t).toBe('netstatus');
    expect(parseEnvelope(encodeEnvelope({ t: 'netstatus', from: 'a', rows: [...rows, { id: 'p9', name: '九', pingMs: null, state: 'online' }] }))).toBeNull();
    expect(parseEnvelope('{"t":"heartbeat","from":"a","to":"b","at":1}')).toBeNull();
  });
});
