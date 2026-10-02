/**
 * 数值修正器账本的落笔／销笔（2.8 刀4＝#25，PROJECT_ARCH_MAP §F「数值修正器管线」）。
 *
 * 一句话：**这条管线从不改写卡面，只往账本上添一笔、减一笔**。卡面上印的那几个数
 * 从头到尾不变（用户裁决第 3 条"在场即生效"、第 4 条"固定失效后增减恢复参与"都要
 * 求"改数"与"改卡"分开），所有被改的数字一律在**读数点**现算：基础值 + 账本。
 *
 * 编号权在处理器，不在发射器：`sm:<seq>` 由"落账那一刻的账本"纯派生（零 RNG，
 * 见 statModifiers.nextModifierSeq）。常驻／重建／回放拿到的是同一份账⇒同一个号，
 * 这是四路逐字同果的结构性质，不是靠大家约好怎么编号。
 *
 * 唯一一处真状态位移在 `MAX_HP` 上：体力上限被改小，超出的那部分**当场回落截断**
 * （用户裁决第 11 条：截断不是伤害、也不是"失去体力"，所以它不响受击／受伤两声）；
 * 上限被固定成 0 或负数＝这一员将不许存活⇒当场阵亡（收尸路与伤害致死逐字同一条：
 * 护甲随人下场、将卡进阵亡方坟场、人从场上移除）。
 */
import type { EngineState, EnginePlayer } from '../GameState';
import type { GameEvent, StatModifyEventData } from '../Event';
import { getRuntimeCardId } from '../../utils/runtimeIdentity';
import {
  addModifier,
  effectiveMaxHp,
  type StatModifier,
} from '../statModifiers';

/** 发射器交来的那笔账：不带号（号在这里按当前账本发）。 */
export type NewStatModifier = Omit<StatModifier, 'id' | 'seq'>;

function withLedger(state: EngineState, ledger: StatModifier[]): EngineState {
  // 空账＝这一格压根不存在（不是 `[]`）：旧存档、旧录像、今日所有对局都读成
  // "没有账"，事件流逐字与刀前一致⇒两锚 B13/B14 不换名（契约表第四节预测）。
  return ledger.length > 0
    ? { ...state, statModifiers: ledger }
    : { ...state, statModifiers: undefined };
}

/**
 * 体力上限回落截断：账本一变（落笔与销笔同样会改变上限）就把"当前体力高于现上限"
 * 的几位当场截回来。截断量不记成伤害、不记成失去体力⇒受击／受伤两声都不响。
 */
function clampToMaxHp(state: EngineState): EngineState {
  const ledger = state.statModifiers;
  if (!ledger || ledger.length === 0) return state;
  if (!ledger.some(mod => mod.key === 'MAX_HP')) return state;

  let changed = false;
  let buriedArmor: unknown[] = [];
  const players = state.players.map((player: EnginePlayer) => {
    const fieldGenerals = Array.isArray(player.fieldGenerals) ? player.fieldGenerals as any[] : [];
    if (fieldGenerals.length === 0) return player;

    const nextField: any[] = [];
    const graves: unknown[] = [];
    let touched = false;
    for (const fg of fieldGenerals) {
      const generalId = String(getRuntimeCardId(fg?.general as never) ?? '');
      const effMax = effectiveMaxHp(ledger, { playerId: player.id, generalId }, fg ?? {});
      const currentHp = Number(fg?.currentHp ?? 0);
      if (effMax > 0 && currentHp <= effMax) {
        nextField.push(fg);
        continue;
      }
      touched = true;
      if (effMax > 0) {
        nextField.push({ ...fg, currentHp: effMax });
        continue;
      }
      // 上限≤0＝不许存活：与 applyDamageEvent 的致死收尸逐字同路。谁响由派生侧
      // 的 DEATH{deathCause:'MAX_HP_ZERO'} 决定（不记击杀、不响遗言）。
      const attached = Array.isArray(fg?.armorCards) ? fg.armorCards as any[] : [];
      buriedArmor = [...buriedArmor, ...attached];
      graves.push(fg?.general);
    }
    if (!touched) return player;
    changed = true;
    if (graves.length === 0) return { ...player, fieldGenerals: nextField };
    return {
      ...player,
      fieldGenerals: nextField,
      graveyard: [...(Array.isArray(player.graveyard) ? player.graveyard : []), ...graves],
    };
  });

  if (!changed) return state;
  // 随人下葬＝与 `applyDamageEvent` 的致死收尸同一条：不看牌面印的是什么类型，
  // 挂在身上的那一叠一律进弃牌堆。拆装备那条「回归属席位料堆」的路只属于
  // `EQUIP_STRIP`（那是"被移除"，不是"人没了"），阵亡这里绝不另分一路。
  return {
    ...state,
    players,
    ...(buriedArmor.length > 0 ? { discardPile: [...state.discardPile, ...buriedArmor] } : {}),
  };
}

export function applyStatModifyEvent(state: EngineState, event: GameEvent): EngineState {
  const data = event.data as StatModifyEventData | undefined;
  if (!data?.op) return state;

  const current = Array.isArray(state.statModifiers) ? state.statModifiers : [];
  if (data.op === 'ADD') {
    if (!data.modifier) return state;
    return clampToMaxHp(withLedger(state, addModifier(current, data.modifier)));
  }

  // REMOVE：**这里不读 `locked`**。能走到这条路的都是生命周期收账（离场、到期）——
  // 那不是"无效化别人那笔账"，是"人在场／周期未到"这个前提本身没了。真正"移走别人
  // 那笔账"的外部入口只有 statModifiers.revokeModifier，它在发射前就把锁定笔拒掉。
  const wanted = new Set((data.ids ?? []).map(String));
  if (wanted.size === 0) return state;
  const kept = current.filter(mod => !wanted.has(mod.id));
  if (kept.length === current.length) return state;
  return clampToMaxHp(withLedger(state, kept));
}
