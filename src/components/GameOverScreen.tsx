import { useEffect } from 'react';
import { useGameStore } from '../store/gameStore';
import { factionColors } from '../data/generals';
import { clearLocalGameSnapshot } from '../store/localGameSnapshot';

export default function GameOverScreen() {
  useEffect(() => {
    clearLocalGameSnapshot();
  }, []);
  const players = useGameStore((s) => s.players);
  const winnerId = useGameStore((s) => s.winnerId);
  const gameOverBanner = useGameStore((s) => s.gameOverBanner);
  const defeatEvent = useGameStore((s) => s.defeatEvent);
  const resetGame = useGameStore((s) => s.resetGame);

  const winner = players.find((player) => player.id === winnerId) ?? null;
  const defeatColor = defeatEvent?.faction ? factionColors[defeatEvent.faction] : '#ef4444';

  return (
    <div
      className="min-h-screen flex items-center justify-center text-white"
      style={{
        background:
          'linear-gradient(135deg, #1a0a0a 0%, #2d1b0e 30%, #1a1a2e 70%, #0d0d1a 100%)',
      }}
    >
        <div className="text-center animate-fadeIn px-6">
          <div className="text-8xl mb-6 animate-base-hit animate-pulse-glow">🏆</div>
          <h1 className="text-5xl font-black text-amber-200 mb-4">游戏结束</h1>
          {(gameOverBanner || defeatEvent) && (
            <div
              className="mb-5 inline-flex items-center gap-3 rounded-2xl border-2 px-7 py-3 animate-base-hit"
              style={{ borderColor: defeatColor, background: 'rgba(0,0,0,0.6)', boxShadow: `0 0 28px ${defeatColor}66` }}
            >
              <span className="text-3xl animate-pulse-glow">💥🏯</span>
              <span className="text-2xl font-black" style={{ color: defeatColor }}>
                {gameOverBanner ?? (defeatEvent?.faction ? `${defeatEvent.faction}势力击破` : '势力击破')}
              </span>
            </div>
          )}
          {winner ? (
            <>
              <p
                className="text-3xl font-bold mb-2"
                style={{ color: winner.faction ? factionColors[winner.faction] : '#fbbf24' }}
              >
                {winner.name}
              </p>
              <p className="text-xl text-amber-400">
                {winner.faction ? `${winner.faction} 势力获得胜利！` : '获得胜利！'}
              </p>
            </>
          ) : (
            <p className="text-xl text-amber-400">对局结束</p>
          )}
        <button
          onClick={resetGame}
          className="mt-10 rounded-xl bg-gradient-to-r from-amber-600 to-red-700 px-12 py-4 text-xl font-black text-white transition-all hover:scale-105 hover:from-amber-500 hover:to-red-600"
        >
          返回主菜单
        </button>
      </div>
    </div>
  );
}
