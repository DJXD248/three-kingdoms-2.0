/**
 * J2 客人端呈现契约（v2.9.2 第二刀）。
 *
 * 房主算牌，客人只是"看见同一局"。今天 EngineState 里手牌、将领池、牌堆顺序
 * 全量常驻（界面只是没画出来），所以**整份局面绝不能直接发**——那等于把别人
 * 的手牌与牌堆顺序一起送过去。这一层把"该发什么"定成字段级白名单：
 *
 *  - 公开的事实照发：谁在场上、剩多少体力、轮到谁、第几回合、弃牌堆、墓地、
 *    状态、数值修正器账本（不发它客人的体力上限读数会和房主算出两个数）。
 *  - 私有的内容只发**数量**：手牌／将领池／牌堆顺序／护甲牌实例 ⇒ 长度保留、
 *    内容一律换成 {@link HIDDEN_MARKER}。
 *  - 引擎自己的随机游标（rngState）绝不发：收到快照的一方若能推进它，就等于
 *    预先知道后面抽到什么。
 *  - 待答的选择／响应问答（pendingChoice／pendingReaction）绝不发：那两格里
 *    存的是开窗那一刻**已翻译好的效果**，其中可能点名牌堆顶的牌（2.6.3／
 *    v2.8.22 的延后结算契约）。客人动手本来就是 J4，这一刀不需要它们。
 *
 * 输出仍是一个**形状合法的 EngineState**（{@link isRestorableEngineState} 读得通），
 * 这样 J4 接座位时不用换协议，只把"该遮的"改成"属于我的那一格"。
 */
import type { EnginePlayer, EngineState, EngineStatusState } from '../core/GameState';
import type { StatModifier } from '../core/statModifiers';

/** 被遮掉的那一格长什么样：只留下"这里确实有一张／一员"这个事实。 */
export const HIDDEN_MARKER = Object.freeze({ hidden: true });

/** 只有房主那台机器能算出下一张是什么 ⇒ 随机游标永不上线。 */
export const NEVER_SENT_TOP_LEVEL = ['rngState', 'pendingChoice', 'pendingReaction'] as const;

/** 席位是不是 AI 对客人是公开的（牌桌显示 🤖），但"哪一档 AI"属于房主自己的配置 ⇒ 不发。 */
const PUBLIC_PLAYER_KEYS = [
  'id', 'name', 'faction', 'seatOrder', 'diceRoll', 'hp', 'baseHp', 'baseMaxHp',
  'isAlive', 'isSpectating', 'isAi', 'avatarGeneral',
] as const;

/** aiTier 是房主的席位配置，不是牌面信息，但也不影响"看见同一局"⇒ 不发。 */
const PUBLIC_METADATA_KEYS = ['winnerId', 'roomId'] as const;

function maskCount(value: unknown): unknown[] {
  const length = Array.isArray(value) ? value.length : 0;
  return Array.from({ length }, () => HIDDEN_MARKER);
}

/** 状态里只有 kind/duration/stacks 是场面事实；metadata 是各条规则自带的口袋，
 *  里面可能塞着卡牌引用 ⇒ 一律不发。 */
function maskStatus(status: EngineStatusState): EngineStatusState {
  return {
    id: status.id,
    kind: status.kind,
    duration: status.duration ?? null,
    stacks: status.stacks ?? 1,
  };
}

/** 场上的将领是公开的（谁都在看着战场），唯独"身上贴了哪几张军备"是私有实例。 */
function maskFieldGeneral(value: unknown): unknown {
  if (!value || typeof value !== 'object') return HIDDEN_MARKER;
  const fg = value as Record<string, unknown>;
  return {
    general: fg.general,
    ownerId: fg.ownerId,
    position: fg.position,
    currentHp: fg.currentHp,
    maxHp: fg.maxHp,
    meleeAtk: fg.meleeAtk,
    rangedAtk: fg.rangedAtk,
    armor: fg.armor,
    currentArmor: fg.currentArmor,
    isArming: fg.isArming,
    hasMoved: fg.hasMoved,
    hasAttacked: fg.hasAttacked,
    hasSupplied: fg.hasSupplied,
    justDeployed: fg.justDeployed,
    armorCards: maskCount(fg.armorCards),
  };
}

function maskPlayer(player: EnginePlayer): EnginePlayer {
  const masked: Record<string, unknown> = {};
  for (const key of PUBLIC_PLAYER_KEYS) {
    if (player[key] !== undefined) masked[key] = player[key];
  }
  masked.hand = maskCount(player.hand);
  masked.generalPool = maskCount(player.generalPool);
  masked.fieldGenerals = (Array.isArray(player.fieldGenerals) ? player.fieldGenerals : [])
    .map(maskFieldGeneral);
  masked.graveyard = Array.isArray(player.graveyard) ? player.graveyard : [];
  masked.statuses = (Array.isArray(player.statuses) ? player.statuses : []).map(maskStatus);
  return masked as unknown as EnginePlayer;
}

export function buildBroadcastView(state: EngineState): EngineState {
  const metadata: Record<string, unknown> = {};
  for (const key of PUBLIC_METADATA_KEYS) {
    if (state.metadata?.[key] !== undefined) metadata[key] = state.metadata[key];
  }

  const view: EngineState = {
    version: state.version,
    phase: state.phase,
    timelinePhase: state.timelinePhase,
    players: state.players.map(maskPlayer),
    currentPlayerId: state.currentPlayerId,
    turn: state.turn,
    round: state.round,
    deck: maskCount(state.deck),
    discardPile: Array.isArray(state.discardPile) ? state.discardPile : [],
    metadata,
    drawState: state.drawState ?? null,
    isFirstTurn: state.isFirstTurn,
    consumedSkills: state.consumedSkills,
    statModifiers: state.statModifiers as StatModifier[] | undefined,
  };
  return view;
}

/** 遮蔽后仍有"这一格有多少张"⇒ 客人的读数靠它，而内容永不上线。 */
export function hiddenCount(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}
