// 本文件由 scripts/make-converted-generals.mjs 从仓库根的 转换后_三国卡牌.xlsx（工作表「可导入」）生成，**请勿手改**：
// 要改内容就改那张表，然后跑 `npm run roster-from-xlsx`。守卫测试＝scripts/generalsConverted.test.mjs 会拿表逐字对账。
//
// 表里 318 将（向下填充后）｜与官方名册同名同势力、按纪律跳过的 79 将｜本文件收下的 239 将｜技能格 472 枚。
// 这 239 张卡全部**只带卡面文字、不带结算载荷**⇒它们在牌桌上一声不响（今天会不会响＝表里那一列说的），
// 与名册里既有的"只有名字与说明、没有 runtime"那一路同一条纪律。带真结算内容的技能不进「技能表」⇒不改变「获得技能」的名单。
// 认不得的徽章名（原样留在表里、没有搬进名册）：无。
// 表里同一张卡上把同一个技能名列了两遍的行：1 行——已并成一枚（取有字那一行），名单与文字都没替玩家改。

import { createGeneral } from './createGeneral';
import type { General } from './generals';

export const SHEET_GENERALS: General[] = [
  createGeneral('sheet_shu_001', '伊籍', '蜀', 3, [
    { name: '机捷', description: '玩家抽卡时，其中一张可以改为从牌堆底部进行抽取' },
    { name: '急援', description: '你的远程伤害-1，你放置的回合可以移动及攻击', tags: ['锁定技'] },
  ]),
  createGeneral('sheet_shu_002', '严颜', '蜀', 4, [
    { name: '拒战', description: '你受到伤害后，直到己方玩家回合开始前，无法被其他角色选为攻击目标', tags: ['锁定技'] },
  ]),
  createGeneral('sheet_shu_003', '王平', '蜀', 4, [
    { name: '飞军', description: '回合限1次，一名其他角色撤退时，你可以弃1张牌，使其撤退失败' },
    { name: '兵略', description: '你可以弃置1张手牌，使一名进入战场区域的角色受到1点伤害' },
  ]),
  createGeneral('sheet_shu_004', '陈到', '蜀', 4, [
    { name: '往烈', description: '你无法撤退或被还原', tags: ['锁定技'] },
  ]),
  createGeneral('sheet_shu_005', '诸葛瞻', '蜀', 4, [
    { name: '罪论', description: '回合结束时，若己方玩家手牌数为1，你可以回复1点体力；为2，则使1名其他角色回复1点体力；为3，则对1名角色造成1点伤害' },
    { name: '父荫', description: '若被攻击时候，己方玩家有手牌则受到的伤害-1，反之受到伤害+1', tags: ['锁定技'] },
  ]),
  createGeneral('sheet_shu_006', '孙尚香', '蜀', 3, [
    { name: '良助', description: '回合限1次，你可以令一名其他角色获得你1层护甲' },
    { name: '返乡', description: '你可以用任意张非武将的手牌叠甲，然后失去「良助」，获得「枭姬」', tags: ['限定技'] },
  ]),
  createGeneral('sheet_shu_007', '关银屏', '蜀', 3, [
    { name: '血祭', description: '回合限1次，你可以失去1点体力，对相邻区域1名角色造成1点伤害。' },
    { name: '虎啸', description: '回合限1次，你击杀其他角色后可以立即进行一次攻击' },
    { name: '武继', description: '你击杀其他角色后，可以失去「虎啸」，增加1点体力上限，回复1点体力，近战攻击力+1', tags: ['限定技'] },
  ]),
  createGeneral('sheet_shu_008', '夏侯霸', '蜀', 4, [
    { name: '豹变', description: '己方回合中，你可以各自发动“挑衅”“咆哮”“神速”技能中的X个，回合结束时流失X+1点体力' },
  ]),
  createGeneral('sheet_shu_009', '夏侯氏', '蜀', 3, [
    { name: '樵拾', description: '回合限一次，你使自己和一名其他角色直到你的下个回合开始前受到压制' },
    { name: '燕语', description: '被压制的角色受到伤害-1，你的远程攻击-2', tags: ['锁定技'] },
  ]),
  createGeneral('sheet_shu_010', '张星彩', '蜀', 3, [
    { name: '甚贤', description: '回合限1次，其他角色因技能发动弃置手牌后，摸1张牌' },
    { name: '枪舞', description: '你所有伤害固定为1，体力上限-1，近战伤害指定近战范围的某一区域的所有角色', tags: ['锁定技'] },
  ]),
  createGeneral('sheet_shu_011', '甘夫人', '蜀', 3, [
    { name: '淑慎', description: '己方营地区域角色补给回复量+1' },
    { name: '神智', description: '放置时，使1名角色撤退一名区域' },
  ]),
  createGeneral('sheet_shu_012', '⭐张飞', '蜀', 4, [
    { name: '嫉恶', description: '受到体力值大于你的角色攻击伤害-1', tags: ['锁定技'] },
    { name: '大喝', description: '攻击体力值小于你的角色时，可以使其获得：本回合结束前受到的所有伤害+1或者是使其撤退' },
  ]),
  createGeneral('sheet_shu_013', '⭐刘备', '蜀', 4, [
    { name: '昭烈', description: '你的攻击伤害为手牌红色牌数量（最多为3），但攻击后你流失手牌无色和黑色牌的体力值（至少为1）。', tags: ['锁定技'] },
    { name: '誓仇', description: '击杀你的角色获得：受到的伤害+1' },
  ]),
  createGeneral('sheet_shu_014', '马岱', '蜀', 4, [
    { name: '马术', description: '你每回合可以额外进行一次移动' },
    { name: '潜袭', description: '回合限1次，你近战攻击其他角色后可以弃1张牌，如为红色/黑色，该角色直到下个己方回合前被压制' },
  ]),
  createGeneral('sheet_shu_015', '法正', '蜀', 3, [
    { name: '眩惑', description: '弃1张手牌，使一名其他角色对其攻击范围内一名你指定其他角色发动一次攻击', tags: ['限定技'] },
    { name: '恩怨', description: '受到伤害后，伤害来源玩家选择1、交1张手牌给己方玩家，2、你令一名其他角色失去1点体力；当你因其他角色技能回复体力值时，结算结束后，你与其各回复1点体力', tags: ['锁定技'] },
  ]),
  createGeneral('sheet_shu_016', '关兴&张苞', '蜀', 4, [
    { name: '父魂', description: '弃1张手牌，本回合结束前获得“武圣”“咆哮”' },
  ]),
  createGeneral('sheet_shu_017', '简雍', '蜀', 3, [
    { name: '巧说', description: '回合限1次，己方玩家可以选择交1手牌给其他玩家，令其一名角色撤退或者移动一名区域' },
    { name: '纵适', description: '弃1张手牌，使两名其他角色交换近战攻击力', tags: ['限定技'] },
  ]),
  createGeneral('sheet_shu_018', '周仓', '蜀', 4, [
    { name: '忠勇', description: '回合限一次，你攻击消耗的手牌若为红色可以将其为一名其他角色叠甲' },
  ]),
  createGeneral('sheet_shu_019', '吴懿', '蜀', 4, [
    { name: '奔袭', description: '移动需要弃置1张手牌，回合移动后，所有攻击力+1直到回合结束。', tags: ['锁定技'] },
  ]),
  createGeneral('sheet_shu_020', '张松', '蜀', 3, [
    { name: '强识', description: '远程攻击-1，回合限一次，己方角色补给/攻击/发动技能消耗的牌可以选取1张回到手上' },
    { name: '献图', description: '死亡时，让己方角色观察其他角色的手牌并各获取1张' },
  ]),
  createGeneral('sheet_shu_021', '刘谌', '蜀', 4, [
    { name: '战绝', description: '己方角色死亡时，你可以弃1张手牌，对伤害来源发起1次「决斗」（其中一方死亡则终止结算）' },
  ]),
  createGeneral('sheet_shu_022', '董允', '蜀', 3, [
    { name: '秉正', description: '回合结束，可以使一名己方没有移动的角色回复1点体力' },
    { name: '舍宴', description: '你所在区域有角色受到技能伤害时，你可以使自己回避此技能伤害，你的补给量-1', tags: ['锁定技'] },
  ]),
  createGeneral('sheet_shu_023', '黄皓', '蜀', 3, [
    { name: '寝情', description: '你所有攻击力-1。己方玩家结束时，己方全部角色恢复1点体力', tags: ['锁定技'] },
    { name: '贿生', description: '等你受到伤害时候，可以将受到伤害数+1的手牌交给伤害来源玩家，伤害结算后将体力恢复至上限' },
  ]),
  createGeneral('sheet_shu_024', '马云禄', '蜀', 4, [
    { name: '马术', description: '你每回合可以额外进行一次移动' },
    { name: '凤魄', description: '你的远程攻击力-1。你攻击体力值大于等于你的角色时不需要消耗手牌', tags: ['锁定技'] },
  ]),
  createGeneral('sheet_shu_025', '糜夫人', '蜀', 3, [
    { name: '闺秀', description: '使1个区域的所有目标回复1点体力', tags: ['限定技'] },
    { name: '存嗣', description: '你的远程伤害-1。死亡时，使一名角色回复1点体力，撤退至营地区域。', tags: ['锁定技'] },
  ]),
  createGeneral('sheet_shu_026', '糜竺', '蜀', 3, [
    { name: '资援', description: '回合限一次，玩家第一次补给角色的补给量+1' },
    { name: '巨贾', description: '玩家手牌数大于等于6时，近战攻击力+1；玩家手牌为0时，近战攻击力-1', tags: ['锁定技'] },
  ]),
  createGeneral('sheet_shu_027', '孙乾', '蜀', 3, [
    { name: '谦雅', description: '你无法叠甲，远程攻击力-1。己方场上又其他角色时，你无法被攻击。', tags: ['锁定技'] },
    { name: '说盟', description: '当你移动时，可以让一名其他玩家的一名角色移动或撤退' },
  ]),
  createGeneral('sheet_shu_028', '赵襄', '蜀', 4, [
    { name: '芳魂', description: '回合限1次，若你体力值≥3，你可以发动龙胆效果②；若你体力值≤2，可以发动龙胆效果①' },
    { name: '扶汉', description: '己方营地受到伤害时，可以改为令你失去两点体力', tags: ['限定技'] },
    { name: '龙胆', description: '回合限1次，选择：1、放弃攻击回复1点体力，2、失去1点体力，额外进行一次攻击' },
  ]),
  createGeneral('sheet_shu_029', '张翼', '蜀', 4, [
    { name: '殿军', description: '你的远程伤害-1，于你同一区域的其他角色无法被攻击', tags: ['锁定技'] },
    { name: '亢锐', description: '你被攻击后，近战攻击力+1，获得无法移动，攻击其他角色后还原' },
  ]),
  createGeneral('sheet_shu_030', '张嶷', '蜀', 4, [
    { name: '抚戎', description: '回合限1次，你可以选择一名其他玩家获得你给予的1张手牌，你使该玩家的1名角色撤退' },
    { name: '矢志', description: '其他玩家角色撤退时，可以弃置1张手牌对该角色造成1点伤害' },
  ]),
  createGeneral('sheet_shu_031', '马忠', '蜀', 4, [
    { name: '抚蛮', description: '回合开始时可以让己方一名角色撤退一名区域，若有角色撤退回手牌则直到本回合结束你远程攻击力+1' },
  ]),
  createGeneral('sheet_shu_032', '秦宓', '蜀', 3, [
    { name: '谏征', description: '回合限1次，你可以弃置1张手牌，使一名其他角色直到下个己方玩家回合前无法移动' },
    { name: '专对', description: '回合限1次，使一名其他角色撤退一名区域，然后你撤退一名区域' },
    { name: '天辩', description: '当你撤退时，你可以改为移动' },
  ]),
  createGeneral('sheet_shu_033', '沙摩柯', '蜀', 4, [
    { name: '蒺藜', description: '放置时，对一名角色造成1点伤害，若该角色因此死亡，你可以重复执行一次，最多限3次' },
  ]),
  createGeneral('sheet_shu_034', '李密', '蜀', 3, [
    { name: '辞应', description: '每回合限1次，你可以使1名其他玩家弃置1张手牌，回合结束己方玩家弃置1张手牌' },
    { name: '陈笃', description: '己方玩家于本回合第一次弃置手牌改为展示手牌', tags: ['锁定技'] },
  ]),
  createGeneral('sheet_shu_035', '梦诸葛亮', '蜀', 3, [
    { name: '问天', description: '回合开始时，你可以进行1次判定，如为黑色，则己方玩家获得之，如为红色，则对1名受伤角色造成1点伤害' },
    { name: '出师', description: '当场上己方角色数量为最少时，己方角色受到的所有伤害-1' },
    { name: '隐略', description: '死亡时，使1名其他角色获得攻击不消耗手牌效果' },
  ]),
  createGeneral('sheet_shu_036', '合赵云', '蜀', 4, [
    { name: '龙临', description: '当己方其他角色受到伤害时，你可以弃置1张手牌，使其无效，然后伤害来源对你发起一次【决斗】' },
    { name: '镇胆', description: '你【决斗】中受到的伤害-1', tags: ['锁定技'] },
  ]),
  createGeneral('sheet_shu_037', '刘永', '蜀', 4, [
    { name: '丹心', description: '回合限1次，你可以获得一名近战区域角色的所有护甲，若如此做，则己方玩家给予该角色的玩家2张非武将手牌' },
    { name: '封乡', description: '你受到伤害后，若你有护甲，你可以转移护甲到伤害来源，对其造成1点伤害' },
  ]),
  createGeneral('sheet_shu_038', '转张飞', '蜀', 4, [
    { name: '暴喝', description: '放置时，使一名玩家所有角色撤退一名区域' },
    { name: '虚势', description: '你所在区域的后1个区域角色无法被选为攻击目标', tags: ['锁定技'] },
  ]),
  createGeneral('sheet_shu_039', '转黄忠', '蜀', 4, [
    { name: '摧锋', description: '当你进行攻击后-1近战攻击力，+1远程攻击力，你的体力上限为1', tags: ['锁定技'] },
    { name: '登难', description: '若你近战攻击力为0，你可以选择对对方营地和支援战线区域所有目标造成1点伤害，然后你流失4点体力', tags: ['限定技'] },
  ]),
  createGeneral('sheet_shu_040', '高翔', '蜀', 4, [
    { name: '驰应', description: '放置时，若己方角色数量全场最少，则本回合，你可以额外进行一次移动级攻击' },
  ]),
  createGeneral('sheet_shu_041', '关索', '蜀', 4, [
    { name: '征南', description: '当你击杀角色后，你可以选择「当先」、「制蛮」之一获得，你已拥有「当先」「制蛮」后击杀角色，获得「武圣」' },
    { name: '撷芳', description: '你对男性角色造成的伤害-1，你攻击女性角色时无视对方护甲', tags: ['锁定技'] },
    { name: '当先', description: '你每回合可以多攻击1次，回合第二次攻击伤害减半（向下取整）', tags: ['锁定技'] },
    { name: '武圣', description: '远程伤害+1' },
    { name: '制蛮', description: '弃置1张手牌使一名角色直到下个己方回合无法撤退' },
  ]),
  createGeneral('sheet_shu_042', '鲍三娘', '蜀', 3, [
    { name: '武娘', description: '你近战攻击力+1，远程攻击力-1', tags: ['锁定技'] },
    { name: '许身', description: '当一名男性角色受到攻击伤害后，可以弃置1张手牌，你与其各回复1点体力，然后你获得「镇南」', tags: ['限定技'] },
    { name: '镇南', description: '回合限1次，一名其他角色撤退时，你可以弃1张牌，使其直到下个己方玩家回合前无法移动' },
  ]),
  createGeneral('sheet_shu_043', '赵统＆赵广', '蜀', 4, [
    { name: '翊赞', description: '回合限一次，你可以放弃攻击，弃3张手牌对任意位置的一名角色造成1点伤害。' },
    { name: '龙渊', description: '己方回合如果你没有对其他角色造成过伤害回合结束则流失2点体力，每当你使用“翊赞”击杀其他角色，你减少1点体力上限，使“翊赞”造成的伤害+1。', tags: ['锁定技'] },
  ]),
  createGeneral('sheet_shu_044', '杨仪', '蜀', 3, [
    { name: '定措', description: '回合限一次，你可以将己方两不同角色的位置进行交换' },
    { name: '狷狭', description: '己方其他角色受到的补给量-1。', tags: ['锁定技'] },
  ]),
  createGeneral('sheet_shu_045', '吕凯', '蜀', 3, [
    { name: '图南', description: '己方有攻击力大于等于3的角色攻击时，你可以流失2体力，让其本次伤害-1，本次攻击目标为区域内的所有角色' },
    { name: '闭境', description: '你远程攻击力-1。当己方支援区域没有角色时候，其他玩家的角色无法进入', tags: ['锁定技'] },
  ]),
  createGeneral('sheet_shu_046', '雷铜', '蜀', 4, [
    { name: '溃击', description: '当你击杀角色时，你可以对其所在区域后方一名区域的一名角色造成1点伤害' },
  ]),
  createGeneral('sheet_shu_047', '吴班', '蜀', 4, [
    { name: '斩钉', description: '你对近战区域的角色造成的伤害均为流失1点体力', tags: ['锁定技'] },
    { name: '穆荫', description: '己方场上蜀势力吴姓将领体力上限+1', tags: ['锁定技'] },
  ]),
  createGeneral('sheet_shu_048', '黄权', '蜀', 3, [
    { name: '点虎', description: '放置时，选择一名其他玩家的角色。直到你死亡或离开场上，你对该角色造成伤害或该角色回复体力后，己方玩家摸一张牌' },
    { name: '谏计', description: '选择一名其他角色，己方玩家摸一张牌，若为装备牌，其可以进行一次攻击', tags: ['限定技'] },
  ]),
  createGeneral('sheet_shu_049', '费祎', '蜀', 3, [
    { name: '谏喻', description: '你可以指定一名其他角色，直到你死亡或离开场上，其无法被指定为攻击目标。', tags: ['限定技'] },
    { name: '生息', description: '你的所有攻击力-1。己方角色营地区域的角色所有攻击力-1，回合结束，营地区域所有角色恢复2点体力。', tags: ['锁定技'] },
  ]),
  createGeneral('sheet_shu_050', '邓芝', '蜀', 3, [
    { name: '简亮', description: '所有攻击力-1。无法被其他角色技能直接选择作为目标。', tags: ['锁定技'] },
    { name: '危盟', description: '回合限一次，你可以进行一次投掷，若点数为6，则可以指定一名其他玩家直到下个回合无法攻击己方角色' },
  ]),
  createGeneral('sheet_shu_051', '诸葛尚', '蜀', 3, [
    { name: '三顾', description: '你可以弃置1张手牌，选择一名其他角色直到己方下回合开始前，该角色攻击时目标可以由你来选择变更为其他目标。', tags: ['限定技'] },
    { name: '轶祖', description: '你的所有攻击力-1，你被攻击后本回合结束前可以获得【空城】或【八卦】', tags: ['锁定技'] },
    { name: '空城', description: '同一名区域不存在其他角色，则受到的近战、远程伤害-1', tags: ['锁定技'] },
    { name: '八卦', description: '当你受到伤害后，可以进行1次判定，如为黑色，玩家获得之，如为红色，受到伤害-1' },
  ]),
  createGeneral('sheet_shu_052', '王甫＆赵累', '蜀', 4, [
    { name: '殉义', description: '放置时，选择一名己方角色。直到你死亡或离开场上，该角色造成伤害后，你摸一张牌；该角色被击杀时，你对伤害来源发起一次「决斗」。' },
  ]),
  createGeneral('sheet_shu_053', '刘巴', '蜀', 3, [
    { name: '统度', description: '回合限一次，你可以弃置手牌上X张装备牌，摸X+2的手牌' },
    { name: '铸币', description: '你的所有伤害-1。己方回合摸牌，可以改为投掷3次骰子之和除2（向上取整）', tags: ['锁定技'] },
  ]),
  createGeneral('sheet_shu_054', '李严', '蜀', 3, [
    { name: '督粮', description: '回合限1次，放弃摸牌选择：①，翻开牌堆顶7张牌，获得其中的非装备牌；②，直到下个己方玩家回合前，每当回合结束时摸2张牌' },
    { name: '腹鳞', description: '你的远程攻击力-1。每当回合结束时，本回合己方玩家有获得牌，则你回复1点体力，战场区域的己方角色流失1点体力', tags: ['锁定技'] },
  ]),
  createGeneral('sheet_shu_055', '吴兰', '蜀', 4, [
    { name: '挫锐', description: '回合限一次，当你击杀战场区域的角色时候，你对战场其他角色均造成1点伤害' },
  ]),
  createGeneral('sheet_shu_056', '傅肜', '蜀', 4, [
    { name: '效死', description: '回合限一次，你可以流失3点体力，本回合结束前使一名角色的一次攻击造成的伤害+1。' },
  ]),
  createGeneral('sheet_shu_057', '李丰', '蜀', 3, [
    { name: '屯储', description: '回合限1次，你可以放弃移动和攻击，摸1张牌' },
    { name: '输量', description: '每当回合结束时，若己方玩家手牌数≥5，你需要进行一次移动；你进入战场区域时，战场区域的其他己方角色回复1点体力' },
  ]),
  createGeneral('sheet_shu_058', '陈震', '蜀', 3, [
    { name: '歃盟', description: '回合限一次，你可以弃置2张相同花色的牌，让一名其他玩家摸2张牌，己方玩家摸3张牌' },
  ]),
  createGeneral('sheet_shu_059', '霍峻', '蜀', 4, [
    { name: '穷守', description: '你无法叠甲，近战攻击力-1，受到的所有伤害-1。', tags: ['锁定技'] },
    { name: '奋锐', description: '回合限一次，当你受到伤害时，你可以使受到伤害+1。伤害结算后将伤害一半（向上取整）给与伤害来源' },
  ]),
  createGeneral('sheet_shu_060', '马承', '蜀', 4, [
    { name: '马术', description: '你每回合可以额外进行一次移动' },
    { name: '骋烈', description: '你的所有攻击力-1。你的近战攻击力攻击时+本回合移动的次数。', tags: ['锁定技'] },
  ]),
  createGeneral('sheet_shu_061', '许靖', '蜀', 3, [
    { name: '誉虚', description: '回合限1次，己方玩家可以摸1张牌，若如此做，本回合结束时己方玩家弃1张牌或你流失1点体力' },
    { name: '实荐', description: '若可以，己方玩家翻开武将池顶三张牌，选择其中一名武将以1体力值状态在营地区域放置。', tags: ['限定技'] },
  ]),
  createGeneral('sheet_shu_062', '吴苋', '蜀', 3, [
    { name: '福绵', description: '你的远程攻击力-1，己方蜀势力吴姓角色受到的远程伤害-1', tags: ['锁定技'] },
    { name: '怠宴', description: '己方玩家回合结束时，若本回合攻击过的己方角色大于一半，则你流失一点体力，如果小于等于一半，则己方角色恢复1点体力。' },
  ]),
  createGeneral('sheet_wei_001', '甄宓', '魏', 3, [
    { name: '洛神', description: '当你被攻击时候，可以弃置1张手牌使伤害-1，或弃置2张手牌回避此伤害' },
    { name: '倾国', description: '当其他角色技能判定后，若其判定牌为黑色，则你回复1点体力', tags: ['锁定技'] },
  ]),
  createGeneral('sheet_wei_002', '王基', '魏', 4, [
    { name: '奇制', description: '放置时，你可以使1名其他角色撤退返回手牌' },
    { name: '进趋', description: '当你进入战场区域时，对近战区域所有目标造成1点伤害' },
  ]),
  createGeneral('sheet_wei_003', '蒯良&蒯越', '魏', 3, [
    { name: '荐降', description: '你可以弃置两张牌，收缴一名体力值为1的其他玩家角色', tags: ['限定技'] },
    { name: '审时', description: '你被击杀时，改为被对方收缴', tags: ['限定技'] },
  ]),
  createGeneral('sheet_wei_004', '郝昭', '魏', 4, [
    { name: '镇骨', description: '受到的攻击伤害-1，你后方区域的角色受到的攻击伤害-1', tags: ['锁定技'] },
  ]),
  createGeneral('sheet_wei_005', '毋丘俭', '魏', 4, [
    { name: '征荣', description: '你击杀相邻区域内最后一名角色后，可以移动/撤退到该区域' },
    { name: '鸿举', description: '你回合内进行第二次移动后，可以弃1张牌，获得「清侧」（你可以放弃攻击，将本回合的移动改为撤退)', tags: ['觉醒技'] },
  ]),
  createGeneral('sheet_wei_006', '杨修', '魏', 3, [
    { name: '啖酪', description: '你受到技能伤害后，可以发动一次远程攻击', tags: ['锁定技'] },
    { name: '鸡肋', description: '你移动后直到下个己方玩家回合开始前被压制', tags: ['锁定技'] },
  ]),
  createGeneral('sheet_wei_007', '庞德', '魏', 4, [
    { name: '马术', description: '你每回合可以额外进行一次移动' },
    { name: '决死', description: '你被选择为攻击目标时，己方玩家可以弃一手牌，将本次攻击改为【决斗】', tags: ['限定技'] },
  ]),
  createGeneral('sheet_wei_008', '蔡文姬', '魏', 3, [
    { name: '陈情', description: '己方角色在其他玩家回合不能被移出场外（调离）' },
    { name: '默识', description: '死亡时，可以观看其他一名玩家的手牌' },
  ]),
  createGeneral('sheet_wei_009', '贾诩', '魏', 3, [
    { name: '缜略', description: '放置时，选择2名角色各自流失1点体力' },
    { name: '间书', description: '你可以使1名角色对体力值不大于其的角色造成2点伤害', tags: ['限定技'] },
    { name: '拥嫡', description: '你可以使1名角色体力值上限+1', tags: ['限定技'] },
  ]),
  createGeneral('sheet_wei_010', '曹洪', '魏', 4, [
    { name: '援护', description: '你同一区域内的其他角色无法被攻击' },
  ]),
  createGeneral('sheet_wei_011', '陈琳', '魏', 3, [
    { name: '笔伐', description: '放置时可以弃置X张黑色手牌，使X个角色受到1点伤害（X大于3，你回复1点体力）' },
    { name: '颂词', description: '远程攻击-1，放置时可以弃置X张红色手牌，使X个角色回复2点体力' },
  ]),
  createGeneral('sheet_wei_012', '乐进', '魏', 4, [
    { name: '骁果', description: '回合限1次，选定1个有护甲的角色，使其选择弃置所有护甲，如其不弃置，则该角色失去1点体力' },
  ]),
  createGeneral('sheet_wei_013', '曹昂', '魏', 4, [
    { name: '慷忔', description: '你攻击范围内的角色攻击时，你可以使其攻击目标改为你' },
  ]),
  createGeneral('sheet_wei_014', '诸葛诞', '魏', 4, [
    { name: '功獒', description: '当你击杀其他角色后回复1点体力值' },
    { name: '举义', description: '使用功獒后，可以弃1张手牌获得技能“崩坏”和锁定技：流失体力时对近战区域的1个目标造成1点伤害', tags: ['觉醒技'] },
  ]),
  createGeneral('sheet_wei_015', '文聘', '魏', 4, [
    { name: '镇卫', description: '同一回合内，受到的第二次伤害降低到1点' },
  ]),
  createGeneral('sheet_wei_016', '司马朗', '魏', 3, [
    { name: '郡兵', description: '你所在的区域没有其他角色时候，你体力上限+1，你所有攻击力-1' },
    { name: '去疾', description: '你所在区域的其他角色在己方回合结束可以回复1点体力' },
  ]),
  createGeneral('sheet_wei_017', '⭐曹仁', '魏', 4, [
    { name: '溃围/伪溃', description: '己方场上角色数量为最少时候，你受到的近战伤害-1，近战攻击力+1，回合结束时你回复1点体力' },
    { name: '严整/励战', description: '你受到的远程攻击伤害-1，你的护甲值上限+1', tags: ['锁定技'] },
  ]),
  createGeneral('sheet_wei_018', '⭐夏侯惇', '魏', 4, [
    { name: '愤勇', description: '你受到伤害后，获得：体力上限-1，受到非技能伤害-1，近战攻击力-1', tags: ['锁定技'] },
    { name: '雪恨', description: '回合限一次，你可以使体力上限-1，本回合近战攻击力+1，若击杀其他角色则体力上限+1' },
  ]),
  createGeneral('sheet_wei_019', '姜维', '魏', 4, [
    { name: '困奋', description: '己方玩家回合结束时，你流失1点体力，抽取1张手牌为你叠甲' },
    { name: '逢亮', description: '当被击杀时，你回复到2点体力并放置到营地区域，获得“挑衅”', tags: ['限定技'] },
    { name: '“挑衅”', description: '回合限1次，令一名其他攻击范围内的角色对你进行攻击，若你存活，则回复1点体力，并对其造成1点伤害' },
  ]),
  createGeneral('sheet_wei_020', '于禁', '魏', 4, [
    { name: '镇军', description: '可以弃1张黑色牌，使受到的远程伤害-1。你的回合限1次，可以弃1张红色牌摸1张牌。' },
  ]),
  createGeneral('sheet_wei_021', '曹植', '魏', 3, [
    { name: '落英', description: '回合开始时，进行一次判定，若为黑色，本回合无法移动；若为红色，本回合无法攻击。' },
    { name: '酒诗', description: '无法进行远程攻击，死亡时，以1血加入营地区域', tags: ['锁定技'] },
  ]),
  createGeneral('sheet_wei_022', '曹彰', '魏', 4, [
    { name: '将驰', description: '己方玩家回合开始时选择，①：本回合摸牌量-2，你可以额外进行一次无消耗的攻击或移动。②：摸两张牌，你本回合放弃移动及攻击。' },
  ]),
  createGeneral('sheet_wei_023', '曹冲', '魏', 3, [
    { name: '称象', description: '放置时，使一名其他玩家的两名角色交换位置' },
    { name: '仁心', description: '其他角色被击杀时，你可以流失3点体力，使该角色在其玩家的营地区域以1体力加入' },
  ]),
  createGeneral('sheet_wei_024', '郭淮', '魏', 4, [
    { name: '精策', description: '回合结束，若己方玩家没有手牌，则摸1张手牌' },
  ]),
  createGeneral('sheet_wei_025', '曹真', '魏', 4, [
    { name: '司敌', description: '回合限1次，其他玩家角色攻击后，你可以流失1点体力，使其直到其玩家下个回合前被压制' },
  ]),
  createGeneral('sheet_wei_026', '陈群', '魏', 3, [
    { name: '品第', description: '己方角色数为全场最多时，己方角色第一名攻击的角色不需要消耗手牌' },
    { name: '法恩', description: '死亡时，将一名其他角色移除出场外直到下个己方玩家回合返回场上' },
  ]),
  createGeneral('sheet_wei_027', '韩浩&史涣', '魏', 4, [
    { name: '慎断', description: '你移动需要花费1张手牌' },
    { name: '勇略', description: '其他玩家补给角色时候，你可以弃置1张手牌，使其补给量-1' },
  ]),
  createGeneral('sheet_wei_028', '曹叡', '魏', 3, [
    { name: '恢拓', description: '远程攻击力-1，回合限一次，被攻击时，先进行一次判定，红色，回复2体力；黑色，本回合受到的伤害-2' },
    { name: '明鉴', description: '你可以弃置1手牌，使自己体力上限-1，使一名其他角色体力上限+2', tags: ['限定技'] },
  ]),
  createGeneral('sheet_wei_029', '曹休', '魏', 4, [
    { name: '千驹', description: '当你失去护甲时，你可以进行一次移动或撤退', tags: ['锁定技'] },
    { name: '倾袭', description: '放置时，对战场区域的所有目标造成1点伤害' },
  ]),
  createGeneral('sheet_wei_030', '钟繇', '魏', 3, [
    { name: '活墨', description: '放置时，己方玩家摸1张手牌' },
    { name: '佐定', description: '死亡时，使一名角色回复或流失1点体力' },
  ]),
  createGeneral('sheet_wei_031', '合郭照', '魏', 3, [
    { name: '偏宠', description: '放置时，当场上没有其他女性角色，你的近战攻击力+1' },
    { name: '尊位', description: '回合限一次，你可以令一名女性角色本回合非锁定技失效' },
  ]),
  createGeneral('sheet_wei_032', '梦郭嘉', '魏', 3, [
    { name: '轻辎', description: '放置技，使一名其他角色获得“神速”' },
    { name: '定策', description: '己方角色受到的技能伤害-1' },
    { name: '针锋', description: '将己方和其他玩家各1个角色移出场外（调离），直到你死亡或离开场上为止', tags: ['限定技'] },
  ]),
  createGeneral('sheet_wei_033', '娄圭', '魏', 3, [
    { name: '沙城', description: '回合限一次，你可以放弃移动并弃置1张牌，直到下个己方回合开始前，同一区域内的其他角色不能成为技能的目标' },
    { name: '凝寒', description: '你可以放弃攻击并弃置1张牌，直到下个己方回合开始前，同一区域内的角色受到的所有伤害-2', tags: ['限定技'] },
  ]),
  createGeneral('sheet_wei_034', '夏侯荣', '魏', 3, [
    { name: '奋剑', description: '无法撤退，无法被补给，当同一区域的其他角色死亡时，你近战攻击力+1。', tags: ['锁定技'] },
  ]),
  createGeneral('sheet_wei_035', '合司马懿', '魏', 3, [
    { name: '鹰视', description: '回合限1次，可以选择观看2张武将池的牌' },
    { name: '蜕骨', description: '你的所有攻击力-1，被选择为攻击目标时你进行一次撤退。', tags: ['锁定技'] },
  ]),
  createGeneral('sheet_wei_036', '曹芳', '魏', 3, [
    { name: '招图', description: '放置时，使一名受伤角色回复1点体力' },
    { name: '惊惧', description: '当你撤退之后，使与你同一区域的角色近战攻击力-1直到下个己方玩家回合开始' },
  ]),
  createGeneral('sheet_wei_037', '郭循', '魏', 4, [
    { name: '遏前', description: '你所有攻击力-1', tags: ['锁定技'] },
    { name: '伏杀', description: '回合结束时，若你未进行移动和攻击，你近战攻击力+1。你移动、撤退或攻击后还原自身。' },
  ]),
  createGeneral('sheet_wei_038', '兴文鸯', '魏', 4, [
    { name: '覆阵', description: '放置时，使一名其他玩家的所有角色撤退一名区域，然后受到1点伤害' },
  ]),
  createGeneral('sheet_wei_039', '兴邓艾', '魏', 4, [
    { name: '辟奇', description: '你可以放弃移动和攻击，将自身移出场外（调离），下个己方回合开始时回到场上任意可以进入的区域', tags: ['限定技'] },
    { name: '骤临', description: '你放置或回到场上时，可以对相邻区域的一名目标造成1点伤害', tags: ['锁定技'] },
  ]),
  createGeneral('sheet_wei_040', '兴诸葛诞', '魏', 4, [
    { name: '坐瞻', description: '若你回合中没有攻击和移动，则回合结束你获得：无法被攻击，直到场上有角色死亡为止' },
    { name: '摧冰', description: '你被攻击前，你先对攻击来源造成1点伤害' },
    { name: '阑干', description: '当你同一区域其他角色死亡时候，你流失1点体力', tags: ['锁定技'] },
  ]),
  createGeneral('sheet_wei_041', '戏志才', '魏', 3, [
    { name: '天妒', description: '如有判定牌进入弃牌堆，你可以流失1点体力选择使己方玩家获得之' },
    { name: '先辅', description: '每回合结束流失1点体力，为一名其他角色恢复1点体力', tags: ['锁定技'] },
    { name: '筹策', description: '死亡时，使一名其他角色获得“先辅”或“天妒”' },
  ]),
  createGeneral('sheet_wei_042', '曹纯', '魏', 4, [
    { name: '缮甲', description: '如你有护甲，每回合可以额外进行一次移动', tags: ['锁定技'] },
  ]),
  createGeneral('sheet_wei_043', '程昱', '魏', 3, [
    { name: '贲育', description: '当己方场上角色最多时，你受到伤害-1，否则受到的伤害+1', tags: ['锁定技'] },
    { name: '设伏', description: '回合限1次，弃置1张手牌，使其他角色的一次攻击失效' },
  ]),
  createGeneral('sheet_wei_044', '蒋干', '魏', 3, [
    { name: '伪诚', description: '若你所在区域的角色数量少于你前方区域的角色数量，则你无法被攻击' },
    { name: '盗书', description: '无法远程攻击，己方回合结束后，可以选择观看一名其他玩家的1张手牌', tags: ['锁定技'] },
  ]),
  createGeneral('sheet_wei_045', '朱灵', '魏', 4, [
    { name: '战意', description: '当你击杀其他角色后可以流失1点体力值，立即再进行一次攻击' },
  ]),
  createGeneral('sheet_wei_046', '曹嵩', '魏', 3, [
    { name: '礼赂', description: '其他玩家回合，你可以将1张手牌，交给该玩家，使己方1名角色本回合无法被攻击' },
    { name: '翊正', description: '死亡时，你可以进行一次判定，若为黑色将一名己方其他角色移出场外（调离）直到己方下个回合；若为红色将一名其他角色移出场外（调离）直到其玩家的下个回合' },
  ]),
  createGeneral('sheet_wei_047', '夏侯恩', '魏', 4, [
    { name: '护剑', description: '你有护甲时，受到的伤害+1\n（攻击范围包含你的其他玩家角色必须指定你为攻击目标）', tags: ['锁定技'] },
    { name: '恃力', description: '受到的近战伤害-1，受到的技能伤害+1', tags: ['锁定技'] },
  ]),
  createGeneral('sheet_wei_048', '文鸯', '魏', 4, [
    { name: '膂力', description: '当你击杀2名其他角色时，获得“无双”' },
    { name: '仇决', description: '死亡时，对最后一名攻击你的角色造成2点伤害' },
  ]),
  createGeneral('sheet_wei_049', '王粲', '魏', 3, [
    { name: '七哀', description: '场上其他角色死亡时，其死亡时触发的技能次数+1' },
    { name: '善檄', description: '己方其他角色收到伤害后，你可以弃1张手牌使其撤退一名区域' },
  ]),
  createGeneral('sheet_wei_050', '嵇康', '魏', 3, [
    { name: '清弦', description: '放置时，使一名角色回复1点体力或撤退一名区域' },
    { name: '绝响', description: '死亡时，使一名角色流失1点体力或向前移动一名区域' },
  ]),
  createGeneral('sheet_wei_051', '郭皇后', '魏', 3, [
    { name: '矫诏', description: '回合限一次，你可以流失1点体力，令一名角色撤退一名区域' },
    { name: '殚心', description: '死亡时，使己方营地区域一名目标回复1点体力' },
  ]),
  createGeneral('sheet_wei_052', '董昭', '魏', 3, [
    { name: '先略', description: '你可以选择一名其他己方角色移出场外（调离），下个己方回合开始时其加入战场区域', tags: ['限定技'] },
    { name: '造王', description: '你可以使1名角色体力值上限+2，其被击杀时，己方营地流失2点体力', tags: ['限定技'] },
  ]),
  createGeneral('sheet_wei_053', '羊枯', '魏', 3, [
    { name: '德劭', description: '你攻击或受到攻击时，可以使攻击来源玩家和己方玩家一起弃置X张牌（X最多为3）' },
    { name: '明伐', description: '选择一名角色，让其获得“受到己方玩家的角色攻击伤害+1”', tags: ['限定技'] },
  ]),
  createGeneral('sheet_wei_054', '邓忠', '魏', 4, [
    { name: '勘破', description: '回合限一次，你攻击其他角色后，若其玩家手牌数大于己方玩家，则其弃置1张牌' },
    { name: '更战', description: '你无法撤退。己方玩家没有手牌时，你近战攻击体力值大于你的角色伤害+1', tags: ['锁定技'] },
  ]),
  createGeneral('sheet_wei_055', '蔡瑁＆张允', '魏', 4, [
    { name: '连舟', description: '回合开始时，选择两名其他己方角色放弃移动，本回合你移动时令其一起移动一名区域。' },
    { name: '惊澜', description: '你无法撤退。当你受到≥2点的技能伤害时，相邻区域的己方角色也受到1点伤害', tags: ['锁定技'] },
  ]),
  createGeneral('sheet_wei_056', '田豫', '魏', 4, [
    { name: '扫狄', description: '当你远程攻击时，近战区域的一名角色也会受到你的远程攻击伤害' },
    { name: '追讨', description: '当你远程攻击其他角色后，你需向前移动一名区域。', tags: ['锁定技'] },
  ]),
  createGeneral('sheet_wei_057', '李通', '魏', 4, [
    { name: '推峰', description: '当你在回合外受到伤害后，你可以弃置2张牌，使下个己方回合，你的第一次攻击伤害+1。' },
  ]),
  createGeneral('sheet_wei_058', '鲁芝', '魏', 3, [
    { name: '清忠', description: '己方回合结束时，你可以与一名体力值或护甲小于你的角色交换体力值或护甲。' },
    { name: '卫境', description: '回合限一次，选择，①：本回合你的攻击及移动无消耗；②：己方玩家可以用1张非武将的手牌为你叠甲' },
  ]),
  createGeneral('sheet_wei_059', '辛毗', '魏', 3, [
    { name: '持节', description: '其他玩家回合限1次，己方角色成为其他玩家角色攻击目标时，你可以弃置1张手牌令此次攻击无效' },
    { name: '引裾', description: '你可以选择一名其他角色，本回合你对其造成的伤害改为回复等量体力', tags: ['限定技'] },
  ]),
  createGeneral('sheet_wei_060', '华歆', '魏', 3, [
    { name: '草诏', description: '你的远程攻击力-1。己方角色数量为场上唯一最大时，每回合限一次，己方角色受到伤害后回复1点体力', tags: ['锁定技'] },
    { name: '息兵', description: '己方角色数量为场上唯一最小时，其他玩家角色一回合总计最多只能攻击3次。', tags: ['锁定技'] },
  ]),
  createGeneral('sheet_wei_061', '唐咨', '魏', 4, [
    { name: '兴棹', description: '根据场上体力未满的角色数量获得以下效果：≥2你获得【恂恂】；≥3你受到的远程伤害-1；≥4你失去护甲时摸1张牌；≥5你受到伤害后，你与伤害来源弃置1张手牌' },
    { name: '恂恂', description: '己方玩家可以随时观看卡牌池上的1张牌', tags: ['锁定技'] },
  ]),
  createGeneral('sheet_wei_062', '管辂', '魏', 3, [
    { name: '推演', description: '回合限三次，你可以进行判定，红色：你恢复一点体力，黑色：你和一名其他角色流失1点体力' },
    { name: '卜算', description: '回合限一次，你可以观看牌堆上的2张牌，并用手牌替换' },
    { name: '命戒', description: '你的所有攻击力-2，你无法被补给', tags: ['锁定技'] },
  ]),
  createGeneral('sheet_wei_063', '阎柔', '魏', 4, [
    { name: '仇讨', description: '回合限1次，你指定/被指定攻击目标后，你可以令双方玩家弃置1张手牌，本次攻击流程中双方玩家不能发动角色技能' },
    { name: '襄戍', description: '回合结束时，若你本回合造成过伤害，你可以令一名角色回复体力到上限', tags: ['限定技'] },
  ]),
  createGeneral('sheet_wei_064', '吕虔', '魏', 4, [
    { name: '威虏', description: '若你有护甲，你所有攻击力-1。若你无护甲，则你受到伤害+1。你受到攻击伤害后，可以从弃牌堆中抽1张牌为自己叠甲', tags: ['锁定技'] },
    { name: '赠刀', description: '你可以失去所有护甲，让一名角色获得：若你有护甲，你造成近战伤害后可以对相邻一名角色造成一点伤害并移除1层护甲', tags: ['限定技'] },
  ]),
  createGeneral('sheet_wei_065', '卞夫人', '魏', 3, [
    { name: '挽危', description: '死亡时，恢复一名角色2点体力或营地1点生命' },
    { name: '约俭', description: '你的所有攻击力-1，如你没有被补给则恢复1点体力。', tags: ['锁定技'] },
  ]),
  createGeneral('sheet_wei_066', '赵俨', '魏', 4, [
    { name: '同协', description: '回合限一次，可以让一名角色撤退。如该角色撤退到你所在区域，你们一起回复1点体力。如果撤退到手牌，则己方玩家可以摸该该角色剩余体力-1张牌。' },
  ]),
  createGeneral('sheet_wei_067', '王朗', '魏', 3, [
    { name: '鼓舌', description: '回合限1次，你可以弃置1张手牌并选择一名其他角色，双方玩家进行一次投掷，点数最小的玩家角色受到1点伤害' },
    { name: '激词', description: '回合限1次，己方玩家进行投掷后，可以弃置1张手牌重新投掷。每当有投掷结算后，若己方点数为唯一最小，你失去本次投掷点数的体力', tags: ['锁定技'] },
  ]),
  createGeneral('sheet_wei_068', '王双', '魏', 8, [
    { name: '追猎', description: '你不能叠甲且只能进行近战攻击，你的近战以远程距离计算。你攻击结算后进行一次判定，若判定结果为装备牌，则流失1点体力；若不为装备牌，回合结束时你失去本次造成伤害两倍的体力', tags: ['锁定技'] },
  ]),
  createGeneral('sheet_wei_069', '崔琰', '魏', 3, [
    { name: '雅望', description: '放置时弃置所有手牌，你可以使用被弃置的1-8张牌为其他角色叠甲。' },
    { name: '殉志', description: '死亡时弃置所有手牌，弃置手牌≥3则使一名其他角色流失1点体力。' },
  ]),
  createGeneral('sheet_wei_070', '张恭', '魏', 3, [
    { name: '遣信', description: '你的所有攻击力-1，己方回合开始时，将自己任意点体力（最小为1）转移到一名体力值未满的其他角色身上。', tags: ['锁定技'] },
    { name: '镇行', description: '当你在战场或其他玩家的区域时，你无法攻击和被指定为攻击目标，但己方回合结束流失1点体力。', tags: ['锁定技'] },
  ]),
  createGeneral('sheet_wei_071', '孙资&刘放', '魏', 3, [
    { name: '讥谀', description: '你的远程攻击力-1。每当有角色移动或撤退时，你可以跟随也选择移动或撤退。（但该移动/撤退消耗+1）', tags: ['锁定技'] },
    { name: '瑰藻', description: '使一名角色获得“体力上限-1，该角色在每个玩家的回合结束回复1点体力”', tags: ['限定技'] },
  ]),
  createGeneral('sheet_wei_072', '庞会', '魏', 5, [
    { name: '异勇', description: '回合限一次，当你攻击时候可以弃置所有手牌，当弃置数≥3时你的近战攻击力+1。' },
  ]),
  createGeneral('sheet_wei_073', '陈泰', '魏', 4, [
    { name: '救陷' },
    { name: '沉勇' },
  ]),
  createGeneral('sheet_wei_074', '文钦', '魏', 4, [
    { name: '犷骜' },
    { name: '慧企' },
  ]),
  createGeneral('sheet_wei_075', '刘晔', '魏', 3, [
    { name: '破橹' },
    { name: '筹略' },
  ]),
  createGeneral('sheet_wei_076', '曹爽', '魏', 4, [
    { name: '托孤' },
    { name: '擅专' },
  ]),
  createGeneral('sheet_wei_077', '夏侯杰', '魏', 5, [
    { name: '裂胆' },
    { name: '壮胆' },
  ]),
  createGeneral('sheet_wu_001', '孙坚', '吴', 4, [
    { name: '英魂', description: '1、你无法回复体力。2、其他角色对你造成伤害后，其对应攻击力下降你失去的体力值' },
    { name: '武烈', description: '死亡时，玩家摸1张手牌' },
  ]),
  createGeneral('sheet_wu_002', '张昭&张紘', '吴', 3, [
    { name: '直谏', description: '回合限一次，将你的护甲移到一名相邻区域的己方角色上' },
    { name: '固政', description: '你可以为回合内移动或攻击过的角色叠甲', tags: ['锁定技'] },
  ]),
  createGeneral('sheet_wu_003', '陆绩', '吴', 3, [
    { name: '怀橘', description: '你每回合首次叠甲时候，可以摸1张牌' },
    { name: '遗礼', description: '回合限一次，你可以弃1张牌，将自己身上的护甲和该丢弃的牌叠甲到一名其他角色上' },
    { name: '整论', description: '你的所有攻击力-1，每回合限一次，己方角色失去护甲时候，失去的护甲-1', tags: ['锁定技'] },
  ]),
  createGeneral('sheet_wu_004', '孙亮', '吴', 3, [
    { name: '溃诛', description: '回合限一次，你可以流失X体力，从弃牌堆中抽X张牌为X名角色叠甲，其他未叠甲的己方角色流失1点体力。' },
    { name: '掣政', description: '死亡时，己方所有角色流失所有护甲。' },
  ]),
  createGeneral('sheet_wu_005', '周妃', '吴', 3, [
    { name: '良姻', description: '其他玩家回合开始时，同一名区域内的其他受伤角色回复1点体力。' },
    { name: '箜声', description: '你的所有伤害-2，当你受到伤害时，同一区域的一名其他角色回复1点体力。', tags: ['锁定技'] },
  ]),
  createGeneral('sheet_wu_006', '陆抗', '吴', 4, [
    { name: '谦节', description: '你无法被移出场外（调离），同一区域内其他角色受到的技能伤害-1', tags: ['锁定技'] },
    { name: '决堰', description: '你无法撤退，受到的远程伤害-1', tags: ['锁定技'] },
    { name: '破势', description: '回合限一次，当你近战击杀一名其他角色后，你可以额外执行一次远程攻击' },
  ]),
  createGeneral('sheet_wu_007', '诸葛谨', '吴', 3, [
    { name: '缓释', description: '当一名其他角色放置后，你可以使其移出场外（调离），还原该角色并使其重新加入该角色原持有者手牌。', tags: ['限定技'] },
    { name: '弘援', description: '死亡时，使己方玩家一名武将以1体力状态加入己方支援区域' },
    { name: '明哲', description: '若你前一名区域有己方角色，且你所在区域没有其他角色存在，你受到的所有伤害-1' },
  ]),
  createGeneral('sheet_wu_008', '祖茂', '吴', 4, [
    { name: '引兵', description: '弃一张牌，使一名相邻区域角色和你一起移出场外（调离）', tags: ['限定技'] },
    { name: '绝地', description: '你被移出场外（调离）后无法返回场上', tags: ['锁定技'] },
  ]),
  createGeneral('sheet_wu_009', '孙鲁育', '吴', 3, [
    { name: '魅步', description: '同一区域内其他己方角色的远程伤害-1，前方相邻区域其他角色的近战攻击力-1' },
    { name: '穆穆', description: '场上远程攻击为0的所有角色，在己方回合结束回复1点体力' },
  ]),
  createGeneral('sheet_wu_010', '⭐吕蒙', '吴', 4, [
    { name: '探虎', description: '回合限一次，你可以弃置1张牌，本回合内你的攻击无视护甲。' },
    { name: '谋断', description: '失去1点远程攻击力。获得“激昂”和“谦逊”/“英姿”和“克己”，获得的技能被还原后体力上限＋1。', tags: ['限定技'] },
    { name: '激昂', description: '回合限1次，你受到伤害后，可对伤害来源发起【决斗】。 谦逊：锁定技，同一区域内存在其他角色，则你受到的伤害-1' },
    { name: '英姿', description: '回合限1次，可以令1名角色回复1点体力。  克己：回合结束时，如你没有进行过攻击，可以撤退一名区域。' },
  ]),
  createGeneral('sheet_wu_011', '⭐大乔', '吴', 3, [
    { name: '言笑', description: '你的远程攻击伤害-1，受到的近战攻击力-1。', tags: ['锁定技'] },
    { name: '安娴', description: '回合限一次，你攻击后，可以使对方角色受到的伤害-1，对方角色直到你的下个回合开始前被压制。' },
  ]),
  createGeneral('sheet_wu_012', '程普', '吴', 4, [
    { name: '疠火', description: '回合限1次，你进行近战攻击时可令伤害+1，若如此做，回合结束时你失去1点体力' },
    { name: '醇醪', description: '回合限1次，你可以放弃攻击，令1名角色回复1点体力' },
  ]),
  createGeneral('sheet_wu_013', '韩当', '吴', 4, [
    { name: '弓骑', description: '移动后，本回合远程攻击范围+1' },
    { name: '解烦', description: '与你相邻区域的己方角色被击杀时，己方玩家可以弃置2张牌，令该角色回复体力至1点并还原，加入营地区域。', tags: ['限定技'] },
  ]),
  createGeneral('sheet_wu_014', '潘璋&马忠', '吴', 4, [
    { name: '夺刀', description: '你成为攻击目标时，己方玩家可以弃1张牌令攻击来源的护甲在本回合结束前转移到你身上' },
    { name: '暗箭', description: '你造成的所有伤害-1，你的体力上限-1，当你拥有护甲时，你远程攻击+2', tags: ['锁定技'] },
  ]),
  createGeneral('sheet_wu_015', '虞翻', '吴', 3, [
    { name: '纵玄', description: '回合限一次，你可以进行一次判定，若为红色，使一名角色受到的所有伤害-1直到下个己方玩家回合开始；若为黑色，使己方场上一名有护甲的角色弃置所有护甲' },
    { name: '直言', description: '放置时，使己方一名其他角色撤退或回到营地区域' },
  ]),
  createGeneral('sheet_wu_016', '朱然', '吴', 4, [
    { name: '胆守', description: '其他玩家回合开始时，你可以弃置X张牌，该回合你成为第X次攻击目标时，你回复X点体力' },
  ]),
  createGeneral('sheet_wu_017', '顾雍', '吴', 3, [
    { name: '慎行', description: '你移动和攻击需要额外花费1手牌', tags: ['锁定技'] },
    { name: '秉一', description: '己方回合结束时，若己方玩家剩余1张手牌，则摸1张牌' },
  ]),
  createGeneral('sheet_wu_018', '朱桓', '吴', 4, [
    { name: '奋励', description: '放置时，使体力值大于你的其他己方角色回复1点体力' },
    { name: '平寇', description: '使一名体力值低于你的角色的体力流失至1点体力', tags: ['限定技'] },
  ]),
  createGeneral('sheet_wu_019', '孙休', '吴', 3, [
    { name: '宴诛', description: '回合限一次，己方玩家可以用一张非武将牌的手牌对一名其他角色进行叠甲，然后该角色失去1点体力' },
    { name: '兴学', description: '回合结束，你摸X张牌并弃置X张牌（X为己方场上有护甲的角色数）' },
  ]),
  createGeneral('sheet_wu_020', '朱治', '吴', 3, [
    { name: '安国', description: '同一区域有护甲的角色造成和受到的远程伤害-1' },
  ]),
  createGeneral('sheet_wu_021', '周舫', '吴', 4, [
    { name: '断发', description: '回合限1次，你可以弃置自身所有护甲，本回合可多攻击1次' },
    { name: '诱敌', description: '使一名其他玩家的角色向前移动一名区域，然后受到其相邻区域的一名你指定的己方角色的近战伤害', tags: ['限定技'] },
  ]),
  createGeneral('sheet_wu_022', '周处', '吴', 4, [
    { name: '乡害', description: '同一区域的其他角色体力值无法大于你目前体力', tags: ['锁定技'] },
    { name: '除害', description: '当你击杀其他角色后，你失去“乡害”获得“彰名”：同一区域的其他角色在回合结束时回复到你体力的一半（向下取整）' },
  ]),
  createGeneral('sheet_wu_023', '兴陆抗', '吴', 4, [
    { name: '筑围', description: '当你拥有护甲的时候，你同一区域所以角色受到的非技能伤害-1', tags: ['锁定技'] },
    { name: '匡谏', description: '回合限一次，己方一名角色可以使用任意张手牌叠加护甲，回合结束你失去1点护甲。' },
  ]),
  createGeneral('sheet_wu_024', '孙峻', '吴', 3, [
    { name: '邀宴', description: '回合限一次，你可以对己方一名其他角色造成2点伤害后，使另外一名其他角色撤退或受到1点伤害' },
    { name: '霸政', description: '己方回合结束时，你的体力值不大于等于其他己方角色的体力值，你流失1点体力。' },
  ]),
  createGeneral('sheet_wu_025', '合陆逊', '吴', 3, [
    { name: '诱进', description: '你可以撤退一名区域，使一名角色直到己方玩家的下回合开始前，所有攻击力变为0', tags: ['限定技'] },
    { name: '待劳', description: '回合结束，己方回合内没有进行过攻击的己方角色回复其体力上限的一半（向下取整）' },
    { name: '逐北', description: '对一名其他角色造成2点伤害使其撤退，若此伤害导致其死亡，则对其区域的另外其他角色造成1点伤害', tags: ['限定技'] },
  ]),
  createGeneral('sheet_wu_026', '孙鲁班', '吴', 3, [
    { name: '谮毁', description: '你可以将己方一名角色移出场外（调离），使你自己还原并回复体力值到最大体力值', tags: ['限定技'] },
    { name: '骄矜', description: '当你击杀一名其他角色后，你造成的远程伤害-1', tags: ['锁定技'] },
  ]),
  createGeneral('sheet_wu_027', '卫温&诸葛直', '吴', 3, [
    { name: '浮海', description: '放置时，如己方营地体力值大于等于其他玩家营地体力，己方营地区域一名目标回复1点体力' },
  ]),
  createGeneral('sheet_wu_028', '张璇', '吴', 3, [
    { name: '同礼', description: '回合限一次，进行一次判定，若为红色则你与一名其他角色回复1点体力；若为黑色则你与一名其他角色近战攻击力-1直到下一名己方玩家回合开始' },
    { name: '奢葬', description: '你近战攻击力-1，你死亡时己方所有角色弃置所有护甲', tags: ['锁定技'] },
  ]),
  createGeneral('sheet_wu_029', '转孙尚香', '吴', 3, [
    { name: '闺忌', description: '当你没有护甲时，你对可以己方一名体力最低的角色造成1点伤害，然后你本回合可以使用若干张非武将的手牌叠甲' },
    { name: '骄豪', description: '当你有护甲时，造成伤害+1，你攻击后弃置所有护甲', tags: ['锁定技'] },
  ]),
  createGeneral('sheet_wu_030', '范疆&张达', '吴', 4, [
    { name: '负山', description: '回合限一次，己方玩家可以弃置1张牌，使一名营地区域的角色受到你造成的1点伤害。回合结束时，若本回合你击杀没有击杀过角色，你失去1点体力。' },
  ]),
  createGeneral('sheet_wu_031', '梦孙策', '吴', 4, [
    { name: '独行', description: '同一区域内只有你一名角色时，你受到的所有伤害-1，己方玩家回合结束时，你回复体力上限的一半（向下取整）' },
    { name: '猘横', description: '回合限1次，可以弃置任意己方玩家手牌和流失己方任意角色的体力值，从卡牌池/武将池摸共计等量的牌' },
    { name: '诈死', description: '死亡时，回复体力至1点并加入营地区域，失去“猘横”获得“制衡”' },
    { name: '“制衡”', description: '回合限1次，可以弃置任意己方玩家手牌和己方角色上的护甲，从卡牌池/武将池摸共计等量的牌' },
  ]),
  createGeneral('sheet_qun_001', '华雄', '群', 6, [
    { name: '耀武', description: '回合结束时流失1点体力。你可以弃1张手牌，令一名角色对你发起一次「决斗」。', tags: ['锁定技'] },
  ]),
  createGeneral('sheet_qun_002', '潘凤', '群', 4, [
    { name: '狂斧', description: '你攻击后，如目标角色体力值比你低，己方玩家摸1张牌；比你高，你流失1点体力', tags: ['锁定技'] },
  ]),
  createGeneral('sheet_qun_003', '颜良&文丑', '群', 4, [
    { name: '双雄', description: '回合限2次，你可以弃1张手牌，对近战区域内一名角色发起一次「决斗」。' },
  ]),
  createGeneral('sheet_qun_004', '许攸', '群', 3, [
    { name: '成略', description: '回合限一次，弃2手牌，令一名其他角色选择：1，其本回合可以放弃攻击多进行一次移动；2，其还原自身，本回合攻击不需要消耗手牌' },
    { name: '恃才', description: '你可以摸1张牌，还原自身，选择一名其他玩家并被对方收缴', tags: ['限定技'] },
    { name: '寸目', description: '玩家摸牌量-1', tags: ['锁定技'] },
  ]),
  createGeneral('sheet_qun_005', '卢植', '群', 3, [
    { name: '明任', description: '使一名其他角色增加1点体力上限', tags: ['限定技'] },
    { name: '贞良', description: '你所有攻击力-1。死亡时，同一区域的其他角色回复1点体力', tags: ['锁定技'] },
  ]),
  createGeneral('sheet_qun_006', '⭐貂蝉', '群', 3, [
    { name: '离魂', description: '回合限一次，选择一名其他角色，弃X张手牌，本回合内其非锁定技无效，且己方玩家获得其控制权。若如此做，回合结束你失去X点体力（X为目标角色体力值）' },
    { name: '闭月', description: '你的远程攻击力-1。死亡时，击杀你的角色可以回复1点体力', tags: ['锁定技'] },
  ]),
  createGeneral('sheet_qun_007', '马超', '群', 4, [
    { name: '追击', description: '回合限1次，你可以放弃攻击并弃置1张手牌，对一名已受伤的其他角色造成1点伤害' },
    { name: '刺槐', description: '你近战攻击其他角色时，双方角色的玩家各投掷一次骰子，若你赢，你近战攻击力+1，若你没赢，还原自身且本次攻击后你直到下个己方回合结束前被压制' },
  ]),
  createGeneral('sheet_qun_008', '刘协', '群', 3, [
    { name: '天命', description: '回合限1次，你受到伤害后己方玩家可以弃两张牌并摸两张牌，若场上角色数唯一最多的玩家不为你，该玩家可以弃两张牌并摸两张牌（无牌则不弃）' },
    { name: '密诏', description: '你死亡时，可令一名角色对你指定的另一名角色发起一次「决斗」' },
  ]),
  createGeneral('sheet_qun_009', '伏完', '群', 3, [
    { name: '谋溃', description: '回合限1次，弃置1张手牌，令一名己方角色对其他玩家体力值最高的角色进行一次无视距离的攻击，若其未被击杀，其对你进行一次无视距离的攻击' },
  ]),
  createGeneral('sheet_qun_010', '张宝', '群', 3, [
    { name: '咒缚', description: '回合限一次，你可以弃置1红色/黑色手牌，令一名角色直到下次己方回合开始前进行攻击/移动后流失1点体力' },
    { name: '影兵', description: '若可以，你可以使手牌的1个角色以1体力值状态在营地或支援阵线区域出场', tags: ['限定技'] },
  ]),
  createGeneral('sheet_qun_011', '何太后', '群', 3, [
    { name: '鸠毒', description: '己方玩家的角色登场时受到你造成的1点伤害', tags: ['锁定技'] },
    { name: '戚乱', description: '弃置两张手牌，令场上所有非群雄势力角色受到1点伤害', tags: ['限定技'] },
  ]),
  createGeneral('sheet_qun_012', '张梁', '群', 3, [
    { name: '集军', description: '你放置时，己方玩家从武将池摸一张牌并将抽取的武将马上放置在支援区域' },
    { name: '方统', description: '回合限一次，你可以弃置点数之和＞50的任意张黑色手牌，然后对一名区域内的所有角色造成2点伤害' },
  ]),
  createGeneral('sheet_qun_013', '甘宁', '群', 4, [
    { name: '银铃', description: '回合限1次，玩家可以弃置1手牌，获得一名其他角色的1点护甲' },
    { name: '军威', description: '回合限1次，你可以弃置自身至少3点护甲，选择一名其他角色，该角色的玩家选择：①弃置所有护甲，②失去2点体力' },
  ]),
  createGeneral('sheet_qun_014', '张绣', '群', 4, [
    { name: '雄乱', description: '弃置所有手牌（至少1张），选择一名其他角色，直到你被击杀前被压制及非锁定技无效', tags: ['限定技'] },
    { name: '从谏', description: '你成为攻击或技能目标时，己方玩家需交给对方玩家一张手牌，然后对方玩家交给己方玩家一张手牌' },
  ]),
  createGeneral('sheet_qun_015', '刘表', '群', 3, [
    { name: '自守', description: '你的所有攻击力-1，同一区域所有角色受到的伤害-1', tags: ['锁定技'] },
    { name: '宗室', description: '同一区域内的其他角色减少1点近战攻击力', tags: ['锁定技'] },
  ]),
  createGeneral('sheet_qun_016', '马腾', '群', 4, [
    { name: '马术', description: '你每回合可以额外进行一次移动' },
    { name: '雄异', description: '你可以弃1张手牌，使在场所有己方角色获得“马术”', tags: ['限定技'] },
  ]),
  createGeneral('sheet_qun_017', '黄月英', '群', 3, [
    { name: '机巧', description: '回合限一次，你可以弃置自身X点护甲，令己方玩家摸(2×X)张牌' },
    { name: '玲珑', description: '若你没有护甲，你视为拥有「八阵」；若你有护甲，你视为拥有「奇才」', tags: ['锁定技'] },
    { name: '八卦', description: '当你受到伤害后，可以进行1次判定，如为黑色，玩家获得之，如为红色，受到伤害-1' },
    { name: '奇才', description: '回合限1次，你可以弃置1张武将牌，摸1张牌' },
  ]),
  createGeneral('sheet_qun_018', '赵云', '群', 4, [
    { name: '赤心', description: '回合限1次，选择：1、放弃攻击和移动回复1点体力，2、失去1点体力，本回合可以对近战范围所有目标各攻击一次' },
    { name: '义从', description: '你移动时，可使同一区域一名角色与你一起移动' },
    { name: '随仁', description: '你可以加1点体力上限，回复1点体力，然后失去「义从」', tags: ['限定技'] },
  ]),
  createGeneral('sheet_qun_019', '⭐赵云', '群', 4, [
    { name: '龙胆', description: '回合限1次，选择：1、放弃攻击回复1点体力，2、失去1点体力，额外进行一次攻击' },
    { name: '冲阵', description: '当你在战场区域，你受到的所有伤害-1。', tags: ['锁定技'] },
  ]),
  createGeneral('sheet_qun_020', '伏皇后', '群', 3, [
    { name: '惴恐', description: '若你同一区域内没有其他角色，你所有攻击力-1', tags: ['锁定技'] },
    { name: '求援', description: '若你同一区域内存在己方角色，则你无法被攻击且远程攻击伤害-1', tags: ['锁定技'] },
  ]),
  createGeneral('sheet_qun_021', '李儒', '群', 3, [
    { name: '绝策', description: '你的远程攻击-1，全场玩家每回合抽取的手牌数量-1', tags: ['锁定技'] },
    { name: '灭计', description: '回合限一次，你可以弃置1张手牌后让手牌最多的所有玩家弃置2张手牌。' },
    { name: '焚城', description: '己方回合结束时，你可以弃置2张手牌，对所有没有手牌的玩家的所有角色造成1点伤害。', tags: ['限定技'] },
  ]),
  createGeneral('sheet_qun_022', '蔡夫人', '群', 3, [
    { name: '窃听', description: '如果本回合己方没有角色进行过攻击，回合结束时同一区域内的所有角色回复1点体力' },
    { name: '献州', description: '本回合内进行过攻击的所有己方角色流失1点体力', tags: ['锁定技'] },
  ]),
  createGeneral('sheet_qun_023', '沮授', '群', 3, [
    { name: '渐营', description: '若你相邻的两个区域均存在己方角色，则你受到的远程伤害-1' },
    { name: '矢北', description: '若你相邻区域均有己方角色存在，你受到的远程伤害-1、受到的技能伤害+1', tags: ['锁定技'] },
  ]),
  createGeneral('sheet_qun_024', '袁谭&袁尚', '群', 4, [
    { name: '内伐', description: '你对其他群雄角色造成伤害+1，你受到其他群雄角色的伤害+1。' },
  ]),
  createGeneral('sheet_qun_025', '郝萌', '群', 4, [
    { name: '攻阁/雄莽', description: '近战攻击力+1，远程攻击力-1，攻击时，己方所有角色流失1点体力。' },
  ]),
  createGeneral('sheet_qun_026', '张鲁', '群', 3, [
    { name: '义舍', description: '进入到你所在区域的其他角色回复点2体力。己方玩家摸牌量-2', tags: ['锁定技'] },
    { name: '布施', description: '回合限一次，弃1张牌，选择一名其他角色，其直到你下回合开始前移动需要花费1手牌' },
    { name: '米道', description: '己方所有满体力角色受到伤害-1。己方所有角色移动需要花费1手牌', tags: ['锁定技'] },
  ]),
  createGeneral('sheet_qun_027', '皇莆嵩', '群', 4, [
    { name: '奋鉞', description: '己方回合内，若你过流失体力，则直到回合结束前，你的远程攻击力+1，' },
  ]),
  createGeneral('sheet_qun_028', '陶谦', '群', 3, [
    { name: '招祸', description: '你击杀其他角色后，直到你的回合开始前，其他玩家角色仅能指定你为攻击和技能目标。' },
    { name: '义襄', description: '你的所有攻击力-1。己方营地区域所有角色远程攻击力-1，受到的补给量+1', tags: ['锁定技'] },
    { name: '揖让', description: '死亡时，选择一名其他玩家收缴自身，并回复该玩家营地区域1点体力。' },
  ]),
  createGeneral('sheet_qun_029', '严白虎', '群', 4, [
    { name: '雉盗', description: '回合限1次，你可以获得相邻区域一名角色的护甲，然后其对你进行一次攻击。' },
    { name: '寄篱', description: '你同一区域内的其他角色受到伤害/回复体力后，你失去/回复1点体力。', tags: ['锁定技'] },
  ]),
  createGeneral('sheet_qun_030', '郭汜', '群', 4, [
    { name: '贪狈', description: '回合限1次，可以弃置1张手牌，选择一名其他玩家，该玩家做出选择：①让己方玩家摸1张牌，本回合你不能攻击其角色，②本回合你可以对其角色多进行1次攻击' },
    { name: '伺盗', description: '你可以选择一名有护甲的角色，获得该角色的玩家2张手牌或者该角色的护甲', tags: ['限定技'] },
  ]),
  createGeneral('sheet_qun_031', '李傕', '群', 4, [
    { name: '狼袭', description: '你造成的近战伤害为投骰子一次的点数（1-6）除2，向下取整。' },
    { name: '亦算', description: '己方玩家每投掷到一次1点的点数，你流失一点体力。每投掷到一次6点的点数，你远程攻击力-1，回复1点体力。', tags: ['锁定技'] },
  ]),
  createGeneral('sheet_qun_032', '荀湛', '群', 3, [
    { name: '锋略', description: '回合限一次，己方玩家选择一名其他玩家，各自投一次骰子。败者选择己方一名角色流失2点体力，若无角色，营地流失一点体力。' },
    { name: '谋识', description: '己方玩家骰子的点数+1，你的所有攻击力-1', tags: ['锁定技'] },
  ]),
  createGeneral('sheet_qun_033', '公孙渊', '群', 4, [
    { name: '怀异', description: '你击杀其他角色后，己方玩家需对你进行一次补给（至少能够回复1点体力），否则你撤退然后对同一区域内的角色造成1点伤害' },
  ]),
  createGeneral('sheet_qun_034', '郭图&逢纪', '群', 3, [
    { name: '急攻', description: '回合限一次，你可以失去1点体力并弃1张牌，令一名己方角色进行一次攻击' },
    { name: '饰非', description: '己方回合结束时，若本回合己方角色没有击杀过任何角色，你失去1点体力。', tags: ['锁定技'] },
  ]),
  createGeneral('sheet_qun_035', '曹节', '群', 3, [
    { name: '守玺', description: '远程攻击力-1，你有护甲牌时，你受到的伤害-1。', tags: ['锁定技'] },
    { name: '惠民', description: '回合限一次，你可以将自己移出场外（调离）直到下个己方回合结束，令一名角色回复1点体力' },
  ]),
  createGeneral('sheet_qun_036', '胡车儿', '群', 4, [
    { name: '神行', description: '你可以失去1点体力，多移动1次' },
    { name: '盗戟', description: '死亡时，可以令己方1名角色获得你相邻区域1名其他角色的护甲' },
  ]),
  createGeneral('sheet_qun_037', '彻里吉', '群', 4, [
    { name: '车悬', description: '你放置的回合不能进行移动。你移动后，若前方一名区域内没有角色，你可以立即移动一次' },
    { name: '羌首', description: '你远程攻击力-1，你对群雄角色造成的伤害+1，受到非群雄角色伤害+1', tags: ['锁定技'] },
  ]),
  createGeneral('sheet_qun_038', '起何进', '群', 4, [
    { name: '诏兵', description: '放置时，己方玩家从武将池摸1张牌' },
    { name: '诛宦', description: '回合限一次，你可以对己方营地区域1个目标造成1点伤害后，对其他一名角色造成1点伤害' },
    { name: '延祸', description: '死亡时，对所有玩家营地区域的目标造成1点伤害' },
  ]),
  createGeneral('sheet_qun_039', '转马超', '群', 4, [
    { name: '马术', description: '你每回合可以额外进行一次移动' },
    { name: '追命', description: '回合限1次，你近战攻击其他角色后可以弃置1张手牌，令该角色流失1点体力、弃置剩余的护甲并撤退1个区域' },
  ]),
  createGeneral('sheet_qun_040', '起孙坚', '群', 4, [
    { name: '平讨', description: '放置时，对所有其他群雄角色造成1点伤害。' },
    { name: '绝烈', description: '死亡时，可以使己方一名角色体力上限-1并将体力恢复至上限' },
  ]),
  createGeneral('sheet_qun_041', '起刘宏', '群', 3, [
    { name: '朝争', description: '回合限一次，可以让全场玩家投骰子，让所有点数最大的玩家的一名角色对点数最小的玩家的一名角色造成1点伤害。' },
    { name: '甚宠', description: '你可以失去所有攻击力，令一名己方其他角色获得“飞扬”“跋扈”，你从场上离开时，其失去所有技能和护甲', tags: ['限定技'] },
    { name: '飞扬', description: '你的体力上限-1，近战攻击力+1，一回合受到第二次近战攻击伤害+1。', tags: ['锁定技'] },
    { name: '跋扈', description: '回合限一次，你可以从弃牌堆中抽1张牌为自己叠甲。你受到攻击失去的护甲+1' },
  ]),
  createGeneral('sheet_qun_042', '桥玄', '群', 3, [
    { name: '绝质', description: '你的所有攻击力-2，护甲上限-1，当你回合结束时，护甲值为单数，己方玩家摸一张手牌，双数，压制场上一名其他角色到你的下个回合开始', tags: ['锁定技'] },
    { name: '急召', description: '己方玩家回合开始时，你可以弃1张牌进行一次判定，红色：令一名其他角色进行一次攻击；黑色：令一名其他角色进行一次移动或撤退' },
  ]),
  createGeneral('sheet_qun_043', '起皇甫嵩', '群', 4, [
    { name: '观火', description: '放置时，可以对一名受伤角色造成1点伤害，若达成击杀，你流失一点体力。' },
    { name: '居下', description: '回合限一次，你成为其他角色攻击或技能目标时，若其护甲值大于你，己方玩家可以摸1张牌' },
  ]),
  createGeneral('sheet_qun_044', '许劭', '群', 3, [
    { name: '盈门', description: '回合限一次，你可以让其他玩家交一张手牌给己方玩家，使其所有角色恢复1点体力。' },
    { name: '评鉴', description: '己方回合结束时，你可以令角色体力值合计唯一最多的玩家摸或弃1张牌' },
  ]),
  createGeneral('sheet_qun_045', '董白', '群', 3, [
    { name: '恃宠', description: '远程攻击力-1，补给所需消耗+1，受到的远程攻击力+1', tags: ['锁定技'] },
    { name: '连诛', description: '当你击杀其他角色后，对该玩家的一名其他角色造成1点伤害' },
  ]),
  createGeneral('sheet_qun_046', '起杨彪', '群', 3, [
    { name: '昭汉', description: '己方玩家/角色一次需要弃牌数大于等于2时候，可以使己方玩家少弃1张' },
    { name: '让节', description: '你无法攻击体力值小于你的角色。你参与的「决斗」有角色被击杀时，防止之并还原双方，决斗胜利的玩家将手牌摸至5张丢弃2张。', tags: ['锁定技'] },
    { name: '义争', description: '你可以对一名体力值大于你的角色发起一次「决斗」。', tags: ['限定技'] },
  ]),
  createGeneral('sheet_qun_047', '起孔融', '群', 3, [
    { name: '礼让', description: '每当己方玩家在回合外获得手牌，己方玩家可以选择交给其他玩家，让己方角色均恢复1点体力' },
    { name: '争义', description: '回合限一次，己方体力值最少的角色首次受到伤害时，你可以代替承受此次伤害' },
  ]),
  createGeneral('sheet_qun_048', '段煨', '群', 4, [
    { name: '狼灭', description: '若其他玩家回合内有两名及以上角色进行过相同行动，其结束回合时，己方玩家可以弃1张手牌，根据其行动执行对应选项(可执行多项)：移动，己方玩家可以摸两张牌；攻击：你可以进行一次攻击。' },
  ]),
  createGeneral('sheet_qun_049', '起朱㑺', '群', 4, [
    { name: '分敌', description: '回合限一次，若一名玩家在战场区域存在两名及以上角色，你可以令其中一名角色移动或撤退' },
    { name: '拒降', description: '你的回合内，当有角色撤退时，你可以对其先造成1点伤害。' },
  ]),
  createGeneral('sheet_qun_050', '起刘焉', '群', 3, [
    { name: '图射', description: '你可以对其他玩家的营地区域均造成1点伤害，其他玩家各摸3张手牌。', tags: ['限定技'] },
    { name: '立牧', description: '回合限一次，你可以弃1张牌，压制自身所在区域的角色。你被压制时，回复1点体力，并对相邻区域的一名角色造成1点伤害' },
  ]),
  createGeneral('sheet_qun_051', '起刘备', '群', 4, [
    { name: '积善', description: '当场上有其他角色受到伤害时，你可以弃置1张手牌代替其承受1点，并使用该弃置手牌叠甲。' },
    { name: '振鞘', description: '回合限1次，你近战攻击一名角色后，若你有护甲，你可以弃置所有护甲再次攻击该角色' },
  ]),
  createGeneral('sheet_qun_052', '起王允', '群', 3, [
    { name: '赦论', description: '回合限一次，你可以与0~2名其他玩家参与一次投骰子，若投掷点数合计大于等于6，你使没有参与投掷玩家的一名角色直到其玩家回合开始前移出场外（调离）。' },
    { name: '伐异', description: '己方玩家参与投骰子后，你可以对本次参与投骰子中点数大于你的玩家的一名角色造成1点伤害。当场上有角色被移出场外（调离）后无法回到场上，则你流失3点体力。', tags: ['锁定技'] },
  ]),
  createGeneral('sheet_qun_053', '承许贡', '群', 4, [
    { name: '表召', description: '己方回合开始时，你可以选择一名其他角色，其还原并获得：无法获得护甲，直到下个己方回合开始时，其角色还原。', tags: ['限定技'] },
    { name: '业仇', description: '你所有攻击力-1，死亡时，使一名其他角色获得：体力值≤2，受到的近战远程攻击伤害+1。', tags: ['锁定技'] },
  ]),
  createGeneral('sheet_qun_054', '承淳于琼', '群', 4, [
    { name: '仓储', description: '己方玩家回合开始时，可以使本回合摸牌改为摸全场角色数的牌。' },
    { name: '失守', description: '你回合外受到伤害后，己方玩家需要弃置伤害来源角色数的手牌。你被补给后直到下个己方玩家回合前被压制。', tags: ['锁定技'] },
  ]),
  createGeneral('sheet_qun_055', '承许攸', '群', 3, [
    { name: '离叛', description: '同一区域的所有角色在己方回合结束时候，受到你的1点伤害，当你被击杀时改为被对方玩家收缴', tags: ['锁定技'] },
    { name: '轻袭', description: '你可以流失3点体力对任意一名营地造成1点伤害', tags: ['限定技'] },
    { name: '烬灭', description: '你可以流失3点体力对一名玩家所有已受伤的角色各造成1伤害', tags: ['限定技'] },
  ]),
  createGeneral('sheet_qun_056', '承吕布', '群', 5, [
    { name: '无常', description: '受到群雄角色伤害-1，攻击非群雄角色，近战攻击力+1', tags: ['锁定技'] },
    { name: '轻狡', description: '其他玩家回合限一次，己方玩家可以获得其2张手牌，本回合使你自身非锁定技无效，其他玩家获得你的控制权。' },
    { name: '乘虚', description: '每当你控制权转移后，获得当前玩家一名其他角色的1点护甲', tags: ['锁定技'] },
  ]),
  createGeneral('sheet_qun_057', '承张郃', '群', 4, [
    { name: '穷途' },
    { name: '先著' },
  ]),
  createGeneral('sheet_qun_058', '邹氏', '群', 3, [
    { name: '孤吟' },
    { name: '帐灯' },
  ]),
  createGeneral('sheet_qun_059', '陈登', '群', 3, [
    { name: '论势' },
    { name: '诡图' },
  ]),
  createGeneral('sheet_qun_060', '承甄宓', '群', 3, [
    { name: '济乡' },
    { name: '称贤' },
  ]),
  createGeneral('sheet_qun_061', '承张辽', '群', 4, [
    { name: '整兵' },
    { name: '突围' },
  ]),
  createGeneral('sheet_qun_062', '合姜维', '群', 4, [
    { name: '矜伐', description: '如己方为场上角色数最少的势力，则你一回合可以近战和远程攻击各一次', tags: ['锁定技'] },
    { name: '复谋', description: '如己方为场上角色数最多的势力，则你和同一区域的其他角色无法攻击。', tags: ['锁定技'] },
    { name: '选锋', description: '你死亡时，可以选择一名空置的其他玩家的营地区域，你以1体力进入该区域。', tags: ['限定技'] },
  ]),
  createGeneral('sheet_qun_063', '承关羽', '群', 4, [
    { name: '冠绝', description: '回合开始时，你可以选择1、远程和近战攻击范围+1，2、本回合结束前，远程攻击伤害+1' },
    { name: '念恩', description: '你攻击后击杀其他角色，己方玩家需要弃置2张手牌，若你无法弃置则营地受到1点伤害' },
  ]),
  createGeneral('sheet_qun_064', '梦司马昭', '群', 4, [
    { name: '谦吞', description: '当你死亡时候，使一名营地流失1点体力。', tags: ['锁定技'] },
    { name: '挟征', description: '回合限一次，可以弃1张牌对己方一名角色造成1点伤害后对一名其他角色造成1点伤害' },
    { name: '昭凶', description: '当你体力值不为上限时，你获得「威肆」「荡异」' },
    { name: '威肆', description: '当己方为角色为场上最多时，回合结束对角色最少的玩家一名角色造成1点伤害。' },
    { name: '荡异', description: '回合结束时，除自己外，所有角色流失1点体力' },
  ]),
  createGeneral('sheet_jin_001', '司马伷', '晋', 3, [
    { name: '才望', description: '己方收缴的角色体力上限+1' },
    { name: '纳降', description: '你击杀其他角色后，你收缴该角色' },
  ]),
  createGeneral('sheet_jin_002', '张虎&乐綝', '晋', 4, [
    { name: '袭爵', description: '弃1张手牌，本回合结束前获得“突袭”“骁果”' },
  ]),
  createGeneral('sheet_jin_003', '夏侯徽', '晋', 3, [
    { name: '宜室', description: '其他角色发动技能后，你可以使其还原', tags: ['限定技'] },
    { name: '识度', description: '你可以选择1名体力值小于等于你的角色，交换双方体力值和攻击力', tags: ['限定技'] },
  ]),
  createGeneral('sheet_jin_004', '羊徽瑜', '晋', 3, [
    { name: '慈威', description: '回合限1次，己方同一名角色于一回合受到第2次攻击时，你可以弃置2张手牌，使其回避此伤害' },
    { name: '才媛', description: '如其他玩家回合结束时，己方没有角色受到伤害，则己方玩家可以与该玩家各摸1张牌', tags: ['锁定技'] },
  ]),
  createGeneral('sheet_jin_005', '石苞', '晋', 4, [
    { name: '擢升', description: '根据你击杀的角色数获得以下技能：一名获得「马术」，两名获得「」三名获得「纳降」', tags: ['锁定技'] },
  ]),
];
