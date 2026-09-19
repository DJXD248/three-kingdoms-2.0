import { useGameStore } from '../store/gameStore';
import { factionColors } from '../data/generals';

export default function Lobby() {
  const players = useGameStore(s => s.players);
  const roomName = useGameStore(s => s.roomName);
  const startGame = useGameStore(s => s.startGame);
  const setPhase = useGameStore(s => s.setPhase);

  return (
    <div className="min-h-screen text-white flex flex-col items-center justify-center" style={{
      background: 'linear-gradient(135deg, #1a0a0a 0%, #2d1b0e 30%, #1a1a2e 70%, #0d0d1a 100%)',
    }}>
      <div className="absolute top-4 left-6">
        <button
          onClick={() => setPhase('createRoom')}
          className="text-amber-400 hover:text-amber-200 transition-colors"
        >
          ← 返回
        </button>
      </div>

      <h1 className="text-2xl font-bold text-amber-200 mb-2 tracking-wider">🏯 {roomName}</h1>
      <p className="text-amber-500/60 mb-8">等待开始</p>

      {/* Players */}
      <div className="flex gap-6 mb-10">
        {players.map(player => (
          <div key={player.id} className="flex flex-col items-center">
            <div className="w-24 h-24 rounded-xl border-2 border-amber-600/50 bg-black/40 flex items-center justify-center mb-3 overflow-hidden">
              {player.avatarGeneral ? (
                <div className="text-center">
                  <div className="text-3xl">{player.avatarGeneral.type === '武将' ? '⚔️' : '📜'}</div>
                  <p className="text-xs text-amber-300 mt-1">{player.avatarGeneral.name}</p>
                </div>
              ) : (
                <span className="text-4xl">👤</span>
              )}
            </div>
            <p className="text-amber-200 font-bold">{player.name}</p>
            {player.faction && (
              <span className="text-xs mt-1 px-2 py-0.5 rounded"
                style={{ backgroundColor: factionColors[player.faction] + '40', color: factionColors[player.faction] }}>
                {player.faction}
              </span>
            )}
          </div>
        ))}
      </div>

      <button
        onClick={startGame}
        className="px-10 py-4 rounded-xl font-black text-xl bg-gradient-to-r from-amber-600 to-red-700 text-white hover:from-amber-500 hover:to-red-600 shadow-lg shadow-amber-900/40 hover:scale-105 active:scale-95 transition-all tracking-wider"
      >
        ⚔️ 开始游戏
      </button>
    </div>
  );
}
