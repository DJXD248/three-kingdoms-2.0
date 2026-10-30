/**
 * 联机切片⑤·腿1（㈢ 演出刀，v2.9.25）：开局那一段"现在走到哪一步、那一步的数定下来没有"那一笔账。
 *
 * 用户 2026-10-30 那句逐字＝「开始掷骰后进入掷骰画面（骰子滚动）主机先走定下数据（骰子停下），
 * 把数据传给客人，客人画面变动（骰子停下），分势力和征召同理」⇒ 这一格要的是**客人侧的读数**，
 * 不是第二条真相。所以本刀**一个新信封也不加**（现场读的，不是推测）：
 *  ㈠ 房主那台机器每次 store 变化都会重算一份 `engineState`（`store/engineAwareSetter.ts:20-27`
 *    ——补丁里没写 `engineState` 就现算一份），而那份局面的 `phase` 取自 store 的阶段名
 *    （`store/gameStateAdapter.ts:80`：`phase: store.phase ?? 'menu'`）⇒ **"房主走到哪一步"本来就贴在快照上**；
 *  ㈡ 每一席的骰子点数、座次与势力都在公开白名单里（`network/snapshotView.ts:43-46` 的
 *    `diceRoll`／`seatOrder`／`faction`）⇒ **第几步与那一步定下的数在同一条消息里一起到**，
 *    不会出现"步数先到、数还没到"那种两格各说一套的场面。
 * 这一格因此只回答那两句话，不算牌、不改局面、也不替客人摇一颗自己的骰子：
 * 「以收到的值定格」＝没收到就写"还没定"，绝不画一个数上去（画出来的必须是收到的那个）。
 *
 * ⚠️ 两句如实边界，界面与登记都不许美化：
 * ① **迟到或重连的人直接落定**：他拿到的是房主当下那一份（`components/NetRoomBridge.tsx:123`
 *    在名册变化时 `bc?.flush()`），那些数早就定了 ⇒ 这一格不回放"滚动"那一段，也不许为了好看先画假点数。
 * ② 线上的 `phase` 是个自由字符串（`core/GameState.ts:52`）。这里认不出来的值一律当作
 *    "开局那一段现在没话要说"——两边的应用版本必须逐字相同才连得上（`versionMismatch`），
 *    所以真能出现的陌生值只有 `menu`／`codex`／`settings`／`createRoom`／`lobby`／`rules`／`testArena`
 *    那几格界面态，它们都不是开局那一段。
 */

/** 开局那一段的五档读数（`none`＝这一段现在没话要说；`play`＝这一段已经走完）。 */
export type NetSetupStep = 'none' | 'dice' | 'faction' | 'draft' | 'play';

/**
 * 一席的开局读数。**只有这五个字段**：座次、称呼、骰子、势力、座次序号。
 * 手牌、征召池、候选名单一概不进这一格（它们要么是私有内容，要么住在别的那几格线上）。
 */
export type NetOpeningRow = {
  seat: number;
  name: string;
  /** 收到的点数；`null`＝房主那边这一颗还没掷（或掷出来的不是一个可用的数）。 */
  roll: number | null;
  /** 收到的势力；`null`＝还没分到。 */
  faction: string | null;
  /** 房主算好的入座次序（0＝先坐）；`null`＝这一格没带上来。 */
  seatOrder: number | null;
};

export type NetOpening = { step: NetSetupStep; rows: NetOpeningRow[] };

/** store 的阶段名→这一段第几步。没列在这里的那些＝这一格没话要说（见文件头那句②）。 */
const STEP_BY_PHASE: Record<string, NetSetupStep> = {
  diceRoll: 'dice',
  factionAssign: 'faction',
  generalDraft: 'draft',
  drawing: 'play',
  playing: 'play',
  gameOver: 'play',
};

export function setupStepOf(phase: unknown): NetSetupStep {
  return STEP_BY_PHASE[typeof phase === 'string' ? phase : ''] ?? 'none';
}

/**
 * 掷过一颗没有＝点数至少是 1，而且必须是个整数。那两个数不是猜的：开局前那一格写的是 `0`
 * （`setup/runtimeSetup.ts:83`），12 面骰掷出来的是 `Math.floor(random()*12)+1`＝1-12（`:105`）
 * ⇒ 0、非整数、不是数都读成"还没定"，而不是"掷出了 0 点"或"掷出了 2.5 点"。
 * ⚠️ 这里**不**封顶到 12：这一层管的是"这颗掷过没有"，骰子有几面是房主那台机器的规则，
 * 把 12 写死的话，将来换一面骰子就会让真读数被当成"还没定"——那是更坏的一种假话。
 */
function rollOf(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;
}

function factionOf(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** 座次序从 0 起算（0＝先坐），所以 0 是一个真读数，不能当成"没带上来"。 */
function orderOf(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

/**
 * 把收到的那份局面读成开局那一段的读数。
 * 输入是客人已经采纳的那一份遮蔽快照（`netRoom` 里那一格），这一格只读五个字段、
 * 别的一个都不碰——所以别人那几席的手牌与牌堆顺序在这张表里没有落点。
 */
export function openingOf(state: unknown): NetOpening {
  const players = (state as { players?: unknown } | null)?.players;
  const step = setupStepOf((state as { phase?: unknown } | null)?.phase);
  if (!Array.isArray(players)) return { step: 'none', rows: [] };
  const rows = players
    .map((p) => {
      const o = (p ?? {}) as Record<string, unknown>;
      return {
        seat: Number(o.id),
        name: String(o.name ?? ''),
        roll: rollOf(o.diceRoll),
        faction: factionOf(o.faction),
        seatOrder: orderOf(o.seatOrder),
      };
    })
    .filter((row) => Number.isFinite(row.seat))
    // 席位号从小到大，与席位表／征召进度表同一把尺（两张表并排看不会数反）。
    .sort((a, b) => a.seat - b.seat);
  return { step, rows };
}

/** 这一桌的骰子是否全定了（定了才可以说"骰子停下"）。空桌算没定。 */
export function diceAllSettled(rows: readonly NetOpeningRow[]): boolean {
  return rows.length > 0 && rows.every((row) => row.roll !== null);
}

/** 势力是不是都分到了（有席还没分到就还是"等那一份读数"）。 */
export function factionsAllAssigned(rows: readonly NetOpeningRow[]): boolean {
  return rows.length > 0 && rows.every((row) => row.faction !== null);
}
