import { useGameStore } from '../store/gameStore';

export default function CreateRoom() {
  const setPhase = useGameStore(s => s.setPhase);
  const playerCount = useGameStore(s => s.playerCount);
  const roomName = useGameStore(s => s.roomName);
  const setPlayerCount = useGameStore(s => s.setPlayerCount);
  const setRoomName = useGameStore(s => s.setRoomName);
  const createRoom = useGameStore(s => s.createRoom);

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
