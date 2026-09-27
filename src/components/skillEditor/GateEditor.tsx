// 发动门槛编辑器 —— v2.8.3 刀 B 新增（门槛挂在单条效果上，全部条件成立才发动）。
// 录入用大白话文本，实时翻译成结构化条件；翻译不了的片段就地标红，绝不静默丢弃。
import { useState } from 'react';
import type { SkillCondition } from '../../data/generals';
import { parseGateText, gateConditionsToText } from '../../skills/skillGateText';

const gateInputCls = "flex-1 px-2 py-1 rounded bg-black/50 border border-sky-800/30 text-sky-100 text-[11px] focus:outline-none focus:border-sky-500";

export function GateEditor({ conditions, onChange }: {
  conditions?: SkillCondition[];
  onChange: (c: SkillCondition[] | undefined) => void;
}) {
  const canonical = gateConditionsToText(conditions);
  const [draft, setDraft] = useState(() => ({ text: canonical, synced: conditions }));
  // 外部改动（Excel 导入、切换效果）覆盖本地草稿；自己打字产生的改动不覆盖。
  if (draft.synced !== conditions && draft.text !== canonical) {
    setDraft({ text: canonical, synced: conditions });
  }

  const parsed = parseGateText(draft.text);

  const handleText = (v: string) => {
    const next = parseGateText(v);
    const conditionsNext = next.conditions.length > 0 ? next.conditions : undefined;
    setDraft({ text: v, synced: conditionsNext });
    onChange(conditionsNext);
  };

  const hasText = draft.text.trim() !== '' && draft.text.trim() !== '无';

  return (
    <div className="rounded-lg border border-sky-900/40 bg-sky-950/15 p-2 space-y-1">
      <div className="flex items-center gap-2">
        <label className="text-[10px] text-sky-400/70 font-bold whitespace-nowrap">🚪 发动门槛</label>
        <input type="text" value={draft.text} onChange={e => handleText(e.target.value)}
          placeholder="留空＝没门槛。例：手牌≤2，牌堆≥5" className={gateInputCls} />
        {hasText && (
          <button onClick={() => handleText('无')}
            className="text-[10px] text-gray-400 hover:text-red-300 px-1.5 py-0.5 rounded hover:bg-red-900/20 flex-shrink-0">
            清除
          </button>
        )}
      </div>

      <div className="flex items-start gap-1 flex-wrap">
        <span className="text-[9px] text-sky-500/50 flex-shrink-0 pt-0.5">看懂了：</span>
        {parsed.conditions.length > 0
          ? parsed.conditions.map((c, i) => (
            <span key={i} className="text-[10px] text-sky-200 font-bold">
              {i > 0 && <span className="text-sky-400/60 font-normal"> 且 </span>}
              {gateConditionsToText([c])}
            </span>
          ))
          : <span className="text-[10px] text-sky-400/60">没有门槛（满足触发时机就发动）</span>}
      </div>

      {parsed.unknown.length > 0 && (
        <div className="rounded bg-red-950/40 border border-red-800/40 px-1.5 py-1">
          <span className="text-[10px] text-red-300 font-bold">没看懂（这些条件不会生效）：</span>
          {parsed.unknown.map((u, i) => <span key={i} className="text-[10px] text-red-200">「{u}」</span>)}
        </div>
      )}

      {parsed.conditions.some(c => c.metric === 'EVENT_VALUE') && (
        <p className="text-[9px] text-amber-300/85 leading-tight">
          ⚠ 「本次伤害」只有受到伤害/造成伤害这一类触发时机才有账可查；挂在别的触发时机上这条门槛永远不成立，技能不会发动。
        </p>
      )}

      <p className="text-[9px] text-sky-400/45 leading-tight">
        能填的量只有：手牌 / 体力 / 护甲 / 场上将领 / 牌堆 / 本次伤害；
        对象只有：自身（不写就是自身）/ 被作用者 / 伤害来源（牌堆与本次伤害是全局事实，不分对象）；
        多条条件用顿号或逗号分开＝ 全部满足才发动；两边都可以填数，也可以跟另一个量比（例：手牌&gt;自身手牌）
      </p>
    </div>
  );
}
