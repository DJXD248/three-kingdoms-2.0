/**
 * J4 界面那一格的证人（v2.9.11）。
 *
 * 要钉住的是那句话的**反面**：什么时候**不许**出按钮。
 * 席位表与清单都是房主发来的，客人这边一没绑到椅子、二清单换了主人、三桌上根本没椅子——
 * 这三种都必须"只看不动"，而且是一条可交互元素都不能有（不是把按钮置灰：
 * 置灰的按钮照样是个承诺，人会觉得点得动）。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import NetSeatOverlay, { NetSeatPanel } from './NetSeatPanel';
import type { NetSeatRow } from '../network/netProtocol';
import { attachRoom, detachRoom, receiveSeatMap, type ActiveRoom } from '../network/netRoom';
import type { RoomConnection } from '../network/netSession';

const HOST = 'host-1';
const GUEST = 'guest-1';

const SEATS: NetSeatRow[] = [
  { peer: HOST, seat: 1, name: '房主甲' },
  { peer: GUEST, seat: 2, name: '客人甲' },
  { peer: null, seat: 3, name: '丙' },
];

const text = () => document.body.textContent ?? '';

function guestView(over: Record<string, unknown> = {}) {
  const picked: Array<{ key: string; label: string }> = [];
  render(
    <NetSeatPanel
      seatMap={SEATS}
      moves={{ seat: 2, items: [{ key: '0-END_TURN:aaa', label: '⏭️结束回合' }], omitted: 0 }}
      refusal={null}
      selfId={GUEST}
      isHost={false}
      onPick={(item) => picked.push(item)}
      {...over}
    />,
  );
  return { picked };
}

afterEach(() => {
  // 先卸载再退房：注册表在卸载后 notify，React 会抱怨这次更新没包进 act。
  cleanup();
  detachRoom();
});

describe('房主那一份：看得见谁坐哪一席，但这边一个按钮都不该有', () => {
  it('三行席位逐字对得上：谁（我）、客人、本机在点', () => {
    render(<NetSeatPanel seatMap={SEATS} moves={null} refusal={null} selfId={HOST} isHost />);
    const shown = text();
    expect(shown).toContain('第 1 席');
    expect(shown).toContain('房主甲');
    expect(shown).toContain('（我）');
    expect(shown).toContain('第 2 席');
    expect(shown).toContain('客人甲');
    expect(shown).toContain('第 3 席');
    expect(shown).toContain('本机在点');
  });

  it('房主这边不摆按钮（清单只发给那一席的人，本机照旧在牌桌上点）', () => {
    render(<NetSeatPanel seatMap={SEATS} moves={{ seat: 1, items: [{ key: 'k', label: '⏭️结束回合' }], omitted: 0 }} refusal={null} selfId={HOST} isHost />);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(text()).toContain('按当下的局面重算一遍');
  });
});

describe('客人那一份：只有房主指名给我这一席的清单才变成按钮', () => {
  it('绑到了、清单也到了 ⇒ 按钮上的句子逐字是房主发来的那句，点出去交回的是那一条', () => {
    const { picked } = guestView();
    const button = screen.getByRole('button', { name: '⏭️结束回合' });
    fireEvent.click(button);
    expect(picked).toEqual([{ key: '0-END_TURN:aaa', label: '⏭️结束回合' }]);
    expect(text()).toContain('你坐第 2 席');
  });

  it('椅子还没排到我 ⇒ 一个可交互元素都没有（只看不动，不是灰按钮）', () => {
    guestView({ selfId: 'guest-9' });
    expect(document.querySelectorAll('button, a[href], input, select, textarea')).toHaveLength(0);
    expect(text()).toContain('椅子还没排到你');
  });

  it('清单是发给别人的（我这席换了主人）⇒ 同样一个按钮都不出', () => {
    guestView({ moves: { seat: 1, items: [{ key: 'k', label: '⏭️结束回合' }], omitted: 0 } });
    expect(document.querySelectorAll('button')).toHaveLength(0);
    expect(text()).toContain('还没收到这一席的清单');
  });

  it('没给 onPick ⇒ 看得见表、按不动（这一格只是给人看的）', () => {
    guestView({ onPick: undefined });
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('房主还没开出台面（开局前桌上没有席位）⇒ 说清为什么还没有按钮', () => {
    guestView({ seatMap: null, moves: null });
    expect(document.querySelectorAll('button')).toHaveLength(0);
    expect(text()).toContain('还没收到席位表');
    expect(text()).toContain('开局前桌上没有席位');
  });

  it('这一桌全是电脑在打 ⇒ 没有能坐人的椅子', () => {
    guestView({ seatMap: [], moves: null });
    expect(text()).toContain('这一桌全是电脑在打');
  });

  it('清单是空的（这一席此刻真的一步也走不了）⇒ 是一句真话，不是一片空白', () => {
    guestView({ moves: { seat: 2, items: [], omitted: 0 } });
    expect(text()).toContain('一步也走不了');
  });

  it('空清单时那句抬头话不许自相矛盾（2026-10-28 远程实测读到的就是两行挨着打脸）', () => {
    guestView({ moves: { seat: 2, items: [], omitted: 0 } });
    expect(text()).toContain('你坐第 2 席');
    expect(text()).not.toContain('现在能走');
  });

  it('清单真有步子时才说"现在能走"（这句话是那句真话的另一半）', () => {
    guestView();
    expect(text()).toContain('现在能走');
  });

  it('被封顶挤掉的那几条要按数字说出来：看到的不是全部', () => {
    guestView({ moves: { seat: 2, items: [{ key: '0-END_TURN:aaa', label: '⏭️结束回合' }], omitted: 5 } });
    expect(text()).toContain('只列出前 1 步');
    expect(text()).toContain('还有 5 步没列出来');
  });

  it('房主退回的那句话原样显示，一个字都不加工', () => {
    guestView({ refusal: { key: '0-END_TURN:aaa', reason: '这一步已经不成立——清单是按房主当下的局面重算的，牌一动就换一批' } });
    expect(text()).toContain('这一步已经不成立——清单是按房主当下的局面重算的，牌一动就换一批');
  });

  it('说清线上跑的是什么：只交回席位号与编号，牌面内容不上线', () => {
    guestView();
    expect(text()).toContain('你的手牌与牌面内容一个都不上线');
  });
});

describe('右上角那一格（房主关了大厅去开局时还挂着）', () => {
  function roomFor(role: 'host' | 'guest'): ActiveRoom {
    const connection = {
      state: { role, selfId: role === 'host' ? HOST : GUEST, name: '甲', roomCode: 'ROOMAA', phase: 'in-room', note: '', peers: [] },
      leave: vi.fn(),
      send: vi.fn(() => true),
    };
    return {
      role,
      name: '甲',
      roomCode: 'ROOMAA',
      address: 'ws://x',
      url: 'ws://x/ROOMAA',
      connection: connection as unknown as RoomConnection,
    };
  }

  it('房主那边收到了席位表 ⇒ 挂着那张表；没收到之前不占地方', () => {
    attachRoom(roomFor('host'));
    render(<NetSeatOverlay />);
    expect(text()).toBe('');

    act(() => {
      receiveSeatMap(SEATS);
    });
    expect(text()).toContain('第 2 席');
    expect(text()).toContain('客人甲');
    expect(document.querySelector('.pointer-events-none')).not.toBeNull();
  });

  it('客人不在这里点牌（他要动手得回大厅那一格）', () => {
    attachRoom(roomFor('guest'));
    receiveSeatMap(SEATS);
    render(<NetSeatOverlay />);
    expect(text()).toBe('');
  });
});
