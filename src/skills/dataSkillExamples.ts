
import type { DataSkillDefinition } from './dataTypes';

export const DATA_SKILLS: DataSkillDefinition[] = [
  {
    id: 'jianxiong',
    name: '奸雄',
    trigger: 'onDamageTaken',
    description: '受到伤害后摸一张牌。',
    effects: [
      {
        type: 'DRAW_CARD',
        value: 1,
        target: 'SELF'
      }
    ]
  }
];
