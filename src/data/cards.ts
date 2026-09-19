// 卡牌分为粮草牌、材料牌、军备牌三类
// 游戏中卡牌总量为52张：粮草牌17张，材料牌17张，军备牌（护甲牌）18张

export type CardType = '粮草' | '材料' | '军备';

export interface GameCard {
  id: string;
  name: string;
  type: CardType;
  description: string;
}

const grainNames = [
  '军粮·麦', '军粮·稻', '军粮·豆', '军粮·粟',
  '战地干粮', '精制口粮', '行军饭团', '军中酒水',
  '蜀中好酒', '江东鱼米', '河北大饼', '塞北干肉',
  '军粮辎重', '粮草补给', '百姓献粮', '丰收余粮', '战备存粮'
];

const materialNames = [
  '铁矿石', '精钢锭', '玄铁块', '金丝线',
  '兽皮革', '桐油火药', '硫磺粉', '箭竹',
  '白檀木', '蚕丝布', '铜铸件', '锡矿',
  '宝石原矿', '陨铁碎片', '龙骨材', '万年寒铁', '五色石'
];

const armorNames = [
  '铁盾', '木盾', '钢甲', '锁子甲',
  '鱼鳞甲', '铜墙护臂', '玄武盾', '青龙铠',
  '白虎甲', '朱雀披风', '龙纹护胸', '虎头盾',
  '百炼精甲', '金丝软甲', '寒铁重铠', '玄铁壁垒',
  '九环护身铠', '天蚕护甲'
];

function createCards(): GameCard[] {
  const cards: GameCard[] = [];
  
  grainNames.forEach((name, i) => {
    cards.push({
      id: `grain_${i + 1}`,
      name,
      type: '粮草',
      description: '消耗品，可用于补给将领或作为消耗弃置。',
    });
  });
  
  materialNames.forEach((name, i) => {
    cards.push({
      id: `material_${i + 1}`,
      name,
      type: '材料',
      description: '消耗品，可用于将领登场消耗或其他行动消耗。',
    });
  });
  
  armorNames.forEach((name, i) => {
    cards.push({
      id: `armor_${i + 1}`,
      name,
      type: '军备',
      description: '可用于增加将领护甲值，提供额外防护。',
    });
  });
  
  return cards;
}

export const allCards: GameCard[] = createCards();

export function createCardDeck(): GameCard[] {
  const deck = [...allCards];
  // Fisher-Yates shuffle
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}
