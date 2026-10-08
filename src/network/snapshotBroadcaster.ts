/**
 * 房主端的"发快照"节流器（J2）。
 *
 * 局面一变就发一次是错的：一次出手能连着落好几笔事实（抽牌、结算、响应问答…），
 * 而传话线是逐条发的，客人只需要**最后那个样子**。所以这里是"变脏了就补发一次"：
 * 距上一次发出去已满一个间隔 ⇒ 立刻发；没满 ⇒ 记成待补，到点发当下那一份
 * （不是当时那一份——待补的多笔会并成一笔）。
 */
import type { EngineState } from '../core/GameState';
import { buildBroadcastView } from './snapshotView';

/** 两次快照之间的最小间隔：客人看的是"现在是什么样"，250 毫秒已经跟不上手速。 */
export const MIN_BROADCAST_INTERVAL_MS = 250;

export type BroadcasterDeps = {
  /** 房主当下的原始局面（界面自己的 state 也算变化，靠引用比对挡掉）。 */
  readState: () => EngineState;
  /** 把已遮蔽的视图交给传话线；返回 false＝线没开着。 */
  send: (view: EngineState) => boolean;
  /** 房间里没客人就别费劲算遮蔽视图。 */
  hasGuests: () => boolean;
  now?: () => number;
  schedule?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  cancel?: (handle: ReturnType<typeof setTimeout>) => void;
  minIntervalMs?: number;
};

export type SnapshotBroadcaster = {
  /** 每次 store 变化调一次；局面引用没变＝只是界面在动，不发。 */
  notifyChange: () => void;
  /** 立刻发当下这一份（新客人刚进房时补一次，免得他等到下一次变化才看见牌桌）。 */
  flush: () => void;
  stop: () => void;
  stats: () => { sent: number; coalesced: number };
};

export function startSnapshotBroadcaster(deps: BroadcasterDeps): SnapshotBroadcaster {
  const minIntervalMs = deps.minIntervalMs ?? MIN_BROADCAST_INTERVAL_MS;
  const now = deps.now ?? (() => Date.now());
  const schedule = deps.schedule ?? ((fn, ms) => setTimeout(fn, ms));
  const cancel = deps.cancel ?? ((handle) => clearTimeout(handle));

  let lastStateRef: EngineState | null = null;
  let lastSentAt = Number.NEGATIVE_INFINITY;
  let pending = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let sent = 0;
  let coalesced = 0;

  const emit = () => {
    pending = false;
    const state = deps.readState();
    lastStateRef = state;
    if (!deps.hasGuests()) return;
    if (deps.send(buildBroadcastView(state))) sent += 1;
  };

  const clearTimer = () => {
    if (timer !== null) {
      cancel(timer);
      timer = null;
    }
  };

  return {
    notifyChange() {
      const state = deps.readState();
      if (state === lastStateRef) return;
      if (pending) coalesced += 1;
      clearTimer();
      const elapsed = now() - lastSentAt;
      if (elapsed >= minIntervalMs) {
        lastSentAt = now();
        emit();
        return;
      }
      pending = true;
      timer = schedule(() => {
        timer = null;
        lastSentAt = now();
        emit();
      }, minIntervalMs - elapsed);
    },
    flush() {
      clearTimer();
      lastSentAt = now();
      emit();
    },
    stop() {
      clearTimer();
      pending = false;
    },
    stats: () => ({ sent, coalesced }),
  };
}
