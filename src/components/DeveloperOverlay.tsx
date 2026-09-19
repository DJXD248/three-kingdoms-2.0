import { useGameStore } from '../store/gameStore';

export default function DeveloperOverlay() {
  const developerMode = useGameStore(s => s.developerMode);
  if (!developerMode) return null;

  return (
    <div
      className="fixed top-4 left-4 z-[100] pointer-events-none select-none"
      style={{ mixBlendMode: 'overlay' }}
    >
      <span
        className="text-lg font-black tracking-wider"
        style={{
          color: 'rgba(255,255,255,0.12)',
          textShadow: '0 0 8px rgba(255,255,255,0.08)',
        }}
      >
        开发者模式
      </span>
    </div>
  );
}
