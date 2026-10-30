import { useSyncExternalStore } from 'react';
import { useGameStore } from '../store/gameStore';
import { factionColors } from '../data/generals';
import { getReadyTable, getStartGate, subscribeNetRoom } from '../network/netRoom';

export default function Lobby() {
  const players = useGameStore(s => s.players);
  const roomName = useGameStore(s => s.roomName);
  const startGame = useGameStore(s => s.startGame);
  const setPhase = useGameStore(s => s.setPhase);
  // 联机切片⑤a：那颗钮的读数。本地热座（没开联机房）与这台机器是客人时 `applicable:false`
  // ＝闸门管不着，按下去与今天一模一样；只有联机房主那台机器会被它按住（用户 2026-10-30 裁）。
  const gate = useSyncExternalStore(subscribeNetRoom, getStartGate, getStartGate);
  const readyTable = useSyncExternalStore(subscribeNetRoom, getReadyTable, getReadyTable);
  const canStart = !gate.applicable || gate.open;

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
        disabled={!canStart}
        aria-disabled={!canStart}
        className={`px-10 py-4 rounded-xl font-black text-xl tracking-wider transition-all ${
          canStart
            ? 'bg-gradient-to-r from-amber-600 to-red-700 text-white hover:from-amber-500 hover:to-red-600 shadow-lg shadow-amber-900/40 hover:scale-105 active:scale-95'
            : 'bg-stone-800 text-stone-500 cursor-not-allowed'
        }`}
      >
        ⚔️ 开始游戏
      </button>

      {/* 闸门那句人话：说清在等谁，而不是把钮藏起来（用户 2026-10-30 裁「按不下去」不是「看不见」）。 */}
      {gate.applicable && !gate.open && (
        <p className="mt-4 text-sm text-amber-200/70">
          {gate.waiting.length > 0
            ? <>还在等 <span className="font-bold text-amber-100">{gate.waiting.join('、')}</span> 点「我准备好了」——他们点完这颗钮才会亮。</>
            : <>准备名单还在算（刚连上线那一瞬），稍等一会儿这句就换成还在等谁。</>}
          {gate.gone.length > 0 && (
            <span className="text-red-300/80"> 已经不算在内的：{gate.gone.join('、')}（房主判成掉线，不等他）。</span>
          )}
        </p>
      )}
      {gate.applicable && gate.open && (
        <p className="mt-4 text-sm text-emerald-300/80">
          {(readyTable?.length ?? 0) === 0
            ? '屋里没有客人 ⇒ 直接开始就行。'
            : gate.gone.length > 0
              ? <>可以开始。不等的只有 <span className="font-bold">{gate.gone.join('、')}</span>（房主判成掉线，他那一行不算分母）。</>
              : '还在场的客人都点过「我准备好了」⇒ 可以开始。'}
        </p>
      )}
    </div>
  );
}
