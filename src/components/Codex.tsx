import { useState, useMemo } from 'react';
import { useGameStore } from '../store/gameStore';
import { allGenerals, General, Faction, factionColors, SkillTag, allSkillTags, skillTagColors } from '../data/generals';
import { allCards, GameCard } from '../data/cards';
import SkillEditor from './SkillEditor';
import { denialMessage } from '../domain/generalPolicy';

type TabType = '将领' | '卡牌';

export default function Codex() {
  const setPhase = useGameStore(s => s.setPhase);
  const developerMode = useGameStore(s => s.developerMode);
  const getEdited = useGameStore(s => s.getGeneralWithEdits);
  const readBlockedEdits = useGameStore(s => s.blockedEdits);
  const blocked = readBlockedEdits();
  // Subscribed only so the memo recomputes when the save file or the
  // permission level changes; the merge itself is getEdited's single path.
  const skillEdits = useGameStore(s => s.skillEdits);
  const generalEdits = useGameStore(s => s.generalEdits);
  const [showSkillEditor, setShowSkillEditor] = useState(false);
  const [tab, setTab] = useState<TabType>('将领');
  const [searchText, setSearchText] = useState('');
  const [factionFilter, setFactionFilter] = useState<Faction | '全部'>('全部');
  const [typeFilter, setTypeFilter] = useState<'全部' | '武将' | '文将'>('全部');
  const [skillTagFilter, setSkillTagFilter] = useState<SkillTag | '全部'>('全部');
  const [cardTypeFilter, setCardTypeFilter] = useState<'全部' | '粮草' | '材料' | '军备'>('全部');
  const [selectedGeneral, setSelectedGeneral] = useState<General | null>(null);
  const [selectedCard, setSelectedCard] = useState<GameCard | null>(null);

  // §H3: the viewer shows what the game actually assembles — the store's one
  // policy-filtered merge, not a fourth copy of the merge rules.
  const filteredGenerals = useMemo(() => {
    return allGenerals.map(g => getEdited(g)).filter(g => {
      if (factionFilter !== '全部' && g.faction !== factionFilter) return false;
      if (typeFilter !== '全部' && g.type !== typeFilter) return false;
      if (skillTagFilter !== '全部') {
        if (!g.skills.some(sk => sk.tag === skillTagFilter)) return false;
      }
      if (searchText) {
        const s = searchText.toLowerCase();
        return (
          g.name.toLowerCase().includes(s) ||
          g.faction.includes(s) ||
          g.skills.some(sk => sk.name.toLowerCase().includes(s)) ||
          g.skills.some(sk => sk.tag?.includes(s)) ||
          g.type.includes(s) ||
          String(g.hp).includes(s) ||
          String(g.meleeAtk).includes(s) ||
          String(g.rangedAtk).includes(s)
        );
      }
      return true;
    });
    // 编辑器在覆盖层里写存档、切权限，而 getEdited 的函数引用永不变——
    // 这三项是"这一页必须跟着刷新"的真实依赖，不是多余依赖。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchText, factionFilter, typeFilter, skillTagFilter, skillEdits, generalEdits, developerMode, getEdited]);

  const filteredCards = useMemo(() => {
    return allCards.filter(c => {
      if (cardTypeFilter !== '全部' && c.type !== cardTypeFilter) return false;
      if (searchText) {
        return c.name.toLowerCase().includes(searchText.toLowerCase()) ||
          c.type.includes(searchText);
      }
      return true;
    });
  }, [searchText, cardTypeFilter]);

  const factions: (Faction | '全部')[] = ['全部', '魏', '蜀', '吴', '群', '晋'];

  const factionCount = (f: Faction | '全部') =>
    allGenerals.map(g => getEdited(g)).filter(g =>
      (f === '全部' || g.faction === f) &&
      (typeFilter === '全部' || g.type === typeFilter) &&
      (skillTagFilter === '全部' || g.skills.some(sk => sk.tag === skillTagFilter))
    ).length;

  const typeCount = (t: '全部' | '武将' | '文将') =>
    allGenerals.map(g => getEdited(g)).filter(g =>
      (factionFilter === '全部' || g.faction === factionFilter) &&
      (t === '全部' || g.type === t) &&
      (skillTagFilter === '全部' || g.skills.some(sk => sk.tag === skillTagFilter))
    ).length;

  const tagCount = (t: SkillTag | '全部') =>
    allGenerals.map(g => getEdited(g)).filter(g =>
      (factionFilter === '全部' || g.faction === factionFilter) &&
      (typeFilter === '全部' || g.type === typeFilter) &&
      (t === '全部' || g.skills.some(sk => sk.tag === t))
    ).length;

  const cardTypeCount = (t: '全部' | '粮草' | '材料' | '军备') =>
    allCards.filter(c => t === '全部' || c.type === t).length;

  return (
    <div className="h-screen flex flex-col text-white overflow-hidden" style={{
      background: 'linear-gradient(135deg, #1a0a0a 0%, #2d1b0e 30%, #1a1a2e 70%, #0d0d1a 100%)',
    }}>
      {/* Header */}
      <div className="flex-shrink-0 flex items-center justify-between px-6 py-4 border-b border-amber-800/30">
        <button
          onClick={() => setPhase('menu')}
          className="text-amber-400 hover:text-amber-200 transition-colors flex items-center gap-2"
        >
          ← 返回主菜单
        </button>
        <h1 className="text-2xl font-bold text-amber-200 tracking-wider">📖 卡牌图鉴</h1>
        <div className="w-36 flex justify-end">
          {/* v2.8.8 N2 (§H8): the editor is reachable without developer mode —
              §H3 (地基刀2) is what keeps official cards read-only there, and
              the gold/white lock distinction only becomes observable on this
              surface. The store, not this button, is the enforcement point. */}
          <button
            onClick={() => setShowSkillEditor(true)}
            className="px-3 py-1.5 rounded-lg bg-purple-700/60 border border-purple-600/40 text-purple-200 text-sm font-bold hover:bg-purple-600/60 transition-all"
          >
            🛠️ 将领编辑器
          </button>
        </div>
      </div>

      {/* §H3: stopped-but-not-deleted official overlays are announced here,
          because this page is reachable without developer mode. */}
      {blocked.length > 0 && (
        <div className="flex-shrink-0 mx-6 mt-3 rounded-lg border border-red-800/40 bg-red-900/20 px-4 py-2 text-xs text-red-200">
          🚫 {denialMessage('OFFICIAL_READ_ONLY')}——{blocked.length} 处改动已停用、对局中不会生效（{[...new Set(blocked.map(b => b.name))].join('、')}）；原数据仍保留，进入开发者模式即可继续编辑。
        </div>
      )}

      {/* Tabs */}
      <div className="flex-shrink-0 flex gap-4 justify-center mt-4">
        {(['将领', '卡牌'] as TabType[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-8 py-2 rounded-lg font-bold transition-all ${
              tab === t
                ? 'bg-amber-600 text-white shadow-lg shadow-amber-600/30'
                : 'bg-amber-900/30 text-amber-300 hover:bg-amber-800/50'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Search & Filters */}
      <div className="flex-shrink-0 px-6 py-3 space-y-2">
        <div className="flex flex-wrap gap-3 items-center justify-center">
          <input
            type="text"
            value={searchText}
            onChange={e => setSearchText(e.target.value)}
            placeholder="搜索名称、技能、势力、标签..."
            className="px-4 py-2 rounded-lg bg-black/40 border border-amber-700/30 text-amber-100 placeholder-amber-600/50 w-64 focus:outline-none focus:border-amber-500"
          />
          
          {tab === '将领' && (
            <>
              <div className="flex gap-1">
                {factions.map(f => (
                  <button
                    key={f}
                    onClick={() => setFactionFilter(f)}
                    className={`px-3 py-1.5 rounded text-sm font-bold transition-all flex items-center gap-1.5 ${
                      factionFilter === f
                        ? 'text-white shadow-md'
                        : 'bg-black/30 text-gray-400 hover:text-white'
                    }`}
                    style={factionFilter === f ? {
                      backgroundColor: f === '全部' ? '#b45309' : factionColors[f],
                    } : {}}
                  >
                    <span>{f}</span>
                    {factionFilter === f && (
                      <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-black/40 text-[11px] font-black text-white/90">
                        {factionCount(f)}
                      </span>
                    )}
                  </button>
                ))}
              </div>
              <div className="flex gap-1">
                {(['全部', '武将', '文将'] as const).map(t => (
                  <button
                    key={t}
                    onClick={() => setTypeFilter(t)}
                    className={`px-3 py-1.5 rounded text-sm font-bold transition-all flex items-center gap-1.5 ${
                      typeFilter === t
                        ? 'bg-amber-700 text-white'
                        : 'bg-black/30 text-gray-400 hover:text-white'
                    }`}
                  >
                    <span>{t}</span>
                    {typeFilter === t && (
                      <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-black/40 text-[11px] font-black text-white/90">
                        {typeCount(t)}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </>
          )}

          {tab === '卡牌' && (
            <div className="flex gap-1">
              {(['全部', '粮草', '材料', '军备'] as const).map(t => (
                <button
                  key={t}
                  onClick={() => setCardTypeFilter(t)}
                  className={`px-3 py-1.5 rounded text-sm font-bold transition-all flex items-center gap-1.5 ${
                    cardTypeFilter === t
                      ? 'bg-amber-700 text-white'
                      : 'bg-black/30 text-gray-400 hover:text-white'
                  }`}
                >
                  <span>{t}</span>
                  {cardTypeFilter === t && (
                    <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-black/40 text-[11px] font-black text-white/90">
                      {cardTypeCount(t)}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Skill tag filter row - only for 将领 tab */}
        {tab === '将领' && (
          <div className="flex gap-1 items-center justify-center">
            <span className="text-[10px] text-amber-500/50 mr-1">技能标签:</span>
            <button
              onClick={() => setSkillTagFilter('全部')}
              className={`px-2.5 py-1 rounded text-[11px] font-bold transition-all ${
                skillTagFilter === '全部' ? 'bg-amber-700/80 text-white' : 'bg-black/30 text-gray-500 hover:text-white'
              }`}
            >
              全部
              {skillTagFilter === '全部' && (
                <span className="ml-1 inline-flex items-center justify-center min-w-[16px] h-[16px] px-0.5 rounded-full bg-black/40 text-[10px] font-black">
                  {tagCount('全部')}
                </span>
              )}
            </button>
            {allSkillTags.map(t => (
              <button
                key={t}
                onClick={() => setSkillTagFilter(t)}
                className={`px-2.5 py-1 rounded text-[11px] font-bold transition-all flex items-center gap-1 ${
                  skillTagFilter === t ? 'text-white' : 'bg-black/30 text-gray-500 hover:text-white'
                }`}
                style={skillTagFilter === t ? {
                  backgroundColor: skillTagColors[t],
                } : {
                  borderColor: skillTagColors[t] + '30',
                }}
              >
                <span>{t}</span>
                {skillTagFilter === t && (
                  <span className="inline-flex items-center justify-center min-w-[16px] h-[16px] px-0.5 rounded-full bg-black/40 text-[10px] font-black">
                    {tagCount(t)}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 pb-8" style={{ scrollbarGutter: 'stable' }}>
        {tab === '将领' && (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
            {filteredGenerals.map(g => (
              <GeneralCard key={g.id} general={g} onClick={() => setSelectedGeneral(g)} />
            ))}
            {filteredGenerals.length === 0 && (
              <p className="col-span-full text-center text-amber-500/50 py-20">未找到匹配的将领</p>
            )}
          </div>
        )}

        {tab === '卡牌' && (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
            {filteredCards.map(c => (
              <CardItem key={c.id} card={c} onClick={() => setSelectedCard(c)} />
            ))}
            {filteredCards.length === 0 && (
              <p className="col-span-full text-center text-amber-500/50 py-20">未找到匹配的卡牌</p>
            )}
          </div>
        )}
      </div>

      {/* General Detail Modal */}
      {selectedGeneral && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50"
          onClick={() => setSelectedGeneral(null)}>
          <div className="bg-gradient-to-b from-gray-900 to-black border border-amber-600/50 rounded-xl p-6 max-w-md w-full mx-4"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: factionColors[selectedGeneral.faction] }} />
              <span className="text-sm font-bold px-2 py-0.5 rounded"
                style={{ backgroundColor: factionColors[selectedGeneral.faction] + '30', color: factionColors[selectedGeneral.faction] }}>
                {selectedGeneral.faction}
              </span>
              <span className="text-amber-400 text-sm">{selectedGeneral.type}</span>
            </div>
            <h2 className="text-3xl font-black text-amber-200 mb-1">{selectedGeneral.name}</h2>
            {selectedGeneral.title && (
              <p className="text-amber-500/70 text-sm mb-4">{selectedGeneral.title}</p>
            )}
            
            <div className="grid grid-cols-2 gap-3 mb-4">
              <StatBox label="体力" value={selectedGeneral.hp} icon="❤️" />
              <StatBox label="近战攻击" value={selectedGeneral.meleeAtk} icon="⚔️" />
              <StatBox label="远程攻击" value={selectedGeneral.rangedAtk} icon="🏹" />
              <StatBox label="护甲" value={selectedGeneral.armor} icon="🛡️" tip="每 2 点护甲抵消 1 点伤害；单数护甲挡不下这一刀，会原样留在身上" />
            </div>
            
            <div className="mt-4">
              <h3 className="text-amber-400 font-bold mb-2">技能</h3>
              <div className="flex flex-col gap-2">
                {selectedGeneral.skills.map((s, i) => (
                  <div key={i} className="rounded-lg bg-amber-900/40 text-amber-200 text-sm border border-amber-700/30 px-3 py-1.5">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-bold">{s.name}</span>
                      {s.tag && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full font-bold border"
                          style={{ color: skillTagColors[s.tag], borderColor: skillTagColors[s.tag] + '50', backgroundColor: skillTagColors[s.tag] + '15' }}>
                          {s.tag}
                        </span>
                      )}
                    </div>
                    {s.description && <p className="text-amber-300/60 text-xs mt-1">{s.description}</p>}
                  </div>
                ))}
              </div>
            </div>
            
            <button
              onClick={() => setSelectedGeneral(null)}
              className="mt-6 w-full py-2 rounded-lg bg-amber-700 hover:bg-amber-600 text-white font-bold transition-colors"
            >
              关闭
            </button>
          </div>
        </div>
      )}

      {/* Card Detail Modal */}
      {selectedCard && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50"
          onClick={() => setSelectedCard(null)}>
          <div className="bg-gradient-to-b from-gray-900 to-black border border-amber-600/50 rounded-xl p-6 max-w-sm w-full mx-4"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-2 mb-3">
              <span className="text-2xl">{getCardIcon(selectedCard.type)}</span>
              <span className="px-2 py-0.5 rounded text-sm font-bold bg-amber-800/50 text-amber-300">
                {selectedCard.type}
              </span>
            </div>
            <h2 className="text-2xl font-black text-amber-200 mb-3">{selectedCard.name}</h2>
            <p className="text-amber-100/70 text-sm">{selectedCard.description}</p>
            <button
              onClick={() => setSelectedCard(null)}
              className="mt-6 w-full py-2 rounded-lg bg-amber-700 hover:bg-amber-600 text-white font-bold transition-colors"
            >
              关闭
            </button>
          </div>
        </div>
      )}

      {showSkillEditor && <SkillEditor onClose={() => setShowSkillEditor(false)} />}
    </div>
  );
}

function GeneralCard({ general, onClick }: { general: General; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="group relative rounded-lg border overflow-hidden transition-all duration-300 hover:scale-105 hover:shadow-xl text-left"
      style={{
        borderColor: factionColors[general.faction] + '60',
        background: `linear-gradient(180deg, ${factionColors[general.faction]}15 0%, #00000080 100%)`,
      }}
    >
      <div className="p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-bold px-1.5 py-0.5 rounded"
            style={{ backgroundColor: factionColors[general.faction] + '40', color: factionColors[general.faction] }}>
            {general.faction}
          </span>
          <span className="text-xs text-amber-400">{general.type}</span>
        </div>
        
        <div className="text-center py-3">
          <div className="text-4xl mb-1">{general.type === '武将' ? '⚔️' : '📜'}</div>
          <h3 className="text-lg font-black text-amber-100 group-hover:text-amber-200 transition-colors">
            {general.name}
          </h3>
          {general.title && (
            <p className="text-xs text-amber-500/50 mt-0.5">{general.title}</p>
          )}
        </div>
        
        <div className="flex justify-between text-xs text-amber-300/70 mt-2">
          <span>❤️{general.hp}</span>
          <span>⚔️{general.meleeAtk}</span>
          <span>🏹{general.rangedAtk}</span>
        </div>
        
        <div className="flex flex-wrap gap-1 mt-2">
          {general.skills.slice(0, 3).map((s, i) => (
            <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-black/40 text-amber-300/80 flex items-center gap-0.5">
              {s.name}
              {s.tag && (
                <span className="text-[8px] px-1 rounded-full font-bold"
                  style={{ color: skillTagColors[s.tag], backgroundColor: skillTagColors[s.tag] + '20' }}>
                  {s.tag}
                </span>
              )}
            </span>
          ))}
          {general.skills.length > 3 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-black/40 text-amber-500/50">
              +{general.skills.length - 3}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

function CardItem({ card, onClick }: { card: GameCard; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="group rounded-lg border border-amber-800/30 overflow-hidden transition-all duration-300 hover:scale-105 hover:border-amber-500/50 text-left"
      style={{
        background: `linear-gradient(180deg, ${getCardColor(card.type)}15 0%, #00000080 100%)`,
      }}
    >
      <div className="p-3">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-lg">{getCardIcon(card.type)}</span>
          <span className="text-xs font-bold px-1.5 py-0.5 rounded"
            style={{ backgroundColor: getCardColor(card.type) + '30', color: getCardColor(card.type) }}>
            {card.type}
          </span>
        </div>
        <div className="text-center py-4">
          <div className="text-3xl mb-2">{getCardIcon(card.type)}</div>
          <h3 className="text-base font-bold text-amber-100 group-hover:text-amber-200">
            {card.name}
          </h3>
        </div>
      </div>
    </button>
  );
}

function StatBox({ label, value, icon, tip }: { label: string; value: number; icon: string; tip?: string }) {
  return (
    <div title={tip} className="bg-black/40 rounded-lg p-3 border border-amber-800/20">
      <div className="flex items-center gap-1 text-amber-400/70 text-xs mb-1">
        <span>{icon}</span>
        <span>{label}</span>
      </div>
      <p className="text-2xl font-black text-amber-100">{value}</p>
    </div>
  );
}

function getCardIcon(type: string): string {
  switch (type) {
    case '粮草': return '🌾';
    case '材料': return '⛏️';
    case '军备': return '🛡️';
    default: return '🃏';
  }
}

function getCardColor(type: string): string {
  switch (type) {
    case '粮草': return '#22c55e';
    case '材料': return '#3b82f6';
    case '军备': return '#ef4444';
    default: return '#eab308';
  }
}
