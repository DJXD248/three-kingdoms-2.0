import pkg from '../../package.json';
import { NETWORK_SNAPSHOT_VERSION } from './StateSerializer';
import { randomBytes } from './netRandom';

/** 换协议格式就抬这个数：两端不一致 ⇒ 明确拒接，绝不静默半连。 */
export const NET_PROTOCOL_VERSION = 1;

const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 去掉易混的 I O 0 1
const ROOM_CODE_LENGTH = 6;
const MAX_ROOM_CODE_LENGTH = 10;
export const MAX_WIRE_BYTES = 512 * 1024;
export const MAX_NAME_LENGTH = 12;

export type VersionStamp = { app: string; proto: number; snapshot: number };
export type NetPeer = { id: string; name: string; role: 'host' | 'guest' };
/** J3 连线表里的一行：房主算出来的，客人只是照抄显示（判定权不在客人手里）。 */
export type NetLinkState = 'online' | 'lost';
export type NetLinkRow = { id: string; name: string; pingMs: number | null; state: NetLinkState };
/** J4 席位表里的一行：哪一席（引擎的 playerId）交给哪个人。`peer:null`＝这一席现在没人，
 *  由房主那台机器自己点（或本来就是 AI 席）。名单只有房主能发，客人照抄。 */
export type NetSeatRow = { peer: string | null; seat: number; name: string };
/** J4 清单里的一条：房主当场算出来的"这一席现在能走的一步"。
 *  线上只走编号与人读的那句话，**动作本体绝不上线**。 */
export type NetMoveItem = { key: string; label: string };
/**
 * 联机切片⑤a（v2.9.25）准备表里的一行：**这一位客人**准备到哪儿了。
 * `on`＝他点没点；`counted`＝房主还等不等他。两个数分开是有原因的：
 * 用户 2026-10-30 那句「客人中途退掉／掉线⇒闸门重算（不许出现"永远等一个已经不在的人"）」
 * 说的是"别把不在场的人算进分母"，而不是"把那一行抹掉"——那一行还得留在桌上让人看见他掉了。
 * 表里只有客人：房主自己那一席不等谁准备（他那颗钮就是开始游戏）。
 */
export type NetReadyRow = { peer: string; name: string; on: boolean; counted: boolean };
/**
 * 联机切片⑤b（v2.9.25）征召进度表里的一行：**这一席**征召到哪儿了。
 * 用户 2026-10-30 裁死了这张表能说什么：「和热座一样」**不**延伸到别人那几格的私有信息⇒
 * 别席的候选牌永不上线，客人看得见的只有进度那一行话（「第 2 席正在征召（已选 7/10）」）。
 * 所以这里一个牌名、一个档案号都没有：`seat`＋人读的名字＋三个数。
 * `seat`＝引擎的 playerId（与席位表同一个口径，绝不另立一套座次）。
 */
export type NetDraftState = 'waiting' | 'picking' | 'done';
export type NetDraftProgressRow = { seat: number; name: string; state: NetDraftState; picked: number; total: number };
/**
 * 联机切片⑤c（v2.9.25）候选名单里的一张牌——**指名发给那一席本人的那一份**。
 * 用户 2026-10-30 的口径逐字是：「每个玩家只能看到自己的候选将领和已选将领，而不是能看到全部」
 * ⇒ 牌面可以上线，但一帧只装一个席位的那一格（别席一个字节都不进，判据见 `netDraftListPrivacy.test.ts`）。
 *
 * 这里**没有 `id`**（档案号）：客人往后交回"我要勾哪一颗"用的是这张名单上的位置编号 `key`，
 * 房主拿同一个规则把自己发过的那格查回来——绝不采信客人发来的将名（ARCH_MAP 第 7 条㈢）。
 * 装的就是那张卡画得出来的几样（对照 `components/GeneralDraft.tsx`：类型图标＋将名＋三行点数＋技能名一排）；
 * 护甲、身份、来源那些格界面上不画，也就一个都不上线。
 */
export type NetDraftItem = {
  key: string;
  name: string;
  faction: string;
  type: string;
  hp: number;
  meleeAtk: number;
  rangedAtk: number;
  skills: string[];
};
/** 指名发给某一席的那一整帧：他自己那一格的两份名单、他勾了哪几颗、以及这一席该做什么的那句人话。 */
export type NetDraftListFrame = {
  seat: number;
  total: number;
  instruction: string;
  main: NetDraftItem[];
  qun: NetDraftItem[];
  picked: string[];
};

/** 往返耗时的可信上限：超过就当没量到（对面时钟被改、或攒了很久的一条回话）。 */
export const MAX_TRUSTED_PING_MS = 600_000;
export const MAX_SEAT_ROWS = 8;
/** 准备表的行数上界＝名册上界（`roster` 那条也封顶 8）：一行都多不出来。 */
export const MAX_READY_ROWS = 8;
export const MAX_MOVE_ITEMS = 32;
/** 封顶后"还有多少步没列出"的可信上界：合法集现实中到不了这个数，超过即坏消息。 */
export const MAX_OMITTED_MOVES = 10_000;
/** 编号／句子／退回说明各自的线上上界（界面与判据都读这三个数收口，别各写一份）。 */
export const MAX_MOVE_KEY_LENGTH = 64;
export const MAX_MOVE_LABEL_LENGTH = 60;
export const MAX_REFUSAL_LENGTH = 120;
/** 征召进度表的行数上界＝一桌的席位上界（与 `MAX_SEAT_ROWS` 同一个数、同一个理由：多出来的行没有椅子坐）。 */
export const MAX_DRAFT_PROGRESS_ROWS = 8;
/** 已选／应选两个数的线上上界：正常征召到不了这个数，超过即坏消息（与 `MAX_OMITTED_MOVES` 同一口径）。
 *  这里**不**要求 `picked <= total`——已完成那一行的 `picked` 直接取自那一席的征召池长度，
 *  沙盒与测试工具能把它填成任何数；宁可多显示一个真实的怪数，不可把一帧真话判成假消息。 */
export const MAX_DRAFT_PICK_COUNT = 1000;
/**
 * 切片⑤c 那一格的两个上界。`MAX_DRAFT_ITEMS` 比生产者实际给得出的最大数还宽：
 * 房主那台机器上一席的候选是 10 张本势力＋5 张群（`setup/runtimeSetup.ts:166,179`）＝15 张，
 * 这里放到 32 是留给"以后候选面变宽"，而**超过就整帧拒**、不截断——
 * 截断会让客人以为自己看到的就是全部（与 `moves` 那条用 `omitted` 说清"还有几条没列出来"是两种做法：
 * 征召名单是这一席动手的唯一依据，少一张牌就选不成那一套 10 名，所以宁可拒）。
 * 将名与技能名跟着「人读句子」那个上界（`MAX_MOVE_LABEL_LENGTH`）而不是席位名的 12 个字：
 * DIY 将名那一格没有 12 个字的闸，拿席位名的尺去量牌名会把一帧真话判成坏消息。
 */
export const MAX_DRAFT_ITEMS = 32;
/** 一张卡下面那一排技能名的小格数上界（同一判据：超了就是坏消息，不是"少画两个"）。 */
export const MAX_DRAFT_SKILLS = 12;
/** 卡面三行数各自的线上上界：与 `MAX_DRAFT_PICK_COUNT` 同一口径（宁可多画一个真实的怪数，不把一帧真话判成假消息）。 */
export const MAX_DRAFT_STAT_VALUE = 1000;
/** 「这一席该做什么」那句话的线上上界：它是一句人话，长度与退回说明同一档（界面上是一行，不是一段）。 */
export const MAX_DRAFT_INSTRUCTION_LENGTH = 120;
/**
 * 联机切片⑥（v2.9.25）：身份号进握手网址第二段时允许的字符。
 * 它比解析器里那条 `isId`（非空、≤64 个字符）**严**，严出来的不是协议、是路：
 * 这一串要走在 URL 路径里，所以只能用百分号编码之外也不会变形的字符。
 * `netRandom.ts` 那两种号（`crypto.randomUUID` 的十六进制＋短横、兜底号的 `p`＋数字＋短横）天然满足，
 * 这条约束在 `netRandom.test.ts` 里有证人——改了随机源的字母表会当场红，而不是等连不上时才查。
 * ⚠️ `scripts/net-relay.mjs` 里抄了同一个形状（那个文件必须零依赖、不能 import 这里）：
 * 两处不一致的表现是"这边发得出去、那边拒握手"， loud 且不静默。
 */
export const PEER_ID_URL_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** 席位号就是引擎的 playerId；给个硬上界免得一个荒谬的数钻进界面。 */
function isSeatNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 64;
}

export type NetEnvelope =
  | { t: 'hello'; from: string; name: string; v: VersionStamp }
  | { t: 'welcome'; from: string; to: string; name: string; v: VersionStamp }
  | { t: 'refuse'; from: string; to: string; reason: string }
  | { t: 'roster'; from: string; peers: NetPeer[] }
  /** J2：房主每次局面变化后发的一份**已遮蔽**快照。协议层只当它是未知对象——
   *  看懂它是快照层的事（`isRestorableEngineState` 在客人端把关）。
   *  切片③（v2.9.25）多了一个可选的 `to`＝"这一份是算给哪一位的"：按席位各出私有视图后，
   *  指名发给别人的那一份，收信人不采纳（心跳记账照旧刷新）。不带 `to`＝全桌通用那份
   *  （观战面），也是切片③之前唯一存在的那一份 ⇒ 老形状照样能用。 */
  | { t: 'snapshot'; from: string; to?: string; state: Record<string, unknown> }
  /** J3：房主探测某个连接。`at`＝房主自己那台机器的发出时刻，客人**原样抄回来**，
   *  往返耗时由房主算——全程只用房主一个时钟，绝不去比两边的表。 */
  | { t: 'ping'; from: string; to: string; at: number }
  | { t: 'pong'; from: string; to: string; at: number }
  /** J3：房主算出来的那张连线表，随探测广播给全桌⇒所有人看同一张表。 */
  | { t: 'netstatus'; from: string; rows: NetLinkRow[] }
  /** J4：房主宣布"哪一席坐的是谁"。全桌广播（客人要知道自己坐哪一席，也要知道别人在动哪一席）。 */
  | { t: 'seatmap'; from: string; seats: NetSeatRow[] }
  /** J4：房主当场算给**某一席**的那张"现在能走哪些步"清单。
   *  空清单是一句真话（这一席此刻一步也走不了），所以 items 允许为空。
   *  `omitted`＝被封顶挤掉的条数（一桌人多时合法集能上百条，线上与界面都装不下）：
   *  界面要照这个数字说一句真话，别让客人以为自己看到的就全部。 */
  | { t: 'moves'; from: string; to: string; seat: number; items: NetMoveItem[]; omitted: number }
  /** J4：客人交回来的一步——只有席位与编号，没有任何牌面内容。
   *  房主拿它去对自己**当场重算**的那张清单，对得上才走。 */
  | { t: 'act'; from: string; to: string; seat: number; key: string }
  /** J4：房主没让走这一步，附一句人读的原因（界面原文显示，不二次加工）。 */
  | { t: 'actno'; from: string; to: string; key: string; reason: string }
  /** 切片⑤a：客人交回的那一颗准备钮——只有"我"与"点没点"，别的什么都不带。
   *  这里不判合法性：他点没点对房主那台机器而言只是个事实，闸门算的是**谁还算数**。 */
  | { t: 'ready'; from: string; to: string; on: boolean }
  /** 切片⑤a：房主算给全桌的那张准备表（客人照抄，跟席位表一个纪律：不自算第二遍）。
   *  与 netstatus／seatmap 那两张不同，**空表在这里是一句真话**＝屋里一个客人都没有，
   *  因此没有人在等，闸门开着。 */
  | { t: 'readytable'; from: string; rows: NetReadyRow[] }
  /**
   * 切片⑤b：房主算给全桌的那张征召进度表（客人照抄，与准备表／席位表同一个纪律）。
   * 全桌广播、不指名：它说的只有"每一席走到哪儿了"，没有一张牌——指名发给某一席的那条路
   * 是征召问答通道，用户 2026-10-30 明令**这一版不许建**（等外部评审二检）。
   * 表在征召那一段之外没有话要说⇒房主那时一格也不发；这一格因此不存在"空表"这种形状，
   * 与 netstatus／seatmap 一样把空表当坏消息拒掉。
   */
  | { t: 'draftprogress'; from: string; rows: NetDraftProgressRow[] }
  /**
   * 切片⑤c：房主算给**正在征召那一席本人**的那一格候选名单（＋他勾了哪几颗＋这一席该做什么的那句人话）。
   *
   * `to` 在类型里**必填**，不是可选：这一帧装的是私有信息，而传话程序那一侧（切片⑥）的形状是
   * 「写了收件人的只投那一条、查不到收件人就丢」⇒ 一个可省的 `to` 等于要么静默丢掉别人的名单、
   * 要么落成全房群发。必填＝编译器替人盯这一格。
   *
   * 别席那一格永远不上线：同一时刻只有一个席位在征召，其余席位收到的是**空名单＋一句"没轮到你"**
   * （空名单在这里是一句真话，与 `moves` 那条同一个判据，与 `draftprogress` 的空表＝坏消息相反）。
   * 这一帧不进私有视图（`snapshotView.ts:40` 那份放开名单仍是 `hand`／`generalPool`，一格没加）、不进引擎、不进录像。
   */
  | ({ t: 'draftlist'; from: string; to: string } & NetDraftListFrame)
  | { t: 'bye'; from: string };

export function ourVersionStamp(): VersionStamp {
  return { app: pkg.version, proto: NET_PROTOCOL_VERSION, snapshot: NETWORK_SNAPSHOT_VERSION };
}

/**
 * 房间码走浏览器自己的随机源，绝不碰引擎那颗对局种子——
 * 掺进对局随机流会打乱"同一局能重演"的基准读数（契约 §G 方法结论 2）。
 * 随机数取不到就退到 `Math.random`（判据与那条兜底都住 `netRandom.ts`，与身份号共用）：
 * 房主那页若开在 `http://<一串 IP>` 上，`getRandomValues` 也不在，
 * 少了这条兜底房主连一间房都开不出来，客人更没有码可填。
 */
export function createRoomCode(): string {
  const bytes = randomBytes(ROOM_CODE_LENGTH);
  return Array.from(bytes, (b) => ROOM_CODE_ALPHABET[b % ROOM_CODE_ALPHABET.length]).join('');
}

export function normalizeRoomCode(raw: string): string | null {
  const code = String(raw ?? '').trim().toUpperCase().replace(/[\s-]/g, '');
  if (code.length < 4 || code.length > MAX_ROOM_CODE_LENGTH) return null;
  return /^[A-Z0-9]+$/.test(code) ? code : null;
}

/** 地址可填＝A/C 只换这里；返回拒因（人读）而不是抛错，界面照原文显示。 */
export function composeRoomUrl(
  address: string,
  roomCode: string,
  peerId: string,
): { ok: true; url: string; roomCode: string } | { ok: false; reason: string } {
  const trimmed = String(address ?? '').trim().replace(/\/+$/, '');
  if (!trimmed) return { ok: false, reason: '连接地址没填。局域网填 ws://对方IP:8787，中转填 ws://服务器地址:端口' };
  if (!/^wss?:\/\//i.test(trimmed)) return { ok: false, reason: `地址要以 ws:// 或 wss:// 开头，现在填的是「${trimmed}」` };
  const code = normalizeRoomCode(roomCode);
  if (!code) return { ok: false, reason: `房间码得是 4-10 位字母或数字，现在填的是「${roomCode}」` };
  // 切片⑥：身份号进网址第二段＝握手那一刻就把这条连接绑在这个人身上，
  // 传话程序往后不必去信帧里自报的 `from`。这里先验形状：形状不对的老连接
  // 会连上但一格指名快照也收不到（空屏），所以宁可在点「进房间」时就拒一句人话。
  if (!PEER_ID_URL_PATTERN.test(String(peerId ?? ''))) {
    return { ok: false, reason: `这台机器没算出自己的身份号（现在是「${peerId}」），先刷新页面再试` };
  }
  return { ok: true, url: `${trimmed}/${code}/${encodeURIComponent(peerId)}`, roomCode: code };
}

export function encodeEnvelope(envelope: NetEnvelope): string {
  return JSON.stringify(envelope);
}

/** 线上证人：解析器只认这十七种信封，形状不对/未知类型/超长一律拒（返回 null，不猜）。 */
export function parseEnvelope(text: string): NetEnvelope | null {
  if (typeof text !== 'string' || text.length === 0 || text.length > MAX_WIRE_BYTES) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const raw = parsed as Record<string, unknown>;
  const isId = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 64;
  /** 心跳那个 `at` 是**发话那台机器自己的钟**：只要求它是个安全的正数，不要求它是"现在"。 */
  const isClock = (v: unknown): v is number =>
    typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= Number.MAX_SAFE_INTEGER;
  const isPing = (v: unknown): v is number =>
    typeof v === 'number' && Number.isInteger(v) && v >= 0;
  /** 清单的编号与标签都是房主自己生成、原样交回的一小串字符：
   *  限长、非空、不含控制字符——客人往上叠字节没有意义，房主认的是自己重算的那张清单。 */
  const isBounded = (v: unknown, max: number): v is string =>
    typeof v === 'string' && v.length > 0 && v.length <= max && ![...v].some((c) => c.charCodeAt(0) < 0x20);
  const isStamp = (v: unknown): v is VersionStamp => {
    if (!v || typeof v !== 'object') return false;
    const s = v as Record<string, unknown>;
    return typeof s.app === 'string' && typeof s.proto === 'number' && typeof s.snapshot === 'number';
  };
  /**
   * 一张候选卡（切片⑤c）。`type` 只按"一小串非空字符"收而不钉死那两种写法：
   * 卡片上那个图标是 `type === '武将' ? ⚔️ : 📜`（`GeneralDraft.tsx` 同一句），
   * 将来真加第三种画法是那一格的事——在这里钉死两种只会让一帧未来的真话被当成坏消息丢掉。
   */
  const draftItemOf = (v: unknown): NetDraftItem | null => {
    if (!v || typeof v !== 'object') return null;
    const o = v as Record<string, unknown>;
    if (!isBounded(o.key, MAX_MOVE_KEY_LENGTH) || !isBounded(o.name, MAX_MOVE_LABEL_LENGTH)) return null;
    if (!isBounded(o.faction, MAX_NAME_LENGTH) || !isBounded(o.type, MAX_NAME_LENGTH)) return null;
    if (!isPing(o.hp) || o.hp > MAX_DRAFT_STAT_VALUE) return null;
    if (!isPing(o.meleeAtk) || o.meleeAtk > MAX_DRAFT_STAT_VALUE) return null;
    if (!isPing(o.rangedAtk) || o.rangedAtk > MAX_DRAFT_STAT_VALUE) return null;
    if (!Array.isArray(o.skills) || o.skills.length > MAX_DRAFT_SKILLS) return null;
    const skills = (o.skills as unknown[]).map((s) => (isBounded(s, MAX_MOVE_LABEL_LENGTH) ? s : null));
    if (skills.some((s) => s === null)) return null;
    return {
      key: o.key, name: o.name, faction: o.faction, type: o.type,
      hp: o.hp, meleeAtk: o.meleeAtk, rangedAtk: o.rangedAtk, skills: skills as string[],
    };
  };

  switch (raw.t) {
    case 'hello':
      return isId(raw.from) && typeof raw.name === 'string' && isStamp(raw.v)
        ? { t: 'hello', from: raw.from, name: raw.name, v: raw.v }
        : null;
    case 'welcome':
      return isId(raw.from) && isId(raw.to) && typeof raw.name === 'string' && isStamp(raw.v)
        ? { t: 'welcome', from: raw.from, to: raw.to, name: raw.name, v: raw.v }
        : null;
    case 'refuse':
      return isId(raw.from) && isId(raw.to) && typeof raw.reason === 'string'
        ? { t: 'refuse', from: raw.from, to: raw.to, reason: raw.reason }
        : null;
    case 'roster': {
      if (!isId(raw.from) || !Array.isArray(raw.peers) || raw.peers.length > 8) return null;
      const peers = (raw.peers as unknown[]).map((p) => {
        if (!p || typeof p !== 'object') return null;
        const o = p as Record<string, unknown>;
        if (!isId(o.id) || typeof o.name !== 'string' || (o.role !== 'host' && o.role !== 'guest')) return null;
        return { id: o.id, name: o.name, role: o.role };
      });
      return peers.every(Boolean) ? { t: 'roster', from: raw.from, peers: peers as NetPeer[] } : null;
    }
    case 'bye':
      return isId(raw.from) ? { t: 'bye', from: raw.from } : null;
    case 'snapshot': {
      if (!isId(raw.from)) return null;
      // `to` 可以缺席（＝全桌通用那份观战视图）；给了就必须是个身份号，
      // 半截的"发给谁"比没有更危险：客人那边会把别人的私有视图当成自己的收下。
      // 缺席时**不补一个 undefined 键**：那样线上与内存里的形状会不一致。
      if (raw.to !== undefined && !isId(raw.to)) return null;
      const state = raw.state;
      if (!state || typeof state !== 'object' || Array.isArray(state)) return null;
      return raw.to === undefined
        ? { t: 'snapshot', from: raw.from, state: state as Record<string, unknown> }
        : { t: 'snapshot', from: raw.from, to: raw.to, state: state as Record<string, unknown> };
    }
    case 'ping':
      return isId(raw.from) && isId(raw.to) && isClock(raw.at)
        ? { t: 'ping', from: raw.from, to: raw.to, at: raw.at }
        : null;
    case 'pong':
      return isId(raw.from) && isId(raw.to) && isClock(raw.at)
        ? { t: 'pong', from: raw.from, to: raw.to, at: raw.at }
        : null;
    case 'netstatus': {
      // 空表也拒：房主那一行永远在表上，收到一张"谁都没有"的表只可能是坏消息，
      // 收下来等于把界面上那张公开的表清空。
      if (!isId(raw.from) || !Array.isArray(raw.rows) || raw.rows.length === 0 || raw.rows.length > 8) return null;
      const rows = (raw.rows as unknown[]).map((r) => {
        if (!r || typeof r !== 'object') return null;
        const o = r as Record<string, unknown>;
        if (!isId(o.id) || typeof o.name !== 'string' || o.name.length === 0 || o.name.length > MAX_NAME_LENGTH) return null;
        if (o.state !== 'online' && o.state !== 'lost') return null;
        if (o.pingMs !== null && (!isPing(o.pingMs) || o.pingMs > MAX_TRUSTED_PING_MS)) return null;
        return { id: o.id, name: o.name, pingMs: (o.pingMs as number | null) ?? null, state: o.state };
      });
      return rows.every(Boolean) ? { t: 'netstatus', from: raw.from, rows: rows as NetLinkRow[] } : null;
    }
    case 'seatmap': {
      // 与 netstatus 同一把闸：空表只可能是坏消息。房主那一席永远在表上，
      // 一张"谁都不坐"的席位表收下来等于把界面上那张表清空。
      if (!isId(raw.from) || !Array.isArray(raw.seats) || raw.seats.length === 0 || raw.seats.length > MAX_SEAT_ROWS) return null;
      const seats = (raw.seats as unknown[]).map((s) => {
        if (!s || typeof s !== 'object') return null;
        const o = s as Record<string, unknown>;
        if (!isSeatNumber(o.seat) || !isBounded(o.name, MAX_NAME_LENGTH)) return null;
        if (o.peer !== null && !isId(o.peer)) return null;
        return { peer: (o.peer as string | null) ?? null, seat: o.seat, name: o.name };
      });
      return seats.every(Boolean) ? { t: 'seatmap', from: raw.from, seats: seats as NetSeatRow[] } : null;
    }
    case 'moves': {
      // 空清单合法且有意义＝"这一席此刻一步也走不了"，界面上要看得见这句真话。
      if (!isId(raw.from) || !isId(raw.to) || !isSeatNumber(raw.seat) || !Array.isArray(raw.items) || raw.items.length > MAX_MOVE_ITEMS) return null;
      if (!isPing(raw.omitted) || raw.omitted > MAX_OMITTED_MOVES) return null;
      const items = (raw.items as unknown[]).map((m) => {
        if (!m || typeof m !== 'object') return null;
        const o = m as Record<string, unknown>;
        if (!isBounded(o.key, MAX_MOVE_KEY_LENGTH) || !isBounded(o.label, MAX_MOVE_LABEL_LENGTH)) return null;
        return { key: o.key, label: o.label };
      });
      return items.every(Boolean)
        ? { t: 'moves', from: raw.from, to: raw.to, seat: raw.seat, items: items as NetMoveItem[], omitted: raw.omitted }
        : null;
    }
    case 'act':
      return isId(raw.from) && isId(raw.to) && isSeatNumber(raw.seat) && isBounded(raw.key, MAX_MOVE_KEY_LENGTH)
        ? { t: 'act', from: raw.from, to: raw.to, seat: raw.seat, key: raw.key }
        : null;
    case 'actno':
      // 原因必须非空：退回而不说为什么，等于让客人对着一张不亮的按钮瞎猜。
      if (!isId(raw.from) || !isId(raw.to) || !isBounded(raw.key, MAX_MOVE_KEY_LENGTH) || !isBounded(raw.reason, MAX_REFUSAL_LENGTH)) return null;
      return { t: 'actno', from: raw.from, to: raw.to, key: raw.key, reason: raw.reason };
    case 'ready':
      // 客人交回的那一颗钮只有一个布尔：别的什么都不许跟着上来（他不能替别人点，
      // 也不能顺手把"我要开始游戏"塞进同一条里）。
      return isId(raw.from) && isId(raw.to) && typeof raw.on === 'boolean'
        ? { t: 'ready', from: raw.from, to: raw.to, on: raw.on }
        : null;
    case 'readytable': {
      // 与 netstatus／seatmap 那两条反着来的地方只有一处：空表在这里是一句真话
      // （屋里一个客人都没有＝没人在等），所以只封顶、不要求"至少一行"。
      if (!isId(raw.from) || !Array.isArray(raw.rows) || raw.rows.length > MAX_READY_ROWS) return null;
      const rows = (raw.rows as unknown[]).map((r) => {
        if (!r || typeof r !== 'object') return null;
        const o = r as Record<string, unknown>;
        if (!isId(o.peer) || !isBounded(o.name, MAX_NAME_LENGTH)) return null;
        if (typeof o.on !== 'boolean' || typeof o.counted !== 'boolean') return null;
        return { peer: o.peer, name: o.name, on: o.on, counted: o.counted };
      });
      return rows.every(Boolean) ? { t: 'readytable', from: raw.from, rows: rows as NetReadyRow[] } : null;
    }
    case 'draftprogress': {
      // 空表＝坏消息（与 netstatus／seatmap 同一判据）：一张"谁都不在征召"的进度表
      // 不是"征召还没开始"——那时房主根本不发这一条（见信封上那段注释）。
      if (!isId(raw.from) || !Array.isArray(raw.rows) || raw.rows.length === 0 || raw.rows.length > MAX_DRAFT_PROGRESS_ROWS) return null;
      const rows = (raw.rows as unknown[]).map((r) => {
        if (!r || typeof r !== 'object') return null;
        const o = r as Record<string, unknown>;
        if (!isSeatNumber(o.seat) || !isBounded(o.name, MAX_NAME_LENGTH)) return null;
        if (o.state !== 'waiting' && o.state !== 'picking' && o.state !== 'done') return null;
        if (!isPing(o.picked) || o.picked > MAX_DRAFT_PICK_COUNT) return null;
        if (!isPing(o.total) || o.total > MAX_DRAFT_PICK_COUNT) return null;
        return { seat: o.seat, name: o.name, state: o.state, picked: o.picked, total: o.total };
      });
      return rows.every(Boolean) ? { t: 'draftprogress', from: raw.from, rows: rows as NetDraftProgressRow[] } : null;
    }
    case 'draftlist': {
      // `to` 必填（信封上那段理由）：半截的"发给谁"比没有更危险——别人的候选名单会画到自己屏上。
      if (!isId(raw.from) || !isId(raw.to) || !isSeatNumber(raw.seat)) return null;
      if (!isPing(raw.total) || raw.total > MAX_DRAFT_PICK_COUNT) return null;
      if (!isBounded(raw.instruction, MAX_DRAFT_INSTRUCTION_LENGTH)) return null;
      // 两份名单可以都是空的（"现在没有你的候选"是一句真话），但必须是数组、且不超上界。
      if (!Array.isArray(raw.main) || raw.main.length > MAX_DRAFT_ITEMS) return null;
      if (!Array.isArray(raw.qun) || raw.qun.length > MAX_DRAFT_ITEMS) return null;
      if (!Array.isArray(raw.picked) || raw.picked.length > MAX_DRAFT_ITEMS) return null;
      const main = (raw.main as unknown[]).map(draftItemOf);
      const qun = (raw.qun as unknown[]).map(draftItemOf);
      if (main.some((i) => i === null) || qun.some((i) => i === null)) return null;
      const items = [...main, ...qun] as NetDraftItem[];
      // 位置编号在整帧里必须唯一：两张卡共用一个号，客人交回来的那一颗就说不清是哪一张。
      const keys = new Set(items.map((i) => i.key));
      if (keys.size !== items.length) return null;
      // `picked` 只许指这张名单上的号：房主按同一个规则生成，永远给得出可用的号；
      // 指到没有的号或重复 ⇒ 整帧拒（客人那边保留上一帧，不画一个猜出来的"已选"）。
      const picked = (raw.picked as unknown[]).map((k) => (isBounded(k, MAX_MOVE_KEY_LENGTH) && keys.has(k) ? k : null));
      if (picked.some((k) => k === null)) return null;
      if (new Set(picked).size !== picked.length) return null;
      return {
        t: 'draftlist', from: raw.from, to: raw.to, seat: raw.seat, total: raw.total,
        instruction: raw.instruction, main: main as NetDraftItem[], qun: qun as NetDraftItem[],
        picked: picked as string[],
      };
    }
    default:
      return null;
  }
}

/**
 * 版本握手：应用版本／协议版本／快照版本三样任一不符 ⇒ 给出一句人读的拒因。
 * 注意这是"不一致就拒"，不是"新旧排序"——联机要求两边同一份文件，没有向下兼容承诺。
 */
export function versionMismatch(theirs: VersionStamp, ours: VersionStamp): string | null {
  if (typeof theirs.proto !== 'number' || theirs.proto !== ours.proto) {
    return `协议版本对不上：对面 ${theirs.proto}，本机 ${ours.proto}——两边请打开同一份游戏文件`;
  }
  if (typeof theirs.app === 'string' && theirs.app !== ours.app) {
    return `游戏版本对不上：对面 V${theirs.app}，本机 V${ours.app}——两边请打开同一份游戏文件`;
  }
  if (theirs.snapshot !== ours.snapshot) {
    return `局面快照版本对不上：对面 ${theirs.snapshot}，本机 ${ours.snapshot}——两边请打开同一份游戏文件`;
  }
  return null;
}

/** 名字是客人自报的 ⇒ 房主校验后回提示，不照收也不静默截断（契约 §G 玩家账户名行）。 */
export function checkPeerName(
  raw: string,
): { ok: true; name: string } | { ok: false; reason: string } {
  const name = String(raw ?? '').trim();
  if (!name) return { ok: false, reason: '名字不能是空的，请在界面里填一个名字' };
  if (name.length > MAX_NAME_LENGTH) return { ok: false, reason: `名字太长了（${name.length} 个字），最多 ${MAX_NAME_LENGTH} 个` };
  if (/[<>]/.test(name) || [...name].some((c) => c.charCodeAt(0) < 0x20)) {
    return { ok: false, reason: `名字「${name}」里有不能用的字符，请换一个` };
  }
  return { ok: true, name };
}
