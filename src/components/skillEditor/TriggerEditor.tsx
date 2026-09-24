// 触发时机编辑器子组件 —— 2.2.14 从 SkillEditor.tsx 纯移动拆出（D-6 阶段 F）。
import {
  SkillTriggerConfig, SkillTriggerType, allTriggerTypes, triggerTypeLabels,
  getTriggerSubOptions,
  DeploySubType, deploySubLabels,
  TurnSubType, turnSubLabels,
  DamageSubType, damageSubLabels,
  KillSubType, killSubLabels,
  ExpireCondition, expireLabels,
} from '../../data/generals';

// ── Trigger editor sub-component ──
const selectCls = "w-full px-2 py-1 rounded bg-black/50 border border-cyan-800/30 text-cyan-100 text-[11px] focus:outline-none focus:border-cyan-500";

export function TriggerEditor({ trigger, onChange }: { trigger?: SkillTriggerConfig; onChange: (t: SkillTriggerConfig | undefined) => void }) {
  const currentType = trigger?.type || '';
  const subKind = currentType ? getTriggerSubOptions(currentType as SkillTriggerType) : null;

  const handleTypeChange = (val: string) => {
    if (!val) { onChange(undefined); return; }
    const t = val as SkillTriggerType;
    onChange({ type: t });
  };

  const handleSubChange = (field: string, val: string) => {
    if (!trigger) return;
    if (!val) { onChange({ type: trigger.type }); return; }
    onChange({ ...trigger, [field]: val });
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
          {subKind === 'expire' && trigger?.expireCondition && <span className="text-[10px] text-cyan-400/70">→ {expireLabels[trigger.expireCondition]}</span>}
        </div>
      )}
    </div>
  );
}
