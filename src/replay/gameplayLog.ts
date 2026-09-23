/**
 * Operation log for a finished live match (2.2.6).
 *
 * Turns the canonical ReplayDocument captured by liveReplayRecorder into a
 * human-readable per-step log. Rejected steps get the same ❌ annotation rule
 * as the AI battle logs (see ai/battleReport.ts): a ❌-prefixed line naming
 * the engine rejection code + message.
 */
import { formatActionLine } from '../ai/battleReport';
import type { ReplayDocument } from './types';

function shortReason(event: { data?: unknown } | undefined): string {
  const data = event?.data as { code?: string; message?: string; reason?: string } | undefined;
  if (!data) return '未知原因';
  const code = data.code ? `[${data.code}] ` : '';
  const msg = data.message ?? data.reason ?? '';
  return `${code}${msg || '引擎拒绝'}`;
}

export function buildGameplayLog(document: ReplayDocument): string {
  const out: string[] = [];
  const finalState = (document.entries.at(-1)?.afterState ?? document.initialState) as Record<string, any>;
  const players: Record<string, any>[] = Array.isArray(finalState.players) ? finalState.players : [];
  const created = new Date(document.createdAt);

  out.push('═══ 对局操作日志 ═══');
  out.push(`房间：${document.roomId} · 时间：${created.toLocaleString()} · 步数：${document.entries.length}`);
  if (players.length > 0) {
    const roster = players
      .map(p => `${p.id ?? '?'}:${p.name ?? '?'}${p.faction ? `(${p.faction})` : ''}${p.isAlive === false ? ' 阵亡' : ''}`)
      .join(' · ');
    out.push(`玩家：${roster}`);
  }
  const winnerId = finalState.metadata?.winnerId ?? null;
  if (winnerId != null) {
    const winner = players.find(p => p.id === winnerId);
    out.push(`结果：${winner ? `${winner.name}${winner.faction ? `（${winner.faction}势力）` : ''} 获胜` : `玩家${winnerId} 获胜`}`);
  }
  out.push('');

  document.entries.forEach(entry => {
    const rejected = entry.events.find(ev => ev.type === 'ACTION_REJECTED');
    const line = formatActionLine(entry.sequence, entry.action);
    if (rejected) {
      out.push(`❌${line} [被引擎拒绝] ${shortReason(rejected)}`);
    } else {
      out.push(line);
    }
  });
  out.push('');
  out.push('✔ 若上方无 ❌ 行，则本局没有任何被引擎拒绝的操作。');
  return out.join('\n');
}
