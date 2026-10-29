/**
 * 房主端的"发快照"节流器（J2）。
 *
 * 局面一变就发一次是错的：一次出手能连着落好几笔事实（抽牌、结算、响应问答…），
 * 而传话线是逐条发的，客人只需要**最后那个样子**。所以这里是"变脏了就补发一次"：
 * 距上一次发出去已满一个间隔 ⇒ 立刻发；没满 ⇒ 记成待补，到点发当下那一份
 * （不是当时那一份——待补的多笔会并成一笔）。
 *
 * 切片③（v2.9.25）把"发一份给全桌"改成"屋里每人一份"：`recipients()` 说清有哪些收件人、
 * 每人坐哪一席，`buildBroadcastView` 按席位放开那一席自己的手牌与征召池。
 * **同一席位只算一份**（两个收件人对上同一号席位时共用视图，也挡住重复身份号），
 * 席位还没绑上的收件人拿 `seat:null`＝全遮那份（观战面），也就是切片③之前大家看到的
 * 那一份——所以这一刀不会把任何人的画面改小。
 */
import type { EngineState } from '../core/GameState';
import { buildBroadcastView } from './snapshotView';

/** 两次快照之间的最小间隔：客人看的是"现在是什么样"，250 毫秒已经跟不上手速。 */
export const MIN_BROADCAST_INTERVAL_MS = 250;

/** 一个收件人：线上那个身份号 ＋ 他坐的席位（还没绑上＝null，拿全遮那份）。 */
export type SnapshotRecipient = { peer: string; seat: number | null };

export type BroadcasterDeps = {
  /** 房主当下的原始局面（界面自己的 state 也算变化，靠引用比对挡掉）。 */
  readState: () => EngineState;
  /** 把算给某一席的那一份交给传话线，指名给 `to`；返回 false＝线没开着。 */
  send: (view: EngineState, to: string) => boolean;
  /** 房间里现在有哪些收件人、各坐哪一席。空数组＝没人可发，连遮蔽视图都不用算。 */
  recipients: () => SnapshotRecipient[];
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
  /** `sent`＝线上真发出去几条（切片③后一次补发可以是好几条，一人一条）。 */
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
    const targets = deps.recipients();
    if (targets.length === 0) return;
    // 按席位去重：坐同一席的收件人共用一份视图，一份局面至多算 players.length 遍。
    const views = new Map<number | null, EngineState>();
    for (const target of targets) {
      let view = views.get(target.seat);
      if (!view) {
        view = buildBroadcastView(state, target.seat);
        views.set(target.seat, view);
      }
      if (deps.send(view, target.peer)) sent += 1;
    }
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
