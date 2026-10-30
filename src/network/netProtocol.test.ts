import { describe, expect, it, vi } from 'vitest';
import { NETWORK_SNAPSHOT_VERSION } from './StateSerializer';
import {
  MAX_DRAFT_PICK_COUNT,
  MAX_DRAFT_PROGRESS_ROWS,
  MAX_NAME_LENGTH,
  MAX_MOVE_ITEMS,
  MAX_OMITTED_MOVES,
  MAX_READY_ROWS,
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
  type NetDraftProgressRow,
  type NetReadyRow,
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

describe('线上证人：信封只认这十六种形状', () => {
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

/**
 * 切片⑤a（v2.9.25）那两枚：客人交回的那一颗准备钮，与房主算给全桌的那张准备表。
 * 与前面每一枚同一纪律——协议层只认形状；「谁还算数、闸门开不开」是房主那台机器算的事。
 */
describe('⑤a 准备两枚信封：一个布尔与一张表', () => {
  const ROWS: NetReadyRow[] = [
    { peer: 'b', name: '客人甲', on: true, counted: true },
    { peer: 'c', name: '客人乙', on: false, counted: true },
    { peer: 'd', name: '客人丙', on: false, counted: false },
  ];

  it('往返一致：钮上只有"我点没点"，表上只有"这人是谁、点没点、还等不等他"', () => {
    const btn = { t: 'ready', from: 'b', to: 'a', on: true } as const;
    expect(parseEnvelope(encodeEnvelope(btn))).toEqual(btn);
    expect(parseEnvelope(encodeEnvelope({ t: 'readytable', from: 'a', rows: ROWS })))
      .toEqual({ t: 'readytable', from: 'a', rows: ROWS });
  });

  it('`on:false` 是个真话，不是缺字段（取消准备与没点过在账上是两笔，协议层都收得下）', () => {
    expect(parseEnvelope('{"t":"ready","from":"b","to":"a","on":false}'))
      .toEqual({ t: 'ready', from: 'b', to: 'a', on: false });
  });

  it('钮上多塞东西没有地方放：牌面、席位、"我要直接开始游戏"都跟着不上线', () => {
    const trimmed = parseEnvelope('{"t":"ready","from":"b","to":"a","on":true,"seat":1,"general":{"name":"关羽"},"start":true}');
    expect(trimmed).toEqual({ t: 'ready', from: 'b', to: 'a', on: true });
    expect(trimmed).not.toHaveProperty('seat');
    expect(trimmed).not.toHaveProperty('general');
    expect(trimmed).not.toHaveProperty('start');
  });

  it('钮缺来路／缺收件人／`on` 不是布尔（字符串、数字、干脆没带）⇒ 整条拒', () => {
    const bad = [
      '{"t":"ready","to":"a","on":true}',
      '{"t":"ready","from":"b","on":true}',
      '{"t":"ready","from":"b","to":"a"}',
      '{"t":"ready","from":"b","to":"a","on":"yes"}',
      '{"t":"ready","from":"b","to":"a","on":1}',
      '{"t":"ready","from":"b","to":"a","on":null}',
      '{"t":"ready","from":"b","to":"","on":true}',
      `{"t":"ready","from":"b","to":"${'x'.repeat(65)}","on":true}`,
    ];
    for (const text of bad) expect(parseEnvelope(text)).toBeNull();
  });

  it('空表在这里是**一句真话**：屋里一个客人都没有＝没人在等，闸门开着（与 netstatus／seatmap 反着来的一处）', () => {
    expect(parseEnvelope('{"t":"readytable","from":"a","rows":[]}')).toEqual({ t: 'readytable', from: 'a', rows: [] });
  });

  it('表里少一样、名字超长或带控制字符、两个判据不是布尔 ⇒ 整条拒（半收＝界面上显示一条猜出来的行）', () => {
    const bad = [
      '{"t":"readytable","rows":[]}',
      '{"t":"readytable","from":"a"}',
      '{"t":"readytable","from":"a","rows":"b"}',
      '{"t":"readytable","from":"a","rows":[{"name":"甲","on":true,"counted":true}]}',
      '{"t":"readytable","from":"a","rows":[{"peer":"","name":"甲","on":true,"counted":true}]}',
      '{"t":"readytable","from":"a","rows":[{"peer":"b","on":true,"counted":true}]}',
      '{"t":"readytable","from":"a","rows":[{"peer":"b","name":"","on":true,"counted":true}]}',
      `{"t":"readytable","from":"a","rows":[{"peer":"b","name":"${'一'.repeat(MAX_NAME_LENGTH + 1)}","on":true,"counted":true}]}`,
      '{"t":"readytable","from":"a","rows":[{"peer":"b","name":"甲\\u0001","on":true,"counted":true}]}',
      '{"t":"readytable","from":"a","rows":[{"peer":"b","name":"甲","on":"yes","counted":true}]}',
      '{"t":"readytable","from":"a","rows":[{"peer":"b","name":"甲","on":true,"counted":1}]}',
      '{"t":"readytable","from":"a","rows":[{"peer":"b","name":"甲","on":true}]}',
    ];
    for (const text of bad) expect(parseEnvelope(text)).toBeNull();
    // 牌面没有地方跟着这张表上线：走私一个 `state` 进来，它被整段丢掉，
    // 解析出来的仍然只有来路与那几行（与 `act` 那条同一纪律）。
    const smuggled = parseEnvelope('{"t":"readytable","from":"a","rows":[],"state":{"deck":[{"id":"guan"}]}}');
    expect(smuggled).toEqual({ t: 'readytable', from: 'a', rows: [] });
    expect(smuggled).not.toHaveProperty('state');
    expect(parseEnvelope(encodeEnvelope({ t: 'readytable', from: 'a', rows: [{ peer: 'b', name: '甲', on: true, counted: true }] })))
      .toEqual({ t: 'readytable', from: 'a', rows: [{ peer: 'b', name: '甲', on: true, counted: true }] });
  });

  it('行数超过名册上界 ⇒ 整条拒（准备表一行都多不出名册之外）', () => {
    const nine = Array.from({ length: 9 }, (_, i) => ({ peer: `p${i}`, name: `玩家${i}`, on: false, counted: true }));
    expect(parseEnvelope(encodeEnvelope({ t: 'readytable', from: 'a', rows: nine.slice(0, MAX_READY_ROWS) })))
      .not.toBeNull();
    expect(parseEnvelope(encodeEnvelope({ t: 'readytable', from: 'a', rows: nine }))).toBeNull();
  });

  it('协议版本仍为 1：这两枚是同版本内的新形状，老信封一个字节没改', () => {
    expect(NET_PROTOCOL_VERSION).toBe(1);
    expect(ourVersionStamp().proto).toBe(1);
  });
});

/**
 * 切片⑤b（v2.9.25）那一枚：房主算给全桌的征召进度表。
 * 这一枚存在的意义是"客人有权知道走到哪儿了"，而它**能说的只有数量**——
 * 用户 2026-10-30 裁：「和热座一样」不延伸到别人那几格的私有信息。
 * 所以形状里压根没有放牌的地方：行内五个字段，两个是数，三个是座次与称呼。
 */
describe('⑤b 征召进度表信封：一席一行，只有座次与两个数', () => {
  const ROWS: NetDraftProgressRow[] = [
    { seat: 1, name: '玩家1', state: 'done', picked: 10, total: 10 },
    { seat: 2, name: '假客人', state: 'picking', picked: 7, total: 10 },
    { seat: 3, name: 'AI·平衡', state: 'waiting', picked: 0, total: 10 },
  ];

  it('往返一致：房主发的表原样收回来，一个字段不多、一个不少', () => {
    expect(parseEnvelope(encodeEnvelope({ t: 'draftprogress', from: 'a', rows: ROWS })))
      .toEqual({ t: 'draftprogress', from: 'a', rows: ROWS });
  });

  it('牌面没有地方跟着这张表上线：走私 `state`／`generals` 进来，整段被丢掉', () => {
    const smuggled = parseEnvelope('{"t":"draftprogress","from":"a","rows":[{"seat":2,"name":"甲","state":"picking","picked":1,"total":10}],"generals":["关羽"]}');
    expect(smuggled).toEqual({ t: 'draftprogress', from: 'a', rows: [{ seat: 2, name: '甲', state: 'picking', picked: 1, total: 10 }] });
    expect(smuggled).not.toHaveProperty('generals');
    expect(smuggled).not.toHaveProperty('state');
    // 行里多塞一个牌名 ⇒ 整条拒（这一行不是"顺带多个字段"，是这张表根本不该有的东西）
    expect(parseEnvelope('{"t":"draftprogress","from":"a","rows":[{"seat":2,"name":"甲","state":"picking","picked":1,"total":10,"general":{"name":"关羽"}}]}'))
      .toEqual({ t: 'draftprogress', from: 'a', rows: [{ seat: 2, name: '甲', state: 'picking', picked: 1, total: 10 }] });
  });

  it('空表＝坏消息（与 netstatus／seatmap 同一判据）：没话可说的时候房主根本不发这一条', () => {
    expect(parseEnvelope('{"t":"draftprogress","from":"a","rows":[]}')).toBeNull();
  });

  it('缺来路／rows 不是数组／行不是对象 ⇒ 整条拒', () => {
    const bad = [
      '{"t":"draftprogress","rows":[]}',
      '{"t":"draftprogress","from":"a"}',
      '{"t":"draftprogress","from":"a","rows":"b"}',
      '{"t":"draftprogress","from":"a","rows":[null]}',
      '{"t":"draftprogress","from":"a","rows":[[]]}',
    ];
    for (const text of bad) expect(parseEnvelope(text)).toBeNull();
  });

  it('行里少一样、座次不是整数席位号、名字空或超长、状态第三种说法 ⇒ 整条拒（半收＝界面上显示一条猜出来的进度）', () => {
    const row = { seat: 2, name: '甲', state: 'picking', picked: 1, total: 10 };
    const cases: [string, Record<string, unknown> | null][] = [
      ['缺 seat', { name: '甲', state: 'picking', picked: 1, total: 10 }],
      ['seat 是字符串', { ...row, seat: '2' }],
      ['seat 不是整数', { ...row, seat: 1.5 }],
      ['seat 超出席位上界', { ...row, seat: 65 }],
      ['name 是空的', { ...row, name: '' }],
      [`name 超过 ${MAX_NAME_LENGTH} 个字`, { ...row, name: '一'.repeat(MAX_NAME_LENGTH + 1) }],
      ['name 带控制字符', { ...row, name: '甲\u0001' }],
      ['state 是这张表不该有的说法', { ...row, state: 'drafting' }],
      ['state 干脆没带', { seat: 2, name: '甲', picked: 1, total: 10 }],
      ['picked 是字符串', { ...row, picked: '1' }],
      ['picked 是负数', { ...row, picked: -1 }],
      ['picked 不是整数', { ...row, picked: 1.5 }],
      ['picked 没带', { seat: 2, name: '甲', state: 'picking', total: 10 }],
      ['total 没带', { seat: 2, name: '甲', state: 'picking', picked: 1 }],
      ['total 是 null', { ...row, total: null }],
    ];
    for (const [, mutated] of cases) {
      expect(parseEnvelope(JSON.stringify({ t: 'draftprogress', from: 'a', rows: [mutated] }))).toBeNull();
    }
  });

  it('`picked > total` 照样收：已完成那一行的数是照着那一席的池子抄的，沙盒能填出任何数——宁可显示一个真怪数，不可把一帧真话判成假消息', () => {
    expect(parseEnvelope(encodeEnvelope({ t: 'draftprogress', from: 'a', rows: [{ seat: 1, name: '甲', state: 'done', picked: 12, total: 10 }] })))
      .not.toBeNull();
  });

  it('两个数各自的封顶：合法征召到不了那个数，到了就是坏消息', () => {
    const huge: NetDraftProgressRow = { seat: 1, name: '甲', state: 'done', picked: MAX_DRAFT_PICK_COUNT, total: MAX_DRAFT_PICK_COUNT };
    expect(parseEnvelope(encodeEnvelope({ t: 'draftprogress', from: 'a', rows: [huge] }))).not.toBeNull();
    expect(parseEnvelope(encodeEnvelope({ t: 'draftprogress', from: 'a', rows: [{ ...huge, picked: MAX_DRAFT_PICK_COUNT + 1 }] }))).toBeNull();
    expect(parseEnvelope(encodeEnvelope({ t: 'draftprogress', from: 'a', rows: [{ ...huge, total: MAX_DRAFT_PICK_COUNT + 1 }] }))).toBeNull();
  });

  it('行数超过一桌的席位上界 ⇒ 整条拒（进度表多出来的那一行没有椅子坐）', () => {
    const rows = Array.from({ length: MAX_DRAFT_PROGRESS_ROWS }, (_, i) => ({ seat: i + 1, name: `玩家${i}`, state: 'waiting' as const, picked: 0, total: 10 }));
    expect(parseEnvelope(encodeEnvelope({ t: 'draftprogress', from: 'a', rows }))).not.toBeNull();
    expect(parseEnvelope(encodeEnvelope({ t: 'draftprogress', from: 'a', rows: [...rows, { seat: 9, name: '第九席', state: 'waiting', picked: 0, total: 10 }] })))
      .toBeNull();
  });

  it('这张表不指名（`to` 不是它的字段）：它是全桌广播的那一种，指名的那条路这一版没建', () => {
    const pointed = parseEnvelope('{"t":"draftprogress","from":"a","to":"b","rows":[{"seat":1,"name":"甲","state":"done","picked":10,"total":10}]}');
    expect(pointed).toEqual({ t: 'draftprogress', from: 'a', rows: [{ seat: 1, name: '甲', state: 'done', picked: 10, total: 10 }] });
    expect(pointed).not.toHaveProperty('to');
  });

  it('协议版本仍为 1：这一枚是同版本内的新形状，老信封一个字节没改', () => {
    expect(NET_PROTOCOL_VERSION).toBe(1);
    expect(ourVersionStamp().proto).toBe(1);
  });
});
