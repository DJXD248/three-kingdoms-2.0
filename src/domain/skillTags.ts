/**
 * 徽章（技能标签）的唯一读写口径 — pure vocabulary + rules, zero RNG, zero state.
 * Contract: PROJECT_ARCH_MAP.md §H9 徽章语义（用户 2026-09-30 更正）.
 *
 * 一枚技能可同时挂几枚徽章（闭月＝锁定技＋遗计技）。语义按那次更正逐字钉住：
 *  - 锁定技＝这枚技能**不能被无效、不能被改变**；
 *  - 强制发动＝满足触发条件与代价后**直接响／直接适用效果**，不用玩家点头；
 *  两者与「数值变化／持续生效」互不相关，可任意组合，不是一件事。
 *
 * 字段读写：新记录只写 `tags`；`tag`（单枚旧形态）仍然读得到，但**任何写出面
 * 都不再产生它**（§12-76① 的"只进不出"——读不到的默认后果是把限制放宽，
 * 徽章丢了不会报错，只会让【限定技】变成"不限次数"）。
 */
import type { SkillTag, SkillTriggerType } from '../data/generals';
import { allSkillTags, triggerTypeLabels } from '../data/generals';

export const TAG_SEPARATOR = '、';

/**
 * 每枚徽章到底管什么——界面 tooltip 与词汇表共用这一份，别处不要各写各的。
 * 诚实口径：刀1（v2.8.19）只把徽章读对、写对、显示对、核对上，结算零消费。
 * **v2.8 刀4（#25）起这一句要更正**：「锁定技」在结算侧有了第一个消费者＝数值
 * 修正器账本（`skills/skillCompiler` 把它译成定义的 `locked` 位 → 那笔账移不走）。
 * 其余四枚徽章（限定／登场／遗计／觉醒）今天仍然只是分类，管响不响的是触发时机。
 */
export const skillTagMeanings: Record<SkillTag, string> = {
  锁定技: '这枚技能不能被无效、不能被改变（不是"到点自动响"，那是下面的「强制发动」开关）',
  限定技: '一局之内的次数额度，用完就没了（"一局一次"这类额度引擎尚未落地，现在只是分类）',
  登场技: '上场那一刻响（真正决定响不响的是触发时机「将领登场时」，导入时会核对两者是否说同一件事）',
  遗计技: '被击杀那一刻响（同上，看触发时机「自身被击杀时」，导入时会核对）',
  觉醒技: '满足大条件后变强——本作目前没有任何觉醒机制，它现在纯粹是给人看的分类',
};

/** 「强制发动」开关的口径（与三枚徽章一样互相独立，可任意组合）。 */
export const FORCED_MEANING =
  '满足触发条件与代价后直接响／直接适用效果，不用玩家点头；跟锁定技、跟数值变化或持续生效都没有关系';

/** 拆分徽章格：中文顿号／逗号／分号／斜杠／加号／"和""与"／空白都算分隔。 */
const TAG_SPLIT = /(?:、|,|，|;|；|\/|／|\+|＋|和|与|\s)+/;

type TagCarrier = {
  tag?: SkillTag | string;
  tags?: readonly (SkillTag | string | undefined | null)[];
};

const isSkillTag = (v: unknown): v is SkillTag =>
  typeof v === 'string' && (allSkillTags as readonly string[]).includes(v.trim());

/** 去重、保序、丢弃不认识的徽章名（认识与否由调用方另行点名）。 */
function uniqueTags(raw: readonly unknown[]): SkillTag[] {
  const out: SkillTag[] = [];
  for (const v of raw) {
    if (!isSkillTag(v)) continue;
    const t = (v as string).trim() as SkillTag;
    if (!out.includes(t)) out.push(t);
  }
  return out;
}

/** 一枚技能当前挂着的徽章——新字段与旧单值字段都读，别处不要自己拼。 */
export function tagsOf(skill: TagCarrier | undefined): SkillTag[] {
  if (!skill) return [];
  const fromList = (skill.tags ?? []).filter(v => v !== undefined && v !== null);
  return uniqueTags([
    ...fromList,
    ...(skill.tag !== undefined && skill.tag !== null ? [skill.tag] : []),
  ]);
}

/** 玩家看到的写法：「锁定技、遗计技」；没有徽章就是空串。 */
export function formatTags(tags: readonly SkillTag[]): string {
  return tags.join(TAG_SEPARATOR);
}

/** 徽章格解析：认识的名字进 tags，不认识的原样退回给导入总结点名。 */
export function parseSkillTagsCell(cell: string | undefined): { tags: SkillTag[]; unknown: string[] } {
  const text = (cell ?? '').trim();
  if (text === '' || text === '无') return { tags: [], unknown: [] };
  const known: unknown[] = [];
  const unknown: string[] = [];
  for (const part of text.split(TAG_SPLIT)) {
    const piece = part.trim();
    if (piece === '' || piece === '无') continue;
    if (isSkillTag(piece)) known.push(piece.trim());
    else unknown.push(piece);
  }
  return { tags: uniqueTags(known), unknown };
}

type TriggerCarrier = {
  trigger?: { type: SkillTriggerType };
  effects?: readonly { trigger?: { type: SkillTriggerType } }[];
};

/** 这枚技能（含它的每条效果）实际会响在哪些时刻。 */
export function triggerTypesOf(skill: TriggerCarrier): SkillTriggerType[] {
  const out: SkillTriggerType[] = [];
  const push = (t?: SkillTriggerType) => {
    if (t && !out.includes(t)) out.push(t);
  };
  push(skill.trigger?.type);
  for (const e of skill.effects ?? []) push(e.trigger?.type);
  return out;
}

/**
 * 徽章名与实际触发时机的对账（刀1＝只点名、不改结算）：
 * 徽章是给人看的分类，真正决定响不响的是触发时机——两者说了不同的事时报出来，
 * 免得卡面写「登场技」而结算永远不在登场时响，玩家按卡面理解去打法。
 */
export function tagTimingWarnings(skill: TriggerCarrier & TagCarrier): string[] {
  const tags = tagsOf(skill);
  if (tags.length === 0) return [];
  const types = triggerTypesOf(skill);
  const label = (t: SkillTriggerType) => triggerTypeLabels[t];
  const items: string[] = [];
  const expects: [SkillTag, SkillTriggerType[]][] = [
    ['登场技', ['onDeploy', 'onOtherDeploy']],
    ['遗计技', ['onDeath']],
  ];
  for (const [tag, wanted] of expects) {
    if (!tags.includes(tag)) continue;
    if (types.length === 0) continue; // 没填任何时机＝还没录完，由录入面自己催，这里不重复报
    if (!types.some(t => wanted.includes(t))) {
      items.push(`${tag}：时机里没有「${wanted.map(label).join('」或「」')}」，实际响在「${types.map(label).join('」「') || '未填'}」`);
    }
  }
  return items;
}
