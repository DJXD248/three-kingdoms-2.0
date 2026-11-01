/**
 * J4 执行路复用（v2.9.11）＋ 乙 线第三片㈂（2026-11-01）。
 *
 * 「一枚合法动作怎么变成牌桌上的一步」这条翻译过去只有一份，住在 AI 司机里
 * （2.2.9 起）：AI 与人类走同一条路，靠的就是这个唯一出口。联机客人动手（J4）
 * 再要一份翻译＝两份会漂移的口径，所以把它原样搬到 store 层，司机和房主的
 * 远端执行器一起用。**行为零改动**：逐条 case、兜底、返回 false 的形状都照旧。
 *
 * 每个出口都落到"牌桌那 14 个入口"（executeDraw/deployGeneral/… → engineSteps → 唯一闸口），
 * 于是远端那一席、本机热座、以及算牌进程里那一局读同一份规则真值。
 *
 * ㈂ 改的只有**参数形状**：原来写死 `GameState`＝整个浏览器 store 快照，进程那份没有那些
 * 展示字段（`drawContext`／`turnEndAsk`／`players`…），于是把它降成一个**只要求这 14 个入口
 * ＋一份引擎读数**的结构化口子 `CanonicalActionHost`。生产 store 的 `GameState` 本来就满足它
 * （一个方法都没改签名），算牌进程那份由 `setup/tableCompute.ts` 现造。switch 体逐字未动。
 */
import type { GameAction } from '../action/ActionTypes';
import type { EngineState } from '../core/GameState';
import type { General } from '../data/generals';
import type { GameCard } from '../data/cards';
import { getReactionAsk, type ReactionAsk } from '../skills/reactionChain';
import type { Position } from './gameStoreTypes';

interface DrawPayload { fromGeneralPool?: number; fromCardPool?: number }

/**
 * ㈂：这一份是"牌桌那 14 个入口"的**最小形状**——浏览器侧由 `GameState` 天然满足，
 * 进程侧由 `createTableHost()` 现造。判据本身不在这里（在 engineSteps），这里只做翻译。
 */
export interface CanonicalActionHost {
  engineState: EngineState;
  executeDraw: (fromPool: number, fromDeck: number) => boolean;
  confirmDraw: () => void;
  resolvePendingDrawLoss: () => void;
  deployGeneral: (general: General, slot: number, consume: (General | GameCard)[]) => boolean;
  moveGeneral: (id: string, target: Position, consume?: General | GameCard, sandboxAllowArming?: boolean) => void;
  attackTarget: (atkId: string, tgtId: string, ranged: boolean, consume?: General | GameCard) => void;
  supplyGeneral: (id: string, cards: (General | GameCard)[]) => void;
  armGeneral: (id: string, armorCards: GameCard[]) => boolean;
  activateTurnEndSkill: (skillId: string, generalId: string) => boolean;
  activateReactionSkill: (skillId: string, generalId: string) => boolean;
  skipReaction: () => boolean;
  chooseOption: (optionIndex: number) => boolean;
  endTurn: () => void;
  surrender: (id: number) => void;
}

/**
 * v2.8.22 响应链执法刀 (#71)：此刻状态里有没有待答的响应问句。
 * 先做便宜的槽位闸再算问句——司机每一拍都走这里，不能每次都把候选枚举一遍；
 * 而"队列非空"与"有问句"等价（结算后扫描会把问完的格一律收掉）。
 */
export function liveReactionAsk(state: { engineState: EngineState }): ReactionAsk | null {
  const engineState = state.engineState as EngineState;
  const queue = engineState?.pendingReaction;
  if (!queue || queue.nodes.length === 0) return null;
  return getReactionAsk(engineState);
}

/** Translate one canonical engine GameAction into a table step. Returns false when the table refused it. */
export function applyCanonicalAction(state: CanonicalActionHost, playerId: number, action: GameAction): boolean {
  const p = action.payload as Record<string, any> | undefined;
  switch (action.type) {
    case 'DRAW': {
      const d = (p ?? {}) as DrawPayload;
      const ok = state.executeDraw(Number(d.fromGeneralPool) || 0, Number(d.fromCardPool) || 0);
      if (!ok) state.confirmDraw();
      return true;
    }
    case 'CONFIRM_DRAW': state.confirmDraw(); return true;
    case 'RESOLVE_BASE_LOSS': state.resolvePendingDrawLoss(); return true;
    case 'DEPLOY_GENERAL': return state.deployGeneral(p?.general, Number(p?.slot) || 0, p?.consumeCards ?? []);
    case 'MOVE_GENERAL': state.moveGeneral(p?.generalId, p?.target, p?.consumeCard); return true;
    case 'ATTACK': state.attackTarget(p?.attackerId, p?.targetId, p?.ranged === true, p?.consumeCard); return true;
    case 'SUPPLY': state.supplyGeneral(p?.generalId, p?.consumeCards ?? []); return true;
    case 'EQUIP_ARMOR': return state.armGeneral(p?.generalId, p?.armorCards ?? []);
    // 2.3.1: AI seats activate turn-end skills exactly like humans decide in
    // the ask window — one canonical ACTIVATE_SKILL action, no direct state
    // edits. Consumption drops the candidate from the next legalActions, so
    // the stagnation guard cannot loop on it.
    case 'ACTIVATE_SKILL': {
      const ask = liveReactionAsk(state);
      // #71：响应问句挂着时，策略挑到的这一枚就是那一格的选项，走响应出口；
      // 没有问句才是回合结束询问那条路。两条路各自都只认一条 canonical 动作。
      if (ask) return state.activateReactionSkill(String(p?.skillId ?? ''), String(p?.generalId ?? ''));
      return state.activateTurnEndSkill(String(p?.skillId ?? ''), String(p?.generalId ?? ''));
    }
    // #71 的另一个出口：跳过＝SKIP_REACTION，出口恒常存在，永不失败到锁死队列。
    case 'SKIP_REACTION': return state.skipReaction();
    // 2.6.3: the frozen world leaves the debtor's policy exactly the recorded
    // options to pick from — the choice arrives as a canonical CHOOSE_OPTION.
    case 'CHOOSE_OPTION': return state.chooseOption(Number(p?.optionIndex) || 0);
    case 'END_TURN': state.endTurn(); return true;
    case 'SURRENDER': state.surrender(playerId); return true;
    default: return false;
  }
}
