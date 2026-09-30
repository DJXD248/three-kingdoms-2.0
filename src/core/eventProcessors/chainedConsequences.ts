import type { EngineState } from '../GameState';
import type { GameEvent } from '../Event';
import { getTurnStartDrawCount } from '../turnRules';
import { getRuntimeCardId } from '../../utils/runtimeIdentity';
import { deriveDuelRounds } from './duelEvents';

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
    // 决斗本体不改状态（applyDuelEvent 恒等），全部后果＝逐轮预解的伤害块。
    // 块内只含本原语派生的 DAMAGE，整块前置＝"决斗连续完成、中间不插入任何
    // 流程"（§H5-6）＋"决斗先、同技能后序效果接着走完"（§H9 第六轮②）。
    return deriveDuelRounds(next, event);
  }

  if (event.type === 'DAMAGE') {
    const data = event.data as any;
    const targetPlayerId = typeof data?.targetPlayerId === 'number' ? data.targetPlayerId : null;
    const isBase = data?.isBase === true || (typeof data?.targetId === 'string' && data.targetId.startsWith('base_'));
    if (isBase && targetPlayerId !== null) {
      const beforePlayer = before.players.find(p => p.id === targetPlayerId);
      const afterPlayer = next.players.find(p => p.id === targetPlayerId);
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

    // Skill DAMAGE settles (and can remove the target) inside
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
