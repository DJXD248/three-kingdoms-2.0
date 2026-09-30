import type { EngineState } from '../GameState';
import type { GameEvent } from '../Event';
import { getAttackValue } from '../attackValue';
import { applyArmorDamage } from '../armorDamage';
import { getRuntimeCardId } from '../../utils/runtimeIdentity';

/** 双方各三轮＝最多六次计算（§H9 第六轮①），交替进行、先手恒为技能发起方。 */
const DUEL_MAX_ROUNDS = 6;

interface DuelParticipantRef {
  playerId: number;
  generalId: string;
  general: Record<string, any>;
}

function findDuelParticipant(state: EngineState, generalId: unknown): DuelParticipantRef | null {
  if (typeof generalId !== 'string' || generalId === '') return null;
  for (const player of state.players) {
    const fieldGenerals = Array.isArray(player.fieldGenerals)
      ? (player.fieldGenerals as Array<Record<string, any>>)
      : [];
    const found = fieldGenerals.find(fg => getRuntimeCardId(fg?.general as never) === generalId);
    if (found) {
      return { playerId: Number(player.id), generalId, general: found };
    }
  }
  return null;
}

/**
 * DUEL settles nothing by itself (§H7 "决斗不附带任何效果"): the event only
 * records that the skill fired, and the state comes back untouched. All of the
 * flow's observable consequences are derived here as one pre-solved block of
 * skill DAMAGE events (ARCH_MAP §F "DUEL 决斗流程原语").
 *
 * Each round is computed against the duel-local running hp/armor so the block
 * is a faithful plan of what the queue will then apply round by round;
 * `applyDamageEvent` receives newHp/newArmor and never recomputes (GPT design
 * gate: precompute and settlement stay layered, one truth per layer). The
 * arithmetic is the SAME two core functions a melee attack uses
 * (`getAttackValue` + `applyArmorDamage`) — a duel must never grow its own
 * damage math.
 */
export function deriveDuelRounds(state: EngineState, event: GameEvent): GameEvent[] {
  const data = (event.data ?? {}) as Record<string, unknown>;
  const sideA = findDuelParticipant(state, data.sourceGeneralId);
  const sideB = findDuelParticipant(state, data.targetId);
  // 诚实空转：任一侧不在场、或双方本是同一枚将领（"自己不能和自己决斗"＝§H9 第五轮③）。
  if (!sideA || !sideB || sideA.generalId === sideB.generalId) return [];

  const sides = [
    { ref: sideA, hp: Number(sideA.general.currentHp ?? 0), armor: Number(sideA.general.currentArmor ?? 0) },
    { ref: sideB, hp: Number(sideB.general.currentHp ?? 0), armor: Number(sideB.general.currentArmor ?? 0) },
  ];

  const rounds: GameEvent[] = [];
  const duelKey = duelKeyOf(data);
  for (let index = 0; index < DUEL_MAX_ROUNDS; index += 1) {
    const attacker = sides[index % 2];
    const defender = sides[(index + 1) % 2];
    const rawDamage = getAttackValue(attacker.ref.general, false);
    const hit = applyArmorDamage(defender.hp, defender.armor, rawDamage);
    defender.hp = hit.hp;
    defender.armor = hit.armor;
    rounds.push({
      type: 'DAMAGE',
      data: {
        ...asRecord(data),
        sourcePlayerId: attacker.ref.playerId,
        sourceGeneralId: attacker.ref.generalId,
        targetPlayerId: defender.ref.playerId,
        targetId: defender.ref.generalId,
        damageType: 'skill',
        // 0 及以下伤害照样占一轮并继续轮换（§H5-6）——刻意不随桥接层 DAMAGE 的
        // Math.max(1, …) 钳制，否则"打了但没掉血"会被写成掉了血。
        value: Math.max(0, rawDamage),
        newHp: hit.hp,
        newArmor: hit.armor,
        duelRound: index + 1,
        duelKey,
      },
    });
    // 一旦有一方在计算受到的伤害后体力≤0，立刻终止（死者不再被轮换）。
    if (hit.hp <= 0) break;
  }

  return rounds;
}

/** 决斗载荷里逐轮要重写的四个键——其余（skillId/skillName/effectType/triggerEventId）
 * 原样带过去，报告与操作日志据此把每一"打"归到那枚技能上。 */
const DUEL_PARTICIPANT_KEYS = ['sourcePlayerId', 'sourceGeneralId', 'targetPlayerId', 'targetId'] as const;

function asRecord(value: Record<string, unknown>): Record<string, unknown> {
  const rest = { ...value };
  for (const key of DUEL_PARTICIPANT_KEYS) delete rest[key];
  return rest;
}

/** 同一场决斗的配对键：DUEL 事件与它派生出的逐轮伤害都带着它，回显时据此把
 * 每一块插回自己那条 DUEL 之后（载荷里没有唯一 id——事件在纯路径上尚未盖戳）。 */
export function duelKeyOf(data: Record<string, unknown> | undefined): string {
  const value = data ?? {};
  return [
    String(value.skillId ?? ''),
    String(value.triggerEventId ?? ''),
    `${String(value.sourceGeneralId ?? '')}>${String(value.targetId ?? '')}`,
  ].join('|');
}

/** 把队列内派生的决斗逐轮伤害回显进事件流（TransitionCore 唯一调用点）。 */
export function echoDuelRounds(events: GameEvent[], derived: readonly GameEvent[]): void {
  const blocks = new Map<string, GameEvent[]>();
  for (const event of derived) {
    const data = event.data as { duelRound?: unknown; duelKey?: unknown } | undefined;
    if (typeof data?.duelRound !== 'number') continue;
    const key = String(data.duelKey ?? '');
    const block = blocks.get(key);
    if (block) block.push(event);
    else blocks.set(key, [event]);
  }
  if (blocks.size === 0) return;

  const echoed: GameEvent[] = [];
  const placed = new Set<string>();
  for (const event of events) {
    echoed.push(event);
    if (event.type !== 'DUEL') continue;
    const key = duelKeyOf(event.data as Record<string, unknown> | undefined);
    const block = blocks.get(key);
    if (!block || placed.has(key)) continue;
    placed.add(key);
    echoed.push(...block);
  }
  // 找不到宿主（不该发生）也不能让轮次消失：追加在末尾。
  for (const [key, block] of blocks) {
    if (!placed.has(key)) echoed.push(...block);
  }
  events.length = 0;
  events.push(...echoed);
}

/** 决斗本体零状态位移：唯一结算入口仍是 EventProcessor，本函数恒等返回。 */
export function applyDuelEvent(state: EngineState, event: GameEvent): EngineState {
  // "决斗不附带任何效果"（§H7）——事件记下"这枚技能确实响了"，全部后果来自
  // deriveDuelRounds 派生的逐轮伤害块。这里读一次载荷只为让畸形 DUEL 也
  // 落成它本就该有的无害空转（与 applyRevealEvent 同一形状）。
  const data = event.data as { sourceGeneralId?: unknown; targetId?: unknown } | undefined;
  if (typeof data?.sourceGeneralId !== 'string' || typeof data?.targetId !== 'string') return state;
  return state;
}
