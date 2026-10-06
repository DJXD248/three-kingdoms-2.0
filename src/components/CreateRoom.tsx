import { useGameStore } from '../store/gameStore';
import { AI_TIER_KEYS, AI_TIER_LABELS, type AiSeatTier } from '../setup/runtimeSetup';

const TIER_HINTS: Record<AiSeatTier, string> = {
  random: '闭眼乱抓牌，入门陪练',
  conservative: '重守营地，爱惜将领',
  balanced: '攻守各半，稳扎稳打',
  aggressive: '猛打猛冲，抢占地盘',
};

export default function CreateRoom() {
  const setPhase = useGameStore(s => s.setPhase);
  const playerCount = useGameStore(s => s.playerCount);
  const roomName = useGameStore(s => s.roomName);
  const setPlayerCount = useGameStore(s => s.setPlayerCount);
  const setRoomName = useGameStore(s => s.setRoomName);
  const createRoom = useGameStore(s => s.createRoom);
  const seatModes = useGameStore(s => s.seatModes);
  const setSeatMode = useGameStore(s => s.setSeatMode);

  return (
    <div className="min-h-screen text-white flex flex-col items-center justify-center" style={{
      background: 'linear-gradient(135deg, #1a0a0a 0%, #2d1b0e 30%, #1a1a2e 70%, #0d0d1a 100%)',
    }}>
      <div className="absolute top-4 left-6">
        <button
          onClick={() => setPhase('menu')}
          className="text-amber-400 hover:text-amber-200 transition-colors"
        >
          ← 返回主菜单
        </button>
      </div>

      <div className="w-full max-w-lg px-6">
        <h1 className="text-3xl font-black text-amber-200 text-center mb-8 tracking-wider">
          🏯 创建房间
        </h1>

        {/* Room Name */}
        <div className="mb-8">
          <label className="block text-amber-400 mb-2 font-bold">房间名称</label>
          <input
            type="text"
            value={roomName}
            onChange={e => setRoomName(e.target.value)}
            className="w-full px-4 py-3 rounded-lg bg-black/50 border border-amber-700/40 text-amber-100 text-lg focus:outline-none focus:border-amber-500 transition-colors"
          />
        </div>

        {/* Player Count */}
        <div className="mb-10">
          <label className="block text-amber-400 mb-3 font-bold">游戏人数</label>
          <div className="grid grid-cols-3 gap-3">
            {[2, 3, 4].map(count => (
              <button
                key={count}
                onClick={() => setPlayerCount(count)}
                className={`py-4 rounded-lg border-2 font-black text-xl transition-all ${
                  playerCount === count
                    ? 'border-amber-500 bg-amber-900/40 text-amber-200 shadow-lg shadow-amber-900/30 scale-105'
                    : 'border-amber-800/30 bg-black/30 text-amber-500/50 hover:border-amber-700/60 hover:text-amber-300'
                }`}
              >
                {count}人
                <div className="text-xs mt-1 font-normal text-amber-400/60">
                  {count === 2 && '双人对决'}
                  {count === 3 && '三方混战'}
                  {count === 4 && '四方争霸'}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Seat modes: human or AI with a difficulty tier (v2.2.9) */}
        <div className="mb-10">
          <label className="block text-amber-400 mb-1 font-bold">席位安排</label>
          <p className="text-xs text-amber-400/50 mb-3">默认全部人类（同屏轮流操作）。把某个席位改成 AI，即可人机对战；多个席位都是 AI 时全场自动开打，可当观战局。</p>
          <div className="flex flex-col gap-3">
            {Array.from({ length: playerCount }, (_, i) => i).map(i => {
              const mode = seatModes[i] ?? { isAi: false, tier: 'balanced' as AiSeatTier };
              return (
                <div key={i} className="rounded-lg border border-amber-800/30 bg-black/30 px-4 py-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-bold text-amber-200">座位 {i + 1}</span>
                    <div className="flex gap-1.5">
                      <button
                        onClick={() => setSeatMode(i, { isAi: false })}
                        className={`px-3 py-1 rounded-md text-xs font-bold border transition-all ${
                          !mode.isAi
                            ? 'border-amber-500 bg-amber-900/40 text-amber-200'
                            : 'border-amber-800/30 text-amber-500/50 hover:text-amber-300'
                        }`}
                      >
                        👤 人类
                      </button>
                      <button
                        onClick={() => setSeatMode(i, { isAi: true })}
                        className={`px-3 py-1 rounded-md text-xs font-bold border transition-all ${
                          mode.isAi
                            ? 'border-cyan-500 bg-cyan-900/40 text-cyan-200'
                            : 'border-amber-800/30 text-amber-500/50 hover:text-amber-300'
                        }`}
                      >
                        🤖 AI
                      </button>
                    </div>
                  </div>
                  {mode.isAi && (
                    <div className="mt-2.5 grid grid-cols-4 gap-1.5">
                      {AI_TIER_KEYS.map(tier => (
                        <button
                          key={tier}
                          title={TIER_HINTS[tier]}
                          onClick={() => setSeatMode(i, { tier })}
                          className={`py-1.5 rounded-md text-xs font-bold border transition-all ${
                            mode.tier === tier
                              ? 'border-cyan-400 bg-cyan-900/50 text-cyan-100'
                              : 'border-amber-800/20 text-amber-500/50 hover:text-amber-300'
                          }`}
                        >
                          {AI_TIER_LABELS[tier]}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Create Button */}
        <button
          onClick={() => {
            if (playerCount > 0) {
              createRoom();
            }
          }}
          disabled={playerCount === 0}
          className={`w-full py-4 rounded-xl font-black text-xl tracking-wider transition-all ${
            playerCount > 0
              ? 'bg-gradient-to-r from-amber-600 to-red-700 text-white hover:from-amber-500 hover:to-red-600 shadow-lg shadow-amber-900/40 hover:scale-105 active:scale-95'
              : 'bg-gray-800/50 text-gray-600 cursor-not-allowed border border-gray-700/30'
          }`}
        >
          {playerCount > 0 ? '⚔️ 创建房间' : '请先选择游戏人数'}
        </button>
      </div>
    </div>
  );
}
