// 触发时机编辑器子组件 —— 2.2.14 从 SkillEditor.tsx 纯移动拆出（D-6 阶段 F）。
import { useState } from 'react';
import {
  SkillTriggerConfig, SkillTriggerType, allTriggerTypes, triggerTypeLabels,
  getTriggerSubOptions,
  DeploySubType, deploySubLabels,
  TurnSubType, turnSubLabels,
  DamageSubType, damageSubLabels,
  KillSubType, killSubLabels,
  CardSubType, cardSubLabels,
  ExpireCondition, expireLabels,
} from '../../data/generals';
import { readTriggerCell, buildTriggerOptionStrings } from '../../skills/skillExcelFormat';

// ── Trigger editor sub-component ──
const selectCls = "w-full px-2 py-1 rounded bg-black/50 border border-cyan-800/30 text-cyan-100 text-[11px] focus:outline-none focus:border-cyan-500";

/** 可认识的触发说法（与 Excel 下拉同源，避免两处各写一份）。 */
const knownTriggerStrings = buildTriggerOptionStrings().filter(s => s !== '无');

export function TriggerEditor({ trigger, onChange }: { trigger?: SkillTriggerConfig; onChange: (t: SkillTriggerConfig | undefined) => void }) {
  const currentType = trigger?.type || '';
  const subKind = currentType ? getTriggerSubOptions(currentType as SkillTriggerType) : null;
  const [quick, setQuick] = useState('');
  const [quickMiss, setQuickMiss] = useState(false);

  // 打字快填：认得就填进下拉，认不得就地说明，绝不猜。
  // 只认与下拉逐字相同的写法：「受到伤害后→攻击」这类半截细分会被宽松读法悄悄当成
  // "未选细分＝所有伤害"，等于替用户放宽了他自己写下的限制——宁可报没看懂。
  const applyQuick = () => {
    const { trigger, unreadable } = readTriggerCell(quick);
    if (trigger) { onChange(trigger); setQuickMiss(false); }
    else if (!unreadable) { resetQuick(undefined); } // 「无」＝没有触发时机
    else { setQuickMiss(true); }
  };
  const resetQuick = (t?: SkillTriggerConfig) => { setQuick(''); setQuickMiss(false); onChange(t); };

  const handleTypeChange = (val: string) => {
    if (!val) { resetQuick(undefined); return; }
    resetQuick({ type: val as SkillTriggerType });
  };

  const handleSubChange = (field: string, val: string) => {
    if (!trigger) return;
    if (!val) { resetQuick({ type: trigger.type }); return; }
    resetQuick({ ...trigger, [field]: val });
  };

  return (
    <div className="rounded-lg border border-cyan-900/30 bg-cyan-950/15 p-2 space-y-1.5">
      <div className="flex items-center gap-2">
        <label className="text-[10px] text-cyan-400/70 font-bold whitespace-nowrap">⏱ 触发时机</label>
        <select value={currentType} onChange={e => handleTypeChange(e.target.value)} className={selectCls}>
          <option value="">未设定</option>
          {allTriggerTypes.map(t => <option key={t} value={t}>{triggerTypeLabels[t]}</option>)}
        </select>
      </div>

      {/* 打字快填（与 Excel「触发时机」栏同一套说法） */}
      <div className="pl-4 space-y-1">
        <div className="flex items-center gap-1.5">
          <input type="text" value={quick} onChange={e => { setQuick(e.target.value); setQuickMiss(false); }}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); applyQuick(); } }}
            placeholder="或打字：受到伤害后→所有伤害类型"
            className="flex-1 px-2 py-1 rounded bg-black/50 border border-cyan-800/30 text-cyan-100 text-[11px] focus:outline-none focus:border-cyan-500" />
          <button onClick={applyQuick} disabled={!quick.trim()}
            className={`text-[10px] px-2 py-1 rounded border flex-shrink-0 ${quick.trim() ? 'border-cyan-700/40 text-cyan-200 hover:bg-cyan-900/30' : 'border-gray-800 text-gray-600 cursor-not-allowed'}`}>
            照这个填
          </button>
        </div>
        {quickMiss && (
          <p className="text-[9px] text-red-300/90 leading-tight">
            这个写法没看懂，没有填进去（细分要写全，例如「→攻击伤害」而不是「→攻击」）。认得的写法（也可以照抄）：{knownTriggerStrings.join('、')}
          </p>
        )}
      </div>

      {/* Sub-options that appear conditionally */}
      {subKind === 'deploy' && (
        <div className="flex items-center gap-2 pl-4">
          <label className="text-[10px] text-cyan-400/50 whitespace-nowrap">└ 细分</label>
          <select value={trigger?.deploySubType || ''} onChange={e => handleSubChange('deploySubType', e.target.value)} className={selectCls}>
            <option value="">请选择</option>
            {(Object.entries(deploySubLabels) as [DeploySubType, string][]).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
      )}

      {subKind === 'turn' && (
        <div className="flex items-center gap-2 pl-4">
          <label className="text-[10px] text-cyan-400/50 whitespace-nowrap">└ 细分</label>
          <select value={trigger?.turnSubType || ''} onChange={e => handleSubChange('turnSubType', e.target.value)} className={selectCls}>
            <option value="">请选择</option>
            {(Object.entries(turnSubLabels) as [TurnSubType, string][]).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
      )}

      {subKind === 'damage' && (
        <div className="flex items-center gap-2 pl-4">
          <label className="text-[10px] text-cyan-400/50 whitespace-nowrap">└ 伤害类型</label>
          <select value={trigger?.damageSubType || ''} onChange={e => handleSubChange('damageSubType', e.target.value)} className={selectCls}>
            <option value="">请选择</option>
            {(Object.entries(damageSubLabels) as [DamageSubType, string][]).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
      )}

      {subKind === 'kill' && (
        <div className="flex items-center gap-2 pl-4">
          <label className="text-[10px] text-cyan-400/50 whitespace-nowrap">└ 击杀对象</label>
          <select value={trigger?.killSubType || ''} onChange={e => handleSubChange('killSubType', e.target.value)} className={selectCls}>
            <option value="">请选择</option>
            {(Object.entries(killSubLabels) as [KillSubType, string][]).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
      )}

      {subKind === 'card' && (
        <div className="flex items-center gap-2 pl-4">
          <label className="text-[10px] text-cyan-400/50 whitespace-nowrap">└ 卡牌时机</label>
          <select value={trigger?.cardSubType || ''} onChange={e => handleSubChange('cardSubType', e.target.value)} className={selectCls}>
            <option value="">请选择</option>
            {(Object.entries(cardSubLabels) as [CardSubType, string][]).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
      )}

      {subKind === 'expire' && (
        <div className="flex items-center gap-2 pl-4">
          <label className="text-[10px] text-cyan-400/50 whitespace-nowrap">└ 失效条件</label>
          <select value={trigger?.expireCondition || ''} onChange={e => handleSubChange('expireCondition', e.target.value)} className={selectCls}>
            <option value="">请选择</option>
            {(Object.entries(expireLabels) as [ExpireCondition, string][]).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
      )}

      {/* Preview summary */}
      {currentType && (
        <div className="flex items-center gap-1 pt-0.5">
          <span className="text-[9px] text-cyan-500/50">预览：</span>
          <span className="text-[10px] text-cyan-300 font-bold">{triggerTypeLabels[currentType as SkillTriggerType]}</span>
          {subKind === 'deploy' && trigger?.deploySubType && <span className="text-[10px] text-cyan-400/70">→ {deploySubLabels[trigger.deploySubType]}</span>}
          {subKind === 'turn' && trigger?.turnSubType && <span className="text-[10px] text-cyan-400/70">→ {turnSubLabels[trigger.turnSubType]}</span>}
          {subKind === 'damage' && trigger?.damageSubType && <span className="text-[10px] text-cyan-400/70">→ {damageSubLabels[trigger.damageSubType]}</span>}
          {subKind === 'kill' && trigger?.killSubType && <span className="text-[10px] text-cyan-400/70">→ {killSubLabels[trigger.killSubType]}</span>}
          {subKind === 'card' && trigger?.cardSubType && <span className="text-[10px] text-cyan-400/70">→ {cardSubLabels[trigger.cardSubType]}</span>}
          {subKind === 'expire' && trigger?.expireCondition && <span className="text-[10px] text-cyan-400/70">→ {expireLabels[trigger.expireCondition]}</span>}
        </div>
      )}
    </div>
  );
}
