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
  it('开房间：当场生成六位房间码，连接地址就是"地址/房间码"', async () => {
    render(<OnlineLobby onClose={() => {}} />);
    expect(text()).toContain('我开房间');

    await clickButton(/^🏠 开房间/);
    await settle();

    const socket = FakeWebSocket.created[0];
    const code = socket.url.split('/').pop() ?? '';
    expect(code).toMatch(/^[A-Z0-9]{6}$/);
    expect(socket.url).toBe(`ws://127.0.0.1:8787/${code}`);
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
    expect(socket.url).toBe('ws://127.0.0.1:8787/K7M2QX');
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

  it('界面上写明还没做的两格（ping 表／客人动手），不假装已能开局', async () => {
    render(<OnlineLobby onClose={() => {}} />);
    expect(text()).toContain('ping 表与掉线判定（J3）');
    expect(text()).toContain('客人动手与座位绑定（J4）');
    expect(text()).not.toContain('牌桌画面同步（J2）');

    await clickButton(/^🏠 开房间/);
    await settle();
    expect(text()).toContain('ping 表与掉线判定（J3）');
  });

  it('J2：客人收到房主的遮蔽局面 ⇒ 屏幕上出现同一局的牌桌，写着"只看不动"', async () => {
    render(<OnlineLobby onClose={() => {}} />);
    const socket = await dialRoom('DDDDDD');
    await receive(socket, { t: 'welcome', from: 'host-9', to: myId(socket), name: '房主乙', v: ourVersionStamp() });
    await receive(socket, { t: 'roster', from: 'host-9', peers: [{ id: 'host-9', name: '房主乙', role: 'host' }, { id: myId(socket), name: '玩家', role: 'guest' }] });

    expect(text()).toContain('还没收到房主发来的局面');
    await receive(socket, { t: 'snapshot', from: 'host-9', state: maskedView() as unknown as Record<string, unknown> });
    await settle();

    expect(text()).toContain('这一局由房主算牌，你这边只看不动');
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
