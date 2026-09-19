import { useGameStore } from '../store/gameStore';
import { useEffect } from 'react';

export default function Rules({ onBack }: { onBack?: () => void }) {
  const setPhase = useGameStore(s => s.setPhase);
  useEffect(() => {
    if (!onBack) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onBack();
      }
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [onBack]);
  return (
    <div className="min-h-screen overflow-y-auto text-white" style={{
      background: 'linear-gradient(135deg, #1a0a0a 0%, #2d1b0e 30%, #1a1a2e 70%, #0d0d1a 100%)',
    }}>
      <div className="mx-auto max-w-4xl px-5 py-6 sm:px-8">
        <button onClick={onBack ?? (() => setPhase('menu'))} className="mb-6 text-amber-400 hover:text-amber-200">
          ← 返回{onBack ? '对局' : '主菜单'}
        </button>
        <h1 className="mb-2 text-3xl font-black text-amber-200">📜 游戏规则</h1>
        <p className="mb-8 text-sm text-amber-100/60">这是当前版本已经确认的基本玩法。</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Rule title="游戏流程">
            大厅 → 骰子排序 → 分配势力 → 征召将领 → 初始抽牌 → 准备 → 正式回合。
          </Rule>
          <Rule title="玩家与势力">
            支持 2～4 名玩家。主势力为魏、蜀、吴、晋；群势力可作为将领来源，但不能作为主势力。
          </Rule>
          <Rule title="抽牌">
            开局每人 5 张手牌。第一轮开始时，第一名玩家抽 0 张，其他玩家各抽 1 张；第二轮开始后，每名玩家抽 5 张。
          </Rule>
          <Rule title="将领与行动">
            将领登场需要消耗手牌。文将移动需要消耗 1 张手牌；攻击需要消耗 1 张手牌。将领击破后，击破方补抽 1 张。
          </Rule>
          <Rule title="营地与失败">
            营地和前线各有 3 个位置。本营初始 6 点生命，每次普通伤害最多 1 点；本营归零后，该玩家出局并交给下一名存活玩家继续游戏。
          </Rule>
          <Rule title="补给与军备">
            补给可以恢复将领生命；敌方区域补给需要额外消耗 1 张手牌。军备牌可以叠加到将领身上，抵挡伤害。
          </Rule>
          <Rule title="移动">
            从战场移动时，即使只有一个方向，也必须先选择目标，并且可以取消；营地和前线只有一个合法方向时可以直接继续。
          </Rule>
          <Rule title="将领类型">
            武将默认近战较强，文将默认远程较强。相同名称的将领仍是不同的实体，不能混为同一张牌。
          </Rule>
        </div>
      </div>
    </div>
  );
}

function Rule({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-amber-800/30 bg-black/25 p-4">
      <h2 className="mb-2 font-bold text-amber-300">{title}</h2>
      <p className="text-sm leading-7 text-amber-50/75">{children}</p>
    </section>
  );
}
