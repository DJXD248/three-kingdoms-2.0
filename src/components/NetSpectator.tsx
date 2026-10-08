import type { EngineState } from '../core/GameState';
import { factionColors } from '../data/generals';
import { hiddenCount } from '../network/snapshotView';

/**
 * J2 客人端牌桌：房主发来的**已遮蔽**快照，只读渲染。
 *
 * 这里刻意不复用 GameBoard：那张牌桌是为热座设计的（它画的是"当前那一席的手牌"），
 * 客人拿到的快照里手牌只有数量、没有内容。观战面只读房间里公开的事实——
 * 谁在场面上、谁剩多少体力、轮到谁、营地还剩多少、将池还剩几员。
 * 全程没有任何按钮：客人动手＝J4。
 */
export default function NetSpectator({ snapshot }: { snapshot: EngineState | null }) {
  return (
    <div className="rounded-lg border border-sky-800/35 bg-black/30 px-3 py-2.5">
      <p className="text-xs font-bold text-sky-300/85 mb-0.5">👀 观战 · 这一局由房主算牌，你这边只看不动</p>

      {!snapshot || snapshot.players.length === 0 ? (
        <p className="text-xs text-amber-200/45">
          还没收到房主发来的局面——房主那边开了局、动了牌，这里就会跟着变。
        </p>
      ) : (
        <>
          <p className="text-[11px] text-amber-200/55 mb-1.5">
            第 {snapshot.round} 轮 · 轮到
            <span className="ml-1 font-bold text-amber-100">
              {snapshot.players.find((p) => p.id === snapshot.currentPlayerId)?.name ?? '—'}
            </span>
            {typeof snapshot.metadata?.winnerId === 'number' && (
              <span className="ml-2 font-bold text-emerald-300">
                本局结束：{snapshot.players.find((p) => p.id === snapshot.metadata?.winnerId)?.name ?? '—'}
              </span>
            )}
          </p>
          <ul className="flex flex-col gap-1.5">
            {snapshot.players.map((p) => {
              const color = factionColors[(p.faction ?? '蜀') as keyof typeof factionColors] ?? '#eab308';
              const active = p.id === snapshot.currentPlayerId;
              const field = Array.isArray(p.fieldGenerals) ? p.fieldGenerals : [];
              return (
                <li
                  key={String(p.id)}
                  className={`rounded border px-2 py-1.5 ${active ? 'border-amber-500/60 bg-amber-900/20' : 'border-amber-700/20 bg-black/20'} ${p.isAlive === false ? 'opacity-40' : ''}`}
                >
                  <div className="flex items-center gap-2 flex-wrap text-xs">
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
                    <span className="font-bold" style={{ color }}>{String(p.name ?? '')}</span>
                    <span className="text-amber-200/50">{String(p.faction ?? '')}</span>
                    {active && <span className="text-[10px] text-amber-300/80">行动中</span>}
                    {p.isAlive === false && <span className="text-[10px] text-red-300/70">已阵亡</span>}
                    <span className="ml-auto text-[11px] text-amber-200/55">
                      🏯{Number(p.baseHp ?? 0)} · 🃏{hiddenCount(p.hand)} 张 · 👤{hiddenCount(p.generalPool)} 员
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {field.length === 0 ? (
                      <span className="text-[10px] text-amber-200/30">场上没有将领</span>
                    ) : (
                      field.map((fg, i) => {
                        const g = (fg as { general?: { name?: string } }).general;
                        const hp = (fg as { currentHp?: number }).currentHp ?? 0;
                        const armor = (fg as { currentArmor?: number }).currentArmor ?? 0;
                        return (
                          <span key={i} className="rounded border border-amber-700/25 bg-black/25 px-1.5 py-0.5 text-[10px] text-amber-100">
                            {String(g?.name ?? '?')} <span className="text-red-300/80">{hp}</span>
                            <span className="text-sky-300/70">/甲{armor}</span>
                          </span>
                        );
                      })
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="mt-1.5 text-[10px] text-amber-200/35">
            牌堆里还剩 {hiddenCount(snapshot.deck)} 张 · 弃牌堆 {hiddenCount(snapshot.discardPile)} 张 ·
            手牌与牌堆顺序不发（那是各家自己的东西），所以你看到的是数量而不是牌面。
          </p>
        </>
      )}
    </div>
  );
}
