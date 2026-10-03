// 结构化运行时效果编辑器 —— 2.2.14 从 SkillEditor.tsx 纯移动拆出（D-6 阶段 F）。
import {
  SkillRuntimeEffect, StatModifierKeyType, StatModifyModeType, StatModifierDurationType,
  statModifierKeyLabels, statModifyModeLabels, statModifierDurationLabels, STAT_DURATION_DEFAULT_LABEL,
} from '../../data/generals';
import {
  runtimeEffectTypeLabels, runtimeTargetLabels, SETTLEABLE_RUNTIME_TYPES,
  WHOLE_HAND_RUNTIME_TYPES, WHOLE_HAND_LABEL, VALUELESS_RUNTIME_TYPES,
} from '../../skills/skillExcelFormat';

// ── Structured runtime effect editor (类型 + 数值 + 目标) ──
// Only effects carrying a runtime payload are compiled into the game runtime
// (skills/skillCompiler.ts). Types outside SETTLEABLE_RUNTIME_TYPES are shown
// but flagged as "not settleable yet" — the compiler will skip them honestly.
const runtimeSelectCls = "px-2 py-1 rounded bg-black/50 border border-emerald-800/30 text-emerald-100 text-[11px] focus:outline-none focus:border-emerald-500";
/** 「改哪个数」这一栏的预览要把键名与两种形态都说清（固定为 3 与 +3 在账本上是两回事），
 *  所以预览函数除了数值还要读到整条 runtime。 */
const runtimePreviewText: Record<SkillRuntimeEffect['type'], (v: number, rt?: SkillRuntimeEffect) => string> = {
  DRAW_CARD: v => `摸牌 ×${v}`,
  DAMAGE: v => `造成 ${v} 点技能伤害`,
  HEAL: v => `回复 ${v} 点体力`,
  GAIN_ARMOR: v => `获得 ${v} 点护甲`,
  DISCARD: v => (v === 0 ? '弃全部手牌' : `弃 ${v} 张手牌`),
  GIVE: v => (v === 0 ? '发放全部手牌' : `发放 ${v} 张手牌`),
  EQUIP_STRIP: v => `拆掉 ${v} 张军备卡`,
  REVEAL: v => `观看牌堆顶 ${v} 张`,
  DECK_PLACE: v => (v === 0 ? '把全部手牌放回牌堆' : `把 ${v} 张手牌放回牌堆`),
  DUEL: () => '与目标将领决斗（双方各三轮，最多六次）',
  MODIFY_STAT: (v, rt) => {
    const key = statModifierKeyLabels[rt?.stat ?? 'MELEE_ATK'];
    const once = rt?.duration === 'thisDamage' ? '下一次' : '';
    if (rt?.modifyMode === 'set') return `${once}把${key}摁成 ${v}（覆盖卡面上的数）`;
    return v < 0 ? `${once}让${key}减少 ${-v}` : `${once}让${key}增加 ${v}`;
  },
};

export function RuntimeEditor({ runtime, onChange }: { runtime?: SkillRuntimeEffect; onChange: (r: SkillRuntimeEffect | undefined) => void }) {
  const currentType = runtime?.type || '';
  const isSettleable = !currentType || (SETTLEABLE_RUNTIME_TYPES as readonly string[]).includes(currentType);
  // v2.8.13 (#49 方案①，用户 2026-09-29 拍板)：「全部」只有 WHOLE_HAND_RUNTIME_TYPES
  // 三类说得通（它们经 `handSelection.ts` 读手牌，`count === 0`＝整只手）。
  // 其余类型的 0 没有含义，所以勾选框**只在这三类出现**——全局放开数字框＝新的静默失真。
  const supportsWholeHand = !!runtime && WHOLE_HAND_RUNTIME_TYPES.includes(runtime.type);
  const isWholeHand = supportsWholeHand && runtime?.value === 0;
  const isValueless = !!runtime && VALUELESS_RUNTIME_TYPES.includes(runtime.type);
  // v2.8 刀4（#25）：「修改数值」是这一族里**唯一**允许 0 与负数的一档，而且目标只有"自己"。
  const isModifyStat = runtime?.type === 'MODIFY_STAT';

  const handleTypeChange = (val: string) => {
    if (!val) { onChange(undefined); return; }
    const nextType = val as SkillRuntimeEffect['type'];
    const carried = runtime?.value ?? 1;
    onChange({
      type: nextType,
      // 换到一个不懂 0 的类型时绝不把 0 带过去（那正是"界面写 0、引擎当 1"的成因）。
      // 换成根本不读数的类型（决斗）时留空：给它塞一个 1＝把无意义的数字写进数据。
      value: VALUELESS_RUNTIME_TYPES.includes(nextType)
        ? undefined
        : nextType === 'MODIFY_STAT' ? Math.max(-10, Math.min(10, carried))
        : WHOLE_HAND_RUNTIME_TYPES.includes(nextType) ? carried : Math.max(1, carried),
      // 改数只改自己的账面数字；别的类型沿用原目标。换档时把不认识的键一并摘掉，
      // 免得「改哪个数」这类键悄悄留在一条摸牌效果上（留了也没人读＝下一轮分叉）。
      target: nextType === 'MODIFY_STAT' ? 'SELF' : (runtime?.target ?? 'TARGET'),
      ...(nextType === 'MODIFY_STAT'
        ? { stat: runtime?.stat ?? 'MELEE_ATK' as StatModifierKeyType, modifyMode: runtime?.modifyMode ?? 'delta' as StatModifyModeType }
        : { stat: undefined, modifyMode: undefined, duration: undefined }),
      dest: nextType === 'DECK_PLACE' ? runtime?.dest : undefined,
    });
  };

  return (
    <div className="rounded-lg border border-emerald-900/40 bg-emerald-950/15 p-2 space-y-1.5">
      <div className="flex items-center gap-2">
        <label className="text-[10px] text-emerald-400/70 font-bold whitespace-nowrap">⚡ 结构化效果</label>
        <select value={currentType} onChange={e => handleTypeChange(e.target.value)} className={`${runtimeSelectCls} flex-1`}>
          <option value="">纯描述（不参与对局结算）</option>
          {SETTLEABLE_RUNTIME_TYPES.map(t => <option key={t} value={t}>{runtimeEffectTypeLabels[t]}</option>)}
          {currentType && !isSettleable && (
            <option value={currentType}>{runtimeEffectTypeLabels[currentType]}（暂未接入结算）</option>
          )}
        </select>
        {runtime && (
          <button onClick={() => onChange(undefined)}
            className="text-[10px] text-gray-400 hover:text-red-300 px-1.5 py-0.5 rounded hover:bg-red-900/20 flex-shrink-0">
            清除
          </button>
        )}
      </div>

      {runtime && (
        <div className="flex items-center gap-2 pl-4">
          {/* 决斗这类由规则定死数量的效果：不渲染数值行（给它一个数字框＝请项目
              把"界面写 1、生效是六轮"的分叉搬进界面）。目标仍要选——决斗打谁。 */}
          {!isValueless && (
            <>
              <label className="text-[10px] text-emerald-400/50 whitespace-nowrap">└ 数值</label>
              {supportsWholeHand && (
                <label className="flex items-center gap-1 text-[10px] text-emerald-300 whitespace-nowrap">
                  <input type="checkbox" checked={!!isWholeHand} aria-label={WHOLE_HAND_LABEL}
                    onChange={e => onChange({
                      ...runtime,
                      value: e.target.checked ? 0 : Math.max(1, Math.floor(Number(runtime.value ?? 1)) || 1),
                    })} />
                  {WHOLE_HAND_LABEL}
                </label>
              )}
              {/* 勾上「整只手」时**不显示**数字框：让它显示 1 就是数字框与生效值分叉（§12-55 同族）。 */}
              {!isWholeHand && (
                isModifyStat ? (
                  // 全库唯一放开的数字框：增减 −1 与固定为 0 都是合法写法（其余类型不放开，
                  // 因为它们的 0/负数会被引擎换成另一个数——那正是 #49 治的静默失真）。
                  <input type="number" min={-10} max={10} step={1} value={runtime.value ?? 0}
                    aria-label="改数数值"
                    onChange={e => {
                      const n = Math.trunc(Number(e.target.value));
                      onChange({ ...runtime, value: Number.isFinite(n) ? Math.max(-10, Math.min(10, n)) : 0 });
                    }}
                    className={`${runtimeSelectCls} w-16`} />
                ) : (
                  <input type="number" min={1} max={10} value={runtime.value ?? 1}
                    onChange={e => onChange({ ...runtime, value: Math.max(1, parseInt(e.target.value) || 1) })}
                    className={`${runtimeSelectCls} w-16`} />
                )
              )}
            </>
          )}
          <label className="text-[10px] text-emerald-400/50 whitespace-nowrap ml-2">目标</label>
          {isModifyStat ? (
            // 不给下拉＝不给"看起来能选、其实不响"的口子：跨将改数是另一把刀（#28 目标选择器）。
            <span className={`${runtimeSelectCls} flex-1 inline-flex items-center opacity-70`}>
              {runtimeTargetLabels.SELF}（这一档只改自己的账面数字）
            </span>
          ) : (
            <select value={runtime.target || 'TARGET'}
              onChange={e => onChange({ ...runtime, target: e.target.value as NonNullable<SkillRuntimeEffect['target']> })}
              className={`${runtimeSelectCls} flex-1`}>
              {(Object.entries(runtimeTargetLabels) as [NonNullable<SkillRuntimeEffect['target']>, string][]).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          )}
        </div>
      )}

      {runtime?.type === 'DECK_PLACE' && (
        <div className="flex items-center gap-2 pl-4">
          <label className="text-[10px] text-emerald-400/50 whitespace-nowrap">└ 放置位置</label>
          <select value={runtime.dest || 'BOTTOM'}
            onChange={e => onChange({ ...runtime, dest: e.target.value as NonNullable<SkillRuntimeEffect['dest']> })}
            className={`${runtimeSelectCls} flex-1`}>
            <option value="BOTTOM">牌堆底（默认）</option>
            <option value="TOP">牌堆顶</option>
          </select>
        </div>
      )}

      {runtime?.type === 'MODIFY_STAT' && (
        <div className="space-y-1.5 pl-4">
          <div className="flex items-center gap-2">
            <label className="text-[10px] text-emerald-400/50 whitespace-nowrap">└ 改哪个数</label>
            <select value={runtime.stat ?? 'MELEE_ATK'}
              onChange={e => onChange({ ...runtime, stat: e.target.value as StatModifierKeyType })}
              className={`${runtimeSelectCls} flex-1`}>
              {(Object.entries(statModifierKeyLabels) as [StatModifierKeyType, string][]).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-[10px] text-emerald-400/50 whitespace-nowrap">└ 怎么改</label>
            <select value={runtime.modifyMode ?? 'delta'}
              onChange={e => onChange({ ...runtime, modifyMode: e.target.value as StatModifyModeType })}
              className={`${runtimeSelectCls} flex-1`}>
              {(Object.entries(statModifyModeLabels) as [StatModifyModeType, string][]).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-[10px] text-emerald-400/50 whitespace-nowrap">└ 有效周期</label>
            <select value={runtime.duration ?? ''}
              onChange={e => onChange({ ...runtime, duration: (e.target.value || undefined) as StatModifierDurationType | undefined })}
              className={`${runtimeSelectCls} flex-1`}>
              <option value="">{STAT_DURATION_DEFAULT_LABEL}</option>
              {(Object.entries(statModifierDurationLabels) as [StatModifierDurationType, string][]).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>
          <p className="text-[9px] text-emerald-300/40">
            留空那一档＝在场上就一直有效、离场当场结束；账本上「固定为」压过「增减」，同形态按发动先后累加。
            「一次性（用掉就销）」＝只挡下下一次真正读到它的那一笔，用完当场销账，只有「受到的伤害」这一把钥匙有这一刻。
          </p>
          {runtime.duration === 'thisDamage' && runtime.stat !== 'DAMAGE_TAKEN' && (
            <p className="text-[9px] text-rose-400/80">
              这一把钥匙没有"被用掉一次"的那一刻：一次性请配「受到的伤害」。这样填的效果保存后会被引擎逐条点名跳过，不会悄悄生效一半。
            </p>
          )}
        </div>
      )}

      {runtime && (
        <div className="flex items-center gap-1.5 pt-0.5 flex-wrap">
          <span className="text-[9px] text-emerald-500/50">预览：</span>
          <span className="text-[10px] text-emerald-300 font-bold">{runtimePreviewText[runtime.type](runtime.value ?? (isModifyStat ? 0 : 1), runtime)}</span>
          <span className="text-[10px] text-emerald-400/70">→ {runtimeTargetLabels[runtime.target || (isModifyStat ? 'SELF' : 'TARGET')]}</span>
          {!isSettleable && <span className="text-[10px] text-amber-400">⚠ 当前版本该类型不参与结算</span>}
        </div>
      )}
    </div>
  );
}
