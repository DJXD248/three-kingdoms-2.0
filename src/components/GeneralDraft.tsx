import { useGameStore } from '../store/gameStore';
import { factionColors, General } from '../data/generals';

export default function GeneralDraft() {
  const players = useGameStore(s => s.players);
  const draftGenerals = useGameStore(s => s.draftGenerals);
  const draftQunGenerals = useGameStore(s => s.draftQunGenerals);
  const selectedDraftGenerals = useGameStore(s => s.selectedDraftGenerals);
  const draftPlayerIndex = useGameStore(s => s.draftPlayerIndex);
  const selectDraftGeneral = useGameStore(s => s.selectDraftGeneral);
  const confirmDraft = useGameStore(s => s.confirmDraft);

  const currentPlayer = players[draftPlayerIndex];
  if (!currentPlayer) return null;

  const qunCount = selectedDraftGenerals.filter(g => g.faction === '群').length;
  const mainCount = selectedDraftGenerals.filter(g => g.faction !== '群').length;
  const totalCount = selectedDraftGenerals.length;

  const canConfirm = totalCount === 10 && qunCount >= 1 && qunCount <= 3;

  const isSelectable = (g: General) => {
    const isSelected = selectedDraftGenerals.some(sg => sg.id === g.id);
    if (isSelected) return true;
    if (totalCount >= 10) return false;
    if (g.faction === '群') {
      return qunCount < 3;
    } else {
      // Need at least 1 qun, so max main is 9
      // Also can't exceed 10 total minus minimum qun needed
      const maxMain = 10 - Math.max(1, qunCount);
      return mainCount < maxMain || qunCount >= 1;
    }
  };

  return (
    <div className="min-h-screen text-white flex flex-col" style={{
      background: 'linear-gradient(135deg, #1a0a0a 0%, #2d1b0e 30%, #1a1a2e 70%, #0d0d1a 100%)',
    }}>
      {/* Header */}
      <div className="text-center py-5 border-b border-amber-800/30 bg-black/20 flex-shrink-0">
        <h1 className="text-2xl font-black text-amber-200 tracking-wider mb-1">⚔️ 将领征召</h1>
        <div className="flex items-center justify-center gap-3">
          <span className="text-sm text-amber-400/60">征召将领：</span>
          <span className="text-sm font-bold" style={{ color: factionColors[currentPlayer.faction!] }}>
            {currentPlayer.name}
          </span>
          <span className="text-sm px-2 py-0.5 rounded-full font-bold"
            style={{ backgroundColor: factionColors[currentPlayer.faction!] + '25', color: factionColors[currentPlayer.faction!] }}>
            {currentPlayer.faction}
          </span>
        </div>

        {/* Progress */}
        <div className="flex items-center justify-center gap-1.5 mt-3">
          {players.map((p, i) => (
            <div key={p.id} className={`flex items-center gap-1`}>
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold border ${
                i < draftPlayerIndex ? 'border-green-500 bg-green-900/30 text-green-400' :
                i === draftPlayerIndex ? 'border-amber-500 bg-amber-900/30 text-amber-300' :
                'border-gray-700 bg-black/30 text-gray-600'
              }`}>
                {i < draftPlayerIndex ? '✓' : i + 1}
              </div>
              {i < players.length - 1 && <div className="w-4 h-px bg-gray-700" />}
            </div>
          ))}
        </div>
      </div>

      {/* Selection status bar */}
      <div className="px-6 py-2.5 bg-black/30 border-b border-amber-800/20 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-4">
          <span className="text-amber-400/80 text-sm">
            已选 <strong className="text-amber-200">{totalCount}</strong>/10
          </span>
          <span className="text-sm" style={{ color: factionColors[currentPlayer.faction!] }}>
            {currentPlayer.faction}: <strong>{mainCount}</strong>
          </span>
          <span className="text-sm" style={{ color: factionColors['群'] }}>
            群: <strong>{qunCount}</strong>/1-3
          </span>
        </div>
        <div className="flex items-center gap-1 text-[10px] text-amber-500/50">
          {totalCount < 10 && qunCount === 0 && <span>⚠ 至少选择1名群势力将领</span>}
          {qunCount > 3 && <span className="text-red-400">⚠ 群势力最多3名</span>}
        </div>
      </div>

      {/* Draft cards area */}
      <div className="flex-1 overflow-auto px-6 py-4">
        {/* Main faction */}
        <h3 className="text-sm font-bold mb-3 flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: factionColors[currentPlayer.faction!] }} />
          <span style={{ color: factionColors[currentPlayer.faction!] }}>{currentPlayer.faction}</span>
          <span className="text-amber-500/40">势力将领 ({draftGenerals.length})</span>
        </h3>
        <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-7 gap-2 mb-6">
          {draftGenerals.map(g => (
            <DraftCard
              key={g.id}
              general={g}
              isSelected={selectedDraftGenerals.some(sg => sg.id === g.id)}
              isSelectable={isSelectable(g)}
              onSelect={() => selectDraftGeneral(g)}
            />
          ))}
        </div>

        {/* Qun faction */}
        <h3 className="text-sm font-bold mb-3 flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: factionColors['群'] }} />
          <span style={{ color: factionColors['群'] }}>群</span>
          <span className="text-amber-500/40">势力将领 ({draftQunGenerals.length})</span>
        </h3>
        <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 mb-4">
          {draftQunGenerals.map(g => (
            <DraftCard
              key={g.id}
              general={g}
              isSelected={selectedDraftGenerals.some(sg => sg.id === g.id)}
              isSelectable={isSelectable(g)}
              onSelect={() => selectDraftGeneral(g)}
            />
          ))}
        </div>
      </div>

      {/* Bottom panel - selected generals + confirm */}
      <div className="border-t border-amber-800/30 bg-black/40 px-6 py-3 flex-shrink-0">
        <div className="flex items-center gap-2 mb-2.5 overflow-x-auto">
          <span className="text-amber-400/60 text-xs font-bold flex-shrink-0">已选:</span>
          {selectedDraftGenerals.length === 0 && (
            <span className="text-amber-500/30 text-xs">点击将领卡片进行选择</span>
          )}
          {selectedDraftGenerals.map(g => (
            <button
              key={g.id}
              onClick={() => selectDraftGeneral(g)}
              className="flex-shrink-0 px-2 py-1 rounded-lg text-xs font-bold border transition-all hover:scale-105 hover:brightness-125"
              style={{
                borderColor: factionColors[g.faction] + '50',
                backgroundColor: factionColors[g.faction] + '15',
                color: factionColors[g.faction],
              }}
            >
              {g.name} ✕
            </button>
          ))}
        </div>
        <button
          onClick={confirmDraft}
          disabled={!canConfirm}
          className={`w-full py-3 rounded-xl font-black text-base transition-all ${
            canConfirm
              ? 'bg-gradient-to-r from-amber-600 to-red-700 text-white hover:from-amber-500 hover:to-red-600 shadow-lg shadow-amber-900/30 active:scale-95'
              : 'bg-gray-800/60 text-gray-600 cursor-not-allowed border border-gray-700/20'
          }`}
        >
          {canConfirm ? '✓ 确认征召' : `选择10名将领（群势力1-3名，当前${qunCount}名）`}
        </button>
      </div>
    </div>
  );
}

function DraftCard({
  general,
  isSelected,
  isSelectable,
  onSelect,
}: {
  general: General;
  isSelected: boolean;
  isSelectable: boolean;
  onSelect: () => void;
}) {
  const pColor = factionColors[general.faction];

  return (
    <button
      onClick={isSelectable ? onSelect : undefined}
      className={`relative rounded-xl border-2 p-2.5 transition-all duration-200 text-left ${
        isSelected
          ? 'scale-[1.03] shadow-lg'
          : isSelectable
            ? 'hover:scale-[1.03] hover:shadow-md'
            : 'opacity-30 cursor-not-allowed grayscale'
      }`}
      style={{
        borderColor: isSelected ? pColor : pColor + '25',
        background: isSelected
          ? `linear-gradient(180deg, ${pColor}25 0%, ${pColor}08 100%)`
          : `linear-gradient(180deg, ${pColor}08 0%, rgba(0,0,0,0.4) 100%)`,
        boxShadow: isSelected ? `0 4px 15px ${pColor}20` : 'none',
      }}
    >
      {isSelected && (
        <div className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black text-white shadow-md"
          style={{ backgroundColor: pColor }}>
          ✓
        </div>
      )}
      <div className="text-center">
        <div className="text-2xl mb-0.5">{general.type === '武将' ? '⚔️' : '📜'}</div>
        <h3 className="text-sm font-black text-amber-100 leading-tight">{general.name}</h3>
        {general.title && (
          <p className="text-[8px] text-amber-500/40 mt-0.5 truncate">{general.title}</p>
        )}
        <div className="flex justify-center gap-1.5 text-[10px] text-amber-300/60 mt-1">
          <span>❤️{general.hp}</span>
          <span>⚔️{general.meleeAtk}</span>
          <span>🏹{general.rangedAtk}</span>
        </div>
        <div className="flex flex-wrap justify-center gap-0.5 mt-1.5">
          {general.skills.map((s, i) => (
            <span key={i} className="text-[8px] px-1 py-0.5 rounded bg-black/40 text-amber-400/70 border border-amber-800/10">
              {s.name}
            </span>
          ))}
        </div>
      </div>
    </button>
  );
}
