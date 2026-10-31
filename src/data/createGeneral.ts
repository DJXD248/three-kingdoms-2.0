// 造卡函数的唯一落点（v2.9.28 读法㈁从 `generals.ts` 搬出）：手写的 96 张官方卡与
// 由转换表生成的那一批共用这一支，「体力 4 点及以上＝武将、文将近战 1 远程 2」这套
// 换算因此只有一份。类型从这里反向 `import type` 进 `generals.ts`＝编译期就抹平，
// 不构成运行时循环。
import type { Faction, General, Skill } from './generals';

export function createGeneral(
  id: string,
  name: string,
  faction: Faction,
  hp: number,
  skills: Array<string | Skill>,
): General {
  const type = hp >= 4 ? '武将' : '文将';
  return {
    id,
    name,
    faction,
    hp,
    type,
    meleeAtk: type === '武将' ? 2 : 1,
    rangedAtk: type === '武将' ? 1 : 2,
    armor: 0,
    skills: skills.map(s => (typeof s === 'string' ? { name: s } : s)),
  };
}
