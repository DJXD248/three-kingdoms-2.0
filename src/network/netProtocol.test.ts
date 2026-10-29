import { describe, expect, it, vi } from 'vitest';
import { NETWORK_SNAPSHOT_VERSION } from './StateSerializer';
import {
  MAX_NAME_LENGTH,
  MAX_MOVE_ITEMS,
  MAX_OMITTED_MOVES,
  MAX_SEAT_ROWS,
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

  it('非安全上下文（`http://<一串 IP>`，没有 getRandomValues）⇒ 房主照样开得出房', () => {
    vi.stubGlobal('crypto', null);
    const code = createRoomCode();
    expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
    expect(normalizeRoomCode(code)).toBe(code);
    vi.unstubAllGlobals();
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

  // 切片③（v2.9.25）：快照多了一个"这一份是算给谁的"。协议层只认形状，
  // 采纳与否仍是客人端那一步判（netSession）。
  it('带 `to` 的快照原样带上那个收件人', () => {
    expect(parseEnvelope(encodeEnvelope({ t: 'snapshot', from: 'a', to: 'g-1', state: VIEW })))
      .toEqual({ t: 'snapshot', from: 'a', to: 'g-1', state: VIEW });
  });

  it('没带 `to` 的照旧收，而且线上不多一个字（那是全桌通用那份观战视图）', () => {
    const text = '{"t":"snapshot","from":"a","state":{"version":1}}';
    expect(parseEnvelope(text)).toEqual({ t: 'snapshot', from: 'a', state: { version: 1 } });
    expect(parseEnvelope(text)).not.toHaveProperty('to');
  });

  it('`to` 是个空串／非字符串／超长 ⇒ 整条拒掉，不留半截的收件人', () => {
    expect(parseEnvelope('{"t":"snapshot","from":"a","to":"","state":{"a":1}}')).toBeNull();
    expect(parseEnvelope('{"t":"snapshot","from":"a","to":7,"state":{"a":1}}')).toBeNull();
    expect(parseEnvelope(`{"t":"snapshot","from":"a","to":"${'x'.repeat(65)}","state":{"a":1}}`)).toBeNull();
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

describe('J4 四枚信封：席位表、能走的清单、客人交回的编号、退回说明', () => {
  const SEATS = [
    { peer: 'a', seat: 0, name: '房主' },
    { peer: 'b', seat: 1, name: '客人甲' },
    { peer: null, seat: 2, name: '玩家3' },
  ];
  const ITEMS = [
    { key: 'END_TURN|0|a1b2c3d4', label: '结束这一回合' },
    { key: 'ATTACK|0|99ff00aa', label: '用 关羽 打 玩家3' },
  ];

  it('席位表原样收下：有人坐的格、空着的格（peer:null）都认', () => {
    expect(parseEnvelope(encodeEnvelope({ t: 'seatmap', from: 'a', seats: SEATS })))
      .toEqual({ t: 'seatmap', from: 'a', seats: SEATS });
  });

  it('空席位表整条拒（房主那一格永远在表上，"谁都不坐"只可能是坏消息）', () => {
    expect(parseEnvelope('{"t":"seatmap","from":"a","seats":[]}')).toBeNull();
    expect(parseEnvelope('{"t":"seatmap","from":"a"}')).toBeNull();
    expect(parseEnvelope('{"t":"seatmap","seats":[]}')).toBeNull();
  });

  it('席位行里少一样、席位号不是整数或离谱、peer 是空串、名字超长或带控制字符 ⇒ 整条拒', () => {
    const bad = [
      '{"t":"seatmap","from":"a","seats":[{"seat":0,"name":"房主"}]}',
      '{"t":"seatmap","from":"a","seats":[{"peer":"a","name":"房主"}]}',
      '{"t":"seatmap","from":"a","seats":[{"peer":"a","seat":0}]}',
      '{"t":"seatmap","from":"a","seats":[{"peer":"a","seat":1.5,"name":"房主"}]}',
      '{"t":"seatmap","from":"a","seats":[{"peer":"a","seat":-1,"name":"房主"}]}',
      '{"t":"seatmap","from":"a","seats":[{"peer":"a","seat":65,"name":"房主"}]}',
      '{"t":"seatmap","from":"a","seats":[{"peer":"","seat":0,"name":"房主"}]}',
      '{"t":"seatmap","from":"a","seats":[{"peer":"a","seat":0,"name":""}]}',
      `{"t":"seatmap","from":"a","seats":[{"peer":"a","seat":0,"name":"${'一'.repeat(MAX_NAME_LENGTH + 1)}"}]}`,
      '{"t":"seatmap","from":"a","seats":[{"peer":"a","seat":0,"name":"甲\\u0001"}]}',
    ];
    for (const text of bad) expect(parseEnvelope(text)).toBeNull();
    const nine = Array.from({ length: 9 }, (_, i) => ({ peer: `p${i}`, seat: i, name: `玩家${i}` }));
    expect(parseEnvelope(encodeEnvelope({ t: 'seatmap', from: 'a', seats: nine.slice(0, MAX_SEAT_ROWS) })))
      .toEqual({ t: 'seatmap', from: 'a', seats: nine.slice(0, MAX_SEAT_ROWS) });
    expect(parseEnvelope(encodeEnvelope({ t: 'seatmap', from: 'a', seats: nine }))).toBeNull();
  });

  it('清单原样收下，且**空清单是一条真话**（这一席此刻一步也走不了，界面要显示这句而不是留着旧按钮）', () => {
    expect(parseEnvelope(encodeEnvelope({ t: 'moves', from: 'a', to: 'b', seat: 1, items: ITEMS, omitted: 0 })))
      .toEqual({ t: 'moves', from: 'a', to: 'b', seat: 1, items: ITEMS, omitted: 0 });
    expect(parseEnvelope('{"t":"moves","from":"a","to":"b","seat":1,"items":[],"omitted":0}')).toEqual({ t: 'moves', from: 'a', to: 'b', seat: 1, items: [], omitted: 0 });
  });

  it('封顶后"还有几步没列出来"必须是个安全的非负整数——缺了它、负数、小数、离谱大数都整条拒', () => {
    // 挤掉条数是界面上那句真话的分母；没有分母的"这是全部"＝骗人。
    expect(parseEnvelope('{"t":"moves","from":"a","to":"b","seat":1,"items":[],"omitted":57}'))
      .toEqual({ t: 'moves', from: 'a', to: 'b', seat: 1, items: [], omitted: 57 });
    for (const text of [
      '{"t":"moves","from":"a","to":"b","seat":1,"items":[]}',
      '{"t":"moves","from":"a","to":"b","seat":1,"items":[],"omitted":-1}',
      '{"t":"moves","from":"a","to":"b","seat":1,"items":[],"omitted":1.5}',
      '{"t":"moves","from":"a","to":"b","seat":1,"items":[],"omitted":"3"}',
      '{"t":"moves","from":"a","to":"b","seat":1,"items":[],"omitted":10001}',
    ]) expect(parseEnvelope(text)).toBeNull();
    expect(parseEnvelope(`{"t":"moves","from":"a","to":"b","seat":1,"items":[],"omitted":${MAX_OMITTED_MOVES}}`)).not.toBeNull();
  });

  it('清单缺收件人／席位号不对／编号或句子是空的、超长、带控制字符 ⇒ 整条拒', () => {
    const bad = [
      '{"t":"moves","from":"a","seat":1,"items":[],"omitted":0}',
      '{"t":"moves","from":"a","to":"","seat":1,"items":[],"omitted":0}',
      '{"t":"moves","from":"a","to":"b","items":[],"omitted":0}',
      '{"t":"moves","from":"a","to":"b","seat":"1","items":[],"omitted":0}',
      '{"t":"moves","from":"a","to":"b","seat":1,"omitted":0}',
      '{"t":"moves","from":"a","to":"b","seat":1,"items":[{"key":"","label":"结束这一回合"}],"omitted":0}',
      `{"t":"moves","from":"a","to":"b","seat":1,"items":[{"key":"k","label":"${'一'.repeat(61)}"}],"omitted":0}`,
      '{"t":"moves","from":"a","to":"b","seat":1,"items":[{"key":"k\\u0007","label":"x"}],"omitted":0}',
      '{"t":"moves","from":"a","to":"b","seat":1,"items":[{"label":"x"}],"omitted":0}',
      '{"t":"moves","from":"a","to":"b","seat":1,"items":[{"key":"k"}],"omitted":0}',
      '{"t":"moves","from":"a","to":"b","seat":1,"items":[{"key":65,"label":"x"}],"omitted":0}',
    ];
    for (const text of bad) expect(parseEnvelope(text)).toBeNull();
    const many = Array.from({ length: MAX_MOVE_ITEMS + 1 }, (_, i) => ({ key: `k${i}`, label: `第${i}步` }));
    expect(parseEnvelope(encodeEnvelope({ t: 'moves', from: 'a', to: 'b', seat: 1, items: many, omitted: 0 }))).toBeNull();
    expect(parseEnvelope(encodeEnvelope({ t: 'moves', from: 'a', to: 'b', seat: 1, items: many.slice(0, 32), omitted: 1 })))
      .toEqual({ t: 'moves', from: 'a', to: 'b', seat: 1, items: many.slice(0, 32), omitted: 1 });
  });

  it('客人交回的只有席位与编号——牌面内容压根没有地方放', () => {
    expect(parseEnvelope(encodeEnvelope({ t: 'act', from: 'b', to: 'a', seat: 1, key: ITEMS[0].key })))
      .toEqual({ t: 'act', from: 'b', to: 'a', seat: 1, key: ITEMS[0].key });
    const extra = parseEnvelope('{"t":"act","from":"b","to":"a","seat":1,"key":"k","payload":{"general":{"name":"关羽"}}}');
    expect(extra).toEqual({ t: 'act', from: 'b', to: 'a', seat: 1, key: 'k' });
    for (const text of [
      '{"t":"act","from":"b","to":"a","seat":1}',
      '{"t":"act","from":"b","seat":1,"key":"k"}',
      '{"t":"act","from":"b","to":"a","seat":1,"key":""}',
      `{"t":"act","from":"b","to":"a","seat":1,"key":"${'k'.repeat(65)}"}`,
      '{"t":"act","from":"b","to":"a","seat":null,"key":"k"}',
    ]) expect(parseEnvelope(text)).toBeNull();
  });

  it('退回必须带一句人读的原因；空原因、超长原因都整条拒（只说不行不说为什么＝让人瞎猜）', () => {
    expect(parseEnvelope(encodeEnvelope({ t: 'actno', from: 'a', to: 'b', key: 'k', reason: '这一席现在不是你的回合' })))
      .toEqual({ t: 'actno', from: 'a', to: 'b', key: 'k', reason: '这一席现在不是你的回合' });
    expect(parseEnvelope('{"t":"actno","from":"a","to":"b","key":"k","reason":""}')).toBeNull();
    expect(parseEnvelope('{"t":"actno","from":"a","to":"b","key":"k"}')).toBeNull();
    expect(parseEnvelope(encodeEnvelope({ t: 'actno', from: 'a', to: 'b', key: 'k', reason: '一'.repeat(121) }))).toBeNull();
    expect(parseEnvelope(encodeEnvelope({ t: 'actno', from: 'a', to: 'b', key: 'k', reason: '一'.repeat(120) }))).not.toBeNull();
  });

  it('协议版本仍为 1：这四枚是同版本内的新形状，不是把老信封改了样子', () => {
    expect(NET_PROTOCOL_VERSION).toBe(1);
    expect(ourVersionStamp().proto).toBe(1);
  });
});
