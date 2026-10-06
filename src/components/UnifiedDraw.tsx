import { useEffect, useState } from 'react';
import { useGameStore } from '../store/gameStore';
import { factionColors, General } from '../data/generals';
import { GameCard } from '../data/cards';

function isGen(c: General | GameCard): c is General {
  return !!c && typeof c === 'object' && 'skills' in c;
}

export default function UnifiedDraw() {
  const players = useGameStore(s => s.players);
  const drawContext = useGameStore(s => s.drawContext);
  const revealedDrawCards = useGameStore(s => s.revealedDrawCards);
  const cardDeck = useGameStore(s => s.cardDeck);
  const executeDraw = useGameStore(s => s.executeDraw);
  const confirmDraw = useGameStore(s => s.confirmDraw);
  const resolvePendingDrawLoss = useGameStore(s => s.resolvePendingDrawLoss);
  const currentRound = useGameStore(s => s.currentRound);
  const initialDrawPlayerIndex = useGameStore(s => s.initialDrawPlayerIndex);

  const [fromPool, setFromPool] = useState(-1); // -1 = not initialized yet
  const [drawn, setDrawn] = useState(false);
  const [animating, setAnimating] = useState(false);

  // Hooks must always run in the same order. Reset draw UI state only when a
  // draw session actually changes; this keeps phase transitions from causing
  // a conditional-hook runtime failure.
  useEffect(() => {
    if (!drawContext) {
      setFromPool(-1);
      setDrawn(false);
      setAnimating(false);
      return;
    }
    const player = players.find(p => p.id === drawContext.playerId);
    const poolSize = player?.generalPool?.length ?? 0;
    const total = drawContext.totalCards;
    const maxFromPool = Math.min(total, poolSize);
    setFromPool(Math.min(total === 1 ? (maxFromPool > 0 ? 1 : 0) : Math.min(2, maxFromPool), maxFromPool));
    setDrawn(false);
    setAnimating(false);
  }, [drawContext?.playerId, drawContext?.reason, drawContext?.totalCards, drawContext?.baseLossPending]);

  useEffect(() => {
    if (!drawContext || drawContext.reason !== 'turnStart' || drawContext.totalCards !== 0 || drawContext.baseLossPending) return;
    const timer = window.setTimeout(() => confirmDraw(), 0);
    return () => window.clearTimeout(timer);
  }, [drawContext?.playerId, drawContext?.reason, drawContext?.totalCards, drawContext?.baseLossPending, confirmDraw]);

  if (!drawContext) return null;

  const player = players.find(p => p.id === drawContext.playerId);
  if (!player) return null;

  const total = drawContext.totalCards;
  const poolSize = player.generalPool.length;
  const maxFromPool = Math.min(total, poolSize);
  const deckSize = cardDeck.length;

  const actualFromPool = fromPool === -1 ? Math.min(total === 1 ? (maxFromPool > 0 ? 1 : 0) : Math.min(2, maxFromPool), maxFromPool) : fromPool;
  const fromDeck = total - actualFromPool;

  const handleDraw = () => {
    setAnimating(true);
    setTimeout(() => {
      const success = executeDraw(actualFromPool, fromDeck);
      if(success){
        setDrawn(true);
      } else {
        setDrawn(false);
      }
      setAnimating(false);
    }, 400);
  };

  const handleConfirm = () => {
    confirmDraw();
  };

  const drawnCards = drawn ? revealedDrawCards.filter(Boolean) : [];

  // Titles & icons by reason
  const reasonConfig = {
    initial: { icon: '🎴', title: '初始抽卡' },
    turnStart: { icon: '🎴', title: '回合开始 - 抽卡阶段' },
    compensation: { icon: '💔', title: '击破补偿抽卡' },
  };
  const cfg = reasonConfig[drawContext.reason] ?? reasonConfig.turnStart;
  const color = player.faction ? factionColors[player.faction] : '#eab308';
  // v2.2.9: when the draw belongs to an AI seat the AiDirector answers this
  // screen — hide the interactive controls and show a "thinking" banner.
  const aiDrawing = player.isAi === true;

  return (
    <div className="min-h-screen text-white flex flex-col items-center justify-center" style={{
      background: 'linear-gradient(135deg, #1a0a0a 0%, #2d1b0e 30%, #1a1a2e 70%, #0d0d1a 100%)',
    }}>
      {/* Header */}
      <div className="text-center mb-6">
        {drawContext.reason === 'turnStart' && (
          <p className="text-amber-500/50 text-sm mb-1">第 {currentRound} 轮</p>
        )}
        <h1 className="text-xl sm:text-3xl font-black text-amber-200 mb-2 tracking-wider">{cfg.icon} {cfg.title}</h1>
        <p className="text-amber-400/70">
          <span className="font-bold" style={{ color }}>{player.name}</span>
          {drawContext.reason === 'initial' && ' — 初始抽卡'}
          {drawContext.reason === 'turnStart' && ' 的回合'}
          {drawContext.reason === 'compensation' && ' — 将领被击破'}
        </p>
      </div>

      {/* Progress for initial draw */}
      {drawContext.reason === 'initial' && (
        <div className="flex items-center gap-2 mb-6">
          {players.map((p, i) => (
            <div key={p.id} className="flex items-center gap-1">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-all ${
                i < initialDrawPlayerIndex ? 'border-green-500 bg-green-900/30 text-green-400' :
                i === initialDrawPlayerIndex ? 'border-amber-500 bg-amber-900/30 text-amber-300 scale-110' :
                'border-gray-700 bg-black/30 text-gray-600'
              }`}>
                {i < initialDrawPlayerIndex ? '✓' : i + 1}
              </div>
              {i < players.length - 1 && <div className="w-4 h-0.5 bg-gray-700" />}
            </div>
          ))}
        </div>
      )}

      {/* Draw count badge */}
      <div className="bg-black/40 border border-amber-800/30 rounded-xl px-6 py-3 mb-6">
        <p className="text-center text-amber-300">
          抽取 <span className="text-2xl font-black text-amber-100">{total}</span> 张卡
        </p>
        <p className="text-center text-amber-500/50 text-xs mt-1">{drawContext.subtitle}</p>
      </div>

      {/* AI seat owns this draw: the director plays it automatically */}
      {aiDrawing && (
        <div className="text-center animate-pulse mb-6">
          <div className="text-5xl mb-3">🤖</div>
          <p className="text-cyan-300 text-lg font-bold">{player.name} 正在决定抽卡…</p>
          {revealedDrawCards.length > 0 && (
            <p className="text-amber-400/60 text-sm mt-2">已抽出 {revealedDrawCards.length} 张，稍候自动确认</p>
          )}
        </div>
      )}

      {/* Pre-draw base loss warning */}
      {drawContext.baseLossPending && !drawn && !animating && !aiDrawing && (
        <div className="w-full max-w-md px-6 animate-fadeIn animate-screenShake">
          <div className="bg-black/50 border border-red-700/40 rounded-xl p-8 text-center mb-6 animate-base-hit">
            <div className="text-6xl mb-4 animate-pulse-glow">🏯💥</div>
            <h3 className="text-2xl font-black text-red-300 mb-3">营地受到伤害</h3>
            <p className="text-amber-200 mb-2">将领池为空时，回合开始时营地失去1点体力</p>
            <p className="text-amber-500/60 text-sm mb-6">先结算营地失去体力，若存活再进行抽卡</p>
            <button
              onClick={resolvePendingDrawLoss}
              className="w-full py-3.5 rounded-xl font-black text-lg bg-gradient-to-r from-red-700 to-amber-700 text-white hover:from-red-600 hover:to-amber-600 shadow-lg shadow-red-900/30 transition-all active:scale-95"
            >
              结算失去体力
            </button>
          </div>
        </div>
      )}

      {/* Animating */}
      {animating && (
        <div className="text-center animate-pulse">
          <div className="text-6xl mb-4">{cfg.icon}</div>
          <p className="text-amber-300 text-lg">抽取中...</p>
        </div>
      )}

      {/* Selection UI — before draw */}
      {!drawn && !animating && !aiDrawing && !drawContext.baseLossPending && total > 0 && (
        <div className="w-full max-w-md px-6 animate-fadeIn">
          <div className="bg-black/50 border border-amber-800/30 rounded-xl p-6 mb-6">
            <p className="text-center text-amber-400/60 text-sm mb-4">自由分配抽取来源</p>
            <div className="mb-4 rounded-lg border border-amber-700/30 bg-amber-900/10 px-4 py-2 text-center">
              <p className="text-xs text-amber-400/70">当前玩家将领池剩余</p>
              <p className="text-2xl font-black text-amber-200">{poolSize} 张</p>
            </div>
            <div className="flex justify-between mb-6">
              <div className="text-center flex-1">
                <div className="text-3xl mb-2">👤</div>
                <p className="text-amber-400 text-sm mb-1">将领池</p>
                <p className="text-4xl font-black text-amber-200">{actualFromPool}</p>
                <p className="text-xs text-amber-500/40 mt-1">
                  {poolSize > 0 ? `剩余 ${poolSize} 张` : <span className="text-red-400">已空</span>}
                </p>
              </div>
              <div className="flex items-center text-2xl text-amber-700/40 px-4">+</div>
              <div className="text-center flex-1">
                <div className="text-3xl mb-2">🃏</div>
                <p className="text-amber-400 text-sm mb-1">抽牌堆</p>
                <p className="text-4xl font-black text-amber-200">{fromDeck}</p>
                <p className="text-xs text-amber-500/40 mt-1">
                  {deckSize > 0 ? `剩余 ${deckSize} 张` : <span className="text-red-400">已空</span>}
                </p>
              </div>
            </div>
            <input
              type="range"
              min="0"
              max={maxFromPool}
              value={actualFromPool}
              onChange={e => setFromPool(parseInt(e.target.value))}
              className="w-full accent-amber-500 cursor-pointer"
              disabled={maxFromPool === 0}
            />
            <div className="flex justify-between text-[10px] text-amber-500/40 mt-1">
              <span>← 全部抽牌堆</span>
              <span>全部将领池 →</span>
            </div>
            {maxFromPool === 0 && (
              <p className="text-center text-red-400/60 text-xs mt-2">将领池已空，全部从抽牌堆抽取</p>
            )}
            {poolSize > 0 && actualFromPool === poolSize && (
              <p className="text-center text-yellow-400/70 text-xs mt-2">本次抽卡后将领池将被抽空；将领池为空时，回合开始时营地将失去1点体力</p>
            )}
          </div>

          <button
            onClick={handleDraw}
            className="w-full py-3.5 rounded-xl font-black text-lg bg-gradient-to-r from-amber-600 to-red-700 text-white hover:from-amber-500 hover:to-red-600 shadow-lg shadow-amber-900/30 transition-all active:scale-95"
          >
            {cfg.icon} 抽取 {total} 张卡牌
          </button>
        </div>
      )}

      {/* Result UI — after draw */}
      {drawn && !animating && (
        <div className="w-full max-w-3xl px-6 animate-fadeIn">
          <p className="text-center text-amber-400 mb-4 text-sm">抽取了 {drawnCards.length} 张卡</p>
          <div className="flex gap-3 justify-center flex-wrap mb-8">
            {drawnCards.map((card, i) => (
              <div key={i} className="bg-black/50 border border-amber-700/30 rounded-xl p-4 text-center w-28 animate-slideUp"
                style={{ animationDelay: `${i * 80}ms` }}>
                {isGen(card) ? (
                  <>
                    <div className="text-xs px-1.5 py-0.5 rounded mb-1.5 inline-block font-bold"
                      style={{ backgroundColor: factionColors[card.faction] + '30', color: factionColors[card.faction] }}>
                      {card.faction}
                    </div>
                    <div className="text-3xl mb-1">{card.type === '武将' ? '⚔️' : '📜'}</div>
                    <p className="text-sm font-bold text-amber-200">{card.name}</p>
                    <p className="text-[10px] text-amber-400/50 mt-1">❤️{card.hp} {card.type}</p>
                  </>
                ) : (
                  <>
                    <div className="text-xs px-1.5 py-0.5 rounded mb-1.5 inline-block font-bold bg-amber-800/30 text-amber-400">
                      {card.type}
                    </div>
                    <div className="text-3xl mb-1">
                      {card.type === '粮草' ? '🌾' : card.type === '材料' ? '⛏️' : '🛡️'}
                    </div>
                    <p className="text-sm font-bold text-amber-200">{card.name}</p>
                  </>
                )}
              </div>
            ))}
          </div>
          <button
            onClick={handleConfirm}
            className="w-full py-3.5 rounded-xl font-black text-lg bg-gradient-to-r from-amber-600 to-red-700 text-white hover:from-amber-500 hover:to-red-600 shadow-lg shadow-amber-900/30 transition-all active:scale-95"
          >
            {drawContext.reason === 'initial' ? '✓ 确认' :
             drawContext.reason === 'turnStart' ? '⚔️ 开始行动' : '✓ 确认'}
          </button>
        </div>
      )}
    </div>
  );
}
