import type { EngineState } from '../GameState';
import type { GameEvent } from '../Event';
import { getTurnStartDrawCount } from '../turnRules';
import { getRuntimeCardId } from '../../utils/runtimeIdentity';

/**
 * Some domain outcomes (player defeat, game over, compensation draw) are
 * deterministic consequences of a primary event. Keep those consequences
 * inside the canonical event-processing layer so Resolver code only states
 * what happened.
 */
export function enqueueDerivedConsequences(
  queue: GameEvent[],
  event: GameEvent,
  before: EngineState,
  next: EngineState,
): void {
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
}
