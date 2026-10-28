// 一句话生成将领 —— v2.9.24 刀2（用户 §12-140① 那句「将领名称、势力、体力、原始攻击力等数值
// 也都可以一句生成」的离线词表档）。
//
// 这一格只做三件事：把那句话交给 `generalTextParse` 反解、把"系统会怎么读"摊出来让玩家确认、
// 点采用才落格子。它**不建卡、不写库**：
//  · mode＝'create' 采用＝调用方走 `createAuthoredGeneral` 那唯一一条建卡路（本组件不碰 store）；
//  · mode＝'edit'   采用＝只把读到的字段填进上面那几格，落档仍然只有「💾 保存修改」那一条路。
// 认不出的一段一律回原文＋一句改得动的理由（与 v2.9.9「自己写效果」同一套纪律），绝不替玩家猜名字
// 之外的任何一格；五格里只有体力能兜底，而那个数由调用方用 `hpOrDefault` 取，不在这里写第二份。
import { useState } from 'react';
import type { GeneralTextDraft } from './generalTextParse';
import { canAdoptGeneral, describeGeneralDraft, missingRequiredFields, parseGeneralText } from './generalTextParse';

const hintCls = 'text-[9px] leading-tight';

export function GeneralTextPanel({ mode, onAdopt }: {
  mode: 'create' | 'edit';
  onAdopt: (draft: GeneralTextDraft) => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [draft, setDraft] = useState<GeneralTextDraft | null>(null);

  const close = () => { setOpen(false); setDraft(null); };

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}
        className="px-3 py-1 rounded bg-violet-700/50 border border-violet-600/40 text-violet-100 text-sm font-bold hover:bg-violet-600/60">
        🪄 一句话生成将领
      </button>
    );
  }

  const missing = draft ? missingRequiredFields(draft) : [];
  const adoptable = draft !== null && canAdoptGeneral(draft);

  return (
    <div className="rounded-lg border border-violet-900/40 bg-violet-950/20 p-2 space-y-1.5">
      <div className="flex items-center justify-between">
        <label className="text-[10px] text-violet-300/80 font-bold">🪄 说一句话，系统替您读这张将</label>
        <button onClick={close} className="text-[10px] text-gray-400 hover:text-gray-200 px-1.5">✕</button>
      </div>
      <textarea value={text} onChange={e => setText(e.target.value)}
        aria-label="一句话生成将领"
        placeholder={'逗号（或顿号）分开一句一格。例：\n张辽，势力魏，体力4，技能：突袭和骁果\n名：赵云，蜀，4点体力，远程2\n读不懂的那一段会单独点名，不会替您猜。'}
        className="w-full px-2 py-1.5 rounded bg-black/50 border border-violet-800/30 text-violet-100 text-[11px] h-16 resize-none focus:outline-none focus:border-violet-500" />
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => setDraft(parseGeneralText(text))}
          className="text-[10px] px-2 py-1 rounded border border-violet-700/50 text-violet-200 hover:bg-violet-900/30">
          按这句生成
        </button>
        {draft && <span className={`${hintCls} text-violet-300/70`}>下面是系统准备替您落的字段，看着不对就别采用。</span>}
      </div>

      {draft && (
        <div className="space-y-1">
          <ul className="space-y-0.5">
            {describeGeneralDraft(draft, mode).map((line, i) => (
              <li key={i} className={`text-[10px] leading-tight ${line.startsWith('✕') ? 'text-rose-300' : 'text-violet-200'}`}>
                {line.startsWith('✕') ? line : `· ${line}`}
              </li>
            ))}
          </ul>
          {missing.length > 0 && (
            <p className={`${hintCls} text-rose-300/90`}>
              缺了：{missing.join('／')}——这两格我不替您猜，补进这句话或直接用手填。
            </p>
          )}
          <button type="button" onClick={() => { onAdopt(draft); close(); }} disabled={!adoptable}
            className={`w-full py-1.5 rounded-lg border text-[11px] font-bold ${adoptable
              ? 'bg-violet-700/50 border-violet-600/50 text-violet-100 hover:bg-violet-600/60'
              : 'bg-gray-800/60 border-gray-700/40 text-gray-500 cursor-not-allowed'}`}>
            {mode === 'create'
              ? '✔ 采用并按这句建这张将（走正常建卡那一条路）'
              : '✔ 采用，把读到的填进上面那几格（还没保存）'}
          </button>
        </div>
      )}
    </div>
  );
}
