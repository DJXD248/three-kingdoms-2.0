# PROJECT_ARCH_MAP — 全项目架构与权威地图

基线：**v2.2.10**（本文档随 2.2.11 建立；该版本仅文档与措辞修正，无行为变更，地图内容对 2.2.10==2.2.11 均成立）。
最近一次全量验证时点：2026-09-25（v2.4.0 五闸全绿：388 测试 / 46 文件（src 零改动）、lint 0 错 30 遗留警告、非内容刀硬证 ai-battle 对 B2 {1:114,2:186} 逐字一致（同 seed 两轮剥离计时豁免后 cmp 全等）VIOLATIONS=0，详见 HANDOFF §9 与 §12-24；G 节为该版本登记内容）。

## 怎么用这份地图（给人类和 AI 协作者）

1. **冲突仲裁看 Authority 列**：同一问题多处有说法时，只信 Authority 持有者。例如"这个动作合法吗"只有 `ActionValidator`/引擎裁判说了算，`legalActions.ts` 只负责"生成候选"。
2. **改代码前看 Lifecycle 与 Determinism 列**：决定你的改动能不能持有实例状态、能不能引入随机/时间。
3. **信任程度看 Verification 列**：`MR`（模型自报）级别的条目在被测试或真人验证前不得当作已确认事实。
4. 本地图与代码不符时：**以代码为准，并立即登记勘误**（HANDOFF §12），然后修正本图。

图例：
- Canonical：`CANONICAL` 唯一权威链路 / `COMPAT` 兼容层（有意保留） / `LEGACY` 遗留待清理 / `DORMANT` 休眠脚手架（无运行时调用方）
- Determinism：`PURE` 纯函数 / `RNG` 确定性随机（可用种子复现） / `TIME` 依赖时钟 / `EXT` 依赖外部环境（DOM/IndexedDB/网络）
- Verification：`UT` 单元测试 / `IT` 集成测试 / `CI` 云端复验 / `UP` 用户实机验证 / `E2E` 浏览器端到端 / `MR` 仅模型自报

## A. 权威执行链（唯一生产路径）

```
用户/AI 输入
  → components (React UI) 或 ai/aiTurnDriver（伪装成操作者）
  → store/gameStore（Zustand 会话态 + UI 投影）
  → store/engineExecutionBridge（常驻引擎容器执行，2.2.21 D-1 第二刀：见 C-1）
  → core/GameEngine.dispatch（容器壳：打戳发射/STATE_CHANGED/录像/快照）
  → core/TransitionCore.transition（唯一纯转移：校验→resolver→触发链→结算→有界重入，2.2.20 D-1）
  → action/ActionDispatcher → action/resolvers/*（产出 GameEvent[]）
  → core/EventProcessor（事件→状态迁移，唯一写路径）
  → EngineState（唯一持久真相源）
  → store/gameStateAdapter（引擎态→store 投影）
  → UI 渲染；replay/liveReplayRecorder 旁路记录 dispatch
```

技能旁路：`skills/skillCompiler`（数据→定义）→ `SkillTriggerBridge` → `triggers/TriggerEngine` → 产出事件回灌 EventProcessor。运行时只此一条。

## B. 模块地图

| 模块/文件 | Layer | 主要职责 | Canonical? | Authority（冲突时谁说了算） | Lifecycle | Determinism | Verification | 已知缺口 | Introduced |
|---|---|---|---|---|---|---|---|---|---|
| `core/EngineState`（经 `core/GameState.ts`） | State | 对局唯一持久真相源，可序列化/重建；2.2.18 起携带 `rngState?`（引擎随机游标，纯数据 {s}，structuredClone 友好） | CANONICAL | 它自己（一切状态以它为准） | game-scoped（持久于 store） | PURE（数据本身） | UT/CI | rngState 已落地（2.2.18 阶段 D 首刀）；缺字段旧快照由 applyDrawEvent 惰性重播种；RandomOutcome 事件流已落地（2.2.22 阶段 D 收尾刀：RANDOM_OUTCOME 事件随 dispatch 流走、录像记结果不记重掷，见 D-2）；建局随机迁移已于 2.2.19 销案 | 1.x |
| `core/rng.ts`（2.2.18 新增，49 行） | State | 引擎种子 RNG 原语：`createRngState/cloneRngState/rngShuffle/rngNext`（mulberry32，uint32 游标，可 JSON 序列化；rngShuffle 返新数组） | CANONICAL | 引擎路径唯一随机算法 | 随 EngineState | SEEDABLE（游标即状态） | UT（rng.test 8 例） | 抽牌链+建局五步（2.2.19 setupCursor/commitSetup）均在用；2.2.22 起抽牌消费结果另以 RANDOM_OUTCOME 事件记录（回放优先记结果，游标兜底重掷）；骰子纯 UI 装饰与 action.id 计数器口径见 D-2 观察项（2.2.25 全部裁决完毕：e① 窗口 id 已确定性化落地，e②③④ 豁免/维持登记，见 §12-16 销案） | 2.2.18 |
| `core/TransitionCore.ts`（2.2.20 新增，116 行） | Engine | **唯一纯转移函数** `transition(state, action, ctx{rules,resolvers,processor,triggers}) → {state, events, accepted, overrideFailures}`：校验（ACTION_REJECTED 早退）→ getResolver（NO_RESOLVER 早退）→ ACTION_ACCEPTED+resolve → 触发链展开 → EventProcessor 结算 → 派生 DEATH 有界重入（≤8 轮，TRIGGER_REENTRY_LIMIT 哨兵，常量唯一定义处）；不发 STATE_CHANGED、不盖事件 id/timestamp；2.2.22 起 ctx 增可选 `outcomeOverrides`（回放注入队列），重入循环后为产出的 RANDOM_OUTCOME 盖稳定 id（`ro:<turn>:<round>:<playerId>:<index>`）并追加进返回事件流；2.2.23 起返回值增必填 `overrideFailures`（带外诊断：回退原因列表，两处拒绝早退恒 []，实况路结构性为空，事件流零变化）| CANONICAL | "一次动作如何改变状态"唯一算法（D-1 禁双路纪律：全库不得出现第二份转移逻辑） | PURE（state 进 state 出，副作用零） | 不触随机（随机只在 EventProcessor 消费 rngState） | UT（transitionEquivalence 三路对账，2.2.21 起扩为四路；randomOutcome 8 例） | store 常驻迁移已落地（2.2.21 阶段 E 第二刀，见 bridge 行与 C-1） | 2.2.20 |
| `core/GameEngine.ts`（133 行，2.2.17 时点 153；2.2.20 降为容器壳） | Engine | dispatch 容器：调用 TransitionCore.transition + 纯路径外必须留的效应——rejected 即时 emit、接受路径尾部 push STATE_CHANGED 快照、EventBus 发射循环、recordHistory 门控的 replay.record + snapshots.capture；持有 replay/snapshots/reactions/skillTriggers 等装配件；2.2.22 增公开字段 `outcomeOverrides`（回放结果注入队列，dispatch 两个出口均清空，实况路永不设置）；2.2.23 增 `lastOverrideFailures`（当步带外诊断暂存，两出口与 outcomeOverrides 同步清/置）；2.2.25 的 `openReactionWindow(event, participants?)` 生成确定性窗口 id `rw:<turn>:<round>:<sourceEventKey>:<seq>`（私有计数器 `reactionWindowSeq`，不消费 rngState）并连同既有 `passReaction` 经 EventBus 外发 REACTION_WINDOW_OPENED/CLOSED——纯转移路径零接触，窗口态永不进 EngineState | CANONICAL | 引擎对"副作用与事件外发"负责 | **容器生命周期**：实况 UI 经 2.2.21 起的模块级常驻容器（bridge 每步 adopt 入参 engineState 克隆——状态唯一来源仍是入参，容器对 store 无漂移）；ReplayPlayer 与对账路径仍各自重建/真常驻（2.2.20 起每步 dispatch 前 syncPlayerSkills） | RNG 无关（转移纯，随机在状态里；窗口 id 用容器计数器不占随机流） | UT/IT/CI | ReactionWindow 业务入口已接线（2.2.25 §12-9c 销案：入口机制 only，何种技能自动开窗归 D-3 内容侧等立项）；网络侧长生命周期接线仍 dormant；D-1 本体两刀已收线 | 1.x |
| `core/EventProcessor.ts`（111 行，2.2.13 时点 93；原 852） | Event | 事件→状态迁移唯一应用入口（process 队列循环 + apply 薄分发；D-6 阶段 B 第二刀纯移动拆分，处理器逐字移入 eventProcessors/，唯一入口纪律不变；2.2.17 增可选 `collected[]` 追加收集参：队列中途派生事件在入队点被收集供 GameEngine 重入，仍是唯一改动入口 D-2；2.2.22 process 增可选第 4 参 `flow`（DrawOutcomeFlow），仅透传给 applyDrawEvent，单入口纪律不破） | CANONICAL | 状态如何变化它说了算 | 随引擎重建 | PURE（2.2.24 起 legacy 护甲兜底已去 Date.now 改位置确定性 id，全行无时钟，见 D-4） | UT/CI（17+ 用例） | 已按事件族拆分（2.2.13） | 1.x |
| `core/eventProcessors/*`（7 文件：damageEvents 176 / drawEvents 349 / generalEvents 264 / playerEvents 77 / turnEvents 95 / chainedConsequences 136 / **skillEvents 26（2.3.1 新增）**） | Event | 事件族处理器（纯 (state, event) → state 函数）+ 派生事件入队（DAMAGE/DEATH/BASE_DAMAGE/PLAYER_DEFEATED 连锁；2.2.17：generalEvents += applyHealEvent/applyGainArmorEvent，chainedConsequences DAMAGE 分支对技能致死补发 DEATH（skillKill 标记，damageType 门与 AttackResolver 自带 DEATH 去重）；2.2.18：drawEvents 的 applyDrawEvent 收敛为**全引擎唯一抽牌选牌点**——将池种子洗牌、牌堆顶切、弃牌堆种子重洗（替代旧有偏 sort(()→Math.random())），游标推进写回 state.rngState，缺游标旧局按 turn/round/deck 派生确定性兜底种子；2.2.22：applyDrawEvent 增可选 flow 参——实况路每次消费向 flow.produced 上报 DRAW_SELECTION 结果（选牌键+deckTake+reshuffleKeys+cursorAfter），回放路优先按序消费 flow.overrides（严格校验张数与键可解析，任何不符回退种子重掷），旧档无 override 天然走重掷路；2.2.23：materializeSelection 判别联合返回精确失败原因（COUNT_MISMATCH/UNRESOLVABLE_KEY），takeOverride 对槽位错配报 MISMATCHED_SLOTS（缺槽=旧档合法不报），失败经 flow.diagnostics 惰性收集（pushDiagnostic）带外上报；2.3.1：新增 skillEvents.ts——SKILL_ACTIVATED（A 类事实）由 EventProcessor 唯一入口追加 `EngineState.consumedSkills` 台账（键 stableId，重复键不双记——状态结算只住这里，resolver 只描述事件）） | CANONICAL（仅经 EventProcessor 单一入口调用，禁第二入口） | — | 随引擎重建 | SEEDABLE（2.2.18 起抽牌/重洗全部消费 rngState，事件族处理器内已无 Math.random） | UT/CI | 2.2.13 引入，纯移动零行为变化；2.2.17 起承载阶段 C 行为扩展；2.2.18 起承载阶段 D 确定性；2.2.22 起承载"记结果不记重掷"；2.2.24 起 damageEvents 护甲兜底占位牌改位置确定性 id（`legacy_armor_destroyed_${discardPile 起始下标+i}`，保留 invariants.ts 前缀豁免） | 2.2.13 |
| `core/EngineDispatchFlow.ts` | Engine | dispatch 流程辅助 | CANONICAL | — | action-scoped | PURE | UT | — | 1.x |
| `action/ActionDispatcher.ts` + `resolvers/*`（12 个，2.3.1 起 +TurnEndSkillResolver 80 行） | Action | 动作→事件产出 | CANONICAL | 各 resolver 对自己动作的事件形态负责 | request-scoped | PURE（2.2.18 起抽牌类亦然：DrawResolver 只校验+产计数 DRAW 事件，选牌收敛到 applyDrawEvent，D-2"禁 Resolver 私拿随机源"达成，测试有 Math.random 抛错探针；2.3.1 TurnEndSkillResolver 只描述事实——SKILL_ACTIVATED+静态 createSkillEvents 效果事件，合法性从 EngineState 重derive、拒收原因诚实五连） | UT 全覆盖/CI | —（技能效果结算缺口已于 2.2.17 闭合，见 skills/eventProcessors 行） | 1.x |
| `rules/ActionValidator.ts` | Rule | **合法性最终裁判** | CANONICAL | 合法/非法它说了算 | request-scoped | PURE | UT/E2E | 2.3.1 修复既有隐患：抽牌窗归属以窗体 `state.drawState.playerId` 为权威、`metadata.drawPlayerId` 降为兜底（不一致时序曾误判询问者致 END_TURN 死锁，seed 902 复现，回归例锁死） | 1.x |
| `rules/legalActions.ts` | Rule | **候选动作枚举**（供 AI；同类资源用代表卡收窄） | CANONICAL | 只产候选，无合法性权威（契约措辞 2.2.11 已改准） | request-scoped | PURE | UT（与引擎裁判对账测试） | 指定卡消耗需求出现时按 D-5 引入 CardSelectionPolicy；2.3.1 起枚举回合结束技能候选（ACTIVATE_SKILL，经同一 isLegal 探针=validate+resolve 无拒收） | 2.2.3 |
| `rules/RuleEngine.ts`、`battlefieldRules.ts` | Rule | 规则查询辅助 | CANONICAL/COMPAT | 战场规则查询 | request-scoped | PURE | UT | 与 ActionValidator 边界未逐条钉死 | 1.x |
| `domain/*`（combat/cost/regions/constants） | Rule | 数值与区域规则口径 | CANONICAL | 常量与公式 | 静态 | PURE | UT | — | 1.x |
| `data/generals.ts`、`cards.ts` | Data | 卡牌/将领静态数据（**一账总表**：一个官方将领=一行 `createGeneral(...)`；玩家改动是 localStorage 读取期叠层，源文件永不改写） | CANONICAL | 数据内容 | 进程级 | PURE | UT/E2E | **v2.8.2 清理**：`data/registries/*`、`data/types.ts`、`data/examples/caoCao.json` 已删除（"一卡一记录+注册表装载"旧范式脚手架，零消费者、从未进包）；官方内容新增=改这两个文件并走内容刀五闸+换锚口径 | 1.x（2.8.2 收敛为纯总账） |
| `skills/skillCompiler.ts`（290 行，2.3.1 时点）→ `SkillTriggerBridge.ts`（307 行）→ `triggers/TriggerEngine.ts` | Skill | 数据化技能唯一运行时链路（2.2.17：可结算效果面 = DRAW_CARD/DAMAGE/HEAL/GAIN_ARMOR 四类型；bridge 把 HEAL/GAIN_ARMOR 翻译为真实事件含目标解析；致死链经 chainedConsequences 补发 DEATH 打通 onKill/onDeath/补偿抽；**2.3.0：SUPPORTED/DATA/TRIGGER_EVENT 三表同步扩为 7 类**——onBecomingTarget 经既有 `BEFORE_DAMAGE` 事件接通（零新增事件，契约见 F 节），编译 skip 不再无痕：skipped 项经常驻 `WeakMap getCompileDiagnostics(engine)` 带外上报（D-9 C 类首个编译期消费者），console.warn 按 **distinct 条目**去重（`技能名#效果id:原因` 键，测试缝 `__resetCompileWarnDedup`），事件流与游戏行为零变化；**2.3.1：onTurnEnd 销案但不扩三表**——TURN_END 刻意**不**映射进 TRIGGER_EVENT_MAP（防自动双火），可发动性判定住在 `skills/turnEndSkills.ts`（114 行，从 EngineState 派生定义列表：场上将+runtime 载荷+turnSubType 匹配本回合+当回合台账去重，不经触发注册表过滤以保拒收原因诚实），效果复用 bridge **静态** `createSkillEvents` 同一份代码回流 canonical 链） | CANONICAL | 技能何时触发、产出什么事件 | 随引擎 | PURE（编译）/RNG（触发结算可致伤） | UT/CI/E2E（2.2.1 真机贯通；2.2.17 store 直驱实测疗愈/固甲/技能击杀链；2.3.0 真机演练窗 20 局+dev 直驱反伤链事件序；2.3.1 真机询问窗双场景〔发动/跳过〕） | 触发覆盖：7 类已支撑（2.3.0 时点；**v2.5.3 起 9 类**——+onCardLost/onCardGained，见 F 节触发族表；效果面另由 4 类型增至 6 原语——+DISCARD v2.5.0、+GIVE v2.5.3）；**onTurnEnd 已随 2.3.1 以"玩家决策 canonical action"形态销案（F 节契约表），余 12 类登记为按需池暂无业务需求**；ReactionWindow 入口机制 2.2.25 落地，**首个真实业务开窗方=2.3.1 回合结束询问窗**（store 层 dispatch 前延迟，见 gameStore/ReactionWindow 行）；编辑器/Excel 消费诊断通道做 UI 提示=后续需求 | 2.1.0 |
| `skills/skillExcelFormat.ts`（298 行，2.8.3 时点）、`skills/skillGateText.ts`（195 行，2.8.3 新增）、`SkillDataRegistry.ts` | Skill | Excel 效果列组导入导出（**v1=3 列／v2=6 列／v3=7 列：+「门槛」**，宽度靠表头正则探测、导出恒 7 列、旧格式照旧兼容）+ 门槛大白话↔结构化条件唯一互译（读不懂逐条进 `unknown` 上报，见 §F 门槛录入面）+ 数据登记（2.2.17：`SETTLEABLE_RUNTIME_TYPES` 四类型，编辑器"暂未接入结算"标注随数据源消失） | CANONICAL（Excel 格式与门槛语法）／**未接线（`SkillDataRegistry`：Map 式技能登记类，仅经 `skills/index.ts` 再导出，全库零实例化，2026-09-27 grep 确认）** | — | request/进程级 | PURE | UT（`skillExcelFormat.test.ts` 含 v3 往返钉、`skillGateText.test.ts` 14 例） | `SkillDataRegistry` 刻意**保留不删**：它是未来"内容包互换"刀的天然挂载点（见 G 节联机双轨），删了再写回属无谓 churn；立项该刀时须先确认它仍是合适形态，否则替换 | 2.2.0（2.8.3 加门槛列与互译件） |
| `store/gameStore.ts`（807 行，2.3.1 时点；2.2.12 拆分时 622；原 956） | Store | 会话态 + UI 投影 + 对局动作装配（编辑器/恢复/演练场切片已外移；2.2.25 增 `reactionWindow` 字段与 `openReactionWindow/passReaction` 动作——经常驻桥容器，全通过/非法 pass 时置 null，createRoom/resetGame 调 `resetReactionWindowStore()` 清新窗口；**2.3.1 增 `turnEndAsk` 字段与 endTurn 询问门控 + `activateTurnEndSkill/skipTurnEndAsk` 动作**：人类非演练座结束回合遇可发动 onTurnEnd 技能→经桥开反应窗并挂起 dispatch（回合冻结）、窗内发动/跳过=canonical 动作真 dispatch、全结算后继续原结束回合链；重复按结束回合=诚实跳过、AI 座/演练场不受门控、无候选零行为变化；createRoom/resetGame/恢复清 ask） | CANONICAL（会话态） | 界面与流程状态；对局真相仍以 EngineState 为准（**reactionWindow/turnEndAsk 是容器时序投影，永不进 EngineState**——快照只序列化 engineState，窗态结构上进不了存档） | 页面级（内存，刷新即失） | TIME/EXT | UT（reactionWindowEntry/turnEndAsk 例证 store 动作面）/E2E（2.3.1 真机双场景） | D-6 阶段 B 第一刀已落地（2.2.12 纯移动拆分，见 gameStoreTypes/EditorActions/Recovery 行）；GPT 评审确认非"规则回灌"，是"应用层 Store+兼容层"；**engineAwareSetter 镜像重建不变量见 gameStore.turnEndAsk.test 夹具口径（HANDOFF §12-19③）** | 1.x（2.3.1 询问窗） |
| `store/gameStoreTypes.ts`（143 行，2.2.25 时点）、`gameStoreEditorActions.ts`（137 行）、`gameStoreRecovery.ts`（70 行） | Store | 2.2.12 自 gameStore 拆出：类型面全量（2.2.25 起含 reactionWindow 字段与两动作签名）、编辑器/开发者动作工厂、快照恢复动作工厂 | CANONICAL（gameStore 的组成部分；gameStore 再导出类型保持消费口径） | 无独立权威——宿主仍是 gameStore | 页面级 | 编辑器/恢复路径 EXT | UT（复用 gameStore 测试面）/E2E 冒烟 | 纯移动拆分零行为变化；后续切片按同模式继续；**2.3.2：恢复链首个专属测试文件 `gameStoreRecovery.test.ts`（16 例八格矩阵：正常/旧形态/损坏清理/缺失/重复冲突/自动保存/降级/存储 API 不可用），见 HANDOFF §12-21** | 2.2.12 |
| `store/engineExecutionBridge.ts`（151 行，2.2.25 时点；2.2.21 起常驻化） | Store | store↔引擎唯一执行收口点：**模块级常驻 GameEngine 容器**（recordHistory:false，对局级录像仍由 liveReplayRecorder 单路承接）——每步 adopt 入参 engineState（克隆）+ 技能注册表全量重登记（unregister 上一批 owner 再 syncPlayerSkills），再 dispatch+snapshot+recordLiveDispatch；旧每步重建降级为 `dispatchStoreActionReconcile`（对账工具专用、不喂录像器）；2.2.25 增三个窗口入口 `openReactionWindowStore/passReactionStore/resetReactionWindowStore`（adopt 同一 engineState 后进容器，窗口不进转移流也不喂录像器） | CANONICAL | — | **模块级常驻容器**（无失效钩子：adopt-clone 使外部改写 store 态天然被尊重） | PURE（相对 store——唯一真相来源永远是入参） | UT（四路对账+容器三例：实例复用/resync 清死将/别名态变更被消费；reactionWindowEntry 桥链路例）/IT | D-1 落点（两刀收线）；测试缝 `__resetResidentEngineContainer/__residentEngineProbe` | 1.x（2.2.21 常驻化） |
| `triggers/ReactionWindow.ts`（68 行）+ `triggers/types.ts` ReactionWindowState | Trigger | 反应窗口簿记：open(participants, **stableId 必填**)/pass/revoke/isOpen/getState/close/clear + PrioritySystem 排序；2.2.25 起唯一开窗方为 `GameEngine.openReactionWindow`（确定性 id `rw:<turn>:<round>:<sourceEventKey>:<seq>`）经常驻桥暴露给 store | CANONICAL（容器层时序，非状态转移） | 窗口通过序由 PrioritySystem；引擎状态权威仍是 TransitionCore 产物 | 随常驻容器（跨步存活；createRoom/resetGame 清空） | DET（身份段无时钟；openedAt 仅观测且不入录像） | UT（reactionWindowEntry 10 例：事件序/拒绝非法 pass/快照逐字节不变；turnEndAsk 10 例：开窗冻结/发动结算/跳过/双按/收缩/未知技能/无候选直连/AI 座不门控） | **首个真实业务开窗方已落地（2.3.1）**：回合结束询问窗——id 段 `turn-end-ask:<turn>:<playerId>:<seq>`，窗开在 store 层 dispatch 前（END_TURN 挂起为 `turnEndAsk` 投影字段，B 类永不进档），窗内决策=canonical ACTIVATE_SKILL/继续 endTurn（A 类必录，D-3c 首检通过）；通用"其他技能/时机自动开窗"仍按 D-3 随需求立项；网络重放窗口不属本刀口径 | 2.2.25 接线（1.x 定义）·2.3.1 首个业务方 |
| `store/gameStateAdapter.ts`、`engineAwareSetter.ts`、`localGameSnapshot.ts`、`editorPersistence.ts`、`testArenaActions.ts`（441 行，2.2.12 起含 buildTestArenaState/settleDrawInTestArena） | Store | 引擎↔store 投影、存档、编辑器持久化、演练场动作+演练场状态推导；2.2.18 起 `seedRngState`：建房播种 rngState 一次（Date.now^random），局中已有游标绝不重置；**2.3.2 两处阻断性修复**：① `isRestorableEngineState` 的 playerIds 改在 playersAreValid 短路之后派生（混入 null 的深坏档曾把校验器自身打崩，校验器不得被被校验数据击穿）；② `localGameSnapshot` 三助手（save/read/clear）try/catch 哑火降级——localStorage 抛异常（file:// 单文件离线发行与隐私模式是真实路径）不得打断 commitEndTurn 自动保存链致回合死锁，save 返 boolean 供调用方诚实消费，每次操作恰一次 console.warn（Set 按操作去重，测试缝 `__resetLocalGameSnapshotDiagnostics`，D-9 C 类带外诊断） | CANONICAL/COMPAT | 投影规则归 adapter | 页面级 | EXT（localStorage）；TIME 仅播种一次 | UT（含 executeDraw.rng 建房播种例；gameStoreRecovery.test 16 例覆盖两修复与八格矩阵） | 调用方诚实：GameBoard saveAndExit 保存失败绝不退局（不无痕丢档）；**v2.7.1 事实/呈现契约收编（见 C-4）**：`storeStateToEngineState` 不再用 `.toUpperCase()` 造 `timelinePhase` 方言，改走逆折叠表（`DISPLAY_TO_CANONICAL_TIMELINE` + `'start'` 塌缩桶按 canonical 血统区分 + 无信号带走 previous 值），`metadata` 由整包替换改为 canonical 键存活+adapter 自记账层叠；回归锚 `store/engineFactContract.test.ts` 5 例（含 engineAwareSetter→dispatchStoreAction→liveReplayRecorder 全链例） | 1.x-2.x（2.3.2 加固、2.7.1 契约化） |
| `ai/policies/*`（三档策略+随机） | AI | 从候选中选动作（激进>均衡>保守>随机，擂台 3400 局零违例） | CANONICAL | 选什么动作 | 会话级 | PURE（零随机——司机卡死检测前提） | UT/arena/CI | 权重静态手工标定，规则数值变动需重跑 ai-arena | 2.2.7 |
| `ai/aiTurnDriver.ts` | AI | 生产 store 链路的人机座位司机（征召/抽牌/出招/护栏） | CANONICAL | AI 座位节奏 | 对局级 | PURE 前提 | UT/E2E 两局 | 引入随机策略需重审 lastChoiceKey 回退；**2.3.1：AI 对可发动 onTurnEnd 技能的发动/跳过决策经真实 store 动作（ACTIVATE_SKILL→activateTurnEndSkill / 直接 endTurn），不经询问窗门控（AI 座无窗）——ai-battle 300 局含守夜全链走通、VIOLATIONS=0** | 2.2.9 |
| `ai/battleRunner.ts`、`arena.ts`、`battleReport.ts`、`matchSetup.ts`、`invariants.ts`、`battleHash.ts`、`browserExport.ts`、`arenaCli.ts`、`battleCli.ts` | AI | 离线模拟/擂台/报告/不变量/种子盖戳/导出 | CANONICAL（工具线） | 仅分析用途，不触生产 | 进程级（node/浏览器窗） | RNG（2.2.19 起三流显式分离：对局内抽牌消费 `rngState=createRngState(seed)`（引擎路径）；matchSetup 自带装配流（seed^0x9e3779b9，建堆/阵营/采样/技能注入）；battleRunner 自带策略流（seed^0x85ebca6b，经 AiPolicy 可选 random 参注入）；`ai/rng.ts withSeededRandom` 已删除） | UT/CI + 千局 soak | seatModes 等会话态不持久化；复放模式 2.2.19 起不再咨询策略（记录动作经 createAction 重建），旧"总是咨询策略"lockstep 技巧已清理 | 2.2.4-2.2.8 |
| `ai/Bot.ts`、`Difficulty.ts`、`RandomStrategy.ts` | AI | 早期脚手架 | **LEGACY**（全库无引用，2026-09-24 grep 确认） | 无 | — | — | 无 | 待删（2.3 前清理登记） | 1.x |
| `replay/liveReplayRecorder.ts` + `GameHistory.ts`、`ReplayManager.ts`、`ReplayPlayer.ts`、`SnapshotManager.ts` | Replay | 对局 dispatch 录制与回放 | CANONICAL | 录像数据结构 | 对局级 | EXT（依赖引擎重建重放） | UT/E2E | 2.2.24 起带 ReplayHeader{schemaVersion:2,gameVersion}（D-4 落地：types.ts 导出 REPLAY_SCHEMA_VERSION，ReplayRecorder.start 写入、deserialize 三态口径 [1,2] 收/超界拒读、schemaVersionOf 缺头=1 只读双读；旧档永不回填；version 字段仍为 1 未动）；重放依赖"重建式执行"（引擎迁移时必须保持）；2.2.20：ReplayPlayer 每步 dispatch 前 syncPlayerSkills（中途登场将技能注册与实况同构）；2.2.22：RANDOM_OUTCOME 事件随 dispatch 流录进既有 entry.events（不 bump schema/版本号），ReplayPlayer 每步提取记录结果注入 `engine.outcomeOverrides` 优先消费（严格校验，不符或旧档无此类事件→回退种子重掷=既有路径，诚实双读）；2.2.23：ReplayPlaybackResult 增 `overrideFailures`（每步采集 engine.lastOverrideFailures 附条目 sequence），每次故障回放结尾恰一次 console.warn 聚合摘要（条数+sequence 列表+reason 直方图）——降级行为不变、观测不再无痕（GPT Q4），旧档双读恒空不触发 | 2.2.5-2.2.6 |
| `replay/replayNaming.ts`、`replayStorage.ts`（309 行）、`gameplayLog.ts` | Replay | 命名口径 / 目录句柄+静默写+暂存队列 / 操作日志 | CANONICAL | 保存行为：自动=永不下载（2.2.10 治本），手动=可下载兜底 | 页面级（暂存队列内存态） | EXT（File System Access/IndexedDB/下载） | UT（268 中占 9+）/E2E | 暂存队列刷新即失（有意接受） | 2.2.6/2.2.10 |
| `components/GameBoard.tsx`（743 行，2.3.4 时点实测；2.2.15 拆分时 689；原 704）、`SkillEditor.tsx`（868 行，2.2.14 时点）、`TestArena.tsx`（483 行，2.2.16 时点；原 485）、`GameOverScreen.tsx`、`Settings.tsx`、`AiBattle*`、`UnifiedDraw.tsx`、`DiceRoll.tsx`、`Codex.tsx`、`MainMenu/CreateRoom/Lobby/GeneralDraft/Rules.tsx`、`DeveloperOverlay.tsx`、`AiDirector.tsx` | UI | React 界面（GameBoard 2.2.25 增反应窗口 HUD 提示条：store.reactionWindow 驱动，逐座通过按钮/✓ 打勾，无窗口时 DOM 零变化，复用既有原语未造新组件体系；**2.3.1 增回合结束询问条**：store.turnEndAsk 驱动琥珀色横幅——⚡逐候选技能按钮（activateTurnEndSkill）+ ⏭️跳过并结束回合（skipTurnEndAsk），ask 与通用窗口 HUD 互斥（同 windowId 时抑制后者避免双呈现）；**2.3.2 保存诚实化**：saveGameSnapshot 消费 localGameSnapshot 的 boolean 返回值（成功/失败提示语分岔），saveAndExit 仅在保存成功时退局；**2.3.4 P5 表面一致性**：渲染期回合键守卫（turnKey=round:cpi 变化即清 movGen/movTgt/moveOptions，React 官方 render-phase adjustment 模式，hooks 无条件、引擎零接触）+ 检视面板五动作按钮禁用原因 title 六串（与 canMov/canAtk/canSup/canArm 判定式同源镜像）；MainMenu 页脚改构建期常量 `Qoder V{pkg.version}`） | CANONICAL（UI 层） | 呈现与交互；规则不在此 | 组件级 | EXT | UT（部分）/E2E/UP | 三大 UI 文件全部已拆（D-6 收线）：SkillEditor 2.2.14（1253→868）、GameBoard 2.2.15（704→689 → gameBoard/uiPrimitives.tsx）、TestArena 2.2.16（485→483 → testArena/compactPrimitives.tsx）；三者剩余可拆面全是闭包绑定件（Slot/BSlot/Territory*/Dev 面板/动作处理器/IO 回调），继续瘦身需解闭包、单独立项；30 条 react-hooks 遗留警告 | 1.x-2.x |
| `components/testArena/compactPrimitives.tsx`（10 行） | UI | 演练场拆出件：SC/Bar/Btn 三个无状态捕获纯 props 原语（棋盘版 uiPrimitives 的紧凑 CSS 变体） | CANONICAL | 呈现；无业务判定 | 组件级 | PURE（纯 props→DOM） | UT（随 TestArena 渲染路径间接）/E2E（2.2.16 真实点击：登场/补给操作条与按钮禁用态、检视统计卡、本回合计数） | 与 gameBoard/uiPrimitives 刻意不合并（合并=改样式=行为变化）；未来统一需单独立项做视觉回归；TestArena 无 StatPill/Modal 等价件（检视弹窗为内联 JSX） | 2.2.16 |
| `components/gameBoard/uiPrimitives.tsx`（21 行） | UI | 棋盘拆出件：SC/StatPill/Bar/Btn/Modal 五个无状态捕获的纯展示原语 | CANONICAL | 呈现；无业务判定 | 组件级 | PURE（纯 props→DOM） | UT（随 GameBoard 渲染路径间接）/E2E（2.2.15 真实点击：弹窗计数/inspect 统计卡/登场操作条与按钮禁用态） | 全库仅 GameBoard 引用（2026-09-24 grep 确认），导出面为聚合 export 一行 | 2.2.15 |
| `components/skillEditor/skillExcelParsers.ts`（251 行，2.8.3 时点）、`TriggerEditor.tsx`（154）、`RuntimeEditor.tsx`（95）、`GateEditor.tsx`（77，2.8.3 新增） | UI | 编辑器拆出件：Excel/文本导入纯解析器（**导入侧逐条收集"门槛没看懂"供常驻清单显示**）+ 触发时机子编辑器（**2.8.3 加「照这个填」文本入口：认得才填两个下拉，不认得原样拒绝并列出全部 47 条可认写法**）+ 结构化效果子编辑器 + **发动门槛子编辑器（一个效果一张卡：文本框＋实时"看懂了／没看懂"回显＋词汇表提示，改动即回写 `SkillEffect.conditions`）** | CANONICAL | 解析/子表单交互；合法性仍归引擎与 store | 组件级 | PURE（解析器无 IO/状态） | UT（`skillExcelParsers.test.ts` 8 例；SkillEditor.runtime 等经组件路径）/E2E（真实点击+真实 xlsx 注入往返，2.8.3 已跑门槛双景） | handleImportFile/handleExport 仍闭包于组件态，继续拆分需解闭包（非纯移动，单独立项） | 2.2.14（2.8.3 加 GateEditor） |
| `controllers/*`（Hotseat/Human/AI/Local） | Controller | 座位输入控制器 | COMPAT | 输入路由 | 对局级 | PURE | UT | 与 aiTurnDriver 职责边界需在引擎迁移时一并钉死 | 1.x |
| `setup/*`（draft/pool/runtimeSetup） | Setup | 开局装配（势力纯化默认、征召分发） | CANONICAL | 装配不变量（confirmDraft 合并编辑锁定） | 开局阶段 | RNG（池抽取） | UT/E2E | — | 1.x-2.2.1 |
| `components/SkillEditor.tsx` Excel 读写路径 + `components/xlsxSecureReader.test.ts` | Data | Excel 导入（读=SheetJS `XLSX.read`+`sheet_to_json`，写=exceljs）与安全读取防线回归钉 | CANONICAL | — | request-scoped | EXT | UT（真实 .xlsx fixture，exceljs 生成、含中文） | **v2.8.2 勘误两则**：① 原条目所称 `importer/*` 模块（GeneralImporter/SkillImporter/PackageImporter）为零消费者脚手架，已随本刀删除，Excel 面真实住所在 `SkillEditor.tsx`+`skillExcelFormat.ts`；② 原条目所称 `components/xlsxSecureReader` **作为源文件从不存在**，仓库内只有同名测试文件（读取路径的防线回归钉），2.2.11 建档时把测试文件名误记成了模块名 | 2.0.1（防线测试）/2.8.2 改述 |
| `timeline/PrioritySystem.ts` | Rule | 优先级时序 | COMPAT | — | 对局级 | PURE | UT | 原 AGENTS 所称 PhaseManager/TurnManager 不存在（2.2.11 勘误） | 1.x |
| `network/*`、`room/*`、`server/*`、`session/*` | Net | 多人化脚手架（`WebSocketServer.broadcast()` 等均为空壳：签名齐、实现直通返回） | **DORMANT**（模块外零引用，2026-09-24 grep 确认；v2.8.2 复核仍在，刻意**不删**——与"一卡一记录"脚手架不同，它是已核准未来需求的现成骨架） | 无（未接入生产链路） | — | — | UT 局部 | 激活前置 D-1/D-2 **均已闭环**（D-1 于 2.2.21、D-2 于 2.2.25）。**用户 2026-09-27 拍板联机双轨**（详见 G 节第 11 项）：① 房主权威——`ServerActionPacket`(动作进)/`StateSnapshotPacket`(EngineState 快照出) 这套形态即其骨架，DIY 内容只需存在于房主机器；② 内容包互换——玩家各自将池互通。两条与远程联机同刀一起做，硬前置=官方/DIY 内容来源判别根（G 节第 10 项） | 1.x |
| `utils/runtimeIdentity.ts` | Util | 卡牌运行时身份唯一提取 | CANONICAL | 身份口径 | 静态 | PURE | UT | — | 1.19-1.20 |
| `scripts/preflight-build.mjs`（27 行）+ `preflight-build.test.mjs`（5 例） | Tooling | build 前置防呆（D-7 落地件）：node_modules 不存在/不可读/为空/无 vite 四态拒绝并显式指路安装命令；**绝不静默安装**；仓库根按脚本自身位置派生（cwd 免疫，故测试必须在 tmpdir 沙箱复制后 spawn） | CANONICAL（构建路径唯一守卫） | 构建门槛 | 构建期 | 无随机 | UT（沙箱 spawn） | 不经 CI（各 job 自带显式 install） | 2.3.3 |

## C. 关键注记

**C-1 引擎现状（重要，2.2.21 更新）**：`engineExecutionBridge` 由**一个模块级常驻 GameEngine 容器**承接（D-1 第二刀）。每步动作：容器 adopt 入参 engineState（克隆，与旧重建路径消费的输入完全同源）→ 技能注册表全量重登记（先注销上一批 owner 再 syncPlayerSkills，逐字复刻 fresh-engine 注册语义——亡将不可能靠常驻表续触）→ dispatch → snapshot 返回。**容器不是第二真相源**：状态唯一来源永远是 store 给的入参，gameStore 投影对快照数组的别名就地改写也因 adopt-clone 每步重读而被如实消费（计划稿的"快照同一性匹配复用"经设计评审否决——别名使同一性判定漏检，adopt-clone 结构上恒等于重建路径且保留容器供未来 Reaction/网络接线）。外部改态（读档、resetGame、testArena 装配）无需显式失效钩子，adopt 天然回到正确状态。旧每步重建保留为 `dispatchStoreActionReconcile`（对账工具，刻意不喂录像器，两路可并跑不双录）；对账测试（transitionEquivalence 四路）钉死 常驻===重建===录像回放。转移逻辑仍全库唯一（TransitionCore），禁双路纪律不破。

**C-2 三率口径**（平衡统计基线）：阵亡不问死因；击杀含反杀与攻击触发技能死。改动须同步 battleRunner 注释、battleReport 口径注释、本文档三处。

**C-3 自动保存不变量**（2.2.10）：新增任何自动保存调用点**必须显式传 `{ unattended: true }`**，否则得到手动语义（可申请权限/下载兜底）。

**C-4 事实字段 vs 呈现字段（D-9 四类契约的呈现面推论，v2.7.1 落地）**：`store/gameStateAdapter.ts` 的 `storeStateToEngineState` 不是只读投影，而是**实况路径上的写入者**——`createEngineAwareSetter` 对任何 patch 不含 `engineState` 键的呈现层 set() 都会跑一次镜像重建，产物又被常驻桥 `toEngineState` 采纳进下一次派发（C-1）。因此它受"事实保管"级别的纪律约束：

| 归类 | 字段 | 镜像义务 |
|---|---|---|
| **A 游戏事实**（必存） | `turn` / `round` / `phase` / `timelinePhase` / `consumedSkills` / `pendingChoice` / `rngState` / `metadata`（canonical 键） | 逐字过镜，**不得回卷、不得整包替换**；metadata 采用"canonical 键存活 + adapter 自记账层叠在最上"（draw 观察三键每次显式重置 null，防跨镜残留） |
| **B 呈现词汇**（不得写成事实） | `turnPhase`（draw/main/end/start）、`phase`（menu/lobby/…）、`roomName` 等 display 字段 | 只允许**逆 `applyEngineStateToStore` 折叠表**还原成 canonical 用词（`DISPLAY_TO_CANONICAL_TIMELINE`：draw→DRAW、main→ACTION、end→GAME_OVER）；`'start'` 是 MENU/TURN_START 的**塌缩桶**、不可由 display 值逆推，靠上一份 canonical 血统区分；无信号则带走 `previous.timelinePhase`。**禁止 `.toUpperCase()` 造方言**（`'MAIN'/'START'/'END'` 即修复前的病灶） |
| **不得外溢** | 镜像本身 | **零事件外发**：镜像若开始发事件即成第二转移路径，违反 D-1/C-1 红线 |

回归锚=`src/store/engineFactContract.test.ts` 5 例，末例走全链 `engineAwareSetter → dispatchStoreAction → liveReplayRecorder`（契约类改动必须全链测：纯单元测无法证明"呈现层 set() 不往录像里记东西"）。全库 `timelinePhase` 的唯一合法性读者=`rules/ActionValidator.ts:44`，新增读者一律用 canonical 词汇。已销残差：v2.6.4 热座对账所需的 "MAIN→ACTION 折叠" 补偿自本刀退役（§12-37③/§12-39⑥）。**刻意留白**：store 建房链从未写 `metadata.roomId`（全库唯一写入点 `ai/matchSetup.ts:188`），房间名只住 `store.roomName`⇒live 录像文档恒 `'local'`；补它=新增游戏事实，按"不发明玩法"待需求首现（§12-39⑦，2.8 候选）。

## D. 已登记的架构债与迁移目标（2026-09-24 与外部评审达成共识，进入 2.3 前按序消化）

| # | 债务 | 钉死的决议 | 排期 |
|---|---|---|---|
| D-1 | GameEngine action-scoped，无法满足 Reaction/网络/长生命周期 | **短期允许双路验证，禁止双路长期执行**：抽出唯一 `TransitionCore.transition(state,action,ctx)`；常驻引擎只是持有 currentState/rngState 的执行容器；重建式执行降级为对账工具；测试断言 常驻结果===重建结果。**进度（2.2.20 阶段 E 首刀）：TransitionCore.ts 已落地（校验→解析→触发链→结算→有界重入逐字移入，纯路径无 STATE_CHANGED 无打戳），GameEngine 降为容器壳（109 行），transitionEquivalence 3 例钉死 常驻===每步重建===录像重建回放（含技能击杀链与拒绝步，仅归一化容器打戳层）；ReplayPlayer 补每步 syncPlayerSkills（本轮唯一行为变化）。**进度（2.2.21 阶段 E 第二刀·收线）：store 常驻迁移落地——engineExecutionBridge 改由模块级常驻 GameEngine 容器执行（每步 adopt 入参 engineState 克隆 + 技能注册表全量重登记，与旧重建路径结构化等价；计划稿"快照同一性匹配"经设计评审改采 adopt-clone，别名改写不漏检），重建式执行降级为对账工具 dispatchStoreActionReconcile；transitionEquivalence 扩为四路对账+容器专例（实例复用/resync 清死将/别名态被消费），行为零变化以 ai-battle 300 局分布逐字一致兜底。本决议两刀收线；长生命周期业务接线（ReactionWindow/网络）随各自需求另立刀次** | 阶段 E（两刀完，本决议收线） |
| D-2 | RNG：withSeededRandom 全局替换 Math.random（并行/服务器下有危险）；重放"重新掷骰"脆弱 | RNG 进 `EngineState.rngState`；随机行为产出 **RandomOutcome 事件**（purpose/value/稳定 id）；**录像记结果不记重掷**；禁止 Resolver 私拿随机源，统一 ExecutionContext.random()。**进度（2.2.18 阶段 D 首刀）：rngState 已进 EngineState（可选字段、缺字段惰性重播种、不 bump 任何版本号）；引擎内抽牌/弃牌堆重洗的选牌全部收敛到 applyDrawEvent 消费种子游标（Resolver 禁随机达成，测试探针钉死）；录像 initialState 含游标→重建式回放自此可复现（重掷=可复现的重掷，"记结果不记重掷"仍未达成=PENDING）。剩余刀（PENDING 登记）：RandomOutcome 事件流、建局牌堆/骰子/势力采样迁入 rngState、action.id/instanceId 确定性、withSeededRandom 彻底退役、battleRunner lockstep 清理。**进度（2.2.19 阶段 D 第二刀）：建局随机（createCardDeck/runtimeSetup 四函数加 random 注入参，gameStore 建局五步走 setupCursor/commitSetup 消费 rngState；matchSetup 自带装配流 seed^0x9e3779b9）已迁入游标/独立播种；action.id 进程计数器化、instanceId 纯计数器化（matchSetup 种子盖戳扩到卡与技能）；withSeededRandom 彻底退役（ai/rng.ts 删除，策略流经 AiPolicy 可选 random 参注入 seed^0x85ebca6b）；battleRunner lockstep 清理（复放不咨询策略，记录动作经 createAction 重建）。行为变化披露：AI 对战 seed→胜席分布改变（300 局 seed1：{1:112,2:188}→{1:109,2:191}），平衡观测台历史需重锚。D-2 仅剩：a) RandomOutcome 事件流（单独一刀）+ e) 观察项（ReactionWindow 窗口 id、DiceRoll 纯 UI 骰子，§12-16 PENDING）。**进度（2.2.22 阶段 D 收尾刀）：a) 已落地销案——RANDOM_OUTCOME 事件进事件族（purpose DRAW_SELECTION、稳定 id `ro:<turn>:<round>:<playerId>:<index>`、value 含选牌键/deckTake/reshuffleKeys/cursorAfter），TransitionCore 重入后统一盖 id 追加进 dispatch 返回流，录像随 entry.events 记录（不 bump schema 版本，旧档无此类事件天然走"记游标重掷"双读路），ReplayPlayer 每步提取记录结果注入 engine.outcomeOverrides、applyDrawEvent 严格校验后按序消费（不符即回退种子重掷），实况/回放事件流逐字相等（randomOutcome 8 例+四路对账扩言钉死），ai-battle 300 局分布与基线逐字一致（零行为变化硬证）。建局随机经决议口径不并入事件流（store 层无事件流可挂、录像文档存的是建局后 initialState，无"重掷建局"问题，2.2.19 游标化即终点）。D-2 仅剩 e) 观察项（§12-16e：ReactionWindow 窗口 id、DiceRoll 纯 UI 骰子）。**进度（2.2.23 收尾第一刀）：回退诊断旁路落地（GPT Q4 契约"可自动降级，不可无痕降级"）——严格校验失败携带精确原因（COUNT_MISMATCH/UNRESOLVABLE_KEY/MISMATCHED_SLOTS）经常驻带外通道（DrawOutcomeFlow.diagnostics→TransitionResult.overrideFailures→GameEngine.lastOverrideFailures→ReplayPlaybackResult.overrideFailures）汇总上报，ReplayPlayer 每次故障回放恰发一次聚合 console.warn；事件流与降级行为零变化（randomOutcome 原 8 例+四路对账一字未动全绿、ai-battle 300 局分布逐字一致），旧档双读不产生 failure；randomOutcome 扩至 14 例（305→311）。**进度（2.2.25 收尾第三刀）：e) 观察项全部裁决完毕，本决议整体收线**——e① ReactionWindow 窗口 id 已确定性化（`rw:<turn>:<round>:<sourceEventKey>:<seq>` 容器私有计数器，**不消费 rngState 游标**：窗口身份不是游戏随机；随 §12-9c 入口接线落地）；e② DiceRoll/testArena 装饰骰=豁免维持（引擎骰子已走 rngState，纯视觉不进真相源）；e③ generateRoomName `random=Math.random` 默认参=豁免（store 路径 2.2.19 起注入 setupCursor，默认参仅脱离 store 直调兜底）；e④ ReconnectToken/RandomStrategy/randomPolicy 回退=维持登记（dormant 脚手架与真人机 random 档位回落属预期）。至此 §12-16 a~e 五项全销** | 阶段 D（四刀完：2.2.18/2.2.19/2.2.22 + 2.2.23 诊断/2.2.25 e 项，本决议整体收线） |
| D-3 | 技能 Effect/Trigger 覆盖半成品：**（2.2.17 已闭合两项）**HEAL/GAIN_ARMOR 已完整结算、技能致死已补发 DEATH→onKill/onDeath/补偿抽接通；**（2.2.25 闭合一项）**ReactionWindow 业务入口（§12-9c）已落地——**入口机制 only**：容器层确定性开窗+桥/store 动作+GameBoard 最小 HUD+窗口不入 EngineState/不入录像流口径钉死；**剩余**：onTurnEnd/onOtherDeploy/onBecomingTarget 等触发无引擎事件支撑仍待接，**何种技能/时机自动开窗**（含回合结束询问语义的内容侧实现）无触发方（**2.3.0/2.3.1 已相继销案：onBecomingTarget 经 BEFORE_DAMAGE 接通；onTurnEnd 以 canonical ACTIVATE_SKILL 形态进局、回合结束询问窗成为首个自动开窗方**） | 先钉死 Event→Trigger→Effect→State mutation 权威边界再加覆盖面，防第二轮技能膨胀（边界已钉：EventProcessor 唯一入口 + collected 追加收集 + 有界重入）；入口已通但**不得**在稳定期偷跑技能内容。**（2026-09-25 收官体检追加钉死）**："窗口可以不录；窗口里的游戏决策不能不录"——OPEN/CLOSE 永久属容器观察（B 类，见 D-9）不进 Replay；但 Pass/技能激活等任何改变游戏状态的窗口内 action 必须走 canonical action→TransitionCore→Replay 链，未来内容化时不得留旁路。**进度（2.3.0 内容时代第一刀）：onBecomingTarget 已销案——零新增事件、经既有 BEFORE_DAMAGE 接通（十二格契约表见 F 节），编译 skip 无痕降级同批治掉（WeakMap 带外诊断+条目级 warn 去重）；13 类无需求触发从"欠账"重登记为 F 节"按需池"（onTurnEnd 已排期 v2.3.1=自动开窗首个业务方）**。**进度（2.3.1 内容时代第二刀）：onTurnEnd+回合结束询问窗落地、§4 冻结规则兑现——onTurnEnd 走"玩家决策 canonical action"形态销案（TURN_END 不入触发映射、禁自动双火；ACTIVATE_SKILL→TurnEndSkillResolver→SKILL_ACTIVATED/consumedSkills+静态 createSkillEvents 回流，十二格表见 F 节）；询问窗成为首个真实业务开窗方（store 层 dispatch 前延迟、无候选零行为变化），D-3c 追加钉死句在此首检通过：窗体 B 类不进档、窗内决策 A 类进录像，真机双场景实证** | 阶段 C（b/d 完；c 入口 2.2.25 落地；2.3 起需求驱动逐个销案，见 F 节按需池） |
| D-4 | 曾为 legacy 护甲兜底 `legacy_armor_destroyed_${Date.now()}` 伪造牌实例（拆分后位于 `eventProcessors/damageEvents.ts:156-163`）。**已落地（2.2.24 第二刀）**：盘点裁决=b 案——a 案前提被证伪（GAIN_ARMOR 2.2.17 的点数护甲无卡实例，`armorLost>0`+无实例是合法生产路径；普攻经 destroyedArmorCardIds 供真实实例、技能 DAMAGE 不带 armorLost；录像重放的是 action 不依赖兜底形态），保留兜底分支但 id 位置确定性化（`legacy_armor_destroyed_${弃牌堆起始下标+i}`，替换 Date.now），前缀保留以兼容 ai/invariants.ts 台账豁免；ReplayHeader 已加（schemaVersion:2+gameVersion，旧档缺头=1 只读双读、永不回填改写，超界 deserialize 显式拒读）；不采 Adapter 转写（诚实双读同 2.2.22 策略） | **收线（2.2.24）** |
| D-5 | 候选枚举"指定卡消耗"扩展性 | 标志挂 **Action 语义**不挂卡：`CardSelectionPolicy: EQUIVALENT / INSTANCE_REQUIRED (/PREFERRED)`；EQUIVALENT 保持代表卡收窄防动作空间爆炸 | 需求出现时 |
| D-6 | 热点文件多职责 | 拆分顺序已钉：**gameStore → EventProcessor（单一 processEvent 入口+事件族分文件）→ SkillEditor → GameBoard/TestArena**；EventProcessor 拆分不许出现第二入口。**进度：五刀全部落地、本决议收线——gameStore（2.2.12，956→622 行）、EventProcessor（2.2.13，852→93 行入口 + eventProcessors/ 六族文件）、SkillEditor（2.2.14，1253→868 行 + components/skillEditor/ 三文件）、GameBoard（2.2.15，704→689 行 + components/gameBoard/uiPrimitives.tsx 纯展示原语）、TestArena（2.2.16，485→483 行 + components/testArena/compactPrimitives.tsx 紧凑原语，与棋盘原语刻意不合并），均为纯移动零行为变化；三文件余下均为闭包绑定件，再拆需解闭包——**用户已决定（2026-09-24）：不解闭包、不做，除非有明确收益**。阶段 C 首刀已落地（2.2.17，b/d 销案）；阶段 D 首刀已落地（2.2.18，rngState 见 D-2 进度）；稳定期下一轮按序：阶段 E（引擎生命周期常驻，D-1），开工前待用户口令** | 阶段 B（前二，完）/F（完） |
| D-7 | `npm run build` 内嵌 `npm install`（构建依赖网络、伪装安装语义） | 评审异议记录在案；本仓离线单文件分发场景为初因，改动需连同分发文档，列入 2.3 议题而非 2.2.11。**已落地（v2.3.3）：build=`node scripts/preflight-build.mjs && vite build`——防呆脚本按脚本位置派生根、四态检查（不存在/不可读/空/无 vite）显式指路安装命令，绝不静默安装；分发文档 README/AGENTS/RELEASE_PIPELINE 三处同步；CI 预检确认各 job 本有显式 install、workflow 零改动；守卫测试沙箱 spawn 5 例（§12-22）** | **已落地** |
| D-8 | 周边文档易漂移 | 2.2.11 起登记纪律扩至五文档（README/AGENTS/CHANGELOG 纳入核对），见 PROJECT_RELEASE_PIPELINE.md | **已落地** |
| D-9 | "某事件该不该进 EngineState/Replay"的争论随 B/C/D 类数据增多会反复出现（项目已实际分化出四类数据但归类口径散落各决议） | **四类信息分类契约**（2026-09-25 收官体检提出并登记）：**A 游戏事实**（Attack/Damage/Death/Draw/SkillActivated/ArmorDestroyed）→ 必进 canonical execution/replay 语义；**B 容器观察**（ReactionWindow OPENED/CLOSED、openedAt、HUD 状态）→ 可不进 EngineState/Replay，禁止为"完整感"硬塞；**C 诊断**（COUNT_MISMATCH/UNRESOLVABLE_KEY/MISMATCHED_SLOTS）→ 带外通道，只解释 fallback 不改事实；**D legacy/migration**（legacy_armor_destroyed_*、schemaVersion 1、缺 header、旧事件形态）→ 历史兼容层，非 canonical 规则。今后一切"录不录"争论先归类再裁决（A 必录；B/C/D 默认不录，升级为 A 需显式决议）。**C 类消费者扩充（2.3.0）：编译期 skip 诊断（NO_RUNTIME_PAYLOAD/TRIGGER_UNSUPPORTED 等，WeakMap `getCompileDiagnostics`+条目级 warn）是第二个带外诊断通道，与 2.2.23 回退诊断同契约——可自动降级、不可无痕降级**。**A/B 类户口扩充（2.3.1，D-3c 首检）：SKILL_ACTIVATED+consumedSkills 台账=A 类必录（canonical 事件流+录像）；`turnEndAsk` 询问窗投影字段=B 类容器观察（不进 EngineState/录像/存档——快照只序列化 engineState，结构上进不了档）；窗内 ACTIVATE_SKILL/结束回合决策=A 类 canonical action 必录——"窗口可以不录；窗口里的游戏决策不能不录"自此有真机证据** | 2.3 第一治理项（本表登记即落地；后续在契约文档统一引用措辞） |

## E. UNVERIFIED / 低把握条目（诚实清单）

- `rules/RuleEngine.ts` 与 `ActionValidator` 的职责边界未逐条对账（表中记 COMPAT 系保守判断）。
- `controllers/*` 实际调用面未逐一核实（E2E 覆盖主链路），D-1 动它之前先补读。
- 旧 AI 三件套（Bot/Difficulty/RandomStrategy）判定 LEGACY 仅依据"全库零引用"，删除前需再确认开发者窗口无动态引用。
- 各模块 "Introduced" 列在 1.x 区间为约记（精确到小版本需翻 1.x 仓库历史，未做）。

## F. Trigger 契约表（2.3 内容时代起，需求驱动引入）

用法：每个新 Trigger 上账必须先填满十二格；Effect 一律经 bridge 派生事件回流 canonical 链（TransitionCore 唯一转移），不得自带第二套状态修改机制；本表随刀次追加，未上表的触发类型=未立项。

### onBecomingTarget（v2.3.0 落地，2.3 首个需求驱动闭环）

| 格 | 契约 |
|---|---|
| Event | **复用既有 `BEFORE_DAMAGE`（零新增事件）**——AttackResolver 将领导向分支发射；本营分支不带 `targetPlayerId`，天然不匹配不发 |
| Timing | 成为攻击目标之时、伤害结算之前发射；派生效果在触发链 BFS 尾部展开（时序冻结见 Reentrancy） |
| Source | 攻击发起方（事件本体由 AttackResolver 产，随 dispatch 返回流走） |
| Target | 本将=被指定目标（`data.targetId ?? data.target`） |
| Trigger | `onBecomingTarget`（compiler SUPPORTED / dataTypes / bridge TRIGGER_EVENT_MAP 三表同步，各 7 类） |
| Condition | `idEq(ownerId, data.targetPlayerId)` 且 `(!generalId || idEq(generalId, data.targetId ?? data.target))`；BEFORE_DAMAGE 在 EventProcessor 是 default 纯通知（不改状态），非技能路径零副作用 |
| Effect | 经 SkillTriggerBridge 派生后续事件（如反伤 DAMAGE）回流 canonical 链，Effect 不自带状态修改 |
| RNG | 不涉随机（反伤目标=攻击发起方，确定指向） |
| Replay | **A 类必录**：BEFORE_DAMAGE 本体与派生反伤 DAMAGE 均在 dispatch 返回事件流内→随 entry.events 进录像，重建回放逐字一致（四路对账扩例钉死） |
| Transition | 唯一 `TransitionCore.transition`，无旁路 |
| Reentrancy | 有界重入 ≤8 轮既有纪律；冻结时序=派生反伤在源 DAMAGE+ATTACK_RESOLVED+AFTER_DAMAGE 之后、同 dispatch 内结算 |
| Death chain | 目标死于源伤害时反伤**仍落**（事件先生成语义）；反伤致死走既有 DEATH→onKill/onDeath 链（2.2.17） |
| 优先级 | TriggerEngine priority 50（介于 onDamageTaken 与 onKill 语义层） |
| 活例 | PRACTICE_SKILLS「演練・回刺」（ai/matchSetup.ts）——2.3.0 前是全库唯一"已声明且静默失效"技能，B0→B1 逐势力差即其实火证据 |

### onTurnEnd（v2.3.1 落地，第二个需求驱动闭环；**非事件自动触发形态**——玩家决策 canonical action）

| 格 | 契约 |
|---|---|
| Event | **不新增映射**：TURN_END 事件早已在总线（TurnResolver/chainedConsequences），但**刻意不入 TRIGGER_EVENT_MAP**（若映射则 END_TURN 一到自动触发=剥夺玩家决策且与本窗设计双火）；进局事实事件=**`SKILL_ACTIVATED`**（A 类新增）+ 效果事件 |
| Timing | 回合结束**之时之前**由玩家决策发动：人类座按结束回合→store 开询问窗挂起 END_TURN dispatch（回合冻结）；发动动作是真 dispatch，效果在同一次 ACTIVATE_SKILL 转移内结算完，再补发原 END_TURN 链 |
| Source | 当前回合玩家（本人决策发动；AI 座经策略层出**真实** ACTIVATE_SKILL/跳过动作，禁直改状态） |
| Target | 由技能 runtime 载荷目标解析决定（守夜=SELF）；resolver 不做目标判定、只翻译 |
| Trigger | `onTurnEnd`——可发动性判定住在 `skills/turnEndSkills.ts`（`listAllTurnEndDefinitions`：场上将 runtime 含 turn 族触发 + turnSubType 匹配当前回合 + 当回合台账未消费），**不经触发注册表**（冷引擎 isLegal 探针同样工作） |
| Condition | resolver 五连门（拒收原因诚实）：MALFORMED_PAYLOAD→PLAYER_NOT_FOUND→TURN_END_SKILL_NOT_FOUND→GENERAL_NOT_CONTROLLED（含他人将/otherTurn 冒名）→SKILL_ALREADY_ACTIVATED（`` consumedSkills.stableId === `${turn}:${skillId}` ``） |
| Effect | 经 `SkillTriggerBridge.createSkillEvents`（**静态、与事件触发路径同一份代码**）翻译回流 canonical 链——Effect 零自带第二套状态修改机制，禁第二转移路径不破 |
| RNG | 不涉引擎随机（发动是决策不是采样）；效果若为摸牌则消费 rngState 游标=既有抽牌链 |
| Replay | **A 类必录**：ACTIVATE_SKILL 动作+SKILL_ACTIVATED+效果事件全在 dispatch 返回流→随 entry.events 进录像，重建回放逐字重放；**询问窗本身（turnEndAsk/OPEN/CLOSE）=B 类不录**——窗态住 store 投影，快照只序列化 engineState，结构上进不了存档（D-3c 追加钉死句首检） |
| Transition | 唯一 `TransitionCore.transition`；开窗=容器 `openReactionWindow`（2.2.25 入口），门控=store 层 dispatch **前**延迟，不触转移路径一个字 |
| Reentrancy | 有界重入 ≤8 轮既有纪律；窗内多技能按候选表顺序逐个询问（发动后 ask 收缩重算，剩余候选继续挂窗），全结算/跳过才放行 END_TURN |
| Death chain | 回合结束技效果致死（如未来 DAMAGE 型 onTurnEnd）走既有 DEATH→onKill/onDeath 链（2.2.17），台账不受影响 |
| 优先级 | 窗口身份确定性 id `rw:<turn>:<round>:turn-end-ask:<turn>:<playerId>:<seq>`；多技能顺序=turnEndSkills 定义表序（PrioritySystem 既有语义不变） |
| 活例 | PRACTICE_SKILLS「演練・守夜」（onTurnEnd 摸 1 张，永不自动触发）；B1→B2 胜席漂移含其装配 RNG 效应；编辑器/Excel 支持零代码改动（`triggerTypeLabels`"回合结束时"既有、同表往返）；真机双场景：⚡发动（台账+抽牌+闭窗+回合推进）/ ⏭️跳过（台账 0 直接推进） |

### DISCARD 弃牌原语（v2.5.0 落地，2.5 首个新 Effect 原语；**首个按十二格上表的 Effect 原语**——建议书口径"先填表后动刀"执行）

| 格 | 契约 |
|---|---|
| Event | **派生 `DISCARD{ playerId, count }`**（`core/Event.ts` 事件联合新增；SkillTriggerBridge 只产事件**不自带状态修改**，EventProcessor `case 'DISCARD'`→`applyDiscardEvent` 是唯一结算点） |
| Timing | 与其他 Effect 派生事件同族：触发链 BFS 尾部落账；反馈=受击伤害事件之后同 dispatch 内弃牌；断肠=onDeath 触发（2.2.17 DEATH 派生链内）击杀者结算弃光 |
| Source | 技能持有者（TRIGGERED 事件 source）；弃谁由载荷 target 角色经事件 data 解析 |
| Target | **键定到 PLAYER 而非将领实例**（手牌住在玩家身上）：SELF=技能源；ATTACKER=`data.sourcePlayerId ?? attackerPlayerId`；TARGET=`data.targetPlayerId`——断肠实证：击杀者将领若已离场，其**玩家**仍须弃光（离场的将不欠牌，玩家欠） |
| Trigger | **非新触发**——原语与触发解耦，首批借既有 `onDamageTaken`(allDamage) / `onDeath` 两类上表（即 v2.4.0 §G 档2 行的预言路径；19 条档2 引用的其余技能仍受各自触发/条件缺口约束） |
| Condition | `playerId` 缺失/非有限数→no-op；`count=Math.max(0,floor(value))`；**空手诚实空转**（DISCARD 事件照样入账=触发确实发生了，弃牌堆不增——transitionEquivalence 空转例钉死） |
| Effect | 手牌数组**头部确定性选取**前 count 张（count=0=弃光哨兵取全部）；路由与登场/移动/补给消耗同轨：资源卡→`discardPile`、将领卡→**拥有者 generalPool**；TransitionCore 外零新转移机制 |
| RNG | **零新增随机面**：不咨询 rngState、不改游标；无"随机弃"语义（那需要玩家决策通道=按需池需求，登记不造）。回放逐字节一致（同配置两跑测试） |
| Replay | **A 类必录**：DISCARD 事件在 dispatch 返回事件流→随 entry.events 进录像；四路对账扩 3 例（反馈 1 张链、断肠弃光链、空手空转）逐事件一致 |
| Transition | 唯一 `TransitionCore.transition`；`applyDiscardEvent` 为纯 `(state,event)→state` 且仅经 EventProcessor.apply 分发调用（2.2.13 单入口纪律保持） |
| Reentrancy | 2.5.0 时点 DISCARD 不派生任何可触发事件→**无新增重入面**；**v2.6.2 此判语已兑现扩面**：DISCARD 结算现派生 `via='DISCARD'` 的 CARD_LOST（带结算后 remainingHand），闭环风险与闸口评估见下方"CARD_* 事件源扩面"表；单技能回合内幂等仍由承载触发的单次性保证（一次伤害只发一条 onDamageTaken；一次死亡只发一条 DEATH） |
| Death chain | 断肠本身是死亡链内效果（onDeath）；弃牌不抽牌→不触牌堆重洗、与本营空池扣血链零交互；反馈反噬致死路径不适用（弃牌非伤害）——**规则交互观察**：反馈可吃掉攻击者**尚在手牌中的攻击消耗卡**（消耗卡结算后回手），账本一致、属规则后果非缺陷（HANDOFF §12-29） |
| 优先级 | 承载触发类型既有优先级（onDamageTaken/onDeath 均走 TriggerEngine 现表），原语不自带优先级 |
| 忠实度 | **反馈=B**（原技"获得伤害你的一张牌"=转移，转移原语缺→实现为"伤害来源弃 1"，效果相近、归属不同，§G 行已注）；**断肠=A**（"击杀者弃置其所有手牌"忠实全量）——GPT 首检采纳② A/B/C 标签首批应用 |
| 三处同步 | 扩枚三处随刀完成：`skillCompiler.SUPPORTED_EFFECT_TYPES` + `dataTypes.SkillRuntimeEffect.type` 联合 + `skillExcelFormat` 标签"弃牌"（编辑器 RuntimeEditor 预览"弃 N 张手牌/弃全部手牌"同步）；**value=0 哨兵仅数据层**——Excel 数值列与编辑器 min=1 不收 0（表面缺口登记 HANDOFF §12-29，弃光载荷目前只能经代码入库） |
| 活例 | `SK_FANKUI`（司马懿 wei_002，onDamageTaken-allDamage→DISCARD 1 ATTACKER）、`SK_DUANCHANG`（蔡文姬 qun_012，onDeath→DISCARD 0 ATTACKER）；真机断肠台账：热座房「五丈原之战4734」P1 击杀蔡文姬后 P2 手牌 14→0、弃牌堆 +6（1 攻击消耗+5 资源）、将领池 +8（将领卡回池）、墓地 +1 |

### GIVE 发放原语（v2.5.3 落地，2.5 第二个新 Effect 原语=DISCARD 的镜像；建议书 ② 发放 7 条；**非内容刀：本刀只接线、不配任何内置载荷**）

| 格 | 契约 |
|---|---|
| Event | 新事件 `GIVE{ fromPlayerId, toPlayerId, count }`（`core/Event.ts` 联合新增）；SkillTriggerBridge 只产事件不自带状态修改，EventProcessor `case 'GIVE'`→`applyGiveEvent` 是唯一结算点；结算真实移动后由 `enqueueDerivedConsequences` 派生 `CARD_LOST{ playerId=from, count, via:'GIVE' }` + `CARD_GAINED{ playerId=to, count, via:'GIVE' }`（纯通知事件，自身无结算分支） |
| Timing | 与 DISCARD 同族：触发链 BFS 尾部落账；派生 CARD_* 走**重入环**（见 Trigger 表 Reentrancy 格）在**同一 dispatch** 内进入触发链 |
| Source | 发放者恒=技能拥有者**玩家**（手牌住在玩家身上，与 DISCARD 键定同轨）；接收者由载荷 target 角色经触发事件 data 解析 |
| Target | 角色解析与 DISCARD 同表：SELF=技能源玩家；ATTACKER=`data.sourcePlayerId ?? attackerPlayerId`；TARGET=`data.targetPlayerId`。**接收者=角色解析结果**——"指定任意角色"需玩家决策通道（反应窗/choice 未接线），属按需池，本刀不造；遗计/好施类"自由分发"语义因此**接线≠可配**，解锁还差决策通道 |
| Condition | `fromPlayerId/toPlayerId` 缺失/非有限数、**两者同一**、或接收者 `isAlive===false` →整笔诚实空转（GIVE 事件照样入账=触发确实发生，手牌不动——与 DISCARD 空手空转同一纪律）；`count=Math.max(0,floor(value))`，**0=全手哨兵**与 DISCARD 同值同义；发放者空手=空转 |
| Effect | 手牌数组**头部确定性选取**前 count 张（与 DISCARD 同一选择策略，账本可预测）；**手→手整卡转移**：资源卡与将领卡均入接收者 hand（将领卡不折向 generalPool——接收者日后自行登场/消耗，与抽牌入将口径一致）；不触碰弃牌堆/将领池 |
| RNG | **零新增随机面**：不咨询 rngState、不改游标；无"随机给"语义。回放逐字节一致（同配置两跑测试） |
| Replay | **A 类必录**：GIVE 与其派生 CARD_LOST/CARD_GAINED 均经重入环回灌 dispatch 返回事件流→随 entry.events 进录像；四路对账扩例（真实移动链、空转链、派生触发链）逐事件一致 |
| Transition | 唯一 `TransitionCore.transition`；`applyGiveEvent` 为纯 `(state,event)→state` 且仅经 EventProcessor.apply 分发调用（2.2.13 单入口纪律保持） |
| Reentrancy | **本原语是全链第一个"结算派生可触发事件"的 Effect**：GIVE→CARD_*→监听技能→新 Effect→(可再 GIVE)——由 `TransitionCore` 重入环**既有上限**约束（`MAX_TRIGGER_REENTRY_ROUNDS=8` + `EngineDispatchFlow` 深度 32/链上 256 双闸），触顶记 `CUSTOM{TRIGGER_REENTRY_LIMIT}` 哨兵（该事件 data 键 `pendingDeaths` 随泛化更名 `pendingReactions`=纯标记面、B6 内容永不触达、录像零影响）；既有 DISCARD/DRAW/DAMAGE 结算**不派生** CARD_*（2.5.3 时点事件源仅 GIVE）→B6 逐字一致结构性成立。**v2.6.2 更新**：DISCARD/EQUIP_STRIP 两路已派生 CARD_LOST、GIVE 源的 CARD_LOST 加性携带 remainingHand，见下方"CARD_* 事件源扩面"表 |
| Death chain | 发放不造成伤害→不触 DEATH 派生；接收者阵亡在派发时点已由 isAlive 闸挡住下一笔；派生 DRAW（连营类合成例）走既有 DRAW_REQUIRED/DRAW 结算与空池重洗链，零新交互 |
| 优先级 | 原语不自带优先级，承载触发走 TriggerEngine 现表 |
| 忠实度 | 本刀无内置技能进局→**A/B/C 标签随转正刀逐技能补打**（接线≠转正，GPT 首检采纳①）。§G 预判：仁德/好施/恂恂/白眉=发放语义，遗计"分牌给任意角色"受决策通道缺口约束 |
| 三处同步 | `SkillRuntimeEffect.type` 联合 + `skillCompiler.SUPPORTED_EFFECT_TYPES` + `dataTypes.DataSkillEffectType` + `skillExcelFormat.runtimeEffectTypeLabels`（"发放"）与 `SETTLEABLE_RUNTIME_TYPES` + `RuntimeEditor` 预览"发放 N 张手牌/全部手牌"；**value=0 全手哨兵与弃光同缺口**：Excel/编辑器数值 min=1 不收 0（§12-29 表面缺口原样适用） |
| 活例 | **无（非内容刀）**——合成载荷经测试装配进局（v2.5.1 探针先例）：transitionEquivalence/skillPipeline 合成 GIVE 例钉死账形，内置 168→36/133 账本不动 |

### onCardLost / onCardGained 触发族（v2.5.3 落地，2.5 首个新触发上表；建议书 ③ 失去/获得牌触发 6 条；同为**非内容刀接线**）

| 格 | 契约 |
|---|---|
| Event | 承载事件=上文派生 `CARD_LOST` / `CARD_GAINED`（纯通知：无 EventProcessor 结算分支、自身不改状态——与 BEFORE_DAMAGE 同一"纯通知进 TRIGGER_EVENT_MAP"先例，v2.3.0 onBecomingTarget 形态） |
| Timing | 仅经 `TransitionCore` 重入环进入触发链（GIVE 结算落账后、同 dispatch 内）；**不在 dispatch 前置链**（resolver 不产 CARD_*，前置链见了也是空转，不扩面） |
| Source | 监听注册键定到**失去/获得牌的 PLAYER**（`data.playerId`）；手牌是玩家资产、将领不"拥有"手牌→**不做 sourceGeneralId 收窄**（与 DISCARD Target 格"键定 PLAYER 而非将领实例"同一实证教训；拥有者将领已离场其玩家仍欠账/受账） |
| Target | 触发只判归属，不解析目标；派生 Effect 的目标解析走各原语既有表 |
| Trigger | 新枚 `onCardLost`/`onCardGained` 上三表：`SkillTriggerType` 联合（+中文标签"失去手牌时/获得手牌时"，Excel 下拉经 `allExcelTriggers` 自动继承）+ `SUPPORTED_TRIGGER_MAP` + `DataSkillTrigger` + `TRIGGER_EVENT_MAP`（→CARD_LOST/CARD_GAINED）+ `PRIORITY`=50（与 onDamageTaken 等同族）+ `buildCondition` 两 case |
| Condition | `data.playerId` 缺失/非有限数→条件不成立；一卡一事件、按事件逐张还是逐批=**逐批单事件**（一张 GIVE 只派生一条 CARD_LOST，count 携带张数；"每失去一张摸一张"类连营语义=数量函数，属⑥自定义条件/逐张拆分缺口，登记不造）。**v2.6.2 谓词面补上**：编译载荷 `cardFilter` 三枚——equipment→仅 `via==='EQUIP'` 响、lastHand→仅 `remainingHand===0` 响（结算后哨兵）、hand→非装备失牌源皆响；谓词只读事件已记录事实、不二次推导，EQUIP 源不带 remainingHand 故天然喂不响 lastHand=语义正确非缺口 |
| Effect | 触发本身只产 Effect 派生事件（复用 `createSkillEvents` 唯一翻译码）；派生 GIVE 再派生 CARD_*=循环面→由重入环上限约束（见 GIVE 表 Reentrancy 格） |
| RNG | 触发判定零随机；派生 DRAW 的随机走既有 RANDOM_OUTCOME 记录面，无新面 |
| Replay | 触发链事件（TRIGGERED 标记+派生 Effect）随 entry.events A 类必录；重入链四路对账例逐事件一致 |
| Transition | 无新转移：CARD_* 零结算分支；一切状态变化仍经唯一 TransitionCore |
| Reentrancy | **首批"结算派生事件可触发技能"的正式接线**；闭环风险=获得→发放→再获得类囤积循环，三道既有闸兜底（重入轮 8/深度 32/链上 256），触顶 TRIGGER_REENTRY_LIMIT 哨兵；2.5.3 时点**事件源覆盖=首批仅 GIVE 派生**（DISCARD/被拆装备等暂不派生→伤逝/连营/枭姬类**接线≠可用**）。**v2.6.2 兑现扩面**：DISCARD/被拆装备两路已派生 via 标注的 CARD_LOST，连营/枭姬随刀转正（十二格事件源节+重入评估=下方"CARD_* 事件源扩面"表；仍闭面：登场/移动/补给消耗、DECK_PLACE、阵亡弃牌与获得侧非 GIVE 源；伤逝仍需失牌差值自定义条件=接线≠可用维持；智愚类获得侧 GIVE 路径即时可达不变） |
| Death chain | 失去/获得牌非伤害零直接交互；承载 Effect 若为 DAMAGE 则走既有技能击杀→DEATH 回灌链（2.2.17），重入环同一上限覆盖叠深 |
| 优先级 | onCardLost=onCardGained=50（与受击族同档，不抢占登场/死亡 100 档） |
| 忠实度 | 2.5.3 无内置技能进局→标签随转正刀补打；§G 预判：智愚=获得侧可得、忘隙真实语义=回复触发（onHeal 缺，非本族，行内已注）、伤逝=失牌差值条件（叠加⑥自定义条件缺口）。**v2.6.2 转正首批补打**：连营=**A**（"被顺走/被弃置"两路=GIVE/DISCARD 源均已覆盖，最后一张=remainingHand 哨兵逐读结算后事实；仍喂不响的失牌面见事件源表闭面清单）、枭姬=**B**（原技泛指"失去一张装备牌"，现装备离场面唯一=EQUIP_STRIP 被剥离，装备随主阵亡离位不派生=覆盖差异已注） |
| 三处同步 | 触发三表+两枚中文标签+RuntimeEditor/TriggerEditor 下拉随刀；数据层枚举扩枚即入库合法（编译诚实契约：录入未支撑组合仍走 skipped 通道） |
| 活例 | 2.5.3 本刀=非内容刀，合成装配测试：onCardGained→DRAW 1 SELF 接收者真摸牌（重入链账形钉死）；onCardLost→DISCARD 空转负例（当时 DISCARD 不派生）。**v2.6.2 活例翻正**：该"DISCARD 空转"预期随派生落地**改写为派生正例**（预期翻转非削弱，transitionEquivalence v2.5.3 节登记）；真实内置活例=连营/枭姬两条进局（转正实证例：同一次多步对局枭姬吃装备剥离摸 2、连营吃断肠弃光摸 1，四路径逐事件一致+谓词静默反例双钉） |

### EQUIP_STRIP 拆解装备原语（v2.6.0 落地，2.6 首个新 Effect 原语=第七原语；建议书 ⑤ 装备区交互 6 条；**内容刀：本刀接线即配首批两条内置载荷 强袭/崩坏**）

| 格 | 契约 |
|---|---|
| Event | 新事件 `EQUIP_STRIP{ targetPlayerId, targetId, count }`（`core/Event.ts` 联合新增）；SkillTriggerBridge 只产事件不自带状态修改，EventProcessor `case 'EQUIP_STRIP'`→`applyEquipStripEvent` 是唯一结算点；v2.6.0 本刀刻意不派生任何 CARD_*（挂账 v2.6.2）——**v2.6.2 已兑现**：被拆装备→`via='EQUIP'` 的 CARD_LOST（差值从结算前后状态读取），见下方"CARD_* 事件源扩面"表 |
| Timing | 与 DISCARD/GIVE 同族：触发链 BFS 尾部落账，经 `TransitionCore` 重入环在**同一 dispatch** 内进入结算链 |
| Source | 拆解发起者恒=技能拥有者将领所在玩家（不经载荷传递）；**受害者按 GENERAL 键定**——装备住在前线将领的 `armorCards` 数组上（本项目唯一装备面，无装备槽），故 `targetId=技能目标将领的 runtime card id`，其所在玩家由 `findGeneralRef` 反查得 `targetPlayerId`（AFTER_DAMAGE 载荷不带 targetPlayerId=与 GIVE TARGET 空转同一实证教训） |
| Target | 角色解析与 DISCARD/GIVE 同表：SELF=技能源将领；ATTACKER=`data.sourcePlayerId ?? attackerPlayerId`；TARGET=`data.targetPlayerId`（由目标将领反查）。**强袭=TARGET（拆被击目标）、崩坏=SELF（拆自身）** |
| Condition | `targetPlayerId` 缺失/非有限数、`targetId` 缺失、目标将领不在场（`findGeneralRef` 命中失败=已被本次伤害击杀）、`armorCards.length===0` →整笔诚实空转（EQUIP_STRIP 事件照样入账=触发确实发生，装备不动——与 DISCARD 空手/GIVE 空转同一纪律）；`count=Math.max(1,floor(value))`（**装备面无"全部"哨兵语义**，min=1 与载荷一致，不采 0） |
| Effect | `armorCards` **头部确定性选取**前 count 张（与 DISCARD/GIVE 同一选择策略，账本可预测，零新随机面）；**路由随卡片类型**：资源卡→`state.discardPile`、将领卡→拥有者 `generalPool`（防御性诚实，与登场/移动/补给消耗同路由）；每拆一张 `currentArmor = max(0, currentArmor − 张数)`（点制 GAIN_ARMOR 护甲共用同一货币，拆解如实扣减）；`armorCards` 清空时 `isArming=false` |
| RNG | **零新增随机面**：不咨询 rngState、不改游标；头部选取确定性。回放逐字节一致（同配置两跑测试） |
| Replay | **A 类必录**：EQUIP_STRIP 经重入环回灌 dispatch 返回事件流→随 entry.events 进录像；四路对账扩例（真实拆解链、空转链、击杀后空链）逐事件一致 |
| Transition | 唯一 `TransitionCore.transition`；`applyEquipStripEvent` 为纯 `(state,event)→state` 且仅经 EventProcessor.apply 分发调用（2.2.13 单入口纪律保持） |
| Reentrancy | v2.6.0 时点拆解不派生可触发事件→**无新增重入面**；**v2.6.2 起被拆装备派生 `via='EQUIP'` CARD_LOST**（不带 remainingHand，装备说话不了手牌），闭环评估移交事件源扩面表（该表 Reentrancy 格=本族唯一权威口径）；单技能回合内幂等由承载触发的单次性保证（一次攻击只发一条 onDamageDealt；一次被瞄准只发一条 onBecomingTarget） |
| Death chain | 拆解本身不造成伤害→不触 DEATH 派生；**强袭承载于 onDamageDealt**：击杀发生时目标已离场，其 EQUIP_STRIP 经 findGeneralRef 失败=诚实空转（先伤后拆、拆不到亡者，时序如实）；崩坏承载于 onBecomingTarget：结算前/后由既有触发优先级决定，不减当次伤害 |
| 优先级 | 原语不自带优先级，承载触发走 TriggerEngine 现表（onDamageDealt=反伤族档、onBecomingTarget=v2.3.0 结算前族） |
| 忠实度 | **强袭=A**（原技"移除目标装备区一张牌"=拆 armorCards 头部 1 张忠实，资源进弃牌堆/将领回池路由差异已在 Effect 格注死）；**崩坏=B**（原技"成为基本牌目标后弃置装备"含"基本牌"谓词、现触发为广义 onBecomingTarget，且落账时序=伤害结算后、不减当次伤害——效果相近、条件与时序归属不同，§G 行内已注）——GPT 首检采纳② A/B/C 标签第三批应用 |
| 三处同步 | `SkillRuntimeEffect.type` 联合（`generals.ts:140` +`dataTypes.DataSkillEffectType`）+ `skillCompiler.SUPPORTED_EFFECT_TYPES`（+"EQUIP_STRIP"）+ `skillExcelFormat.runtimeEffectTypeLabels`（"剥离装备"）与 `SETTLEABLE_RUNTIME_TYPES` + `RuntimeEditor` 预览"剥离 N 张装备"+ `SkillTriggerBridge` EQUIP_STRIP 分支；**min=1 不收 0**：装备面无全清哨兵，表面缺口不同于 DISCARD/GIVE 的 0=全部（本刀刻意不同，Effect 格已注） |
| 活例 | **两条内置技能进局（内容刀）**：`SK_QIANGXI` 典韦 wei_012（onDamageDealt/attackDamage→EQUIP_STRIP 1 TARGET，描述"造成攻击伤害后，剥离伤害目标的一张装备卡（入弃牌堆，其护甲值相应减少）。"）+`SK_BENGHUAI` 董卓 qun_004（onBecomingTarget→EQUIP_STRIP 1 SELF，描述"成为攻击目标时惊惶失据：弃置自己的一张装备卡（伤害结算后落账，不减当次伤害）。"）——均为原档2 技能因新原语到位进局；账本 168→**38 runtime 定义/131 诚实跳过**（批 +2） |

### REVEAL 观顶原语（v2.6.1 落地，2.6 第二个新 Effect 原语=第八原语；§G 档2"观牌堆顶"族；**非内容刀：本刀只接线、不配任何内置载荷**）

| 格 | 契约 |
|---|---|
| Event | 新事件 `REVEAL{ viewerPlayerId, count }`（`core/Event.ts` 联合新增）；SkillTriggerBridge 只产事件不自带状态修改，EventProcessor `case 'REVEAL'`→`applyRevealEvent` 是唯一结算点；不派生任何 CARD_*（v2.6.2 事件源扩面落地后 REVEAL 纯观察零位移、本就不在派生面=维持，见事件源扩面表） |
| Timing | 与 DISCARD/GIVE/EQUIP_STRIP 同族：触发链 BFS 尾部落账，经 `TransitionCore` 重入环在**同一 dispatch** 内进入结算链 |
| Source | 观看者恒=技能拥有者**玩家**（`viewerPlayerId=Number(ownerId)`）；牌堆是全局共享资产、按玩家键定观看权，无将领实例面 |
| Target | 无目标解析——观看是技能拥有者的单方行为；载荷 target 角色字段照传但结算不使用（表面一致性，未来 HUD 若展示"给谁看"再上表） |
| Condition | `viewerPlayerId` 缺失/非数字→诚实空转；**有效载荷同样原样返回状态**——"状态零变化"不是兜底路径而是本原语的语义本身（看牌不动牌） |
| Effect | **零位移**：顶 count 张的身份仅信息面（编辑器/日志可见"看了"），不写入 EngineState；**零 rngState 消耗**——牌堆顺序本已定死，重放重算同一张顶牌，无需咨询随机源；事件照样入账=触发确实发生（与 DISCARD 空手/GIVE 空转/EQUIP_STRIP 空装同一"空转也记录"纪律） |
| RNG | **全原语族首个"零位移也零随机"原语**：不咨询、不动游标；这是其回放确定性的构造性证明（非经验断言） |
| Replay | **A 类必录**：REVEAL 经重入环回灌 dispatch 返回事件流→随 entry.events 进录像；四路对账扩例与同配置两跑逐字节一致（transitionEquivalence v2.6.1 合成例：窥看 REVEAL+归堆 DECK_PLACE 复合链） |
| Transition | 唯一 `TransitionCore.transition`；`applyRevealEvent` 为纯 `(state,event)→state` 且实际返回同一 state（2.2.13 单入口纪律保持） |
| Reentrancy | 不派生任何可触发事件→**零新增重入面** |
| Death chain | 观看不造成伤害、不动牌→与 DEATH 链零交互 |
| 优先级 | 原语不自带优先级，承载触发走 TriggerEngine 现表 |
| 忠实度 | 本刀无内置技能进局→A/B/C 标签随转正刀补打；§G 预判：观星=观顶后**排序**（choice 决策面属 v2.6.3）、洛神=花色红黑判定（牌面无花色面→维持档4纯描述）、心战/自书/秘置=多效果组合——**五候选全部不能在本刀忠实进局，强行配=不发明玩法红线，故本刀定级非内容**（用户确认 2026-09-26） |
| 三处同步 | `SkillRuntimeEffect.type` 联合（`generals.ts` +`dataTypes.DataSkillEffectType`）+ `skillCompiler.SUPPORTED_EFFECT_TYPES`（+"REVEAL"，共 9 原语）+ `skillExcelFormat.runtimeEffectTypeLabels`（"观顶"）与 `SETTLEABLE_RUNTIME_TYPES` + `RuntimeEditor` 预览"观看牌堆顶 N 张"+ `SkillTriggerBridge` REVEAL 分支 |
| 活例 | **无（非内容刀）**——合成载荷测试装配进局（v2.5.1/v2.5.3 先例）：EventProcessor.test REVEAL 节 + transitionEquivalence 复合链例钉死账形；内置账本 **38/131 不动**、ai-battle 对 B7 逐字一致 |

### DECK_PLACE 置牌入堆原语（v2.6.1 落地，2.6 第三个新 Effect 原语=第九原语=**GIVE 的手牌→牌堆镜像**；**同为非内容刀接线**）

| 格 | 契约 |
|---|---|
| Event | 新事件 `DECK_PLACE{ playerId, dest, count }`（`core/Event.ts` 联合新增）；EventProcessor `case 'DECK_PLACE'`→`applyDeckPlaceEvent` 是唯一结算点；**不派生 CARD_***（手牌离手路径与 DISCARD 同纪律——v2.6.2 事件源扩面落地时 DECK_PLACE 手牌位移**刻意仍不派生**：本批内容无一置牌驱动、扩面对它无增益，闭面清单见事件源扩面表，未来需求须先补表再动刀） |
| Timing | 同上族：触发链 BFS 尾部落账、同 dispatch 内结算 |
| Source | 被置手牌的玩家恒=技能拥有者**玩家**（手牌住在玩家身上，与 DISCARD/GIVE 键定同轨） |
| Target | 无角色解析——放置对象永远是拥有者自己的手牌；载荷 target 照传不用（同 REVEAL Target 格口径） |
| Condition | `playerId` 缺失/非数字、玩家不存在、**空手**→整笔诚实空转（事件照样入账）；`count=Math.max(0,floor(value))`，**0=全手哨兵**（手牌面与 DISCARD/GIVE 同值同义，刻意不随 EQUIP_STRIP 的 min=1）；count 超手牌数=clamp 按实际取 |
| Effect | 手牌**头部确定性切片**前 count 张，整段移入共享牌堆**底部（BOTTOM=缺省）或顶部（TOP）并保持相对顺序**；牌堆顶=数组头（与 DRAW 消费面同读法）；**两类卡都物理入堆**——将领卡置于牌堆即等同普通牌堆卡，可经后续空堆重洗再出土；`dest` 为载荷新增可选字段（`SkillRuntimeEffect`/`SkillEffectData`/`RuntimeEffectPayload` 三处 `dest?:'TOP'|'BOTTOM'`，skillCompiler `toEffectData` 透传） |
| RNG | **零新增随机面**：头部切片确定性；入堆不洗牌不动游标。回放逐字节一致（同配置两跑测试） |
| Replay | **A 类必录**；四路对账扩例（TOP 放置+观顶复合链）逐事件一致、录像重建终态逐字相等 |
| Transition | 唯一 `TransitionCore.transition`；`applyDeckPlaceEvent` 纯 `(state,event)→state` 仅经 EventProcessor.apply 分发 |
| Reentrancy | 不派生可触发事件→**零新增重入面**（v2.6.2 扩面落地时维持不派生=闭面清单内，见事件源扩面表）；置牌使手牌真实减张=状态位移的正确语义（手牌数类技能受影响属应有之义），非循环面 |
| Death chain | 放置不造成伤害→不触 DEATH 派生；承载伤害致死时手牌是否仍在其名=结算时点状态决定，闸口即上述"玩家不存在/空手"两条，无特判 |
| 优先级 | 原语不自带优先级，承载触发走 TriggerEngine 现表 |
| 忠实度 | 本刀无内置技能进局→标签随转正刀补打；§G 预判：自书/秘置/心战=**置牌+排序**复合，排序决策属 v2.6.3 choice；观星=REVEAL+DECK_PLACE 双段复合同样待 choice——**机械面本刀就位，决策面缺=诚实不配** |
| 三处同步 | 枚举/编译器/Excel 标签（"置牌入堆"）/SETTLEABLE/桥接分支同 REVEAL 表；**RuntimeEditor 新增 DECK_PLACE 专属"放置位置"下拉（牌堆底默认/牌堆顶）**；Excel v2 六列**无 dest 列**→导入导出一律 BOTTOM，TOP 暂仅结构化编辑器可录（表面缺口登记，本刀不扩列）；数值面沿用 §12-29 缺口：编辑器 min=1 不收 0 全手哨兵 |
| 活例 | **无（非内容刀）**——合成装配测试：归堆（onDamageTaken→DECK_PLACE 1 SELF TOP）实证手牌头张真上堆顶、EventProcessor.test 五例钉死 BOTTOM/TOP/全手/clamp/空转账形；内置账本 38/131 不动、B7 逐字 |

### CARD_* 事件源扩面（v2.6.2 落地，触发族表"事件源首批仅 GIVE"挂账的兑现；连带转正连营/枭姬=**内容刀**；§12-31①"先补事件源十二格节+重入评估再动刀"纪律执行）

| 格 | 契约 |
|---|---|
| Event | 派生对仍=既有 `CARD_LOST`/`CARD_GAINED` 纯通知事件（零新事件枚、零结算分支）；本表管的不是"新事件"而是**谁能派生它们**——扩面=在 `chainedConsequences.enqueueDerivedConsequences` 唯一派生点新增两个观察分支（DISCARD、EQUIP_STRIP），GIVE 分支加性补 `remainingHand` 字段 |
| Timing | 各承载 Effect 结算落账之后、同 dispatch 重入环内回灌监听（与 v2.5.3 GIVE 派生同时序位）；派生事件进的是**既有** REACTION_EVENT_TYPES 环（CARD_LOST/CARD_GAINED 自 2.5.3 即在集合内），不扩集合枚 |
| Source | 三路派生源：**GIVE**（v2.5.3 既有，v2.6.2 起失去侧 CARD_LOST 补结算后 `remainingHand`）；**DISCARD**（本刀新增，`data.playerId` 手牌数差=before−after）；**EQUIP_STRIP**（本刀新增，按 `targetPlayerId`+`targetId` 定位在场将领的 `armorCards` 差）。**刻意不派生（闭面清单，扩任一须先改本表）**：DECK_PLACE/装备穿入等手牌位移、登场/移动/补给/攻击的消耗用牌、玩家阵亡弃牌倾泻、DRAW/护甲得牌/将领卡入手等获得面（获得侧保持 GIVE-only——资援类 onCardGained 需求首现时再评估） |
| Target | CARD_LOST.data.playerId=失牌**玩家**（三路同轨，将领不收窄）；EQUIP 源归属玩家由 EQUIP_STRIP 载荷 targetPlayerId 直读（v2.6.0 已趟平的"伤害不带 targetPlayerId"教训不再适用——该事件自带） |
| Condition | 差值一律从结算前后状态**读出**（derive from what settled=技能击杀 DEATH 同一纪律）：差>0 才派生、差=0 诚实零派生（空手弃牌、无甲可拆、目标已离场→无 phantom 触发）；count=实差张数非请求载荷值 |
| Effect | 派生事件本身零状态位移（纯记录+监听输入事实）；谓词读取面见触发族表 Condition 格（equipment/lastHand/hand 三枚 cardFilter） |
| RNG | **零新增随机面**：差值=确定性状态比较；不碰 rngState 游标（同配置两跑逐字节一致测试为证） |
| Replay | 派生事件=canonical 事件随 entry.events A 类必录；重放对同一提交序列重算同一差值→四路径逐事件一致（转正实证例：枭姬摸 2/连营摸 1 同局两步全链对账） |
| Transition | 无第二转移路径：派生只 enqueue，结算仍 EventProcessor 唯一入口；`applyDiscardEvent`/`applyEquipStripEvent` 本体一字未动 |
| Reentrancy | **本表核心问（§12-31② 评估兑现）**：扩面只增"**谁**派生 CARD_LOST"，不引入新事件类型进环→环的形状不变；成环需"失牌监听技能的 Effect 再制造失牌"，首批转正两条均为 DRAW_CARD（摸牌**不**派生 CARD_GAINED=获得侧闭面兜底），结构上无环；叠深最坏情形仍由三道既有闸兜底（重入轮 8/深度 32/链上 256，触顶 TRIGGER_REENTRY_LIMIT 哨兵）。逐张 vs 逐批口径维持触发族表 Condition 格（逐批单事件） |
| Death chain | DISCARD 源常生于断肠（击杀链上）：DEATH→断肠弃光→CARD_LOST→连营摸 1 在同一次 dispatch 重入环内走完（转正实证内链）；失牌玩家恰已阵亡→该玩家 hand 数差按实际状态读、无特判不派生空账 |
| 优先级 | CARD_LOST/CARD_GAINED=50 不动（扩源不改承载触发优先级） |
| 忠实度 | 连营=**A**（原文"失去最后一张手牌"被顺走/被弃置两路全覆盖=GIVE/DISCARD 双源；remainingHand 哨兵只在手牌面成立）；枭姬=**B**（原文泛指一切装备失去，现装备离场面唯一=EQUIP_STRIP 被剥离；装备随主阵亡离位不派生=覆盖差异，闭面清单注死） |
| 三处同步 | **双词表**：编辑器/数据层 `cardSubType` 五枚（anyLost/equipmentLost/lastHandLost/handLost/anyGained，中文"失去装备牌/失去最后一张手牌/失去手牌/失去任意牌/获得任意牌"）↔ 编译 `cardFilter`（equipment/lastHand/hand，anyLost/缺省=不设筛）；编译器交叉组合诚实 skip（lostOnly 谓词×onCardGained、anyGained×onCardLost→TRIGGER_SUBTYPE_UNSUPPORTED）；Excel v2 六列经"失去手牌时→失去装备牌"主→子串往返（裸旧串仍可解析、下拉改列组合项）；TriggerEditor 新增"卡牌时机"子下拉；generals.ts `CardSubType` 联合+`cardSubLabels`+`getTriggerSubOptions` 'card' 分支 |
| 活例 | **连营** 陆逊 wu_007（onCardLost/lastHandLost→DRAW 1 SELF）+ **枭姬** 孙尚香 wu_008（onCardLost/equipmentLost→DRAW 2 SELF）——批五同局进局；账本 38→**40 runtime 定义/129 诚实跳过**（两条纯名技能出跳过名单）；battleReport 频次表 37→**39 行/38 名键**；静默反例双钉（非最后一张弃牌喂不响连营、DISCARD 源喂不响枭姬） |

### choice 玩家决策通道最小闭环（v2.6.3 落地，GPT 二检 Q4"独立能力层最小闭环"的兑现；**非内容刀：只接渠道、内置零转正**；决策型形态=onTurnEnd 表先例的通用化，按需池 activeSelf/activeOther 行所指"决策 canonical action+窗"形态的正式定基）

| 格 | 契约 |
|---|---|
| Event | 新事件二枚：`CHOICE_REQUIRED{ choiceKey, chooserPlayerId, options:[{ label, events }] }`（欠账要约）与 `CHOICE_RESOLVED{ choiceKey, chooserPlayerId, optionIndex, label }`（决策事实），`core/Event.ts` 联合新增；**不新增 Effect 原语（原语恒 9）也不新增触发键（恒 10）**——唯一生产者面=`skillCompiler` 放行的 `effectMode:'choice'` 定义（新 `choiceMode` 标记），经 `SkillTriggerBridge.createSkillEvents` 静态分支产出要约，现有 10 触发键与 onTurnEnd 询问窗路径天然全部可承载；结算唯一入口=EventProcessor `case 'CHOICE_REQUIRED'/'CHOICE_RESOLVED'`→新文件 `eventProcessors/choiceEvents.ts` |
| 窗（状态面） | **与反应窗/询问窗本质不同：欠账是 A 类可回放游戏事实**——新可选槽 `EngineState.pendingChoice{ key, playerId, options }`（consumedSkills 同思想：住在状态里让常驻/重建/回放三路同见；旧档缺字段=无欠账，零迁移零版本号变更）。**冻结世界闸**：pendingChoice 活跃时 `ActionValidator` 仅放行欠债玩家的 CHOOSE_OPTION（其余动作拒 `CHOICE_PENDING`、他人动作拒 `NOT_CHOICE_PLAYER`）——要约与择定之间世界不动一步，候选永不陈旧、无二次转移路径亦不引入容器时序 |
| Timing | CHOICE_REQUIRED 与同技能其余效果事件同 dispatch 尾部落账（要约在**本步**成立）；被选分支的效果**刻意不在本步结算**——延至 CHOOSE_OPTION 那一次 dispatch 的事件队列按正常结算链落账（延后=新一次结算时点，效果面诚实闸原样适用） |
| Source | 欠债玩家恒=技能拥有者（`chooserPlayerId=Number(ownerId)`）；候选表由桥在触发时点从 state **确定性构造**（label=效果描述兜底技能描述；events=逐效果走与"全部生效"模式同一份翻译闭包），构造过程零随机 |
| Target | 选择对象=记录内选项序号 `optionIndex`（枚举序=编辑器效果序=数据序，三方同序即确定性）；不做角色解析——未来 SELECT_PLAYER/CARD_ORDER 型候选面属后续生产者刀，本刀不预铺 |
| Condition | 拒收五连门（validator+resolver 双道，诚实原因）：CHOICE_PENDING（冻结期非择定动作）/NOT_CHOICE_PLAYER（他人代择）/NO_PENDING_CHOICE（无账可还）/CHOICE_KEY_MISMATCH（旧要约冒领）/CHOICE_OPTION_OUT_OF_RANGE（越界序号）；要约撞车（欠账中又来第二张 CHOICE_REQUIRED）=**单槽不覆写**、事件照记状态不动（撞账登记=多槽需求首现时先改本表）；gameOver 后择定无效=既有相位闸 |
| Effect | CHOOSE_OPTION 结算=CHOICE_RESOLVED 先行清账（settler 置 pendingChoice=null），选中选项的预译事件随后**逐事件走既有 EventProcessor**（摸牌/伤害/弃牌等零新机制）；编译器 `CHOICE_MODE_UNSUPPORTED` 诚实 skip **撤销**→"选择其一"从纯标签变为可运行：同触发≥2 个带 runtime 效果=一张 choiceMode 定义（多 effects 一触发），孤立效果=照常独立定义，无 runtime/触发不支持=照常诚实 skip（账目逐条不变） |
| RNG | **零新增随机面**：候选构造与择定都是确定性；被延的效果事件若含抽牌，消费 rngState 游标与 RANDOM_OUTCOME 记录都发生在**择定那一步**（record-not-reroll 纪律原样兜住） |
| Replay | **全 A 类**：CHOICE_REQUIRED/RESOLVED 与延后效果事件都在 dispatch 返回流、CHOOSE_OPTION 是 canonical 动作→live 录像自动入账、ReplayPlayer 重派生自动重放（**outcomeOverrides 零扩展**——重建 pendingChoice 靠触发步确定性重演，非快照回填）；窗口=状态本身故随快照存恢（对比 turnEndAsk store 投影=B 类：本通道刻意反着选——账在 EngineState，才撑得起"冻结世界"） |
| Transition | 唯一 `TransitionCore.transition`；CHOOSE_OPTION=第 13 个 canonical 动作走 ResolverRegistry（新 ChooseOptionResolver，纯描述不碰状态）；禁第二转移路径不破：择定与延后事件全部经 EventProcessor 单入口 |
| Reentrancy | CHOICE_RESOLVED **不入** REACTION_EVENT_TYPES（集合零扩枚）；延后事件按自身类型进既有重入环（伤害致死→DEATH→onKill/onDeath 照常）=无新环面；冻结闸保证欠账期不产生第二欠账，单槽+撞账闸双兜底 |
| Death chain | 欠账期间拥有者被灭=**账不清、人照择**（与断肠同型的事后结算姿态；validator 只认 CHOOSE_OPTION，欠账不会被其他动作吞掉→无死锁）；延后事件的效果若当事人已离场=对应结算闸诚实空转（GIVE 死接收/DISCARD 空手等既有纪律），不特判不清账 |
| 优先级 | 要约 key=`ch:<turn>:<round>:<skillId>`（确定性不占随机流，同 rw id 造法）；多候选顺序=选项记录序，AI 与人类看到的是同一张表 |
| 忠实度 | **内置零转正**（168 条无一 effectMode:'choice'→账本 40/129 一字不动=B9 逐字的结构性保证）；§G 五候选/遗计/好施等所需"选牌排序/选目标"候选构造器不在本刀生产者面=**接线≠可配第三次预防针**（观星系缺排序候选、遗计/好施缺选目标候选，各自需求首现时上表补行再动刀）；本刀闭环的是五要素：窗（pendingChoice）—合法候选（预译选项）—选择（CHOOSE_OPTION）—结果回写（延后事件正常结算链）—可复现日志（全 A 类进录像） |
| 三处同步 | 动作族：`ActionTypes` 联合+"CHOOSE_OPTION"、`resolvers/ChooseOptionResolver`+index+Registry、`ActionValidator` 冻结闸+形状闸、`legalActions` 冻结期枚举（选项序=枚举序=三档策略零改动吃进）、`battleRunner` 步首 actor 路由（pendingChoice 优先于 drawing）、`aiTurnDriver` 步首分支+`applyPolicyAction` case；状态族：`GameState.ts` PendingChoice 类型+可选槽、`gameStateAdapter` 重建保留（consumedSkills 同列）、`EventProcessor` 两 case；技能层：`dataTypes` choiceMode/SkillEffectData.description、`skillCompiler` 分组编译、`SkillTriggerBridge` 翻译闭包提取+choice 分支、`gameplayLog` 择定行；**编辑器/Excel 零改动**（"选择其一"下拉与解析列 v2.4 即在）、`generals.ts` 零新载荷、内置 168 条零改动 |
| 活例 | **无内置活例（非内容刀）**——合成装配三钉：EventProcessor 结算族（要约成账/撞账不覆写/择定清账+延后事件落账）、ChooseOptionResolver 五连门反例、transitionEquivalence 四路对账（真模板 choiceMode 触发→择定全链+同配置两跑逐字节）+ store 冻结世界例（非择定动作 CHOICE_PENDING、择定后放行）；真机=dev 受控种场面（pendingChoice 直接入 seed 态）点击 HUD 完成择定 |

### choice 生产者候选构造器首批两枚（v2.7.2 落地，GPT 三检 Q5"动手扩面前先打一发明示的最小验证刀、规模明显小于 v2.5.1"的兑现；**非内容刀：只接线、内置零转正、对 B9 逐字**）

| 格 | 契约 |
|---|---|
| Event | **零新事件、零新原语、零新触发**（原语恒 9、触发键恒 10、canonical 动作恒 13）。生产者的唯一产物仍是 v2.6.3 的标准 `CHOICE_REQUIRED{ choiceKey, chooserPlayerId, options:[{label, events}] }`——**`PendingChoiceOption` 形状一字未动**，故四个消费方（choiceEvents 过滤闸／legalActions 枚举／ChooseOptionResolver／HUD 按钮）全部零改动即承载新候选面，这就是"生产者能否合法产生标准 choice 请求"的正面答复 |
| 生产者面 | 新文件 `src/skills/choiceCandidates.ts` 两枚**纯候选枚举器**（只读 state、零写入、零随机、零副作用）：`enumerateTargetCandidates(state, ownerId, scope)`=场上将领候选（scope `ENEMY_FIELD`〔缺省〕/`ALL_FIELD`/`SELF_FIELD`；label=将领名、generalId=runtime card id；枚举序=players 序×fieldGenerals 序）与 `enumerateHandCardCandidates(state, playerId)`=欠债玩家手牌候选（label=卡名、cardKey=runtime card id；枚举序=手牌数组序） |
| 接线点 | 唯一接线点=`SkillTriggerBridge.createSkillEvents` 的 choiceMode 分支内按编译字段 `choiceSource` 分派：**缺省（undefined）=v2.6.3"逐效果预译分支"行为逐字不变**；`'TARGET'`=拿模板效果逐候选填 `targetId`、`'HAND_CARD'`=逐候选填 `cardKeys`。事件翻译**仍只走同一个 `translateEffect` 闭包**（新增第二个入参=候选填充，不另立第二份翻译=禁第二路径纪律）；生产者型定义刻意只取**恰好一张模板效果**（`effects.length !== 1` 时整套退回 v2.6.3 效果分支行为=不静默丢效果） |
| Timing | 与 v2.6.3 同：要约在本步成立、被选分支延到 CHOOSE_OPTION 那次 dispatch 才落账（候选在触发时点从 state 确定性构造，冻结世界闸保证永不陈旧） |
| Source | 欠债玩家恒=技能拥有者；TARGET 型候选域以拥有者为轴（ENEMY_FIELD 排除自己座位、SELF_FIELD 只取自己座位、ALL_FIELD 取全部存活座位）；HAND_CARD 型候选恒=**欠债人自己的手牌**（替别人选牌不在本刀面） |
| Target | 选择对象仍是记录内选项序号 `optionIndex`（枚举序=候选序=录像序）；本刀把上表 Target 行"未来 SELECT_PLAYER/CARD_ORDER 型候选面属后续生产者刀"**兑现为首批两枚**（选目标／选一张牌）；`SELECT_PLAYER`（选玩家）与"一次择定摘多张/排序"**仍不预铺** |
| Condition | 拒收五连门、撞账不覆写、gameOver 相位闸全部继承 v2.6.3 一字未改。**本刀新增的诚实闸在桥侧**：候选集为空（无符合 scope 的在场将领／欠债人手牌为空）⇒**根本不发要约**（零选项的 CHOICE_REQUIRED 会让冻结闸把世界永久锁死=死锁，宁可"触发发生但无候选可择"也不锁桌）；另 cardKeys 全不命中时结算侧仍是既有"诚实空转"（事件照记、状态不动） |
| Effect | 选中选项携带的事件**已含具体对象**（targetId 或 cardKeys）→走既有 EventProcessor 单入口，零新机制。手牌面新接线=DISCARD/GIVE/DECK_PLACE 事件载荷可选 `cardKeys?: string[]`，解析收在唯一小文件 `core/eventProcessors/handSelection.ts` 的 `selectHandCards(hand, count, cardKeys)`：**有 cardKeys**=按 runtime id 命中摘取（保持手牌内相对序、未知 id 忽略、命中的即为摘走的，`count` 此时不参与）；**无 cardKeys**=沿用"手牌头部切片、count=0 全手哨兵"**逐字不变**（所有既有载荷路径零行为变化=结构性保证） |
| RNG | 零新增随机面（枚举与择定皆确定性）；被延的效果若含抽牌，游标消费与 RANDOM_OUTCOME 记录仍在择定那一步（record-not-reroll 原样兜住） |
| Replay | 全 A 类照旧：候选表在触发步由枚举器确定性重演（非快照回填）、CHOOSE_OPTION 是 canonical 动作故 live 录像自动入账、ReplayPlayer 重派生自动重放，`outcomeOverrides` 零扩展；`cardKeys`/`targetId` 进事件载荷=录像事实（同进程 runtime id 稳定是既有 runtimeIdentity 纪律） |
| Transition | 唯一 `TransitionCore.transition`；枚举器与桥都只**产事件不写状态**，不构成第二转移路径 |
| Reentrancy | 零新环面：CHOICE_RESOLVED 仍不入 REACTION_EVENT_TYPES；被选分支的 DISCARD/GIVE/DAMAGE 按自身类型进既有重入环（含 cardKeys 载荷派生的 CARD_LOST 走单点 `enqueueDerivedConsequences`，"从已结算事实派生"纪律不因显式选牌而改变） |
| Death chain | 候选在触发时点定住，拥有者随后离场=上表既有"账不清、人照择"姿态；选中候选若已离场（目标将被本次连锁杀死）＝对应结算闸诚实空转，不特判不清账 |
| 优先级 | key 仍是 `ch:<turn>:<round>:<skillId>` 造法不变；候选顺序=枚举顺序，AI 与人类看同一张表（AI 侧 `aiTurnDriver`/`battleRunner` 走既有"选项序号"通道，本刀零改动即可吃进生产者候选） |
| 忠实度 | **内置零转正**：`generals.ts` 零 choiceSource 载荷、账本 **40 runtime 定义/129 诚实跳过一字不动**（=B9 逐字的结构性保证）。**接线≠可配第四次预防针**：`choiceSource`/`choiceTargetScope` **只存在于编译模型层**（`dataTypes.DataSkillDefinition`，唯一入口 `engine.registerPlayerSkills`），数据层 `Skill` 类型、SkillEditor、Excel v2 六列**均无录入面**——遗计/好施（选目标）与观星/心战/自书/秘置（选牌排序）各自需求首现时，须先补齐三处同步（generals 类型+编辑器下拉+Excel 列/解析）再回本表补行，转正仍走忠实度 A/B/C 门+四件验收，**严禁批量** |
| 三处同步 | 技能层：`dataTypes.DataSkillDefinition` +`choiceSource`/`choiceTargetScope`、新 `skills/choiceCandidates.ts`、`SkillTriggerBridge`（choice 分支分派+translateEffect 候选入参）；结算层：新 `core/eventProcessors/handSelection.ts`＋`applyDiscardEvent`/`applyGiveEvent`/`applyDeckPlaceEvent` 三处改调同一 helper；**状态层/动作层/校验层/UI 层零改动**（选项形状未变）；数据层与录入面零改动（见忠实度行） |
| 活例 | 无内置活例（非内容刀）。合成探针 `src/skills/choiceProducers.test.ts`：TARGET 型（候选枚举顺序与 label、开账恰一张要约、冻结/他人代择双拒、择定后**只有被选那一名**将领受伤且其 targetPlayerId 键定正确、空候选不发要约、`choiceSource`+多效果=退回逐效果分支）；HAND_CARD 型（手牌候选、择第 N 张真摘走第 N 张〔**非头部切片**=显式选牌实证，且其余手牌相对序不动〕、空手不发要约、GIVE/DECK_PLACE 载荷携 cardKeys 逐字）；确定性两跑逐字节；`cardKeys` 缺省时三路结算与旧行为逐字一致（回归钉）。真机=热座实况页用**真实枚举器**产生候选、canonical `restoreEngineState` 种账、真点 HUD 按钮择定→状态与录像逐字 |

### 自定义条件门槛谓词首批六枚（v2.7.3 落地，§G 建议书第 4 项"自定义条件原语"=档2 引用 4 条〔贞烈/峻刑/节命/放权门槛语义〕+伤逝差值的兑现；**非内容刀：只立词汇与求值、内置零转正、对 B9 逐字**）

| 格 | 契约 |
|---|---|
| Event | **零新事件、零新原语（恒 9）、零新触发键（恒 10）、零新 canonical 动作（恒 13）**。条件不是事件、也不是状态——它是"这条监听要不要响"的**纯谓词**，产物只有二值。既有身份面（`sourceGeneralId`/`damageTypeFilter`/`cardFilter`）一字未动，条件闸**叠在其后**（先身份、再门槛） |
| 词汇表 | 新编译模型类型 `SkillCondition{ metric, subject?, op, value?, compareTo? }`。**度量六枚，逐枚有需求出处**：`HAND_COUNT`（玩家手牌张数｜贞烈·节命"有牌可弃"代价门槛）、`GENERAL_HP`（在场将领 `currentHp`｜苦肉·据守类血线）、`ARMOR_POINTS`（将领 `currentArmor` 点数｜崩坏·装备系门槛）、`FIELD_GENERAL_COUNT`（该玩家在场将领数｜多座分发/门槛）、`DECK_COUNT`（全局牌堆剩余张数，无 subject｜观星·心战缺牌面）、`EVENT_VALUE`（**触发事件已记录的数值** `data.value ?? data.count ?? 0`，无 subject｜伤逝"失牌差值"、峻刑"拼弃"的事件侧）。**算子五枚** `LT/LTE/EQ/GTE/GT`；右端=常量 `value` **或** `compareTo`（另一枚度量事实，"比多少"语义即此）。数组语义=**AND 全成立** |
| 生产者面 | 唯一入口=`engine.registerPlayerSkills`（编译模型层字段 `DataSkillDefinition.conditions?`）；`skillCompiler` **不产 conditions**（数据层 `Skill`/`SkillTriggerConfig` 无对应录入形态）——与 v2.7.2 `choiceSource` 同一姿态 |
| 接线点 | **两处消费同一份纯求值函数**（`src/skills/skillConditions.ts::evaluateSkillConditions`，全库唯此一份实现）：① 触发路=`SkillTriggerBridge` 的 `buildCondition` 末尾 AND 上条件闸（十个触发键全域生效，含 choice 要约开账前=门槛不过连要约都不发，与 v2.7.2"空候选不发要约"同族死锁预防）；② 决策路=`skills/turnEndSkills.listTurnEndSkillCandidates` 过滤候选（⇒询问窗 HUD、`legalActions` 枚举、AI 司机三消费者同口径）+ `TurnEndSkillResolver` 独立再求值一次并给出诚实拒因 `SKILL_CONDITION_UNMET`（纵深防御=候选面与结算面同一函数、不同调用，绝不允许"枚举里有、结算时静默空转"） |
| Timing | 求值时点=**触发/发动那一刻的 state 现态**（与 v2.6.2 cardFilter"只读已记录事实、零二次推导"同纪律；条件读的是 `hand/currentHp/currentArmor/deck` 这些 A 类事实，不读呈现字段=B 类面零接触，见 C-4）。**结算时不复核**——门槛过后效果事实不足仍走各原语既有诚实空转（GIVE 死接收/DISCARD 空手等），两层各司其职不互替 |
| Source | 主体轴三枚：`SELF`（缺省=技能拥有者座；将领类度量取其 `sourceGeneralId` 对应在场将）、`TARGET`（从触发事件解析：先以 `targetId ?? target ?? victimId` 在场反查将领与其所属座，查不到再退显式 `targetPlayerId` 只认座）、`ATTACKER`（镜像 `resolveEffectTarget` 的取值序 `sourceGeneralId ?? attackerId ?? action.payload.attackerId ?? action.attackerId`，查不到退 `sourcePlayerId ?? action.playerId`）。**无事件时 `TARGET`/`ATTACKER` 与 `EVENT_VALUE` 一律解析失败=fail-closed 不响**（读不到≠读到 0；`isAlive===false` 只出局 choice 候选枚举，不影响度量读取）。`DECK_COUNT/EVENT_VALUE` 无主体（全局/事件事实） |
| Target | 条件**不选目标**，只判门槛——它不产出任何对象引用，故与 choice 生产者面（v2.7.2 候选构造器）正交：先过门槛，再谈候选。"以某名为目标需满足 X"类语义=choice 候选枚举 + 条件谓词两把钥匙的组合，非第三把 |
| Condition | **失败即闭（fail-closed）**：任一谓词解析不出事实（主体座不在、将领已离场、`compareTo` 另一端不可解析、算子/度量未知）⇒**整条条件不成立=技能不触发**，宁可不响也不误响（与"不发明玩法"同向：误响=凭空多一次结算）。解析成功但比较不满足=同样不成立。合法边界值如实成立（`HAND_COUNT GTE 0` 恒真）；`value` 与 `compareTo` 同时给=以 `compareTo` 为准（确定性优先，不作 AND 复合）。**缺省（undefined 或空数组）⇒ 行为与上表之前逐字不变** |
| Effect | 条件不产出事件、不写状态、不改载荷——它只决定"这一组事件要不要产出"。故九原语结算面零改动，`EventProcessor`/`TransitionCore` 零接触 |
| RNG | 零新增随机面（谓词是 state/event 的纯函数）；被门槛挡下的技能**不消耗游标**⇒同 seed 下"挡/不挡"完全可复现；门槛过后的抽牌照旧在结算步消费游标 |
| Replay | **条件本身不进录像、不入 EngineState**——三路（常驻/每步重建/录像重放）看到的是同一份 state 与同一份事件，纯函数必得同一结论；`SKILL_ACTIVATED→（条件不成立）→ACTION_REJECTED` 的**结论**进录像（决策路），触发路的"不响"=零事件=天然可复现。四路对账测试钉死（含"重建路不得比常驻路多响一次"反例） |
| Transition | 唯一 `TransitionCore.transition`；条件闸位于监听筛选环节（TriggerEngine 的 `condition`），**产不出事件更写不了状态**⇒禁第二转移路径自查通过 |
| Reentrancy | 零新环面：条件只减少事件产出，不新增派生、不新增集合闸；重入环内每个二次事件仍各自过一遍条件（同 state 快照⇒同结论，无振荡风险，因条件不写 state） |
| Death chain | 拥有者或主体离场⇒度量解析失败=**闭**（不响），与既有"账不清、人照择"事后姿态不冲突（那是已开账的欠账，这是未开账的门槛）；条件绝不在致死链中途改判（求值只用触发时点现态） |
| 优先级 | 无新优先级：条件在既有 `PRIORITY`/`TRIGGER_EVENT_MAP` 之后、`createEvents` 之前生效；多谓词数组序=书写序，短路即返回（不影响结论，仅影响求值次数） |
| 忠实度 | **内置零转正**：`generals.ts` 零 `conditions` 载荷、账本 **40 runtime 定义/129 诚实跳过一字不动**、battleReport 39 行不变（=B9 逐字的结构性保证）。**接线≠可配第五次预防针**：条件只活在编译模型层，数据层 `Skill` 类型/SkillEditor/Excel 六列**均无录入面**——〔**v2.8.3 更正：此断言已过时，本刀当时成立、现由「发动门槛录入面」一节取代**（数据层 `SkillEffect.conditions`、每效果一张 `GateEditor` 卡片、Excel 第 7 列「门槛」三处已齐；编译器透传、`skillConditions.ts` 与三处消费一字未动。本表的其余十一轴与"真机自动开闸"当时的取证方式仍是事实，只是**不再不可达**：`skillPipeline.test.ts` 已用零 mock 真引擎跑通门槛文本→结构化→两次攻击的差异行为，`vi.mock` 编译缝不再是唯一取证路径）〕贞烈/节命/峻刑的转正须先按 §G 建议书第 1 项"积木语法表"把条件槽位定进语法（v2.7.4 纸面表，**已随 v2.8.3 销账**），再补三处同步，转正仍走忠实度 A/B/C 门+四件验收，**严禁批量**。伤逝类"差值"语义本刀兑现为 `EVENT_VALUE` 比较（事件已记录张数），**逐张拆分/每差 1 张摸 1 张**仍属效果族缺口（见 CARD_* 事件源表 Condition 行既有注记），不借本刀偷做 |
| 三处同步 | 技能层：`dataTypes` +`SkillCondition`/`SkillConditionMetric`/`SkillConditionOperator`/`SkillConditionSubject` 四型与 `DataSkillDefinition.conditions?`、新 `skills/skillConditions.ts`（唯一实现）、`SkillTriggerBridge`（`buildCondition` 拆成身份内函数+条件外闸）、`skills/turnEndSkills`（候选过滤）、`action/resolvers/TurnEndSkillResolver`（独立求值+新拒因）；**结算层/状态层/动作层/校验层/UI 层零改动**（无新事件、无新状态槽、无新动作）；数据层与录入面零改动（见忠实度行） |
| 活例 | 无内置活例（非内容刀）。合成探针 `src/skills/skillConditions.test.ts`：六度量逐枚真值/边界/失败闭、`compareTo` 比较、AND 数组、算子五枚全谱、未知度量与缺字段=闭；触发路=真实 GameEngine（非 mock）下"手牌为空时贞烈型门槛不响、有一张才响"、"门槛不过连 choice 要约都不发"；决策路=`listTurnEndSkillCandidates` 过滤 + resolver 拒因 `SKILL_CONDITION_UNMET` + `legalActions` 同步不见候选；四路对账（常驻/重建/重放/isLegal 探针）同结论；`conditions` 缺省回归钉=旧行为逐字 |



### 装备损失语义裁决（v2.7.4 收官刀，§G 2.7 建议书第 7 项销账；**零代码裁决 + 一枚负例钉**；GPT 三检 Q3 挂账的正式落点）

**问题**：枭姬原文"失去一张装备牌后摸两张"泛指一切装备失去，而引擎里装备离场不止一条路。挂账问=承伤销毁/阵亡随葬这两路算不算"失去牌"、要不要派生 `CARD_LOST`。

**三路清单（按代码事实，非推测）**：

| 路 | 结算点 | 是否派生 CARD_LOST | 判据 |
|---|---|---|---|
| 被拆（技能效果） | `EQUIP_STRIP` → `applyEquipStripEvent` 从 `armorCards` 头部摘 `count` 张 | **派生 `via='EQUIP'`**（v2.6.2 起） | 唯一"技能把装备拿走"的语义主体；枭姬唯一活例 |
| 被伤害吸收销毁 | `AttackResolver` 预计算 `destroyedArmorCardIds`（2 甲吞 1 伤的既有规则）→ `damageEvents` 摘除并进弃牌堆 | **不派生** | **裁决=维持沉默** |
| 随主阵阵亡 | `damageEvents` 的 defeated 分支 `survivorArmor` 清空、将领进 graveyard | **不派生** | **裁决=维持沉默** |

**裁决三条理由**：① **需求驱动**——无内置技能以"装备因承伤/随葬而失"为触发钥匙，枭姬原文的泛指面已在 v2.6.2 忠实度格里如实定级 **B**（缺口是披露项、不是隐藏债）；扩面=改真实触发面⇒属内容刀，须需求首现、上表补行、四件验收。② **锚定纪律**——派生源扩面必然改技能响应分布⇒胜负基线要换锚（B9→B10），非内容刀不得动源（v2.6.2"扩源即内容刀"是先例）。③ **派生单点与代价不对称**——`CARD_*` 派生只允许发生在 `chainedConsequences.enqueueDerivedConsequences`；承伤销毁与阵亡随葬的装备离场发生在 `damageEvents` 结算内部且与 DEATH 链耦合，随葬一路还需新增"before 快照差值"读事实面（将领已从 state 摘除），风险收益不对称。与三检 Q3 同口径：**不永久搁置、也不预排强制修复**。

**判据的正写法（采纳 GPT 2.7 四检 Q3，v2.7.4 回填；改措辞不改行为）**：本裁决的判据**不是**"只有技能拆装备才算失去"，而是——**事件描述的是"canonical machinery 是否需要知道这个因果事实"，不是"物理上是否发生了消失"**。故此处 `CARD_LOST` 读作「装备被一个具有"使其失去/拆除"语义的效果主动移除」，**不得**泛化成"一切装备离场"；上表两条"维持沉默"的理由由此从"经验取舍"升为"判据推论"。实操后果：将来若有人以"装备从场上消失就该发事件"的完整性直觉重开第二、三路，本节即反驳点——§G 2.8 候选第 7 项的翻转条件必须是**新语义需求首现**，而非**对称性审美**。四检同时建议扩面时 `via` 值名自带因果来源（施工图里的 `DAMAGE_ABSORBED`/`DEFEAT` 已按此命名，勿再用中性感知的 `LOST` 一类词），以免 `CARD_LOST` 承担泛化"卡牌消失"。

**连带结论（词表与编译产物的有意落差）**：编辑器/数据层 `cardSubType:'equipmentLost'` 是三路总称，编译产物 `cardFilter:'equipment'` 现读 `via==='EQUIP'` ⇒ 收窄是**有意的**（=B 级忠实的来源），不是 bug。任何扩面必须先改本节 + §F「CARD_* 事件源扩面」闭面清单（AGENTS 红线：改表先于改码）。

**施工图（未来扩面照抄，本刀不实施）**：① `via` 值池 `'EQUIP'` → `'EQUIP'|'DAMAGE_ABSORBED'|'DEFEAT'`；② `cardFilter==='equipment'` 由等值判定改集合判定；③ 派生仍在单点（承伤路读 `DAMAGE.data.destroyedArmorCardIds` 长度=零新读事实面，成本最低；随葬路需 before 快照=新读面，另议）；④ 重入评估——承伤路派生会把 CARD_LOST 挂到伤害链上（与"断肠弃光→连营摸 1"同环），三道既有上限闸复用；⑤ 按内容刀流程换基线锚并跑策略档两档复测。

**防漂移钉**：`src/core/transitionEquivalence.test.ts` 新例「裁决负例」（两路各一：零 `CARD_LOST/CARD_GAINED` 且同座在场枭姬不响）＋既有正例（EQUIP 源恰一条、不带 `remainingHand`）⇒ 三路行为全部钉死，改动者一跑即见。

### 积木自由拼接语法表（v2.7.4 纸面刀，§G 2.7 建议书第 8 项=承接池①第一步；**零代码、零录入面改动，UI 待本表评审后再立**）

一句技能=以下槽位的一次乘积。逐槽给出"编译模型字段 ↔ 录入面 ↔ 运行时消费点 ↔ 缺口"，缺口列即 2.8 候选的事实底座。

| # | 槽位 | 编译模型（`skills/dataTypes.ts`） | 录入面（数据层 `Skill` / 编辑器 / Excel v2） | 运行时消费点 | 纸面缺口 |
|---|---|---|---|---|---|
| 1 | 时机 | `trigger: DataSkillTrigger`（**10 枚**） | `trigger.type`（数据层词表 **22 枚**）/ `skillEditor/TriggerEditor.tsx` / "触发"列 | `SUPPORTED_TRIGGER_MAP` → `TRIGGER_EVENT_MAP` 三表同步 | 12 枚触发词无承载事件=按需池（不预铺） |
| 2 | 细分 | **只折成三枚筛字段**：`damageTypeFilter`（attack/skill）、`turnSubType`（只带 selfTurn 候选窗）、`cardFilter`（equipment/lastHand/hand）。`deploySubType` **从不进编译模型**——它只存在于录入面（`generals.ts:62` 字段、`TriggerEditor.tsx:46` 下拉、`skillExcelFormat.ts:56,98` 串往返），录了也不改变编译结果；`killSubType:'killAlly'` 与 `turnSubType:'otherTurn'` 在编译期即以 `TRIGGER_SUBTYPE_UNSUPPORTED` 诚实跳过（`skillCompiler.ts:174-190`） | `SkillTriggerConfig` 五类子选项 / "触发"列 `:` 后缀 | `SkillTriggerBridge.buildCondition` 各分支 | `expireCondition`（untilExpire）无运行时承接 |
| 3 | 门槛 | `conditions?: SkillCondition[]`（6 度量 × 5 算子 × 3 主体，AND 数组，fail-closed） | **已闭环（v2.8.3 刀 B）**：数据层 `SkillEffect.conditions`（本体在 `data/generals.ts`）/ `skillEditor/GateEditor.tsx` 每效果一框 / Excel 效果组第 7 列「门槛」（大白话文本，`skillGateText.ts` 互译、读不懂逐条上报）；编译器逐效果**纯透传** | `skills/skillConditions.ts` 单点，三消费者（触发路桥 + 决策路候选/求解器）；**语法与失败语义见本节下方「发动门槛录入面」** | 语义仍仅 AND、**无 OR/嵌套**；**"选择其一"的门槛整组拒编译**（`CONDITION_CHOICE_UNSUPPORTED`，用户本轮明确无需求）；单效果模式无效果可挂⇒自然无门槛 |
| 4 | 主体 | `sourceGeneralId?` + 条件 `subject` + Effect `target` | 运行时"目标"三选下拉 | 桥内身份闸 + `resolveSubject` | 无"按势力/按座位筛选"的第三主体轴 → **2.8 候选第 2 项** |
| 5 | 选择 | `choiceMode?/choiceSource?/choiceTargetScope?` | `effectMode:'choice'`（数据层可录）；`choiceSource` **无录入面** | `CHOICE_REQUIRED` → canonical `CHOOSE_OPTION`（冻结世界闸） | 候选域仅场上将领/手牌两型；牌堆顶、自身装备无候选源 → **2.8 候选第 2 项** |
| 6 | 效果原语 | `effects[].type`（**9 枚**） | `RuntimeEditor.tsx` 类型下拉（与 `SETTLEABLE_RUNTIME_TYPES` 同源） | `createSkillEvents` → EventProcessor 唯一结算 | 无"代价/消耗"型原语、无"若未达成则…"型分支效果 |
| 7 | 效果参数 | `value?/dest?/description?` | "数值"列 / "目标"列 / "描述"列；**DECK_PLACE 的 dest 无 Excel 列** | 各原语 payload 读法 | 参数面与 Excel 表宽不一致（已挂 §12-34⑤） |
| 8 | 次数/冷却 | **无此槽** | 无 | 无 | 每局限一次/觉醒=2.7 建议书第 5 项 → **2.8 候选第 3 项**（深水区首因：须新增 canonical 事实才可复现，非 UI 工程） |
| 9 | 组合形态 | 同触发签名分组：`effectMode:'all'`=逐效果独立定义、`'choice'`=一张多效果定义 | `Skill.effects[]` + `effectMode` | `singleDefinition()` / choice 分组分支 | effects 数组=**平坦**，无"先 A 后 B"顺序依赖与链式结构 → **2.8 候选第 4 项**（承接池①第二步，先立十二格表） |

**读法约束（采纳 GPT 2.7 四检 Q2，v2.7.4 回填；本表结构零改动）**：语法槽 ≠ 实现原语——两层要**分层看**：本表回答"一句技能描述由哪些独立语义维度组成、哪些已有能力承接、哪里是真缺口"，它**不是**"每加一槽就加一套 runtime machinery"的许可证。具体到"代价/消耗"：**语法上独立成槽，实现上不要求独立 Effect 原语**（现阶段代价仍走 Effect 参数）。理由是代价与普通效果的语义类别不同——效果=技能成功后世界怎么变，代价=为了发动/择定这个动作先付出什么，它牵动可发动性、choice 合法性、结算顺序、失败处理与事件链，至少要回答"何时支付、支付失败怎么办、choice 前还是 choice 后、支付是否产生事件、支付后技能还能否被取消"。故若将来把它藏进 Effect 参数落地，**本表仍须显式标出 cost 的位置与结算时序**（或把"效果原语+参数+代价"合为一复合槽但内部三栏分明）——四检判语：完全隐藏会让"语法上没有这个词"的缺口以另一种形态复发。本表最大价值=先语法后 UI 的**中间契约**，不是 UI 规格书。

**语法结论（纸面判定，不动代码）**：现形态=「时机 ×细分 ×(AND 门槛)× 主体 ×〔可选择一〕效果〔参数〕」的**单层乘积**，九槽中七槽已闭合、两槽（次数/链式）为结构性空缺。自由拼接要成立，按代价从小到大排：① 门槛录入面（**✅ v2.8.3 刀 B 已闭环**：数据层字段 + 编译器透传 + 编辑器卡片 + Excel 第七列四处全落地，见本节「发动门槛录入面」；下列文字是该刀**开工前**的取证与估工依据，保留不删以留判断轨迹。旧写法：引擎侧 v2.7.3 已就绪，但**数据层承托缺失**：必动四处=数据层字段 + 编译器映射 + 编辑器 UI + Excel 形态。**2.8.1 审计纠正**：原此处写"纯 UI/Excel 工程"系高估，实测 `conditions` 只活在编译模型 `src/skills/dataTypes.ts:116`，`src/data/generals.ts:169 interface Skill` 无该字段、`src/skills/skillCompiler.ts` 全文零 `conditions` 字样）→ ② 候选域扩面（第 5 槽加值池，仍属能力层）→ ③ 次数/冷却槽（新事实面：需入 EngineState 才可复现，改的是状态契约不是编译器）→ ④ 链式"若/则"结构（要改编译形态与分组语义=**最大一处，必须先立十二格表再动**——**表已于 v2.8.1 立妥，见 §F「链式"若/则"组合契约表」**）。①②彼此独立可并行；③④各自成刀。用户拍板纪律=**先语法后 UI**，本表即语法。

### 身份锁契约表（2.8 首刀 v2.8.0，将领「身份锁」需求定稿 2026-09-27；**内容刀：AI 直建池同步上锁 ⇒ 基线 B9→B10**；纸面契约先行，本表即施工与评审判据）

**需求白话版（十条规矩）**：①每个将领有一个"身份"（如「关羽」），同名将领共享同一身份；身份×势力=一类具体将。②官方将不逐一手填——身份缺省就是自己的名字。③身份是一份**可维护注册表**（开发者模式可新建/编辑/删除），将领编辑时**从注册表选用**、非自由文本。④**分发即锁**：候选发到某座手上即归该座，即使没被征召也永久排他（**未征召即沉没**，明面规则非 bug）。⑤同一座的候选面内部也按身份去重（两枚群关羽不得同面出现）。⑥群同名全局唯一；主势力同名 ↔ 群同名双向互斥；不同玩家分持不同势力同名**允许**。⑦锁与存活无关：征召后池冻结，阵亡/弃置/回池不释放。⑧`'DIY'` 身份与留空身份**互斥豁免**。⑨违规不报错——DIY 豁免消解大部分冲突面；录入面撞键=拒+显式提示；旧档已存冲突=只提示不改写；装配期新冲突=**拒整批带明确原因、绝不静默过滤**（ARCH_MAP:723 原裁决兑现）。⑩标准模式 AI 一律遵循锁（含 `ai/matchSetup` 直建池）；开发者演练窗提供旁路开关组。

| # | 契约格 | 裁决 |
|---|---|---|
| 1 | 身份来源 | `General.identity?: string`（存注册表 key）；解析纯函数 **`identityOf(g) = trim(g.identity) 非空 ? trim : (g.identity===''? 无身份 : g.name)`**——官方 95 将零数据文件改动即自动带名身份；`'DIY'`=保留豁免值；注册表本体住编辑器持久化层（localStorage 新键），**不写进 `generals.ts`**（官方派生身份自卡池 name 自动存在、不可删） |
| 2 | 维度模型 | 锁键 = `(identityKey, faction)` 对；一身份可被多势力模板共享引用；「群」判定读 `general.faction==='群'`（与征召屏分组同一真值源） |
| 3 | 锁的时机 | **分发即锁**：锁集 = 已分发归属集（含该座未征召的沉没候选）∪ 本座候选内部去重；`buildDraftCandidates` 第 3 参由"前座已确认 id"升级为"已分发锁键集" |
| 4 | 生命周期 | **整局不可逆**；rematch/新建房随房间重建清空；对局内任何离场不释放 |
| 5 | 作用域 | 单间房跨座；**两条装配路同锁**——store 征召链（热座/人机）+ `ai/matchSetup` 直建池（CLI/演练窗）⇒ 本刀=内容刀（B10） |
| 6 | 互斥方向 | 非群X↔群X 双向；群X 全局唯一；非群↔非群跨座因主势力过滤天然不相遇、不实现（现实可达形态与需求原文逐条对应） |
| 7 | 豁免与 DIY | `identityOf==='DIY'` 不产生锁键；"官方 vs DIY"可区分根据=身份解析缺省链（编辑改名将/新建产物走 DIY 回退），为后续"非开发者受限编辑器（只碰 DIY 将）"预留校验面（已知后续需求，本刀不做） |
| 8 | 留空语义 | 显式 `''`=无身份=不锁（仅开发者显式清空可得）；`undefined` 字段=回退 name |
| 9 | 与存活/旧档 | 派生自分发归属非场面存活⇒⑦结构性成立；旧档恢复既存同名共存=**面板显式提示、零改写**；装配期新冲突=**拒整批+原因**；锁态是 B 类推导呈现态——**不进 EngineState、不进录像、schema 不 bump**，存档恢复由 `players[].generalPool` 纯函数重建永不漂移 |
| 10 | rngState | 锁判定本身**零随机消耗**（`identityOf`/锁键推导=纯函数，签名不含 random）；过滤置于 shuffle 之前（两路既有形态），被锁移除使池子变小⇒该次 shuffle 消耗数变化（Fisher-Yates=size−1）——这是**沉没/互斥规则内容变化的预期表现**，非隐藏的第二随机路径；施工纪律=消耗公式不变、不加任何额外 rng 调用点；store 征召路 rng 漂移不入录像事件流（征召住 store 层，录像 initialState 承接其结果）。（勘误披露：本表初稿曾写"游标逐字不漂"，系把"count 与 size 无关"误推到"过滤不改 size"，v2.8.0 定稿前修正） |
| 11 | 违规表现 | 分发期"拿不到"=规则本体非违规；防线住录入面（编辑器撞键/删被引用身份=拒+提示，**不自动改身份**）与装配面（格 9）；征召屏沿用群上限"置灰+⚠文案"既有 UI 模式（GeneralDraft） |
| 12 | 持久化/Excel | `GeneralEdit` + `identity?`，旧 localStorage 零迁移向后兼容（缺字段→`identityOf` 回退链自动满足"官方回退 name、DIY 回退 'DIY'"语义）；**Excel v2 六列不加第七列**（破坏既有模板与严格列序钉）——identity 的 Excel 承载另立"将领属性子表/sheet"需求；导入器两处 name 匹配近亲（`skillExcelParsers.ts:100-103`、`gameStoreEditorActions.ts:91`）登记挂账不随刀改 |

**演练窗旁路矩阵（默认全部=遵循身份锁；开关只活演练窗局部配置，不进 canonical EngineState、不进录像、不影响正式建房链）**：

| 开关 | 旁路规则（=实装 `IdentityLockBypass` 字段，演练窗面板五复选框+白名单输入） | 默认 |
|---|---|---|
| `off` 关闭身份锁 | 本刀全部（回旧行为：仅模板 id 去重+AI 池 duplicates kept） | 关 |
| `allowSameFactionSeatSharing` 允许同势力座位共享 | 势力互斥分配（多座可同主势力、同势力候选可同发多座） | 关 |
| `allowSameIdentitySameFactionMultiCopy` 允许同身份同势力多份 | (identity,faction) 全局唯一 + 座内同键去重 | 关 |
| `allowExplicitGeneralsIgnoreLock` 自选将领不受锁 | explicit 撞锁拒整批（seeded 随机池仍锁，除非另关对应档） | 关 |
| `lockIdentityGloballyAcrossFactions` 全局同身份互斥（**加强档**） | 跨势力跨座位同身份也互斥——压力测试用，非放松 | 关 |
| `identityWhitelist` 身份白名单 | 指定身份按 DIY 处理（复现历史冲突用）`lockwl=关羽,曹操` | 空 |
| 候选张数 | 复用既有 `poolPerPlayer`（高级设置「每人将池」），未新建覆盖字段 | 8 |

> 勘误（实施对定稿矩阵的两处修正，以代码为准）：① 定稿行「允许同身份跨势力共存」在 matchSetup 上下文**默认即成立**（跨座跨势力同名合法=需求 3），无放松空间⇒实装改立为其**反向加强档** `lockIdentityGloballyAcrossFactions`（全局同身份互斥压力档），面板文案不误导；② 定稿行「候选张数覆盖=10+5 硬编码收编」实装判定无需新字段——每座候选张数已由 `poolPerPlayer` 承载，10/5 为面上切分上限非独立旋钮。

**空转如实登记（不得拿规则覆盖度冒充已验证）**：官方 95 将**零对同势力同名**（同名仅 4 对且全跨势力：司马懿/张春华/邓艾/钟会 魏↔晋）⇒"同势力同名唯一"对现有官方内容**可证但当前无实例**（校验与测试仍实现并加钉）；且主势力过滤使蜀座本就分发不到魏关羽，规则真正生效面=**跨势力同名互斥 + 群同名全局唯一** + 造将/编辑填身份后的 DIY 面。正例测试以注入 identity 的合成池驱动。

**B10 换锚声明（读数已实测回填）**：本刀为 2.x 线首个玩法分发规则改动且 AI 直建池同步上锁（同模板多份消失=装配内容变化），**基线必换 B9→B10**；B9 `{"1":117,"2":183}` 全部读数保留于 §12-33①/35 作历史锚。B10 实测（定稿树 `npm run ai-battle -- --games 300 --seed 1` 两轮逐字一致，2026-09-27）：胜席 **`{"1":112,"2":188}`**，won=300、exhausted=0、VIOLATIONS=0；逐势力小账（出场席/胜/胜率 · 登场/阵亡/死亡率 · 攻击/击杀/击杀率）=**魏** 116/56/48.3% · 193/138/71.5% · 13/1/7.7%；**蜀** 136/71/52.2% · 205/132/64.4% · 14/2/14.3%；**吴** 126/55/43.7% · 160/115/71.9% · 4/0/0%；**群** 126/70/55.6% · 206/116/56.3% · 16/1/6.3%；**晋** 96/48/50.0% · 134/95/70.9% · 4/0/0%。**换锚因果如实读**：出场席分布与 B9 逐字同（116/136/126/126/96=官方池零同势力同名⇒抽席面空转，见上格），胜席 117/183→112/188 的漂移来自 seeded 池构造代码路径变化（filter 增锁判定+去重 filter 迭代）引起的 shuffle RNG 游标位移，**非玩法规则生效的实质信号**——这正是「同势力同名唯一对现有内容空转」的数值侧印证。v2.8.0 起非内容刀对 **B10 逐字**。禁止为保 B9 回退 AI 池锁。

### 编译诚实契约（同刀落地，D-9 C 类）

`syncPlayerSkills` 的 skipped 项（TRIGGER_UNSUPPORTED / NO_RUNTIME_PAYLOAD 等，含 reason）经 `getCompileDiagnostics(engine)`（WeakMap，引擎重建自然隔离）带外上报；console.warn 按 **distinct 条目**（`技能名#效果id:原因`）去重、测试缝 `__resetCompileWarnDedup()`。事件流与游戏行为零变化。编辑器/Excel 录入未支撑类型时消费该通道做 UI 提示=后续需求（非缺陷，已登记 HANDOFF §12-18）。

### 链式"若/则"组合契约表（2.8 候选第 4 项=§F 九槽表第 9 槽；v2.8.1 纸面刀；**零实现、零录入面、零内置实例 ⇒ 表内无一句当前可被触发验证**）

一句大白话：**现在的技能是"同时做几件事"或"几件事里挑一件"，还不会"先看刚才成没成，再决定做不做下一件"。** 本表就是给后者预先立规矩，施工与评审都以它为判据；**本刀不动 `skillCompiler.ts` 一个字符**。

| # | 契约格 | 裁决 |
|---|---|---|
| 1 | Event | 链**不新增事件类型**。每一步仍产出各原语既有 canonical 事件（DAMAGE/GIVE/DISCARD/…），链=编译期的**分组形态**，运行时看到的仍是一串既有事件；不引入 `CHAIN_STEP`/`CHAIN_BRANCH` 之类新事件名（若将来判定必须引入⇒先回本表补格并说明四路径对账为何不受影响） |
| 2 | Timing | 判定发生在"上一步的结算事件已进事件流、下一步尚未创建"的空隙，即既有 `collected` 追加收集 + 有界重入（轮 8/深度 32/链上 256）**之内**；不新增时机点、不入 EventBus。**禁读半完成状态**（判定只能在上一步事件已定稿之后） |
| 3 | Source | 链只活在**同一条技能定义内部**（同触发签名的 effects 序列），绝不跨技能/跨将/跨玩家串联——跨技能因果已由既有"派生事件→再触发"承担。**链不是第二套因果通道** |
| 4 | Target | 链不改目标选取：每步各走既有 target 解析（含 choice）。**不允许第 2 步隐式继承第 1 步已择目标**（要沿用必须由该步语义或录入面显式表达，禁隐式默认=第二语义源） |
| 5 | Trigger | 链不是触发词，不占 22 数据层词表 / 10 编译触发键。钉死：将来实现必为**新 `effectMode` 值**或**效果条目上的显式 step/link 字段**（二选一），**严禁用 `effects` 数组的自然顺序隐式表达链** |
| 6 | Condition | **与第 3 槽门槛的分工（本表最易混处）**：`conditions`=**开火前**门槛（不过则连 choice 要约都不发、技能不响，v2.7.3 已钉）；链的"若"=**结算之后**用已记录事实做的二判。**判别句：这句话在技能响之前就能判定吗？能→条件槽；不能（要等前面效果结算出事实）→链。** 不得把门槛写成链第一步（会凭空产生"已响应但空转"的事件），也不得把链塞进 `conditions`（条件读不到尚未发生的事实，只会得到 fail-closed 的假阴性） |
| 7 | Effect | 链的每一步=既有 **9 原语**之一的实例，本表不新增原语；步与步之间只允许"顺序 + 分支"两种关系，不含新算术（"伤害翻倍"一类仍属第 7 槽参数面） |
| 8 | RNG | 判定必须是**纯函数**（只读已记录事件 `data` 与 A 类状态，v2.6.2 同纪律），链本身零随机调用。诚实钉：分支一旦生效会改变"后续某原语是否执行"，而 `DRAW_CARD` 一类会消费游标 ⇒ **分支改变随机流游标属于玩法语义本身，不是隐藏的第二随机路径**（与 §F 身份锁表格 10 同源同读法，不得被写成"游标不漂"） |
| 9 | Replay | 关键钉：**录像只回放事件、不回放判定过程 ⇒ 判定用到的每一件事实必须已在录像事件流里**。若某分支要读的事实不在事件流⇒必须先把那件事实补成 canonical 事件（另立表），否则录像重建必漂。四路径（常驻/重建/重放/`isLegal` 探针）同结论=实施刀的硬验收线，缺一不绿 |
| 10 | Transition | 状态转移仍唯一走 canonical 链（TransitionCore/EventProcessor 单入口）。链决定"生成哪些事件"，**绝不自己 `set` 状态** ⇒ 不破"禁第二状态转移路径"红线 |
| 11 | Reentrancy | 链上每步事件照记 ⇒ 全部计入既有三道闸（轮 8/深度 32/链上 256），触顶仍走 `TRIGGER_REENTRY_LIMIT` 哨兵。"分支"不得成为绕过重入闸的新事件源 |
| 12 | Death chain | 拥有者或某步主体在链中途离场⇒该步按既有原语"诚实空转"处理，并且**空转在该步被声明为前置条件时即判为失败**（见格 13）；链绝不在致死链中途改判（判定只用已定稿事件事实） |
| 附1 | 失败语义 | **裁决=前一步未产生任何状态位移（GIVE 死接收／DISCARD 空手／EQUIP_STRIP 空装备区等既有诚实空转）时，后续步默认继续**，除非该步在录入面显式声明"以前一步成功为条件"。理由三条：① 与既有语义族一致——今天 `effects` 数组就是逐条独立结算、空转不中断，改成默认中断等于**悄悄重写全部 168 条内置技能的读法**=第二语义源；② "空转也记录"纪律（v2.6.1 REVEAL 表）已确立"没有位移≠没有发生"；③ 默认继续对 AI 司机与 `legalActions` 可预测，默认中断则须新增哨兵事件（=新 canonical 事实，代价另计）。**代价如实登记**：因此"若造成伤害则再摸一张"这类句子必须靠**显式标志**表达，标志的名字与取值=实施刀开工前回本表补第二张表，不得在编译器里临时发明 |
| 附2 | 链内 choice | **禁令：pendingChoice 多槽改造（§G 建议书第 5 项）落地前，禁止链的第 2 步及以后开 choice 要约。** 理由不是"实现麻烦"：单槽 pendingChoice 无法在同一次触发里表达两张要约的**先后**，事件流里第二张的位置在回放期不可复现=制造一台"同一份录像两种走法"的机器。解禁那刀必须**先改第 5 项与本格两处**再动编译器 |
| 附3 | 活例 | **零内置活例、零录入面、零编译器支持。** 本表当前唯一可核对的既有事实=`effects` 数组为平坦顺序（`skillCompiler` 的 `singleDefinition()` / `effectMode` 分支）。⇒ 本表**不得被任何后续会话读作"链式语义已具备"**；它的性质与 v2.7.4 九槽表同类＝纸面契约，与"规则已实现"无关 |

**换锚预告（写给实施刀，不许事后改口）**：链一旦进编译形态，同一条技能定义会编出不同的运行时结构 ⇒ **凡给任何内置技能挂链的刀必为内容刀、必换锚（B10→B11）**；只立编译器分支 + 录入面、内置**零挂链**的能力刀可维持对 B10 逐字（与 v2.5/v2.6/v2.7 五轮"只接线不带内容"同形态）。**禁止**为了"锚不变"而把链硬塞进既有 `effectMode:'all'` 的语义里。

### 发动门槛录入面（v2.8.3 刀 B，§G 2.8 建议书第 1 项销账；**非内容刀：硬锚=对 B10 逐字一致；但门槛=玩法语义 ⇒ 三道闸第①③闸本刀全部触发**）

> 一句话：**引擎自 v2.7.3 就会算门槛，但用户一句也录不进去**。本刀把这根管子从数据层一路接到 Excel 与编辑器，**`skillConditions.ts` 与三处消费端一字未动**。

| 轴 | 本刀实况（读代码可复核） |
|---|---|
| 词汇来源 | 六度量/三主体/五算子的**唯一真值**仍在 `skills/skillConditions.ts`（求值）；本刀只加**别名表** `skills/skillGateText.ts`（`GATE_METRIC_LABELS`/`GATE_SUBJECT_LABELS`/`GATE_OPERATOR_LABELS` + `METRIC_ALIASES`/`SUBJECT_ALIASES`/`OPERATOR_TOKENS`）。**扩度量须先有引擎事实，再进别名表**，顺序不许反（§12-42③"界面上有下拉≠引擎有该能力"）。 |
| 语法 | 一条门槛＝`[对象?] 度量 运算符 (度量\|数字)`；多条用 `、` `，` `,` `；` `;` **或换行**分隔；语义＝全部成立才发动（AND）；`无`/空＝没门槛；主体不写＝自身。**数字接受阿拉伯数字、汉字数字、`十X`/`X十`**。左右两侧都必须是**整截**度量（残留任何字符即判读不懂）。 |
| 运算符匹配 | 找运算符＝**位置最靠前者优先，同位置长词优先**（`splitClause`）。这条是本轮实测踩出来的：`己方玩家手牌数量为1` 若按表序首命中，会被 `为` 从中间截走、把 `数量` 留成残字而**整句读不懂**；改为"最靠前+同位最长"后 `数量为`(EQ) 正确胜出，`不大于`/`不少于`/`不小于` 也不会被 `大于`/`少于`/`小于` 反向截成相反语义。**这是本表唯一一处"顺序敏感"的实现，改词表前必须先补对应负例测试。** |
| 失败语义 | **读不懂＝逐条上报，一条不丢**：`parseEffectGroup` 返回 `{fields, gateUnknown, orphanGate?, triggerUnreadable?}` ⇒ 导入器按"谁·哪个技能·第几个效果·原文是什么"拼成人话，与技能级触发的读不懂项**共用同一条 `parseWarnings` 通道**（由 `parseRowPerSkillSheet` 随条目返回），编辑器顶部**常驻**清单显示（须人工点「知道了」才收），输入框实时回显「看懂了：A 且 B」/「没看懂（这些条件不会生效）：「…」」。**拒录点前移到录入侧**（不再走 `getCompileDiagnostics`，见 §G 第 1 项末的形态更正）：编译器只见结构化条件，故"这句没看懂"必然发生在还知道用户身份的地方。**两条如实披露的残留**（既有语义的必然后果、登记不修）：纯描述效果上写的门槛没有可闸门的东西（编译器照旧按 `NO_RUNTIME_PAYLOAD` 诚实跳过该效果，不另开提示）；读不懂的原句不落库⇒再导出该格为「无」（替代证人=当期逐条点名＋就地标红，用户自己的 `.xlsx` 源文件永远留有原句）。 |
| 缺省不落地 | `SELF` 主体**绝不写进结构**（求值端 `subject ?? 'SELF'`），否则「写法→结构→写法」往返不闭合（导出会少一个前缀）。这是 round-trip 测试曾经真实红过一次换来的口径。 |
| 与"选择其一"的分工 | 一张 choice 编译定义只有一个 `conditions` 槽 ⇒ 逐效果门槛**结构性表达不了**。裁决=**带门槛的选择组整组不编译**并逐条报 `CONDITION_CHOICE_UNSUPPORTED`，绝不解禁其中"看起来无条件"的那几条；用户口径本轮明确"选择其一暂时不考虑、暂时没有需求"。 |
| Excel 形态 | 效果组 v1=3 列（标注/触发/描述）、v2=6 列（+效果类型/数值/目标）、**v3=7 列（+门槛）**；宽度靠表头正则 `/^效果\d+门槛/` 探测而非硬数；导出恒 7 列（1-based 起始列 `12+7n`，门槛在 `18+7n`）；旧 3/6 列文件照旧导入＝该效果无门槛；**整组只写了门槛、没写是哪个效果 ⇒ 不凭空造效果**（返回 `orphanGate` 交回导入面点名报告——原设计"门槛栏单独有内容也算一个效果组"会在编译侧产出一条只有条件、无可结算内容的空效果，已由复算后的裁量改判，见 §12-46②⑥）；表头单元格挂 `GATE_SYNTAX_HINT` 批注。**下拉框列号、列宽数组、批注位置三处必须与宽度同频**（§12-46⑤）。 |
| 触发栏严格读法 | 新文件级函数 `readTriggerCell(s)`（`skillExcelFormat.ts`）＝**解析后必须反写成与原句逐字相同的标准写法**才算看懂，否则该栏一律不填、原句进常驻清单并列出全部可认写法。编辑器「照这个填」框与 Excel「触发」栏**共用这一条读法**。修的是复算闸抓出的真 bug：旧 `strToTrigger` 只认主名，用户写「受到伤害后→攻击」时**细分被静默丢弃**⇒本意"仅攻击伤害"被**放宽**成"所有伤害"（"读不懂却装作读懂"的最坏形态）。测试钉死"下拉里每一个选项都必须通过严格读法"，故该读法不会把自家选项挡在门外。 |
| 数据层承托 | `SkillEffect.conditions?` 类型本体在 `src/data/generals.ts`，`src/skills/dataTypes.ts` 仅 re-export ⇒ 保持 skills→data 单向依赖箭头；旧 localStorage 缺字段＝零迁移向后兼容。 |
| 编译 | `skillCompiler.ts` 逐效果**纯透传**（编译期零求值、零改写），`conditions: []` 归一为 `undefined`，定义形状与 id 一字未变 ⇒ 官方内容今日零门槛，B10 理论上必逐字（实测兑现）。 |
| 消费端 | 触发路 `SkillTriggerBridge.buildCondition`（10 枚触发键同一道闸）与决策路 `turnEndSkills` 候选枚举 + `TurnEndSkillResolver` 再求值，两路共用同一实现；**本刀未动任何一处**。 |
| 真机证据 | 本地 dev server 单实例、**复算闸修完之后的那一版代码**（非修复前快照）：门槛框打字→实时回显「看懂了：手牌≤2 且 牌堆≥5」；残句「攻击范围内没有马」→就地红块＋同时显示「没有门槛」；切「选择其一」并留着门槛→红字当场出现；严格读法两景（半截「受到伤害后→攻击」被拒并列可认写法／写全「受到伤害后→攻击伤害」两个下拉同步填上）；真点「💾 保存修改」后从 store 取回 `conditions`（`HAND_COUNT LTE 2`）与 `trigger{onDamageTaken, attackDamage}` 逐字；**现场生成 26 列（=7 列×2）的 v3 工作簿、经页面真实 `<input type=file>` 上传导入**⇒常驻清单恰好点名 3 条（半截技能级触发／只写门槛的孤立效果／读不懂的门槛原句），而关羽那条可读门槛的两个条件全部结构化入库并带 runtime 摸牌类型。全程未触发任何保存/下载弹窗；如实披露两处=开发者模式经 dev-only 钩子 `window.__TK__.useGameStore.setState({developerMode:true})` 打开（口令按 v2.8.1 设计不为我所知、不进任何载体；该钩子写的是与设置页同一个布尔位、非玩法旁路），以及事后清理（两个编辑 localStorage 键删除、刷新回主页、夹具与生成脚本删除、dev server 用完即杀并复查 5173 无 LISTENING）。 |
| 测试面 | 579/62 → **617/64**。取证分层=纯解析（`skillGateText.test.ts` 14 例，含嫌疑词表反读边界）／导入面逐条报告（`skillExcelParsers.test.ts` 8 例）／Excel 往返与严格读法（`skillExcelFormat.test.ts` v3 段重写）／编译透传（`skillCompiler.test.ts` 5 例）／**组件级**（`SkillEditor.runtime.test.tsx` 4 例：打字→回显→存 store→编译器带条件）／**零 mock 真引擎闭环**（`skillPipeline.test.ts` 1 例：门槛文本→`parseGateText`→真 `GameEngine` 两次攻击，手牌 1 摸 1 张、手牌 2 零技能摸牌）。最后这例补掉复算闸指出的取证缺口：`skillConditions.test.ts` 仍走 `vi.mock` 编译缝，而门槛录入面落地后该 mock **已不再必要**（保留它的现由=逐条钉两路求值语义、不依赖录入面）。 |
| 录入面还**没有**的东西（待口令，不算本刀欠账） | 支付代价、后续效果、数值变化+持续生效（＝面板值由引擎推导的落地通道）、本次伤害增减、任选目标、区域目标+不可空发、决斗流程、回合限1次记账、"选择其一"的门槛、大白话词汇替换（观顶/置牌入堆/剥离装备/被作用者）。 |

### 按需池（2.3.1 起余 12 类未支撑触发；2.3.0 起从"欠账"改登记为"暂无业务需求"）

| 触发类型 | 状态 |
|---|---|
| ~~onTurnEnd~~ | **已销案（v2.3.1）**——非事件触发形态：玩家决策 canonical ACTIVATE_SKILL + 回合结束询问窗（十二格表见上）；未来"决策型"触发（active* 等）沿用此形态先例，不必强塞事件映射 |
| onOtherDeploy / onTargetConfirmed / onOtherSkillActivated | 暂无业务需求（需求出现时按本节十二格上表） |
| onBaseTargetedAtk / onBaseTargetedSkill / onBaseDamaged | 暂无业务需求（本营系触发，需先盘本营事件源） |
| modifyAttack / modifyDefense | 暂无业务需求（**改造类触发需先设计修正器管线**，不得直改 resolver 数值） |
| activeSelf / activeOther | 暂无业务需求（主动技=玩家决策，天然对应 A 类 action+反应窗形态，随询问语义需求立项） |
| passive / untilExpire | 暂无业务需求（持续/过期语义需要状态机字段设计，随需求立项） |

已支撑 9 类（事件触发映射）：onDeploy / onTurnStart / onDamageTaken / onDamageDealt / onKill / onDeath / onBecomingTarget / **onCardLost / onCardGained（v2.5.3；事件源 v2.6.2 起=GIVE/DISCARD/EQUIP_STRIP 三路派生 + cardFilter 谓词三枚，闭面清单见"CARD_* 事件源扩面"表）**。另有 onTurnEnd 以"玩家决策 canonical action"形态进局（不占三表，见上表），2.3.1 时点已上表闭环 2 类。**onCardLost/onCardGained 注（v2.5.3）**：此二枚**不在 2.3 盘点的 12 类按需池内**（旧 `SkillTriggerType` 联合根本没有该枚举，§G 以"事件缺"记为档2 缺口）——本刀随 GIVE 原语扩枚上表，12 类按需池原样不动。**onDeploy 注（v2.5.1）**：映射自 2.1 即在表，但部署当步存在注册序缺口（§12-26）致其结构性打不到自己登场——v2.5.1 起 `TransitionCore` 部署结算后经 `ctx.resyncSkills` 补注册并对该步 `GENERAL_DEPLOYED` 重放监听（sourceGeneralId 键定防重触发），缺口接通；**接线≠转正**，三条已降档 onDeploy 技能曾维持纯描述至 **v2.5.2 四件验收全数达成、英慧/拓略/奋勇三条正式转正入局**（真机事件级触发 3/3 + 四路径逐事件一致，HANDOFF §12-30；§12-26 全销）。

### GPT 合并复核（2026-09-25，一、二刀契约形态首检；纯 docs 登记不占版本）

外部评审对 v2.3.0+v2.3.1 落地形态逐问裁决（原文归档仓库外 `G:\THREE_KINGDOMS\GPT_DISCUSSION_2_3_CUTS12_REPLY.md`）：**总判定=契约形态成立、不建议因此两刀再开结构性重构**。Q1 🟡 有条件同意（不新增 GENERAL_TARGETED）/ Q2 🟢 十二格门禁成立（不加第十三格）/ Q3 🟢 store 延迟开窗=时序编排非第二转移路径 / Q4 🟡 turnEndAsk 不持久化本地可接受、需预钉 Replay 边界句 / Q5 🟢 决策型触发建议升格为正式分类 / Q6 🟢 WeakMap 带外诊断健康。

**三句冻结契约（自本次登记起为长期设计档口径）**：

1. `onBecomingTarget` 当前语义=目标确定且进入伤害结算前的**目标侧响应**；不是通用 target-selection 事件。
2. **Replay 恢复游戏事实与 canonical actions，不承诺恢复 UI/window 生命周期。**
3. **决策型 Trigger 不自动执行**；它产生的是可决策资格，最终效果必须由 canonical action 进入 TransitionCore。

**随刀纪律（评审建议已采纳）**：

- **GENERAL_TARGETED 升级条件按业务信号触发**（满足任一再立独立事件，反对为字面优雅提前造）：①需要"目标确定后、伤害前"插入不依赖伤害存在的效果；②存在"成为目标但被闪避/转移/取消、最终无伤害"的合法路径且规则要求"只要成为目标就触发"；③非攻击类技能指定目标也需 target 触发；④需要独立 target-resolution phase（目标修改/转移→响应→合法性复查→伤害）。
- **十二格表下补解释纪律（不加格）**：Reentrancy 格必须写明重复进入/重复消费/重复触发的防护；若规则存在玩家可取消或窗口可中止行为，在 Transition 或 Replay 栏注明其**最终提交点**。幂等归入 Reentrancy/Transition/Condition 交叉约束（现例：`consumedSkills` 键 `` `${turn}:${skillId}` `` 即同回合二次激活封锁）。
- **Trigger 两概念族正式成立**：自动事实触发（Event→TriggerBridge→Effect，如 onDamageTaken/onDeath/onKill）vs **决策型触发**（game fact→候选→决策机会→canonical action→Effect，如 onTurnEnd；未来 active*/onPhaseEnd 类先问"规则自动发生，还是玩家获得一次是否发动的权利"，后者一律走决策族形态，不塞自动映射表）。
- **P2 联网前瞻（登记不实施）**：届时窗口升级为协议层 ReactionWindow（windowId/owner/legalActions/deadline/state/revision，或需 window epoch），属网络协议层；**不因此改变当前 Replay 的 A 类 canonical action 口径**（第 2 句冻结契约不变）。
- **编译诊断去重作用域语义**：distinct 条目去重的作用域=当前运行环境/诊断生命周期，不是永久进程历史；现状（模块级集合随页面重载自然清空）符合预期不返工，若未来出现长期运行 reload 生命周期则随其清理。

## G. 内置技能内容档（v2.4.0 第一刀，2026-09-25：168 条全量盘点分档）

**基数纠偏（正式登记）**：历轮文档口径"内置 77 将"与代码不符。`src/data/generals.ts:193-305` 实测=**95 将（魏21/蜀22/吴21/群16/晋15）、168 条技能、162 个去重技能名**。一切内容基数以本表为准；历史条目中的"77"仅作历史记录，不回改。

**现状**：内置技能全部只有名字（`createGeneral` 生成 `skills.map(s => ({name: s}))`，连 description 都没有），装配时整批 `NO_RUNTIME_PAYLOAD` 诚实跳过。本表是"内容量产计划（2.4 四刀）"的施工图：**档1=用现有引擎词汇即可忠实表达或已注明近似的技能，v2.4.1/2 分批配载入局；档2=需新 Effect 原语（2.5 候选，按需求排序）；档3=需 13 类按需池触发；档4=维持纯描述**（本游戏无锦囊/牌类型/判定/横置/装备区/回应等概念对应物，或近似会彻底失真）。

**现有引擎词汇表（档1 判定唯一依据，全部来自 skillCompiler/SKILL_TRIGGERS 实测；系 2.4.0 分档时点口径，v2.5.0 起效果原语增至 5 种——新增 DISCARD 弃牌〔手牌头部确定性弃置，value=0 为全手哨兵〕，下列"无弃牌"一条自此失效，其余维持）**：触发 8 类（登场/回合开始/受伤后[可滤攻击|技能伤]/成为攻击目标时[结算前]/造成伤害后[仅攻击]/击杀时/被击杀时/回合结束[决策型经询问窗]）× 效果 4 原语（摸牌只归拥有者/造 N 点技能伤害[目标 SELF|ATTACKER|事件 TARGET]/回 N 血[封顶 maxHp]/得 N 护甲）× 目标 SELF/ATTACKER/事件目标。**无**：任意条件、给他人牌、弃牌、观牌堆、多目标、每局限一次、距离/响应类修正。**（v2.5.3 时点更新**：效果原语增至 6 种——+DISCARD（v2.5.0）+GIVE 发放（v2.5.3，手牌整体物理过手；"给他人牌"一条自此**接线层面解锁**，但"指定任意接收者"仍受玩家决策通道缺口约束=接线≠可配，见 F 节 GIVE 表）；事件触发增至 9 类——+onCardLost/onCardGained（v2.5.3，事件源首批仅 GIVE 派生），加 onTurnEnd 决策型合计 10 类进局。**v2.6.2 再注**：效果原语已随 2.6 线增至九种（+EQUIP_STRIP v2.6.0、+REVEAL/DECK_PLACE v2.6.1，逐条见 F 节各十二格表）；CARD_* 事件源扩至 GIVE/DISCARD/EQUIP_STRIP 三路并上 cardFilter 谓词三枚（equipment/lastHand/hand），连营/枭姬转正——"失去手牌/装备触发"自此接线+事件源双通，仍闭面清单注死于事件源扩面表。本行其余为 2.4.0 分档时点口径，档表判定不追溯重开——已分档技能如需新词汇表再档按新原语逐条复议。**）

**近似与初定义纪律**：内置技能无原文，语义即本项目首次定义；写"近似自"的表示借用了三国杀印象但词汇表无法忠实表达，差异逐条标注。档1 实装红线不变：编译器拒绝=当场诚实降级回档4并登记原因，绝不硬凑。

### 魏（34 条）

| 技能 | 归属 | 档 | 拟载（触发→效果） | 说明（近似/缺口） |
|---|---|---|---|---|
| 奸雄 | 曹操 | **1** | onDamageTaken→DRAW 1 SELF | 近似自"获得伤害你的牌"（转移原语缺）；skillPipeline 测试同族 ｜**✅ v2.4.1 已实装** |
| 护驾 | 曹操 | 4 | — |  multiplayer 代打需牌类型与响应机制，无对应物 |
| 反馈 | 司马懿 | 2 | onDamageTaken(all)→DISCARD 1 ATTACKER | 需"伤害来源弃置"（DISCARD 原语，2.5 首位候选） ｜**✅ v2.5.0 已实装（DISCARD 首批；保真度 B：原技为"获得来源一张牌"之转移，转移原语缺→实现为来源弃 1，差异已注，十二格表见 F 节）** |
| 鬼才 | 司马懿 | 4 | — | 无判定/回应机制 |
| 刚烈 | 夏侯惇 | **1** | onDamageTaken(attack)→DAMAGE 1 ATTACKER | 近似自"判定或弃或掉血"，定为确定 1 点反伤；与回刺（2.3.0）同族不同触发（伤后 vs 结算前） ｜**✅ v2.4.1 已实装** |
| 突袭 | 张辽 | 2 | — | 多人手牌获取=转移原语 |
| 裸衣 | 许褚 | 3 | — | modifyAttack 伤害修正 |
| 天妒 | 郭嘉 | 4 | — | 无判定 |
| 遗计 | 郭嘉 | 2 | — | 分牌给别人=发放原语（纯自摸近似与奸雄同型无内容区分度，不采） |
| 倾国 | 甄姬 | 4 | — | 牌型转换 |
| 洛神 | 甄姬 | 2 | — | 牌堆顶连续操作 ｜**v2.6.1 判定：维持档4（牌面无花色面，红黑判定无对应物，强配=发明玩法）；REVEAL/DECK_PLACE 原语与本技无涉** |
| 神速 | 夏侯渊 | 3 | — | modifyAttack+次数 |
| 巧变 | 张郃 | 4 | — | 移动/弃装备复合，移动是本游戏玩家动作非效果原语 |
| 断粮 | 徐晃 | 4 | — | 牌型转换+弃牌限制 |
| 据守 | 曹仁 | 2 | — | 摸3+弃光代价（DISCARD）｜**缓配（v2.5.0 评估）**：DISCARD 已到但代价与收益须原子发动——两条独立效果先后触发=可摸3后弃光不执行（或先弃后摸白赚），缺口真身=效果组原子性/自定义条件，非原语缺失 |
| 强袭 | 典韦 | 2 | onDamageDealt(attack)→EQUIP_STRIP 1 TARGET | 原技"移除伤害目标装备区一张牌"=本项目唯一装备面 armorCards 头部拆解 ｜**✅ v2.6.0 已实装（EQUIP_STRIP 首批；保真度 A：拆 1 装备卡忠实"移除装备"，资源卡进弃牌堆/将领卡回池，十二格表见 F 节）** |
| 驱虎 | 荀彧 | 4 | — | 判定+跨目标伤害分配 |
| 节命 | 荀彧 | 2 | — | 弃牌代价+回复他人 |
| 行殇 | 曹丕 | 2 | — | 阵亡将领牌获取=坟场操作 |
| 放逐 | 曹丕 | 2 | — | 弃牌+翻面状态字段 |
| 屯田 | 邓艾 | **1** | onTurnEnd→DRAW 2 SELF（决策型，询问窗发动） | 近似自"跳过弃牌阶段后获牌"，无自定义条件原语，定回合结束抽2 ｜**✅ v2.4.1 已实装（魏·邓艾；哨兵③同名不撞经本批 id 无碰撞断言钉死）** |
| 凿险 | 邓艾 | 4 | — | 牌型回应 |
| 权计 | 钟会 | 3 | — | 计数器字段+失去触发的复合形态 |
| 自立 | 钟会 | 4 | — | 觉醒+每局限一 |
| 贞烈 | 王异 | 2 | — | 弃1回1（DISCARD 代价）｜**缓配（v2.5.0 评估）**：无"以弃牌为代价门槛"的发动谓词原语——DISCARD 1 SELF 与 HEAL 1 SELF 各自独立无条件触发=无门槛奶血+白弃，硬凑违"不发明玩法"红线 |
| 秘计 | 王异 | 4 | — | 延时锦囊 |
| 奇策 | 荀攸 | 4 | — | 全牌当任意锦囊 |
| 智愚 | 荀攸 | 2 | — | 获得牌触发（onCardGained 事件缺） |
| 恂恂 | 李典 | 2 | — | 指定分发 |
| 忘隙 | 李典 | 2 | — | 回复触发+弃牌（onHeal 事件缺） |
| 峻刑 | 满宠 | 2 | — | 拼弃+条件伤害 |
| 御策 | 满宠 | 4 | — | 锦囊类型判定 |
| 绝情 | 张春华 | 3 | — | 伤害类型转换 modifier |
| 伤逝 | 张春华 | 2 | — | 失牌差值条件（onCardLost+自定义） |

### 蜀（38 条）

| 技能 | 归属 | 档 | 拟载 | 说明 |
|---|---|---|---|---|
| 仁德 | 刘备 | 2 | — | 手牌分发 |
| 激将 | 刘备 | 4 | — | 牌类型代打 |
| 武圣 | 关羽 | 4 | — | 牌型转换 |
| 咆哮 | 张飞 | 3 | — | 攻击次数修正 |
| 观星 | 诸葛亮 | 2 | — | 牌堆顶观看重排 ｜**v2.6.1 能力已就位（REVEAL+DECK_PLACE 双段），"重排"决策面属 v2.6.3 choice→转正挂 choice 之后** |
| 空城 | 诸葛亮 | 3 | — | passive 条件禁target |
| 龙胆 | 赵云 | 4 | — | 牌型转换 |
| 涯角 | 赵云 | 2 | — | 装备获取 |
| 马术 | 马超 | 3 | — | 距离修正（本游戏射程=棋盘站位，无距离原语） |
| 铁骑 | 马超 | 3 | — | 禁用牌 untilEnd modifier |
| 集智 | 黄月英 | 4 | — | 使用锦囊事件不存在 |
| 奇才 | 黄月英 | 4 | — | 装备距离/牌型 |
| 烈弓 | 黄忠 | 3 | — | 条件伤害修正 |
| 狂骨 | 魏延 | **1** | onDamageDealt(attack)→HEAL 1 SELF | 近似自"距离≤1"，条件原语缺、去距离限制（强度上浮由 B3 分布体现） ｜**✅ v2.4.1 已实装** |
| 挑衅 | 姜维 | 2 | — | 强制代打=目标转移 |
| 志继 | 姜维 | 4 | — | 觉醒 |
| 享乐 | 刘禅 | 2 | — | 弃牌阶段追加（DISCARD） |
| 放权 | 刘禅 | 4 | — | 每局限一+分发 |
| 八阵 | 卧龙诸葛亮 | 4 | — | 牌型替代 |
| 火计 | 卧龙诸葛亮 | 4 | — | 牌型转换 |
| 看破 | 卧龙诸葛亮 | 4 | — | 锦囊回应 |
| 连环 | 庞统 | 4 | — | 无属性传导概念 |
| 涅槃 | 庞统 | 4 | — | 限定技+回满+弃光（引擎无濒死救回路径） |
| 举荐 | 徐庶 | 2 | — | 牌堆顶/他人得牌 |
| 无言 | 徐庶 | 3 | — | 禁响应 modifier |
| 心战 | 马谡 | 2 | — | 观顶拣选 ｜**v2.6.1 能力已就位（REVEAL+DECK_PLACE），"拣选"决策面属 v2.6.3 choice→转正挂 choice 之后** |
| 挥泪 | 马谡 | 2 | — | 击杀触发+choice（未接线） |
| 父魂 | 关兴张苞 | 4 | — | 牌型合并技 |
| 陷嗣 | 刘封 | 4 | — | "嗣"伪装备系统不存在 |
| 龙吟 | 关平 | **1** | onBecomingTarget→GAIN_ARMOR 1 SELF | 初定义"战吼先声：被指定为攻击目标时+1护甲"（原技+伤害牌型不可行） ｜**✅ v2.4.1 已实装（护甲 BFS 尾部落账时序见 §12-25③）** |
| 当先 | 廖化 | 3 | — | 额外攻击次数 |
| 伏枥 | 廖化 | **1** | onTurnEnd→DRAW 1 SELF | 近似自"≤2血且<5牌补到5"，无条件原语、固定回合结束抽1（决策型询问窗） ｜**✅ v2.4.1 已实装** |
| 自书 | 马良 | 2 | — | 观顶拣选 ｜**v2.6.1 能力已就位（REVEAL+DECK_PLACE），"拣选"决策面属 v2.6.3 choice→转正挂 choice 之后** |
| 白眉 | 马良 | 2 | — | 抽2给1=发放 |
| 巨象 | 祝融 | 4 | — | 牌型回收 |
| 烈刃 | 祝融 | **1** | onDamageDealt(attack)→DRAW 1 SELF | 近似自"判定夺牌"，去判定确定抽1 ｜**✅ v2.4.1 已实装** |
| 祸首 | 孟获 | 4 | — | 牌型免疫 |
| 再起 | 孟获 | 2 | — | 濒死回满+弃光（回血对象已移除，语义不闭合） |

### 吴（37 条）

| 技能 | 归属 | 档 | 拟载 | 说明 |
|---|---|---|---|---|
| 制衡 | 孙权 | 2 | — | 弃任意摸等量（DISCARD）｜**缓配（v2.5.0 评估）**："任意…等量"数量由玩家自由决策，现原语为定量载荷——配固定 N 与真实弃牌量脱钩=定量失真（保真度 C），须等决策型消耗通道（自定义条件/发放族） |
| 救援 | 孙权 | 4 | — | 桃·婚姻体系无对应物 |
| 奇袭 | 甘宁 | 4 | — | 牌型转换（黑牌当过河拆桥） |
| 克己 | 吕蒙 | 3 | — | 跳过弃牌阶段=阶段修正 |
| 苦肉 | 黄盖 | **1** | onTurnStart→DAMAGE 1 SELF + DRAW 2 SELF（两效果） | 近似自"失去1体力摸2牌"。哨兵①**已实证（v2.4.2）**：合成 DAMAGE 的 SELF 受击路径被引擎接受（transitionEquivalence 哨兵例：TURN_START 自动自伤 1+摸 2）；内置首例单技能双独立效果（e1+e2 双定义） ｜**✅ v2.4.2 已实装** |
| 诈降 | 黄盖 | 4 | — | 牌型转换+延时锦囊 |
| 英姿 | 周瑜 | **1** | onTurnEnd→DRAW 2 SELF | 近似自"摸牌阶段多摸一张"，无摸牌阶段修正原语，定回合结束抽2（决策型询问窗） ｜**✅ v2.4.2 已实装（询问窗四候选之一）** |
| 反间 | 周瑜 | 4 | — | 判定+猜牌 |
| 国色 | 大乔 | 4 | — | 牌型转换 |
| 流离 | 大乔 | 2 | — | 弃牌+目标转移 |
| 谦逊 | 陆逊 | 4 | — | 锦囊免疫（无锦囊概念） |
| 连营 | 陆逊 | 2 | onCardLost(lastHandLost)→DRAW_CARD 1 SELF | 原技"失去最后一张手牌后摸一张" ｜**✅ v2.6.2 已实装（事件源扩面首批；保真度 A：被顺走/被弃置两路=GIVE/DISCARD 源均派生带 remainingHand 的 CARD_LOST，lastHand=结算后零张哨兵直读；置牌/消耗等闭面失牌不响=清单注死，见 F 节事件源扩面表）** |
| 结姻 | 孙尚香 | 2 | — | 弃2回他人（回血对象已移除） |
| 枭姬 | 孙尚香 | 2 | onCardLost(equipmentLost)→DRAW_CARD 2 SELF | 原技"失去一张装备牌后摸两张" ｜**✅ v2.6.2 已实装（EQUIP_STRIP 被拆装备→via='EQUIP' CARD_LOST 差值派生；保真度 B：现装备离场面唯一=被剥离一路，装备随主阵亡离位不派生=覆盖差异已注，EQUIP 源不带 remainingHand"装备说话不了手牌"；见 F 节事件源扩面表）** |
| 天香 | 小乔 | 2 | — | 弃红桃转移伤害 |
| 红颜 | 小乔 | 4 | — | 判定牌型锁定 |
| 天义 | 太史慈 | 3 | — | 攻击次数+距离复合修正 |
| 不屈 | 周泰 | 4 | — | 濒伤痕计系统 |
| 奋激 | 周泰 | 2 | — | 失去牌触发+弃牌 |
| 好施 | 鲁肃 | 2 | — | 摸牌分发他人 |
| 缔盟 | 鲁肃 | 2 | — | 弃牌+两人手牌交换 |
| 直谏 | 张昭张纮 | 4 | — | 装备/延时锦囊放置 |
| 固政 | 张昭张纮 | 2 | — | 弃牌堆回收 |
| 旋风 | 凌统 | 2 | — | 装备移除+弃牌 |
| 破军 | 徐盛 | 3 | — | 禁牌到回合结束（untilExpire） |
| 激昂 | 孙策 | **1** | onBecomingTarget→DRAW 1 SELF | 近似自"锦囊入营摸牌"，转"被攻击瞄准时蓄势摸1" ｜**✅ v2.4.2 已实装** |
| 魂姿 | 孙策 | 4 | — | 觉醒 |
| 调度 | 吕范 | 2 | — | 装备区操作 |
| 典财 | 吕范 | 2 | — | 装备回收/弃置 |
| 安恤 | 步练师 | 2 | — | 摸牌分发+弃牌 |
| 追忆 | 步练师 | **1** | onDeath→DRAW 1 SELF | 近似自"死亡时交给一名角色"（发放缺），定遗计自摸 1（同命族 DEATH 携带 attackerId，SELF 归拥有者） ｜**✅ v2.4.2 已实装（含技能击杀 DEATH 回灌路径实证）** |
| 傲才 | 诸葛恪 | 4 | — | 回合外手牌使用体系 |
| 名君 | 诸葛恪 | 4 | — | 限定技 |
| 短兵 | 丁奉 | 3 | — | 攻击距离修正 |
| 奋迅 | 丁奉 | **1** | onTurnStart→GAIN_ARMOR 1 SELF | 初定义"冲锋陷阵：回合开始+1护甲"（距离/弃装备不可行） ｜**✅ v2.4.2 已实装** |
| 甘露 | 吴国太 | 4 | — | 装备对比获取 |
| 补益 | 吴国太 | **1** | onDamageTaken(attack)→HEAL 1 SELF | 近似自"展示手牌为本营/将领补血"，定受伤自愈1 ｜**✅ v2.4.2 已实装** |

### 群（29 条）

| 技能 | 归属 | 档 | 拟载 | 说明 |
|---|---|---|---|---|
| 急救 | 华佗 | 4 | — | 濒死求桃（无濒死概念） |
| 青囊 | 华佗 | 2 | — | 弃2回他人+每局限一 |
| 无双 | 吕布 | 4 | — | 基本牌双响（牌型） |
| 离间 | 貂蝉 | 4 | — | 决斗概念不存在 |
| 闭月 | 貂蝉 | 4 | — | 判定摸牌 |
| 酒池 | 董卓 | 4 | — | 牌型转换 |
| 肉林 | 董卓 | **1** | onDamageTaken(skill)→HEAL 1 SELF | 初定义"酒肉养伤：受技能伤害后回1血"（牌型响应不可行；与张春华绝情同为技能伤族但方向相反） ｜**✅ v2.4.1 已实装** |
| 崩坏 | 董卓 | 2 | onBecomingTarget→EQUIP_STRIP 1 SELF | 原技"成为基本牌目标后弃置装备"含"基本牌"谓词，现触发为广义 onBecomingTarget、落账时序=伤害结算后不减当次伤害 ｜**✅ v2.6.0 已实装（EQUIP_STRIP 首批；保真度 B：条件面（基本牌→广义目标）与时序面差异已注，十二格表见 F 节）** |
| 乱击 | 袁绍 | 4 | — | 手牌当万箭齐发 |
| 双雄 | 颜良文丑 | 4 | — | 判定拼点 |
| 雷公 | 张角 | 4 | — | 属性伤害判定 |
| 鬼道 | 张角 | 4 | — | 判定替换+牌型 |
| 蛊惑 | 于吉 | 4 | — |  bluff 用牌体系 |
| 义从 | 公孙瓒 | 3 | — | 距离双向修正 |
| 马术 | 庞德 | 3 | — | 距离修正（与蜀马超同名同档） |
| 猛进 | 庞德 | **1** | onBecomingTarget→DAMAGE 1 ATTACKER | 近似自"杀被闪后弃牌"，无弃牌原语，定为"被瞄准时迎头痛击 1 点技能伤"（与回刺同为结算前反制族，2.3.0 时序） ｜**✅ v2.4.1 已实装** |
| 妄尊 | 袁术 | 3 | — | 回合内持续修正 |
| 同疾 | 袁术 | 3 | — | passive 目标选择限制 |
| 悲歌 | 蔡文姬 | 4 | — | 弃牌+判定响应 |
| 断肠 | 蔡文姬 | 2 | onDeath→DISCARD 0 ATTACKER | 击杀者弃光全部（DISCARD+全量） ｜**✅ v2.5.0 已实装（保真度 A：击杀者弃光全手牌忠实；value=0 弃光哨兵首例；真机台账见 F 节活例行）** |
| 帷幕 | 贾诩 | 3 | — | passive 禁target |
| 乱武 | 贾诩 | 4 | — | 限定技群体判定伤害 |
| 完杀 | 贾诩 | 3 | — | passive 濒死救援封锁 |
| 化身 | 左慈 | 4 | — | 开局随机技能获取 |
| 新生 | 左慈 | 4 | — | 觉醒 |
| 明策 | 陈宫 | 2 | — | 弃牌+条件分发/伤害 |
| 智迟 | 陈宫 | 3 | — | passive 二次伤害免疫 |
| 陷阵 | 高顺 | 3 | — | 双方禁基本牌到回合结束 |
| 禁酒 | 高顺 | 4 | — | 牌型使用限制 |

### 晋（30 条）

| 技能 | 归属 | 档 | 拟载 | 说明 |
|---|---|---|---|---|
| 巧变 | 司马懿(晋) | 4 | — | 移动类（与魏张郃同名同判） |
| 大权 | 司马懿(晋) | 3 | — | 回合外任意发动（activeOther） |
| 鹰视 | 司马师 | 2 | — | 观牌堆顶+失去触发 |
| 夺嫡 | 司马师 | 2 | — | 弃牌+分发复合 |
| 赵染 | 司马昭 | 4 | — | 延时锦囊 |
| 司敌 | 司马昭 | **1** | onDamageTaken(skill)→DRAW 1 SELF | 初定义"识破术法：受技能伤害后摸1"（与肉林同触发不同方向） ｜**✅ v2.4.2 已实装（与刚烈交叉链实证）** |
| 帷幄 | 贾充 | **1** | onTurnStart→GAIN_ARMOR 1 SELF | 初定义"运筹帷幄：回合开始+1护甲" ｜**✅ v2.4.2 已实装（热座真机触发：贾充登场后下回合卡面 🛡️1）** |
| 矫诏 | 贾充 | 4 | — | 判定伪诏计数 |
| 慧眼 | 张春华(晋) | **1** | onDamageDealt(attack)→DRAW 1 SELF | 初定义"鉴人于微：造成攻击伤害后摸1" ｜**✅ v2.4.2 已实装** |
| 秘置 | 张春华(晋) | 2 | — | 回合外置牌（牌堆操作） ｜**v2.6.1 能力已就位（DECK_PLACE 机械面），回合外时机+置牌决策面属 v2.6.3 choice→转正挂 choice 之后** |
| 权计 | 钟会(晋) | 3 | — | 计数器字段（与魏钟会同判） |
| 自立 | 钟会(晋) | 4 | — | 觉醒 |
| 屯田 | 邓艾(晋) | **1** | onTurnEnd→DRAW 2 SELF | 与魏邓艾同名同载（编译 id 含 ownerKey 不冲突） ｜**✅ v2.4.2 已实装（同名双实例断言钉死；询问窗候选）** |
| 凿险 | 邓艾(晋) | 4 | — | 牌型回应 |
| 英慧 | 王元姬 | **1** | onDeploy→DRAW 2 SELF | 初定义"识鉴英才：登场摸2" ｜**✅ v2.5.2 已转正实装**（曾 v2.4.2 降档4=onDeploy 注册序缺口 §12-26，v2.5.1 接线、四件验收后转正；真机事件级触发为证 HANDOFF §12-30②b） |
| 颂威 | 王元姬 | **1** | onTurnEnd→DRAW 1 SELF | 初定义"母仪劝勉：回合结束摸1"（决策型询问窗） ｜**✅ v2.4.2 已实装（询问窗候选）** |
| 拓略 | 杜预 | **1** | onDeploy→GAIN_ARMOR 2 SELF | 初定义"开疆立垒：登场+2护甲" ｜**✅ v2.5.2 已转正实装**（曾 v2.4.2 降档4=onDeploy 缺口 §12-26，v2.5.1 接线、四件验收后转正；真机 🛡️2+事件为证 §12-30②b） |
| 破竹 | 杜预 | **1** | onKill→DRAW 2 SELF | 初定义"势如破竹：击杀摸2" ｜**✅ v2.4.2 已实装** |
| 清德 | 羊祜 | **1** | onTurnStart→HEAL 1 SELF | 初定义"德信怀人：回合开始回1血" ｜**✅ v2.4.2 已实装** |
| 垦荒 | 羊祜 | **1** | onTurnEnd→GAIN_ARMOR 1 SELF | 初定义"积谷边备：回合结束+1护甲"（决策型询问窗） ｜**✅ v2.4.2 已实装（询问窗候选）** |
| 奋威 | 乐綝 | **1** | onDamageDealt(attack)→DAMAGE 1 TARGET | 初定义"威震追亡：攻击命中后追加1点技能伤"。哨兵②**已实证（v2.4.2）**：链式目标经 AFTER_DAMAGE 载荷 target 字段解析成功（含奋威链伤完成击杀→skillKill DEATH 回灌例） ｜**✅ v2.4.2 已实装** |
| 临阵 | 乐綝 | **1** | onDamageTaken(attack)→GAIN_ARMOR 1 SELF | 初定义"身先士卒：受攻击伤害+1护甲" ｜**✅ v2.4.2 已实装（反向瞄准实证例）** |
| 单骑 | 文鸯 | **1** | onDeath→DAMAGE 1 ATTACKER | 初定义"挑枪同命：被击杀时对凶手造1点技能伤"（DEATH 载荷带 attackerId，与回刺/同命族） ｜**✅ v2.4.2 已实装（同命族真实击杀链实证）** |
| 奋勇 | 文鸯 | **1** | onDeploy→DRAW 1 SELF | 初定义"敢战先登：登场摸1" ｜**✅ v2.5.2 已转正实装**（曾 v2.4.2 降档4=onDeploy 缺口 §12-26，v2.5.1 接线、四件验收后转正；真机 seq27 DRAW 事件链为证 §12-30②b） |
| 乱政 | 贾南风 | 2 | — | 回合外弃牌移牌 |
| 戮杀 | 贾南风 | **1** | onKill→HEAL 1 SELF | 初定义"酷烈自养：击杀回1血" ｜**✅ v2.4.2 已实装（同命族实证例；热座真机描述可见）** |
| 并吞 | 司马炎 | **1** | onKill→GAIN_ARMOR 2 SELF | 初定义"混一六合：击杀+2护甲" ｜**✅ v2.4.2 已实装（与死节同场实证例）** |
| 封赏 | 司马炎 | **1** | onTurnStart→DRAW 1 SELF | 初定义"开国行赏：回合开始摸1" ｜**✅ v2.4.2 已实装** |
| 举兵 | 诸葛诞 | 3 | — | 限定技多次触发（untilExpire+限定） |
| 死节 | 诸葛诞 | **1** | onDeath→DAMAGE 2 ATTACKER | 初定义"殉城烈怒：被击杀对凶手造2点技能伤"（单骑强化版，同族已定型） ｜**✅ v2.4.2 已实装** |

### 统计与分批收口

**档位合计（逐表实测，脚本交叉佐证）**：档1=33（魏3/蜀4/吴6/群2/晋18）、档2=48（魏15/蜀11/吴14/群4/晋4）、档3=26、档4=61，总 168 与技能条目逐一闭环。**分布偏斜如实登记**：晋 30 条中 18 条入档1，系"晋势力为自建将、无三国杀原文包袱、初定义即按引擎词汇表设计"所致；魏蜀吴群以近似为主，密度低是诚实结果而非盘点偷懒。**批次再平衡（相对计划书披露）**：批量一 v2.4.1=魏+蜀+群共 9 条（M1），批量二 v2.4.2=吴+晋共 24 条（M2）——晋扎堆使然，两批仍各为内容刀各登记新基线（B3/B4），刀边界不因均衡诉求重切。

**实装状态（随刀更新）**：**v2.4.1 批量一 9/9 已实装**（魏/蜀/群各档1 行已逐条标 ✅；编译器零拒绝、零降级；哨兵③跨势力重名 id 唯一性随魏·屯田入池经 `builtinContentBatch1.test.ts` id 无碰撞断言钉死；内容刀基线 B3 {"1":115,"2":185} 登记于 HANDOFF §12-25①）。**v2.4.2 批量二 21/24 已实装、3 条诚实降档**（吴6+晋15 行已逐条标 ✅；晋·屯田(邓艾)同名双实例经 `builtinContentBatch2.test.ts` id 无碰撞断言并入全库 31 定义；**哨兵①苦肉 SELF 自伤路径、②奋威链式 TARGET 解析均实证通过并随测试钉死**；英慧/拓略/奋勇三条 onDeploy 技能经活性探针实证"部署当步监听器尚未注册、永不触发"（注册序缺口，HANDOFF §12-26）按红线降回档4、维持 NO_RUNTIME_PAYLOAD 诚实跳过）。NO_RUNTIME_PAYLOAD 诚实跳过 168→159→**138**。内容刀基线 B4 {"1":117,"2":183} 登记于 HANDOFF §12-27①。**档1 两批合计实收 30 条（9+21）≥25，收敛核验形态按计划书第一分支走 v2.4.3（真实武将池规模局+逐技能触发频次+完整热座 E2E+2.5 建议书）。** **v2.5.0 批量三（2.5 首刀·DISCARD 原语首批）2/2 已实装**（魏·司马懿/群·蔡文姬两行已标 ✅——档2 技能因新原语到位直接进局；反馈打**保真度 B** 标签（转移→弃置近似）、断肠 **A**（GPT 首检采纳② 首批应用）；compiler/dataTypes/Excel 标签三处同步+编辑器预览随刀完成；**value=0 弃光哨兵仅数据层可用**，Excel/编辑器数值 min=1 不收 0=表面缺口登记 HANDOFF §12-29）。编译器账本：168 条→**33 runtime 定义**（批一 9+批二 22+批三 2，苦肉仍一条双定义）、NO_RUNTIME_PAYLOAD **138→136**。据守/贞烈/制衡三条虽在 DISCARD 射程内但**缓配不采**（效果组原子性/代价门槛谓词/定量失真三缺口逐条注于表内行）——DISCARD 落地不解锁它们，2.5 建议书 ⑥自定义条件族 与发放原语才是钥匙。内容刀基线 **B5 {"1":117,"2":183}** 登记于 HANDOFF §12-29①：与 B4 数字零漂移（内容刀≠必漂移，零漂移亦如实两行自洽+VIOLATIONS=0 上报）；反馈/断肠随机档 0 触发=攻击暴露不足之既有判读（v2.4.3 洞察①）非配置失效证据，验收归 v2.5.4 策略档重测+强制可达性专项；v2.5.1 起非内容刀须对 B5 逐字一致。**v2.5.1 onDeploy 接线（非内容刀）**：§12-26 注册序缺口销案——`TransitionContext.resyncSkills` 可选钩子 + `transition()` 部署结算后补注册并对该步 `GENERAL_DEPLOYED` 重放（echo 引用过滤、派生只结算新事件、四路径经 GameEngine 一处供钩全域生效、防重触发=sourceGeneralId 键定+Map 键幂等）；活性探针翻正（合成英慧 onDeploy→DRAW 恰 1 次）+ 部署链四路径逐事件一致；**零内容变化**（现存 33 条定义无一使用 onDeploy→重放面对空注册表，B5 {"1":117,"2":183} 逐字一致硬证达成、168→33/136 账本不动）；顺手钉死引擎事实=进场血量等于消耗牌数（`applyGeneralDeployedEvent: currentHp=consumeCards.length`）。英慧/拓略/奋勇转正仍待 v2.5.2 四件验收。**v2.5.2 三条 onDeploy 转正（内容刀·第三刀）**：四件验收（GPT 首检采纳①）全数达成——重新编译五闸绿 / 专项热座 E2E 真机事件级触发 3/3 / 真实模板部署链四路径逐事件一致（录像重建含内）/ 既有时序契约无回归；三条⤵行已翻 ✅（英慧 DRAW 2、拓略 GAIN_ARMOR 2、奋勇 DRAW 1，均 onDeploy→SELF，编译器零拒绝）。**§12-26 至此全销**。编译器账本 168→**36 runtime 定义/133 诚实跳过**；`--skill-stats` 真测奋勇 11/英慧 11/拓略 5=内置 onDeploy 首见 AI 战真账。内容刀基线 **B6 {"1":117,"2":183}** 登记于 HANDOFF §12-30①：**对 B5 聚合席位零漂移但逐势力真实分账**（魏蜀吴逐字同；群 126/70/208/119/14/2、晋 96/48/134/95/4/0=三条晋将入装配预期内变化）——"聚合相同≠无变化"教训随刀立；v2.5.3 起非内容刀须对 B6 逐字一致。**v2.5.3 GIVE 原语 + onCardLost/onCardGained 触发族（非内容刀·第四刀）**：只接线不配载荷——generals.ts 零新条目，账本 **36 定义/133 诚实跳过不动**（发放系 7 条+触发族 6 条内置技能仍纯名照常 NO_RUNTIME_PAYLOAD 跳过，批测试为钉）；十二格表两张已上 F 节（GIVE 原语表、触发族表），重入环泛化为 REACTION_EVENT_TYPES 集合闸（§12-31②）；B6 逐字一致硬证达成（结构性成立：内置零 GIVE 载荷、现存路径无一派生 CARD_*）。**转正前置已就位但接线≠可配**：发放系"指定任意角色接收"仍受玩家决策通道缺口约束（遗计/好施类，F 节 GIVE 表 Target 行注死）；连营/枭姬类触发族转正内容刀还需 CARD_* 事件源扩面（DISCARD/登场/补给消耗派生=主动收面待口令）。**v2.5.4 收敛核验（非内容刀·第五刀，2.5 主线收官）**：`--policy` 策略档接线（battleCli `policyByName` 四档、未知档位显式拒收、默认 random 行为逐字不变=B6 硬锚为证）+ **逐技能强制触发可达性专项达成**（`src/skills/builtinReachability.test.ts` 5 例：**36/36 条 runtime 定义逐条可强制触发且产生真实效果事件、无一死件**；账本钉 36/133、触发键恰 10 类、onTurnEnd 恰 6 条、两跑逐字节一致——GPT 采纳④销案）+ **策略档攻击链重测翻案成立**（见下节新表：34 名键两档全触发、零触发归零）+ **反馈真机补验清零 2.5.0 欠账**（dev 5174 热座房真实点击，canonical 链 `DAMAGE{shu_010__inst_k→wei_002__inst_1,value:1}→TRIGGERED→DISCARD{skillId:"wei_002__inst_1:反馈:e1",playerId:2,count:1,triggerDepth:2}` 逐字取证，姜维手牌 31→29 逐张对账，HANDOFF §12-32）。B6 {"1":117,"2":183} 逐字一致硬锚达成；448 例/50 文件；**至此 2.5 五刀全部闭环，档1 内容线无待办欠账**。**v2.6.0–2.6.2（2.6 线三刀补记，随刀细节以 HANDOFF §12-33/34/35 为准）**：v2.6.0 EQUIP_STRIP 第七原语+强袭/崩坏首批（内容刀→B7 {"1":117,"2":183}，账本 38/131）；v2.6.1 REVEAL/DECK_PLACE 第八/九原语**只接线不配置**（能力层非内容刀，对 B7 逐字硬锚；牌堆顶五候选全部因缺决策面挂 v2.6.3 choice 之后——"不发明玩法"红线第二次兑现）；**v2.6.2 CARD_* 事件源扩面+连营/枭姬转正（内容刀·2.6 第三刀）**：DISCARD/被拆装备两路派生 via 标注 CARD_LOST（弃牌/发放源带结算后 remainingHand、装备源刻意不带）、GIVE 源加性补该字段、cardFilter 谓词三枚（equipment/lastHand/hand）+编译器交叉组合两枚诚实 skip、事件源十二格表+重入评估先行（§12-31① 兑现，F 节新表）；账本 38→**40 runtime 定义/129 诚实跳过**、battleReport 37→**39 行/38 名键**；**内容刀基线 B9 {"1":117,"2":183} 登记于 HANDOFF §12-35①**——对 B7 **席位分布零漂移**（连营/枭姬触发路径需"装备被剥离/最后一张手牌被弃"niche，AI 随机档暴露不足=反馈/断肠既有判读同族，验收归 v2.6.4 策略档重测+可达性专项）；转正实证+谓词静默反例四路径逐事件一致、真机热座事件级取证两条全数集齐（HANDOFF §12-35⑤）；**v2.6.3 起非内容刀须对 B9 逐字一致**。

**2.5 新原语候选（按档2需求频次排序，本刀仅登记不实施）**：①DISCARD 弃牌（19 条引用，含反馈/制衡/天香等名技）；②发放/指定他人得牌（7 条：遗计/仁德/好施/恂恂…）；③失去/获得牌触发 onCardLost/onCardGained（6 条：连营/枭姬/奋激/智愚/忘隙/伤逝）；④牌堆顶操作（5 条：观星/洛神/心战/自书/秘置）；⑤装备区交互（6 条：强袭/旋风/调度/典财/涯角/崩坏）；⑥自定义条件原语（4 条：贞烈/峻刑/节命/放权的门槛语义）；⑦每局限一次（3 条：青囊/放权/自立类，与觉醒技同属内容深水区）。choice 接线另计入档4边缘的挥泪。

**待实证哨兵（第二、三刀开工先验）**：苦肉 SELF 自伤路径、奋威链式 TARGET 解析、跨势力重名技能（屯田/凿险/权计/自立/巧变/马术在魏蜀吴群晋间重名）编译 id 唯一性。三者在实装测试中任一被编译器或引擎拒绝→当场降级并登记原因，不硬凑。**（v2.4.3 收口：三枚哨兵全部实证通过——①苦肉②奋威随批二钉死、③id 唯一随批一入池再随批二同池复验。本节哨兵账关闭。）**

### 逐技能触发频次审计（v2.4.3 收敛核验刀，真实武将池 500 局）

跑法：`npm run ai-battle -- --skill 0 --skill-stats --games 500 --seed 5000`（seed 5000..5499 连续段、真实 generals.ts 装配而非演练注入；同 seed 两轮输出逐字一致，产物留档 /tmp/realpool500a/b.txt）。胜席 {1:173,2:327}、won=500、VIOLATIONS=0。计数口径=**带 skillId 标记的效果事件**（双效果技能分计两次）；联结键=技能名（跨势力重名合并，屯田魏/晋同键）。

**触发过 14 名键（56 事件）**：屯田 9、苦肉 8、垦荒 7、帷幄 6、英姿 5、封赏 4、伏枥 4、颂威 4、奋迅 3、清德 2、奋威 1、奸雄 1、狂骨 1、龙吟 1。
**零触发 15 名键**：并吞、补益、单骑、刚烈、慧眼、激昂、烈刃、临阵、戮杀、猛进、破竹、肉林、司敌、死节、追忆。

**内容质量洞察（2.5 的判读前提）**：①零触发名单几乎全是**攻击链技能**（onDamageTaken/onDamageDealt/onBecomingTarget 族）——随机策略 500 局合计仅发起攻击 ~38 次（逐势力攻击列 5/8/5/9/11），暴露面先天不足，**不能据本表判这些配置有错**（刚烈/猛进已在 v2.4.1 热座 E2E 真机触发过、烈刃/奸雄/狂骨在 v2.4.3 E2E 触发过）；②触发 Top 全为**自循环技能**（onTurnEnd/onTurnStart 摸牌/护甲），它们不依赖攻击决策所以满勤——这正确反映了引擎链路健康，内容层无断链证据；③结论：**攻击链技能的真实频次须以策略档（保守/均衡/激进）重测**，已列为 2.5 前置观测项；本表仅作随机档基线。

### 策略档攻击链重测（v2.5.4 收敛核验刀，真实武将池 500 局 × balanced/aggressive 两档）

跑法：`node .ai-battle/ai-battle.cjs --games 500 --seed 5000 --skill 0 --policy <balanced|aggressive> --skill-stats`（esbuild 束后直跑；seed 段与上表随机档完全同段，仅换策略）。**洞察③判读翻案成立：两档均"配置技能 34 名键 · 触发过 34 · 零触发 0"**——随机档的 15 条零触发确系策略暴露面不足，非配置失效。胜席 balanced {1:217,2:283} / aggressive {1:247,2:253}（激进档更接近对半=攻击决策拉平座位先手效应，观察信号不判失衡，GPT 采纳⑤口径）；两档 won=500、VIOLATIONS=0。频次对照（34 名键全表，四组分列排版；计数=带技能标记效果事件，双效果分计）：

| 名键 | bal. | agg. | 名键 | bal. | agg. | 名键 | bal. | agg. | 名键 | bal. | agg. |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 屯田 | 466 | 404 | 苦肉 | 184 | 136 | 刚烈 | 108 | 76 | 颂威 | 101 | 57 |
| 奋威 | 266 | 211 | 临阵 | 176 | 124 | 奋勇 | 90 | 74 | 龙吟 | 52 | 38 |
| 猛进 | 144 | 108 | 垦荒 | 141 | 90 | 拓略 | 79 | 67 | 慧眼 | 64 | 37 |
| 封赏 | 120 | 85 | 激昂 | 111 | 93 | 伏枥 | 111 | 86 | 帷幄 | 115 | 79 |
| 清德 | 125 | 78 | 奸雄 | 89 | 64 | 狂骨 | 67 | 62 | 奋迅 | 162 | 121 |
| 英姿 | 69 | 33 | 单骑 | 38 | 28 | 死节 | 37 | 27 | 英慧 | 31 | 24 |
| 破竹 | 35 | 23 | 戮杀 | 19 | 19 | 并吞 | 18 | 17 | 反馈 | 24 | 14 |
| 烈刃 | 96 | 71 | 补益 | 4 | 6 | 肉林 | 8 | 6 | 司敌 | 4 | 5 |
| 追忆 | 6 | 2 | 断肠 | 4 | 1 | | | | | | |

判读：①攻击链技能（刚烈/猛进/激昂/烈刃/反馈/断肠等）在两档下全部真实触发，v2.4.3 零触发名单全体平反；②低频尾部（断肠 1/追忆 2/司敌 5）是**语义使然的低概率**（断肠需自身阵亡且击杀者有手牌、追忆/司敌条件苛刻），非断链——与可达性专项 36/36 全通过互证（随机审计管真实性、强制覆盖管可达性，GPT 采纳④两轨自此齐）；③反馈 24/14 与真机补验（本节 v2.5.4 上段事件链）双轨闭合，v2.5.0 欠账全销。

### 策略档重测·第二轮（v2.6.4 收敛核验刀，六条暴露欠账归口，真实武将池 500 局 × balanced/aggressive 两档）

跑法与 seed 段同上（`--games 500 --seed 5000 --skill 0 --policy <档> --skill-stats`，产物留档 /tmp/v264_balanced.txt、/tmp/v264_aggressive.txt）。**胜席 balanced {"1":243,"2":257} / aggressive {"1":265,"2":235}**，两档 won=500、VIOLATIONS=0；名单口径=本池装配到的 38 条 runtime 定义（triggered 36 / 零触发 2）。六条欠账逐一归口：

| 名键 | bal. | agg. | 判定 |
|---|---|---|---|
| 董卓·崩坏 | 179 | 123 | ✅ 平反（onBecomingTarget 高频面） |
| 典韦·强袭 | 118 | 112 | ✅ 平反（onDamageDealt→EQUIP_STRIP 事件真实落账） |
| 司马懿·反馈 | 39 | 37 | ✅ 延续 v2.5.4 平反 |
| 蔡文姬·断肠 | 10 | 6 | ✅ 语义使然低频（需自身阵亡且击杀者有牌），非断链 |
| 陆逊·连营 | **0** | **0** | ⚠ 策略档仍零触发——**判读=语义窄交集非断链**（需"陆逊本人击杀带断肠的将且攻击耗手后恰剩 1 张被弃光"三重交集；强制可达性四路径事件级实证在 v2.6.2 已钉死，两轨互证口径不变） |
| 孙尚香·枭姬 | **0** | **0** | ⚠ 策略档仍零触发——**根因表面新事实**：AI 枚举虽含 EQUIP_ARMOR（legalActions:204-210），但"装上去的军备被**拆**"才响——伤害打掉的 armorCards **刻意不派生 CARD_LOST**（§F 事件源表闭面清单：受损销毁非 EQUIP_STRIP 分支），且需敌方典韦恰好剥到孙尚香本人；强制场景预挂军备+强袭喂招已实证全链，**判读同上=非断链**。若要收窄该概率差，属"受损销毁是否派生装备失去"的事件源再裁决——**须先改 §F 闭面清单表再动刀，本轮不预铺** |

**归口结论（v2.6.2 分账口径的兑现）**：崩坏/强袭/反馈/断肠四条欠账清零；连营/枭姬登记为**观察项**（语义窄交集，双档 1000 局零暴露=概率事实，可达性专项兜底真实性），**不立修复项、不据此改配置**——审计管真实性、强制覆盖管可达性，两轨结论已齐。

### 2.5 立项建议书（随 v2.4.3 收官刀出，登记不实施）

按"需求条数 × 链路健康证据"排序：
1. **新 Effect 原语 DISCARD（弃牌）**——档2 引用 19 条居首，含反馈/制衡/天香等名技；走十二格契约表全流程（先填表后动刀，扩枚同步三处：skillCompiler/dataTypes/Excel 标签）。**✅ v2.5.0 已落地**（十二格表入 F 节；首批反馈/断肠；据守/贞烈/制衡经评估缓配——缺口在原子性/门槛/定量而非原语本身）。
2. **onDeploy 注册序接线**——✅ 已于 v2.5.1 落地（候选 a=部署结算后补注册+重放该步 GENERAL_DEPLOYED，活性探针翻正为验收哨）；解锁已降档 3 条（英慧/拓略/奋勇，§12-26 缺口本体销案）归 v2.5.2 转正刀（GPT 采纳① 四件验收）——**✅ v2.5.2 三条转正实装完毕、四件验收全数达成、§12-26 全销（本项闭环）**；
3. **触发族/发放原语**——onCardLost/onCardGained（6 条）与"指定他人得牌"发放（7 条）：发放是 DISCARD 的镜像原语，建议同刀或紧邻刀。**✅ v2.5.3 接线落地**（十二格表先行、CARD_* 首批仅 GIVE 派生=主动收面；内置零载荷，转正内容刀仍待口令）。
4. **攻击链频次以策略档重测**——非代码需求，是观测需求：`--skill 1|2|3` 档各跑一段带 `--skill-stats`，补齐本表在随机档下先天缺失的暴露面，再回头检验攻击链配置质量。**✅ v2.5.4 重测完成**（`--policy balanced/aggressive` 500 局两档、34 名键全触发零触发 0，随机档判读翻案成立，全表见上节）；同刀执行 **GPT 采纳④逐技能强制触发可达性专项**（`builtinReachability.test.ts` 36/36 全通过）与**反馈真机补验**（2.5.0 欠账清零）——本建议书四项主件至此全部闭环。
5. **展示层顺手清（不占版本刀）**——近战按钮"可用但零合法目标"瑕疵（§12-28④）把目标枚举接进禁用谓词，随下一次 UI 改动顺手做。
6. 其后按档2 剩余频次：装备区交互（6）＞牌堆顶操作（5）＞自定义条件（4）＞每局限一次（3，与觉醒技同属深水区，最后）。

**GPT 内容量产形态首检结论（2026-09-25，随 v2.4.3 收官刀执行，全文归档仓库外 `G:\THREE_KINGDOMS\GPT_DISCUSSION_2_4_3_REPLY.md`）**：总判定=内容量产形态成立、可进 2.5，五条采纳——① onDeploy 降档 3 条**不得自动转正**：接线修复后须过「重新编译+专项 E2E+录像重建+既有技能时序契约不回归」四件验收才可升档；② 档1 增**忠实度标签 A/B/C**（A=语义与原技核心一致 / B=保留核心意图但删减判定随机条件 / C=仅表层效果）——仅 A/B 入档1，C 降档4，防"能编译"被误读为"足够忠实"；③ 2.5 优先级顺序获认可（DISCARD→onDeploy→触发族→策略档重测→UI nit），且明确**攻击链策略重测须排在触发族接线之后**；④ 新增建议项 7：**逐技能强制触发可达性专项**（每条款件技能至少证明存在一条可达触发路径并完成效果闭环；随机审计管真实性、强制覆盖管可达性，二者不可互替）；⑤ 基线漂移账**分账两行**（内容漂移 vs 长期系统偏置），平衡专项升格阈值=连续多刀同向扩大/单刀超预设席位阈值/与阵营稳定相关——当前 +2 席定性为观察信号、不判失衡。

**GPT 2.5 二检结论（2026-09-26，随 v2.5.4 收官刀执行，全文归档仓库外 `G:\THREE_KINGDOMS\GPT_DISCUSSION_2_5_4_REPLY.md`）**：Q1 **同意但收窄**——2.5 收官判定表述限定为"完成一个真实周期验证、量产方法可外推"，禁写"形态已被长期证明/后续条目一定无需新增原语/事件源"（CARD_* 目前仅 GIVE 事件源、玩家决策通道未完成）；Q2 **2.6 主序（修改建议采纳）**——装备区交互 → 牌堆顶操作 → CARD_* 事件源扩面（以连营/枭姬真实内容需求驱动）→ choice 决策通道 → 自定义条件原语 → 每局限一*；choice 若确有内容依赖可提前做最小通道骨架，但**严禁借此批量转正**（上方第 6 行的频次序据此微调：事件源扩面插队到 choice 之前、自定义条件与每限一后置）；Q3 **同意 GIVE-only 主动收口**——DISCARD 派生（弃牌触发"失去手牌时"）列为 2.6 明确立项项、由真实内容拉动，不为理论完整性提前铺开；Q4 **choice=独立能力层**——先完成"窗口—合法候选—玩家/AI 选择—结果回写—可复现日志"最小闭环再接具体技能，不与某批技能转正绑定（防"接线即完成"误判回潮）；Q5 **平衡专项暂不升格**——57%/50%/随机≈61% 只证明档位差异，三数登记为 **B6→2.6 平衡基线**，"连续多个内容刀同向扩大且可排除新机制短期扰动"作为升格触发器挂监控。收官定调=**2.5 验证闭环成立；2.6 优先补能力缺口；平衡暂观察、不抢跑**。

### 2.7 立项建议书（随 v2.6.4 收敛核验刀出，登记不实施）

**2.7 立项进度（2026-09-26 用户口令"进行2.7"=五刀连做授权）**：刀序=①v2.7.0 报表键定（**已落地**）→ ②v2.7.1 事件/状态事实契约治理（**已落地：本表新增 C-4 事实/呈现契约表，§12-37② 观察项收编，"MAIN→ACTION 折叠"对账补偿退役**）→ ③v2.7.2 choice 生产者最小验证刀（Q5 前置刀，只接线不带内容；**已落地：本表 F 节"choice 生产者候选构造器首批两枚"十二格表，内置零转正、录入面零改动，B9 逐字**）→ ④v2.7.3 自定义条件原语（**已落地：本表 F 节"门槛谓词首批六度量"十二格表逐字兑现——纯函数、先身份再门槛、fail-closed、缺省/空数组逐字不变；全库唯一实现 `src/skills/skillConditions.ts` 三处消费（触发路十键同闸 / 决策路候选与 legalActions 与 AI 司机同口径 / resolver 独立再求值出 `SKILL_CONDITION_UNMET`）；内置零 `conditions`、录入面零改动、条件不进录像不入 EngineState，B9 逐字；真机自动开闸不可达已登记 §12-41①**）→ ⑤v2.7.4 收敛核验收官（含 ⑦ 装备销毁 CARD_LOST 语义裁决、⑧ 积木语法纸面表、GPT 四检自判、2.8 建议书）；⑤ 每局限一次与 ⑥ 多槽 pendingChoice **等真实需求首现**（不预铺，本建议书原话）、⑨ 平衡监控**不升格**只挂线。**本系列新挂线（非建议书原条目）**：v2.7.1 E2E 发现"store 建房链从未把房间名登记为 `metadata.roomId`"（⇒live 录像恒 `'local'`，§12-39⑦），修它=新增游戏事实，列 2.8 候选、等真实需求。**（v2.8.3 注：④ 那句"真机自动开闸不可达"的成因是"无录入面"，录入面现已具备⇒该不可达定性失效，见 §F「发动门槛录入面」的测试面行。）**

**2.6 五刀总结（能力缺口序全部走完，GPT 二检 Q2 主序兑现）**：v2.6.0 EQUIP_STRIP 第七原语+强袭/崩坏首批（内容刀→B7、账本 38/131）→ v2.6.1 REVEAL/DECK_PLACE 第八/九原语只接线（非内容刀、B7 逐字；五候选忠实度闸门全部拦下="不发明玩法"第二次兑现）→ v2.6.2 CARD_* 事件源扩面+连营/枭姬转正（内容刀→B9 {"1":117,"2":183} 对 B7 双零漂移、账本 **40/129**）→ v2.6.3 choice 玩家决策通道最小闭环（非内容刀、B9 逐字结构性成立；五要素=窗 pendingChoice—预译候选—CHOOSE_OPTION 第 13 canonical 动作—RESOLVED 先行清账+延后结算链—全 A 类进录像；冻结世界闸+被拒动作进录像新事实 §12-36②）→ v2.6.4 收敛核验（choice 面十触发键全谱可达 `choiceReachability.test.ts` 12 例 + 策略档重测欠账归口 + 热座完整局+录像逐字 + 本建议书）。**终点线事实**：Effect 原语恰 9、触发键恰 10、录像/回放/对账四路径契约无一破口；**引擎层已知缺口清零**——剩余内容全部卡在"决策候选构造器"与"门槛语义"两处，属可立项的明示需求而非未知黑洞。

**承接池两案（2026-09-26 用户拍板，逐字转录）**：
1. **积木式技能编辑（类型+条件+消耗+效果模式+具体效果自由拼接）=后置，先语法后 UI**——第一步是纸面"**积木语法表**"：每个积木槽位 ↔ 引擎现有关词或已排期原语的映射表；映射不到=引擎缺口，按需求驱动补刀（十二格表纪律），**语法表全绿之前不动编辑器**；避免先做 UI 再发现词汇表空洞造成返工。
2. **同势力同名将领裁决**——**内容层允许存在**（同名不同技能组=合法创作自由）；**对局装配层强制唯一**（建房/征召池校验"同势力+同名至多一张"，冲突**显式提示、不静默过滤**）；前置小刀=触发观测与战报工具从"**技能名键定**"改"**将领实例 id+技能名键定**"（battleReport 名键合并/跨势力重名串账是现患，屯田魏/晋同键即此症）——本项不落地，装配层唯一校验无法在报表层复核。

**2.7 候选序（按"内容引用数 × 引擎缺口明确度"排；GPT 三检已校准：①②之间插入事实契约治理小刀=Q2/Q4，choice 扩面拆"最小接线验证刀→内容转正"两步=Q5，新增"装备销毁/受损 CARD_LOST 语义"待决策条目=Q3）**：
1. **报表键定小刀（承接池②前置）**——`battleReport`/skill-stats/反馈观测面键定改造；非内容刀、对当期基线逐字；积木语法表与同势力同名两案共同的前置。**✅ 已随 v2.7.0 落地销账**：计数键与期望行键同改为 **`将领模板id:技能名`**，持有者段经**累积别名表**（generalPool+fieldGenerals 双扫、`_p\d+` 剥离、instanceId+copyId 双键）解析回模板 id，不可解析者保留原始段=离册行如实披露；旧键定实测缺陷钉死（60 局 seed5000 命中 0 条）、新键定同档触发过 10 条；唯一键 **38→39**（屯田魏/晋拆两条独立账线=装配层唯一校验的复核手段已就绪）。细节见 §12-38 与 CHANGELOG `[2.7.0]`。**注意：本刀只交付"可复核"，装配层唯一校验本体仍未实现（等真实需求首现）。**
2. **事件/状态事实契约治理小刀（GPT 三检 Q2/Q4 新增）**——固定 canonical EngineState、呈现层字段、adapter 重建三者边界并加回归锚：store 呈现层-only set()（engineAwareSetter 镜像语义）触发的 adapter 重建不得污染录像/事实事件，live 内嵌 STATE_CHANGED 不得携带呈现词表（timelinePhase 'MAIN' vs canonical 'ACTION'）、canonical 字段（roomId 等）不得因镜像重建丢失（§12-37 观察项升格为此治理项；非 2.6 返工、非判定现有录像失真）。**→ v2.7.1 已销账**：逆折叠表+塌缩桶血统区分+metadata 键存活落地，边界与本表 C-4 成文、回归锚 `engineFactContract.test.ts` 5 例（含全链集成例）；roomId 一项经核=store 建房链本就无此事实（非镜像所丢），另挂 2.8 候选（§12-39⑦）。
3. **choice 生产者面扩面刀（内容拉动，逐刀单议；GPT 三检 Q5：动手前先打一发"只接线不带内容"的最小验证刀，规模明显小于 v2.5.1）**——最小验证刀=选目标、选牌等生产者各接一个合成探针，只验候选生成、开窗、冻结/拒绝规则、CHOOSE_OPTION、清账与录像，零内容转正；验收通过后"选目标"候选构造器（遗计/好施=发放系 7 条的最后一把锁；§F GIVE 表 Target 行注死的缺口）与"选牌排序/拣选"候选构造器（观星/心战/自书/秘置=牌堆顶五候选的决策面）各自需求首现时上表补行再由内容刀带出（§12-36④"接线≠可配第三次预防针"口径）；**转正仍走忠实度 A/B/C 门+四件验收，严禁批量**。
4. **自定义条件原语（档2 引用 4 条：贞烈/峻刑/节命/放权门槛语义）**——GPT 二检 Q2 主序中 choice 之后的既定下一能力项；先十二格表后动刀。
5. **每局限一次（3 条，与觉醒技同属内容深水区）**——GPT 二检 Q2 明确最后置。
6. **多槽 pendingChoice**——单槽撞账=事件照记状态不动（§F choice 表 Condition 格）；多欠账同窗需求首现（如遗计+好施同回合双开）时先改表再动刀，不预铺。
7. **"装备销毁/受损是否派生 CARD_LOST"语义裁决（GPT 三检 Q3：列为 2.7 待决策条目，不永久搁置、也不预排强制修复）**——连营/枭姬窄交集观察项的所属线；属语义定义问题而非补一条事件派发；提前扩 CARD_LOST 反而扩大重入面，维持"内容需求首现→补事件源需求表→再立项→再转正"纪律。**→ v2.7.4 已销账**：三路清单与裁决全文见本表 §F「装备损失语义裁决」——维持"仅 EQUIP_STRIP 派生"，另两路（伤害吸收销毁 / 随主阵阵亡）刻意沉默，负例钉已入 `transitionEquivalence.test.ts`；扩面施工图转 2.8 候选第 7 项。
8. **积木语法表（纸面刀，可并行）**——承接池①第一步；产出物=ARCH_MAP 新表，零代码。**→ v2.7.4 已销账**：九槽表见本表 §F「积木自由拼接语法表」；结论=现形态为单层乘积、七槽闭合、两槽结构性空缺（次数/冷却槽、链式"若/则"），二者即为 2.8 候选第 3、4 项；**语法表评审通过前不动编辑器 UI**（承接池①"先语法后 UI"口径不变）。
9. **平衡监控（GPT 二检 Q5 口径延续）**——策略档两档胜席观察线：v2.5.4 = 217/283、247/253；v2.6.4 复测 = **243/257、265/235**（见上节第二轮重测表，均向对半收敛，无同向扩大信号）；升格触发器="连续多个内容刀同向扩大且可排除新机制短期扰动"，当前**不升格**。

**GPT 2.6 三检结论（2026-09-26，随 v2.6.4 收官刀执行，全文归档仓库外 `G:\THREE_KINGDOMS\GPT_DISCUSSION_2_6_4_REPLY.md`；注入锚点=简报 1921 字/哈希 879251900 逐批对账全过，Q5 因 UI 折叠走外科补发 114 字独立短消息）**：
- **Q1（收官表述口径）**：采用"验证级"非"完成级"。收官句定稿=**"2.6 完成一个真实能力周期的验证，证明『能力缺口识别→原语/触发族→choice 闭环→真机复验』的补齐方法具备外推依据；不据此宣称后续内容均可无新增能力直接转正。"** 禁写句=**"2.6 已证明内容量产能力完整，后续技能可直接批量转正。"**
- **Q2（七项序）**：总体成立；在①报表键与②choice 扩面之间插入"事件/状态事实契约治理"小刀，使后续所有 choice 生产者扩面建立在干净事实层上（已并入上表第 2 项）。
- **Q3（连营/枭姬判读）**：接受"窄交集、非断链"；不预排强制修复，保留内容首现触发机制；"装备销毁/受损的 CARD_LOST 语义"列为 2.7 待决策条目（已并入上表第 7 项）。
- **Q4（adapter 镜像重建）**：超观察项，定性=2.7 治理项（非功能修复刀、非 2.6 返工、非判定现有录像失真）——当前游戏事实/终态/录像核心对账均全等故不构成收官阻断，但涉及 EngineState canonicality 与事件录像契约，生产者扩面后影响面会扩大（已并入上表第 2 项）。
- **Q5（choice 生产者扩面是否先接线验证）**：先打"只接线不带内容"最小验证刀，规模明显小于 v2.5.1；消费端已由合成 12 例+真机复验钉死，最小刀只需验"生产者能否合法产生标准 choice 请求"；2.7 顺序改写为"①报表键→②最小接线验证刀→③内容需求带出的生产者转正→④自定义条件……"（已并入上表第 3 项）。
- **总评**：2.6 已不只"把缺口补上"，而是暴露"事实层契约治理"的下一层问题——正适合作为 2.7 主治理线，不倒灌回 2.6。**三检不阻断 v2.6.4 收官。**

### 2.8 立项建议书（随 v2.7.4 收敛核验刀出，**登记不实施**；立 2.8 须用户口令）

**2.7 五刀总结（需求驱动技能规则主线；GPT 三检校准后的九项建议书走完五刀，另四刀等需求首现）**：v2.7.0 报表键定（**纯工具面**：`battleReport`/skill-stats 从裸技能名段改 **`将领模板id:技能名`**，累积别名表双扫 generalPool+fieldGenerals、不可解析保留原始段=离册如实披露；旧键定 60 局实测命中 0 条已钉死，唯一键 **38→39**）→ v2.7.1 事件/状态事实契约治理（呈现层镜像**逆折叠表**取代大写化、`rebuildMetadata` 保 canonical 键；本表新增 **C-4 事实/呈现契约表**；§12-37② 观察项收编销案、"MAIN→ACTION 折叠"对账补偿退役；回归锚 `engineFactContract.test.ts` 5 例含全链集成；新发现 roomId 恒 `'local'`=store 建房链本就无此事实，挂 §12-39⑦ 不顺手修）→ v2.7.2 choice 生产者候选构造器首批两枚（`choiceCandidates.ts` 两枚确定性枚举器 + `handSelection.ts` 抽牌单点；`choiceSource/choiceTargetScope` **只在编译模型层**=第四次"接线≠可配"；零新词表、内置零转正）→ v2.7.3 自定义条件门槛谓词首批六度量（`skillConditions.ts` 全库唯一实现、三处消费同口径、fail-closed、条件不入 EngineState/录像、缺省逐字不变=第五次预防针；resolver 独立再求值新增 `SKILL_CONDITION_UNMET`）→ v2.7.4 收敛核验收官（本表 §F 两节新立：**装备损失语义三路裁决**=零代码裁决 + 一枚负例钉，与建议书第 8 项**九槽积木语法表**；本建议书与 GPT 四检）。**终点线事实**：Effect 原语恒 **9**、触发键恒 **10**、canonical 动作恒 **13**、账本 **40 runtime / 129 诚实跳过**、`battleReport` **39 行**；测试 **491/53 → 532/56**；**2.7 五刀全为非内容刀 ⇒ B9 `{"1":117,"2":183}` 逐字五连**（每刀同 seed 两轮 cmp 全等、won=300、VIOLATIONS=0、逐势力五锚）。**收官口径（承 v2.6 三检 Q1，禁写"量产能力完整/后续可直接批量转正"）**：2.7 完成的是**"治理与词汇层一个真实周期的验证"**——证明"发现呈现层污染事实 → 立契约表 → 回归锚 → 真机复验"与"缺口识别 → 十二格表 → 只接线不带内容 → 编译诚实降级"两条方法在既有链上可外推；剩余内容的瓶颈已从"引擎没有这个词"移到"这个词没有录入面 / 没有真实需求首现"，**这不等于任何一条未转正技能都能无新增能力直接落地**（GPT 四检 Q1 补充读法，防被简化成"以后补 UI 就能转正"：瓶颈**重心**迁移了，瓶颈**类型**并未收敛为单一的"补录入面"——三类须分开估工：已有能力缺录入面=纯 UI/Excel 工程／已有词汇缺 canonical 语义能力=次数·冷却一类／当前语法模型本身表达不了=链式"若/则"一类）。

**2.8 候选序（按"语法表缺口 × 真实需求首现"排；§F 九槽表是本序的事实底座）**：
1. **门槛槽录入面（语法表第 3 槽=当前唯一"引擎会算、但一句也录不进去"的缺口）**——v2.7.3 的六度量在引擎侧可用，缺的是把它**从数据层一路接到界面**。~~纯 UI/Excel 面刀：编译模型、`skillConditions.ts`、三处消费零改动~~ ⇒ **2.8.1 版本审计纠正（行号级证据）**：该表述只对 `skillConditions.ts` 与三处消费成立，`conditions` 目前**只活在编译模型层**（`src/skills/dataTypes.ts:116`），数据层录入类型 `src/data/generals.ts:169 interface Skill` **无此字段**、`src/skills/skillCompiler.ts` 全文**零** `conditions` 字样、`src/components`/`src/store` 零命中⇒本刀范围=**四处**：① 数据层 `Skill.conditions?`（旧 localStorage 缺字段=零迁移向后兼容）② 编译器映射（不认识的度量/算子走 `getCompileDiagnostics` 诚实拒录，**不静默降级**）③ 编辑器条件区（六度量 × 五算子 × 三主体，AND 语义、fail-closed）④ Excel 形态（第七列 vs 子表=岔口，牵动既有六列严格列序钉与版本判别）。`skillConditions.ts` 与三处消费仍零改动。工时按"录入面 + 编译映射"估，不按"补个下拉"估——这是 §12-42③"界面上有下拉≠引擎有该能力"的**反向版本：引擎有能力≠数据层有承托**。录错条件=变相发明玩法，须与编译诚实通道联动作显式提示。2.5/2.6/2.7 三轮"接线≠可配"预防针的**收口刀**。 ⇒ **v2.8.3 刀 B 已闭环（四处全部落地，见本节 §F「发动门槛录入面」与 §12-46）**：①②③④ 逐条兑现，**一处形态与当初设想不同并如实登记**——当初写"不认识的度量/算子走 `getCompileDiagnostics` 诚实拒录"，实际把**拒录点前移到录入侧**（`skillGateText.ts` 解析不出即进 `unknown`，编译器只接受已结构化的条件，因此根本不需要新增诊断码）。理由：门槛是**用户手写的自然语言**，编译器看到的应是结构化产物；在编译期报"这句没看懂"会把用户身份丢掉（报不出"谁的哪个效果的哪一句"），而录入侧拒绝可以逐条点名并常驻显示。
2. **候选域与主体轴扩面（语法表第 4/5 槽）**——现候选域只有场上将领/手牌两型，牌堆顶拣选、自身装备、"按势力/按座位筛选"的第三主体轴均无承载；内容拉动、逐刀单议。观星/心战/自书/秘置（牌堆顶五候选决策面）、遗计/好施（选目标发放）等**转正须各自需求首现 + 上表补行 + 忠实度 A/B/C 门 + 四件验收，严禁借刀批量**。
3. **次数/冷却槽（语法表第 8 槽=每局限一次 3 条 + 觉醒技同属深水区）**——深水区首因不是 UI，而是"这局还用没用过"**必须成为新的 canonical 游戏事实**（进 EngineState ⇒ 录像/回放/对账四路径与 D-2 口径全部重锚，且必然换基线锚 B9→B10=内容刀）。真实需求首现前先补十二格表，不预铺。
4. **链式"若/则"结构（语法表第 9 槽=承接池①第二步，本表最大一处结构性空缺）**——现形态是单层乘积、效果只按数组序依次结算，无"前一效果失败则后续中断"的分支语义。这是"积木自由拼接"愿景的真正门槛，**必须先立十二格表**（失败中断语义、与条件槽的分工、链内 choice 嵌套的禁令与理由、可复现性）再动编译器；语法表评审通过前不动 `skillCompiler`。**（v2.8.1 已兑现前置：§F「链式"若/则"组合契约表」已立，十二轴 + 失败语义 + 链内 choice 禁令 + 活例三格齐全，且自带"零实现、零实例、不可被触发验证"的如实声明与本项的换锚预告。⇒ 本项状态从"先立表"推进到"表已立、等真实内容需求首现才动编译器"；编译器与录入面一刀未动，符合"语法表评审通过前不动 `skillCompiler`"。）**
5. **多槽 pendingChoice**——单槽撞账现状=事件照记、状态不动（§F choice 表 Condition 格）；真实双开需求首现（如遗计+好施同回合）时**先改表再动刀**。
6. **roomId 真机面（§12-39⑦）**——store 建房链从未把房间名登记为 canonical 事实，修它=新增游戏事实（同第 3 项的代价类别）；等录像按房间归档/多房管理等真实需求。
7. **CARD_LOST 装备扩面（本表 §F 裁决的翻转条件）**——施工图五条已备好（via 值池扩三、`cardFilter==='equipment'` 改集合判定、派生仍在 `enqueueDerivedConsequences` 单点、重入评估、内容刀流程）；触发条件=有技能真的需要"装备被伤害磨掉/随主阵离场"这条语义，否则维持沉默。
8. **内容量产主刀（168 条档2 剩余）**——按语法表逐条核对后再排批；七槽已闭合说明多数剩余缺口落在第 1、2 项，**每刀皆为内容刀 ⇒ 换基线锚**，逐刀走忠实度门与四件验收。
9. **平衡监控挂线（GPT 二检 Q5 口径延续，不升格）**——2.7 五刀零玩法，胜席线无需更新；下一次更新点=首个 2.8 内容刀（B10）之后策略档两档复测。
10. **官方 / DIY 判别根 + 普通模式简化编辑器（v2.8.1 新登记，用户 2026-09-27 定口径：开发者模式今后的**最大作用**就是划这条界）**——需求原话：非开发者模式下的将领改动/新建**只能涉及 DIY 将，绝不允许触及官方将**，故必须先有"这张将是官方还是 DIY"的**可校验根据**。审计事实（三条，均为本刀前置）：① **判别根当前不存在**——`General` 只有 `identity?`，全库唯一 DIY 痕迹是 `src/domain/identity.ts:13 DIY_IDENTITY='DIY'` 这个靠身份值猜的弱代理，无任何 `isOfficial`/`isDiy` 字段；② **门禁只在 UI 层**——编辑器入口由 `developerMode` 控制（`MainMenu.tsx:107`、`Codex.tsx:115`、`DeveloperOverlay.tsx:5`），而 `generalEdits`/`skillEdits` 落 localStorage 且**无来源标记**⇒ 一旦在开发者模式改过官方将，退出开发者模式甚至刷新页面（`developerMode` 不持久化、刷新即回未激活）之后，**那次官方将改动照样被消费**，"约束"写不成校验；③ 因此本项顺序不可颠倒：**先定判别根（推荐派生判定：是否在册官方表内⇒零数据改动、旧档天然不会被误判成可改）→ 给编辑产物打来源标记 → 才谈普通模式的简化编辑器**。**同刀的安全侧铺垫（✅ v2.8.1 已落地并验证：读数以 §9 该轮验证条与 §12-44 为准）**：开发者模式口令改摘要制（源码/产物零明文）+ 删除免口令旁路 `setDeveloperMode` + 进入要口令、退出不要口令——把"谁能进这扇门"先收紧，才轮到"进去以后能改什么"。
11. **联机内容与 DIY 互通双轨（v2.8.2 登记，用户 2026-09-27 拍板"两条都要"；同日更正＝**两轨解耦**：轨一随远程联机一起做，轨二作为**独立功能**先立项先做，本项至今零实施）**——解决"玩家之间将领信息不对等"（DIY 将池只存在于各自浏览器 localStorage，跨机不可见）：
    - **轨一＝房主权威（"开房间的人当家作主"）**：对局真相由房主机器计算，客人只发"我要干什么"（canonical `GameAction`）、只收"局面长什么样"（`EngineState` 快照）。**骨架已存在且形态正确**：`network/types.ts` 的 `ServerActionPacket`/`StateSnapshotPacket` + `StateSerializer`（`NETWORK_SNAPSHOT_VERSION=1`、`structuredClone`、版本不符即拒）就是这套动作进/快照出的雏形。此轨下 **DIY 内容只需存在于房主机器**，客人无需持有同款卡池⇒ 信息不对等在主路径上自然消解。剩两处真实缺口：① **快照今日已"顺带"把完整定义带给客人**——`players[].generalPool` 装的是**整份 `General` 对象**（`setup/runtimeSetup.ts:31` 声明类型、`store/gameStore.ts:228` 把征召结果整体写入玩家态、`gameStateAdapter.ts:85` 原样透传、`StateSerializer` 再 `structuredClone`），所以名字/称号/技能载荷本就随快照到了客人端。但**这是便车，不是契约**：`EnginePlayer`/`EngineState` 的 `hand`/`generalPool`/`fieldGenerals`/`deck` 全是刻意数据无关的 `unknown[]`（`GameState.ts:32-60`），没有任何测试钉住"快照必须自足到能独立渲染一张卡"，一次呈现层字段瘦身就会把客人端画面静默打空——正是本表 C-4「事实 vs 呈现」契约尚未覆盖的联机向空白。**该刀要做的不是新造下发通道，而是把这条便车升格为契约**（定义"渲染一张卡所需的最小呈现面"+ 回归钉：客人端清空本地卡池仍能完整渲染）；② 房主即权威⇒ 客人必须信任房主端不改牌，反作弊/审计面为后置议题（同一份快照既然自带完整定义，客人端也具备了"看得见、但改不动"的审计起点，可顺势用作校验锚）。
    - **轨二＝内容包互换（玩家各自 DIY 将池互通）——用户 2026-09-27 更正口径：本轨不与房间/进房绑定，作为一个独立功能先立项先做**（原登记里"内容指纹一致才允许开局、不一致即显式拒进房"那句**作废**，那是我把"互通"顺手绑到联机场景上的过度设计，不是您的需求）。改后的形态：**导入/导出一个 DIY 内容包文件**，包自带**指纹与来源标记**，装入本机时**核对与提示由安装动作自己负责**（装成功=可用，装不上=说清为什么装不上，绝不静默吞掉或半装），**开不开房、跟谁开局与它无关**。这样它先独立产生单机价值（备份、换设备迁移、分享作品），将来联机真要"互通"时它已经是现成的一块，无需为联机重做。此轨**不依赖网络层、也不排在对战房主权威之后**；它唯一的前置仍是本表第 10 项（官方/DIY 判别根）——分不出"哪些是玩家做的"，就无从决定包里该装什么。**真实起点**：`skills/SkillDataRegistry.ts`（Map 式登记类，零实例化）+ 已被 v2.8.2 删除的 `importer/PackageImporter`/`ImportPackage` 是这个想法的**空壳旧迹**——空壳不顶用（`validate()` 只看 `pkg.version` 真假、`import()` 直通返回），但想法本身有效，届时按正式契约重建，勿沿用旧形态。
    - **两轨的关系（随上条更正而解耦）**：轨一（房主权威）属联机本体、排在本表第 10 项之后；轨二（内容包）= **独立功能刀，可在联机立项之前单独实施**。`network/`／`room/`／`server/`／`session/` 脚手架因**轨一**而**刻意保留**（与本刀"删零引用旧架子"不矛盾：那些是死范式残留，这些是已核准需求的地基）。

**GPT 2.7 四检结论（2026-09-26 执行完毕；全文归档仓库外 `G:\THREE_KINGDOMS\GPT_DISCUSSION_2_7_4_REPLY.md`，回复 2834 字、双端归一哈希 2285867755 逐字相符）**：
- **Q1（收官表述）＝同意，采纳其防误读补充**。四检确认"治理/词汇/事实契约/候选生产/条件谓词已形成可重复周期"的定性准确、并明确保留我们的刹车片句；但提示"瓶颈移到录入面/需求首现"容易被后续协作者读成"以后补 UI 就能持续转正"，实际 2.7 同时证明障碍有**三类**（已有能力缺录入面／已有词汇缺 canonical 语义能力（次数·冷却）／当前语法模型表达不了（链式"若/则"））⇒ 已把该三分法写进上方总结句。
- **Q2（九槽表）＝成立，采纳"语法槽 ≠ 实现原语"的分层判语**。四检建议"代价/消耗"在**语法上独立成槽、实现上不要求新增 Effect 原语**，并给出理由：代价牵动可发动性、choice 合法性、结算顺序、失败处理与事件链（要回答"何时支付、支付失败怎么办、choice 前还是后、是否产生事件、支付后能否取消"），完全藏进 Effect 参数会让"语法上没有这个词"复发；若坚持九槽则把"效果+参数+代价"作复合槽但须在表里标出 cost 位置与时序 ⇒ 记为 §F 九槽表的读法约束（本刀不动表结构）。
- **Q3（装备损失三路裁决）＝暂时认可，采纳其判据改写**。四检不建议把判据写成"只有技能拆才算 `CARD_LOST`"，正解=**事件描述的是 canonical machinery 是否需要知道这个因果事实，而非物理上是否发生消失**；并警示不要把 `CARD_LOST` 读成泛化"卡牌消失"（否则第二、三路会被"完整性"重新接进来）⇒ 已在本表 §F 裁决段补"判据的正写法"，三路行为与负例钉零改动（改措辞不改语义）。
- **Q4（2.8 候选序）＝采纳"④ 提前到 ③ 之前"**，并采纳其验收线三句作本建议书总闸：**只增加"表达已有引擎能力"的刀可优先；增加 canonical 事实面的刀必须先证明真实内容需求；改变语法组合模型的刀必须先立契约再扩 UI/内容**。四检理由：④ 是语法/编译分组层（决定"技能语言怎么被解析成运行结构"），③ 是 canonical state 层（一开工即扩 EngineState + 事件/录像事实 + 四路径重锚 + 回放兼容负担），上游组合模型未定就堆 ③ 会在错误模型上继续加码。①②⑧ 判"该做"（②须限定为真实内容牵引的最小扩面、勿把"候选域通用化"当目标；⑧ 应在语法缺口确认后开工而非无条件全量）；⑥⑦⑨ 判"暂不升格"（⑥ 无引擎语义需求且无谓扩大对账面；⑦ 已有裁决+负例钉，无新需求不重开；⑨ 维持不升格）。
- **执行序（采纳 Q4，编号维持不变以保住 §F 交叉引用）**：**① 门槛录入面 → ② 候选域/主体轴最小扩面 → ④ 链式"若/则"契约 → ③ 次数/冷却 → ⑤ 多槽 pendingChoice → ⑧ 剩余内容量产**；⑥⑦⑨ 暂不升格。**四检不阻断 v2.7.4 收官**。**（v2.8.1 进度注：④ 的"先立契约"半步已完成=§F 链式十二格表已立，编译器仍未动，剩余半步=等真实内容需求；① 的范围经审计由"两处"更正为"四处"⇒ 成本上调、顺序不变；新登记 ⑩（官方/DIY 判别根）插在 ⑧ 之前还是之后待用户口令，其硬前置=判别根先定，否则"只能改 DIY"写不成校验。）**。**（v2.8.2 进度注：新登记 ⑪ 联机内容与 DIY 互通双轨（房主权威 + 内容包互换），用户拍板两条都要；**同日更正＝两轨解耦：轨一随远程联机立项，轨二（内容包导出/导入/校验）作为独立功能可先做、不与房间绑定**（原"指纹不符拒进房"作废，见第 11 项·轨二与 §12-45⑨），排在 ⑩ 之后且**不塞进 2.8 内容序**（联机=新命题，须单独立线）；同刀做旧脚手架清理——`importer/*`、`data/registries/*`、`data/types.ts`、`data/examples/caoCao.json`、`skills/dataSkillExamples.ts` 五类"一卡一记录"死范式残留已删（零 import、零包内字节），而 `network/`／`room/`／`server/`／`session/` 与 `skills/SkillDataRegistry.ts` 因 ⑪ 而刻意保留。清理同时更正两处文档失真：本节 B 表原 `importer/* + components/xlsxSecureReader` 行把**测试文件名误记成了模块名**（`xlsxSecureReader.ts` 从不存在），且 Excel 真实住所是 `SkillEditor.tsx`+`skillExcelFormat.ts` 而非导入器。）**。**（v2.8.3 进度注：① 门槛录入面**已销账**——四处全部落地、非内容刀、对 B10 逐字，详见本节「发动门槛录入面」与 §12-46；该刀顺带把"选择其一"的门槛登记为**结构性表达不了**（一格一槽），并把 Excel 侧的"读不懂"纪律推到了触发栏（`readTriggerCell` 严格读法，修掉一条把门槛放宽的真 bug）。序中 ② 仍未动、④ 仍停在"表已立等需求"。）**
