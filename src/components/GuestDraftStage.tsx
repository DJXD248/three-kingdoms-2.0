import { useRef } from 'react';
import type { EngineState } from '../core/GameState';
import { factionColors, type General } from '../data/generals';
import type { NetDraftItem, NetDraftListFrame } from '../network/netProtocol';
import { DraftCard } from './GeneralDraft';
import { isWaitingForOthers, WAITING_FOR_OTHERS_TEXT } from './draftWaiting';

/**
 * 联机征召那一段在客人屏上的**整屏画面**（2026-11-12 同网真机反馈）。
 *
 * 用户原话＝「掷骰子的页面做得不错，但是征召将领的页面还是和本地模式的时候不一致，
 * 这不符合我的要求」。上一刀（GuestOpeningStage）只把掷骰／分势力两段做成与热座同版式，
 * 征召这一段客人仍停在联网小窗口里的几块文字面板（截图实证）⇒ 这一格补上第三段。
 *
 * 版式逐字照抄 `GeneralDraft.tsx`：同一层背景、同一颗标题、同一排进度圆点、
 * 同一条「已选 X/10」状态栏、主势力／群两个同尺寸卡片网格、底部同一条已选栏与同一颗确认钮；
 * 卡片直接复用本地那枚 `DraftCard`，所以卡面样式一处也不会漂。
 *
 * 数据一条也不在本机生成：候选、已选、能不能交卷、那句人话全来自房主**指名发给这一席**的
 * `NetDraftListFrame`；点一颗交回线上的仍只有那一帧上的位置编号（`m0…`／`q0…`），
 * 将名／档案号／"我觉得这合法"一个字也不上线（沿用 ⑤d 的既有纪律）。
 *
 * 与本地有意保留的两条**已知差异**，如实写在交接登记里，不冒充逐字一致：
 *  ① 本地那半边身份锁（`lockConflicts`）要读数据层，联机这一层按原设计不 import 数据层 ⇒ 不画那个 ⚠；
 *  ② 本地牌钮满了会置灰，客人这边的牌钮仍一律可点（每颗必有回音，房主不认就把那句拒话写回来）——
 *     这是 `NetDraftListPanel` 立下并钉住的「拒不得静默」，不为版式一致性去推翻它。
 */
type StageRow = { id: string; name: string; faction: string | null };

function rowsOf(snapshot: EngineState | null): StageRow[] {
  const players = (snapshot as { players?: unknown } | null)?.players;
  if (!Array.isArray(players)) return [];
  return players.map((raw, index) => {
    const p = (raw ?? {}) as Record<string, unknown>;
    return {
      id: String(p.id ?? index),
      name: typeof p.name === 'string' && p.name.length > 0 ? p.name : `玩家${index + 1}`,
      faction: typeof p.faction === 'string' && p.faction.length > 0 ? p.faction : null,
    };
  });
}

/** 房主帧上的一张卡 → 本地 DraftCard 读的那几格。只在界面层拼形状，不生成任何新牌。 */
function asCard(item: NetDraftItem): General {
  return {
    id: item.key,
    name: item.name,
    faction: item.faction,
    type: item.type,
    hp: item.hp,
    meleeAtk: item.meleeAtk,
    rangedAtk: item.rangedAtk,
    skills: item.skills.map(name => ({ name })),
  } as unknown as General;
}

const shellStyle = {
  background: 'linear-gradient(135deg, #1a0a0a 0%, #2d1b0e 30%, #1a1a2e 70%, #0d0d1a 100%)',
};

export default function GuestDraftStage({
  frame,
  snapshot,
  onPick,
  onConfirm,
}: {
  frame: NetDraftListFrame | null;
  snapshot: EngineState | null;
  onPick: (key: string) => void;
  onConfirm: () => void;
}) {
  const players = rowsOf(snapshot);
  // 房主在「这一席已经交卷」之后发的是**空名单帧**（main/qun/picked 全空，只带一句"已经完成了"）。
  // 照那一帧画，卡片区、已选栏、计数会一起被清掉 —— 这就是 2026-11-13 真机上「页面变了」那一格。
  // 这里只记住**最后一次属于自己这一席的名单**，等待期间照原样画回去；本机一张牌也不生成，
  // 缓存里的每一张卡都是房主此前指名发给这一席本人的（不牵涉别席的私有信息）。
  const lastListRef = useRef<NetDraftListFrame | null>(null);
  const frameHasList = !!frame && (frame.main.length > 0 || frame.qun.length > 0);
  if (frameHasList && frame) lastListRef.current = frame;
  const waiting = isWaitingForOthers(lastListRef.current !== null, !!frame && !frameHasList);
  const shown = waiting ? lastListRef.current : frame;
  const shownHasList = !!shown && (shown.main.length > 0 || shown.qun.length > 0);

  const total = shown?.total ?? 10;
  const picked = shown?.picked ?? [];
  const qunKeys = new Set((shown?.qun ?? []).map(item => item.key));
  const qunCount = picked.filter(key => qunKeys.has(key)).length;
  const mainCount = picked.length - qunCount;

  // 有名单时 frame.seat 就是房主判给这一席的席位（没轮到的那一席收到的是空名单）。
  const activeIndex = shown
    ? Math.max(0, players.findIndex(p => p.id === String(shown.seat)))
    : 0;
  const current = players[activeIndex] ?? { id: String(shown?.seat ?? 1), name: shown ? `第 ${shown.seat} 席` : '玩家', faction: null };
  const mainColor = factionColors[(current.faction ?? '蜀') as keyof typeof factionColors] ?? '#eab308';

  const byKey = new Map<string, NetDraftItem>();
  for (const item of [...(shown?.main ?? []), ...(shown?.qun ?? [])]) byKey.set(item.key, item);

  // 等待期间整屏一个像素都不动，只把底部那颗钮换成这一句（用户 2026-11-13 逐字）。
  const canPress = !waiting && !!frame?.canConfirm;
  const confirmText = waiting
    ? WAITING_FOR_OTHERS_TEXT
    : !shown
      ? '还没收到属于你这一席的候选名单'
      : shown.canConfirm
        ? '✓ 确认征召'
        : shown.instruction;

  return (
    <div className="fixed inset-0 z-[60] min-h-screen text-white flex flex-col" style={shellStyle}>
      {/* Header：与本地 GeneralDraft 同一颗标题、同一排进度圆点 */}
      <div className="text-center py-5 border-b border-amber-800/30 bg-black/20 flex-shrink-0">
        <h1 className="text-2xl font-black text-amber-200 tracking-wider mb-1">⚔️ 将领征召</h1>
        <div className="flex items-center justify-center gap-3">
          <span className="text-sm text-amber-400/60">征召将领：</span>
          <span className="text-sm font-bold" style={{ color: mainColor }}>{current.name}</span>
          {current.faction && (
            <span className="text-sm px-2 py-0.5 rounded-full font-bold"
              style={{ backgroundColor: mainColor + '25', color: mainColor }}>
              {current.faction}
            </span>
          )}
        </div>
        <div className="flex items-center justify-center gap-1.5 mt-3">
          {(players.length > 0 ? players : [current]).map((p, i) => (
            <div key={p.id} className="flex items-center gap-1">
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold border ${
                i < activeIndex ? 'border-green-500 bg-green-900/30 text-green-400' :
                i === activeIndex ? 'border-amber-500 bg-amber-900/30 text-amber-300' :
                'border-gray-700 bg-black/30 text-gray-600'
              }`}>
                {i < activeIndex ? '✓' : i + 1}
              </div>
              {i < (players.length > 0 ? players.length : 1) - 1 && <div className="w-4 h-px bg-gray-700" />}
            </div>
          ))}
        </div>
      </div>

      {/* Selection status bar：与本地同一条读数 */}
      <div className="px-6 py-2.5 bg-black/30 border-b border-amber-800/20 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-4">
          <span className="text-amber-400/80 text-sm">已选 <strong className="text-amber-200">{picked.length}</strong>/{total}</span>
          <span className="text-sm" style={{ color: mainColor }}>{current.faction ?? '本势力'}: <strong>{mainCount}</strong></span>
          <span className="text-sm" style={{ color: factionColors['群'] }}>群: <strong>{qunCount}</strong>/1-3</span>
        </div>
        <div className="flex items-center gap-1 text-[10px] text-amber-500/50">
          {picked.length < total && qunCount === 0 && <span>⚠ 至少选择1名群势力将领</span>}
          {qunCount > 3 && <span className="text-red-400">⚠ 群势力最多3名</span>}
        </div>
      </div>

      {/* Draft cards area：与本地同尺寸的两格卡片网格 */}
      <div className="flex-1 overflow-auto px-6 py-4">
        {!shownHasList ? (
          <p className="text-center text-sm text-amber-200/50 mt-8 animate-pulse">
            {shown?.instruction ?? '还没收到属于你这一席的候选名单（这一席是别人的，等他在自己电脑上选）'}
          </p>
        ) : (
          <>
            <h3 className="text-sm font-bold mb-3 flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: mainColor }} />
              <span style={{ color: mainColor }}>{current.faction ?? '本势力'}</span>
              <span className="text-amber-500/40">势力将领 ({shown!.main.length})</span>
            </h3>
            <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-7 gap-2 mb-6">
              {shown!.main.map(item => (
                <DraftCard
                  key={item.key}
                  general={asCard(item)}
                  isSelected={picked.includes(item.key)}
                  isSelectable
                  onSelect={() => !waiting && onPick(item.key)}
                />
              ))}
            </div>
            <h3 className="text-sm font-bold mb-3 flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: factionColors['群'] }} />
              <span style={{ color: factionColors['群'] }}>群</span>
              <span className="text-amber-500/40">势力将领 ({shown!.qun.length})</span>
            </h3>
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 mb-4">
              {shown!.qun.map(item => (
                <DraftCard
                  key={item.key}
                  general={asCard(item)}
                  isSelected={picked.includes(item.key)}
                  isSelectable
                  onSelect={() => !waiting && onPick(item.key)}
                />
              ))}
            </div>
          </>
        )}
      </div>

      {/* Bottom panel：与本地同一条已选栏与同一颗确认钮 */}
      <div className="border-t border-amber-800/30 bg-black/40 px-6 py-3 flex-shrink-0">
        <div className="flex items-center gap-2 mb-2.5 overflow-x-auto">
          <span className="text-amber-400/60 text-xs font-bold flex-shrink-0">已选:</span>
          {picked.length === 0 && <span className="text-amber-500/30 text-xs">点击将领卡片进行选择</span>}
          {picked.map(key => {
            const item = byKey.get(key);
            const color = factionColors[(item?.faction ?? '蜀') as keyof typeof factionColors] ?? '#eab308';
            return (
              <button
                key={key}
                onClick={() => !waiting && onPick(key)}
                className="flex-shrink-0 px-2 py-1 rounded-lg text-xs font-bold border transition-all hover:scale-105 hover:brightness-125"
                style={{ borderColor: color + '50', backgroundColor: color + '15', color }}
              >
                {item?.name ?? key} ✕
              </button>
            );
          })}
        </div>
        <button
          onClick={() => !waiting && onConfirm()}
          disabled={!canPress}
          className={`w-full py-3 rounded-xl font-black text-base transition-all ${
            canPress
              ? 'bg-gradient-to-r from-amber-600 to-red-700 text-white hover:from-amber-500 hover:to-red-600 shadow-lg shadow-amber-900/30 active:scale-95'
              : 'bg-gray-800/60 text-gray-600 cursor-not-allowed border border-gray-700/20'
          }`}
        >
          {confirmText}
        </button>
        <p className="text-[10px] text-amber-200/35 mt-1.5">
          这一屏的候选与「能不能交卷」都是房主指名发来的；点一颗只把名单上的位置编号交回去，本机不生成牌、也不替别人选。
        </p>
      </div>
    </div>
  );
}
