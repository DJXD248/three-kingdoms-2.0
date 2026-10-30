/**
 * J1 大厅（联网对战）界面证人：房间码看得见、地址错了有拒因、名单以房主那份为准、
 * 被拒时把原因原文显示，并且界面上写明"还没做到哪一步"——不让人误以为已经能开一局联机。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import OnlineLobby from './OnlineLobby';
import { NET_PROTOCOL_VERSION, encodeEnvelope, ourVersionStamp, type NetEnvelope } from '../network/netProtocol';
import { buildBroadcastView } from '../network/snapshotView';
import { detachRoom, getActiveRoom } from '../network/netRoom';

class FakeWebSocket {
  static readonly created: FakeWebSocket[] = [];

  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code?: number; reason?: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  readonly sent: string[] = [];

  constructor(readonly url: string) {
    FakeWebSocket.created.push(this);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.readyState = 3;
  }

  get lastSent(): NetEnvelope | null {
    const raw = this.sent[this.sent.length - 1];
    return raw ? (JSON.parse(raw) as NetEnvelope) : null;
  }
}

const text = () => document.body.textContent ?? '';

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** 受控输入必须走原生 setter＋input 事件，直接改 value 不会进 React 的 state。 */
async function typeInto(input: HTMLElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  await act(async () => {
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function clickButton(name: RegExp) {
  await act(async () => {
    screen.getByRole('button', { name }).click();
  });
}

/** 传话线通了（浏览器真会晚一帧才回调 onopen，这里同样让它走一次 flush）。 */
async function openLine(socket: FakeWebSocket) {
  await act(async () => {
    socket.readyState = 1;
    socket.onopen?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function receive(socket: FakeWebSocket, envelope: NetEnvelope) {
  await act(async () => {
    socket.onmessage?.({ data: encodeEnvelope(envelope) });
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** 切到客人、填房间码、点进房间、线通，返回那条假线。 */
async function dialRoom(code: string) {
  await clickButton(/^我去别人房间/);
  await typeInto(screen.getByPlaceholderText('例如 K7M2QX'), code);
  await clickButton(/^🚪 进房间/);
  const socket = FakeWebSocket.created[FakeWebSocket.created.length - 1];
  await openLine(socket);
  return socket;
}

const myId = (socket: FakeWebSocket) => (socket.lastSent as { from: string }).from;

beforeEach(() => {
  FakeWebSocket.created.length = 0;
  vi.stubGlobal('WebSocket', FakeWebSocket);
});

afterEach(() => {
  cleanup();
  detachRoom(); // 连线住在房间里而不是弹窗上：不清就会串到下一条证人
  vi.unstubAllGlobals();
});

describe('主菜单的联网大厅：连得上、看得懂、不夸大', () => {
  it('开房间：当场生成六位房间码，连接地址是"地址/房间码/本机身份号"', async () => {
    render(<OnlineLobby onClose={() => {}} />);
    expect(text()).toContain('我开房间');

    await clickButton(/^🏠 开房间/);
    await settle();

    const socket = FakeWebSocket.created[0];
    // 切片⑥：网址多了第二段 ⇒ 房间码不再等于"最后一段"（老写法 `.split('/').pop()` 在这一版取到的是
    // 身份号，六位大写那条正则当场会红）。这里按段取，"房间码的形状"与"身份号的形状"各立一条断言。
    const segments = socket.url.split('/');
    const code = segments[3];
    const peerInUrl = segments[4];
    expect(code).toMatch(/^[A-Z0-9]{6}$/);
    expect(socket.url).toBe(`ws://127.0.0.1:8787/${code}/${peerInUrl}`);
    // 身份号必须过传话程序那道形状门（它按这一串绑定连接；越界的号进路径会把网址切成三段）。
    expect(peerInUrl).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
    expect(text()).toContain(code);
    expect(text()).toContain('等别人输房间码进来');
  });

  it('地址填错（少了 ws://）⇒ 界面给一句人读的拒因，一条线都不建', async () => {
    render(<OnlineLobby onClose={() => {}} />);
    await typeInto(screen.getByDisplayValue('ws://127.0.0.1:8787'), '127.0.0.1:8787');
    await clickButton(/^🏠 开房间/);

    expect(text()).toContain('地址要以 ws:// 或 wss:// 开头');
    expect(FakeWebSocket.created).toHaveLength(0);
  });

  it('客人：填同一个地址＋房间码就报到，hello 里带本机三样版本', async () => {
    render(<OnlineLobby onClose={() => {}} />);
    const socket = await dialRoom('k7m2qx');
    expect(socket.url).toMatch(/^ws:\/\/127\.0\.0\.1:8787\/K7M2QX\/[A-Za-z0-9_-]{1,64}$/);
    // 切片⑥：网址上那串号与 hello 里自报的那串号必须出自同一次取数。分成两次取数就会出现
    // "网址绑的是甲、帧里自报的是乙"，那份指名给乙的信就没人收——这一条量的就是那个错位。
    expect(socket.url.endsWith(`/${myId(socket)}`)).toBe(true);
    expect(text()).toContain('正在对上版本');

    expect(socket.lastSent).toMatchObject({ t: 'hello', name: '玩家', v: ourVersionStamp() });
    expect(myId(socket).length).toBeGreaterThan(0);
  });

  it('房主 welcome 且版本一致 ⇒ 状态变成已连上，写明连上了谁', async () => {
    render(<OnlineLobby onClose={() => {}} />);
    const socket = await dialRoom('AAAAAA');
    await receive(socket, { t: 'welcome', from: 'host-9', to: myId(socket), name: '房主乙', v: ourVersionStamp() });

    expect(text()).toContain('已连上房主「房主乙」');
  });

  it('被拒 ⇒ 界面原文写出原因，还留在大厅（不半连）', async () => {
    render(<OnlineLobby onClose={() => {}} />);
    const socket = await dialRoom('AAAAAA');
    await receive(socket, {
      t: 'refuse',
      from: 'host-9',
      to: myId(socket),
      reason: `协议版本对不上：对面 ${NET_PROTOCOL_VERSION + 1}，本机 ${NET_PROTOCOL_VERSION}——两边请打开同一份游戏文件`,
    });

    expect(text()).toContain('被拒（没连上）');
    expect(text()).toContain('没让进房，原因是：协议版本对不上');
    expect(text()).not.toContain('已连上房主');
  });

  it('名单以房主广播的那份为准；自己的名字后面标「（我）」', async () => {
    render(<OnlineLobby onClose={() => {}} />);
    const socket = await dialRoom('ZZZZZZ');
    await receive(socket, {
      t: 'roster',
      from: 'host-9',
      peers: [
        { id: 'host-9', name: '房主乙', role: 'host' },
        { id: myId(socket), name: '玩家', role: 'guest' },
      ],
    });

    expect(text()).toContain('在场名单（共 2 人）');
    expect(text()).toContain('房主乙');
    expect(text()).toContain('玩家（我）');
    expect(text()).toContain('房主·算牌');
  });

  it('离开房间会打招呼并关掉线', async () => {
    render(<OnlineLobby onClose={() => {}} />);
    const socket = await dialRoom('BBBBBB');
    await clickButton(/^离开房间/);

    expect(socket.lastSent?.t).toBe('bye');
    expect(socket.readyState).toBe(3);
    expect(text()).toContain('我开房间');
  });

  it('界面上写明做到哪儿、哪儿还没做：客人动手（J4）已落地，剩掉线两选一＝J5 与局外投票＝J6', async () => {
    render(<OnlineLobby onClose={() => {}} />);
    expect(text()).toContain('掉线之后那两选一');
    expect(text()).toContain('客人动手（J4）现在做到');
    expect(text()).not.toContain('客人动手与座位绑定＝J4');
    expect(text()).not.toContain('ping 表与掉线判定（J3）');
    expect(text()).not.toContain('牌桌画面同步（J2）');

    await clickButton(/^🏠 开房间/);
    await settle();
    expect(text()).toContain('客人动手（J4）现在做到');
  });

  it('J3：客人收到探测 ⇒ 原样把时刻抄回去，且自己一条探测/连线表也不发', async () => {
    render(<OnlineLobby onClose={() => {}} />);
    const socket = await dialRoom('PPPPPP');
    const me = myId(socket);
    await receive(socket, { t: 'welcome', from: 'host-9', to: me, name: '房主乙', v: ourVersionStamp() });
    await receive(socket, { t: 'roster', from: 'host-9', peers: [{ id: 'host-9', name: '房主乙', role: 'host' }, { id: me, name: '玩家', role: 'guest' }] });
    socket.sent.length = 0;

    await receive(socket, { t: 'ping', from: 'host-9', to: me, at: 1_700_000_000_456 });
    expect(socket.sent).toEqual([encodeEnvelope({ t: 'pong', from: me, to: 'host-9', at: 1_700_000_000_456 })]);

    // 别人（不是房主）的探测也不代答——两个人同名不能互相顶缸。
    socket.sent.length = 0;
    await receive(socket, { t: 'ping', from: 'guest-x', to: 'someone-else', at: 1 });
    expect(socket.sent).toEqual([]);
  });

  it('J3：房主算好的那张表在客人屏上原样显示，含"这是往返时间"那句如实话', async () => {
    render(<OnlineLobby onClose={() => {}} />);
    const socket = await dialRoom('QQQQQQ');
    await receive(socket, { t: 'welcome', from: 'host-9', to: myId(socket), name: '房主乙', v: ourVersionStamp() });
    await receive(socket, { t: 'roster', from: 'host-9', peers: [{ id: 'host-9', name: '房主乙', role: 'host' }, { id: myId(socket), name: '玩家', role: 'guest' }] });

    expect(text()).not.toContain('连线情况');
    await receive(socket, {
      t: 'netstatus', from: 'host-9',
      rows: [
        { id: 'host-9', name: '房主乙', pingMs: null, state: 'online' },
        { id: myId(socket), name: '玩家', pingMs: 42, state: 'online' },
      ],
    });
    expect(text()).toContain('连线情况（2 人·全桌公开）');
    expect(text()).toContain('42 毫秒');
    // 还没量到写成"还没回话"，不能写成 0 毫秒（没测到 ≠ 测到 0）。
    expect(text()).toContain('还没回话');
    expect(text()).toContain('房主那台机器');

    // 房主判出来的掉线，客人这边只是照抄：写明谁、并说清那两选一还没做。
    await receive(socket, {
      t: 'netstatus', from: 'host-9',
      rows: [
        { id: 'host-9', name: '房主乙', pingMs: null, state: 'online' },
        { id: myId(socket), name: '玩家', pingMs: null, state: 'lost' },
      ],
    });
    expect(text()).toContain('掉线了（15 秒没收到他任何一条消息）');
    expect(text()).toContain('J5');
    expect(text()).not.toContain('42 毫秒');
  });

  it('J3：不是房主发来的表不上屏（谁都能喊一句"某某掉线了"就成了假通告）', async () => {
    render(<OnlineLobby onClose={() => {}} />);
    const socket = await dialRoom('RRRRRR');
    await receive(socket, { t: 'welcome', from: 'host-9', to: myId(socket), name: '房主乙', v: ourVersionStamp() });
    await receive(socket, { t: 'roster', from: 'host-9', peers: [{ id: 'host-9', name: '房主乙', role: 'host' }, { id: myId(socket), name: '玩家', role: 'guest' }] });

    await receive(socket, {
      t: 'netstatus', from: 'guest-x',
      rows: [{ id: 'host-9', name: '房主乙', pingMs: null, state: 'lost' }],
    });
    expect(text()).not.toContain('连线情况');
    expect(text()).toContain('收到不是房主发来的连线表，已忽略');
  });

  it('J2：客人收到房主的遮蔽局面 ⇒ 屏幕上出现同一局的牌桌，牌桌那一格只画局面', async () => {
    render(<OnlineLobby onClose={() => {}} />);
    const socket = await dialRoom('DDDDDD');
    await receive(socket, { t: 'welcome', from: 'host-9', to: myId(socket), name: '房主乙', v: ourVersionStamp() });
    await receive(socket, { t: 'roster', from: 'host-9', peers: [{ id: 'host-9', name: '房主乙', role: 'host' }, { id: myId(socket), name: '玩家', role: 'guest' }] });

    expect(text()).toContain('还没收到房主发来的局面');
    await receive(socket, { t: 'snapshot', from: 'host-9', state: maskedView() as unknown as Record<string, unknown> });
    await settle();

    expect(text()).toContain('这一局由房主算牌，这里只画局面');
    expect(text()).toContain('第 4 轮');
    expect(text()).toContain('轮到房主乙');
    expect(text()).toContain('🏯6');
    expect(text()).toContain('🃏3 张');
    expect(text()).toContain('赵云');
    // 反向证人：屏上出现的是数量，牌面内容根本没上线
    expect(text()).not.toContain('暗牌-p1-h1');
    expect(socket.sent.join('')).not.toContain('p1-h1');
  });

  it('J2：关掉这个小窗不退房——连线还在；点「离开房间」才道别', async () => {
    const { unmount } = render(<OnlineLobby onClose={() => {}} />);
    const socket = await dialRoom('EEEEEE');
    await receive(socket, { t: 'welcome', from: 'host-9', to: myId(socket), name: '房主乙', v: ourVersionStamp() });
    await receive(socket, { t: 'roster', from: 'host-9', peers: [{ id: 'host-9', name: '房主乙', role: 'host' }] });

    unmount();
    expect(getActiveRoom()).not.toBeNull();
    expect(socket.lastSent?.t).not.toBe('bye');
    expect(socket.readyState).toBe(1);

    render(<OnlineLobby onClose={() => {}} />);
    await settle();
    expect(text()).toContain('在场名单（共 1 人）');
    expect(text()).toContain('房主乙');

    await clickButton(/^离开房间/);
    expect(socket.lastSent?.t).toBe('bye');
    expect(getActiveRoom()).toBeNull();
  });

  it('J4：客人屏上出现房主发来的席位表与清单 ⇒ 点出去的那一条线上只有席位号与编号', async () => {
    render(<OnlineLobby onClose={() => {}} />);
    const socket = await dialRoom('JJJJJJ');
    const me = myId(socket);
    await receive(socket, { t: 'welcome', from: 'host-9', to: me, name: '房主乙', v: ourVersionStamp() });
    await receive(socket, {
      t: 'roster', from: 'host-9',
      peers: [{ id: 'host-9', name: '房主乙', role: 'host' }, { id: me, name: '玩家', role: 'guest' }],
    });

    // 席位表还没来 ⇒ 一个能按的按钮都不许有
    expect(text()).toContain('还没收到席位表');
    expect(screen.queryAllByRole('button', { name: /结束回合/ })).toHaveLength(0);

    await receive(socket, {
      t: 'seatmap', from: 'host-9',
      seats: [{ peer: 'host-9', seat: 1, name: '房主乙' }, { peer: me, seat: 2, name: '玩家' }],
    });
    expect(text()).toContain('你坐第 2 席');

    // 清单没来之前同样没有按钮：椅子排到了不等于现在有事可做。
    expect(screen.queryAllByRole('button', { name: /结束回合/ })).toHaveLength(0);

    await receive(socket, {
      t: 'moves', from: 'host-9', to: me, seat: 2,
      items: [{ key: '0-END_TURN:1a2b3c4d', label: '⏭️结束回合' }], omitted: 0,
    });
    socket.sent.length = 0;
    await clickButton(/^⏭️结束回合$/);
    expect(socket.sent).toEqual([
      encodeEnvelope({ t: 'act', from: me, to: 'host-9', seat: 2, key: '0-END_TURN:1a2b3c4d' }),
    ]);

    // 房主退回的那句话原文上屏。
    await receive(socket, {
      t: 'actno', from: 'host-9', to: me, key: '0-END_TURN:1a2b3c4d',
      reason: '现在轮不到这一席动手（或者局面已经走到下一步了）',
    });
    expect(text()).toContain('现在轮不到这一席动手');

    // 清单换新 ⇒ 上一句作废（不然人以为那句还挂着）。
    await receive(socket, {
      t: 'moves', from: 'host-9', to: me, seat: 2,
      items: [{ key: '0-BEGIN_DRAW:99887766', label: '🃏开始抽牌' }], omitted: 0,
    });
    expect(text()).not.toContain('现在轮不到这一席动手');
    expect(text()).toContain('🃏开始抽牌');
  });

  it('J4：不是房主发来的席位表与清单不上屏（谁都能喊一句"你坐第二席"就成了假绑座）', async () => {
    render(<OnlineLobby onClose={() => {}} />);
    const socket = await dialRoom('KKKKKK');
    const me = myId(socket);
    await receive(socket, { t: 'welcome', from: 'host-9', to: me, name: '房主乙', v: ourVersionStamp() });
    await receive(socket, {
      t: 'roster', from: 'host-9',
      peers: [{ id: 'host-9', name: '房主乙', role: 'host' }, { id: me, name: '玩家', role: 'guest' }, { id: 'guest-x', name: '路人', role: 'guest' }],
    });

    socket.sent.length = 0;
    await receive(socket, {
      t: 'seatmap', from: 'guest-x',
      seats: [{ peer: me, seat: 5, name: '玩家' }],
    });
    await receive(socket, {
      t: 'moves', from: 'guest-x', to: me, seat: 5,
      items: [{ key: '0-END_TURN:deadbeef', label: '⏭️结束回合' }], omitted: 0,
    });

    expect(text()).toContain('还没收到席位表');
    expect(screen.queryAllByRole('button', { name: /结束回合/ })).toHaveLength(0);
    // 客人这一格一条线也不发（连"我要点第五席"都不发出去）。
    expect(socket.sent).toHaveLength(0);
  });
});

/**
 * 切片⑤a（v2.9.25）客人那一颗准备钮与那张照抄来的准备表。
 *
 * 两条硬判据：客人交回的是**一个布尔**（没有第二个字段、也没有"我替别人点"的余地），
 * 而那张表只有房主发的那一份能上墙——别人冒充发一张，界面上一个字都不许变。
 */
describe('⑤a 大厅里那颗准备钮：交回一个布尔，照抄一张表', () => {
  /** 走到"已连上、名册上有房主也有我"那一步；`me` 是在清空发件记录**之前**取下的。 */
  async function inRoomAsGuest() {
    render(<OnlineLobby onClose={() => {}} />);
    const socket = await dialRoom('DDDDDD');
    await receive(socket, { t: 'welcome', from: 'host-9', to: myId(socket), name: '房主乙', v: ourVersionStamp() });
    const me = myId(socket);
    await receive(socket, {
      t: 'roster', from: 'host-9',
      peers: [{ id: 'host-9', name: '房主乙', role: 'host' }, { id: me, name: '玩家', role: 'guest' }],
    });
    socket.sent.length = 0;
    return { socket, me };
  }

  it('表还没算出来时那句实话：不是"没人准备"，是"这张表还没到"', async () => {
    await inRoomAsGuest();
    expect(text()).toContain('准备情况');
    expect(text()).toContain('房主那边还没把这张表算出来');
  });

  it('点一下「我准备好了」⇒ 线上只多出这一条，字段就只有来路、收件人与那个布尔', async () => {
    const { socket, me } = await inRoomAsGuest();
    await clickButton(/我准备好了/);
    expect(socket.sent).toEqual([encodeEnvelope({ t: 'ready', from: me, to: 'host-9', on: true })]);
  });

  it('那颗钮只发给名册上那位真房主：名册还没到时它是按不动的（不能把"我准备好了"发给自己）', async () => {
    render(<OnlineLobby onClose={() => {}} />);
    const socket = await dialRoom('DDDDDD');
    await receive(socket, { t: 'welcome', from: 'host-9', to: myId(socket), name: '房主乙', v: ourVersionStamp() });
    socket.sent.length = 0;
    const button = screen.getByRole('button', { name: /我准备好了/ });
    expect(button.hasAttribute('disabled')).toBe(true);
    await act(async () => { button.click(); });
    expect(socket.sent).toEqual([]);
  });

  it('房主那张表上了墙：谁 ✓ 谁没点逐行照抄，我自己那一行标出（我）', async () => {
    const { socket, me } = await inRoomAsGuest();
    await receive(socket, {
      t: 'readytable', from: 'host-9',
      rows: [
        { peer: 'host-9', name: '房主乙', on: true, counted: true },
        { peer: me, name: '玩家', on: false, counted: true },
      ],
    });
    expect(text()).toContain('✓ 已准备');
    expect(text()).toContain('还没点准备');
    expect(text()).toContain('（我）');
  });

  it('表上我那一行翻了 ⇒ 那颗钮说的是"点这里取消"，再点交回的是 on:false', async () => {
    const { socket, me } = await inRoomAsGuest();
    await receive(socket, { t: 'readytable', from: 'host-9', rows: [{ peer: me, name: '玩家', on: true, counted: true }] });
    expect(text()).toContain('已准备（点这里取消）');
    socket.sent.length = 0;
    await clickButton(/点这里取消/);
    expect(socket.sent).toEqual([encodeEnvelope({ t: 'ready', from: me, to: 'host-9', on: false })]);
  });

  it('房主判成掉线那位：行还在，但界面说的是"不等他"，不是"他没点"', async () => {
    const { socket, me } = await inRoomAsGuest();
    await receive(socket, {
      t: 'readytable', from: 'host-9',
      rows: [
        { peer: me, name: '玩家', on: true, counted: true },
        { peer: 'gone-1', name: '客人丙', on: false, counted: false },
      ],
    });
    expect(text()).toContain('客人丙');
    expect(text()).toContain('房主判他掉线，不等他');
  });

  it('不是房主发来的表上不了墙（别的客人也能往房间里发这一条）', async () => {
    const { socket, me } = await inRoomAsGuest();
    await receive(socket, { t: 'readytable', from: 'guest-x', rows: [{ peer: me, name: '玩家', on: true, counted: true }] });
    expect(text()).toContain('房主那边还没把这张表算出来');
    expect(text()).not.toContain('✓ 已准备');
  });

  it('客人这一侧不显示闸门那句话——"在等谁"是房主那台机器对用户说的话，两边不会各说一套', async () => {
    const { socket, me } = await inRoomAsGuest();
    await receive(socket, {
      t: 'readytable', from: 'host-9',
      rows: [
        { peer: me, name: '玩家', on: true, counted: true },
        { peer: 'other-1', name: '客人乙', on: false, counted: true },
      ],
    });
    // 那句"还在等…"是房主那颗钮的专属说明（界面上只由 `gate.applicable` 那两处渲染）；
    // 客人这一侧 applicable 恒为 false，所以这句动态文案一个字都不该出现——
    // 页脚那段散文里当然提到"还在等谁"，所以判据取这句的后半段。
    expect(text()).not.toContain('点准备——他们点完');
    expect(text()).toContain('客人乙');
  });

  it('点准备不会顺手把牌桌那几格也点一遍（一颗钮只交一颗钮）', async () => {
    const { socket, me } = await inRoomAsGuest();
    await receive(socket, {
      t: 'moves', from: 'host-9', to: me, seat: 2,
      items: [{ key: '0-END_TURN:abcd1234', label: '⏭️结束回合' }], omitted: 0,
    });
    socket.sent.length = 0;
    await clickButton(/我准备好了/);
    expect(socket.sent).toEqual([encodeEnvelope({ t: 'ready', from: me, to: 'host-9', on: true })]);
  });

  it('收尾那段说明写清了这一版做到哪儿、还没做到哪儿，且不谎称防作弊', async () => {
    await inRoomAsGuest();
    expect(text()).toContain('这一版不防作弊');
    expect(text()).toContain('不会出现');
    expect(text()).toContain('还没做的');
  });

  /**
   * 切片⑥的改述证人。立项时点过的一句话是"传话程序只认房间不认人"——这一版它认人了，
   * 那句话就成了假话，留在界面上＝界面在说一件已经不成立的事（§112：显示那句必须对得上实际行为）；
   * 反过来"认人投递"绝不许写成"别人再也看不见"：这堵墙加的只是"不再抄给全屋"，
   * 线上仍是明文、身份号仍是连接自己带进来的、没有钥匙也没有验证。所以一正一反各一条。
   */
  it('切片⑥之后收尾那段改述了传话程序：按人投递与"照样看得见"两句同时在场，老那句不许留着', async () => {
    await inRoomAsGuest();
    expect(text()).toContain('按人投递');
    expect(text()).toContain('查不到收件人就整帧丢掉');
    expect(text()).toContain('观战那条路留着');
    expect(text()).toContain('照样看得见别人那一席的那些字与牌面');
    expect(text()).not.toContain('只认房间不认人');
    expect(text()).not.toMatch(/已防偷看|防住了偷看|再也看不见别人/);
  });
});

describe('⑤b 大厅里的征召进度：客人看见"走到第几席"，看不见别人挑了什么', () => {
  /** 走到"已连上、名册上有房主也有我"那一步（与 ⑤a 同一个入口，抄一份是为了两组证人互不牵动）。 */
  async function inRoomAsGuest() {
    render(<OnlineLobby onClose={() => {}} />);
    const socket = await dialRoom('DDDDDD');
    await receive(socket, { t: 'welcome', from: 'host-9', to: myId(socket), name: '房主乙', v: ourVersionStamp() });
    const me = myId(socket);
    await receive(socket, {
      t: 'roster', from: 'host-9',
      peers: [{ id: 'host-9', name: '房主乙', role: 'host' }, { id: me, name: '玩家', role: 'guest' }],
    });
    socket.sent.length = 0;
    return { socket, me };
  }

  it('表还没到＝一句实话（不是"没人征召"，也不是一块让人以为卡住的空白）', async () => {
    await inRoomAsGuest();
    expect(text()).toContain('征召进度');
    expect(text()).toContain('还没开始征召');
  });

  it('房主发来的表逐行上墙：那句「已选 n/10」与热座面板同一个形状', async () => {
    const { socket } = await inRoomAsGuest();
    await receive(socket, {
      t: 'draftprogress', from: 'host-9',
      rows: [
        { seat: 1, name: '房主乙', state: 'done', picked: 10, total: 10 },
        { seat: 2, name: '玩家', state: 'picking', picked: 7, total: 10 },
      ],
    });
    expect(text()).toContain('第 1 席');
    expect(text()).toContain('已征召 10/10');
    expect(text()).toContain('正在征召（已选 7/10）');
    expect(text()).toContain('现在轮到第 2 席');
    expect(text()).not.toContain('还没开始征召');
  });

  it('这张表里一张牌也没有：界面上明写，客人不该以为是自己看不到的那几格', async () => {
    const { socket } = await inRoomAsGuest();
    await receive(socket, {
      t: 'draftprogress', from: 'host-9',
      rows: [{ seat: 1, name: '房主乙', state: 'picking', picked: 1, total: 10 }],
    });
    expect(text()).toContain('一张牌也没有');
  });

  it('不是房主发来的进度表不上墙（客人也能往房间里发这一条，说"某席挑了谁"就成了假通告）', async () => {
    const { socket } = await inRoomAsGuest();
    await receive(socket, {
      t: 'draftprogress', from: 'guest-x',
      rows: [{ seat: 2, name: '玩家', state: 'done', picked: 10, total: 10 }],
    });
    expect(text()).toContain('还没开始征召');
    expect(text()).not.toContain('已征召 10/10');
    expect(text()).not.toContain('第 2 席');
  });

  it('客人收到进度表不往外回话：这一格是给人看的，不是一条请求', async () => {
    const { socket } = await inRoomAsGuest();
    await receive(socket, {
      t: 'draftprogress', from: 'host-9',
      rows: [{ seat: 1, name: '房主乙', state: 'picking', picked: 2, total: 10 }],
    });
    expect(socket.sent).toEqual([]);
  });
});

describe('⑤·腿1（㈢ 演出刀）客人屏上的开局那一段：只画房主定下来发过来的数', () => {
  /** 走到"已连上、名册上有房主也有我"那一步（入口与 ⑤a／⑤b 那两组各抄一份，互不牵动）。 */
  async function inRoomAsGuest() {
    render(<OnlineLobby onClose={() => {}} />);
    const socket = await dialRoom('FFFFFF');
    await receive(socket, { t: 'welcome', from: 'host-9', to: myId(socket), name: '房主乙', v: ourVersionStamp() });
    const me = myId(socket);
    await receive(socket, {
      t: 'roster', from: 'host-9',
      peers: [{ id: 'host-9', name: '房主乙', role: 'host' }, { id: me, name: '玩家', role: 'guest' }],
    });
    socket.sent.length = 0;
    return { socket, me };
  }

  /**
   * 房主 store 里开局那一段的样子，**走一遍真实的遮蔽层**再上线——这一格量的就是"那条线上
   * 本来就有什么"：阶段名与点数／座次／势力都照样过得了 `buildBroadcastView`（它们全在公开白名单里），
   * 所以本刀不需要新信封。`viewSeat` 给 1 ⇒ 第 1 席自己的手牌与征召池照发牌面，
   * 那些引用正是这一格绝不该画上去的东西。
   */
  function openingView(phase: string, seats: Record<string, unknown>[], viewSeat: number | null = 1) {
    return buildBroadcastView({
      version: 1,
      phase,
      timelinePhase: 'SETUP',
      players: seats.map((s, i) => ({
        id: s.id,
        name: s.name,
        faction: s.faction ?? '',
        diceRoll: s.diceRoll ?? 0,
        seatOrder: s.seatOrder ?? i,
        isAlive: true,
        hp: 6,
        baseHp: 6,
        hand: [{ id: `p${s.id}-hand-SECRET` }],
        generalPool: [{ id: `p${s.id}-pool-SECRET` }],
        graveyard: [],
        statuses: [],
        fieldGenerals: [],
      })),
      currentPlayerId: 1,
      turn: 0,
      round: 0,
      deck: [{ id: 'deck-SECRET' }],
      discardPile: [],
      metadata: { roomId: 'FFFFFF' },
      rngState: { s: 123456789 },
    } as never, viewSeat) as unknown as Record<string, unknown>;
  }

  const twoSeats = [
    { id: 1, name: '房主乙', diceRoll: 11, seatOrder: 0, faction: '蜀' },
    { id: 2, name: '玩家', diceRoll: 4, seatOrder: 1, faction: '魏' },
  ];

  it('还没收到任何局面 ⇒ 说的是"现在没有开局那一段的读数"，不是一块空白', async () => {
    await inRoomAsGuest();
    expect(text()).toContain('现在没有开局那一段的读数');
    expect(text()).toContain('本机一颗骰子也不摇');
  });

  it('收到的那一份里点数与势力都定了 ⇒ 那两个数逐字上屏（画的就是收到的，不是本机摇的）', async () => {
    const { socket, me } = await inRoomAsGuest();
    await receive(socket, { t: 'snapshot', from: 'host-9', to: me, state: openingView('diceRoll', twoSeats) });
    expect(text()).toContain('🎲 11');
    expect(text()).toContain('🎲 4');
    expect(text()).toContain('骰子停下');
    expect(text()).toContain('座次第 1 位');
  });

  /** 用户那句"主机先走定下数据（骰子停下），把数据传给客人，客人画面变动"里，客人这边只有"变动"：
   *  房主 store 在掷骰前那一格写的是 0（点数至少 1 才算掷过），所以那一刻只能写"还没定"。 */
  it('房主那边骰子还没停 ⇒ 客人屏上写「还没定」，一个假点数都不补', async () => {
    const { socket, me } = await inRoomAsGuest();
    await receive(socket, {
      t: 'snapshot', from: 'host-9', to: me,
      state: openingView('diceRoll', [{ id: 1, name: '房主乙' }, { id: 2, name: '玩家' }]),
    });
    expect(text()).toContain('房主那边骰子还在滚');
    expect(text()).toContain('还没定');
    expect(text()).not.toMatch(/🎲 \d/);
  });

  it('分势力那一步同样跟着变：势力也是收到的那两个值，字面出自房主那边', async () => {
    const { socket, me } = await inRoomAsGuest();
    await receive(socket, { t: 'snapshot', from: 'host-9', to: me, state: openingView('factionAssign', twoSeats) });
    expect(text()).toContain('势力也由房主那边定下并发来了');
    expect(text()).toContain('接着是各家征召');
  });

  /** 迟到者的那条路：房主在名册变化时 flush 当下这一份（`NetRoomBridge.tsx:123`），
   *  那些数早就定了 ⇒ 他第一帧看到的就是已经停下的骰子，这一格不回放滚动。 */
  it('已进对局的那一份 ⇒ 说"开局那一段走完了"，而不是停在"还没开局"', async () => {
    const { socket, me } = await inRoomAsGuest();
    await receive(socket, { t: 'snapshot', from: 'host-9', to: me, state: openingView('playing', twoSeats) });
    expect(text()).toContain('开局那一段走完了');
    expect(text()).not.toContain('现在没有开局那一段的读数');
  });

  it('别人的牌面上不了这一格：连指名给我自己那份里放开的手牌与征召池也不画', async () => {
    const { socket, me } = await inRoomAsGuest();
    await receive(socket, { t: 'snapshot', from: 'host-9', to: me, state: openingView('generalDraft', twoSeats) });
    expect(text()).toContain('各家挑到哪儿了看下面那张征召进度表');
    expect(text()).not.toMatch(/SECRET/);
    // ⑤c／⑤d 还没做 ⇒ 这一格必须自己说破，不能让人以为"看不见是我这边的问题"。
    // （页脚那段散文里也提到 ⑤c／⑤d，所以判据取这一格的专属那句，不取编号。）
    expect(text()).toContain('这一段现在只有进度可看');
  });

  it('那句「下面那张征召进度表」得对得上位置：开局那一格真的排在进度表上面', async () => {
    const { socket, me } = await inRoomAsGuest();
    await receive(socket, { t: 'snapshot', from: 'host-9', to: me, state: openingView('generalDraft', twoSeats) });
    await receive(socket, {
      t: 'draftprogress', from: 'host-9',
      rows: [{ seat: 1, name: '房主乙', state: 'picking', picked: 3, total: 10 }],
    });
    const setupRow = screen.getByText(/开局那一段 · 掷骰/);
    const draftRow = screen.getByText(/征召进度（这张表由房主算/);
    expect(setupRow.compareDocumentPosition(draftRow) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  /** 视角轴与动手轴分家之后，指名的快照仍只有收件人采纳（切片③那条判据住在 netSession）；
   *  这一条量的是那一格界面**没跟着别人的那份变动**——别人的私有视图里连"第几席"都是另一套。 */
  it('指名给别人的那一份不上这一格：不拿别人的读数画自己这一屏', async () => {
    const { socket } = await inRoomAsGuest();
    await receive(socket, { t: 'snapshot', from: 'host-9', to: 'someone-else', state: openingView('diceRoll', twoSeats) });
    expect(text()).toContain('现在没有开局那一段的读数');
    expect(text()).not.toContain('🎲 11');
  });

  it('不是房主发来的那一份不上这一格（客人也能往房间里发快照）', async () => {
    const { socket, me } = await inRoomAsGuest();
    await receive(socket, { t: 'snapshot', from: 'guest-x', to: me, state: openingView('diceRoll', twoSeats) });
    expect(text()).not.toContain('🎲 11');
    expect(text()).toContain('现在没有开局那一段的读数');
  });

  it('这一格只给客人看：房主那屏的真相住在 store 里，不该对着正在掷骰的人说"房主还没开局"', async () => {
    render(<OnlineLobby onClose={() => {}} />);
    await clickButton(/^🏠 开房间/);
    await settle();
    expect(text()).not.toContain('本机一颗骰子也不摇');
    expect(text()).not.toContain('开局那一段 · 掷骰');
  });

  it('收到开局读数不往外回话：这一格是给人看的，不是一条请求（更不替客人摇一颗）', async () => {
    const { socket, me } = await inRoomAsGuest();
    await receive(socket, { t: 'snapshot', from: 'host-9', to: me, state: openingView('diceRoll', twoSeats) });
    expect(socket.sent).toEqual([]);
  });
});

/** 房主那边算出来的、已经过 J2 遮蔽层的局面——界面拿到的就该长这样。 */
function maskedView(): Record<string, unknown> {
  return buildBroadcastView({
    version: 1,
    phase: 'turn',
    timelinePhase: 'ACTION',
    players: [
      {
        id: 1, name: '房主乙', faction: '蜀', baseHp: 6, isAlive: true,
        hand: [{ id: 'p1-h1' }, { id: 'p1-h2' }, { id: 'p1-h3' }],
        generalPool: [{ id: 'pool-1' }, { id: 'pool-2' }],
        graveyard: [], statuses: [],
        fieldGenerals: [{
          general: { id: 'g1', name: '赵云' }, ownerId: 1, position: { q: 0, r: 0 },
          currentHp: 3, maxHp: 4, meleeAtk: 2, rangedAtk: 1, armor: 1, currentArmor: 0,
          isArming: false, hasMoved: false, hasAttacked: false, hasSupplied: false, justDeployed: false,
          armorCards: [{ id: 'arm-1' }],
        }],
      },
      { id: 2, name: '客人甲', faction: '魏', baseHp: 6, isAlive: true, hand: [], generalPool: [], graveyard: [], statuses: [], fieldGenerals: [] },
    ],
    currentPlayerId: 1,
    turn: 7,
    round: 4,
    deck: [{ id: 'deck-1' }, { id: 'deck-2' }],
    discardPile: [],
    metadata: { roomId: 'EEEEEE' },
    rngState: { s: 987654321 },
  } as never) as unknown as Record<string, unknown>;
}
