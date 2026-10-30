import type { NetDraftItem, NetDraftListFrame } from '../network/netProtocol';

/**
 * 联机切片⑤（v2.9.25）客人屏幕上**自己那一席**的候选名单，腿3（⑤d）起这两份名单上的牌点得动。
 *
 * 用户 2026-10-30 裁的那句：「每个玩家只能看到自己的候选将领和已选将领，而不是能看到全部」——
 * 这一格正是"自己的那一份"：房主按席位各算一帧、指名发给我，别人那一格在这里从来没有过。
 * 所以这一屏上写的每一张牌都是**收到的**，本机一张也不生成（候选名单住在房主的 store 里）。
 *
 * 这里仍然没有判据：名单、勾了哪几颗、"这一席该做什么"那句话、以及那颗「确认征召」按不按得下去
 * （帧上那个 `canConfirm`）全由房主算（`network/netDraftList`），经 `netRoom` 那一格存着，界面照抄——
 * 与 ⑤b 那张进度表同一个纪律。点下去交回线上的也只有**那一格上的位置编号**（`m0…`／`q0…`）：
 * 将名、档案号、任何"我觉得这合法"的话都不在这条路上，房主也不读（判据住在 `netHostDraftList.handleIncoming`）。
 *
 * ⚠️ 牌那颗钮**永远不 disable**（与热座面板的 `isSelectable` 不一样）：这里看不到也猜不出房主那侧的上下限，
 * 灰掉一颗牌等于让客人对着一张不亮的按钮瞎猜。所以点每一颗都必有回音——名单里那颗「已选」动了，
 * 或者上面那行"这一席该做什么"换成房主回他的那句拒话（派单逐字：「拒不得静默」）。
 * 只有「确认征召」读 `frame.canConfirm` 而灰着，因为那一个布尔是房主算好送上来的，不是本机猜的。
 */

const cardLine = (item: NetDraftItem): string =>
  `${item.type === '武将' ? '⚔️' : '📜'} ${item.name}｜${item.faction}｜❤${item.hp} ⚔${item.meleeAtk} 🏹${item.rangedAtk}`;

function DraftListCards({
  title, items, picked, onPick,
}: {
  title: string;
  items: NetDraftItem[];
  picked: readonly string[];
  onPick: (key: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      <p className="text-xs text-amber-300/60">{title}（{items.length} 张）</p>
      <ul className="flex flex-wrap gap-1.5">
        {items.map((item) => {
          const chosen = picked.includes(item.key);
          return (
            <li key={item.key}>
              <button
                type="button"
                // 交回线上的只有这一个位置编号（它来自房主发给我的这一帧，不是本机编的）。
                onClick={() => onPick(item.key)}
                className={`rounded border px-2 py-1 text-xs ${
                  chosen ? 'border-amber-400/70 bg-amber-900/30 text-amber-100' : 'border-amber-700/25 bg-black/25 text-amber-100/85 hover:border-amber-400/60'
                }`}
              >
                <span className="font-bold">{cardLine(item)}</span>
                {item.skills.length > 0 && <span className="text-amber-300/60">｜{item.skills.join('、')}</span>}
                {chosen && <span className="ml-1 font-bold text-amber-200">已选</span>}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function NetDraftListPanel({
  frame, onPick, onConfirm,
}: {
  frame: NetDraftListFrame | null;
  /** 勾一颗／退一颗（同一个编号再点一次就是退）：与热座那颗 `selectDraftGeneral` 一回事，但走线上、由房主重判再执行。 */
  onPick: (key: string) => void;
  /** 交这一席的卷：按不按得下去读的是房主送上来的那一个布尔，本机不重算那条上下限。 */
  onConfirm: () => void;
}) {
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
            // 没轮到你的那一席就停在这里：一份名单都没有，也就一颗钮都不长（点将与确认都长在有名单的那一格底下）。
            <p className="text-xs text-amber-200/45 mt-1.5">这一格现在是空的（房主发过来就是空的，本机不补一张）。</p>
          ) : (
            <>
              <p className="text-xs text-amber-300/60 mt-0.5">
                已选 {frame.picked.length}/{frame.total}（房主那边当下勾着的那几颗在这两份名单上标了「已选」）
              </p>
              <div className="flex flex-col gap-2 mt-1.5">
                <DraftListCards title="本势力候选" items={frame.main} picked={frame.picked} onPick={onPick} />
                <DraftListCards title="群候选" items={frame.qun} picked={frame.picked} onPick={onPick} />
              </div>
              <button
                type="button"
                onClick={onConfirm}
                disabled={!frame.canConfirm}
                className={`mt-2 w-full rounded-xl border px-4 py-2 text-sm font-bold ${
                  frame.canConfirm
                    ? 'border-emerald-600/50 bg-emerald-950/40 text-emerald-100'
                    : 'border-amber-700/25 bg-black/20 text-amber-200/40'
                }`}
              >
                {/* 文案与热座那颗钮同一句（`GeneralDraft.tsx:179-189`）：没凑够时说"还差什么"，凑够了才说"确认"。
                    两者读的都是房主那一笔账（`netDraftList.draftTally`），界面上不另算一遍。 */}
                {frame.canConfirm ? '✓ 确认征召' : `选择${frame.total}名将领（群势力1-3名，还没凑够）`}
              </button>
            </>
          )}
          <p className="text-xs text-amber-200/45 mt-1.5">
            这里的牌一张也不是本机生成的，「已选」那一排是房主那边当下勾着的那几颗，不是本机算的。
            点一颗＝把房主这一帧上的那个位置编号交回给他（将名与档案号压根不上线）；
            他说这一颗不算，那句回答就写在上面"第 {frame.seat} 席"那一行里。
          </p>
        </>
      )}
    </div>
  );
}
