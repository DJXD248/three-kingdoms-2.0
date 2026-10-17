// 自己写效果 —— v2.9.9 新增（用户 2026-10-17 原话：「让玩家自己写技能效果，然后生成一个
// 技能给玩家确认，玩家觉得不对还能进入拼积木修改界面，遇到不支持的技能效果则返回说明哪一段不支持」）。
//
// 这一格只做三件事：把那句话交给离线词表反解（`skills/skillTextParse`）、把"系统会怎么说"
// 摊在玩家面前让他确认、把读懂的每一段与没读懂的每一段分开点名。认不出来的一律回原文＋
// 一句照着改得动的理由，绝不猜一个像的出来，也没有一段是悄悄丢掉的：读不懂的一段排在动作
// **前面**＝它在给这个动作补"对谁／在什么前提下"，那条效果整条退回；排在动作**后面**＝像第二件事，
// 前面那件照做、这一段单独点名。
import { useState } from 'react';
import type { SkillTextDraft } from '../../skills/skillTextParse';
import { parseSkillText } from '../../skills/skillTextParse';
import { effectSentence } from '../../skills/skillSentence';
import { gateConditionsToText } from '../../skills/skillGateText';

const hintCls = 'text-[9px] leading-tight';

export function SkillTextPanel({ onAdopt }: {
  /** 采用＝把这些积木并进技能，随后界面上就是拼积木那套格子，玩家可以逐格改。 */
  onAdopt: (draft: SkillTextDraft) => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [draft, setDraft] = useState<SkillTextDraft | null>(null);

  const close = () => { setOpen(false); setDraft(null); };

  if (!open) {
    return (
      <button onClick={() => setOpen(true)}
        className="w-full py-1 rounded text-[10px] text-emerald-500/60 hover:text-emerald-300 hover:bg-emerald-900/10 transition-all">
        ✍️ 自己写效果（一句话生成积木）
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-emerald-900/40 bg-emerald-950/15 p-2 space-y-1.5">
      <div className="flex items-center justify-between">
        <label className="text-[10px] text-emerald-400/80 font-bold">✍️ 自己写效果，系统替您拼积木</label>
        <button onClick={close} className="text-[10px] text-gray-400 hover:text-gray-200 px-1.5">✕</button>
      </div>
      <textarea value={text} onChange={e => setText(e.target.value)}
        aria-label="自己写效果"
        placeholder={'一行一段，句号分开。例：\n受到伤害后，对伤害来源，回复 1 点体力。\n以下依次生效，回合开始时，摸 2 张牌；造成伤害后，造成 1 点技能伤害。'}
        className="w-full px-2 py-1.5 rounded bg-black/50 border border-emerald-800/30 text-emerald-100 text-[11px] h-20 resize-none focus:outline-none focus:border-emerald-500" />
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => setDraft(parseSkillText(text))}
          className="text-[10px] px-2 py-1 rounded border border-emerald-700/50 text-emerald-200 hover:bg-emerald-900/30">
          按这句生成
        </button>
        {draft && <span className={`${hintCls} text-emerald-300/70`}>下面是系统准备替您写进卡面的话，看着不对就别采用。</span>}
      </div>

      {draft && (
        <div className="space-y-1">
          {draft.effects.length > 0 && (
            <ul className="space-y-0.5">
              {draft.effects.map((eff, i) => (
                <li key={i} className="text-[10px] text-emerald-300">✔ {effectSentence(eff)}</li>
              ))}
            </ul>
          )}
          {draft.issues.map((issue, i) => (
            <p key={`i${i}`} className="text-[10px] text-rose-300 leading-tight">
              ✕ 不支持的一段：「{issue.raw}」—— {issue.reason}
            </p>
          ))}
          {draft.notices.map((notice, i) => (
            <p key={`n${i}`} className="text-[10px] text-amber-300 leading-tight">
              ⚠ 这条效果照样生成、也能采用，但今天还不会响：「{notice.raw}」—— {notice.reason}
            </p>
          ))}
          {draft.ignored.length > 0 && (
            <p className={`${hintCls} text-gray-400`}>
              这几个字被当成连接词忽略（不承载任何一格）：{draft.ignored.join('、')}
            </p>
          )}
          {draft.conditions && draft.conditions.length > 0 && (
            <p className={`${hintCls} text-sky-300/70`}>
              整组门槛也一并记下：{gateConditionsToText(draft.conditions)}（每一条效果都要满足它）
            </p>
          )}
          {draft.effectMode && (
            <p className={`${hintCls} text-sky-300/70`}>
              模式按您写的头一句记下了：{draft.effectMode === 'choice' ? '以下择一' : '以下依次生效'}
            </p>
          )}
          {draft.effects.length === 0 ? (
            <p className={`${hintCls} text-rose-300/80`}>一句也没生成。上面逐条说了哪一段读不懂、照着改哪一格。</p>
          ) : (
            <button type="button" onClick={() => { onAdopt(draft); close(); }}
              className="w-full py-1.5 rounded-lg bg-emerald-700/40 border border-emerald-600/50 text-emerald-100 text-[11px] font-bold hover:bg-emerald-700/60">
              ✔ 采用这 {draft.effects.length} 条效果（进下面的拼积木格子逐条改）
            </button>
          )}
        </div>
      )}
    </div>
  );
}
