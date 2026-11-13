import { useSyncExternalStore } from 'react';
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
import AskClockDirector from './components/AskClockDirector';
import NetRoomBridge from './components/NetRoomBridge';
import { getActiveRoom, getHostLink, getMyNetSeat, subscribeNetRoom } from './network/netRoom';
import { activeSeatForStage } from './store/seatAxis';
import NetPingOverlay from './components/NetPingPanel';
import NetSeatOverlay from './components/NetSeatPanel';
import { factionColors } from './data/generals';

// Hash route for the background AI-battle window opened by developer mode.
// Read once at module load: the hash never changes within a loaded document,
// so hook order stays stable in both windows.
const IS_AI_BATTLE_WINDOW =
  typeof window !== 'undefined' && window.location.hash.startsWith('#ai-battle');

export default function App() {
  const phase = useGameStore(s => s.phase);
  // 视角轴（哪一营画在正下方）唯一的取数点：联机＝我这台机器绑到的那一席，本地＝null。
  // 动手那一格不看它，仍只看 `store.currentPlayerIndex`（用户 2026-10-30 裁第 3 条：
  // 能不能动手只由 `ActionValidator` 那一处说了算＝轮到谁 ＋ 有没有技能正等着响应）。
  const viewSeat = useSyncExternalStore(subscribeNetRoom, getMyNetSeat, getMyNetSeat);
  // 客人这根线与房主失联时整屏给一句人话，不再停在「等房主动」上。
  const activeRoom = useSyncExternalStore(subscribeNetRoom, getActiveRoom, getActiveRoom);
  const hostLink = useSyncExternalStore(subscribeNetRoom, getHostLink, getHostLink);
  const hostLost = activeRoom?.role === 'guest' && hostLink === 'lost';
  // 联机时「现在轮到谁动手」与「我这台绑到哪一席」不是同一件事：本地热座两者恒等。
  // 不等 ⇒ 这一屏不许有替别人点的入口（2026-11-11 真机反馈 §12-179⑨㈠）。
  const netPlayers = useGameStore(s => s.players);
  const netActiveIndex = useGameStore(s => s.currentPlayerIndex);
  const draftIndex = useGameStore(s => s.draftPlayerIndex);
  // 征召那一段「轮到谁」看的是挑将席，不是出牌席：confirmDraft 只在全部挑完、进抽卡
  // 时才把出牌席归零，挑将期间它一直是 0。用错这把尺子会把房主自己那一席也锁成
  // 「这一席是别人的」（2026-11-13 真机卡点）。抽卡／牌桌两段仍用出牌席。
  const activeSeat = activeSeatForStage(phase, netPlayers, netActiveIndex, draftIndex);
  const seatLocked = viewSeat !== null && activeSeat !== null && activeSeat !== viewSeat
    && (phase === 'generalDraft' || phase === 'drawing' || phase === 'playing');
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
      content = <GeneralDraft seatLocked={seatLocked} />;
      break;
    case 'drawing':
      content = <UnifiedDraw seatLocked={seatLocked} />;
      break;
    case 'playing':
      content = <GameBoard viewSeat={viewSeat} seatLocked={seatLocked} />;
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
      {hostLost ? (
        <div className="fixed top-0 inset-x-0 z-[70] px-4 py-2.5 text-center text-sm font-bold bg-red-950/95 text-red-100 border-b border-red-600/70">
          ⚠️ 房主已经断线（15 秒没收到他的任何消息）—— 这一局暂时停在这里，等房主回来，或退出房间重开一局。
        </div>
      ) : seatLocked ? (
        <div className="fixed top-0 inset-x-0 z-[60] px-4 py-2 text-center text-sm font-bold bg-amber-900/95 text-amber-100 border-b border-amber-600/60">
          现在轮到别人那一席 —— 请等他在自己电脑上点；你这边只能看，不能替他出牌。
        </div>
      ) : null}
      {content}
      <AiDirector />
      {/* 乙 线末片第二刀 · 刀 1 拍 3 ㈁：问窗那把表全程序只此一枚，挂在这里（与 AI 司机同级、
          与牌桌同屏）。它渲染 null，只负责"到点替那一席按那颗本来就合法的钮"与那一行的秒数。 */}
      <AskClockDirector />
      {/* J2 发快照的接线住在屏幕上，不住在大厅弹窗里：房主关掉大厅去开局，连线也得继续发。 */}
      <NetRoomBridge />
      {/* J3 左上角那张公开连线表同理：房主关了大厅、客人只开着牌桌，也得看得见谁掉线。 */}
      <NetPingOverlay />
      {/* J4 右上角那张席位表：房主关了大厅去开局，也要看得见哪把椅子坐着谁。 */}
      <NetSeatOverlay />
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
