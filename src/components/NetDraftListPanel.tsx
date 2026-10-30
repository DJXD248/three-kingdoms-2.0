import type { NetDraftItem, NetDraftListFrame } from '../network/netProtocol';

/**
 * 联机切片⑤c（v2.9.25）：客人屏幕上**自己那一席**的候选名单。
 *
 * 用户 2026-10-30 裁的那句：「每个玩家只能看到自己的候选将领和已选将领，而不是能看到全部」——
 * 这一格正是"自己的那一份"：房主按席位各算一帧、指名发给我，别人那一格在这里从来没有过。
 * 所以这一屏上写的每一张牌都是**收到的**，本机一张也不生成（候选名单住在房主的 store 里）。
 *
 * 这里没有判据：名单、勾了哪几颗、以及"这一席该做什么"那句话都由房主算（`network/netDraftList`），
 * 经 `netRoom` 那一格存着，界面照抄——与 ⑤b 那张进度表同一个纪律。
 * ⚠️ 这一格**不能点**：勾哪一颗、确认那颗钮＝腿3（⑤d），这一版还没接到客人这边（界面上就明说这一点）。
 */

const cardLine = (item: NetDraftItem): string =>
  `${item.type === '武将' ? '⚔️' : '📜'} ${item.name}｜${item.faction}｜❤${item.hp} ⚔${item.meleeAtk} 🏹${item.rangedAtk}`;

function DraftListCards({ title, items, picked }: { title: string; items: NetDraftItem[]; picked: readonly string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      <p className="text-xs text-amber-300/60">{title}（{items.length} 张）</p>
      <ul className="flex flex-wrap gap-1.5">
        {items.map((item) => {
          const chosen = picked.includes(item.key);
          return (
            <li
              key={item.key}
              className={`rounded border px-2 py-1 text-xs ${
                chosen ? 'border-amber-400/70 bg-amber-900/30 text-amber-100' : 'border-amber-700/25 bg-black/25 text-amber-100/85'
              }`}
            >
              <span className="font-bold">{cardLine(item)}</span>
              {item.skills.length > 0 && <span className="text-amber-300/60">｜{item.skills.join('、')}</span>}
              {chosen && <span className="ml-1 font-bold text-amber-200">已选</span>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function NetDraftListPanel({ frame }: { frame: NetDraftListFrame | null }) {
  return (
    <div className="rounded-lg border border-amber-700/25 bg-black/25 px-3 py-2">
      <p className="text-xs text-amber-300/70 mb-1.5">
        你这一席的候选名单（这一格由房主按席位各算一份、指名发给对应的那个人；别人那一格我这里从来没有过）
      </p>
      {frame === null ? (
        <p className="text-xs text-amber-200/40">
          还没收到属于你这一席的那一格（房主那边还没发，或椅子还没排到你）。
        </p>
      ) : (
        <>
          <p className="text-sm text-amber-100">
            第 {frame.seat} 席：{frame.instruction}
          </p>
          {frame.main.length === 0 && frame.qun.length === 0 ? (
            // 空格连那个分母也不摆出来：一行「已选 0/10」看着像"这里还能选十颗"，
            // 而房主发这一格过来时说的是"现在没你的候选"。
            <p className="text-xs text-amber-200/45 mt-1.5">这一格现在是空的（房主发过来就是空的，本机不补一张）。</p>
          ) : (
            <>
              <p className="text-xs text-amber-300/60 mt-0.5">
                已选 {frame.picked.length}/{frame.total}（房主那边当下勾着的那几颗在这两份名单上标了「已选」）
              </p>
              <div className="flex flex-col gap-2 mt-1.5">
                <DraftListCards title="本势力候选" items={frame.main} picked={frame.picked} />
                <DraftListCards title="群候选" items={frame.qun} picked={frame.picked} />
              </div>
            </>
          )}
          <p className="text-xs text-amber-200/45 mt-1.5">
            这里的牌只能看、点不动——勾哪一颗与确认那颗钮是腿3（⑤d），这一版还没接到客人这边；
            「已选」那一排是房主那边当下勾着的那几颗，不是本机算的。
          </p>
        </>
      )}
    </div>
  );
}
