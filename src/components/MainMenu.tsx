import { useGameStore } from '../store/gameStore';
import { useState } from 'react';
import { clearLocalGameSnapshot, readLocalGameSnapshot } from '../store/localGameSnapshot';
import pkg from '../../package.json';
import AiBattleConfig from './AiBattleConfig';
import OnlineLobby from './OnlineLobby';

export default function MainMenu() {
  const setPhase = useGameStore(s => s.setPhase);
  const developerMode = useGameStore(s => s.developerMode);
  const [showStartOptions, setShowStartOptions] = useState(false);
  const [showOnlineLobby, setShowOnlineLobby] = useState(false);
  const [showAiBattle, setShowAiBattle] = useState(false);
  const [hasSavedGame, setHasSavedGame] = useState(() => readLocalGameSnapshot() !== null);

  const continueGame = () => {
    const data = readLocalGameSnapshot();
    if (!data) {
      setHasSavedGame(false);
      return;
    }
    const restored = useGameStore.getState().restoreSerializedSnapshot(data);
    if (!restored) {
      console.error('[Recovery] Saved game could not be resumed');
      clearLocalGameSnapshot();
      setHasSavedGame(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center relative overflow-hidden">
      {/* Background */}
      <div className="absolute inset-0" style={{
        background: `
          radial-gradient(ellipse at 20% 30%, rgba(139,69,19,0.15) 0%, transparent 50%),
          radial-gradient(ellipse at 80% 70%, rgba(139,0,0,0.1) 0%, transparent 50%),
          radial-gradient(ellipse at 50% 50%, rgba(45,27,14,0.3) 0%, transparent 70%),
          linear-gradient(135deg, #0d0805 0%, #1a0f0a 25%, #12101e 50%, #0d0d1a 75%, #050308 100%)
        `,
      }} />

      {/* Decorative particles */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="absolute w-1 h-1 bg-amber-400/20 rounded-full animate-pulse"
            style={{
              left: `${15 + i * 15}%`,
              top: `${20 + (i % 3) * 25}%`,
              animationDelay: `${i * 0.5}s`,
              animationDuration: `${2 + i * 0.3}s`,
            }}
          />
        ))}
      </div>

      {/* Title */}
      <div className="relative z-10 text-center mb-8 sm:mb-16 animate-fadeIn">
        <div className="mb-2 sm:mb-4">
          <span className="text-4xl sm:text-6xl">⚔️</span>
        </div>
        <h1 className="text-3xl sm:text-5xl lg:text-6xl font-black tracking-wider mb-3"
          style={{
            background: 'linear-gradient(180deg, #ffd700 0%, #ff8c00 40%, #b8860b 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            filter: 'drop-shadow(0 4px 12px rgba(255,215,0,0.3))',
          }}>
          三国卡牌对战模拟器
        </h1>
        <div className="flex items-center justify-center gap-3 mb-2">
          <div className="h-px w-16 bg-gradient-to-r from-transparent to-amber-600/50" />
          <p className="text-amber-300/50 text-sm tracking-[0.4em] font-medium">THREE KINGDOMS TCG SIMULATOR</p>
          <div className="h-px w-16 bg-gradient-to-l from-transparent to-amber-600/50" />
        </div>
        <div className="flex items-center justify-center gap-2 mt-4">
          {['魏', '蜀', '吴', '群', '晋'].map((faction, i) => (
            <span key={faction} className="text-xs px-2 py-0.5 rounded-full font-bold border"
              style={{
                borderColor: ['#2563eb', '#dc2626', '#16a34a', '#eab308', '#9333ea'][i] + '50',
                color: ['#2563eb', '#dc2626', '#16a34a', '#eab308', '#9333ea'][i],
                backgroundColor: ['#2563eb', '#dc2626', '#16a34a', '#eab308', '#9333ea'][i] + '10',
              }}>
              {faction}
            </span>
          ))}
        </div>
      </div>

      {/* Menu buttons */}
      <div className="relative z-10 flex flex-col gap-3 w-72 sm:w-80 px-4 sm:px-0 animate-slideUp">
        {!showStartOptions ? (
          <>
            <MenuButton onClick={() => setShowStartOptions(true)} icon="⚔️">
              开始游戏
            </MenuButton>
            {hasSavedGame && <MenuButton onClick={continueGame} icon="▶️">
              继续游戏
            </MenuButton>}
            <MenuButton onClick={() => setPhase('codex')} icon="📖">
              卡牌图鉴
            </MenuButton>
            <MenuButton onClick={() => setPhase('rules')} icon="📜">
              游戏规则
            </MenuButton>
            <MenuButton onClick={() => setPhase('settings')} icon="⚙️">
              游戏设置
            </MenuButton>
            {developerMode && (
              <MenuButton onClick={() => setShowAiBattle(true)} icon="🤖">
                AI 对战演练
              </MenuButton>
            )}
            <MenuButton onClick={() => {}} icon="🚪" disabled>
              退出游戏
            </MenuButton>
          </>
        ) : (
          <div className="flex flex-col gap-3 animate-fadeIn">
            <MenuButton onClick={() => setPhase('createRoom')} icon="🏠">
              本地游戏
            </MenuButton>
            <MenuButton onClick={() => setShowOnlineLobby(true)} icon="🌐">
              联网对战
            </MenuButton>
            <button 
              onClick={() => setShowStartOptions(false)}
              className="text-amber-300/40 text-sm hover:text-amber-200 transition-colors mt-1"
            >
              ← 返回
            </button>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="absolute bottom-4 left-0 right-0 flex justify-between px-6">
        <p className="text-amber-200/20 text-xs">三国卡牌对战模拟器</p>
        <p className="text-amber-200/20 text-xs">Qoder V{pkg.version}</p>
      </div>

      {showAiBattle && <AiBattleConfig onClose={() => setShowAiBattle(false)} />}
      {showOnlineLobby && <OnlineLobby onClose={() => setShowOnlineLobby(false)} />}
    </div>
  );
}

function MenuButton({ 
  children, 
  onClick, 
  icon, 
  disabled = false,
}: { 
  children: React.ReactNode; 
  onClick: () => void; 
  icon: string;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      className={`
        group relative flex items-center gap-3 w-full
        px-6 py-4 text-lg
        rounded-xl border transition-all duration-300
        ${disabled
          ? 'border-gray-700/30 bg-gray-900/20 text-gray-600 cursor-not-allowed'
          : 'border-amber-600/30 bg-gradient-to-r from-amber-950/40 to-red-950/30 text-amber-100 hover:border-amber-400/60 hover:from-amber-900/50 hover:to-red-900/40 hover:scale-[1.02] hover:shadow-lg hover:shadow-amber-950/30 active:scale-[0.98]'
        }
        font-bold tracking-wider backdrop-blur-sm
      `}
    >
      <span className="text-2xl w-8 text-center">{icon}</span>
      <span className="flex-1 text-left">{children}</span>
      {!disabled && (
        <span className="opacity-0 group-hover:opacity-100 transition-all text-amber-500 translate-x-0 group-hover:translate-x-1">
          →
        </span>
      )}
    </button>
  );
}
