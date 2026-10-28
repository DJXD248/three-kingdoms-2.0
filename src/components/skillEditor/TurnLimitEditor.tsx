// 「每回合限几次」那一格 —— 限次刀新增。
// 这一格只有一件事要说清：留空＝不限制，写了就必须是 1 以上的整数。系统不猜数，
// 也不把"这一串没读懂"偷偷当成 1、或偷偷当成没有限次（合法与否只认
// `data/generals.ts::isValidTurnLimit` 那一份判据，界面、Excel、内容包都读它）。
// 次数在**谁的回合**归零、用完界面怎么说，都不在这一格决定：归零点由引擎的窗口戳说了算，
// 能不能在别人的回合发动由「触发时机」与「我听谁」那两格说了算。
import { useState } from 'react';
import { isValidTurnLimit } from '../../data/generals';
import { TURN_LIMIT_HEADER, TURN_LIMIT_HINT } from '../../skills/skillExcelFormat';

export function TurnLimitEditor({ turnLimit, onChange }: {
  turnLimit?: number;
  onChange: (n: number | undefined) => void;
}) {
  // draft 只在玩家正在打字的这一小段时间里存在；一离开这一格就回到"技能上记着的那个数"。
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? (turnLimit === undefined ? '' : String(turnLimit));
  const unreadable = text.trim() !== '' && !isValidTurnLimit(Number(text));

  const handleChange = (next: string) => {
    setDraft(next);
    if (next.trim() === '') { onChange(undefined); return; }
    const n = Number(next);
    if (isValidTurnLimit(n)) onChange(n);
  };

  return (
    <div className="w-24 flex flex-col items-center" title={TURN_LIMIT_HINT}>
      <label className="text-[10px] text-purple-400/60 mb-1 block">{TURN_LIMIT_HEADER}</label>
      <input type="number" min={1} step={1} placeholder="不限"
        aria-label={TURN_LIMIT_HEADER}
        value={text}
        onChange={e => handleChange(e.target.value)}
        onBlur={() => setDraft(null)}
        className={`w-16 px-1.5 py-0.5 rounded bg-black/50 border text-[11px] text-center focus:outline-none focus:border-purple-500 ${
          unreadable ? 'border-rose-600/60 text-rose-200' : 'border-purple-700/30 text-purple-100'}`} />
      {unreadable
        ? <span className="text-[9px] text-rose-300 leading-tight">只认 1 以上的整数：这一串没写进技能</span>
        : <span className="text-[9px] text-purple-400/40 leading-tight">{turnLimit === undefined ? '留空＝不限制' : `下一格回合开始归零`}</span>}
    </div>
  );
}
