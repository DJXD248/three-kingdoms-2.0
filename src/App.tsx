import { useGameStore } from './store/gameStore';
import MainMenu from './components/MainMenu';
import Codex from './components/Codex';
import Settings from './components/Settings';
import CreateRoom from './components/CreateRoom';
import Lobby from './components/Lobby';
import DiceRoll from './components/DiceRoll';
import GeneralDraft from './components/GeneralDraft';
import UnifiedDraw from './components/UnifiedDraw';
import GameBoard from './components/GameBoard';
import GameOverScreen from './components/GameOverScreen';
import DeveloperOverlay from './components/DeveloperOverlay';
import TestArena from './components/TestArena';
import Rules from './components/Rules';
import AiBattleWindow from './components/AiBattleWindow';
import AiBattleDock from './components/AiBattleDock';
import AiDirector from './components/AiDirector';
import NetRoomBridge from './components/NetRoomBridge';
import { factionColors } from './data/generals';

// Hash route for the background AI-battle window opened by developer mode.
// Read once at module load: the hash never changes within a loaded document,
// so hook order stays stable in both windows.
const IS_AI_BATTLE_WINDOW =
  typeof window !== 'undefined' && window.location.hash.startsWith('#ai-battle');

export default function App() {
  const phase = useGameStore(s => s.phase);
  if (IS_AI_BATTLE_WINDOW) return <AiBattleWindow />;

  let content: React.ReactNode;
  switch (phase) {
    case 'menu':
      content = <MainMenu />;
      break;
    case 'codex':
      content = <Codex />;
      break;
    case 'settings':
      content = <Settings />;
      break;
    case 'rules':
      content = <Rules />;
      break;
    case 'createRoom':
      content = <CreateRoom />;
      break;
    case 'lobby':
      content = <Lobby />;
      break;
    case 'diceRoll':
      content = <DiceRoll />;
      break;
    case 'factionAssign':
      content = <FactionAssign />;
      break;
    case 'generalDraft':
      content = <GeneralDraft />;
      break;
    case 'drawing':
      content = <UnifiedDraw />;
      break;
    case 'playing':
      content = <GameBoard />;
      break;
    case 'gameOver':
      content = <GameOverScreen />;
      break;
    case 'testArena':
      content = <TestArena />;
      break;
    default:
      content = <MainMenu />;
  }

  return (
    <div className="app-shell">
      {content}
      <AiDirector />
      {/* J2 发快照的接线住在屏幕上，不住在大厅弹窗里：房主关掉大厅去开局，连线也得继续发。 */}
      <NetRoomBridge />
      <DeveloperOverlay />
      <AiBattleDock />
    </div>
  );
}

function FactionAssign() {
  const players = useGameStore(s => s.players);

  return (
    <div className="min-h-screen text-white flex flex-col items-center justify-center" style={{
      background: 'linear-gradient(135deg, #1a0a0a 0%, #2d1b0e 30%, #1a1a2e 70%, #0d0d1a 100%)',
    }}>
      <h1 className="text-3xl font-black text-amber-200 mb-2 tracking-wider">🎌 势力分配</h1>
      <p className="text-amber-500/60 mb-8">随机分配玩家主势力</p>
      <div className="flex gap-8 mb-8">
        {players.map(player => (
          <div key={player.id} className="flex flex-col items-center">
            <div className="w-24 h-24 rounded-xl border-2 flex items-center justify-center mb-3"
              style={{
                borderColor: player.faction ? factionColors[player.faction] : '#555',
                backgroundColor: player.faction ? factionColors[player.faction] + '20' : '#1a1a1a',
              }}>
              {player.faction ? (
                <span className="text-4xl font-black" style={{ color: factionColors[player.faction] }}>
                  {player.faction}
                </span>
              ) : (
                <span className="text-3xl">❓</span>
              )}
            </div>
            <p className="text-amber-200 font-bold">{player.name}</p>
            <p className="text-xs text-amber-400/60">座次 {player.seatOrder + 1}</p>
          </div>
        ))}
      </div>
      <p className="text-amber-400/50 text-sm animate-pulse">正在分配将领...</p>
    </div>
  );
}
