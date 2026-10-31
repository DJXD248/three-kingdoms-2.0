/**
 * 乙 线第二片（名册交料的原子闸）的证人（2026-10-31）。
 *
 * 这一片要成立的只有他裁过的那一句：**开房间那位玩家把本机那份"效力名册"交给算牌机器，
 * 要么整份收下、要么明说没收下——绝不留半份名册继续算牌。**
 * 证人也按这句话的四条腿排：
 * ㈠ 闸真是原子的：一份坏料里那些**好卡也一样不收**，退回那一支连名册都装不下（形状挡着，不靠自觉）；
 * ㈡ 认账与卡面字段用的都是现成那三把尺（装包那侧的字段尺＋名册来源那几把），本文件不造第二判据；
 * ㈢ 指纹按**效力**取：pretty 与否、键的书写次序、`disabledIds` 的次序都是同一个值，
 *    而真的效力差异（少一张、体力变一个数、记录序换到"会改发料"那一层）一律换值；
 * ㈣ 最强那条＝拿真 store 的 `poolGenerals()`＋`effectiveDisabledGenerals()` 交上来再收回去，
 *    与 store 自己那一份在同一枚种子上开局，读数逐字相同（DIY 卡、身份、被关的编号都跟着过来）。
 *
 * ㈢ 那条记录序的证人特别说明：它不是"摘要算法碰巧敏感"，而是发料按池子下标取数，
 * 所以次序换了**真会发出不一样的将**——那半边由开局读数作证，不靠注释声称。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { allGenerals, type Faction, type General } from '../data/generals';
import { useGameStore } from '../store/gameStore';
import { defaultSeatModes, type AiSeatMode } from './runtimeSetup';
import { OPENING_DRAFT_TOTAL, runOpeningToDraft, type OpeningRoster, type OpeningState } from './openingCompute';
import {
  ROSTER_SUBMISSION_FORMAT,
  acceptRosterSubmission,
  acceptRosterSubmissionText,
  buildRosterSubmission,
  rosterContentFingerprint,
  type RosterReceipt,
} from './rosterHandover';

const here = path.dirname(fileURLToPath(import.meta.url));
const SEED = 20261031;

/** 一张玩家自制的卡（编号在 `D-` 名下、来源写着自制＝认账要的那对）。 */
function diyCard(id: string, name: string, faction: Faction = '群', hp = 3): General {
  return {
    id,
    name,
    faction,
    hp,
    type: '武将',
    meleeAtk: 1,
    rangedAtk: 0,
    armor: 0,
    skills: [{ name: `${name}技`, tags: ['锁定技'] }],
    identity: name,
    source: 'DIY',
  };
}

/** 一张官方编号下的本机草稿卡（`G-`＋来源官方＝另一条已认的账）。 */
function draftCard(id: string, name: string, faction: Faction = '魏'): General {
  return { ...diyCard(id, name, faction), source: 'official' };
}

function ledgerCard(index = 0): General {
  return allGenerals[index];
}

/** 一份三种来源都齐的合法料。 */
function mixedPool(): General[] {
  return [ledgerCard(0), ledgerCard(1), draftCard('G-handover_001', '草稿甲'), diyCard('D-handover_001', '自制甲')];
}

function submission(pool: readonly General[], disabledIds: readonly string[] = []): unknown {
  return { format: ROSTER_SUBMISSION_FORMAT, pool: pool.map(c => ({ ...c })), disabledIds: [...disabledIds] };
}

/** 收下的那一支才有名册；退回时把原因原样抛出来，免得测试静默通过。 */
function mustAccept(receipt: RosterReceipt): Extract<RosterReceipt, { accepted: true }> {
  if (receipt.accepted !== true) {
    throw new Error(`本该整份收下，却退回了：${receipt.reason} ${receipt.problems.join(' / ')}`);
  }
  return receipt;
}

/** 退回的那一支必须连名册都没有（原子闸在类型那一层就挡住了"半份继续算"）。 */
function expectRefused(receipt: RosterReceipt, hint?: string): Extract<RosterReceipt, { accepted: false }> {
  expect(receipt.accepted, hint ?? '这一份本该整份退回').toBe(false);
  if (receipt.accepted === true) throw new Error('本该退回，却收下了');
  expect(receipt.roster, '退回那一支不许带任何名册').toBeNull();
  expect(receipt.content, '退回那一支不许带指纹').toBeNull();
  expect(receipt.reason.length, '退回必须有一句人话').toBeGreaterThan(0);
  return receipt;
}

/** 开局读数的一枚投影（牌堆＋座位面＋候选面＋落定面＋游标）。 */
function projection(state: OpeningState): string {
  const ids = (list: readonly General[]) => list.map(general => general.id);
  return JSON.stringify({
    stage: state.stage,
    rng: state.rng,
    deck: state.deck.map(card => card.id),
    seats: state.seats.map(seat => ({
      seatOrder: seat.seatOrder,
      faction: seat.faction,
      main: ids(seat.main),
      qun: ids(seat.qun),
      picks: ids(seat.picks),
      settled: seat.settled,
    })),
  });
}

/** 第 2～4 席坐 AI：交来的名册要一路走到"AI 席自己凑满"那一步，才真的把整条开局路都压过一遍。 */
function seatModes(count = 4): AiSeatMode[] {
  return defaultSeatModes(count).map((mode, index) => ({ ...mode, isAi: index > 0 }));
}

function openWith(roster: OpeningRoster, playerCount = 4): OpeningState {
  return runOpeningToDraft({ seed: SEED, playerCount, seatModes: seatModes(playerCount), roomName: '交料开局' }, roster);
}

/**
 * 只看代码本体、不看注释的读法：交料闸的注释里写着"不 import 联机那侧""不套用内容包那 200 张的帽子"，
 * 那些词是**说明**，不是引用；拿原始文本去比禁词会把注释也当成越界（而真越界时也会一样红，判据就废了）。
 */
function stripComments(source: string): string {
  const blockOpen = '/*';
  const blockClose = '*/';
  const lineOpen = '//';
  const newline = String.fromCharCode(10);
  let out = '';
  let i = 0;
  while (i < source.length) {
    if (source.startsWith(blockOpen, i)) {
      const end = source.indexOf(blockClose, i + blockOpen.length);
      i = end === -1 ? source.length : end + blockClose.length;
      continue;
    }
    if (source.startsWith(lineOpen, i)) {
      const end = source.indexOf(newline, i);
      i = end === -1 ? source.length : end;
      continue;
    }
    out += source[i];
    i += 1;
  }
  return out;
}

describe('乙 第二片 ㈠ 原子闸：整份收下，或者整份退回', () => {
  it('三种来源都齐的一份合法料被整份收下，且一句毛病也没有', () => {
    const receipt = mustAccept(acceptRosterSubmission(submission(mixedPool())));
    expect(receipt.poolCount).toBe(4);
    expect(receipt.disabledCount).toBe(0);
    expect(receipt.notes).toEqual([]);
    expect(receipt.roster.pool.map(general => general.id))
      .toEqual([ledgerCard(0).id, ledgerCard(1).id, 'G-handover_001', 'D-handover_001']);
  });

  it('好卡夹着一张坏卡＝整份退回：坏的那条被点名，好的那些也一张没进算牌机器的账', () => {
    const broken = { ...diyCard('D-handover_002', '自制乙'), hp: 0 };
    const receipt = expectRefused(acceptRosterSubmission(submission([...mixedPool(), broken])));
    expect(receipt.problems).toHaveLength(1);
    expect(receipt.problems[0]).toContain('自制乙');
    expect(receipt.problems[0]).toContain('D-handover_002');
    expect(receipt.problems[0]).toContain('体力');
    // 「一份没修好的名册里，那几张好卡能不能被先用起来」——答案必须是不能。
    expect(receipt.roster).toBeNull();
  });

  it('毛病不止一处时逐条都列出来，不让玩家修一条再撞一条', () => {
    const receipt = expectRefused(acceptRosterSubmission(submission([
      diyCard('D-handover_003', '自制丙'),
      { ...diyCard('D-handover_004', '自制丁'), skills: [{ name: '带野徽章', tags: ['不存在技'] }] as unknown as General['skills'] },
      { ...diyCard('D-handover_005', '自制戊'), faction: '胡' as unknown as Faction },
    ])));
    expect(receipt.problems).toHaveLength(2);
    expect(receipt.problems.join('\n')).toContain('徽章');
    expect(receipt.problems.join('\n')).toContain('势力');
  });

  it('同一个编号在这份名册里出现两次＝退回（同一颗牌发两遍，开局必分叉）', () => {
    const receipt = expectRefused(acceptRosterSubmission(submission([
      diyCard('D-handover_006', '重复甲'),
      ledgerCard(0),
      diyCard('D-handover_006', '重复乙'),
    ])));
    expect(receipt.problems[0]).toContain('出现了两次');
    expect(receipt.problems[0]).toContain('第 1 条与第 3 条');
  });

  it('程序自带的官方卡被当成本机自制交上来＝退回（同一张卡不能有两个主人）', () => {
    const claimed = { ...ledgerCard(0), source: 'DIY' as const };
    expectRefused(acceptRosterSubmission(submission([claimed])));
    // 正面凭据：同一张卡把来源写成官方（或不写）照收——挡的是"冒充"，不是"官方卡"本身。
    expect(mustAccept(acceptRosterSubmission(submission([{ ...claimed, source: 'official' }]))).poolCount).toBe(1);
    expect(mustAccept(acceptRosterSubmission(submission([ledgerCard(0)]))).poolCount).toBe(1);
  });

  it('编号与来源对不上（自制编号配官方来源、官方编号配自制来源）都认不回来', () => {
    const wrongPairing = [
      { ...diyCard('D-handover_007', '串门甲'), source: 'official' as const },
      { ...draftCard('G-handover_007', '串门乙'), source: 'DIY' as const },
    ];
    const receipt = expectRefused(acceptRosterSubmission(submission(wrongPairing)));
    expect(receipt.problems).toHaveLength(2);
    for (const problem of receipt.problems) expect(problem).toContain('编号与来源必须对上');
  });

  it('册外又不在任何名册编号下的卡＝退回，说的是"两边账本不是同一份，禁止开始"', () => {
    const stranger = { ...diyCard('stray_001', '册外丁'), source: 'DIY' as const };
    const receipt = expectRefused(acceptRosterSubmission(submission([stranger])));
    expect(receipt.problems[0]).toContain('两边账本不是同一份');
  });

  it('没编号／整条不是记录／空名册，各退各的，绝不当成"收下零张"', () => {
    expectRefused(acceptRosterSubmission(submission([{ ...diyCard('D-handover_008', '掉了号'), id: '' }])));
    // 逐条那一级：直接递给闸一份原始料（第二条是一串字，不是记录）。
    const notARecord = expectRefused(acceptRosterSubmission({
      format: ROSTER_SUBMISSION_FORMAT,
      pool: [{ ...diyCard('D-handover_009', '正常') }, '一个字都不算'],
      disabledIds: [],
    }), '第二条不是记录');
    expect(notARecord.problems).toHaveLength(1);
    expect(notARecord.problems[0]).toContain('第 2 条');
    expect(notARecord.problems[0]).toContain('不是一个将领记录');
    const empty = expectRefused(acceptRosterSubmission(submission([])));
    expect(empty.reason).toContain('空名册');
  });

  it('结构缺格（没有名单／名单不是清单／关掉的编号不是清单）都是退回；这一格没写＝当作一个都没关', () => {
    expectRefused(acceptRosterSubmission({ format: ROSTER_SUBMISSION_FORMAT }), '缺 pool');
    expectRefused(acceptRosterSubmission({ format: ROSTER_SUBMISSION_FORMAT, pool: '一张长长的字' }), 'pool 不是清单');
    expectRefused(acceptRosterSubmission({ format: ROSTER_SUBMISSION_FORMAT, pool: mixedPool(), disabledIds: 'D-1' }), 'disabledIds 不是清单');
    const absent = mustAccept(acceptRosterSubmission({ format: ROSTER_SUBMISSION_FORMAT, pool: mixedPool() }));
    expect(absent.disabledCount).toBe(0);
  });

  it('格式号缺／比这台新／比这台旧：一律整份退回并说清要哪一号，不硬猜', () => {
    const noFormat = expectRefused(acceptRosterSubmission({ pool: mixedPool(), disabledIds: [] }), '缺 format');
    expect(noFormat.problems[0]).toContain(String(ROSTER_SUBMISSION_FORMAT));
    const newer = expectRefused(acceptRosterSubmission({
      format: ROSTER_SUBMISSION_FORMAT + 1,
      pool: mixedPool(),
      disabledIds: [],
    }), '比这台新');
    expect(newer.reason).toContain('更新的程序');
    const older = expectRefused(acceptRosterSubmission({
      format: ROSTER_SUBMISSION_FORMAT - 1,
      pool: mixedPool(),
      disabledIds: [],
    }), '比这台旧');
    expect(older.reason).toContain('比这台认识的');
  });

  it('整份不是记录／读不懂的 JSON＝退回并说"一张也没收"', () => {
    const notRoster = expectRefused(acceptRosterSubmission('这不是一个记录'));
    expect(notRoster.reason).toContain('一张也没收');
    const badJson = expectRefused(acceptRosterSubmissionText('{"format":1,"pool":['));
    expect(badJson.reason).toContain('JSON');
    expect(badJson.reason).toContain('一张也没收');
  });

  it('关掉的编号写重复了：收下，但把"按一处算"写进说明，绝不静默', () => {
    const pool = mixedPool();
    const receipt = mustAccept(acceptRosterSubmission(submission(pool, ['D-handover_001', 'D-handover_001'])));
    expect(receipt.disabledCount).toBe(1);
    expect(receipt.notes.join('\n')).toContain('按一处算');
  });

  it('关掉的编号里有不在这份名册的：整份照样收下，并点名有几个', () => {
    const receipt = mustAccept(acceptRosterSubmission(submission(mixedPool(), ['D-handover_001', 'D-册外_001'])));
    expect(receipt.poolCount).toBe(4);
    expect(receipt.disabledCount).toBe(2);
    expect(receipt.notes.join('\n')).toContain('不在这份名册里');
    expect(receipt.notes.join('\n')).toContain('照旧收下整份');
  });
});

describe('乙 第二片 ㈡ 内容包那 200 张的帽子不适用在名册上', () => {
  it('250 张自制卡（超过内容包上限）是一份正常名册，不该被判成交料失败', () => {
    const big = Array.from({ length: 250 }, (_, index) => diyCard(`D-big_${String(index).padStart(3, '0')}`, `大${String(index)}`));
    const receipt = mustAccept(acceptRosterSubmission(submission(big)));
    expect(receipt.poolCount).toBe(250);
    // 现成的账本本身就有 335 张，照搬帽子会把日常交料判成失败。
    expect(allGenerals.length).toBeGreaterThan(200);
    expect(mustAccept(acceptRosterSubmission(submission(allGenerals))).poolCount).toBe(allGenerals.length);
  });
});

describe('乙 第二片 ㈢ 指纹按效力取（同一份效力一个值，真的效力差异换值）', () => {
  it('形状就是内容包那两枚 32 位摘要拼起来的样', () => {
    const receipt = mustAccept(acceptRosterSubmission(submission(mixedPool())));
    expect(receipt.content).toMatch(/^[0-9a-f]{8}-[0-9a-f]{8}$/);
  });

  it('排版、键的书写次序、关掉的编号次序都不换值', () => {
    const pool = mixedPool();
    const disabled = ['D-handover_001'];
    const canonical = rosterContentFingerprint(pool, disabled);
    // 同一份效力，pretty 与紧凑两种排版。
    const pretty = acceptRosterSubmissionText(JSON.stringify(buildRosterSubmission(pool, disabled), null, 2));
    const compact = acceptRosterSubmissionText(JSON.stringify(buildRosterSubmission(pool, disabled)));
    expect(mustAccept(pretty).content).toBe(canonical);
    expect(mustAccept(compact).content).toBe(canonical);
    // 逐张把字段倒过来写，落进账里的还是同一份效力。
    const reversedKeys = pool.map(general => {
      const entries = Object.entries({ ...general }).reverse();
      return Object.fromEntries(entries);
    });
    expect(mustAccept(acceptRosterSubmission({ format: ROSTER_SUBMISSION_FORMAT, pool: reversedKeys, disabledIds: [...disabled] })).content).toBe(canonical);
    // 被关的编号是一枚集合：换序不换值。
    const three = [diyCard('D-order_001', '序一'), diyCard('D-order_002', '序二'), diyCard('D-order_003', '序三')];
    expect(rosterContentFingerprint(three, ['D-order_001', 'D-order_002', 'D-order_003']))
      .toBe(rosterContentFingerprint(three, ['D-order_003', 'D-order_002', 'D-order_001']));
    expect(rosterContentFingerprint(three, ['D-order_001', 'D-order_001']))
      .toBe(rosterContentFingerprint(three, ['D-order_001']));
  });

  it('少一张、多一张、体力差一个数都换值', () => {
    const pool = mixedPool();
    const base = rosterContentFingerprint(pool, []);
    expect(rosterContentFingerprint(pool.slice(1), [])).not.toBe(base);
    expect(rosterContentFingerprint([...pool, diyCard('D-extra_001', '多出来')], [])).not.toBe(base);
    const edited = pool.map(general => (general.id === 'D-handover_001' ? { ...general, hp: general.hp + 1 } : general));
    expect(rosterContentFingerprint(edited, [])).not.toBe(base);
    expect(rosterContentFingerprint(pool, ['D-handover_001'])).not.toBe(base);
  });

  it('名字一样但来源／编号 namespace 不同的两张卡是两回事（不许靠"看起来同名"混过去）', () => {
    const asDiy = diyCard('D-twin_001', '同名');
    const asDraft = draftCard('G-twin_001', '同名');
    expect(rosterContentFingerprint([asDiy], [])).not.toBe(rosterContentFingerprint([asDraft], []));
  });

  it('卡的记录序换到会改发料那一层：不只是摘要换了值，发上桌的将也跟着换', () => {
    const pool = [...allGenerals];
    const reversed = [...pool].reverse();
    // 尺这一侧：换序换值。
    expect(rosterContentFingerprint(reversed, [])).not.toBe(rosterContentFingerprint(pool, []));
    // 效力这一侧：同一枚种子，两份料发出来的第一席候选面不是同一批将（⇒ 次序确实是效力的一部分）。
    const forward = openWith({ pool, disabledIds: new Set<string>() });
    const backward = openWith({ pool: reversed, disabledIds: new Set<string>() });
    expect(backward.seats[0].main.map(general => general.id)).not.toEqual(forward.seats[0].main.map(general => general.id));
    expect(projection(backward)).not.toBe(projection(forward));
  });

  it('多带一格野键：不算效力差异，也绝不落进算牌机器的账', () => {
    const clean = mixedPool();
    const withWild = clean.map(general => ({ ...general, sneakyKey: '往进程账里塞东西' }));
    const receipt = mustAccept(acceptRosterSubmission(submission(withWild)));
    expect(receipt.content).toBe(rosterContentFingerprint(clean, []));
    for (const stored of receipt.roster.pool) {
      expect(Object.keys(stored as unknown as Record<string, unknown>)).not.toContain('sneakyKey');
    }
  });

  it('同一份效力跑两遍逐字同值；交上来的与本机算的不是两把尺', () => {
    const pool = mixedPool();
    const disabled = ['D-handover_001'];
    expect(rosterContentFingerprint(pool, disabled)).toBe(rosterContentFingerprint(pool, disabled));
    // 交的那一侧（buildRosterSubmission）与收的那一侧（回执里的 content）必须是同一个值，
    // 否则将来握手那一格两边各算各的，永远对不上。
    const handed = mustAccept(acceptRosterSubmission(buildRosterSubmission(pool, disabled)));
    expect(handed.content).toBe(rosterContentFingerprint(pool, disabled));
  });
});

describe('乙 第二片 ㈣ 进程面是干净的：闸不越界', () => {
  const raw = readFileSync(path.join(here, 'rosterHandover.ts'), 'utf8');
  const code = stripComments(raw);

  // 先证明这把尺在动：剥完注释确实短了一截，而且代码本体还在（空字符串会让下面每一条禁词都"通过"）。
  it('剥注释这一刀真的剥到了代码本体', () => {
    expect(code.length).toBeLessThan(raw.length);
    expect(code).toContain('export function acceptRosterSubmission');
    expect(code).not.toContain('/*');
  });

  it('不读本机存档、不碰浏览器、不 import store，也不 import 联机那侧', () => {
    for (const banned of ['localStorage', 'sessionStorage', 'document.', 'window.', 'gameStore', 'node:fs', 'readFileSync', 'network', 'VersionStamp']) {
      expect(code, `交料闸不该出现「${banned}」`).not.toContain(banned);
    }
  });

  it('三条判据全是复用现成的那几把，本文件零新判据', () => {
    for (const reused of ['stableText', 'digestText', 'findGeneralFieldProblem', 'sanitizeGeneralRecord', 'isAcceptableAuthoredRecord', 'isRepositoryOfficial', 'idNamespace']) {
      expect(code, `该复用现成的「${reused}」`).toContain(reused);
    }
  });

  it('名册内容不随快照发出去：这一片连"握手那一格"都没碰（等第三片一起接）', () => {
    expect(code).not.toContain('MAX_PACK_GENERALS');
    // 交出去的只有格式号＋两份效力零件，别的格一概没有。
    const built = buildRosterSubmission(mixedPool(), ['D-handover_001']) as unknown as Record<string, unknown>;
    expect(Object.keys(built).sort()).toEqual(['disabledIds', 'format', 'pool']);
  });
});

describe('乙 第二片 ㈤ 最强证人：真 store 交料→收料→开局，读数与本机那条路逐字一样', () => {
  const handmade = diyCard('D-store_001', '交料自制');
  const ledgerDisabled = allGenerals.find(general => general.faction === '魏');

  beforeEach(() => {
    vi.useFakeTimers();
    useGameStore.setState({
      developerMode: false,
      skillEdits: {},
      generalEdits: {},
      disabledGenerals: new Set<string>([handmade.id, ledgerDisabled?.id ?? '']),
      authoredGenerals: [handmade],
      identityRegistry: [],
      lockedGeneralIds: new Set<string>(),
      playerCount: 4,
      seatModes: defaultSeatModes(4),
      roomName: '交料开局',
      engineState: { ...useGameStore.getState().engineState, rngState: { s: SEED >>> 0 } },
    } as unknown as Partial<ReturnType<typeof useGameStore.getState>>);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('本机那份效力面交上来再收回去，收下的与本机的是同一份（含 DIY 卡与身份那一格）', () => {
    const store = useGameStore.getState();
    const pool = store.poolGenerals();
    const disabled = store.effectiveDisabledGenerals();
    // 正面凭据先立住：这份料确实带着本机自制那张、也确实带着被关的编号，否则下面那些断言全是空跑。
    expect(pool.map(general => general.id)).toContain(handmade.id);
    expect([...disabled]).toContain(handmade.id);

    const text = JSON.stringify(buildRosterSubmission(pool, disabled));
    const receipt = mustAccept(acceptRosterSubmissionText(text));
    expect(receipt.poolCount).toBe(pool.length);
    expect(receipt.disabledCount).toBe(disabled.size);
    expect(receipt.roster.pool.map(general => general.id)).toEqual(pool.map(general => general.id));
    const handedOver = receipt.roster.pool.find(general => general.id === handmade.id);
    expect(handedOver?.identity).toBe(handmade.identity);
    expect(handedOver?.source).toBe('DIY');
    expect([...receipt.roster.disabledIds].sort()).toEqual([...disabled].sort());
    // 本机自己按同一把尺算出来的指纹必须与回执里那枚对上（握手那一格将来就靠这一条）。
    expect(receipt.content).toBe(rosterContentFingerprint(pool, disabled));
  });

  it('交料得来的名册与本机那份名册，在同一枚种子上开出的是同一局（牌堆／座位／候选面／游标都对得上）', () => {
    const store = useGameStore.getState();
    const pool = store.poolGenerals();
    const disabled = store.effectiveDisabledGenerals();
    const receipt = mustAccept(acceptRosterSubmissionText(JSON.stringify(buildRosterSubmission(pool, disabled))));

    const local = openWith({ pool, disabledIds: disabled });
    const handed = openWith(receipt.roster);
    expect(projection(handed)).toBe(projection(local));
    // 而且这一局不是空转出来的：确实洗了牌堆、也确实发到了料。
    expect(handed.deck).toHaveLength(52);
    expect(handed.stage).toBe('draft');
    expect(handed.seats[0].main.length).toBeGreaterThan(0);
    // 交来的这份还要能一路走到"逐席点满"：全桌 AI 时进程自己把 10 张凑齐（AI 取料读的就是这一份）。
    const allAi = runOpeningToDraft({
      seed: SEED,
      playerCount: 4,
      seatModes: seatModes(4).map(mode => ({ ...mode, isAi: true })),
      roomName: '交料开局',
    }, receipt.roster);
    expect(allAi.stage).toBe('ready');
    expect(allAi.seats.every(seat => seat.settled && seat.picks.length === OPENING_DRAFT_TOTAL)).toBe(true);
    for (const seat of allAi.seats) {
      const allowed = new Set(receipt.roster.pool.map(general => general.id));
      for (const general of seat.picks) expect(allowed.has(general.id), `${general.name} 不在交来的名册里`).toBe(true);
    }
  });

  it('交上来的那份名册里的"关掉的编号"真会 steer 发料：Set→清单→Set 这一路没在 JSON 里丢掉牙齿', () => {
    const store = useGameStore.getState();
    const pool = store.poolGenerals();
    // 正面凭据先立住：这一颗在"一个都没关"的那一趟确实发得出来，否则后面那句"没发出来"什么都不是。
    const open = openWith({ pool, disabledIds: new Set<string>() });
    const target = open.seats[0].main[0];
    expect(open.seats[0].main.map(general => general.id)).toContain(target.id);

    const receipt = mustAccept(acceptRosterSubmissionText(JSON.stringify(buildRosterSubmission(pool, [target.id]))));
    expect([...receipt.roster.disabledIds]).toEqual([target.id]);
    const shut = openWith(receipt.roster);
    const surface = shut.seats.flatMap(seat => [...seat.main, ...seat.qun].map(general => general.id));
    expect(surface).not.toContain(target.id);
    // 关掉不等于不发料：主面照样凑得起来（这一格不能因为一颗被关就空着）。
    expect(shut.seats[0].main.length).toBeGreaterThan(0);
    // 交上来的这份与"仓库账本那块占位板"是两份不同的料（不然这一片只是原地绕了一圈）。
    const onlyLedger = openWith({ pool: allGenerals, disabledIds: new Set<string>() });
    expect(rosterContentFingerprint(allGenerals, [])).not.toBe(rosterContentFingerprint(pool, store.effectiveDisabledGenerals()));
    expect(projection(onlyLedger)).not.toBe(projection(open));
  });
});
