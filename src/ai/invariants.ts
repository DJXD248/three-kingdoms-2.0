/**
 * Invariant sentinel for AI-vs-AI battles.
 *
 * These are mechanical sanity properties that must hold after EVERY settled
 * dispatch — not gameplay rules (the engine is the rule authority). A hit
 * here means the engine produced a corrupted state: cards duplicated or
 * vanished, dead players still holding zones, impossible HP/armor, two
 * generals in one position, a finished game that never declared a winner.
 *
 * Ledger notes (verified against EventProcessor in 2.2.4):
 * - Card identity is `instanceId ?? id` (same as getRuntimeCardId).
 * - A general dying moves its definition to its owner's graveyard and its
 *   armor cards to the discard pile — same ids, total conserved.
 * - PLAYER_DEFEATED legitimately clears the loser's hand + fieldGenerals
 *   (cards leave the ledger) → the ledger re-baselines on any step where a
 *   player died; a shrink on any other step is a violation.
 * - Legacy armor-destruction fallback synthesises `legacy_armor_destroyed_*`
 *   discard entries that never existed elsewhere → excluded from the ledger.
 */
import type { EngineState } from '../core/GameState';

export interface Violation {
  code: string;
  step: number;
  detail: string;
}

type AnyObj = Record<string, any>;

function runtimeId(card: unknown): string {
  const c = card as AnyObj | null | undefined;
  return String(c?.instanceId ?? c?.id ?? '');
}

const SYNTHETIC_PREFIX = 'legacy_armor_destroyed';

function pushIds(target: string[], cards: unknown): void {
  if (!Array.isArray(cards)) return;
  for (const card of cards) {
    const id = runtimeId(card);
    if (id && !id.startsWith(SYNTHETIC_PREFIX)) target.push(id);
    const node = card as AnyObj;
    // fieldGenerals entries are wrappers: { general, armorCards, ... }.
    if (node?.general) pushIds(target, [node.general]);
    if (Array.isArray(node?.armorCards)) pushIds(target, node.armorCards);
  }
}

/** Every tracked card id currently inside the ledger zones. */
export function collectLedgerIds(state: EngineState): string[] {
  const ids: string[] = [];
  pushIds(ids, state.deck);
  pushIds(ids, state.discardPile);
  for (const player of state.players ?? []) {
    const p = player as AnyObj;
    pushIds(ids, p.hand);
    pushIds(ids, p.generalPool);
    pushIds(ids, p.graveyard);
    pushIds(ids, p.fieldGenerals);
  }
  return ids;
}

export interface LedgerSentinel {
  check(state: EngineState, step: number, diedThisStep: boolean): Violation[];
}

/** Stateful card-conservation watcher across steps. */
export function createLedgerSentinel(): LedgerSentinel {
  let prevTotal: number | null = null;
  return {
    check(state, step, diedThisStep) {
      const ids = collectLedgerIds(state);
      const out: Violation[] = [];

      const counts = new Map<string, number>();
      for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
      for (const [id, count] of counts) {
        if (count > 1) {
          out.push({ code: 'CARD_DUPLICATED', step, detail: `card ${id} occupies ${count} ledger zones at once` });
        }
      }

      if (prevTotal !== null) {
        if (ids.length > prevTotal) {
          out.push({ code: 'CARD_MULTIPLIED', step, detail: `ledger grew ${prevTotal} -> ${ids.length} (cards cannot be created)` });
        } else if (ids.length < prevTotal && !diedThisStep) {
          out.push({ code: 'CARD_VANISHED', step, detail: `ledger shrank ${prevTotal} -> ${ids.length} without a player being defeated` });
        }
      }
      prevTotal = ids.length; // re-baseline after death (legitimate sweep) too
      return out;
    },
  };
}

const VALID_ZONES = new Set(['camp', 'front', 'battle']);

/** One-shot structural sanity scan of a settled state. */
export function checkStateInvariants(state: EngineState, step: number): Violation[] {
  const out: Violation[] = [];
  const players = (state.players ?? []) as AnyObj[];
  const playerCount = players.length;
  const push = (code: string, detail: string) => out.push({ code, step, detail });

  for (const player of players) {
    const alive = player.isAlive !== false;
    const hand = Array.isArray(player.hand) ? player.hand : [];
    const field = Array.isArray(player.fieldGenerals) ? player.fieldGenerals : [];

    if (!alive && (hand.length > 0 || field.length > 0)) {
      push('DEAD_PLAYER_RETAINS_ZONES', `player ${player.id} is defeated but still holds ${hand.length} hand / ${field.length} field cards`);
    }

    const baseHp = Number(player.baseHp ?? 0);
    if (alive && Number.isFinite(baseHp) && baseHp < 0) {
      push('BASE_HP_NEGATIVE', `alive player ${player.id} has baseHp ${baseHp}`);
    }

    for (const fg of field as AnyObj[]) {
      const gid = runtimeId(fg?.general) || '?';
      const cur = Number(fg?.currentHp);
      const max = Number(fg?.maxHp);
      if (!Number.isFinite(cur) || !Number.isFinite(max) || cur < 1 || cur > max) {
        push('FIELD_HP_OUT_OF_RANGE', `general ${gid} of player ${player.id}: currentHp=${fg?.currentHp} maxHp=${fg?.maxHp}`);
      }
      for (const armorField of ['currentArmor', 'armor'] as const) {
        const armor = fg?.[armorField];
        if (armor !== undefined && Number(armor) < 0) {
          push('ARMOR_NEGATIVE', `general ${gid}: ${armorField}=${armor}`);
        }
      }
      const pos = fg?.position as AnyObj | undefined;
      if (!pos || !VALID_ZONES.has(String(pos.zone))) {
        push('POSITION_MISSING', `general ${gid} of player ${player.id} has invalid position ${JSON.stringify(pos ?? null)}`);
        continue;
      }
      const slot = Number(pos.slot);
      const limit = pos.zone === 'battle' ? playerCount : 3;
      if (!Number.isInteger(slot) || slot < 0 || slot >= limit) {
        push('SLOT_OUT_OF_RANGE', `general ${gid}: zone=${pos.zone} slot=${pos.slot} (limit ${limit})`);
      }
    }
  }

  // Position uniqueness across ALL generals of ALL players.
  const seen = new Map<string, string>();
  for (const player of players) {
    for (const fg of (Array.isArray(player.fieldGenerals) ? player.fieldGenerals : []) as AnyObj[]) {
      const pos = fg?.position as AnyObj | undefined;
      if (!pos) continue;
      const key = `${pos.zone}|${pos.areaOwnerId ?? 'null'}|${pos.slot}`;
      const gid = runtimeId(fg?.general) || '?';
      if (seen.has(key)) push('POSITION_CONFLICT', `generals ${seen.get(key)} and ${gid} both occupy ${key}`);
      else seen.set(key, gid);
    }
  }

  // Turn/draw bookkeeping.
  if (state.phase === 'drawing') {
    const draw = state.drawState as AnyObj | null | undefined;
    if (!draw) {
      push('DRAW_WINDOW_MISSING', 'phase=drawing but drawState is absent');
    } else {
      const dp = players.find(p => p.id === draw.playerId);
      if (!dp || dp.isAlive === false) push('DRAW_FOR_DEAD_PLAYER', `draw window belongs to missing/dead player ${draw.playerId}`);
    }
  } else if (state.phase === 'playing' && state.timelinePhase === 'ACTION' && state.currentPlayerId != null) {
    const cur = players.find(p => p.id === state.currentPlayerId);
    if (!cur || cur.isAlive === false) push('ACTION_FOR_DEAD_PLAYER', `action window belongs to missing/dead player ${state.currentPlayerId}`);
  }

  // Game-over consistency.
  const aliveCount = players.filter(p => p.isAlive !== false).length;
  if (state.phase === 'gameOver') {
    if (aliveCount > 1) push('GAMEOVER_WITH_SURVIVORS', `gameOver but ${aliveCount} players are still alive`);
    if (aliveCount === 1) {
      const survivor = players.find(p => p.isAlive !== false);
      const winner = (state.metadata as AnyObj | undefined)?.winnerId;
      if (winner != null && winner !== survivor?.id) {
        push('GAMEOVER_WINNER_MISMATCH', `winnerId=${winner} but the only survivor is ${survivor?.id}`);
      }
    }
  } else if (playerCount > 1 && aliveCount <= 1) {
    push('MISSING_GAME_OVER', `${aliveCount} survivor(s) remain but phase is still ${state.phase}`);
  }

  return out;
}
