import type { ActionResolver } from './ResolverTypes';
import type { GameAction } from '../ActionTypes';
import type { EngineState } from '../../core/GameState';
import type { GameEvent } from '../../core/Event';
import { resolveAttackBlow } from '../../core/attackBlow';

/**
 * ATTACK 的正身入口。一次攻击的全部事实（瞄准、受击那一拍、伤害那一拍）住在
 * `core/attackBlow.ts`——这里只把 canonical 动作翻译成那一份实现的事件块，
 * 不再自持一套伤害数学。为什么要搬：受击那一型按定义在**伤害计算之前**发动
 * （用户 2026-10-04 定稿＝§12-102），所以"这一刀的数字"必须留到那一层走完之后
 * 再算，而那需要 `core/TransitionCore` 的续跑也能拿到同一个函数＝它必须住在 core 层。
 */
export class AttackResolver implements ActionResolver {
  canResolve(action: GameAction): boolean {
    return action.type === 'ATTACK';
  }

  resolve(state: EngineState, action: GameAction): GameEvent[] {
    return resolveAttackBlow(state, action);
  }
}
