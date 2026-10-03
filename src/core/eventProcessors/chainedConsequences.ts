import type { EngineState } from '../GameState';
import type { GameEvent } from '../Event';
import { getTurnStartDrawCount } from '../turnRules';
import { getRuntimeCardId } from '../../utils/runtimeIdentity';
import { deriveDuelFlow } from './duelEvents';
import { passiveEventsForDeploy } from '../../skills/passiveModifiers';
import { resolveDamageTaken } from '../damageTaken';
import {
  modifierIdsExpiredAtTurnBoundary,
  modifierIdsTouchingGeneral,
  modifierIdsTouchingPlayer,
} from '../statModifiers';

/**
 * Some domain outcomes (player defeat, game over, compensation draw) are
 * deterministic consequences of a primary event. Keep those consequences
 * inside the canonical event-processing layer so Resolver code only states
 * what happened.
 *
 * Return value (2.8 刀9): `null` = everything this event derived already sits
 * at the queue TAIL (the pre-existing behaviour of every branch here). A
 * non-null array is a block of events for the CONTINUOUS settlement of a
 * single primary event — the caller (EventProcessor.process) places it at the
 * queue HEAD so nothing can cut into it. Only continuous-settlement effects
 * may use this right; every other branch keeps pushing to the tail.
 */
export function enqueueDerivedConsequences(
  queue: GameEvent[],
  event: GameEvent,
  before: EngineState,
  next: EngineState,
): GameEvent[] | null {
  if (event.type === 'DUEL') {
    // 决斗本体不改状态（applyDuelEvent 恒等），全部后果＝这一场决斗派生的那块。
    // 块内只含本原语派生的通知与逐轮伤害，整块前置＝"决斗连续完成、中间不插入
    // 任何流程"（§H5-6）＋"决斗先、同技能后序效果接着走完"（§H9 第六轮②）。
    // v2.8.24 决斗刀 2：块的内容可以是三种——
    //  - 只有开局那一声（有人要表态，逐轮延到问完之后＝§H9 第七轮"这一层全部
    //    响完决斗才开始"）；
    //  - 开局那一声（标着当场没人说）＋逐轮＋收官那笔累计受伤（一次成形）；
    //  - 续跑令上来：逐轮＋收官那笔累计受伤（起点体力已含答复里回复的那几点）。
    return deriveDuelFlow(next, event);
  }

  if (event.type === 'DAMAGE') {
    const data = event.data as any;
    const targetPlayerId = typeof data?.targetPlayerId === 'number' ? data.targetPlayerId : null;
    const isBase = data?.isBase === true || (typeof data?.targetId === 'string' && data.targetId.startsWith('base_'));
    if (isBase && targetPlayerId !== null) {
      const beforePlayer = before.players.find(p => p.id === targetPlayerId);
      const afterPlayer = next.players.find(p => p.id === targetPlayerId);
      const baseHpLost = Math.max(0,
        (beforePlayer?.baseHp ?? 0) - (afterPlayer?.baseHp ?? 0));
      // 本营掉血也算"这一席位受到了伤害"（刀5 前它就是靠那一声 `DAMAGE` 开格的：
      // 响应链在指认不出将领时退到席位那一层，整席先答）。键法与将领那一声同一句：
      // 只看真实下降的数值，伤害≤0 或压根没掉血⇒这一声不存在。
      if (baseHpLost > 0) {
        queue.push({
          type: 'INJURY',
          data: {
            targetPlayerId,
            targetId: data?.targetId ?? `base_${targetPlayerId}`,
            sourcePlayerId: data?.sourcePlayerId ?? null,
            sourceGeneralId: data?.sourceGeneralId,
            damageType: data?.damageType ?? 'attack',
            value: baseHpLost,
            hpLost: baseHpLost,
            armorLost: 0,
            isBase: true,
            ...(data?.skillId !== undefined ? { skillId: data.skillId } : {}),
            ...(data?.skillName !== undefined ? { skillName: data.skillName } : {}),
            ...(data?.effectType !== undefined ? { effectType: data.effectType } : {}),
            ...(data?.triggerEventId !== undefined ? { triggerEventId: data.triggerEventId } : {}),
          },
        });
      }
      if (beforePlayer?.isAlive !== false && afterPlayer?.isAlive === false) {
        queue.push({
          type: 'PLAYER_DEFEATED',
          data: {
            playerId: targetPlayerId,
            sourcePlayerId: data?.sourcePlayerId,
            reason: 'BASE_HP_ZERO',
          },
        });
      }
    }

    // ── v2.8 刀5（#26）「受到伤害」这一身：判据＝**只有掉血才算受到了伤害**（用户
    // 2026-10-03 重新裁定，推翻 2026-09-28 那条"只掉护甲也算挨到"）。这里不"判断"它，
    // 只把这一刀实际掉掉的体力记成一声 `INJURY`：没掉血⇒这一声压根不存在⇒「受到伤害后」
    // 听不到，护甲掉多少都不算，伤害≤0 也不算。三路（普攻／技能伤害／决斗逐轮）都从
    // 同一处派生，读的是**结算前后血量差**这条已经落账的事实，绝不再算一遍伤害数学。
    // 决斗逐轮（带 `duelRound`）显式排除＝那一整块只在收官时按角色累计成一笔（§H9 第七轮）。
    if (!isBase && targetPlayerId !== null && data?.targetId !== undefined && typeof data?.duelRound !== 'number') {
      const hpOf = (state: EngineState) => {
        const list = (state.players.find(p => p.id === targetPlayerId)?.fieldGenerals as any[] | undefined) ?? [];
        const fg = list.find(f => getRuntimeCardId(f?.general as never) === String(data.targetId));
        return fg === undefined ? null : Number(fg.currentHp ?? 0);
      };
      const hpBefore = hpOf(before);
      const hpAfter = hpOf(next);
      // 人这一刀之后不在了＝掉的全部血量都算掉了（`hpAfter` 记 0）；压根不在场（诚实
      // 空转的那一路，血量前后都取不到）⇒这一声不发。
      if (hpBefore !== null) {
        const hpLost = Math.max(0, hpBefore - (hpAfter ?? 0));
        if (hpLost > 0) {
          queue.push({
            type: 'INJURY',
            data: {
              targetPlayerId,
              targetId: data.targetId,
              sourcePlayerId: data?.sourcePlayerId ?? null,
              sourceGeneralId: data?.sourceGeneralId,
              damageType: data?.damageType ?? 'attack',
              // 与决斗收官那一笔同形：`value`＝这次真实掉掉的体力，不是任何单轮的数。
              value: hpLost,
              hpLost,
              armorLost: Number(data?.armorLost ?? 0),
              // 报告与操作日志把这一声归到那一枚技能上靠这三个键（逐轮那一路同理）。
              ...(data?.skillId !== undefined ? { skillId: data.skillId } : {}),
              ...(data?.skillName !== undefined ? { skillName: data.skillName } : {}),
              ...(data?.effectType !== undefined ? { effectType: data.effectType } : {}),
              ...(data?.triggerEventId !== undefined ? { triggerEventId: data.triggerEventId } : {}),
            },
          });
        }
      }

      // 一次性「受到的伤害」账的消费清单：普攻与决斗逐轮在**发射点**就读过账本、也在那里
      // 发了销账令；技能伤害那一路是结算时才读（同一技能连发两笔伤害时第二笔要看见第一笔
      // 之后的血量），所以它的销账在这里补。判据与结算侧那一句完全同一句
      // （`newHp===undefined && damageType==='skill'`），用的也是同一个纯函数＋同一本账
      // （`before`＝结算前那一刻）⇒两边算出来的清单必然逐字相同，不存在第二种真相。
      if (data?.damageType === 'skill' && data?.newHp === undefined) {
        const spent = resolveDamageTaken(
          before.statModifiers,
          { playerId: targetPlayerId, generalId: String(data.targetId) },
          Number(data?.value ?? 0),
        ).consumedIds;
        if (spent.length > 0) {
          queue.push({ type: 'STAT_MODIFY', data: { op: 'REMOVE', ids: spent, cause: 'DAMAGE_TAKEN' } });
        }
      }
    }

    // applyDamageEvent, and unlike attacks it has no resolver-side DEATH —
    // AttackResolver emits its own. Derive DEATH from the actual state
    // change so skill kills also grant the compensating draw and can reach
    // the trigger engine (see GameEngine's bounded re-entry round).
    if (data?.damageType === 'skill' && targetPlayerId !== null && !isBase && data?.targetId !== undefined) {
      const beforeField = before.players.find(p => p.id === targetPlayerId)?.fieldGenerals as any[] ?? [];
      const afterField = next.players.find(p => p.id === targetPlayerId)?.fieldGenerals as any[] ?? [];
      const matches = (fg: any) => getRuntimeCardId(fg?.general as never) === String(data.targetId);
      if (beforeField.some(matches) && !afterField.some(matches)) {
        queue.push({
          type: 'DEATH',
          data: {
            targetPlayerId,
            targetId: data.targetId,
            attackerPlayerId: data?.sourcePlayerId ?? null,
            attackerId: data?.sourceGeneralId,
            skillKill: true,
          },
        });
      }
    }
  }

  if (event.type === 'GIVE') {
    // 2.5.3: a GIVE that MOVED cards derives the pure-notification pair the
    // onCardLost/onCardGained triggers listen to. Counts come from the actual
    // state change (same "derive from what settled" discipline as the skill-
    // kill DEATH above), so honest no-ops (empty giver, dead receiver, same-
    // player) derive nothing — no phantom triggers.
    const data = event.data as any;
    const fromId = typeof data?.fromPlayerId === 'number' ? data.fromPlayerId : null;
    const toId = typeof data?.toPlayerId === 'number' ? data.toPlayerId : null;
    const handOf = (state: EngineState, playerId: number) =>
      (state.players.find(player => player.id === playerId)?.hand as unknown[] | undefined)?.length ?? 0;
    if (fromId !== null) {
      const lost = handOf(before, fromId) - handOf(next, fromId);
      if (lost > 0) {
        queue.push({
          type: 'CARD_LOST',
          data: { playerId: fromId, count: lost, via: 'GIVE', remainingHand: handOf(next, fromId) },
        });
      }
    }
    if (toId !== null) {
      const gained = handOf(next, toId) - handOf(before, toId);
      if (gained > 0) queue.push({ type: 'CARD_GAINED', data: { playerId: toId, count: gained, via: 'GIVE' } });
    }
  }

  // v2.6.2 CARD_* emission-source expansion (PROJECT_ARCH_MAP §F event-source
  // table): the DISCARD path now derives like GIVE — hand losses carry
  // `remainingHand` (post-settlement, so "lost your LAST hand card"
  // predicates read a recorded fact, not a re-derivation). Paths NOT
  // derived (deliberate closure, see §F): DECK_PLACE/装备穿入 hand moves,
  // deploy/move/supply/attack consumption, player-death hand dump
  // (none has a content driver this cut — 连营's original semantic is
  // losing hand cards to OTHER players: 顺走/弃置), DRAW / armor-equip /
  // general-card-in-hand gains (资援-class onCardGained needs the
  // gained-side first).
  if (event.type === 'DISCARD') {
    const data = event.data as any;
    const playerId = typeof data?.playerId === 'number' ? data.playerId : null;
    if (playerId !== null) {
      const handOf = (state: EngineState) =>
        (state.players.find(player => player.id === playerId)?.hand as unknown[] | undefined)?.length ?? 0;
      const lost = handOf(before) - handOf(next);
      if (lost > 0) {
        queue.push({
          type: 'CARD_LOST',
          data: { playerId, count: lost, via: 'DISCARD', remainingHand: handOf(next) },
        });
      }
    }
  }

  if (event.type === 'EQUIP_STRIP') {
    // Equipment losses ride the same CARD_LOST notification with via='EQUIP'
    // (枭姬's driver). Count = armor cards actually detached at the matching
    // field general (honest no-ops — off-field general, empty armor — derive
    // nothing). remainingHand is intentionally absent: an equipment loss
    // says nothing about the owner's hand.
    const data = event.data as any;
    const playerId = typeof data?.targetPlayerId === 'number' ? data.targetPlayerId : null;
    const targetId = data?.targetId;
    if (playerId !== null && targetId !== undefined) {
      const armorCount = (state: EngineState) => {
        const field = state.players.find(player => player.id === playerId)?.fieldGenerals as any[] | undefined ?? [];
        const general = field.find(fg => getRuntimeCardId(fg?.general as never) === String(targetId));
        return Array.isArray(general?.armorCards) ? general.armorCards.length : 0;
      };
      const stripped = armorCount(before) - armorCount(next);
      if (stripped > 0) {
        queue.push({ type: 'CARD_LOST', data: { playerId, count: stripped, via: 'EQUIP' } });
      }
    }
  }

  if (event.type === 'GENERAL_DEPLOYED') {
    // v2.8 刀4（#25）「在场即生效」的**唯一落笔点**：登场＝这一员将的在场账开始。
    // 它不是一次发动（不进问窗、不耗"回合限 1 次"、不依赖「强制发动」），所以走
    // 派生、不走触发链——`passive` 故意缺席 `TRIGGER_EVENTS`，两边不可能都响。
    // 没有在场技⇒`passiveEventsForDeploy` 返回空⇒事件流一字不多。
    const data = event.data as { playerId?: number; general?: any } | undefined;
    const general = data?.general;
    const playerId = typeof data?.playerId === 'number' ? data.playerId : null;
    if (general && playerId !== null) {
      const runtimeId = getRuntimeCardId(general as never) || String(general.id ?? '');
      if (runtimeId) {
        queue.push(...passiveEventsForDeploy(general, runtimeId, playerId));
      }
    }
  }

  if (event.type === 'DEATH') {
    const data = event.data as any;
    const targetPlayerId = typeof data?.targetPlayerId === 'number' ? data.targetPlayerId : null;
    if (targetPlayerId !== null) {
      // A general being defeated grants its owner exactly one compensation
      // draw. The actual card selection remains an explicit DRAW Action.
      queue.push({
        type: 'DRAW_REQUIRED',
        data: {
          reason: 'compensation',
          playerId: targetPlayerId,
          totalCards: 1,
          baseLossPending: false,
          resumePhase: before.timelinePhase ?? (before.phase === 'playing' ? 'ACTION' : before.phase),
          resumePlayerId: before.currentPlayerId,
          cause: 'GENERAL_DEFEATED',
        },
      });
      // v2.8 刀4（#25）离场打断一切：这一员将名下的、与落在它身上的账**当场结束**，
      // 与那笔账怎么写周期（`untilDeath`／`untilLeaveField`／没写）无关（用户裁决第 2
      // 条）。空账＝派生零事件⇒今日对局逐字不变。
      const stale = modifierIdsTouchingGeneral(next.statModifiers, {
        playerId: targetPlayerId,
        generalId: String(data?.targetId ?? ''),
      });
      if (stale.length > 0) {
        queue.push({ type: 'STAT_MODIFY', data: { op: 'REMOVE', ids: stale, cause: 'DEATH' } });
      }
    }
  }

  // v2.8 刀4（#25）到期收账。派生一律先读账本、空账即返回——「今天没有任何一笔改数
  // 账」是这个预测能逐字不换锚的唯一理由，所以这条闸门留在派生点，不留给读数点。
  if (event.type === 'TURN_START' || event.type === 'TURN_END') {
    const data = event.data as any;
    const playerId = typeof data?.playerId === 'number' ? data.playerId : null;
    if (playerId !== null) {
      const stale = modifierIdsExpiredAtTurnBoundary(next.statModifiers, {
        edge: event.type === 'TURN_START' ? 'start' : 'end',
        playerId,
      });
      if (stale.length > 0) {
        queue.push({
          type: 'STAT_MODIFY',
          data: { op: 'REMOVE', ids: stale, cause: event.type === 'TURN_START' ? 'TURN_START' : 'TURN_END' },
        });
      }
    }
  }

  // v2.8 刀4（#25）上限截断致死：账本一变，处理器把"当前体力高于现上限"的几位截回来，
  // 截到 0 及以下＝不许存活⇒人已经在处理器里离场了，这里只补那一声死（契约表第 11 条：
  // 截断**不是伤害**，所以它不走 DAMAGE，也就没有击杀者⇒`不记击杀`、`不响遗言`两半
  // 各自落地：`attackerPlayerId:null` 让 onKill 永远键不上；`deathCause` 让 onDeath 拒响）。
  if (event.type === 'STAT_MODIFY') {
    for (const player of next.players) {
      const beforeField = (before.players.find(p => p.id === player.id)?.fieldGenerals as any[] | undefined) ?? [];
      const afterField = (player.fieldGenerals as any[] | undefined) ?? [];
      for (const fg of beforeField) {
        const generalId = String(getRuntimeCardId(fg?.general as never) ?? '');
        if (!generalId) continue;
        if (afterField.some(item => getRuntimeCardId(item?.general as never) === generalId)) continue;
        queue.push({
          type: 'DEATH',
          data: {
            targetPlayerId: player.id,
            targetId: generalId,
            attackerPlayerId: null,
            attackerId: undefined,
            deathCause: 'MAX_HP_ZERO',
          },
        });
      }
    }
  }

  if (event.type === 'BASE_DAMAGE') {
    const data = event.data as any;
    const playerId = typeof data?.playerId === 'number' ? data.playerId : null;
    const beforePlayer = playerId === null ? undefined : before.players.find(player => player.id === playerId);
    const afterPlayer = playerId === null ? undefined : next.players.find(player => player.id === playerId);
    if (beforePlayer?.isAlive !== false && afterPlayer?.isAlive === false && playerId !== null) {
      queue.push({
        type: 'PLAYER_DEFEATED',
        data: { playerId, reason: 'BASE_HP_ZERO', sourcePlayerId: null, resumeTurnStart: before.timelinePhase === 'DRAW' && before.currentPlayerId === playerId },
      });
    }
  }

  if (event.type === 'PLAYER_DEFEATED') {
    const data = event.data as any;
    const defeatedId = typeof data?.playerId === 'number' ? data.playerId : null;
    if (defeatedId !== null) {
      // v2.8 刀4（#25）席位阵亡＝这个人名下与落在这个人身上的账一律当场结束。
      const stale = modifierIdsTouchingPlayer(next.statModifiers, defeatedId);
      if (stale.length > 0) {
        queue.push({ type: 'STAT_MODIFY', data: { op: 'REMOVE', ids: stale, cause: 'PLAYER_DEFEATED' } });
      }
      const survivors = next.players.filter(player => player.id !== defeatedId && player.isAlive !== false);
      if (survivors.length <= 1) {
        queue.push({
          type: 'GAME_OVER',
          data: {
            winnerId: survivors.length === 1 ? survivors[0].id : null,
            defeatedPlayerId: defeatedId,
          },
        });
      } else if (before.currentPlayerId === defeatedId && (before.timelinePhase !== 'DRAW' || data?.resumeTurnStart === true)) {
        // A surrender/defeat by the active player immediately ends their turn.
        const defeatedIndex = before.players.findIndex(player => player.id === defeatedId);
        let nextIndex = defeatedIndex < 0 ? 0 : (defeatedIndex + 1) % before.players.length;
        let guard = 0;
        while (guard < before.players.length && next.players[nextIndex]?.isAlive === false) {
          nextIndex = (nextIndex + 1) % before.players.length;
          guard += 1;
        }
        const nextPlayer = next.players[nextIndex];
        if (nextPlayer && nextPlayer.isAlive !== false) {
          const nextRound = nextIndex <= Math.max(0, defeatedIndex) ? before.round + 1 : before.round;
          queue.push({ type: 'TURN_END', data: { playerId: defeatedId, fromIndex: defeatedIndex, toIndex: nextIndex, nextPlayerId: nextPlayer.id, nextRound } });
          queue.push({ type: 'TURN_START', data: { playerId: nextPlayer.id, nextRound } });
          queue.push({ type: 'TURN_ACTIONS_RESET', data: { playerId: nextPlayer.id } });
          queue.push({
            type: 'DRAW_REQUIRED',
            data: {
              reason: 'turnStart',
              playerId: nextPlayer.id,
              totalCards: getTurnStartDrawCount({ ...next, round: nextRound }, nextIndex),
              baseLossPending: (nextPlayer.generalPool?.length ?? 0) === 0,
            },
          });
        }
      }
    }
  }

  return null;
}
