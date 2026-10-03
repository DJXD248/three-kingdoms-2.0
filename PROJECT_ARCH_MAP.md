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
| `skills/skillExcelFormat.ts`（313 行，2.8.4 时点）、`skills/skillGateText.ts`（196 行，2.8.4 时点）、`SkillDataRegistry.ts` | Skill | Excel 效果列组导入导出（**v1=3 列／v2=6 列／v3=7 列：+「门槛」**，宽度靠表头正则探测、导出恒 7 列、旧格式照旧兼容）+ 门槛大白话↔结构化条件唯一互译（读不懂逐条进 `unknown` 上报，见 §F 门槛录入面）+ 数据登记（2.2.17：`SETTLEABLE_RUNTIME_TYPES` 四类型，编辑器"暂未接入结算"标注随数据源消失）**＋用户可见词表的唯一住所**（`runtimeEffectTypeLabels`/`runtimeTargetLabels`/`GATE_SUBJECT_LABELS`；旧行话只进不出＝`LEGACY_TYPE_LABELS`/`LEGACY_TARGET_LABELS`/`SUBJECT_ALIASES`，见 §F 词汇替换段） | CANONICAL（Excel 格式与门槛语法）／**未接线（`SkillDataRegistry`：Map 式技能登记类，仅经 `skills/index.ts` 再导出，全库零实例化，2026-09-27 grep 确认）** | — | request/进程级 | PURE | UT（`skillExcelFormat.test.ts` 含 v3 往返钉与"旧词只进不出"钉、`skillGateText.test.ts` 15 例） | `SkillDataRegistry` 刻意**保留不删**：它是未来"内容包互换"刀的天然挂载点（见 G 节联机双轨），删了再写回属无谓 churn；立项该刀时须先确认它仍是合适形态，否则替换 | 2.2.0（2.8.3 加门槛列与互译件；2.8.4 词表换大白话＋旧行话别名） |
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
| 6 | 效果原语 | `effects[].type`（**10 枚**，第 10 枚＝`DUEL`·2.8.20；其中 `DUEL` 属**无数值可填**一类＝`VALUELESS_RUNTIME_TYPES`） | `RuntimeEditor.tsx` 类型下拉（与 `SETTLEABLE_RUNTIME_TYPES` 同源） | `createSkillEvents` → EventProcessor 唯一结算 | 无"代价/消耗"型原语、无"若未达成则…"型分支效果 |
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
| 8 | 留空语义 | 显式 `''`=无身份=不锁（仅开发者显式清空可得）；`undefined` 字段=回退 name。**（v2.8.10 澄清，用户 2026-09-29 指出"永不锁"有歧义）"不锁"是这张卡当前身份状态的判定，不是永久豁免**：`identity` 属可编辑内容字段（§H1：可以从有变无、也可以从 A 变 B），`lockKeyOf` 每次读**当时**的身份 ⇒ 日后给它填上身份，它立刻重新参与锁。留空也不改变"这卡是谁"（编号 `id` 才是身份，冻结字段只有 `id`/`source`） |
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

**B10 换锚声明（读数已实测回填）**：本刀为 2.x 线首个玩法分发规则改动且 AI 直建池同步上锁（同模板多份消失=装配内容变化），**基线必换 B9→B10**；B9 `{"1":117,"2":183}` 全部读数保留于 §12-33①/35 作历史锚。B10 实测（定稿树 `npm run ai-battle -- --games 300 --seed 1` 两轮逐字一致，2026-09-27）：胜席 **`{"1":112,"2":188}`**，won=300、exhausted=0、VIOLATIONS=0；逐势力小账（出场席/胜/胜率 · 登场/阵亡/死亡率 · 攻击/击杀/击杀率）=**魏** 116/56/48.3% · 193/138/71.5% · 13/1/7.7%；**蜀** 136/71/52.2% · 205/132/64.4% · 14/2/14.3%；**吴** 126/55/43.7% · 160/115/71.9% · 4/0/0%；**群** 126/70/55.6% · 206/116/56.3% · 16/1/6.3%；**晋** 96/48/50.0% · 134/95/70.9% · 4/0/0%。**换锚因果如实读**：出场席分布与 B9 逐字同（116/136/126/126/96=官方池零同势力同名⇒抽席面空转，见上格），胜席 117/183→112/188 的漂移来自 seeded 池构造代码路径变化（filter 增锁判定+去重 filter 迭代）引起的 shuffle RNG 游标位移，**非玩法规则生效的实质信号**——这正是「同势力同名唯一对现有内容空转」的数值侧印证。v2.8.0 起非内容刀对 **B10 逐字**。禁止为保 B9 回退 AI 池锁。〔**口径更新（v2.8.16）**：那句"对 B10 逐字"自 v2.8.0 生效至 v2.8.15；练习技能注入默认改 0 之后，官方池那条命令的读数改立为 **B12**，**现行硬锚＝B12 与 B11 同时逐字**，锚名账本见 §H10。**口径更新（2026-10-01 审计更正轮）**：B12／B11 又止于 v2.8.21（#71 执法刀＝玩法级变化，两锚读数漂⇒值变即换名），现行硬锚＝**B13 {"1":104,"2":196} 与 B14 {"1":108,"2":192} 同时逐字**，全表与换锚记录见 §H10。〕

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
| 7 | Effect | 链的每一步=既有 **10 原语**（2.8.20 起，第 10 枚＝`DUEL`）之一的实例，本表不新增原语；步与步之间只允许"顺序 + 分支"两种关系，不含新算术（"伤害翻倍"一类仍属第 7 槽参数面） |
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
| 与"选择其一"的分工 | 一张 choice 编译定义只有一个 `conditions` 槽 ⇒ 逐效果门槛**结构性表达不了**。裁决=**带门槛的选择组整组不编译**并逐条报 `CONDITION_CHOICE_UNSUPPORTED`，绝不解禁其中"看起来无条件"的那几条；用户口径本轮明确"选择其一暂时不考虑、暂时没有需求"。**⚠ 本条已被 v2.8.11 刀2 撤销**（用户 2026-09-29 明确要做，且给了"两级门槛"这条结构性解法：整组门槛占定义级那一槽、逐项门槛挂在各自效果上）。按"历史日志记录当时认知"的纪律原文不回改，正确读法见本节下方「「选择其一」的两级门槛」小节；`CONDITION_CHOICE_UNSUPPORTED` 这枚 skip 原因已随之从代码里删除。 |
| Excel 形态 | 效果组 v1=3 列（标注/触发/描述）、v2=6 列（+效果类型/数值/目标）、**v3=7 列（+门槛）**；宽度靠表头正则 `/^效果\d+门槛/` 探测而非硬数；导出恒 7 列（1-based 起始列 `12+7n`，门槛在 `18+7n`）；旧 3/6 列文件照旧导入＝该效果无门槛；**整组只写了门槛、没写是哪个效果 ⇒ 不凭空造效果**（返回 `orphanGate` 交回导入面点名报告——原设计"门槛栏单独有内容也算一个效果组"会在编译侧产出一条只有条件、无可结算内容的空效果，已由复算后的裁量改判，见 §12-46②⑥）；表头单元格挂 `GATE_SYNTAX_HINT` 批注。**下拉框列号、列宽数组、批注位置三处必须与宽度同频**（§12-46⑤）。 |
| 触发栏严格读法 | 新文件级函数 `readTriggerCell(s)`（`skillExcelFormat.ts`）＝**解析后必须反写成与原句逐字相同的标准写法**才算看懂，否则该栏一律不填、原句进常驻清单并列出全部可认写法。编辑器「照这个填」框与 Excel「触发」栏**共用这一条读法**。修的是复算闸抓出的真 bug：旧 `strToTrigger` 只认主名，用户写「受到伤害后→攻击」时**细分被静默丢弃**⇒本意"仅攻击伤害"被**放宽**成"所有伤害"（"读不懂却装作读懂"的最坏形态）。测试钉死"下拉里每一个选项都必须通过严格读法"，故该读法不会把自家选项挡在门外。 |
| 数据层承托 | `SkillEffect.conditions?` 类型本体在 `src/data/generals.ts`，`src/skills/dataTypes.ts` 仅 re-export ⇒ 保持 skills→data 单向依赖箭头；旧 localStorage 缺字段＝零迁移向后兼容。 |
| 编译 | `skillCompiler.ts` 逐效果**纯透传**（编译期零求值、零改写），`conditions: []` 归一为 `undefined`，定义形状与 id 一字未变 ⇒ 官方内容今日零门槛，B10 理论上必逐字（实测兑现）。 |
| 消费端 | 触发路 `SkillTriggerBridge.buildCondition`（10 枚触发键同一道闸）与决策路 `turnEndSkills` 候选枚举 + `TurnEndSkillResolver` 再求值，两路共用同一实现；**本刀未动任何一处**。 |
| 真机证据 | 本地 dev server 单实例、**复算闸修完之后的那一版代码**（非修复前快照）：门槛框打字→实时回显「看懂了：手牌≤2 且 牌堆≥5」；残句「攻击范围内没有马」→就地红块＋同时显示「没有门槛」；切「选择其一」并留着门槛→红字当场出现；严格读法两景（半截「受到伤害后→攻击」被拒并列可认写法／写全「受到伤害后→攻击伤害」两个下拉同步填上）；真点「💾 保存修改」后从 store 取回 `conditions`（`HAND_COUNT LTE 2`）与 `trigger{onDamageTaken, attackDamage}` 逐字；**现场生成 26 列（=7 列×2）的 v3 工作簿、经页面真实 `<input type=file>` 上传导入**⇒常驻清单恰好点名 3 条（半截技能级触发／只写门槛的孤立效果／读不懂的门槛原句），而关羽那条可读门槛的两个条件全部结构化入库并带 runtime 摸牌类型。全程未触发任何保存/下载弹窗；如实披露两处=开发者模式经 dev-only 钩子 `window.__TK__.useGameStore.setState({developerMode:true})` 打开（口令按 v2.8.1 设计不为我所知、不进任何载体；该钩子写的是与设置页同一个布尔位、非玩法旁路），以及事后清理（两个编辑 localStorage 键删除、刷新回主页、夹具与生成脚本删除、dev server 用完即杀并复查 5173 无 LISTENING）。 |
| 测试面 | 579/62 → **617/64**。取证分层=纯解析（`skillGateText.test.ts` 14 例，含嫌疑词表反读边界）／导入面逐条报告（`skillExcelParsers.test.ts` 8 例）／Excel 往返与严格读法（`skillExcelFormat.test.ts` v3 段重写）／编译透传（`skillCompiler.test.ts` 5 例）／**组件级**（`SkillEditor.runtime.test.tsx` 4 例：打字→回显→存 store→编译器带条件）／**零 mock 真引擎闭环**（`skillPipeline.test.ts` 1 例：门槛文本→`parseGateText`→真 `GameEngine` 两次攻击，手牌 1 摸 1 张、手牌 2 零技能摸牌）。最后这例补掉复算闸指出的取证缺口：`skillConditions.test.ts` 仍走 `vi.mock` 编译缝，而门槛录入面落地后该 mock **已不再必要**（保留它的现由=逐条钉两路求值语义、不依赖录入面）。 |
| 录入面还**没有**的东西（待口令，不算本刀欠账） | 支付代价、后续效果、数值变化+持续生效（＝面板值由引擎推导的落地通道）、本次伤害增减、任选目标、区域目标+不可空发、决斗流程、回合限1次记账、~~"选择其一"的门槛~~ ⇒ **✅ v2.8.11 刀2 已销账**，见本节下方「「选择其一」的两级门槛」、~~大白话词汇替换（观顶/置牌入堆/剥离装备/被作用者）~~ ⇒ **✅ v2.8.4 刀 C 已销账**，见本节下方「大白话词汇替换」。 |

### 大白话词汇替换（v2.8.4 刀 C，§F「发动门槛录入面」待口令清单第 10 项销账；**非内容刀 ⇒ 硬锚=对 B10 逐字一致；纯呈现层文案，零玩法语义**）

用户点名要换的四个自造行话，在**录入面与卡面**全部改成大白话；**旧词只接受、绝不写出**（他手上的旧 `.xlsx` 与旧手填必须照样读懂）。

| 词 | 旧（v2.8.3 及更早） | 新（本刀起唯一写出形态） | 出现面 |
|---|---|---|---|
| EQUIP_STRIP | 剥离装备 | **拆掉装备** | Excel「效果 n 类型」列值＋下拉、编辑器类型下拉、预览文案「拆掉 N 张装备卡」，另含**卡面描述一处**（见下方「唯一真值源」行） |
| REVEAL | 观顶 | **看牌堆顶** | 同上三处（预览沿用既有的「观看牌堆顶 N 张」，本就是大白话） |
| DECK_PLACE | 置牌入堆 | **放回牌堆** | 同上三处（预览「把 N 张手牌放回牌堆」） |
| TARGET | 被作用者 | **目标** | Excel「效果 n 目标」列值＋下拉、编辑器目标下拉、门槛对象词（`GATE_SUBJECT_LABELS`）、门槛提示语 `GATE_SYNTAX_HINT`、门槛框回显 |

| 轴 | 实况（读代码可复核） |
|---|---|
| 唯一真值源 | 词表只住在 `skillExcelFormat.ts`（`runtimeEffectTypeLabels`/`runtimeTargetLabels`）与 `skillGateText.ts`（`GATE_SUBJECT_LABELS`）；Excel 导出单元格、Excel 下拉校验串（`RUNTIME_TYPE_LIST`/`SETTLEABLE_RUNTIME_TYPE_LIST`/`RUNTIME_TARGET_LIST`）、编辑器下拉、门槛回显、提示语**全部由这两张表派生**⇒改词只改表，不可能出现"界面一个词、导出另一个词"。**卡面描述是第二处**：`src/data/generals.ts:296`（典韦·强袭「剥离伤害目标的一张装备卡」→「拆掉目标的一张装备卡（放进弃牌堆，他的护甲值相应减少）」）——这条是**唯一**在卡面文本里用了这四个词的官方内容，其余卡面本来就没用。**（v2.8.18 更正：按用户裁决第 4 句「"装备"这个词：把技能描述改成"军备"」，卡面描述这一处已改为「拆掉目标的一张**军备**卡」，同批改掉的还有枭姬／崩坏／DIY 夹具「样·缴械」与触发细分词 `cardSubLabels.equipmentLost`＝「失去军备牌」；效果**类型名**「拆掉装备」按裁决范围保留，读入侧旧词只进不出。玩家可见词汇的现行总账见 §H11。）** |
| 兼容机制（本刀的核心约束） | 新枚 `LEGACY_TYPE_LABELS`/`LEGACY_TARGET_LABELS`（Excel 侧）＋ `SUBJECT_ALIASES` 内保留 `被作用者`/`受击者`（门槛侧）。解析顺序=**枚举名 → 现行标签 → 旧行话**；反写（结构→文本/单元格）**只走现行标签**。⇒「旧词进、新词出」是单向门，不是一把双头刀。 |
| 为什么必须留旧词 | 用户的 `.xlsx` 源文件是他自己维护的长期资产，v2.8.3 之前导出的表里写的就是这四个旧词；改名若无别名=**他的老文件一夜之间全部导入即失效**，而且失效形态是最坏的那种——静默读成"没有类型/没有目标"，技能照样导入但效果不再结算。 |
| 防漂移钉 | `skillExcelFormat.test.ts` 新例「v2.8.4 词汇替换：旧行话只进不出」=① 四张写出的词表含新词、不含任何旧词 ② 三个下拉串同样不含旧词 ③ **下拉里每一个选项都必须被自家解析器认得**（承 v2.8.3 `readTriggerCell` 的同款纪律）；`skillGateText.test.ts` 新例=旧写法「被作用者体力=1／受击者手牌>自身手牌」解析结果与新写法逐字相同、且**反写出来一定是「目标…」**。提示语漂移钉同时加强：`GATE_SYNTAX_HINT` 必须逐一含住 `GATE_METRIC_LABELS` 与 `GATE_SUBJECT_LABELS` 的每个值，并把「写法→结构→写法」逐字闭合一起钉进去（SELF 不写前缀这一条也从提示语侧钉死）。 |
| 刻意不扩面（如实登记） | 只换**用户点名的这四个词**。同一张表里还有别的行话（「发放」「获得护甲」「场上将领」「本次伤害」「纯描述」）今日未动——它们不在点名的四条里，改词是产品判断不是技术判断，**不自作主张批量换词**。 |
| 真机证据 | dev 5173 单实例：① **现场生成一份 6 列（v2 形态）旧词工作簿**（三行魏将，效果类型分别写「剥离装备／观顶／置牌入堆」、目标分别写「被作用者／自身／目标」），经页面真实 `<input type=file>` 走完整上传链⇒顶部常驻清单**零条**（一句"没看懂"都没有），store 里三条分别落 `EQUIP_STRIP+TARGET`/`REVEAL+SELF`/`DECK_PLACE+TARGET`；② 打开同一将领进编辑器，类型下拉选项串=「未设定/纯描述/摸牌…拆掉装备/看牌堆顶/放回牌堆」、目标下拉=「自身/伤害来源/目标」，且刚导入的那条**选中的正是「拆掉装备」「目标」**（＝导出侧同一张表，反写必为新词）；③ 门槛框手打旧词「被作用者体力=1，目标手牌>自身手牌」→实时回显「看懂了：**目标**体力=1 且 **目标**手牌>手牌」。全程未触发任何保存/下载弹窗；开发者模式经 dev-only 钩子 `window.__TK__` 打开（口令不为我所知、不进任何载体），事后两个编辑 localStorage 键删除、夹具与一次性生成脚本删除、dev server 用完即杀并复查 5173 无 LISTENING。 |
| 锚与账面 | 五闸全绿（check 0 错／**619 例·64 文件**=617+2 新钉／coverage 快照 53.79/46.06/44.29/59.21（定稿树复跑 54.00/46.40/44.45/59.44）、地板 42/34/34/47 一律未调／lint 0 错·30 条遗留警告零新增／build **1,989.20 kB│gzip 583.25 kB**，较 v2.8.3 的 1,989.10/583.20=+0.10/+0.05 kB＝两张别名表＋两条新钉的代码面）。**B10 逐字**：`{"1":112,"2":188}`、won=300、exhausted=0、VIOLATIONS=0，逐势力小账魏 116/56·193/138·13/1、蜀 136/71·205/132·14/2、吴 126/55·160/115·4/0、群 126/70·206/116·16/1、晋 96/48·134/95·4/0 **与 §12-43① 逐格吻合**、同 seed 两轮除计时行外逐字全等。版本 2.8.3→**2.8.4**。远端 CI **CI #138**（run 36360219839）在 docs 提交 `3b62a85` 上全绿（两矩阵各 64 文件/619 例、lint 1m10s、build 46s、注解仅既有 14 条），推送经一次性代理 `127.0.0.1:10808`（直连超时），未写持久 git 代理配置。 |

**三道闸适用性（如实声明）**：本刀**非玩法刀**——不改对局结果、分发规则、技能语义或基线读数，改的是"同一件事叫什么名字"⇒ 第①闸（需求大白话复述）不触发；但因为它动的是**用户每天读的输入面词汇**且承诺了向后兼容，真机 E2E 照跑不豁免（上条），第③闸按"文案刀"口径以**上传旧词表真实导入**＋**B10 逐字**＋**下拉选项逐条可解析**三件替代证人交付。

**交叉引用（防后续会话照旧文抄回旧词）**：本节上方 v2.6.x 各十二格表的**标题与正文**（如「REVEAL 观顶原语」「DECK_PLACE 置牌入堆原语」）以及 §G 内容档里的「观顶/置牌入堆/剥离装备/被作用者」= **同一能力的旧简写**，自 v2.8.4 起录入面、Excel、卡面一律写新词，旧词只在 `LEGACY_*`／`SUBJECT_ALIASES` 两张别名表里活着（只接受、不写出）。读到旧简写时按新词理解，**不要**据此认为界面上还有这些词。

### 「选择其一」的两级门槛（v2.8.11 刀2，§F 门槛录入面待口令清单第 9 项销账；**内容/能力刀：动 `src/skills`+`src/action`+`src/rules`+`src/ai` ⇒ 硬锚=对 B10 与 B11 同时逐字一致；三道闸第①③闸全部触发**）

> 一句话：v2.8.3 让引擎的门槛**录进得去**，但"选择其一"这一类**整条拒录**（一槽装不下两级）。本刀按用户 2026-09-29 的四条裁决把它接完——**整组门槛占定义级那一槽，逐项门槛挂在各自效果上**，判定顺序"先整组、再逐项"不是新写的排序代码，而是这两个住所天然带来的先后。

| 轴 | 本刀实况（读代码可复核） |
|---|---|
| 两级住所 | **整组门槛**＝`Skill.conditions`（`src/data/generals.ts` 新可选字段）→ 编译落在 choice 定义的 `conditions` 槽（`skillCompiler.ts` 的 `choiceMode` 分支）→ `SkillTriggerBridge.buildCondition` 在**造任何选项之前**判；**逐项门槛**＝`SkillEffectData.conditions`（`src/skills/dataTypes.ts` 新可选字段）→ 随各自效果数据走 → `buildChoiceOptions` 逐选项判。**顺序由此导出**：整组不过⇒这一刻连选项都不存在，逐项门槛根本不参与（用户口径③）。 |
| 单效果定义并槽 | `mergeGates(groupGate, effectGate)`＝`[...整组, ...逐项]`，两侧皆空⇒`undefined`。求值本来就是 AND（全部成立才响），"整组在前"只影响可读顺序、不改语义。**没有整组门槛的单效果技能输出与 v2.8.10 逐字一致**（测试钉形状"不多不少一个键"）。 |
| 置灰可见（口径①，不藏） | 用户原话"技能信息本来就应该是对玩家完全公开的，不存在『免得泄露』"⇒不过门槛的分支**不删除**，保留 `label`+`events`，另标 `enabled:false` 与 `gateText`（`gateConditionsToText` 的大白话原文，如「手牌≥9」）。`GameBoard.tsx` 抉择窗：`disabled`＋琥珀色边框＋`grayscale`＋前缀 `✕`＋行内「（不满足：手牌≥9）」＋`title="不满足发动门槛：…"`。 |
| 灰项=不可点，但**合法动作面只有一处真值** | `legalActions.ts` 枚举 `CHOOSE_OPTION` 时跳过 `enabled===false` ⇒ probe／AI 司机／校验器与 UI 看同一份事实；`ChooseOptionResolver` 再兜一层：直接从 `EngineState` 读那一个布尔、回 `CHOICE_OPTION_LOCKED`，**绝不在决策时点重判一次世界**。 |
| 求值时点＝开窗那一刻并冻结 | 与 choice 既有的"延后结算"契约同源：`options[].events` 是冻结世界造出来的，`enabled/gateText` 也在同一刻定下；之后世界怎么变都不重算（否则同一份录像会有两种走法，违反 §F 链式表格 9 的"判定用到的事实必须在事件流里"）。 |
| 全灰⇒不开窗（防死桌） | `buildChoiceOptions` 末行 `marked.some(o=>o.enabled!==false) ? marked : []`，配合既有"空候选集不开窗"那条契约。**可选项为零的窗会把牌桌冻住**，这是结构性死锁，不是可接受的显示效果。 |
| 不白扣这一次发动（防空转） | `TurnEndSkillResolver`：`definition.choiceMode && effectEvents.length===0` ⇒ `rejected(SKILL_CONDITION_UNMET)`，**不写 activation 记账**。与上方定义级门槛"宁可不发，绝不空耗"同一口径；否则玩家点一下就是"发动了却什么都没发生"。 |
| AI 司机兜底换形 | `aiTurnDriver.ts` 原先"in-range index is always legal"硬点 0 号——门槛把 0 号置灰后**这条前提不再成立**：灰项被解析器拒⇒那一步零进展⇒死循环。改为取**记录顺序上第一个 `enabled!==false`** 的项，一个都没有则 `return false`（交给停滞守卫，绝不用点击硬撞异常状态）。 |
| 编译面撤销的东西 | `SkillSkip.reason` 删掉 `'CONDITION_CHOICE_UNSUPPORTED'` 整枚（连带 v2.8.3 的两条相关断言一并撤；与"新增 23 例"合起来才是账面净增 **+21**＝709→730，报"+19/+23"都不算如实）；编辑器里那条"选择其一暂时不能配门槛"的红字说明同步撤下。 |
| Excel 形态（**只新增一列**） | 新固定列**「技能门槛」**（0-based 第 11 列＝导出第 12 列）＝整组门槛；**逐项门槛的列 v2.8.3 就有**（效果组第 7 列「效果N门槛」），本刀**没有**再加效果级列——登记这条是为了防止后续会话把"增加列"读成两组都加。效果组起点改为**从表头认**：`detectEffectGroupStart` 匹配 `^效果1标注$`、认不出回退 11 ⇒ 旧 11 固定列文件照旧导入且整组门槛＝无；导出侧校验列与列宽同频右移 1（触发 14+7n／类型 15+7n／目标 17+7n，§12-46⑤ 同源）。读不懂的整组门槛**逐条原文进同一条 `parseWarnings` 通道**，绝不静默丢。 |
| 持久化 | `SkillEdit`（`editorPersistence.ts`）与 `skillEdits`（`gameStoreTypes.ts`）加可选 `conditions?: SkillCondition[]`；旧 localStorage 缺字段＝无门槛＝**零迁移向后兼容**。编辑器「切换为单效果模式」现在连带清掉整组门槛并写明理由：**不留"看不见的门槛"**。 |
| 锚为什么不漂 | 官方池 95 将**零 `effectMode:'choice'`、零 `conditions`**；仓库 DIY fixture（B11 输入）同样零 choice、零门槛；新字段全可选、`enabled/gateText` **只写在失败的那一项上**⇒ 无门槛的选择组形状逐字不变。⇒ B10 与 B11 同时逐字复现是**结构性后果**，实测兑现（下方账面）。 |
| 条件择一的形态（用户口径"走 A"） | 带门槛的选择组**照常弹窗**、不过的置灰可见——而不是"只把可选项列出来"（形态 B）或"全灰就不弹"（已在上一行按防死桌裁决）。 |
| 真机证据 | dev 5173 单实例、热座对局（**全程未用开发者模式**：本会话不持有口令）：以 `poolGenerals()` 路新建 12 张 DIY 样本将并 `distributeDraftGenerals()`⇒征召屏可见、`confirmDraft` 入池，登场后经「⚔️ 登场将领→消耗 4/4 张→确认位置→营地槽」把将领放上场面；触发后 DOM 实测＝**灰项照样在窗里**（`disabled=true`、`title="不满足发动门槛：手牌≥9"`、文案「✕ 选项2：摸三张牌（不满足：手牌≥9）」），点它**无任何状态变化**（窗仍开、`pendingChoice` 未清＝不是假成功）；点可选项则**真的结算**（手牌 0→1、`pendingChoice` 清空、`rngState` 未被二次消费）。控制台零 error。现场清理：12 张自建与两处编辑 localStorage 全部移除（`authoredGenerals:0`/`skillEdits:0`/`generalEdits:0`）、`resetGame()` 回主页。截图取证不可用（`NATIVE_BROWSER_VIEWPORT_UNAVAILABLE`·页面 `visibilityState=hidden`），故以 DOM 读数代替视觉读数并如实声明。 |
| 测试面 | **709 例／72 文件 → 730 例／73 文件**（新增 23 例、撤销 2 例 v2.8.3 的"整组拒录"断言；其中 4 例是第③闸复算当场查出的缺口补的，见下"复算修订"行）。分层=**闭环**（新 `src/skills/choiceGates.test.ts` 8 例：灰项带原因／灰项非合法动作且硬点被拒／可选项照常结算／全灰不开窗且不白扣发动／无门槛组形状与 v2.8.10 逐字一致／整组不过连窗都不开／整组过+逐项全过／整组过+只一项过）；编译并槽与两级各归各位（`skillCompiler.test.ts` 4 例）；Excel 整组门槛列（`skillExcelParsers.test.ts` 4 例：两级分开／写「无」＝没有／读不懂逐条报出／旧 11 固定列兼容；**导出侧** `skillExcelFormat.test.ts` 4 例＝复算补：整组门槛导出→读回→再导出逐字同串／空门槛导「无」读回＝无门槛／读不懂碎片逐条报出不静默／表头认效果组起点＋旧档回退 11）；录入面撤红字（`SkillEditor.runtime.test.tsx` 1 例）；**司机置灰绕行**（`aiTurnDriver.test.ts` 2 例：0 号灰⇒取 1 号、全灰⇒不动作）。 |
| 复算修订（第③闸查出、本刀内修掉） | ① **导出侧整组门槛零直接测试**（当时只有导入侧）⇒ 补上表 4 例。② **写法批注静默移位**：导出表头贴 `GATE_SYNTAX_HINT` 用的是 `header.findIndex(h => h.endsWith('门槛'))`，插入「技能门槛」后它**永远命中整组那一列**，逐效果列的批注被挤掉（ARCH 自警"批注位置须同频"处正中招）⇒ 改为 `forEach` 给**所有**以「门槛」结尾的列各贴一句（两列同一解析器、同一句写法提示，语义无歧义）。③ "不白扣发动"那条断言单独看是半恒真（`consumedSkills ?? []` 字段缺席也过）⇒ 补一枚会咬人的判据：**再点一次必须拿到同一句 `SKILL_CONDITION_UNMET`**——若第一次真被记账，第二次会换成 `SKILL_ALREADY_ACTIVATED`（该门在解析器第 56 行、门槛门之前）。 |
| 锚与账面（定稿树＝含"复算修订"那一小步之后） | 五闸：`check` 0 错误／`npm test` **730 例 73 文件全过**／coverage **56.72 / 48.66 / 47.76 / 61.85**（列序 Stmts/Branch/Funcs/Lines，地板 42/34/34/47 全过、exit 0、**地板一律未调**）／lint **0 错误**·29 条遗留警告同四类零新增／build 单文件 **2,021.74 kB │ gzip 591.22 kB**（实测精确 **2,021,743** 字节；较 v2.8.10 的 2,018.77/590.40＝**+2.97/+0.82 kB**＝并槽＋逐项求值＋置灰录入面与窗体的量级；版本号串在成品里仍只出现 **1** 处、旧串 0 处）。**同刀内两次读数如实留档**：修掉复算三点缺口**之前**＝726 例／coverage 56.72·48.66·47.71·61.83／build 2,021.75 kB·gzip 591.24 kB（2,021,753 字节）——差值全部来自新增测试与那处 forEach 改写，运行时结算路径未动。**两锚**（定稿树）：B10 两轮逐字全等（除 `avg=` 计时行 `cmp` 全等；won=300、exhausted=0、VIOLATIONS=0、胜席 **{"1":112,"2":188}**、五势力小账魏 116/56·193/138·13/1、蜀 136/71·205/132·14/2、吴 126/55·160/115·4/0、群 126/70·206/116·16/1、晋 96/48·134/95·4/0 逐格吻合 §12-43①）；B11（`--diy-fixture --skill 0`）复现 **{"1":108,"2":192}**、三势力小账（魏 217/121·339/197·33/2、蜀 193/87·275/186·12/1、吴 190/92·297/214·8/1）与 v2.8.9 登记逐字相同。版本 2.8.10→**2.8.11**。 |
| 本刀**没**做的（避免下轮误读为已完成；**本行写于 v2.8.11，读作当时事实——后续交付状态见每小句括号**） | ① **#42 技能提示模式 [完整]/[智能]** 未做（**已于 v2.8.17 交付**）——它要求"所有选项都不过门槛时也停下来问一次"，与上方"全灰不开窗（防死桌）"**正向冲突**，必须先设计一个显式的「都不发动」出口（一个真正的 canonical action），不能靠开窗硬凑；② **锁定技自动结算零运行时依据**——`Skill.forced` 与 `tag:'锁定技'` 在 `skillCompiler.ts`/`SkillTriggerBridge.ts` 里**没有任何消费者**（本刀 grep 核实后登记，见 §12-61），它是一整条待建链路而非 #23 的子项，另立待办 **#43**（**刀 1＝徽章读写/显示/核对已于 v2.8.19 交付；刀 2＝结算执法仍未做、会换锚**）；③ 链式"若则"（§F 链十二格）仍纸面（**v2.8.20 决斗刀落的是"顺序结算"，不是链式分支语义；§F 链表仍是纸面**）；④ `REVEAL/DECK_PLACE` 触发频次漏收（#39，**已于 v2.8.14 修**）与方案B（#38）照旧待口令。 |

**三道闸适用性（如实声明）**：本刀**是玩法刀**——它改变"某些选择窗在特定时刻开不开、哪些分支可选"，故第①闸（需求大白话复述＋四条口径逐条对账）与第③闸（独立会话重跑五闸与两锚、审"置灰是否被写成删除""全灰是否白扣发动""司机是否会死循环"）均触发；因新字段全可选且内置内容零门槛，硬锚按非内容刀口径同时立 B10 与 B11 两条，实测均逐字。**第③闸跑了两轮**（账面见上"复算修订"与"锚与账面"两行，全过程与第二条判据入 HANDOFF §12-63）：第一轮查出三处缺口并随修，第二轮在**修好的定稿树**上重跑＝五闸全绿、两锚逐字、三处修复验真。

### Excel 往返保真与「无变化」跳过（v2.8.12 修复刀，用户 2026-09-29 真机反馈 #45/#46/#48；**非内容刀 ⇒ 硬锚=对 B10 与 B11 同时逐字；零玩法语义**）

用户在开发者模式把**自己导出的表原样再导回去**，回执报"导入 95 名将领"、每张官方将凭空多一条 ✏️ 覆盖记录（退出开发者模式后还被算进"N 处改动已停用"）；顺着这条反馈在真机往返里查出第二个更坏的缺陷（#48）。三件都在 `src/components`/`src/skills` 的**录入面**，引擎与 `src/data` 一字未动。

| 项 | 实况与修法 | 住所 |
|---|---|---|
| **#45 无变化跳过** | 逐技能行格式（＝导出器产出的那个格式）与旧详细格式**都没有"写回去会不会真的变"这一步**，只有简单格式有 ⇒ 无变化也计"导入"并留下空覆盖记录。新增 `importEntryChangesNothing(edited, gEdit, skills)`，两条路径各挂一处，判定为真则计入 `跳过 N 名无变化`、**一个字节都不写** | `components/skillEditor/skillExcelParsers.ts` 尾部；调用点 `SkillEditor.tsx:322-326`（判定）＋`:345`（逐技能行）＋`:367`（旧详细格式） |
| 判定的**两条口径**（都是裁量，写下防被后人改回去） | ① **比较对象＝当前生效视图 `getEditedGeneral(g)`，不是仓库原始卡**——跳过回答的是"这次写入会不会改变什么"。由此产生一条**已登记的局限（#47，待裁）**：解析器算"要改哪些字段"仍相对原始卡，故把单元格改回原始值**撤不掉**已有覆盖记录，这条按"无变化"跳过而非假装导入成功，由特征测试钉住真实口径。② **只在写得动时才认无变化**：`mayEditGeneral(id) && …`，权限被拦的行照旧进"拒录"名单——**"无变化"绝不能盖掉"读不了写"的真话** | `SkillEditor.tsx:326` |
| 归一化（不比这些就永远不相等） | 效果 `id` 每次解析重新生成（`e${Date.now()}_n`）⇒**不参与比较**；`''` ⇔ `undefined`、`forced:false` ⇔ `undefined`；导出把"有效果却没写模式"写成「全部生效」⇒两侧同按 `'all'` 认；门槛按 `[metric, subject??null, op, value??null, compareTo??null]` 取值组比较 | `canonSkill/canonEffect/canonTrigger/canonRuntime/canonGate`，同文件 |
| **#46 措辞随模式（用户裁方案A＝只改措辞，不改归属）** | 待点选面板与两条回执原话一律喊"新建为 DIY 将领"，而开发者模式下真建的是**官方本地草稿 `G-*`**（§H1）。改 `pendingCreateLayer = developerMode ? '官方本地草稿' : 'DIY 将领'` 三处共用（面板说明行 / 单张新建回执 / 批量新建回执）；**归属表达式 `developerMode ? 'official' : 'DIY'` 一字未动** | `SkillEditor.tsx:433-435`，真机读数见 HANDOFF §9 本轮条 |
| **#48 数值 0 的保真（本刀真正的伤害）** | **`value: 0` 是引擎的「全部」哨兵**（`core/eventProcessors/handSelection.ts:42` `count === 0 ⇒ 整只手`），官方卡就这么写——全库 `generals.ts` 的 40 条 runtime 里**恰好 1 条**用它：蔡文姬·断肠「击杀者弃置**全部**手牌」（`data/generals.ts:675`）。导出侧**本就原样写出 0**（`serializeEffectGroup` 用 `rt.value != null`，无下限守卫），**导入侧 `parseRuntimeValue` 却拒 `n < 1`** ⇒ 读回 `undefined`，消费点 `skills/SkillTriggerBridge.ts:341` 的 `Number(effect.value ?? 1)` 把它落成 **1**：用户重导自己的 Excel 就把「弃置全部」悄悄改成「弃置 1 张」，还留下一条 ✏️。修法＝**认 0**（负数／小数／文字仍返回 `undefined`，一条也没多认） | `skills/skillExcelFormat.ts:191-201` |
| **仍待用户裁（#49，本刀刻意不动）** | 编辑器数值框 `RuntimeEditor.tsx:59-60` 写死 `min={1}` 且 `Math.max(1, parseInt(…) \|\| 1)` ⇒ 从 GUI 保存断肠同样把 0 夹成 1（**同一半截缺陷的另一侧**，Excel 侧本刀已修，GUI 侧未修）。要裁的是两问：录入面如何表达"全部"（接受词「全部」回填 0？还是只读显示"全部（0）"？），以及数字框是否允许 0。**不自作主张改用户界面词**。**0 的合法性地图（本刀取证完毕，放开时必须按类型区分、不得一刀切）**：`Math.max(0, …)`（0 能通过）＝`SkillTriggerBridge.ts` 的 `DISCARD :341`／`GIVE :367`／`REVEAL :401`／`DECK_PLACE :419`，其中 **`REVEAL` 是观察类、`applyRevealEvent`（`core/eventProcessors/deckEvents.ts:15`）不读数值**⇒"0＝全部"实际只对 **DISCARD／GIVE／DECK_PLACE** 三家成立（`handSelection.ts:42`，其注释明写"装备侧刻意没有'全部'"）；`Math.max(1, …)`（0 会被夹成 1）＝`DRAW_CARD :286`／`DAMAGE :304`／`HEAL`·`GAIN_ARMOR :319`／`EQUIP_STRIP :386` 与 `generalEvents.ts:331` | 待口令 |
| 结构性证人（两锚为何必逐字） | 本刀只碰录入面的读/写与文案，`src/data/generals.ts`、`src/ai/**`、引擎结算路径零改动；官方唯一的 `value:0` 那条**不改变任何触发条件**，B10/B11 输入面（将领集合＋RNG 消耗序列）未被搅动 | 实测：B10 定稿树两轮除计时行逐字全等 **{"1":112,"2":188}**、B11 两轮全等 **{"1":108,"2":192}**（含 fixture 触发读数 蓄粮42/双略32/回报7/转赠6/固守4/节用4/抚伤3/焚粮3/缴械2 与 §12-58 观察层口径同形） |

**五条可复用判据（后续会话照此办，勿再逐案重议）**：
1. **导入回执的计数＝真写入数**，任何"批量应用"路径都必须能回答"这一行写回去会不会变"，无变化即跳过并报数——这是 #45 的一般式；简单格式今日有了，新格式上线时必须同时带。
2. **哨兵值两侧同权**：导出写出什么，导入就必须读回什么。引擎里 `0＝全部` 这类**有语义的边界值**在录入面两侧都算合法值，"看起来像没填"不是拒绝它的理由（拒它的最坏形态＝静默换成另一个数）。
3. **措辞必须说出演算结果**：界面凡预告"会落到哪一层/哪一种归属"，那句话就得由决定归属的同一个表达式派生，不能各写各的（§H1 的 `G-*`/`D-*` 分叉正是这条的落点）。
4. **复算会话的附加主张同样要证伪，但它的"缺口报告"要当真**：本轮第③闸另报两条"必修"——「导出侧把 0 写成『无』」经取值为**伪**（HEAD 的 `serializeEffectGroup` 无下限守卫，且既有 round-trip 测试 `cells[3] === 0` 一直在绿），「官方 8 条用 0」实为 **1 条**，两条均未采纳。它同时**抓出一处真的**：口径②那道 `mayEditGeneral` 前置门当时**只有代码、没有测试**（删掉后 748 例全绿）。⇒ 已在本刀内补第 7 例（玩家模式下"无变化也写不动"的官方行必须报「拒录」、回执里不许出现"无变化"）并做反向验证（删门⇒**只有这一条**红），四闸在定稿树重跑。**评审清单照抄＝把代码改坏的另一条路；但"清单里没有的可疑通过"同样要查**（与 §12-46⑥ 同源，此处为第二次实例）。
5. **"规则实现了"不等于"规则验证了"（本轮的常设教训）**：一条保护逻辑静态读代码正确、动态跑对局无害，仍可能**零测试覆盖**——判别办法只有一个：**把它删掉，看有没有测试变红**（本刀的 A/B/C/E 四组差分证人就是这件事的成文形态）。新立判据：**凡录入面里"两个理由只能报一个"的优先级判定（本次＝权限 vs 无变化），必须各有一例从相反方向钉住**，否则下一个人会把它当成可优化掉的冗余判断。





### 数值 0 与「全部」的按类型收口 ＋ 导入总结面板（v2.8.13，#49 收口＋用户 2026-09-29 两条裁决；**非内容刀 ⇒ 硬锚=对 B10 与 B11 同时逐字；零玩法语义**）

上一节末行留下的 #49（录入面如何表达"全部"）在本轮闭合，同时交付用户直接点名的一件新界面件（导入后的常驻总结面板），并新增一份**给玩家看的**词表文档 `PLAYER_GLOSSARY.md`。全部改动仍在录入面（`src/components`＋`src/skills`＋store 的一处返回值），引擎、`src/data`、`src/core` 一字未动。

| 项 | 实况与修法 | 住所 |
|---|---|---|
| **GUI 半截（#49 方案①，用户拍板"只对三类开"）** | `RuntimeEditor` 的数值行新增勾选框「**整只手（全部）**」，**只在 `WHOLE_HAND_RUNTIME_TYPES`（弃牌／发放／放回牌堆）三类出现**；勾上时**数字框不渲染**（让它显示 1 就是"界面写 1、生效是全部"的分叉，§12-55 同族）；换类型时 `handleTypeChange` 对不懂 0 的类型做 `Math.max(1, carried)` ⇒ **0 绝不被带到别的类型上**。预览文案同步改成整句（「弃全部手牌」而非「弃 全部 张手牌」） | `components/skillEditor/RuntimeEditor.tsx:26-28,65-84`；钉 `RuntimeEditor.wholeHand.test.tsx` 15 例 |
| **Excel 半截（用户裁 B＝按类型收口 0；裁 2＝认「全部」别名）** | 新导出纯函数 `readValueCell(raw, type)`：三类里 `0`／`全部`／GUI 标签词 ⇒ `value: 0`；**其它类型的 `0` 或「全部」⇒ 这一格按没填处理**，并回一条 `valueNote` 原文点名（含"引擎会把它当成 1"）；**`REVEAL` 单独说**——它是唯一 `Math.max(0, …)` 的观察类，0 不被夹成 1，"会真的看 0 张，一张也不看"。`ParsedEffectGroup` 多一个可选 `valueNote`，`parseRowPerSkillSheet` 把它汇入**同一条 `parseWarnings` 通道**（常驻清单，不是 toast） | `skills/skillExcelFormat.ts`（`WHOLE_HAND_VALUE_ALIASES`/`readValueCell`）＋`components/skillEditor/skillExcelParsers.ts`（warn 接线）；钉 `skillExcelFormat.test.ts` +6、`skillExcelParsers.test.ts` +3 |
| **导出侧刻意一字未动** | `serializeEffectGroup` 仍把 `value: 0` **原样写成数字 0**，绝不写「全部」。别名是**只进不出**的读入词——往返形态保持单一，上一轮的 round-trip 判据（导出写什么导入必须读回什么）不被别名机制破坏 | 同文件；钉"九类别名全走读入、serialize 后 cells 不含『全部』" |
| **导入总结面板（用户直接点名的新件，三条口径照原文实装）** | ①**两条导入路共用同一份总结**（文本路与 Excel 路，含待点选的新建/挂改、批量新建）；②**常驻面板**，带「知道了」才消失，内容可整段复制（`navigator.clipboard` 失败回退 `execCommand`，面板所见＝复制所得，同一个字符串）；③**只点名**——新增/移除/改动哪些技能、势力/体力/近战/远程变了什么，**不折算成槽位数字** | `components/skillEditor/importSummary.ts`（无状态纯函数）＋`ImportSummaryPanel.tsx`；钉 `importSummary.test.ts` 12 例＋`SkillEditor.importSummary.test.tsx` 9 例 |
| **总结的派生法（本刀唯一有踩坑风险的地方）** | 条目一律由「**写入前 / 写入后各取一次当前生效视图**」派生（与 #47 的**现行口径**一致——注意 **#47 本身仍待用户裁**（§12-67），本面板采用的是它今日的既路口径而非一项新裁决：改动是"A 改 B 的数据改动"，不是相对仓库原始卡）；生效视图的**唯一正主是 `store.getGeneralWithEdits`**，组件不另写一份合并逻辑。**必须现取现读** `useGameStore.getState()`：写入在同一事件回调里同步落库，而闭包里的 `getEditedGeneral` 还是上一次渲染那份 ⇒ 拿它算"写入后"会得到与"写入前"一模一样的视图，**所有改动条目静默消失**（本刀实测踩过，注释钉死） | `SkillEditor.tsx:279-299`（`pushSummary`/`editedSnapshot`） |
| **store 只交名单、不交措辞** | `importSkillEditsFromText` 返回值新增 `applied: string[]`（真正写了哪些将领 id）。**词表住在录入面**（§12-67③同源），store 不生成任何面向用户的句子；三条既有断言随签名同步 | `store/gameStoreEditorActions.ts:245,273`＋`gameStoreTypes.ts:191` |
| **同名技能不重复报** | `describeSkillChanges` 按**名字去重后逐个**比张数，逐条遍历会把"新增 1 张"跟着第二个同名技能再报一遍；集合相同顺序不同 ⇒ 如实说一句「技能顺序调整」 | `importSummary.ts:38-70` |
| **`PLAYER_GLOSSARY.md`（新增文档，玩家侧）** | 八节 ~149 行三列表（术语｜大白话翻译｜留给用户填）。§七＝**界面里其实没有的词**（杀/闪/桃/酒/决斗/锦囊/判定/装备区/马/淘汰…）；§八＝**十条界面措辞与规则/引擎不一致**，逐条附代码出处。其中两条是本刀顺手查证出的真冲突：击破补偿抽**归死者那一家**（`chainedConsequences.ts:135-152` 用 `targetPlayerId`）而规则页写"击破方补抽"（`Rules.tsx:38`）；**技能标签与"强制发动"在编译与桥接层零消费者**（既有 §12-61 的界面呈现） | 新文档；未改任何代码，属登记面 |
| **`词汇表.xlsx`（2.8.15 起＝上面那份 md 的 Excel 投影，仓库根）** | 用户点名要的一份可直接填写的表，文件名照原话「词汇表」。9 张表＝`说明`＋八节各一张、**157 条词条**（30/37/21/25/9/17/8/10），表头冻结、逐列列宽、markdown 语法剥净、§四 末段附注并进表尾。**权威边界：md 仍是唯一事实源**，Excel 由 `npm run glossary-xlsx`（`scripts/make-glossary-xlsx.mjs`）生成 ⇒ 同一句话不存在第二份可各自漂移的正文；用户在 Excel 第三列填的答案**要抄回 md**（重跑会覆盖）。两条常设判据见 HANDOFF §12-73②③：**入库的生成物必须字节稳定**（exceljs 底层 jszip 给每个 zip 条目写 `new Date()`，已钉成固定 UTC 日；否则每次重跑都给仓库塞一条新二进制 diff）、**往返校验必须跨库**（写用 ExcelJS、读用 SheetJS，与技能 Excel 那条铁律同源，自己判卷＝永远绿）。守卫 `scripts/make-glossary-xlsx.test.mjs` 四条，其中"入库 xlsx＝当前 md 的投影"那条**已用假词条实证会咬人**（27,486 对 27,545 字节转红）。 | 生成物＋脚本；`src/` **零改动**（构建产物与 v2.8.14 逐字节同体积＝证人），非玩法刀 |

**本刀新增的可复用判据**：
1. **一个界面词只能在一层有含义**：`0` 是**按类型**才有意义的哨兵，所以录入面的词表必须**按类型收口**——"全局放开数字框允许 0"＝新的静默失真（上一节 §F 表末行的 0 合法性地图正是这条判据的证据来源）。凡新增别名词，必须同时写"这个别名叫谁、不叫谁、叫错了怎么点名"。
2. **只进不出的别名**：读入侧可以宽容（多认一个词），**写出侧必须单一形态**，否则自己的导出文件再导回来就成了"改动"。
3. **"写了谁"由写入方交回，"改了什么"由视图差分派生**：任何批量应用路径都该同时能回答这两个问题；前者是结构化名单（不许带措辞），后者是前后两次生效视图的差——**绝不在出口层第二次推断**（§12-56① 同源）。
4. **同一事件回调里读 store 要现取**：React 闭包里的 selector 是上一次渲染的产物，同步写入后再读旧闭包 ⇒ 差分为零 ⇒ 用户看到的总结是空的。这类"面板恒空"缺陷的证人＝**差分实验**（把 `editedSnapshot` 换成旧闭包版，改动条目类断言必红）。

**结构性证人（两锚为何必逐字）**：`src/data/generals.ts`、`src/ai/**`、`src/core/**`、`src/engine/**` 零改动；官方唯一 `value:0` 那条（断肠）不改变任何触发条件；总结面板只在录入面读视图、不写任何状态。实测（定稿树各两轮）：B10 除计时行逐字全等 **{"1":112,"2":188}**、五势力小账逐格吻合 §12-43①；B11 **{"1":108,"2":192}**、三势力小账与 v2.8.9 登记逐字相同。

### DUEL 决斗流程原语（2.8 刀 9＝#30；§H5-6 七项＋H9 四轮四答＋第五轮更正＋第六轮三答并读；**能力刀：动 `src/core`＋`src/skills`⇒A 级硬锚=对 B12 与 B11 同时逐字**；先填表后动刀，本表即施工与评审判据；GPT 设计门已复核通过，采纳四条见本节末）

| 格 | 契约 |
|---|---|
| Event | **第 10 枚 Effect 原语** `DUEL`（`SkillRuntimeEffect.type` 联合）＋**新事件 `DUEL{ sourcePlayerId, sourceGeneralId, targetPlayerId, targetId }`**（`core/Event.ts` 联合新增；双侧各自带齐 player＋card 双键，键名沿用伤害载荷的既有四键⇒决斗轮次与普攻／技能伤害在日志与录像里同形）。SkillTriggerBridge 只产这一枚事件、**不自带任何状态修改、也不发 DAMAGE**；EventProcessor `case 'DUEL'`→`applyDuelEvent`＝**恒等返回 state**（"决斗本身不附带任何效果、不借决斗塞结算"＝§H7 那条的实现形状：原语本体零结算）。**逐轮伤害由唯一派生点 `chainedConsequences` 观察 DUEL 后派生**（与 CARD_*、技能击杀 DEATH、击破补偿抽同一派生点，不另立第二处）。**零新增通知事件**（监听口径见 Reentrancy 格） |
| Timing | DUEL 与同技能其余效果事件同 dispatch 的 BFS 尾部落账；派生的逐轮 DAMAGE 块**成块前置到队首**⇒在**同一次 dispatch 内、在该枚技能的后序效果之前**连续结算完（＝用户"从开始到终止连续完成、中间不插入任何流程"这一格的落点）。决斗内部**无回合跨越**（H5-6：必在一个回合内） |
| Source | 先手方（A）恒=技能拥有者将领所在玩家＋其 runtime card id（不经载荷传递，与 DISCARD/GIVE/EQUIP_STRIP 同轨）。**决斗不是 ActionType**（H9-1"只能由技能发起"⇒无决斗牌、无独立决斗行动），唯一生产者＝桥接层效果翻译 |
| Target | 后手方（B）＝载荷 target 角色解析（首批 `TARGET`=被作用者；`SELF` 亦可⇒**发起者可以亲自参加决斗**，H9 第五轮③）。事件双侧各自带齐 player＋card 双键⇒派生与结算无需从伤害载荷反查玩家（v2.6.0"AFTER_DAMAGE 不带 targetPlayerId"教训的提前规避）。**首批只支持"源将领 vs 目标将领"一对形状**；离间型"令场上另两名将领决斗"需任选／双目标录入面（待办 #28 刀 7），届时**只补生产者、不动本原语** |
| Condition | 诚实空转清单（实到，逐条有测试）：`sourceGeneralId`／`targetId` 不是非空字符串、任一侧在场查不到（`findDuelParticipant` 按 runtime card id 命中失败＝**不在场或将领已阵亡**）、**`sourceGeneralId===targetId`**（"自己不能和自己决斗"＝§H9 第五轮③的确切读数）→**DUEL 事件照样入账（触发确实发生）、派生零条 DAMAGE**，与 DISCARD 空手／GIVE 空转／EQUIP_STRIP 空装／REVEAL 零位移同一纪律。**派生看的是"两侧各自的 runtime card id 能否在场内解析"，不是载荷里的 player 键**（§H9-③④：双侧四键是给下游同形用的，空转判定不依赖它们）。**轮数上限 6＝规则常量、不可调、无载荷字段**⇒本原语**没有 value 录入面**（见三处同步 ⑧） |
| Effect | 派生块＝**逐轮预解的 DAMAGE 事件序列**，i=1..6：奇数轮 A 打 B、偶数轮 B 打 A；伤害数值＝**共享函数** `getAttackValue(攻方 fieldGeneral, false)`（近战口径，**与普攻同一个函数**）→ `applyArmorDamage(守方本轮起始 hp, 本轮起始 armor, raw)`（`core/armorDamage.ts` 单点真值：军备每 2 点挡 1 点）；每条 DAMAGE 携 `damageType:'skill'`＋**已算好的 `newHp/newArmor/value`**（`value＝Math.max(0, rawDamage)`）＋**`duelRound`（1..6）与 `duelKey`**（配对键＝`skillId`＋`triggerEventId`＋`源将>目标将` 三段拼成，DUEL 与它的各轮共用，回显据此归块；载荷里没有事件 id——纯路径上事件尚未盖戳）**⇒`applyDamageEvent` 走"预解"分支**一字不重算**（GPT 复核钉死的分层：precompute 与 real-HP 各在其位，apply 永不重算）。**决斗轮不带 `armorLost`**：那个键在既有伤害结算里驱动 `legacy_armor_destroyed_*` 措辞（"装备被击破"类提示），决斗每一"打"不是攻击、也无装备击破语义⇒故意不填，宁缺不造。逐轮只重写双侧四键（`sourcePlayerId/sourceGeneralId/targetPlayerId/targetId`），其余（`skillId/skillName/effectType/triggerEventId`）原样带过去⇒操作日志与报表把每一"打"归到那枚技能上。**0 及以下伤害照样占一轮并继续轮换**（H5-6）⇒决斗轮 `value` **允许 0**，刻意区别于桥接层 DAMAGE 分支的 `Math.max(1,…)` 钳制；**一旦某轮守方 `newHp≤0` 立刻截断**（死者不再被轮换、不再计算它对存活方的伤害）⇒**块长 1..6 由终止点决定，不是固定六条**；每轮真实扣血由既有 DAMAGE 结算逐步落账（不是算满六轮一次扣＝H9 第五轮②）。增减层（攻击力增减／受到伤害增减）**今日无运行时真身**（待办 #25/#26），故本轮只复用"攻击力→军备挡伤"这一段算术——**绝不在决斗里另写一套伤害数学**（那会成为第二处真值） |
| RNG | **零新增随机面**：轮换序＝常量、攻击力＝面板读数、挡伤＝纯函数；不咨询 `rngState`、不动游标⇒同配置两跑逐字节一致 |
| Replay | **A 类必录**：DUEL 事件＋派生的逐轮 DAMAGE／DEATH 进录像。**两条必须先认清的观测事实（本刀实测，不是推测）**：① 逐轮 DAMAGE 是在队列**内部**派生的，`GameEngine.dispatch` 只吐/只记 `result.events`（§12 老口径"dispatch 不返回内联追加事件"）⇒ 决斗轮次**天然不会出现在事件流里**，操作日志／录像／AI 报表会集体看不见它。修法＝`TransitionCore` 在 `processor.process(...)` 之后调用 **`echoDuelRounds(events, derived)`**（`duelEvents.ts`），按 `duelKey` 把整块逐轮伤害**插回它自己那条 DUEL 之后**——纯观测面回显，**不改队列、不改 state、不产生第二次结算**（重放是把 action 重新 dispatch 一遍，从不回灌这个数组；DAMAGE 又不在 `REACTION_EVENT_TYPES` 内⇒回显不可能被重入环二次吃掉）。② 同一条事件流里 **DEATH 可观测**（重入环把 `expanded` 整体 push 回 `events`，待处理的 DEATH 因此随之入流），而**阵亡方补偿抽 `DRAW_REQUIRED` 不可观测**（它只在队列与 `result.drawState` 里，从未进 `events`）⇒ 本表旧版把 DRAW_REQUIRED 写成"全部进录像"是**读数错误、已更正**：补偿抽的可观测通道＝`result.drawState`＋`sacrificial` 那条既有路径，不是事件流。**重放不重算轮次**——预解结果已写在事件里，回灌即逐字（附带好处：日后增减层改写面板值，旧录像仍逐字复现，钉为回归判据） |
| Transition | 唯一 `TransitionCore.transition`；`applyDuelEvent` 为纯 `(state,event)→state` 且**实际返回同一 state**；逐轮计算只住在唯一派生点、状态位移仍由 `applyDamageEvent` 单点执行⇒**无第二状态转移路径**（红线自查通过）。**派生点的收集纪律已随本刀改造（实到）**：旧 `EventProcessor.process` 用 `queue.slice(derivedStart)` 采集"队尾新增"，对 `unshift` 会**错采**（漏掉新块、把旧项当派生）⇒ 改成派生函数 `chainedConsequences.enqueueDerivedConsequences` **把块交回**（返回类型由 `void` 改为**带回一批事件**：`GameEvent[]`，无批次时 `null`），由 `process` 决定摆放并同时并入 `collected`（队首块＋既有队尾项）；**既有队尾行为一字不变**，非连续结算类效果仍走 `push`＋`null` 返回。**观测面另有一处**：`TransitionCore` 在 `process` 之后调用 `echoDuelRounds(events, derived)` 把逐轮伤害回显进事件流（为什么必须回显、以及它为何不可能造成第二次结算＝Replay 格两条实测事实）。 |
| 队列前置权（封口） | 唯一派生点既有纪律＝**只 push 队尾**。本刀引入**受约束的批次前置权**：仅"**连续结算类效果**"（当前唯一持有者＝DUEL）可**整块一次** `unshift` 队首，块内不得夹带任何非本原语事件。**除连续结算类效果外，任何新原语／新触发一律不得引用此例外**（代码注释与本格同文封口）。判据两侧：放队尾＝同技能后序效果跑到决斗伤害之前＝违用户"决斗先、后序接着走完"；块内混入他事件＝违"中间不插入任何流程" |
| Reentrancy / 监听 | 决斗轮次在 `process()` 内派生⇒**不进** `resolveTriggerChain`（那条链只在 dispatch 前用单一 state 展开）。⇒逐轮 DAMAGE **不触发任何监听**：`onDamageDealt`（承 `AFTER_DAMAGE`）与 `onBecomingTarget`（承 `BEFORE_DAMAGE`）**由设计即为零**——决斗根本不发这两枚事件，正合 H5-6/H9-4"每次打不算攻击、不吃受到攻击伤害后类技能（如刚烈）"；`onDamageTaken`（承 `DAMAGE`）**本刀取"决斗中不响"**，依据＝H5-6 原文两句"决斗本身不能被响应打断"＋"中间不插入任何流程"。〔**本表唯一登记在案的推论（待用户复核）**：H5-6 只点名排除"受到**攻击**伤害后"类，未明说"受到伤害后"类响不响；若要它在决斗里响，须新增纯通知事件（`DUEL_HIT` 型）＋扩该触发的可听事件源＋重入环记账，而**"什么时候响"（六轮之后？逐轮之间？）§H5-6 从未给出**——逐轮之间违"不插入任何流程"，六轮之后属发明新时序，故默认取甲案（不响），用户裁决第 3 条（击破类照响）另走既有 DEATH 通道不受此影响〕。致死链仍走既有路：轮次 DAMAGE 派生 `DEATH`→既有 `REACTION_EVENT_TYPES` 重入环→`onKill`/`onDeath` **照常成立**（H9-3）⇒**代价＝零新事件枚、零集合扩容**；叠深兜底沿用三道既有闸（重入轮 8／深度 32／链上 256，触顶发 `TRIGGER_REENTRY_LIMIT` 哨兵）。〔**2026-09-30 第七轮改判（用户四答，原文见 §H9 第七轮）**：本格"甲案＝决斗中不响"这一推论**已被推翻**，目标口径改为**两端响、逐轮不响、收官按累计伤害额合并成一笔判定值（不再扣血）**，且"受击"须分**成为攻击目标／成为技能目标**两档、监听须加**自己／己方（同席位）／场上**三档范围。⇒ **本表这格记的是今日代码现状，§H9 那几条记的是目标态，二者不一致属已知且在案、不是漂移**；实装另立两刀（监听扩面刀＝前置，决斗刀 2＝在其上），且等用户的「连锁响应链」顺序规则到位才动结算〕〔**v2.8.24 追记：本格"待用户复核"与"目标态未落地"两截均已作废**——监听扩面刀（#69，v2.8.21）与决斗刀 2（#70，v2.8.24）先后落地：开局只喂〔成为技能目标〕、逐轮显式静默、收官按累计掉血合并成一笔 `DUEL_INJURY`（纯观察面、不再扣血）进问答，两裁决（一笔一笔问·受邀者那笔先；阵亡者整笔跳过但遗言技＋补偿抽照旧）逐字入码。今日代码现状＝目标态，规格与账面见 §H9 第十一轮；仍欠的只有 `forced` 分流⇒#72〕〔**v2.8.25 追记（#72 强制发动执法刀＝那半条欠账销账）**：本格"两层进问答"今日由 `forced` 决定**问不问**——唯一读取点 `SkillTriggerBridge.defersToReactionQueue`（`isReactionTrigger && forced !== true`），勾了这一格的定义不注册进问答队列、直接进自动路当场响完；开局探针相应从 `hasReactionCandidates`（只数问人路）换成 `hasReactionListeners`（两条路共用同一个 `collectListeners`），否则场上只有 forced 受击技时通知会被误标 `'settled'`、整层连自动路都不响。两层同时**真进触发链**：`TransitionCore` 的重入集合经 `isDuelListenerEvent` 收入 `DUEL_INJURY` 与开局通知（**带 `duelRound` 的六轮仍然绝不进＝逐轮不响一字未动**），`echoDuelRounds` 已写入的块用身份过滤 `!events.includes` 防二次写入。⇒ 规格与账面见 §H9 第十二轮、复现记录见 §H10；数据面今日仍**零 `forced:true` 实例**（官方 95 将与 DIY 样本皆无），既有锚池行为一字未变，真机证人归 #81〕〔**2026-10-01 #81 追记：那半句"决斗问窗无真机证人"自本日起作废——证人已出示，且是在不改一行源码、不碰官方池数据、不用开发者口令的条件下出示的**。真实浏览器热座房（vite dev、`header.gameVersion='2.8.25'`）里决斗开局问窗**两次弹出、两条出口各走一遍真票**：点技能＝`ACTIVATE_SKILL`→`REACTION_ANSWERED[REPLY_ASK]`＋`DRAW[REPLY_ASK]`→`DUEL[answered]`→逐轮 `DAMAGE#r1..r3`→收官 `DUEL_INJURY{injury:2}`→`DEATH`；点🚫跳过＝`SKIP_REACTION`→**一条不带技能号的 `REACTION_ANSWERED`、零效果跟单**→`DUEL[answered]`→`DAMAGE#r1`→`DEATH`（目标只剩 1 血，第一轮即终局⇒按本格既有口径**不发收官那一笔**，非新增行为）。取证用的那张「Reply」DIY 将在**同一条**「成为技能目标时」上同时挂两条定义（一条 `forced:true`、一条非 forced）⇒**问窗只列后者、前者在问窗弹出之前已 `TRIGGERED→DRAW` 结算完**（事件账＋手牌增量双证，两次皆然）⇒本格的"问不问由 `forced` 单点决定"从引擎级四路对账升级为**真机实证**。场景配方与判据＝HANDOFF **§12-90**，取证账＝HANDOFF **§9 #81 轮**〕〔**v2.8.27 刀5（#26）追记·事件更名**：本格与上一格反复提到的 `DUEL_INJURY` **已不是独立事件类型**——刀5 把「受到伤害」那一身立成唯一一声 `INJURY`（`chainedConsequences` 在每一刀落账后按前后血量差派生），决斗收官那一笔并进同一个名字、保留 `duelKey`＋新增 `duelStage:'injury'` 作为形状标记。**语义一条没改**：仍是一场决斗按角色累计成一笔、只问一次、绝不再扣第二次血；带 `duelRound` 的六轮仍不发射这一声（派生点显式排除）。差别只在"听哪一声"：`onDamageTaken` 的可听事件从两声（`DAMAGE`＋`DUEL_INJURY`）收成一声 `INJURY`⇒问答路与自动路的边数天然相同（v2.8.25 那次合表想消灭的分叉从此在数据形状上就不存在）；重入集合里 `INJURY` 直接写进 `TRIGGER_REENTRY_TYPES`（不再分工），`isDuelListenerEvent` 只剩决斗开局那一层。旧录像里若还有 `DUEL_INJURY` 字面量：它是纯通知、零状态位移，落 `EventProcessor` default 恒等⇒重建不会歪，只是那一声不再被监听读到（如实登记，不做兼容垫片）。〕 |
| Death chain | 截断发生在"该轮已把 `newHp≤0` 写进事件"之后⇒死者离场由既有 `applyDamageEvent` 完成（进 `graveyard`、军备倾泻入弃牌堆），`DEATH` 派生（`skillKill:true`）与**归阵亡方的补偿抽**（v2.8.14 已钉）一字不动；决斗每轮只打一侧⇒**结构上不存在"同轮双死"面**，无需特判；决斗自身不造成额外伤害、不发 `AFTER_DAMAGE`⇒不牵动反伤族、不引发连锁击杀 |
| 优先级 | 原语不自带优先级，承载触发走 `TriggerEngine` 现表（决斗内部无优先级概念——轮次序＝规则常量） |
| 忠实度 | **内置零转正**⇒A/B/C 标签随转正刀补打。已知首个内容候选＝**离间**（貂蝉，§G 明记"决斗概念不存在"＝该档当年因缺原语而跳过），其形状需双目标／任选目标录入面（#28 刀 7）⇒**本刀不动内置账本**（`generals.ts` 零 `DUEL` 实例＝40 runtime 定义／129 诚实跳过一字不动），合成载荷测试进局（v2.5.1／v2.6.1 先例） |
| 三处同步 | ①`SkillRuntimeEffect.type` 联合（`data/generals.ts`）＋`dataTypes.DataSkillEffectType`；②`skillCompiler.SUPPORTED_EFFECT_TYPES`（第 10 枚）＋`toEffectData` 透传（**无新字段**⇒零 passthrough 面、无 dest 型扩列）；③`core/Event.ts` `DUEL`；④`SkillTriggerBridge.translateEffect` 新增 DUEL 分支（解析双方双键、**不发 DAMAGE**）；⑤`EventProcessor` `case 'DUEL'`＋新文件 `eventProcessors/duelEvents.ts`（恒等 `applyDuelEvent`）；⑥`chainedConsequences` DUEL 分支（派生块）＋`process()` 采集改造（见 Transition 格）；⑦`skillExcelFormat.runtimeEffectTypeLabels`（"决斗"）与 `SETTLEABLE_RUNTIME_TYPES`＋`RUNTIME_TYPE_LIST`（下拉项），**`WHOLE_HAND_RUNTIME_TYPES` 不收**（无数量语义）；⑧**「没有数量可填的类型」成为一档新分类**：`skillExcelFormat.VALUELESS_RUNTIME_TYPES＝['DUEL']`（与 `WHOLE_HAND_RUNTIME_TYPES` 并列而不混同——"全部"是 0 的一种读法，决斗是**根本不读数**）；`RuntimeEditor` 据此**不渲染数值行**（连复选框都不出，给它一个数字框＝请项目把"界面写 1、生效是六轮"的分叉搬进界面），预览文案＝`与目标将领决斗（双方各三轮，最多六次）`，**目标下拉照旧要选**（决斗打谁仍是必填）；切换类型进入无读数档时 `value` 置 `undefined`（不塞 1）；Excel 侧 `readValueCell` 对无读数档**根本不读格**，只有该格真写了数字或「全部」才点名退回（宽容读入侧不点名空着）；⑨**算术函数抽取**：`getAttackValue` 从 `AttackResolver.ts` 私有迁出为 `src/core/attackValue.ts`（照 `armorDamage.ts` 先例，注释钉"决斗与普攻共用"），近战伤害整段算术同处归一⇒#25/#26 增减层落地时**两侧一起生效**；⑩表驱动测试补员（实到）：`skillExcelFormat.test.ts`（无读数档循环跳过＋决斗专条）、`RuntimeEditor.wholeHand.test.tsx`（数值录入面三条：不渲染数值框／预览文案／切类型清 value）、`skillCompiler.test.ts`（DUEL 编译且 `value` 为 undefined）、`EventProcessor.test.ts`（DUEL 四例）、`transitionEquivalence.test.ts`（真实模板全路径两例）、`battleRunner.test.ts:140` 的名单守卫补 `'DUEL'`⇒**九类名册变十类**；**`diyGeneralFixture.ts` 刻意不动**（加一张决斗样本会把锚 B11 的值改掉，而本刀是"锚必须同值"的能力刀——fixture 是锚的分母，不是回归测试的靶场）；`builtinReachability.test.ts` 无需改（官方池零 DUEL 实例，可达性表按现有池派生）；⑪观察层：报表名单**不由类型名册决定**——`isSkillEffectEvent` 看的是桥接层给每枚效果事件打上的 `skillId`＋`effectType` 这对载荷不变量（§39 那把刀把它从"手写类型清单"改成了按构造成立），⇒DUEL **自动进名单**，无需第二处登记；实测已钉（REVEAL/DECK_PLACE 同族回归）。 |
| 活例 | **无内置转正（能力刀＝接线）**。合成载荷钉形八例（括号内＝实际落在哪个测试文件的哪一条）：①满六轮、双方都活着（`EventProcessor.test.ts`「满六轮」：A 20 血攻 2／B 20 血攻 3⇒轮值 `[2,3,2,3,2,3]`、终局 A11 B14）②致死即截断（`EventProcessor.test.ts`「致死即截断」＝处理器层块长 3；真实模板全路径层的截断是**第 5 轮**`newHp 0`⇒块长 5，`transitionEquivalence.test.ts` 钉的就是 5 条，两者都钉）③0 伤害仍轮换（攻击力 0⇒六轮 `value` 全 0、血量不动；与**军备 2 点挡 1 点**同条测试：3 军备挨 2 点伤⇒`newHp [9,10,7,10,5,10]`、`newArmor [1,0,1,0,1,0]`，单点军备原地不动）④`sourceGeneralId===targetId` 空转（自斗那条：`du_long:搦战` 打对手＋`du_long:自斗` 打自己⇒只有 6 条外轮进账）⑤任一侧不在场／载荷缺失空转（state 深相等、`collected` 只剩 DUEL 本身）⑥致死⇒补偿抽归**阵亡方**（`drawState {reason:'compensation',playerId:阵亡方}`＋`DEATH{skillKill:true}` 载荷逐键）＋`onDeath`/`onKill` 同局成立（掠杀／遗命各抽 1）⑦可观测顺序钉死＝**决斗各轮伤害→（同技能）后序效果（护甲 GAIN_ARMOR 在块后）→死亡响应**，且**忍创／铁壁这类"受到伤害后"监听精确只响开场那一次普攻、决斗六打全不响**（＝Reentrancy 格甲案的实证锁）〔**v2.8.24 决斗刀 2 就地更正**：这一格钉的是**当时**的实现（甲案＝决斗中一律不响）。第七轮改判后本刀已把它换成**两端响、逐轮不响、收官一笔累计判定值**——开局〔成为技能目标〕问一次、六打中间仍不唤任何监听（`duelRound` 排除键照旧，这半句一字未动）、收官各发一枚 `DUEL_INJURY`（只算实际掉的血、不再扣血）喂「受到伤害后」⇒ 本条前半"只响开场那一次普攻"在今日仍是真的（逐轮确实不响），后半"决斗六打全不响"要读作**"逐轮不响、收官响一笔"**。现规格＝§H9 第十一轮，测试证人＝`transitionEquivalence.test.ts` 决斗三例〕⑧四路对账逐字节（桥接／reconcile／ReplayPlayer／同配置两跑，`transitionEquivalence.test.ts` 两例全绿；顺带钉住 `DRAW_REQUIRED` 在事件流里 0 条＝Replay 格②）。锚（A 级）：B12 **{"1":106,"2":194}**、B11 **{"1":108,"2":192}** 与 §H10 现行读数**逐格未动**（定稿树各两轮 `cmp` 逐字节全等＝实测已达成，非预期；结构性成因＝官方池与 fixture 均**没有** `DUEL` 实例、`src/data` 只多联合里一个 `'DUEL'` 字面量）；值变即换名（§H10 锚名规则）。⑨ **真机活例（热座房 `E2E2820B`、dev 5175、全程真实点击、未旁路引擎）**：实时录像 seq 35 是一条挂着 `DUEL` 的 `ATTACK`（技能实例 `D-cd9acc4f-…__inst_1:DUEL-E2E:…`）→`DAMAGE{skill,2,R1,newHp1}`→`R2 newHp1`→`R3 newHp0`→`DEATH{targetPlayerId:1,attackerPlayerId:2,skillKill:true}`→`DRAW_REQUIRED{reason:'compensation',playerId:1,totalCards:1,resumePlayerId:2}`，终态 store＝`phase playing／timeline ACTION／当前席 2`；**「刚烈」只在发起决斗的那次攻击响了一次、六轮内零次**＝Reentrancy 格甲案当面成立；录入面侧实测＝数值行整行缺席（`numberInputs:[]`、`checkboxes:0`）、`TARGET` 照旧可选、预览「与目标将领决斗（双方各三轮，最多六次）」、保存后 store 与 `localStorage['three_kingdoms_skill_edits']` 双侧＝`{"type":"DUEL","target":"TARGET"}`**无 `value` 键** |

**本刀新增的可复用判据**：
1. **"连续结算"是一类效果形态，不是一个特例**：凡"必须一口气算完、不许被别的事实插队"的效果，走同一份**受约束批次前置权**（整块、队首、块内纯度受限），而不是各自开快车道、各自新增第二转移路径。除这一类效果外，前置权一律不得引用。
2. **"预解 vs 重算"必须分层且只留一处真值**：派生点算一次并把结果写进事件，结算函数只照单执行；重放因此不必（也不得）重算，面板演化后再回放旧录像仍逐字。
3. **规则常量绝不许做成可填数值**：轮数 6 属规则，给它一个录入框＝把"界面写 1、生效是 6"的分叉请进项目（与 §12-55、v2.8.13 的按类型收口同族）。
4. **推论要与依据分开放**：本表把"决斗中 `onDamageTaken` 不响"标为推论并给出两句原文依据＋两条替代方案的代价，而不是混进裁决里冒充用户口径。

### 监听扩面刀（2.8 刀 10＝#69；§H9 第七轮②③＋第九轮⑦⑧＋第十轮①②的**数据面**；**能力刀：动 `src/skills` 的监听消费面⇒A 级硬锚=对 B12 与 B11 同时逐字**；本刀只交付"读得到、且只按已记录的事实判"，**发射器排在 #70/#71**）

> 一句话：引擎自 2.1 起每枚被动只认**发生在自己身上**的事，而「成为目标」只有一档写死的"攻击"——用户要的"己方／场上"与"成为技能目标"在数据模型、录入面、Excel、词汇表里**一维都不存在**（§H9 第七轮四处前置缺口 b)c)）。本刀把这两维建通到全链路，**两维的缺省档都等于扩面前的逐字行为**⇒官方 95 将与仓库夹具**结构上不动**，两锚逐字是这一句的外部证人。

| 轴 | 本刀实况（读代码可复核） |
|---|---|
| 两维是什么 | **第一维「这事是谁引起的」**＝`TargetSubType`（`attackTarget`／`skillTarget`／`anyTarget`，`src/data/generals.ts`），只挂在 `onBecomingTarget` 上；这一型原来 label 写死「成为**攻击**目标时」，扩面后主名改成泛指的**「成为目标时」**，档由细分定。**第二维「我听谁」**＝`ListenerScope`（`self`／`allySeat`／`field`），是**与触发时机正交的第二轴**：同一刻既要挑"哪种伤害"也要挑"听谁的事"。用户口径＝"己方"**不是同势力而是同一个玩家席位**（§H9 第七轮②原话"这里是我描述错误，其实应该用'己方'"）⇒`allySeat` 比的是 player 键、绝不比 faction；`field`＝场上任一席（第三方座位的监听者也有响应权）。 |
| 为什么一维进句子、一维独立成列 | 「被谁指名」是 `onBecomingTarget` 的**细分**，与 `damageSubType`／`killSubType`／`cardSubType` 同族，所以走既有的 `getTriggerSubOptions`→`'target'` 一条道、写进触发那句话（`成为目标时→成为技能目标`）。「我听谁」**与细分并存**（受到伤害后可以同时挑"技能伤害"与"听场上"），而 `getTriggerSubOptions` 一型只发一档⇒它**刻意不进那一函数**，改由 `supportsListenerScope(type)` 单点判定，Excel 各占**一列**、录入面各出**一个下拉**。判据：**正交轴不共享一个格子**——挤进同一句话迟早要发明分隔符，那是把第二处真值请进词表。 |
| 适用面 | `supportsListenerScope` 收九型（onDeploy/onTurnStart/onBecomingTarget/onDamageTaken/onDamageDealt/onKill/onDeath/onCardLost/onCardGained）；**`onOtherDeploy` 刻意排除**（它的细分本身就是"己方他人登场／他人登场"，再叠一维会自相矛盾），**`onTurnEnd` 排除**（2.3.1 单路径纪律：它没有自动发动路径）。编译器与录入面与 Excel **共用同一个根**，不许两处各写一份。 |
| 缺省档＝扩面前逐字 | 未填 ⇒ `listenerScope='self'`＋`targetSubType='attackTarget'`。选这两档**不是随手**：官方四条 `onBecomingTarget`（龙吟/崩坏/猛进/激昂）与夹具「样·固守」的描述**逐条都写"成为攻击目标时"**⇒按"看描述定档"（§H9 第九轮⑦）默认只算攻击；旧写法反查的也是"自己身上"。**这一行就是锚不动的成因**，新维今日在两个锚池里进不了场。 |
| 消费面（三谓词） | `SkillTriggerBridge.buildCondition` 里拆成三句：`playerMatches`（`field` 档不比玩家键，但**要求事件带这个键**）／`generalMatches`（**只有 `self` 档比将 Id**）／`sourceMatches`（只读通知事件**已经记下**的 `damageType`）。九型 identityCheck 逐条换成这两句的组，**没有新增转移路径、没有新增事件**。 |
| "没有受击者"不等于"受击者不是我" | 打本营那条 `BEFORE_DAMAGE` 不带 `targetPlayerId`（在案事实，注释在 `SkillTriggerBridge` 里）⇒**三档一律不响**，`field` 也不例外：缺的是"受击者这个人"，不是"受击者不是我"。这条保住扩面前"打本营不会触发将领受击类技能"的既有事实，**并被单测当面钉住**（`listenerScope.test.ts` 最后一条）。判据：**扩"听得更宽"时必须逐型问一遍"这个键在不在事件上"**，否则宽档会把历史上被缺键挡住的东西一并放进来。 |
| 来源档读记录、不重算 | `sourceMatches` 拿 `data.damageType === 'skill' ? 'skill' : 'attack'`——**不在监听侧重新推断伤害数学**。今日 `BEFORE_DAMAGE` 唯一生产者是 `AttackResolver` 且不带该字段⇒按"攻击引起"记；技能那一路由 #70/#71 的发射器显式带 `damageType:'skill'`。与 §12-79"派生点唯一、记事实不重算"同纪律。 |
| **如实账：`skillTarget`／`anyTarget` 今日无发射器** | 这两档**读得进、存得下、显示得出、可导出，但对局里现在不会响**（技能指定目标不发通知事件，发射器排在响应链执法刀与决斗刀 2）。录入面对此**明写一句**（选了非默认档就在下方出现"这一档已经如实记下，但对局里现在只有「攻击指名目标」会发出这一声"）。**先交消费面、后交发射器**是与 REVEAL/DECK_PLACE（2.6.1）同一形态的**能力先于内容**安排，不是半成品：本刀没有"看起来能响其实不响"的技能实例（官方池零条），也没有把限制放宽。判据：**能力刀必须自己点名哪一档还没通**，别让下轮把它读成"已经生效"。 |
| `self` 与 `allySeat` 在两类时机同义 | 手牌与回合开始这类事件**天生挂在玩家身上**（将领不持牌，CARD_* 只有 playerId 一维，2.5.0 教训），那里"只听自己"与"听己方（同席位）"是同一件事。登记在案＋录入面提示原话＋单测**不给这条路造第二份真值**（不硬拒填 `allySeat`，因为它与 `field` 的区别仍然真实）。 |
| 编译 | `compiledEffect` 多两字段＋**`signature` 尾部加两维**（`…|targetSource|listenerScope`）⇒**"选择其一"的跨效果合并从此不会把"只听自己"与"听场上"并成一条定义**（单测钉）。`skillCompiler` 只在 `mapped==='onBecomingTarget'` 时产生来源档，只在触发型自认支持时才带 `listenerScope`⇒编译侧绝不把"听场上"悄悄塞进一个听不懂的时机。 |
| Excel 形态 | 效果组**第四代＝8 列**（v4＝v3＋「我听谁」），宽度靠表头正则探测（`/^效果\d+我听谁$/` 优先，再 `/^效果\d+门槛$/`）⇒旧 3/6/7 列文件照旧导入＝该组没填；**导出固定列从 12 列变 13 列**（技能级「我听谁」在第 13 列），逐效果那列在 `21+8n`；解析侧**全部按表头名定位、不按位置写死**（与「技能门槛」同法）。下拉内容 `LISTENER_SCOPE_LIST`（`无`＋三档）、两列表头各贴 `LISTENER_SCOPE_HINT` 批注（**两列都要贴**，v2.8.11 那次"只贴第一列把第二列挤掉"的教训照搬）。 |
| 三种点名，绝不静默 | ①词表认不出⇒「这词我不认识，所以没记下」；②认得出但**这一行的触发时机不认这一栏**⇒「触发时机「…」不听这一栏，按没填处理」；③这一行根本没有触发时机⇒「没处可挂，按没填处理」。技能级与效果级各有对应四条，全走既有 `parseWarnings` 通道。④**只写了「我听谁」没写是哪个效果⇒不凭空造空效果**（`orphanGate` 那条纪律扩到这一栏）。理由＝§12-55 同族：**存得下来却没人读＝下一轮的"显示与生效分叉"**，与 `forced` 那笔债同一形态。 |
| 旧主名只进不出 | `LEGACY_TRIGGER_CELL_ALIASES`＝**整格**别名（旧文件那一格整句就是「成为攻击目标时」），归一成正现行写法「成为目标时→成为攻击目标」再走严格读法；**写出侧只出现行写法**。主名这次改的是**泛指词**，比细分换词更危险：不认这枚别名的后果＝老 `.xlsx` 里那四条受击类技能读成"没看懂"⇒技能照进、照显示、**只是不再响**（静默失效，比读不懂更难查）。 |
| 重导自己的导出＝零改动 | `canonTrigger` 把两个新维**按默认档归一**后再比（`targetSubType ?? (type==='onBecomingTarget'?'attackTarget':null)`、`listenerScope ?? 'self'`）。不归一⇒"没写"与"显式写了默认档"在比对口径上不同⇒把自己早先导出的 Excel 原样重导会凭空多出 ✏️ 覆盖记录（#45 同族，实测定在 `skillExcelParsers.test.ts`）。 |
| 录入面 | `TriggerEditor` 出两个下拉（「└ 被谁指名」「└ 我听谁」），**各自独立成键**（`patchTrigger`：清空哪一格只掉哪一格；照搬旧的 `handleSubChange` 会顺手抹掉另一轴——第一版就踩了）；预览句把默认档也写全（「成为目标时→成为攻击目标」，界面不说半句话）。「回合结束时」等不认这一栏的时机**根本不给这一栏**。 |
| 词汇表 | `PLAYER_GLOSSARY.md` 新增两行（「我听谁」三档逐字、「被谁指名」三档逐字）并改写 §四 收尾段⇒`npm run glossary-xlsx` 重投影（`词汇表.xlsx` 入库），四条 md 守卫全绿。 |
| 真机证据（dev 5175、热座房、全程真实点击、未旁路引擎） | ①两枚下拉**只在认这一栏的时机出现**（「成为目标时」有、「回合结束时」无）；②真点下拉→选项/提示句/预览逐字→保存后 store＝`{"type":"onBecomingTarget","targetSubType":"anyTarget","listenerScope":"field"}`；③点导出→**拦下 anchor 的 click 事件**（ExcelJS 走的是 dispatchEvent 不是 `anchor.click()`，第一版拦错对象得 0 计数）抓到 42,280 B 工作簿，表头含 `'技能门槛','我听谁',…,'效果1我听谁'`；④**把自家导出原样重导⇒0 改动**（「从 0 个工作表导入 0 名将领」，官方将按 §H3 只读被拒＝零改动形状的正确读数）；⑤**Excel→store→GUI 回读**＝用页面自己的词表模块造一份带 `attackTarget`＋`allySeat` 的工作簿导入，store 与下拉显示两侧逐字。如实披露：GUI→Excel 的**非默认值写出**没有活样本⇒导出面只走到"没填＝写「无」"，那条分支由单测作证（见下行）；以及 dev-only 钩子开开发者模式（口令不为我所知、不落任何载体）。 |
| 结构性缺口如实登记（**归 #38，不是本刀遗漏**） | 导出走 `handleExport` 遍历 `allGenerals`＝**官方池**，而官方将在非开发者模式下只读、本地新建的 DIY 将只住在 `store.authoredGenerals`（经 `poolGenerals` 供对局用）⇒**用户自己写的将根本进不了导出**。这就是上一条"非默认值写出的 GUI→Excel 往返只有单测作证"的根因，与演练窗"将领来源"开关同刀治。 |
| 测试面 | 872/80 ⇒ **900/81**（＋28 例＝新 `src/skills/listenerScope.test.ts` 12＋`skillExcelFormat.test.ts` 9＋`skillExcelParsers.test.ts` 7）。分层：编译映射 6（含"非「成为目标」的时机不产生来源档"与"选择其一不再跨档合并"）／**桥接消费走真实对局 6**（缺省只听自己×2、听己方同席位、听场上跨席位、来源档只算攻击、**打本营那一声三档都不响**）／Excel 列读写与三种点名 9／两栏接线与旧 12 列文件逐字照旧＋重导自己＝零改动 7。覆盖率 All files 61.05/52.69/51.5/66.15。 |
| 锚（A 级：动了监听消费面＝可能改变既有触发输入） | B12 **{"1":106,"2":194}**、B11 **{"1":108,"2":192}**，定稿树各两轮 `cmp` 逐字节全等（§H10 末行有复现记录与小账）。成因见上两行"缺省档"＋"无发射器"⇒新代码在这两池下**没有入口**；值变即换名（§H10 锚名规则）。 |
| 本刀**没做**的（不做≠欠账，逐项有归属） | 「我听谁」的**响应权语义**（谁有资格被问）与**派发顺序**＝#71；`damageType:'skill'` 的 BEFORE_DAMAGE **发射器**＝#70/#71；决斗两端「成为技能目标」与「收官累计」＝#70；强制发动/锁定技执法＝#43 刀 2（与 #71 同源，必须同批或在其后）；**比较器两条组内轴**（座次绕圈／决斗收官"受邀者→发起者"）已按 §H9 第十轮钉进纸面，本刀一行代码未写。 |

**本刀新增的可复用判据**：
1. **正交轴各占一格**：一个游戏事实若有两维可挑（哪种伤害 × 听谁），别把它们挤进同一句话或同一个字段；挤进一句话迟早要发明分隔符，挤进一个字段迟早要组合枚举爆炸。`supportsListenerScope` 与 `getTriggerSubOptions` 分立就是这条的形状。
2. **扩"听得更宽"必须逐型复核事件键的在场性**：新档最容易破坏的不是自己的分支，而是**过去靠"缺键"挡住的既有事实**（打本营案）。每个参与比较的键都要问"这一型事件到底带不带它"，并给缺键档配一条负例钉。
3. **改主名比换细分词更危险，且失败是静默的**：读不懂细分＝原句点名还能查；主名整体改了会让老文件整格"没看懂"，技能照进、照显示、只是不再响。整格别名＋"写出侧只出现行写法"是这一族的唯一安全形状。
4. **能力刀要自己点名哪一档还没通**：录入面就地写一句"对局里现在不会响"，比让下一轮从代码里考古便宜得多；同时严格区分"还没交发射器"（本刀，在册）与"看起来能响其实不响"（禁止）。

### 数值修正器管线（2.8 刀4＝#25；§H5-2/3/4/7 四组语义＋用户 2026-10-02 逐轮补充裁决；**能力刀：动 `src/domain`＋`src/core`＋`src/skills`＋录入面＋词汇表 ⇒ A 级硬锚=对 B13 与 B14 同时逐字**；事前预测＝官方 95 将与仓库 DIY 样本**零实例**（改数字类效果一张都没有：官方在用的效果类型只有 6 种，`modifyAttack`/`modifyDefense` 只出现在类型定义与标签各一行）⇒ 本刀对既有内容是结构性 no-op；先填表后动刀，本表即施工与评审判据）

#### 一、本轮用户裁决清单（2026-10-02，逐条原文口径；本节以下每一条都必须能指回这里）

1. **离场分三种**：①被击破 ②被返回手卡 ③被技能【调离】。【调离】＝进入临时的【调离区】（类似游戏王除外区），直到**其所属玩家的下一回合开始时**【回归】到被调离时的位置。**【回归】不算登场**。
2. **离场打断一切，优先于任何周期写法**：无论周期是"直到被击杀前""直到被返回手卡前""直到下个回合结束"还是别的，**只要离场一律当场打断**，与离场是哪一种无关。**回场不续**＝回来是新的一笔（新序号），不继承旧账。（⇒ 本条**作废**上一版登记推论"周期写法决定哪几种离场会停"；也⇒ 现网六值里 `untilDeath` 与 `untilLeaveField` **同义**：录入面两档照原样留着、旧文件照读，结算侧同一实现；"直到被返回手卡前"**不需新增格子**。）
3. **持续生效类若无触发条件＝在场即生效**（武圣这类"改初始数值"走此形态，不走"登场时发动"）：它**不是发动**、**不进问窗**、**不消耗"回合限 1 次"额度**、**不依赖 `forced` 那一格**；登场／调离回归／读档恢复三个入口都不是"发动"，只有一条规则"人在账上就有这笔"。
4. **改数＝一笔账，两种动作形态**：**增减**（`±整数`）与**固定**（固定为 x 值）。**固定优先度高于增减**——有固定生效期间，该数字上的增减一律不参与；**同侧两笔固定打架按发动先后，后发的覆盖先发的**；**跨侧（造成 vs 受到）按 §H5-3 已裁的入算次序定赢家**（造方侧先入算、受方侧后入算 ⇒ 受方的固定覆盖造方的固定）。**固定失效后（到期／被抵消／其来源离场），此前那些增减恢复参与**（增减一直在账上，只是不被读）。⇒ 采纳本口径后**不重排现网问窗次序**（那是响应链刀 #71/#72 已裁已上线的规矩）：**谁先被问＝表态权，谁最后覆写数字＝算术位次**，两件事分开。
5. **看得见／看不见不设录入栏**，由数字种类决定（攻击力／体力上限／当前体力＝可视；受到伤害增减／造成伤害增减＝不可视，只在结算提示里体现）。
6. **多来源改同一个数＝按发动先后叠**；**每笔带归属**（谁的技能给的＋给的是谁，§H7），这也是"改数的人离场"与"被改的人离场"两条判定的依据。⇒ 两条都已裁：发起者离场＝该笔当场结束；**被改者离场＝该笔也当场结束**。
7. **护甲拆成两句**：①**护甲的点数**不进数值修正器体系（仍是挡伤通道，2 甲抵 1 单点出口 `core/armorDamage.ts:8-28`）；②**护甲的抵扣规则**（几点抵 1、或干脆不抵＝"能叠但不抵扣"）是**另一类可改的东西**＝规则参数，不是某个将的某个数。
8. **减伤是独立一等量，绝不借护甲通道**：判据"身上有没有护甲"**只读 `currentArmor`，永不看减伤值**（用户反例：把减伤当假护甲会让"没护甲时受到伤害−1"与"有护甲时受到伤害+2"同时在场时算出多受 1 点伤害）。**逐点直减**（−1 就抵 1 点），**不套"攒够 2 点才抵 1 点"的比例**；在护甲抵挡之前入算；重复发动＝叠加。
9. **受到伤害／造成伤害的判定＝口径乙＋本轮新增**：响不响看"挨没挨到"（体力**或**护甲任一有变化＝受到了伤害）；判定值＝**只看体力掉量**（护甲掉量不算进数额）。⇒ 两种情形切开：**甲＝这一刀压根没打出来**（结算前伤害数 ≤0，含被减伤抵到 0）⇒ 不算造成、不算受到，两声都不响（§H5-4 原文）；**乙＝打出来了（≥1）但被护甲全挡**⇒ 算挨到、算造成，**按次数触发的照响**，判定值＝0 ⇒ **按伤害量触发的不响**（0 能响＝空发）。造成伤害类同理。〔**2026-10-03 本条前半（"响不响"那一半）被用户重新裁定推翻，v2.8.27＝2.8 刀5 已按新口径落地**：现行判据＝**只有体力真的减少才算"受到了伤害"**，"体力**或**护甲任一有变化＝挨到了"作废⇒护甲吃满那一刀、或被摁到 ≤0 的那一刀**压根不派生 `INJURY`**，于是"按次数触发的照响"这一句在护甲吃满的情形下**也不再响**（不是判定值变成 0 的问题，而是那一声明根本没有发生）。"判定值＝只看体力掉量"那半句照旧；受击那一枚事件从两声（`DAMAGE`＋`DUEL_INJURY`）收成一声 `INJURY`（决斗那笔带 `duelStage:'injury'`）。原话与十条裁决＝**§12-93**；落地形态与证人＝**§F `DAMAGE_TAKEN` 行**＋**§H5-4 覆盖指针**＋`core/damageTaken.test.ts`／`skills/statModifierPipeline.test.ts`；〔2026-10-03 闸③销账轮补〕"旧录像带旧名⇒不崩不重复扣血"那半句自此也有钉子＝`core/EventProcessor.test.ts`「旧录像里的退役事件名」三例（旧名／现名／控制组，断言整棵状态逐字不变）。旧表述按"历史日志记当时认知"不回改，以本括注为覆盖指针。〕
10. **上限的算术**：改体力上限**不跟当前体力**；上限回落时把当前体力**截断到新上限**；**截断不算伤害、也不算"失去体力"**；**不允许场上存在 0 上限的将领存活** ⇒ 截断到 0 **当场阵亡**；登场即会被截断到 0 的**允许登场、随后立刻阵亡**。
11. **归零之死的死因分流**：`DEATH` 事件带**死因**，四个消费者各读各的——击破补偿抽 1 张（`chainedConsequences.ts:155-168`，现网完全挂在 DEATH 上）与「阵亡」列**不分死因**；记某人一次「击杀」与遗言技「自身被击杀时」（`onDeath`，在编译支持表内）与登场技**只认被击破**，归零之死**一律不响、不记**。
12. **锁定技不可被无效／改变**：不为它凭空造"取消/无效"效果（那属发明玩法），但地基要造＝**全库只留一个"移除或改写别人那笔账"的入口**，每笔账带一位由锁定技徽章派生的「不可被移走」，那个入口读它并拒绝。⇒ 今天该保护**无任何官方卡实例可触发**（能结算的效果类型 10 种里没有"无效/取消"，`onOtherSkillActivated` 不在支持表＝连"别的技能发动时"这一声都还没进料口），证人＝一次性探针构造一条"试图移走锁定技那笔"、断言被拒。**将来第一个能改别人的效果被写出来的那一刻就自动被挡，不返工。**
13. **"按伤害量触发"这一格本轮加上**（录入面与 Excel 都要有格子，否则第 9 条那条规则只能躺在契约表里）。
14. **终局封闭清单作废**（用户 2026-10-02 明确保留意见）：技能会改的东西远比第 3 条那六格多——烧牌数、行动次数、一次走几格、回合内补给次数、登场次数、本营体力回复、每回合抽几张、决斗轮次、射程、手牌上限、护甲抵扣比例。⇒ 本节的做法＝**管线一次建好，每个量登记一次**（键＋现网谁读它＋接线档位），"以后这个技能出现时能不能正常生效"逐量给答案，不追求一张终局清单。

#### 二、十二格表

| 格 | 契约 |
|---|---|
| Event | **新增一条 canonical 事件**＝`STAT_MODIFY`（v2.8 刀4 施工时按 `Event.ts:26-31` 那条总规矩定的：引擎里每一条会改状态的事实都是一条事件，必须自己留痕）。账本本身住在 `EngineState.statModifiers`（A 类事实），事件是它的**落笔／销笔留痕**：`op:'ADD'` 带不含 id/seq 的账目内容（号由处理器从当时账本纯派生，零 RNG），`op:'REMOVE'` 带被销的笔 id。**空账本＝零新事件**（旧档、旧录像、既有对局一字不多＝两锚 B13/B14 逐字不换名的结构保证）。发动侧沿用 canonical `ACTIVATE_SKILL`；"在场持续"类**不发**发动事件（它不是发动，第 3 条）。 |
| Timing | 修正器**在结算被读**，不在注册时改变世界：注册时刻＝该笔生效那一刻（发动／在场重推），读取时刻＝被改量的消费点（攻击力＝`getAttackValue`，受到伤害＝护甲抵挡之前，见第 8/9 条）。 |
| Source | 每笔必带 `ownerGeneralId`＋`ownerPlayerId`＝这笔账是谁的技能产生的（§H7"分来源"的真实含义＝归属标记，不是类别枚举）。发起者离场 ⇒ 该笔当场结束。 |
| Target | 每笔必带受影响者的 runtime card id（同决斗那轨的"双侧各带齐"）；被改者离场 ⇒ 该笔同样当场结束。目标解析复用既有 `SELF`/`ATTACKER`/`TARGET` 角色，**本刀不扩目标枚举**（本营回复要的新目标档属 #28 刀7）。 |
| Condition | 门槛照 v2.8.3 录入面既有形状，本刀**不扩门槛谓词表**。诚实空转清单（逐条要有测试）：账本为空 ⇒ 全部读数走基础值；不可移走位在没有"移除"调用方时是**只被探针验证**的空转项，不得报成"已在对局中验证"。 |
| Effect | 两种动作形态：**增减**（累加，按序号先后叠）与**固定**（覆写为 x，期间同量上的增减一律不参与；同侧后发覆盖先发；跨侧按 §H5-3 入算次序定赢家）。**导出形态**：可视量进面板读数，不可视量只进结算提示。**判定值**改道：攻击路径 `actualDamage`（`hpLost+armorLost`）**降级为只用来判"挨没挨到"**，判定值改用 `hpLost`（⇒ 官方 7 张「受到伤害后」全是定额效果、不读判定值 ⇒ 读数不变）。 |
| RNG | **零新增随机面**：账本条目 id＝确定性递增序号，重排／截断／覆写全是纯函数 ⇒ 同配置两跑逐字节一致（A 级硬锚的前提）。 |
| Replay | **A 类必录**：在效账本与死因字段进 `EngineState` ⇒ 进录像、进重建。**禁止**把"当前有哪些账"做成组件本地态（那会造成常驻≠重建）。**反向也禁止**：`getAttackValue`／`effectiveMaxHp` 这类**读数永远是账本的确定性投影，绝不写回卡面对象、绝不进任何第二套持久化**（存档／录像／store 快照里出现一个"当前攻击力 3"就是错的——外部复核 Q1 采纳项，与本表 Timing 格"注册时不改变世界"同源）。 |
| Transition | 唯一 `TransitionCore.transition`；账本变更只住在纯 `(state,event)→state` 里。⇒ 三处硬规矩：顶层 `version` **恒为 1**；新字段以**可选带默认**加入；`store/gameStateAdapter.ts:76-124` **必须逐字段手搬**（漏一个字段＝重建≠常驻，`engineFactContract.test.ts:112-123` 会红）。 |
| 队列前置权 | **不新增**。修正器不派生事件块、不插队；只在既有事件的结算步里被读。 |
| Reentrancy / 监听 | 账本读写不进 `resolveTriggerChain`；在场持续的"重推"是纯派生（按在场者重算该笔在不在账），**不发监听、不产生第二状态来源**。**唯一移除入口**＝锁定技不可移走位的读取点（第 12 条），任何将来的"取消/无效"必须走它。⇒ 由此得一条**施工时才暴露的落差**（v2.8 刀4 已补）：`STAT_MODIFY` **故意不进** `TRIGGER_REENTRY_TYPES`（进了＝允许技能听见账本读写⇒同一笔账响两遍），可它也**必须**出现在事件流里（Event 格那条留痕规矩）。这两句合起来意味着：派生点内联追加的那支到不了 `events`（`EventProcessor.process` 只把它收进 `collected`）。解法＝专用回显 `echoStatTraces`（`core/TransitionCore.ts`，与决斗那两层回显同源、同一条身份过滤——发动那一支本来就走触发链、已在流里，绝不补第二遍），放在重入环的入口与每一轮 `process` 之后⇒主路与决斗续跑两拨都覆盖。**没有在场改数技时 `derived` 里一条都没有⇒事件流逐字不变。** |
| Death chain | 新增一条死因：`MAX_HP_ZERO`（上限归零之死）≠ `DEFEATED`。归零之死＝**阵亡＋自家补抽 1 张**，**不记击杀、不响遗言**；登场即归零＝**允许登场、随后立刻阵亡**（登场技与遗言都不响）。截断本身**不算伤害、不算失去体力** ⇒ 不走 `applyDamageEvent` 的扣血路，只走"截断→判死"。 |
| 优先级 | 修正器不自带优先级；**同侧先后＝发动序号**，**跨侧先后＝§H5-3 已裁的入算次序**（攻击力增减 → 受到伤害增减（含减伤）→ 护甲抵挡）。 |
| 忠实度 | **内置零转正**：本刀不改动任何官方卡、不给现网卡塞新效果（A/B/C 标签随转正刀补打）。活例一律用**仓库 DIY fixture＋一次性探针**构造，且 `compileGeneralSkills` 的 `skipped` 必须为空数组（防空转，§12-58 那族判据）。 |
| 三处同步 | ①`SkillRuntimeEffect.type` 联合＋`dataTypes.DataSkillEffectType`（新增"数值修正"类效果与"按量"标记）；②`skillCompiler.SUPPORTED_EFFECT_TYPES`＋`SUPPORTED_TRIGGER_MAP`（**`passive` 首次进支持表**）＋`toEffectData` 逐字透传（§12-56①：判别根产出的结构化信息，每段搬运管道必须逐字携带）；③录入面 Excel 效果组列宽与编辑器控件＋**严格反写读法**（v2.8.3 纪律：解析后必须反写成与原句逐字相同）＋旧文件照读（单向门，旧词进别名表）。 |
| 活例（合成钉形，逐条落测试文件） | ①在场持续：登场⇒+1 在账（`skills/passiveModifiers.test.ts`＋`skills/statModifierPipeline.test.ts`）；②离场打断一切：阵亡⇒名下与落在它身上的两半都断（`skills/statModifierPipeline.test.ts`「阵亡⇒连"落在它身上"的那一半账也当场结束」那例），回场＝新序号一笔——**引擎里还没有"调离／返回手卡"这两种离场**，故本刀只对到阵亡一型（第 1 条那三种＝#27 之后的调离区那一刀）；③同侧两笔固定⇒后者赢（`core/statModifiers.test.ts`）；④跨侧固定⇒受方赢——**要两个读数点都在**才谈得上跨侧，本刀只接了造方那三把，故只对到"当事人 vs 第三方"这一半（`statModifiers.test.ts` 丙案那例）；⑤固定失效⇒此前增减恢复参与（同文件）；⑥减伤与护甲分家；⑦甲情形（伤害抵到 0）⇒两声都不响；⑧乙情形（护甲全挡）⇒按次数响、按量不响——**⑥⑦⑧ 全属 #26 刀5**（`DAMAGE_TAKEN`/`DAMAGE_DEALT` 本刀只登记不接线，没有读数点⇒无法落测试，见"可改量注册表"那三行的更正）〔**v2.8.27 刀5 落地＋就地更正**：⑥⑦ 照旧成立并有真链路证人（`statModifierPipeline.test.ts` 那一段的新块：「固定压在护甲之前那一格上：『受到的伤害固定为 1』×近战 5 ⇒ 护甲照旧吃掉那 1 点」＝⑥，「伤害被摁到 0＝这一声同样不存在，而"成为攻击目标"那一侧照旧问」＝⑦）。**⑧ 的口径已被用户 2026-10-03 重新裁定推翻**（原话："只有掉血才算受到伤害，只掉护甲或者伤害≤0都不算受到伤害"）⇒今日形态＝**护甲全挡时 `INJURY` 那一声明压根不发，"受到伤害后"一声不响**（不再有"按次数响、按量不响"这种半响），证人＝`statModifierPipeline.test.ts`「护甲吃满那一刀＝这一声不存在：不掉血⇒『受到伤害后』压根不响」＋真机 E2E（护甲全挡⇒无 `INJURY`、无 `REACTION_QUEUE_SYNCED`、问窗开不出来）＋派生点那条 `hpLost>0` 判据。原括注"只登记不接线"同日作废：`DAMAGE_TAKEN` 已接线、`DAMAGE_DEALT` 仍只登记（用户裁"本刀不接"）。〕；⑨上限回落截断⇒不算伤害、不记击杀、自家补抽、遗言不响（`statModifierPipeline.test.ts`「上限被改小⇒当前体力当场截回来，且不记成伤害、不记成失去体力」＋「归零之死的死因分流：不记击杀、不响遗言，自家补抽照旧」两例；后者同文件还配了一条**反例**「被击破之死仍然响遗言、记击杀」＝证明"拒响"是按死因拒的，不是把 onDeath/onKill 整条链路关掉）；⑩登场即截断到 0⇒允许登场后立刻阵亡（同文件「上限被固定成 0⇒这一员将不许存活，收尸路与伤害致死同一条」；"收尸同一条"这半句现另有实测钉「归零之死身上那一叠军备随人下葬：不分牌面类型、一律进弃牌堆，料堆一格不收」——施工时本处理器里私自分出了"非军备回料堆"的第二路，与既有致死收尸不一致，已按既有口径改回，见本节末登记注）；⑪探针试图移走锁定技那笔⇒被拒（`statModifiers.test.ts` 的 `revokeModifier` 那组＋`passiveModifiers.test.ts` 的徽章正反两钉）；⑫四路等价（常驻／store 桥接／重建／录像）逐事件一致（`core/transitionEquivalence.test.ts`「修正器账本 · 四路对账」两例：正例钉 `STAT_MODIFY` 落在登场那一步＋账号 `sm:1`＋回放重建的账本与实况逐字同一本；反例钉"没有在场技⇒流里一条 `STAT_MODIFY` 都不多、伤害回到卡面算术"＝两锚不换名的结构保证）；⑬录入面两路各自有钉：Excel 三格＝`skills/skillExcelFormat.test.ts`「改哪个数／怎么改／有效周期」那一组（列名与下拉词表、枚举名两式都认、严格往返逐字相同、旧档 8 列形状**点名**缺格、非改数类型逐格点名、目标≠自身点名并强制收 SELF、数值四档含「增减 0 点名／固定为负数点名／『全部』不认」、只写三格不造效果、Excel→编译器正负两钉）；编辑器三格＝`components/SkillEditor.runtime.test.tsx`「『修改数值』的三格（改哪个数／怎么改／有效周期）录入并进了存档，编译器照收」（三道缺省＝近战／增减／留空那一档，存档逐字含 `target:'SELF'`，带触发即成一条定义且零 `MODIFY_STAT_INCOMPLETE`）。 |

#### 三、可改量注册表（每个量＝键＋现网谁读它＋接线档位；"以后能不能生效"逐量给答案）

| 键 | 大白话 | 现网读它的地方（坐标） | 本刀 | 档位与代价 |
|---|---|---|---|---|
| `MELEE_ATK` / `RANGED_ATK` | 近战／远程攻击力 | 登场写一次 `generalEvents.ts:44`，打架读 `attackValue.ts:12-17`，面板 `GameBoard.tsx:704` | **接线** | 读点唯一 |
| `MAX_HP` | 体力上限 | 登场／面板／补给封顶 `SupplyResolver.ts:41`／叠甲封顶 `ArmorResolver.ts:51`／悬停提示 | **接线** | 读点 4 处，须同一视图 |
| `CURRENT_HP` | 当前体力 | 只有 `applyDamageEvent`／HEAL 两处写它，**没有"读一个数再算"的消费点** | **只登记不接线**（v2.8 刀4 施工时更正：原表写"接线"，与代码里的 `WIRED_STAT_KEYS`（`core/statModifiers.ts:26`）不符） | 改当前体力本身是另一形态：直接写血不是修正器 ⇒ 等 #26 刀5 决定它要不要读数点 |
| `DAMAGE_TAKEN` | 受到的伤害增减（**含减伤，独立于护甲**） | **护甲之前的那一格**＝`core/damageTaken.ts`（唯一算式：原始伤害→受到伤害修正→护甲抵扣→最终扣血），三个进料口共用这一个纯函数：普攻预解（`action/resolvers/AttackResolver.ts`）／决斗逐轮预解（`core/eventProcessors/duelEvents.ts`，带本地账本线程）／技能伤害结算时现读（`core/eventProcessors/damageEvents.ts`） | **已接线（v2.8.27＝2.8 刀5）** | 形状与三条硬口径：①**修正挂在护甲之前**，既有护甲单点出口 `core/armorDamage.ts` 一字未改、只消费它的**结果**（把"+1"挂到扣完护甲的出口＝语义变成"最终伤害+1"，那是另一个数）；②**一次性账 `thisDamage`**（「下一次受到伤害−1」）＝一笔只挡一刀，同一次读数里最多销掉最早那一笔，被「固定」压住的那笔不算用掉；决斗里"下 1 次"只算一轮、"2 次"算两轮（用户 2026-10-03 裁 7）；销账走 canonical `STAT_MODIFY{op:'REMOVE',cause:'DAMAGE_TAKEN'}`，普攻与逐轮在**发射点**销、技能那一路在**派生侧**复核销（同一个纯函数＋同一本 `before` 账⇒两侧清单必然逐字相同）；③**本营不吃这一格**（用户裁"问二＝不吃；规则上本营单次最多 1 点"）——那条封顶事实住在发射点 `AttackResolver` 的 `Math.min(1, baseDamage)`，账本的键是（座次＋将领实例），本营不是任何一员将⇒结构上没有那一笔账。**已裁判据（决定「受到伤害后」响不响）**：只有真掉了血才算（2026-10-03 重新裁定，推翻 2026-09-28"只掉护甲也算挨到"），落地形态＝`INJURY` 那一声明**压根不发**，不靠任何一处再判断一次。不对称如实登记＝**待裁**：普攻打本营封顶 1 点，技能打本营照卡面数值不封顶（`damageEvents.ts:80` 注释在案）。 |
| `DAMAGE_DEALT` | 造成的伤害增减 | 新格（造方侧读数点） | **只登记不接线**（用户 2026-10-03 裁"问一＝本刀不接"） | 词表照旧不放开。跨侧固定的赢家**已裁＝受方恒盖造方**，实现方式＝**入算次序**（造方先入算、受方后入算⇒后读的覆写先读的），不是问窗先后；刀5 已在 `core/damageTaken.ts` 头注把这一格占好位，接线那把刀只需把造方读数插在**受方入算之前**，账本结构与护甲出口都不用动。 |
| `ARMOR_RATIO` / `ARMOR_ENABLED` | 几点护甲抵 1／护甲是否抵扣 | `armorDamage.ts:15` 那个 while 循环（唯一出口） | **只登记不接线** | 单点、便宜；等一张实例卡再开（不为零造效果） |
| `DRAW_PER_TURN` | 每回合抽几张 | `drawEvents.ts:34/51/56`（回合开始 5、补偿 1，**每条 DRAW_REQUIRED 自带一个数**） | **只登记不接线** | 已有口子 |
| `DUEL_ROUNDS` | 决斗打几轮 | `duelEvents.ts:9` `DUEL_MAX_ROUNDS = 6` | **只登记不接线** | ⇒ **本节同时更正 §F「DUEL 决斗流程原语」判据 3**：那条写"轮数属规则、绝不许做成可填数值"——用户 2026-10-02 裁"存在改决斗轮次的技能"。新口径＝**常量照旧、不给它录入框**（描述里没写就不变），但常量本身可被修正器覆盖。 |
| `BASE_HP` | 本营体力（回复） | 伤害侧只有 `Math.max(0, baseHp - amount)`（`damageEvents.ts:13`），**从没封顶** ⇒ 用户口径"本营体力没有上限"与现网不冲突；但**没有任何回复本营的通道**（HEAL 目标枚举只有 SELF/ATTACKER/TARGET） | **只登记不接线** | 要新增目标档＝属 #28 刀7。另：`baseMaxHp: 6`（`runtimeSetup.ts:88`、`matchSetup.ts:286`）字面像上限、实为初始值 ⇒ 登记待更正项，**不当已有上限** |
| `ATTACK_TIMES` / `MOVE_TIMES` / `SUPPLY_TIMES` | 一回合能打几次／走几次／补几次 | 现网是**三个布尔**：`AttackResolver.ts:89`、`MoveGeneralResolver.ts:125`、`SupplyResolver.ts:36`，回合开始清零 `turnEvents.ts:30`＋`generalEvents.ts:50-51` | **只登记不接线** | **档二：布尔→计数＝改 canonical 事实形状 ⇒ 另立一刀、必换锚**（AI 就靠这三个布尔决定行动） |
| `DEPLOY_TIMES` | 登场次数（规则上现不限次） | **根本没有这个字段** | **只登记不接线** | 档二，与上一行同一刀最便宜 |
| `MOVE_DISTANCE` | 一次走几格 | 移动是"点一格"的区域推进语义（`battlefieldRules.ts:38/76/80`），**不是距离数字** | **只登记不接线** | 档二＋**要用户给形态规则** |
| `CARD_COST` | 行动烧几张牌（别人多烧／自己少烧） | 写死在按钮与校验两处（近战／远程 −1 牌、文将前进 −1 牌、补给按张、敌方区域 ＋1 张） | **只登记不接线** | 档三：先把"行动成本"从界面话里抽成一个数（需一次专项清点） |
| `HAND_LIMIT` | 手牌上限 | **全库零命中**（现场量过） | **只登记不接线** | 档三：＝新规则＋新数＋"回合结束清理"新结算时刻 |
| `RANGE` | 射程 | 区域制（`battlefieldRules.ts:120`、`combatRules.ts:12`） | **只登记不接线** | 档三＋**要用户给规则**（"射程+1"指多够一块区域，还是松掉某块区域的限制？） |

#### 四、今日无实例可触发（如实登记，一律不得报成"已在对局中验证"）

在场持续（`passive`）0 张卡；"改数字"六格 0 张卡；按伤害量触发 0 张卡；锁定技保护 0 张卡（且世上还没有"能改别人的效果"）；归零之死 0 例（没有能改上限的卡）；调离与返回手卡 0 例（引擎里还没这两种离场——本刀只保证"人不在场＝账断"，【调离区】本身是另一刀）。⇒ 全部用**仓库 DIY fixture＋一次性探针**做出活例来验，第 5 条那十二个钉形逐条落测试。

#### 五、用户裁决（两格，**均已裁**——2026-10-02 当日原话＋2026-10-02 晚间复核确认，本节不再是"待裁"）

1. **"受到的伤害固定为 1"作用在哪一步**：**已裁＝作用在进护甲之前**的那个数（与减伤同一侧；护甲照旧 2 甲抵 1）。用户 2026-10-02 晚间原话："伤害固定为 1 那格，既然我裁定过了就按我的裁定来"——即确认此前所裁的**护甲抵扣之前**这一侧，本节上方原文中"仍等您裁"为登记滞后，自本条起作废。刀5 接线按这一侧开工（见 `DAMAGE_TAKEN` 行刀5 形状）。
2. **固定能否固定成 0**：按**能**，并自动落到第 9 条的**甲情形**（压根没打出来 ⇒ 两声都不响），与现册一致、不新增规则。

#### 六、本刀新增的可复用判据

1. **"离场"是一有三值的轴，不是布尔**：任何写"离场即终止"的契约，必须先问"哪一种离场"；本刀的答案是"三种都终止"，于是`untilDeath`/`untilLeaveField` 同义、"直到被返回手卡前"不需新增——**把总闸立在周期之上，比逐档枚举离场类型少一格、也少一处漏**。
2. **"表态权"与"算术位次"要分开**：谁先被问（响应链次序）与谁最后覆写数字（入算次序）是两件事。混为一谈会逼这刀去重排已上线的问窗次序（⇒ 无谓换锚）；分开后，跨侧固定的赢家直接由 §H5-3 那条**已裁**的算术次序给出，零新规则。
3. **"以后能不能生效"要用注册表回答，不用形容词回答**：每个量给"键＋现网谁读它＋接线档位"三件；接线档位按**插入点形态**分三档（现成读数／布尔要改形／根本没有该量），第三档必须先造量再谈技能。没有这三件，"支持"两个字就是空转承诺（§12-88⑦、§12-90 同族）。
4. **规则的比喻不能升格成实现**：用户给的是"看不见的护甲"这一比喻，但同一个消息里给出的反例恰好证明它**不能**是护甲。判据＝**采纳意图（独立一等量＋在护甲之前），拒绝载体复用**（绝不进 `applyArmorDamage`、绝不影响"身上有无护甲"的判据），并把这个反例本身钉成测试。
5. **"必须留痕"与"不许被监听"是两格契约，会互相拉扯**：Event 格要求每条改状态的事实都进事件流，Reentrancy 格要求账本读写不进触发链。两者同时满足的落地形态＝**专用回显＋身份过滤**（`echoStatTraces`），而不是把 `STAT_MODIFY` 塞进 `TRIGGER_REENTRY_TYPES`（那等于允许技能听见账本读写⇒同一笔账响两遍）。可核对的判据两条：空账本⇒事件流逐字不变（＝两锚 B13/B14 不换名的结构保证）；回放重建出来的账本与实况 `toEqual`（＝A 类事实真的进录像）。
6. **"本刀没接线的钥匙不进录入面词表"**：账本的数据形状收得下五个键，但只有三把有读数点⇒`StatModifierKeyType` 只放开三把（近战／远程／体力上限）。放开其余＝"看起来能响其实不响"，那是本项目明令禁止的第三种谎；接线那一刻再进词表，Excel 那一栏的形状不用返工。〔**v2.8.27 刀5 兑现实证**：第四把钥匙（受到的伤害）接线时才进词表，`WIRED_STAT_KEYS` 从 3→4，Excel 列数、下拉结构、严格反写读法**一字未动**（只多两个枚举值＋一档周期词），旧文件照读。同一条判据顺手管住周期：`thisDamage` 只对「受到的伤害」有意义⇒挂到别的钥匙上编译时点名跳过（`MODIFY_STAT_ONESHOT_KEY_UNSUPPORTED`），绝不收下一笔没人去销的账。〕
7. **跳过理由要成册**（编译器与导入面各拦一处，两处的名字必须能对上）：本刀新增 `MODIFY_STAT_INCOMPLETE`（三样里少任何一样）、`PASSIVE_CONDITION_UNSUPPORTED`（在场技带门槛：今天没有中途重算的发射器）、`PASSIVE_DURATION_CONFLICT`（在场技又填周期：两条规则说相反的话）、`PASSIVE_CHOICE_UNSUPPORTED`（在场技混进「选择其一」：按定义不进问窗⇒没人能替它择一）。四条全是**点名跳过＋把话交回录入面**，绝不静默收下。
8. **"能力已具备"与"内容已启用"必须各有证人**（外部复核 Q3 采纳项，2026-10-02）："两锚逐字不换名"有两个完全不同的原因——账本没接线（代码缺陷）与账本接线了但官方池里零张卡能触发它（内容现状）。只靠对局锚，前者会被误读成后者。本刀的落地＝一条**不跑对局的静态断言**（`skills/passiveModifiers.test.ts`「官方卡池的入口存在性」两例：95 将里既不许出现 `passive` 触发、也不许出现 `MODIFY_STAT` 效果；逐位将走一遍落笔⇒空数组）。它把"入口存在性"钉成测试，第一张改数官方卡落地那一刻当场变红＝换锚那一刀要显式处理的事，不是一起事故。**边界（同一轮外部复核自己给的）**：静态断言只证明"没有漏登记/漏接线"，**不能**证明运行时真走到了入口⇒真机事件验收（本轮 #85 三条读数）不可被它替代。分层因此是三层：账本结构层（单测＋事件流）→ 读数投影层（每个消费点各钉）→ 内容接入层（真进官方池才换锚）。
9. **键要绑"语义阶段"，不要绑"当前函数名"**（外部复核 Q4 采纳项）：账本的数据形状能装 5 个键、录入面只放开 3 个，这个"先收形状、后开读数点"本身没有结构缺陷；缺陷只会在**把键与某个现成结算出口硬绑**时出现。判据＝每个未来键登记时写明它作用在算术链的**哪一段**（本表"现网读它的地方"那一列写的必须是阶段＋消费点，而不只是一个函数名），于是后续刀只需新增合法读数点，不需改账本结构。〔**v2.8.27 刀5 兑现**：接线时新增的读点是一个新文件（`core/damageTaken.ts`，护甲之前那一格），`core/armorDamage.ts` 与它的 2 甲抵 1 算式**一个字节都没改**、只改成消费前者的结果；三个进料口（普攻预解／决斗逐轮预解／技能伤害结算现读）共用同一个纯函数⇒"结算侧现读"与"派生侧复核销账"不可能各执一词。这条判据买到的东西＝刀5 没有被迫在护甲之后挂一个语义错位的"+1"。〕

#### 七、本刀遗留的一条硬待办（不靠注释存活）

【调离区】那一刀给引擎加"回归"这条离场返回路径时，**必须在 `skills/passiveModifiers.ts` 补一次落笔**（现在只有"登场"一个入口）。漏了的形状＝人在场上、账却没有——既不报错也不响，正是 §12-55 那一族"记录而未消费"。同一条待办也写在裁决第 3 条（"登场／调离回归／读档恢复三个入口都不是发动"）里，两处同源。

〔登记注：本节＝2026-10-02 刀4 纸面契约先行（提交 `4684114`）。代码与测试随后按本表施工；施工过程暴露并已在表内更正五处：①可改量注册表里 `CURRENT_HP`/`DAMAGE_TAKEN`/`DAMAGE_DEALT` 原写"接线"，与 `WIRED_STAT_KEYS` 不符⇒改为只登记不接线，属 #26 刀5；②Event 格原写"不新增对局事件类型"，实际按 `Event.ts:26-31` 那条总规矩新增了 canonical `STAT_MODIFY`⇒已改写，并补上"空账本⇒零新事件"这条判据；③Reentrancy 格补专用回显 `echoStatTraces` 的口径（第 5 条判据）；④Excel 读格那把共用工具 `readLabeledEnum` 只比大写形，把 `untilSelfTurnEnd`／`delta`／`set` 这类驼峰枚举名一律判成"看不懂"（注释却写着"枚举名与大写法都认"）⇒已改，正反两钉进词表那组；⑤归零之死的收尸在处理器里私自分出"非军备护甲回归属席位料堆"的第二路，与既有 `applyDamageEvent` 的致死收尸（那一叠一律进弃牌堆）不一致，也与 §F 装备三路裁决里"随主阵阵亡＝刻意沉默"相冲突⇒按既有口径改回，并把这条实测钉成活例⑩那例。本节十二条口径本身来自用户当日逐轮原文裁决，无一条由我代推。〕

〔登记注 v2＝2026-10-02 外部复核轮（GPT 网页版，四问逐条判档，归档 `G:\THREE_KINGDOMS\GPT_DISCUSSION_2_8_STATMOD_REPLY.md`）：Q1「账本挂引擎状态＋读数现算」＝**可采纳**，采纳其判据并补进 Replay 格（读数永不进第二套持久化）；Q2「幽灵账」＝**可采纳**，其要求的"在场实例↔账本存在性"不变量本刀已有测试形状（`statModifiers.test.ts`「回场不续旧账：同一枚技能再落一笔是新 id、新 seq」＋「离场打断一切」＋「席位阵亡收的是"这个人有关"的账」；`statModifierPipeline.test.ts`「阵亡⇒连落在它身上的那一半账也当场结束」），**但它点名的"调离→回归无发射器"那一条正是本节第七格那条硬待办**，两半账（它名下的＋落在它身上的）都断这半已由实测钉住；Q3「分层验证」＝**可采纳**，落地成第 8 条判据＋那条不跑对局的入口存在性静态断言；Q4「先收形状后开读数点」＝**可采纳**，采纳为第 9 条判据＋`DAMAGE_TAKEN` 行的刀5 读数阶段口径。总评"刀4 可进登记；但不得把 passive 生命周期契约宣称为已完全闭合"——本轮登记文字遵守这条边界：**#85 的真机读数只证"没有污染旧路径＋账真进结算"，调离区那一刀之前生命周期不算闭合。**〕

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

## H. 内容层与技能语义契约（2026-09-28 用户裁决，**纸面契约、零实现**）

来源=用户四批裁决 + 同日逐项解释（原文在 PROJECT_HANDOFF §12-48）；外部评审两轮归档在仓库外 `G:\THREE_KINGDOMS\GPT_DISCUSSION_2_8_PREREQ_REPLY.md` 与 `GPT_DISCUSSION_2_8_ID_SCHEME_REPLY.md`（含 Q5 补发段，逐段哈希已对账）。**本节每一条在落地前都不得表述为"已具备"**；落地那一刀若增加 canonical 事实（次数、修正器、代价账）即为**内容刀须换锚**，不得宣称对 B10 逐字。
>
> **落地状态（自 v2.8.9 起逐节为准，别照上面那句旧帽子推断）**：**H1、H2、H3 已落地为代码，H8 两条（N1 Excel 导入双入口 + N2 编辑器两把锁）已全部落地为代码，H2 里那条"开发者模式的 DIY 自动化验证＝待建"也已落地（v2.8.9＝仓库固定 DIY fixture + 独立锚 B11）**（H1/2＝`src/domain/generalProvenance.ts` 发号与冻结判据 + store 的 `authoredGenerals`/`poolGenerals` + 编辑器「➕ 新建将领」面板；H3＝`src/domain/generalPolicy.ts` 唯一判定根 + 三层接线，详见下面 H3 小节的落地状态注；H8-N1＝`skillExcelParsers.ts` 的 `resolveGeneralForImport` 三态判别根 + `parseRowPerSkillSheet` 一趟两阶段 + `SkillEditor` 待点选面板三选一，详见下面 H8 小节的落地状态注；非内容刀 ⇒ 对 B10 逐字已实证五次），**H4–H7 仍是纸面契约、零实现，H8 的 N2 半边（编辑器两把锁）已于 v2.8.8 落地**。H1 内那条「现状事实（grep 取证）」写于落地前、保留作历史取证，其中「`source` 不存在」「新建将领的能力也不存在」两句自 v2.8.5 起已不成立。

### H1 将领三字段不变量（编号问题的答案）

- 三个字段：**`id`（档案号）· `identity`（是不是同一张将的唯一判据）· `source`（official | DIY）**。
- **冻结集合＝ `{id, source}` 两个，不是三个**（用户 2026-09-28 更正，原判"三字段创建即冻结"**作废**）：`id` 与 `source` **创建即冻结、此后永不可变**——改名、改身份、改数值、导出再导入都不重生成、不改写、不翻转。
- **`identity` 属可编辑内容字段**（用户原话="身份标识应该是允许修改的才对，不然我创建的时候不小心把身份选错了或者忘记加身份了怎么办"）⇒ 可改的=内容字段 name/**identity**/faction/hp/meleeAtk/rangedAtk/skills/armor/title。这条更正**不是新能力而是既有事实**：编辑器今日就在写它（`SkillEditor.tsx:159` 读、`:243` 写 `generalEdits[g.id].identity`，v2.8.0 §12-43② 真机 E2E 已验证"差异写入=只多 `{identity:'孙策'}` 一键"）⇒ 若把 identity 冻起来，等于**把已上线的行为改成回归**。
- **改身份必须带三道护栏**（身份是玩法字段，可改≠随便改）：⑴ 改身份=改**锁键 `(identity, faction)`** ⇒ 保存时跑同一套冲突检查（`identity.ts` 的 `findIdentityConflicts`），撞锁当场报出"这将改完后与 某某·势力 冲突"，**呈现层只提示、装配层整批拒**（沿用 §F 身份锁契约，不新增第二条路）；⑵ 差异层与 overlay **永远按 `id` 寻址**（今日即如此）⇒ 改名/改身份都不会让历史修改脱靶，此判据要有测试钉；⑶ `source` 与 `id` **不随导出/导入重生成** ⇒ 导出再导入仍是同一条档案（否则历史 overlay 会挂到新号上，属于"静默改身份"的变体）。
- **一条由此引出的设计定形（录入面级，非玩法裁量）**：今日 `identityOf()` 在**未显式填身份**时派生身份=名字（`identity.ts:27-34`）⇒ **改一个没填身份的将的名字，等于改它的锁键**，这是"name≠identity"的反面漏洞。定形=**新建将领时把当时刻意确定的身份显式写入数据**（值可以就等于名字，锁键不变⇒零玩法变化），此后改名不再牵动身份；官方 95 将保持"缺省派生"零数据改动（否则 95 条记录全要重写、且 B10 输入面被搅）。⇒ 编辑器里对**未显式填身份**的将改名时须提示"这会同时改变它的身份锁键"。
- **`source` 不得由 name 或 identity 推断**，也不得靠普通内容编辑翻转（DIY→official 或反向都属**生命周期迁移**，不是属性修改）。
- **命名空间两套**：官方 `G-*`、DIY `D-*`，互不重叠 ⇒ 玩家本地新建无需中心发号，也永不与官方撞号（用户裁决③"编号不许玩家定"由此成立）。
- **`name ≠ identity ≠ id`**：与任何已有将（含官方）同名完全允许，两张"关羽"靠 identity 区分。
- 现状事实（grep 取证）：`General.id` 与 `General.identity?` **已存在**（`src/data/generals.ts:221-236`，identity 只经 `src/domain/identity.ts` 解析）；**`source` 不存在**；全库唯一 DIY 痕迹是 `DIY_IDENTITY='DIY'` 这个弱代理。新建将领的能力也不存在（`createGeneral` 是模块私有、只被 95 名官方将使用）。
- **禁令**：以后任何代码**不得再用 `name + faction` 作 General 的唯一身份判断**。现网已有一处违例即导入路（见 H4）。
- **保留前缀禁令（v2.8.5 落地时由独立复算会话查出、用户侧升为常设判据）**：`src/data/generals.ts` 今后新增的仓库档案号**永不得取 `G-` 或 `D-` 开头**。"玩家的本地内容不可能遮蔽或冒充仓库官方卡"这条不变量**全靠仓库号保持 `wei_001` 式 legacy 形态**（现网 95 将如此，测试逐条钉死）；一旦有人往仓库写 `G-xxx`，本地清单的准入判据（只看命名空间）就会放行冒充，而且**测试不会红**。要往仓库正式池加卡，走"人审后写进 `generals.ts`"那条路（H2），号仍用 legacy 形态。
- **落地状态（v2.8.5·地基刀1）**：本节全部判据已进代码——发号唯一入口 `createAuthoredGeneral`（三条录入面校验：名字非空／`hp>0` 且有限／无随机编号源整单拒；`hp≥4→武将` 沿用 `generals.ts` 既有建卡口径，零玩法新增）、`FROZEN_GENERAL_FIELDS=['id','source']`、`stripFrozenFields`/`isAcceptableAuthoredRecord` 在**读回时**剥掉并 `console.warn`（编辑器、Excel 行、localStorage 三条通路共用同一对判据）、`identity` 创建时**显式落值**（未填=名字／`__none__`=空串=**当前**无身份、此刻不产生锁键；身份是可编辑字段，日后填上就重新参与锁——见格 8 的 v2.8.10 澄清）⇒ 改名不再牵动锁键；`resetGame` **不清**自建清单（玩家资产≠对局状态）。护栏⑴（改身份跑冲突检查）沿用 v2.8.0 既有链路，本刀未新增第二条路。


### H2 「官方」分两层（用户已裁：官方草稿制）

- **`source=official`（权限/来源层）≠ repository official（仓库正式层）**。开发者模式新建=前者（本地官方草稿），**必须人审后写进 `src/data/generals.ts` 才算后者**。
- 因此：**本地/编辑器里的 official 内容一律不进 B10**；真合入官方池那一刀才重算 B10，且旧锚读数继续保留成历史。
- **常设规矩（用户 2026-09-28 定为永久规则）**：**凡要进自动化验证的内容，必须能由仓库里的固定文件完整重建**。localStorage 是玩家可变环境，永远不是 CI 输入；DIY 内容要自动化验证只能走**仓库固定 fixture + 独立锚**，B10 继续只代表官方池。
- **AI/自动化验证与 DIY 的真实关系（用户 2026-09-28 当场更正我登记反了的因果，不得再写成"用户明确不做"）**：① **今日不存在"AI 用 DIY 卡自动对战"这件事，原因是玩法模式而不是权限**——游戏目前**只有标准模式**，而**标准模式不允许使用 DIY 将领**，所以那条路本来就走不通；**自由模式尚未实现**，"DIY 将进 AI 自动对局"要等自由模式立项，属**待建**不属"不做"。② **开发者模式下让 AI 用新建的将领卡与技能跑自动化验证＝用户需求**（原话"我作为开发者，在开发者模式下还是需要让AI使用新建的将领卡和技能进行自动化验证的"）。它的实现路径已由常设规矩限定死：**要么把内容人审合进 `generals.ts`（那就是一次正常的内容刀、换锚），要么在仓库放一份固定 DIY fixture 并单开一条自己的锚**——绝不允许把浏览器 localStorage 变成验证输入。⇒ 本仓库任何文档/代码注释**不得**把"DIY 进 AI 自动对战/自动化验证"写成"用户已否决"；正确表述="标准模式禁 DIY（玩法约束）＋ 开发者模式的 DIY 自动化验证待建（须走固定输入，见上条）"。
- **官方池的数量是时点读数，不是常量**：现网 `generals.ts` 账本＝**95 将**（时点，见「基数纠偏」），用户已明确**以后会更新增加官方卡池**。扩容官方池＝**内容刀**⇒ 装配输入变化 ⇒ **必须换锚**（B10→后续锚），旧锚读数保留成历史；换锚之后，本文件与本仓库文档里所有"95"字样都自动变成"当时的读数"，逐处改写既不现实也无必要，但**任何拿 95 当判据的代码（测试断言池长度）都要随扩容一起更新**，这条已在 `generalProvenance.test.ts` 的"95 个仓库号全为 legacy"钉里如实写明是**当前账本快照**。
- **落地状态（v2.8.5·地基刀1）**：两层归属已成代码——非开发者新建一律 `DIY`+`D-*`（store 的 `addAuthoredGeneral` 先把请求归属过一道 `developerMode` 门，拿不到就是 DIY），开发者模式新建得 `official`+`G-*`＝**本地官方草稿**，`isRepositoryOfficial()` 仍判 false（判据＝是否住在 `generals.ts` 账本，与 `source` 字段无关）。**常设规矩的落地形状=两条读数分开**：新 `poolGenerals()`（仓库＋自建）只喂浏览器本地征召两席（`distributeDraftGenerals`/`confirmDraft`），`src/ai/**` 与 `matchSetup` 照常只读 `allGenerals`、CLI 链不经 store 也不读 localStorage ⇒ 本机清单在自动化验证侧**没有入口**，B10 仍由仓库固定文件完整重建（本轮实证：E2E 里同一时刻 matchSetup 池仍 95，而玩家池 96；锚三次逐字复现）。Excel 导出**刻意仍是仓库账本口径**（不含自建将）⇒ 导出再导入不可能重造号、也不可能把本地内容洗进正式面。**这条分池只是"当前形态"，不是终局**：上条已登记用户需求＝开发者模式下要让 AI 用新建将领/技能做自动化验证，那一刀建的是**仓库固定 fixture + 独立锚**这条路（B10 仍只代表官方池），而不是把本机清单接进 CI。
- **落地状态（v2.8.9·地基刀4 方案A）＝上面那条"待建"已建成代码，且建成的是 fixture 这条路**：新文件 `src/ai/fixtures/diyGeneralFixture.ts` 写死 **12 张 DIY 样本将**（魏/蜀/吴 各 4，id 固定 `D-fix-<key>`，称号「仓库固定样本」），每张带一个**编辑器形态**的技能（`effects[].{trigger,runtime}`，其中一张带 `conditions` 门槛、一张双效果），并且**只能经 §H1 唯一存在入口 `createAuthoredGeneral` 造出**（注入确定性 `randomId` ⇒ 号不是随机 UUID）；进料口只有一个＝`MatchConfig.poolSource?: 'official' | 'diy-fixture'` 配 `generalsForPoolSource()` / `factionsForPoolSource()` 两个纯函数，`buildMatchState` 内原三处取池站点全部改经它，**缺省即官方池、与改动前同引用同序同值**；唯一写入点是 `battleCli.ts` 的 `--diy-fixture` 开关（默认关），UI／房间／store／演练窗**没有任何一路能打开它**（复算会话 grep 全库证实：`poolSource` 在 `src/ai/**` 外的引用＝0，`battleHash.ts` 不带该参数）。⇒ 常设规矩由此成为**可执行形态而不只是一句禁令**：DIY 那类内容进自动化验证的入口是"仓库里的源文件"，localStorage 仍然零入口（复算实测：`src/ai/**` 里 `poolGenerals`／`localStorage`／`authoredGenerals` 只出现在注释里）。**两锚并立**：B10 逐字未动（本轮又两遍复现：won=300／exhausted=0／VIOLATIONS=0／胜席 `{"1":112,"2":188}`／五势力出场 116·136·126·126·96），新开硬锚 **B11**＝`npm run ai-battle -- --games 300 --seed 1 --diy-fixture --skill 0` ⇒ won=300／exhausted=0／VIOLATIONS=0／胜席 `{"1":108,"2":192}`／只三势力（魏 217 席 121 胜、蜀 193 席 87 胜、吴 190 席 92 胜；217+193+190=600=2 人×300 局，账自洽），报告头带一行「将领来源=仓库固定 DIY 样本（不是官方池，B10 不适用）」。**为什么 `--skill 0`**：`--skill` 是"给池内将领注入练习技能"的概率，样本卡**本来就自带编辑器形态技能**，注入关掉后 B11 计到的触发全是 fixture 自己的技能（实测 300 局：蓄粮 42／双略 32／回报 7／转赠 6／固守 4／节用 4／抚伤 3／焚粮 3／缴械 2 ⇒ 反空转有真读数，不是恒绿）。**两条诚实边界**：① 样本 `identity` 显式写空＝取 §F 格8「留空＝**当前**无身份＝此刻不产生锁键」那个**合法形状**，不是绕锁，也不是给样本发永久豁免（身份字段可编辑，日后填上就回到锁下）——契约豁免的是形状而不是来源（编辑器默认路把身份落成卡名，那种自建卡照样锁；写进文件头注释）；小池若参与锁，同势力第二座位会被滤成空池。② 观察层两处口径**本刀刻意未动**（见 HANDOFF §12-58、任务 #39）：`--skill-stats` 的"配置技能名单"固定取官方账本 ⇒ fixture 模式下列表显示"39 条·触发过 0 条"、`D-fix-*` 全走"名单外触发项"；`SKILL_EFFECT_EVENT_TYPES` 不含 `REVEAL`/`DECK_PLACE` ⇒ 样本里的探报/归整**结算了但不计数**（非零触发读数少 3 条的成因）。**方案B（编辑器导出→仓库文件验证路）仍是后置立项**（任务 #38），未到口令不得开工；本机清单接进 CI 这条路依旧禁止。

### H3 三层禁改执法（现状真实漏洞=只有 UI 门）

- 三层共用**同一份**「是否允许修改」判定（General schema + GeneralPolicy），不许三处漂移：**① 录入面拒录 → ② store mutation 守卫 → ③ 装配期整批 throw**。
- 取证现状：`developerMode` 唯一门在 `src/components/Codex.tsx:115`（UI 条件渲染），`store/gameStoreEditorActions.ts` 的改将/改技能动作**无任何 dev-mode 校验**，`matchesDeveloperModeDigest` 只服务"进入开发者模式"这一件事 ⇒ **绕过界面直接调 store 就能改官方将**。判据必须落在第②层。
- **历史官方 overlay 处置**：非开发者时期已存在的官方改动**不删除、不回滚原数据**，只停止应用并显式标记冲突（`blocked`）。三个状态要同时成立：原数据仍保留 / 该修改已被禁止应用 / 冲突已标明。验证者只拒、不改、不发明玩法。

> **落地状态（v2.8.6，地基刀2）**：三层已接线，且**三层共用同一个根**＝新文件 `src/domain/generalPolicy.ts`（全项目不许出现第二份「能不能改」判定）：`mayModifyGeneral(id,{developerMode})` 只认号段——legacy 仓库账本号（`wei_001` 式）＝官方，只在开发者模式可改；`G-`／`D-` 本地号＝任何会话可改（本地内容进账本靠人审，不靠权限位）；号段认不出的一律走更严的一边。**①录入面**＝`SkillEditor`：官方将选中时保存按钮 disabled＋行内 `🔒`＋顶部常驻提示，批量删除／批量禁用／文本导入／Excel 导入四条写路各自回显 `applied/rejected`。**②store mutation 守卫**＝`updateSkillEdit`/`updateGeneralEdit`/`toggleDisabledGeneral` 返回 `EditDecision`，**被拒时零写入、零落盘**；批量与两条导入路同走守卫（Excel 导入原有的 `setState`＋手写 localStorage 直写口本刀封掉，改为逐行走单条 mutation）；`renameIdentity` 的改名级联跳过官方将的历史差异，官方差异保持逐字不变。**③装配期兜底**＝`getGeneralWithEdits` 在非开发者模式下不读官方将的两张差异表、`effectiveDisabledGenerals()` 过滤停用表、`blockedEdits()` 报名单，**不 throw**——这是对上面契约原文「整批 throw」的实装偏离（理由与待裁口径见 HANDOFF §12-54④）。「原数据仍保留／已禁止应用／冲突已标明」三状态同时成立已由测试逐条钉死（`gameStoreEditorActions.policy.test.ts`：停用后牌池回账本值、raw map 一字未动、重进开发者模式逐字恢复；另 `SkillEditor.readOnly.test.tsx` 钉住录入面三格）。**本刀没收的旧旁路**：`Codex.tsx` 的私有合并副本、`GameBoard`/`TestArena` 的 `skillEdits[g.id] ?? g.skills` 展示旁路，全部收敛到 `getGeneralWithEdits` 唯一路。**尚未落地的半边**：编辑器仍只对开发者可见——把录入面开放给普通玩家是 N2 保护锁那一刀的前提，不在本刀范围。

### H4 导入契约（现网缺陷登记，与 H1 同刀修）

- `src/components/skillEditor/skillExcelParsers.ts` `resolveGeneralByNameFaction`：势力格为空或不匹配时回落到"同名第一个"，且 `sameName.length===1` 分支与兜底分支返回值**完全相同**（死分支）；官方 95 将魏/晋有 4 对同名（司马懿、邓艾、钟会、张春华）⇒ 改动静默挂到另一势力那张将上、零警告。
- 同文件按名找不到将时 `continue` **静默跳过**（无 parseWarning）；`hp` 单元格非数字时 Number→NaN **静默丢弃**。
- 判据：这三条全部改为**拒录并报第几行**（整批失败口径沿用 v2.8.3 录入面纪律）；寻将一律走 id/identity，不走名字。

### H5 技能语义（用户逐项解释，共七组）

1. **支付代价**：**代价种类由技能自己声明**（每种代价是登记过的类型，技能引用它，不是通用清单）。**代价不够 ⇒ 不可发动**；**代价在效果前扣**；**效果被抵消不退代价**。「**放弃攻击**」=本回合该将不可再进行「攻击」行动，无论此前是否已攻击过；**无剩余攻击行动次数时不可发动**该类代价技能（「放弃移动」「放弃攻击和移动」同理；现网已有事实字段 `hasAttacked`/`hasMoved`）。
2. **数值变化 与 持续生效 是两个正交概念**：数值变化分**可视**（改完直观显示，一般是面板体力/攻击力）与**不可视**（不显示具体数值，只在结算提示里体现，如伤害减免）；持续生效=效果带**有效周期**，周期随技能描述，周期一到即失效；两者组合=**周期内持续参与数值推导**。**重复发动=叠加**。**发起者将领离场⇒该效果周期立刻结束，回场不续**。护甲不在这套体系内（只用于挡伤）。多个来源改同一数字**按发动先后顺序叠加**，算例已复核：D 攻击力 2，依次发动 A(全场受到伤害+1)、B(令 E 受到伤害−2)、C(令 D 攻击力+1) ⇒ E 实受 (2+1)+1−2 = **2**。
3. **伤害计算次序**：攻击力增减先入算，**受到伤害增减在护甲抵挡之前**入算；护甲=一种**额外体力值**，只是优先于体力抵扣（现网单点出口 `src/core/armorDamage.ts` `applyArmorDamage`）。
4. **"造成了/受到了伤害"的判据**：**0 及以下伤害不算造成了伤害**；**只掉护甲、体力未变也算"受到了伤害"**（用户 2026-09-28 明确更正，早前"以体力实际变化为依据"的表述作废——现网 `actualDamage = hpLost + armorLost` 正是该判据的形状）。触发类技能（奸雄/刚烈这类 onDamageTaken）据此判定。〔**2026-10-03 本条后半被用户重新裁定推翻（v2.8.27＝2.8 刀5 落地）**，原话：「**响不响这里，由于考虑到平衡性的问题，我现在重新裁定成只有掉血才算受到伤害，只掉护甲或者伤害≤0都不算受到伤害**」⇒ 现行判据＝**只有体力真的减少才算"受到了伤害"**；"造成了伤害"那半句（0 及以下不算）照旧。落地形态与证人见 §F `DAMAGE_TAKEN` 行＋§H10「B13／B15 复现记录（v2.8.27）」＋判据 **§12-93**；旧表述按"历史日志记当时认知"不回改，以本括注为覆盖指针。〕
5. **回合限 1 次 = 该回合可发动次数为 1**：**技能发动成功即消耗**这次机会，即使效果随后被抵消或改变；**目标非法时正常不能发动**（不许靠"发动了但空转"消耗次数）；**回合结束时立刻重置**；同一回合的准备/出牌/结束**都算同一个回合**；**离场再回场不重置**（用户明确：本项目与游戏王规则不同）。
6. **决斗**（A 向 B）：逐轮按近战攻击算（先算攻方攻击力增减、再算双方受到伤害增减）得实际伤害，记为**效果伤害**；第一轮后若 B 存活则轮换为 B 打 A；**即使算出 0 及以下伤害也照样轮换**；**一旦有一方受伤后死亡立刻终止**（死者不再被轮换、不再计算它对存活方的伤害）；**双方各计算三轮后终止**（不发生第四次计算，无论伤害多少、无论是否存活）。附加口径：决斗里的每次"打"**不算攻击**（不触发"受到攻击伤害后"类技能，如刚烈）；**不消耗任何行动次数、也不受任何行动次数限制**（是独立流程）；**从开始到终止连续完成、中间不插入任何流程、不存在跨回合计算 ⇒ 必在一个回合内**；**周期效果在决斗各轮全部生效**（如"本回合受到伤害−1"三轮都算）；**不能选自己为目标**；**决斗本身不能被响应打断，但发起决斗的技能可以被打断或改变实际效果**。（2026-09-29 另有四问四答＝**只能由技能发起／每一"打"不烧手牌／决斗中死亡也算击破／伤害类型＝技能伤害**，见 **H9**——四条与本条互相印证，实装时以两处并读为准。）
7. **选择与目标**：任选目标**无特殊描述时一律由技能发起方选**；区域目标的"区域"=规则里的**营地区域 / 前线区域 / 战场区域**（现网 `position.region` 词汇 `CAMP|FRONTLINE|BATTLEFIELD`，`src/domain/types.ts:33`）；**找不到目标不能发动**（不可空发）；**链式若-则顺序判定，中间失败后段不判**。

### H6 内容权威与未决项

- **仓库内的内置技能定义=临时空壳**，用户已明确：后续全部会被替换，**以参考文件为准**（**唯一准=将领数据_参考.xlsx**，另两份不作准，见 H7）。例：现网 `奸雄`=「受到伤害后摸一张牌」是空壳，用户所述"减免分支需弃手牌为代价"才是目标形态。任何语义争议**不得拿现网 SK_* 定义当权威**。
- ~~唯一尚未裁的一项：伤害增减的来源分成哪几类~~ **已补齐，见 H7**。
- 已裁但形态未定（属录入面刀，不是玩法刀）：代价栏/后续效果栏的 Excel 列与编辑器控件、任选与区域目标的录入形态、次数槽的录入形态。

### H7 同日第二轮答复：三条补齐 + 两条新需求（2026-09-28）

- **参考文件只有一份=准**：`G:\THREE_KINGDOMS\将领数据_参考.xlsx`。`三国卡牌.xlsx` 与 `将领数据_参考_重生成.xlsx` **不作准**（H6 那条"三份"的写法作废）。任何内容语义争议只以这一份 + H6"现网定义=临时空壳"为准。
- **伤害增减的来源有且只有两类**：**自身技能** 与 **其他将领技能**。理由=装备没有效果、玩家本人没有技能，故不存在第三类。**"分来源"的真实含义=场上同时有多个伤害增减效果生效时，要能分辨哪个效果属于哪个将领的技能**，不是分类枚举而是**归属标记**。决斗不算第三类：它只是流程，其中的增减仍归到"某个将领的技能"。⇒ 判据落到实现=每个修正器必须带 `ownerGeneralId`（谁的技能产生的）+ 是否自身（`owner===受影响者`?），不必再造类别枚举。
- **决斗不附带任何效果**：它只是一个**特殊行动流程**，本身不产生增减、不额外结算；**除非有技能影响决斗规则**。⇒ 实现时禁止把"决斗"做成自带结算的原语，也禁止借决斗顺手塞效果（不破"不发明玩法"红线）。
- **新需求 N1（改形地基刀3）：Excel 导入既是修改、也是新建的入口**。用户明确要"Excel 导入将领数据也可以新建将领，方便批量新建和修改"⇒ 原口径"按名字找不到就整行拒录"**改为**：**报出异常行，并逐行询问三选一=新建将领 / 修改已有将领 / 不录入**。判据不变的一半=静默跳过与静默新建**同为最坏失效形态**。「新建」这一路必须走 H1 的编号与归属规则（系统自动发号、按当时权限标 official/DIY）；导入结果住在 localStorage ⇒ 按 H2 常设规矩**永不进自动化基线**。
  - ~~N1 未决分叉~~ **已裁，见 H8 第一条**：定位形态=名字+势力唯一时自动命中、多张同名时弹候选由用户点选；批量导入不被打断（先跳过分叉项、导完再集中点选）。
- **新需求 N2（新增刀）：将领编辑器的「锁定修改」开关**——被锁定的将不会被误改动（编辑/删除/覆盖都挡住）。
  - ~~N2 未决分叉（三问）~~ **已裁，见 H8 第二条**（锁的性质 / 谁能开关 / 住在本地）。
  - **与 H3 的关系必须写清**：H3=**系统级禁改**（按来源与权限判定，用户关不掉），N2=**用户级保护**（他自己点的锁）。用户口径原文=**"这个锁和非开发者无法修改官方将独立计算"**（两件事各算各的，锁不是禁改的替代品，也不是禁改的开关）；叠加时取**更严的一边**；不许出现"系统级改写偷偷解除用户锁"或"用户锁绕过官方禁改"这类第二路径。

### H8 同日第三轮答复：N1/N2 的分叉全部闭合（2026-09-28 纸面契约 ⇒ **N1 于 v2.8.7、N2 于 v2.8.8 均已落地为代码**）

> **落地状态（v2.8.7，地基刀3＝N1 半边落地）**：下面 N1 那条"一趟两阶段＋三态判别"已变为代码——`skillExcelParsers.ts` 的 `resolveGeneralForImport(name, factionText, pool)` 是全库唯一导入判别根，返回 `unique`／`ambiguous`（带候选、绝不自动挑第一张）／`missing` 三态；**势力填了却没命中＝ambiguous（交出全部同名候选），不是替用户猜另一势力**；旧 `resolveGeneralByNameFaction` 的「同名取第一个」死分支（官方池司马懿/邓艾/钟会/张春华跨势力同名会静默改错卡，开工前实测证实）废除，该函数降为仅供简单格式使用的薄包装。`parseRowPerSkillSheet` 接受可选 `pool`、返回 `{entries, parseWarnings, unresolved}`：唯一解析行**立即**沿 v2.8.6 单条 mutation 路写入（判据①），`UnresolvedImportBlock` 携带原始字段＋技能集合＋**行号范围**＋原因＋候选进 `SkillEditor` 蓝色待点选面板（判据②），顶部「✅ 全部按新建」＋每行三选一（新建 DIY／挂到现有将领／跳过，判据③闭合）。回填轮修掉一处**入口三态正确、出口二次推断把 ambiguous 压成 missing 且候选丢空**的分叉（`flushCurrent` 硬编码），常设判据见 HANDOFF §12-56①；7 例回归钉按本节"读码事实"用自造 fixture 走候选路。**其余各条（H4–H7）仍是纸面契约、零实现。**
>
> **落地状态（v2.8.8，N2＝编辑器两把锁落地）**：下面 N2 那五条判据（两套独立计算／非开发者视角金锁＝系统禁改的可视化且不可手动加解／开发者视角默认全不锁＋批量自选／金白双色一眼可分／住所=本地且归属=玩家各自独立计算）已全部变为代码——`src/domain/generalPolicy.ts` 的 **`mayWriteGeneral(id,{developerMode,lockedIds})` 是全库唯一写闸门**（先过 §H3 系统层、再过白锁，两套计算各算各的、只在这里合并、取更严的一边），拒绝原因 `USER_LOCKED` 与 `OFFICIAL_READ_ONLY` **在 store 结果里是两个具名清单（`deniedLock`/`rejected`）、在界面上是两句话，任何汇总面把二者并栏都算违例**；开关本身走 `mayToggleGeneralLock`（**只吃系统层**⇒ 白锁绝不挡住自己的解锁，保护不会变单向陷阱）。**写侧全覆盖**：编辑（技能/属性）、删除（单卡与批量清差异）、覆盖（Excel 挂到现有将领）、禁用（单卡与批量）、身份改名级联、文本导入——每条写路都经同一个闸门，锁住的卡一个字节都不落盘。**读侧绝不读锁**：装配视图（`getGeneralWithEdits`/`effectiveDisabledGenerals`/`blockedEdits`）从不引用 `lockedIds` ⇒ 锁只是"别再改"，不是"停下来"（锁住一张带改动的卡，行上仍是 ✏️ 不是 🚫、对局照常生效）——「锁＝停用」属发明玩法，本节判据明令禁止。**住所**＝`three_kingdoms_locked_generals`（本机 localStorage 的一份 id 清单；不进源文件、不进 `EngineState`、不进录像/回放、不进 CI 固定输入 ⇒ 非内容刀、无需换锚，B10 逐字已实证），`resetGame` 不清它（玩家资产≠对局状态，与 `authoredGenerals` 同条），删自建卡连带清掉死号的锁（不留孤儿锁）。**一处使能改动（判据本身要求的）**：`Codex.tsx` 的编辑器入口此前 `developerMode &&` 才渲染 ⇒ 金锁判定在可达界面上恒为假、"两种锁一眼可分"在现网永远观测不到；本刀改为常渲染，执法仍在 store（真机实证：非开发者进来 95 张官方将全金锁、零白锁开关，且手工往锁档塞 `wei_001` 刷新读回＝该行只画金锁、不给开关——手改档也无法为官方将开出第二条路）。空转与踩坑的常设判据见 HANDOFF §12-57①②。
>
> **落地状态（v2.8.12，导入面补两件＝无变化跳过 + 措辞随归属）**：N1 那条流水线上线后**缺一步"写回去会不会真的变"**，于是用户把自己导出的表原样再导回去时 95 行全计成"导入"、每张官方将留下一条空 ✏️ 覆盖记录（退出开发者模式后还被算进"N 处改动已停用"）。本刀补 `importEntryChangesNothing`（比较对象＝**当前生效视图**，判定前置 `mayEditGeneral`⇒权限被拦的行照旧进拒录名单，绝不被"无变化"盖掉），并把待点选面板"新建为 …"的措辞改为随 `developerMode` 说真话（**归属规则本身一字未动**，用户裁方案A）。同轮在真机往返里查出并修掉一处更坏的：**`value: 0`＝引擎的「全部」哨兵在导入侧被拒**（官方仅 1 条：断肠），导出原样写 0、导入读成 `undefined`、消费点 `?? 1` 落成 1 ⇒「击杀者弃置全部手牌」被用户自己的文件悄悄改成「弃 1 张」。细则、五条可复用判据与 GUI 侧残留（#49 待裁）＝本节上方 §F「Excel 往返保真与「无变化」跳过」。
> **落地状态（v2.8.13，#49 收口＝`0` 与「全部」按类型收口 + 导入后常驻总结）**：上条末行留的 GUI 残留已闭合，口径由用户三条裁决给定（GUI 方案①／Excel B／别名方案 2）：「整只手（全部）」这个录入件**只对弃牌／发放／放回牌堆三类出现**，勾上时数字框不渲染，换类型时 `Math.max(1, carried)` 挡住 0 被带走；Excel 侧 `readValueCell(raw, type)` 让那三类认 `0`／「全部」，**其余类型的 0 或「全部」按没填处理**并回一条 `valueNote` 进既有的常驻点名通道（**`REVEAL` 单独说**：它的 0 不被夹成 1，会真的看 0 张）；**别名只进不出**——`serializeEffectGroup` 一字未动、照旧写数字 0，往返形态保持单一。同轮新增导入后的**常驻总结面板**（两条导入路共用一份、带「知道了」、可整段复制、**只点名不折算槽位**），条目由「写入前后各取一次当前生效视图」差分派生（#47 同口径），store 侧只多交一个 `applied: string[]` 名单、不生成任何用户可见句子。细则与四条新判据＝本节上方 §F「数值 0 与「全部」的按类型收口 ＋ 导入总结面板」；同轮另出玩家侧文档 `PLAYER_GLOSSARY.md`，其 §八登记十条"界面措辞 ≠ 规则/引擎"（含击破补偿抽归属冲突、`tag`/`forced` 零消费者），**只报不修**。

- **N1 定位形态已裁**：Excel 导入里选"修改已有将领"时——**名字+势力在仓库内唯一 ⇒ 自动命中；出现多张 ⇒ 弹候选让用户点选**。**批量导入不被打断的定法=先跳过分叉项**：把所有能直接导入的先导入完，**最后**再把"需要点选的那一批"集中放出来让用户逐张选。⇒ 实现判据（三条，后续照此办）：① 导入是**一趟两阶段**（无歧义阶段 + 待点选阶段），中间绝不逐行弹窗；② 待点选清单必须**留住行内容与异常原因**，用户不选就一直挂着，**不静默丢弃、不自动挑第一张**（与 §12-46① "漏读比读错更危险"同源）；③ 用户最终选"不录入"的路径要保留（三选一是闭合的）。
  - **同名歧义何时真会出现（读码事实，防止下一轮误判为空转）**：官方 95 将的 4 对同名（司马懿/邓艾/钟会/张春华，见 H4）**势力不同**，所以"名字+势力"对官方池**全部唯一 ⇒ 自动命中路走满、候选路空转**；候选路真正被触发的场景=**同势力、同名、但身份不同**的两张（身份锁键是 `(identity, faction)`，这种组合是**允许存在**的，身份锁挡不住名字+势力的歧义）。⇒ 测试必须自己造"同势力同名不同身份"的 fixture 才能钉住候选路，别用官方池断言它可达。
- **N2 锁的性质/开关权限/视觉/住所已裁（四件齐全）**：
  - **两套独立计算**：这把锁与"非开发者不能改官方"各算各的（H7 那条关系不变）。
  - **非开发者视角**：官方将**默认自带一把不可解锁的锁**（用户原话="你可以认为非开发者面对官方将领时默认自带一个不可解锁的锁定开关"——即**系统禁改的可视化**，不是新增一条规则）；非官方将（DIY/本地新增）**可自由锁定/解锁**。
  - **开发者视角**：**全部默认不锁定**（含官方将，因为开发者本就能改），只能**手动锁定/解锁**；并且要提供**批量自选锁定/解锁**功能（多选一次操作）。
  - **视觉**：**官方锁=金色**、**手动锁=白色**，两种锁在界面上必须能一眼分开。
  - **住所与归属**：**锁在本地**（不进源文件、不进 EngineState、不进录像/回放，也**不进 CI 固定输入** ⇒ 按 H2 常设规矩它天然不构成基线输入，无需换锚）。归属=**玩家各自独立计算**：不存在"玩家 A 锁住玩家 B 的将"，也不存在"开发者替玩家上锁/解锁"。⇒ 判据：锁状态是**按玩家/按本机环境**的一份本地记录，读它的一方只能用它来挡自己的写操作；任何"跨玩家生效"的实现都是发明玩法，禁止。
  - **开工前仍不必再问的三项**（登记为已闭合，防止下轮重复访谈）：锁的行为、谁能开关、住哪里——用户已全部裁完。剩下的只有**录入面形态**（控件长什么样、放在编辑器哪一行、批量选择用多选还是全选、金色/白色图标的具体样式），属 UI 设计，不是玩法裁量，施工会话可自行定形并在复述闸里写清。

### H9 第四轮答复：决斗四问 + 提示模式 + 三件待办的处置（2026-09-29 用户裁决）

> 用户原话六句，逐句钉成可施工口径。**本节只登记裁决；除标"已落地"的两条外零实现。**

- **击破补偿抽归属＝阵亡方**（用户原话"归阵亡方"）。⇒ 引擎一直是错的对面那个答案吗？**不是**：结算 `chainedConsequences.ts:135-152` 把 `DRAW_REQUIRED` 排给 `targetPlayerId`（死者那一家），`EventProcessor.test.ts:330` 钉着这条；**唯一错的是规则页文案**（`Rules.tsx:38` 写"击破方补抽"＝打赢那一家）。**已落地（v2.8.14）**：文案改为「将领被击破后，由失去这名将领的一方补抽 1 张」，真机取证＝规则页只剩新句、旧句 0 处。判据：**措辞与结算相反时先取证哪一侧是权威**，不要默认改代码。
- **决斗四条补充口径**（挂在 H5-6 之下，是同一流程的四问四答）：
  1. **决斗只能由技能发起** ⇒ 不存在"决斗牌"、也不存在独立的决斗行动；实现时决斗**不是一个可被玩家直接选的动作**，只能作为技能效果出现。
  2. **决斗里不进行真正的近战攻击 ⇒ 不消耗手牌**（普通攻击要烧 1 张手牌，决斗的每一"打**不**烧牌）。这条与 H5-6 的"每次打不算攻击"是同一条的两个侧面：既不触发攻击类响应，也不走攻击的手牌代价。
  3. **决斗中死亡也算"击破"** ⇒ 阵亡方照样吃补偿抽（上面那条），`onKill`/`onDeath` 一类的技能触发照常在决斗里成立；决斗不是"只掉血不算死"的隔离区。
  4. **决斗的伤害类型＝技能伤害**（不是攻击伤害）。⇒ 与 H5-3 的伤害次序表共用同一套增减口径，`damageType` 走 `'skill'`；决斗里的每一"打"因此**不吃**"受到攻击伤害后"类技能（与 H5-6 的"不算攻击"一致，两条互相印证）。
- **第五轮更正（2026-09-30 用户逐句指出我读错的两处＋遗漏的一处；决斗口径＝本条与 H5-6 并读，本条覆盖我此前的转述）**：① **伤害的定性**＝参考规则原文是"造成 **等同发起一次近战攻击能够造成的伤害值** 的**效果伤害**"——**不是**"进行一次近战攻击"（所以不烧手牌、不触发攻击类响应＝上面第 2、4 条），但**数值要按近战攻击那一套算出来**（先攻方攻击力增减、再双方受到伤害增减）。② **终止条件不是"任何一方一受到伤害就死亡"**＝原文是"任何一方在**计算受到的伤害后体力≤0（即规则上判定为被击破），立刻终止**"；并且**每次计算伤害后都会真实扣减体力值**——不是三轮算完再一次性扣，也不是"扣了血＝死亡流程已走完"（击破⇒阵亡方补偿抽、`onKill`/`onDeath` 照常成立＝上面第 3 条）。③ **第 10 点实为"自己不能和自己决斗"**：必须场上**两个不同将领**；**技能发起者**在技能允许时**可以选择自己和另一个将领决斗**——"不能选自己为目标"说的是**决斗的两个参与者不能是同一枚将领**，不是"发起技能那一枚不能参加"。⇒ 三条都只更正**我的读法**，不动上面已裁的四条。
- **第六轮裁决（同日续，用户三问答复＝决斗口径就此闭合，实现时 H5-6＋H9 四轮＋本条三处并读）**：① **第 7 条"双方各计算三轮"的确切读数＝A 打满三次、B 也打满三次＝最多六次计算，交替进行**（用户原话"我读作 A 打满三次、B 也打满三次＝一共六次计算（交替进行），对"）。② **决斗因某方体力≤0 提前终止后，发起它那枚技能的后续效果要接着走完**（用户原话"要走完"）。③ **阵亡善后＝排同一套队列**（用户原话"按排队走"，口径详见本轮白话复述）＝决斗**不得**为死亡开快车道，必须复用既有那条 FIFO 事件队列与既有派生链；可观测顺序钉死为**决斗各轮伤害 →（同一枚技能的）后序效果 → 死者补偿抽牌与 `onDeath`/`onKill` 响应**，与普通攻击致死同一条通道。⇒ ③ 对本刀的硬约束是结构性的：**决斗的每一"打"必须是 `damageType:'skill'` 的 DAMAGE 事件**（于是"技能致死⇒派生 DEATH⇒补偿抽＋触发重入"这条既有路一字不用新写），决斗自己只做"逐轮计算与终止判断"，不改状态。④ **如实登记一处前置缺口**：用户口径里的"先算攻方攻击力增减、再算双方受到伤害增减"这两层**引擎至今没有运行时真身**（增减层＝待办 #25/#26，尚未开工），今日决斗能复用的只有"攻击力→军备每 2 点挡 1 点"这一段算术；⇒ 判据＝**决斗与普攻必须共用同一个算术函数**，增减层落地时两边一起生效，**绝不允许在决斗里另写一套伤害数学**（那会成为第二处真值）。
- **第七轮裁决（2026-09-30 续，用户四答＝§F 表里那格"决斗内监听"的推论被正式改判，改判方向＝"要响，但只在两端响、且按累计合并记账"；本条覆盖 §F「Reentrancy / 监听」格与 HANDOFF §12-81 里"默认取甲案（不响）"那半句）**：① **累计伤害只当判定值、不再扣第二次血**（用户原话"不再扣血，只是作为受伤类技能的判定计算方式存在"）⇒ 实现上它是一笔**喂给受伤类技能的判定输入**，绝不派生第二次 DAMAGE、绝不产生任何状态位移。② **称谓更正＝"己方"，口径＝同一个玩家席位下的全部将领都算这个玩家的己方**（C 与 B 同席、D 与 A 同席；用户原话"这里是我描述错误，其实应该用'己方'"）；并且**技能范围可以写成"场上将领受击"，此时第三方座位的 E 也拥有响应权**⇒ 监听需要新增一维**「我听谁」：自己／己方（本席位）／场上（全体）**。③ **决斗不是攻击**（用户原话"成为攻击目标触发的技能不能响应，只有成为技能目标触发的技能可以响应"）⇒ **"受击"这一类必须分来源两档**（成为**攻击**目标／成为**技能**目标），决斗只喂后者；直接复用现有 `BEFORE_DAMAGE` 会让"成为攻击目标"类误响＝违背本条。④ **多个响应者的先后**＝用户另有一条「连锁响应链」设计要另外发过来（"我会另外发规则给你，先处理其他部分"）⇒ **本条未闭合，实现时不许自创派发次序**，现有 `PRIORITY` 表只给档不给同档内次序。
- **第七轮钉成的决斗时序（用户给的流程逐句转写，施工时以此为准）**：**A 发动技能、指定 B 为目标发起决斗** →〔**成为技能目标**点〕**B 的受击类技能响应**（例：回复 1 点体力）＋**"己方"与"场上"范围的受击类技能一并拥有响应权**（C 在这里响）→**这一层全部响完，决斗才开始**（所以回到的体力算进决斗起点）→〔六下互砍〕逐轮按近战算术真实扣血、**逐轮之内不唤任何监听**（用户流程里"决斗过程 AB 均受到伤害"之后紧接着就是"决斗结束，处理受伤类技能"＝逐轮不插队，与 H5-6"中间不插入任何流程"不冲突）→〔**收官点**〕**受伤类按"该角色在决斗里实际扣掉的体力总额"合并成一笔、只结算一次**（例：A 挨 2 次各 1 点＝**1 次、判定值 2**；D 这类"己方受伤"范围监听**次数与点数算法与 A 完全一致**）→**阵亡者不结算受伤类**（例：B 挨 3 次各 1 点且死＝受伤类不响），但**遗言类（`onDeath`）与击破补偿抽照旧排同一套 FIFO 队列**（第六轮③一字不动）。⇒ **H9-4 与 H5-6 里"每次打不算攻击、不吃'受到攻击伤害后'类"这条继续成立**（决斗伤害是 `damageType:'skill'`），本裁决改的是"**受到伤害后**"与"**成为技能目标**"这两类响不响。
- **第七轮暴露的四处前置缺口（本轮 grep 实证，逐条给坐标；不登记就等于没查出）**：a) **`BEFORE_DAMAGE` 与 `AFTER_DAMAGE` today 的唯一生产者都是 `AttackResolver`**（`src/action/resolvers/AttackResolver.ts:115`、`:174`、`:143`、`:221`）⇒ **技能造成的伤害（含决斗六轮那种 `damageType:'skill'` 的 DAMAGE）在引擎里根本没有"受到伤害后"的进料口**，`src/skills/SkillTriggerBridge.ts:109` 那句注释就是这条的在案事实；⇒ 用户要的"决斗里 A、B 受到伤害后按累计响一次"**不是改决斗能做到的**，它要求新增一型纯通知事件（伤害后通知、携来源）＋扩 `onDamageTaken` 的可听事件源。〔**本条 a) 的"根本没有进料口"已于同日第九轮更正为较窄的说法**：`onDamageTaken` 听的是 `DAMAGE` 本体且已带 `damageSubType`（`skillCompiler.ts:208-210`），所以"受到伤害后"**能**听见技能伤害；真没有进料口的是 `AFTER_DAMAGE`（"造成伤害后"那一侧，仍只由 `AttackResolver` 发）。详见下面「第九轮」d) 条。〕b) 受击／受伤两类监听**只有"事件落在我自己身上"这一形态**（`SkillTriggerBridge.ts` 的 identityCheck 逐条比对 `targetPlayerId`／`targetId`／`action.playerId`）⇒ **"我听己方他人／我听场上"这一维在数据模型、录入面、Excel 列、词汇表里全都不存在**。c) 现有"成为目标"**没有来源标记**⇒ 决斗必须喂"技能来源"那一档、同时不能让"攻击来源"那一档响，二者靠一维新字段区分。d) 用户口径的"累计伤害"需要**把逐轮扣血记到角色头上**（现轮次只带 `duelRound`／`duelKey`，没有"某人累计受到多少"这笔落账事实）⇒ 需要一个**可重放**的记录面（承 §12-79"派生点唯一"纪律：记事实，不重算）。
- **第七轮的施工切分（顺序与依赖固定，等"连锁响应链"规则到位才动结算）**：**刀 A＝监听扩面刀（前置）**——「我听谁」三档 ＋「成为目标的来源」两档 ＋"受到伤害后"通知事件从技能伤害也能发；动数据模型＋录入面＋Excel＋词汇表＋触发派发，**会动结算**（新通知事件要进重入环）⇒ A 级、可能换锚。**刀 B＝决斗刀 2**——在刀 A 之上把上面那串时序钉死。**两刀之间夹着用户要另外发来的「连锁响应链」规则**（谁先谁后）⇒ 那份规则到位前，刀 A 也不开工（先做数据面还是先做派发面，取决于那份规则要不要同一批落）。〔**第八轮（同日）那份规则已到**，原文与落点见下面三条；本条里"等规则"这半句**只在"顺序"这一维解除**，两刀的先后依赖一字未动。〕
- **第八轮·「连锁响应链」顺序规则（用户原话，逐字登记，不得改写口径）**：「我设定的响应连锁链规则 受击方优先发动 ／ A攻击CD，BCD都有可以响应发动的技能 ／ CD为受击方，按座次先询问C是否发动，然后询问D是否发动。受击方的CD都已经确认后，询问非受击方的B是否发动」。⇒ **转写成的次序**：**先按"这次事件打到谁身上"把全场监听者分成「受击方」与「非受击方」两组**（不是按档位、不是按登记先后）；**受击方整组先问完**（组内**按座次**逐个问），**全部确认之后**才轮到非受击方。这一条补上了第七轮缺口 d) 之外的第五处、也是此前从未有规则覆盖的一维：**同一次事件上多个响应者之间的先后**。
- **第八轮落点核对（本轮 grep 实证，说明这条规则在引擎里目前"无处落地"）**：a) 现有点序真值只有 `SkillTriggerBridge.ts:42` 的 `PRIORITY` 表，且它**只给档不给同档内次序**——受击类（`onBecomingTarget` 50）与受伤类（`onDamageTaken` 50）与出牌类同档；`TriggerEngine.ts:58` 的 `.sort((a,b)=>(b.priority??0)-(a.priority??0))` 是同档**稳定排序**，也就是说**同档内今日的实际次序＝注册顺序**（由装配顺序派生），既没有"受击方优先"这一维，也没有"按座次"这一维。b) `resolveTriggerChain`（`src/core/EngineDispatchFlow.ts:13`）是**一条 FIFO 队列逐事件展开**，它处理的是"事件产生了哪些技能事件"，**不存在"把同一枚事件的可响应者排队询问"这一步**。c) 现成的"窗"侧只有 `GameEngine.openReactionWindow(event, participants)`（`:120`）与 `passReaction`，`participants` **原样收、不排序**，UI（`GameBoard.tsx:515` 起）把座位**平铺成一排"通过"按钮**、 HUD 注释自陈"entry mechanism only"；这条链真正被用来问玩家的只有回合结束问话窗（`gameStore.ts:679` 单席位）。d) **被动触发类技能今天是"到点自动响"，压根不问玩家**（`onDamageTaken`／`onBecomingTarget` 走 `resolveTriggerChain` 直接生成效果事件）。⇒ 用户规则里的"**询问**"两字如果按字面做，动的是**交互形态**（每枚可响应被动都要停下来问，且要带"不发动"出口），比"只排个次序"大得多 ⇒ **列入第一闸待裁，见下条②**。
- **第八轮·第一闸复述里我推的、需要用户给话的五点（本轮零 `src/` 改动，未确认前不开工）**：① **「按座次」的确切轴**＝按**玩家座位**（1→2→3…）问完一席再问下一席，还是同席位内再按将领头序？（第七轮②把"己方"钉成"同席位全部将领"，一席内可能有多名监听者，这轴不定则队列写不出来。）② **"询问"＝真停下来问玩家，还是只定结算次序？**（今日被动自动响；改成逐个问＝玩家每次被砍都可能要点几次"不发动"，节奏影响大，且与 §12-61「窗必须有出口」那条锁同源 ⇒ 需要给"不发动"出口。AI 座位按其现有策略自行决定，不走问窗。）③ **非受击方组内**是否同样"按座次"排？（用户原话只给了受击方内部的排法。）④ **决斗两端的映射**：〔成为技能目标〕那一层＝**被点为目标的一方算受击方**（B 及其"己方／场上"监听者先，发起方 A 一侧后）；〔收官〕那一层＝**决斗中实际掉过血的人算受击方**（A、B 都掉过血则两侧谁先？按座次还是按"发起方后动"？）——规则里"受击方"在决斗收官点的指代我推不出来，须给话。⑤ **同一将身上多枚同类被动**的先后（按录入顺序？按玩家挑选？）与"确认"是否＝"发动或跳过"二选一。⑥ 另附**第七轮遗留的三问仍无答**：累计判定值按**实际扣血额**还是**护甲减免前的伤害额**（两者在有军备时不同）、既有"受击类"技能在新「来源」维上的**默认档**（只算攻击＝锚不动／攻击＋技能都算＝动锚）、A 自己主动把决斗指到自己身上时算不算"成为技能目标"。〔**这六点上同日由用户逐条答复，并对本条①②两处我的结论给出"这是错误的"更正——答复与更正见下面「第九轮」四条，本条保留为当时的问题清单。**〕
- **第九轮·用户对第一闸六问的答复（同日，逐条入档为规格）**：① **座次轴＝按玩家座位一家一家问**（不是席位内将领头序）；用户给的工作例：A、B 同席、C 与 D 各在他席，**A 与 C 是受击将领，A、B、C 都可发动 ⇒ 响应链 A→C→D→B**。**〔我推的、待用户复核的那一读法：例里同席未受击的 B 排在 D 之后 ⇒ 非受击侧不是"从头按座位"，而是"从最后被问过的那个座位继续沿座位绕一圈"（C 在 2 号位 ⇒ 下一个 3 号位的 D，再回到 1 号位的 B）。这条比较器是派发器的心脏，实现前必须用一句大白话回读确认，不许照我的推断写死。〕〔**第十轮（同日）用户回读确认＝"你整体是对的，我补充一下细节"，并给出跨四席的工作例 ⇒ 本读法成立、已由推断升格为规格，见下面「第十轮」①。**〕 ② **「询问」＝真停下来问玩家**（确认＝交互形态改动，不是纯排序）。③ **非受击方那一侧也按座次排**。④ **决斗里没有"受击方"**——用户原话"双方互为对方的受伤方，注意决斗不是攻击，所以不存在受击"⇒ 连锁响应链的"受击方优先"这一组**在决斗场景不适用**（〔残留一问：决斗两端〔成为技能目标〕与〔收官累计〕这两层里，多个响应者之间是否就**纯按座次**排？规则原文没给，须补一句。〕）〔**第十轮已答，且本句"在决斗场景不适用"的读法被用户更正＝决斗照旧走同一条链，只是"受击"在那一层换成"成为技能目标"；收官层的组内轴另有明确规定。见下面「第十轮」②。**〕⑤ **同一位将领身上多枚可响应的被动＝玩家自选**，问窗给三键 **「发动 A」「发动 B」「跳过」**（不是按录入顺序自动定）。⑥ **累计那笔按"实际掉的血"，军备减免掉的那部分不算**⇒ 记的是逐轮 `本轮起始体力 − newHp` 之和，**不是** `value`（减免前伤害额）之和；起点取**决斗开始前**的体力（〔成为技能目标〕层那次回复算进起点）。⑦ **既有"受击"技能在新来源档上的默认＝看技能描述**，描述只有三种写法：**成为攻击目标／成为技能目标／成为目标**（第三种＝攻击与技能都算）。⑧ **A 主动把决斗指向自己＝算"成为技能目标"**（用户原话"决斗虽然不是技能，是技能先指定目标后发起决斗，A 指向自己，那就是 A 自己发动的技能同时指定自己和别人，我指定我自己也算"）。⑨ **新增一条时序（本条最要紧）**：响应链里某位发动技能后**又让别的技能变得可响应**⇒ **不插进当前这一链**，**等本轮技能处理完，重开一个新队列**（与 §H5-6"连续结算不许被插队"同一形态，落地时共用那条受约束批次纪律的语义、不新增第二条转移路径）。
- **第九轮·用户对我第八轮两条结论的更正＋我复核后的实际代码账**：用户判"这两点都是错误的"，逐条重查后账目如下：
  a) **"按先注册先动"只适用于「持续生效」类**——用户口径：**只有持续生效类技能在计算时按先注册先动**（这类技能发动后一直生效，不需要玩家每次额外响应）；**「强制发动」类**是在可响应节点**自动支付代价发动、不问玩家**；**其余（不强制）**才是要问玩家的。⇒ 我第八轮 b) 那句把"注册顺序"当成了**全体监听**的现状、把三类混成一类＝失真。〔代码侧的准确说法：`PRIORITY`＋`TriggerEngine.ts:58` 稳定排序是**今日全部触发**的实现事实，而"三类各走哪条路"＝**设计规格尚未落进代码**，二者不一致属在案。〕
  b) **"问玩家"这个环节不是没有，是已经建好、只接了一类节点**：问窗全套机制在案（`GameEngine.openReactionWindow`／`passReaction`、canonical `ACTIVATE_SKILL`＋`ActionValidator.ts:78`、AI 侧 `aiTurnDriver.ts:109` 自行决定、HUD `GameBoard.tsx:548`），且**刻意**只喂给回合结束技能——`onTurnEnd` 在 `TRIGGER_EVENT_MAP` 里**故意缺席**并注明"TURN_END 绝不自动响、唯一发动路径是 `ACTIVATE_SKILL`"（`SkillTriggerBridge.ts:35-40`、`TurnEndSkillResolver.ts:15`）。⇒ 要做的不是发明问窗，是**把同一套窗＋同一个 canonical 动作接到受击／受伤节点上**（复用它，不开第二条路径）。
  c) **`forced`（强制发动）这个字段今天只活在录入面**：数据模型／编辑器／Excel 第 8 列都有它（`skillExcelParsers.ts:26`、`SkillEditor.tsx:1369-1373`，开关的 tooltip 就写着**"不强制：由玩家选择是否发动"**），但**结算侧一处都不读**（grep 全仓：除编辑器与 store 的编辑动作外零消费方）。⇒ 用户这条口径把"强制发动不问就响／不强制要问"的**执法**明确成了响应链的一部分＝与 #43 后半（徽章刀 2）同源，**必须同批或在其之后做**，不能各做一半。
  d) **"来源"这一维在伤害侧其实已经有字段**（本条是本轮最重要的自我更正）：`onDamageTaken`／`onDamageDealt` 的触发**已经带 `damageSubType`**（`allDamage`／`attackDamage`／`skillDamage`），编译器把它翻成 `damageTypeFilter`（`skillCompiler.ts:208-210`），且 **`onDamageTaken` 听的是 `DAMAGE` 本体**（不是 `AFTER_DAMAGE`）。⇒ 第七轮我写的"技能伤害在引擎里根本没有'受到伤害后'的进料口"**说重了**：准确说法＝**`AFTER_DAMAGE`（"造成伤害后"那一侧）只由 `AttackResolver` 发出**（`:143`／`:221`），而"受到伤害后"本来就能听见技能伤害（含决斗那种 `damageType:'skill'`）。**连带更正 §F/§H9 第七轮 a) 与 §12-82⑤**，并牵出一条旧事实的新读法：**"决斗逐轮不响"今日是靠"决斗轮不经 `resolveTriggerChain`"实现的，不是靠没有进料口**——官方「肉林」「司敌」（受到技能伤害后）与「奸雄」（受到伤害后）在数据结构上**本来就听得到决斗伤害**，所以 #70 改走触发链时必须显式把"逐轮不唤监听"重新钉住，否则它会顺着现成的进料口自己响起来。
  e) **真缺的来源档只有一处**：`onBecomingTarget` **没有子类型**、label 写死「成为**攻击**目标时」（`generals.ts:50`、`:99`）⇒ 按 ⑦ 扩成三档（攻击／技能／成为目标）。**默认档这件事已经可以自查、不用再问用户**：官方池四条 `onBecomingTarget`（龙吟 `:372`、崩坏 `:408`、猛进 `:417`、激昂 `:469`）与 DIY 夹具那条（样·固守，`diyGeneralFixture.ts:75`）**描述逐条都写"成为攻击目标时"**⇒ 按"看描述"规则**默认只算攻击**＝不扩响技能指定目标 ⇒ **这一维不改变两个锚池的行为**（B12／B11 结构上不动；锚是否动要看"要问玩家"那部分改动，见 ⑨ 与 b)）。

- **第十轮·最后两点得答＝第一闸闭合，用户下开工口令（同日续，原话末句「明白了就开工吧」）**：本条把第九轮末尾仅剩的两处"待用户一句话"补齐，并**更正我第九轮④的那半句读法**。
  ① **座次绕圈读法＝确认正确，并由用户补出更完整的工作例（逐字登记）**：「**玩家1的0攻击玩家2的A和玩家3的C，玩家2的A、B 玩家3的C 玩家4的D都有可以响应的技能，响应链优先按座次询问玩家2的A，然后到玩家3的C，再到非受击方的玩家4的D，最后回到玩家2的B**」。⇒ **比较器的确切形式（派发器的心脏，钉成规格）**：a) 先按"这次打到谁"分组，**受击方整组先**；b) 受击组内部按**座位升序**逐个问（本例 席位2 的 A → 席位3 的 C）；c) **非受击组不从 1 号位重新起排**，而是**从"受击组最后被问过的那一席"继续沿座次绕一圈**（C 在 3 号位 ⇒ 下一个是 4 号位的 D ⇒ 再回到 2 号位的 B）；d) 同一席位内的多名监听者按**该席位被问到的先后**依次处理（B 与 A 同席，B 排在该席之后即最末）。〔原文"玩家1的0"按上下文读作"玩家1 的这一枚攻击将领"，席位1 不在响应名单内，不影响上述排序；如实登记这一处理解。〕
  ② **决斗两端的顺序＝同一条连锁响应链规则，只把"成为攻击目标"换成"成为技能目标"（逐字登记）**：「**这里其实和受击响应链规则是一样的，只是把'受击'的成为攻击目标改成了成为技能目标。收官累计结算受伤技能同样如此，先计算决斗的受邀者再计算结算的发起者（因为双方都是受伤方），然后再去逐个询问其他玩家**」。⇒ **对我第九轮④的更正**：我那句"决斗不存在受击⇒'受击方优先'这一组在决斗不适用"**读重了**——分组轴**照样存在**，只是"受击"在决斗〔开局被指定〕那一层指的是**成为技能目标**。⇒ **〔开局〕层**＝被指定方（受邀者）算受击方，其"己方／场上"监听者随受击组先，发起方一侧与非受击座位随后按 ① 的绕圈。⇒ **〔收官累计〕层的组内轴是一条显式覆盖，必须单独记住**：决斗双方**都是受伤方**⇒同属受击组，但**组内不按座次**，固定按**「受邀者 → 发起者」**这一角色序；两端问完才轮到"其他玩家"按座次绕圈。⇒ **结论：比较器需要两条组内轴**——普适的「座次绕圈」与决斗收官的「受邀者先、发起者后」，二者不是同一函数的两个参数而是两条规则。
  ③ **施工顺序与授权（用户已认可"方案与主控会话判断一致即开工"）**：**#69 监听扩面刀（数据面：「我听谁」三档＋「成为目标」来源三档，默认按描述）→ #71 响应链执法刀（三类分流＋把现成问窗接到受击/受伤节点＋上面这套比较器＋"本轮处理完重开队列"，与徽章刀 2 的 `forced` 执法同源）→ #70 决斗刀 2（两端响、逐轮不响、收官累计判定值）**。三刀均 A 级（可改既有状态转移或其输入）⇒ 每刀按第二闸跑五闸、动结算者须重跑两锚并逐字比对。**#71 改的是交互形态（真停下来问玩家）⇒ 玩法刀真机热座 E2E 不豁免。**
  ④ **开工登记（v2.8.21＝第一刀 #69 已落地；本条只登记进度，上面这套规格一字未改）**：交付面＝两维进数据模型（`TargetSubType`／`ListenerScope`＋`supportsListenerScope` 单点判定）→编译器（含 `signature` 补两维⇒"选择其一"不再跨档合并）→**桥接消费面**（`playerMatches`/`generalMatches`/`sourceMatches` 三谓词）→录入面两个下拉→Excel 两列（效果组第四代＝8 列、固定列第十三列「我听谁」）→词汇表两行＋xlsx 重投影。**两把默认档（`self`／`attackTarget`）都等于扩面前的逐字行为**，且**旧主名「成为攻击目标时」以整格别名只进不出**⇒B12/B11 逐字（§H10 末行）。**第七轮四处前置缺口的账**：b)「我听谁」一维＝**已建**；c)「成为目标的来源」一维＝**数据面已建、发射器未建**（`skillTarget`/`anyTarget` 今日对局里不响，录入面就地写明）；a)「受到伤害后」进料口＝第九轮 d) 已把范围收窄到 `AFTER_DAMAGE` 那一侧，本刀未动；d)「累计伤害落账」＝**仍缺**，排在 #70。**#71 的比较器（座次绕圈＋决斗收官"受邀者→发起者"两条组内轴）本刀一行未写**，且它要求的"三类分流"（持续生效不问／强制发动不问／其余真问）与 `forced` 执法同源⇒必须与徽章刀 2 同批或在其后。契约表见 §F「监听扩面刀」。

- **第十一轮·#70 决斗刀 2 落地（v2.8.24，施工会话登记；上面第七／九／十轮的规格一字未改，本条只登记"照规格盖完了"）**：
  ① **开局〔成为技能目标〕层**＝决斗立起前只响一声 `BEFORE_DAMAGE`（`duelStage:'opening'`），发射源**只有 `skillTarget` 这一路**（绝不喂"成为攻击目标"）；A 决斗指自己＝也算被技能指定（决斗本体仍诚实空转、0 轮）。答复里回复的体力**算进决斗起点**（新测试实证：第 1 轮起点是新体力 5，不是没答复时的 3）。
  ② **逐轮静默**＝六轮互砍的每一击都带 `duelRound` 排除键，`isReactionSourceEvent` 把它们显式挡在问答外（第九轮 d) 的重钉照办）：轮内不唤任何受击／受伤监听，唤起它们的只有发起决斗的那次攻击。
  ③ **收官＝累计一笔**：每个角色"这一场实际掉掉的体力总额"（起点体力−终局体力；军备减免不算）合并成**一笔** `DUEL_INJURY`（新事件类型＝纯观察面，默认处理器恒等、零状态位移、绝不再扣血），进响应链问答。用户两条裁决逐字钉死：**一笔一笔问，顺序＝受邀者那笔先（本人先答→旁人按座次绕圈）→ 发起者那笔**（这就是第十轮②那条"受邀者→发起者"组内显式轴，已实现为比较器的第二条组内规则）；**阵亡者那一笔整笔跳过（旁人也不问），但决斗中途阵亡一方仍可发动遗计技（onDeath）＋击破补偿抽照旧走同一 FIFO**。链中又生可响应者＝本轮处理完重开新队列，不插队。
  ④ **续跑＝纯派生、零新状态字段**：该续跑的决斗由 `findResumedDuels` 从（本次 dispatch 的已结算事件、扫描前队列、扫描后队列）现算；开局那一格（sourceEvent 携带 `duelKey`＋`duelStage:'opening'`）就是唯一存根⇒常驻／重建／回放三路同果（新测试四路逐事件一致＋两次连跑一致）。波数上限 `MAX_DUEL_RESUME_WAVES=4`，触顶只记如实欠账（CUSTOM `DUEL_RESUME_LIMIT`）。
  ⑤ **本轮挖出的引擎级 bug 一枚＋决斗载荷卫生一条**：`echoDuelRounds` 在宿主事件恰处数组末位时把同一块回合内联**插两遍**（循环最后一轮按 `index+1===events.length` 插过，`tail` 兜底又补一遍）⇒ 开局立两声、答复分裂成两次、续跑整块重复——删除 tail 补插后根除，由新测试的首个 dispatch"只立一声"钉住。时间戳派生的 `rootEventId` 从决斗 derived 载荷（开局／收官两声）里剥离：它会随 `pendingReaction`（**可重放的状态**）落进存档，留着就破坏回放与连跑的逐字一致；`triggerId`/`triggerDepth` 是确定值，保留。
  ⑥ **账面**：测试 938→**939**/83、五闸全绿（lint 0 错误、build 单文件 2,059.93 kB／gzip 605.33 kB）；**B13 {"1":104,"2":196}、B14 {"1":108,"2":192} 各两轮逐字一致，且与本刀前的基线逐字节相同**（两锚池内都没有 DUEL⇒本刀保两锚逐字，与事前预测一致），差异只有 esbuild 体积行与耗时行（238.9kb→244.1kb）。证据：`C:\Users\10128\.qoder-cn\tmp\tk-audit\duel2base\`（刀前）与 `...\tk-audit\duel2final\`（刀后）。词汇表决斗行＋"要紧的实话"两行更新＋xlsx 重投影（守卫测试 4/4）。**仍欠的空档如实登记**：`forced`（强制发动）的三类分流未落地——官方／DIY 数据今日无一条 `forced:true`，开局／收官两层是真问、没有强制 bypass⇒排在 **#72 补齐执法刀**。**v2.8.23 那条已知限制"决斗受击不触发"就此销账**（HANDOFF §12 有对应更正行）。

- **第十二轮·#72 强制发动执法刀落地（v2.8.25，施工会话登记；上面各轮的规格一字未改，本条只登记"开关这一格真的管事了"＋它的边界）**：
  ① **`forced` ＝分流位，不是新时机**：读它的地方全库只有 `SkillTriggerBridge.defersToReactionQueue`（＝`isReactionTrigger(skill.trigger) && skill.forced !== true`，`effectMode:'choice'` 一并排除＝选择类必须由人点）。勾了⇒该定义**不注册进问答队列**、直接进自动路当场响完；没勾⇒照旧进队列问人。**一条定义要么被问、要么自动响，绝不一技能两响**（与 §12-83 顺序闸同族的互斥律）。
  ② **"这一型听哪几一声"＝全库一份**：`TRIGGER_EVENTS`（＋`eventsHeardBy()`）住叶子模块 `src/skills/reactionTriggers.ts`，问人路的 `REACTION_EVENT_TYPES` 由它派生、自动路的注册也由它驱动（并按每个可听事件逐枚建 listener，**首枚 id 逐字不变** `skill:<owner>:<id>`、其后才追加 `#<eventType>`）；桥接层原来那份 `TRIGGER_EVENT_MAP` 已删除。**`onTurnEnd` 刻意不在表内**（2.3.1 单一发动路禁令）⇒勾了「强制发动」的回合结束时技能**照样问人**，这是边界不是漏（`PLAYER_GLOSSARY.md` §四那一行已把这句写给玩家）。
  ③ **决斗两层同样吃这一格**：开局〔成为技能目标〕通知与收官〔受到伤害后〕`DUEL_INJURY` 两声都进触发链（新导出 `isDuelListenerEvent`＝`DUEL_INJURY` ＋ 带 `duelStage` 而不带 `duelRound` 的 `BEFORE_DAMAGE`）；带 `duelRound` 的六轮仍绝不进＝§H9 第七轮「逐轮不响」一字未动。开局探针由 `hasReactionCandidates`（只数问人路）换成 `hasReactionListeners`（两条路共用同一个 `collectListeners`）⇒**场上只有 forced 受击技时，通知不再被误标 `'settled'` 而整层跳过**。由此钉住一条时序事实：**forced 的"成为技能目标"效果在开局通知之后、互砍之前响完＝这一层全部响完才开始打**（`transitionEquivalence` 新例逐事件索引为证）。
  ④ **重入防双写（§12-88③ 互斥律用在链路上）**：`echoDuelRounds` 已把两层块写进事件流，故 `TransitionCore` 重入拼接加身份过滤 `!events.includes(event)`；该过滤对 `DEATH`／`CARD_LOST`／`CARD_GAINED` **可证惰性**（它们进入事件流的唯一路径就是那次 push）⇒既有锚零位移。
  ⑤ **数据面现状与录入面边界**：官方 95 将＋仓库 DIY 样本**没有一条 `forced:true`**、官方池也零 `DUEL` 实例⇒本刀对既有内容是**结构性 no-op**（B13/B14 各两轮 `cmp` 逐字即证）；本刀不动录入面——**逐效果的 `forced` 栏**仍与 #43 徽章刀 2 那半条一起待裁（现存的开关在**技能级**）。真机证人（决斗问窗＋forced 自动响）＝**#81**，按用户 2026-10-01 组合路口径做，**不为取证改官方池数据**。〔**2026-10-01 #81 已兑现，本格随之从"欠证人"改为"证人已出示"**：五势力主面各挂决斗 DIY 将（10 张 `D-*`，编辑器 DIY 入口，**零开发者口令**）＋`rngState` 钉种子 7 走 canonical 建房链，真实浏览器热座房里问窗两次弹出、两条出口（点技能／点🚫跳过）各走一遍真票，且同一节点上 `forced` 那条两次都在问窗之前自动结算完。⇒⑤ 这半句"数据面零实例⇒结构性 no-op"与"证人靠真机补"两件事现在**同时成立且不矛盾**：锚池里没有实例是锚不动的理由，DIY 卡是造场景的理由，两者都不需要动官方数据。配方与判据＝HANDOFF **§12-90**；本刀零源码改动⇒**不占版本号、不打标签**，五闸与两锚读数以 v2.8.25 定稿树为准、未重跑（重跑只在树变了才有证据增量）。〕
  ⑥ **账面**：测试 939→**946**／83 文件、五闸全绿（check 0／覆盖率 62.11·53.63·52.9·67.17 地板未抬／lint 0 错 29 遗留警告／build 2,060,295 字节内嵌 `2.8.25`）；**B13 {"1":104,"2":196}、B14 {"1":108,"2":192} 双双逐字复现⇒不换锚**（记录见 §H10）。判据＝HANDOFF **§12-89**。

- **技能提示模式＝两档，默认「智能」**（用户原话"完整模式和智能模式都需要「都不发动」按钮，默认'智能'"）。⇒ 两档的**共同契约**是"玩家永远有一个显式的『都不发动』出口"；差别只在**什么时候停下来问**（智能=只在该问时问，完整=每次可发动都问）。这条同时给 #42 定死了最小形态：**新增一枚 canonical 出口动作**，不是纯文案开关。〔**落地口径更正（v2.8.17）**：那句"新增一枚 canonical 出口动作"是我当时的过度形式化，实现时按语义而非字面落地——**引擎侧不新增任何 ActionType**，"都不发动"这个出口接到既有的那次 `END_TURN`（`skipTurnEndAsk`＝`passReaction`＋提交真 `END_TURN`），窗里的发动才是 canonical `ACTIVATE_SKILL`。理由见 §12-75①：**"一个也不做"在录像里的正身就是那次回合结束，另立动作会把同一事实记两遍**。两档本体＝`settings.skillPromptMode`（`'smart'`默认／`'full'`，**不落盘**、不进录像、不进存档）；合法集合唯一真值仍是 `listTurnEndSkillCandidates`，本轮把它重写成 `listTurnEndAskItems().filter(activatable)` 的派生（§12-75②）。**完整档的确切语义＝"场上只要有回合结束技能就问"，不是"每回合硬问一次"**（场上没有这类技能的座位照样不开窗，真机取证见 HANDOFF §9 2.8.17 条⑧c）。用户裁决第 1 句「"选择其一"那个窗，不给「都不发动」」＝v2.8.11 那套逐分支门槛灰条**一行未动**，出口只存在于回合结束询问窗。**#42 就此销账。**〕〔**与 §12-61「全灰不开窗（防死桌）」的关系（v2.8.17 补记，防下轮误读为违约）**：那把锁说的是**抉择窗**——`pendingChoice` 全灰时开窗会把牌桌冻死，因为那扇窗除了"挑一个分支"没有别的出口，所以当时判给 #42 的原文是"#42 落地时必须一并把这个显式出口接上，不许靠开窗硬凑"。回合结束问话窗**结构上不同**：它天生带着 `END_TURN` 这条出口，所以完整档允许"全灰也开一次窗"（配一句「本回合这些技能都不可发动」），**这不是把 §12-61 那把锁拆掉**——抉择窗的全灰不开窗逻辑一字未动，仍有 `choiceGates.test.ts` 那条"全灰不开窗且不白扣发动"钉着。判据：**"全灰要不要停下来问一次"取决于那扇窗有没有出口，不取决于灰条的数量**。〕
- **#38（编辑器导出→仓库文件验证路 ＋ 演练窗"将领来源"自选开关）**：用户口径"等你觉得可以做的时候就一起做" ⇒ 仍为后置立项，**开工时机由施工会话判断**，不与本批任何刀强行配对。
- **#39（技能触发频次报表）**：用户口径"修复报告的统计名单以后不会漏收就好" ⇒ **已落地（v2.8.14）**，见下条。
- **#41（随机练习技能注入）**：用户口径"默认关闭，只有勾选可选项后才打开" ⇒ **已落地（v2.8.16，见 H10）**。**明码代价先登记**：注入概率今日住在 B10 的 RNG 消耗链里，改默认值⇒**基线输入变化＝换锚**（B10→B12 或重立 B10 读数），不是随手能改的一个数字。
- **#43 徽章语义＝2026-09-30 用户更正（逐字钉住）＋刀 1 已落地（v2.8.19）、刀 2（结算执法）待口令**：更正四句——a) **遗计技有样本**：「闭月」这枚技能**同时**挂锁定技与遗计技；b) **锁定技＝无法被无效、也不能被改变**的技能；c) **强制发动＝满足触发条件和代价后会强制发动／直接适用其效果**；d) **这两者与"数值变化＋永续生效"的组合不是强关联**（可任意搭配）。⇒ 我上一轮把锁定技读成"到点自动响"是**错的**，那是「强制发动」那一格的事。**唯一真值源＝`src/domain/skillTags.ts`**（`skillTagMeanings` 供 tooltip 与词汇表共用；别处不得各写一份）：

  | 徽章（一枚技能**可同时挂几枚**，Excel 里用顿号） | 玩家侧那一句话（v2.8.19 起＝代码与词汇表同源） | 运行时现状（v2.8.19 如实账） |
  | --- | --- | --- |
  | 锁定技 | 不能被无效、不能被改变（**不是**"到点自动响"） | **零消费者**＝纯分类；"不可无效/不可改变"要动结算＝**刀 2** |
  | 限定技 | 一局之内的次数额度，用完就没了 | 引擎只有一本"**每回合**限一次"的账（`core/GameState.ts` ＋ `action/resolvers/TurnEndSkillResolver.ts`）；**"一局一次"这类更狠的额度尚未实现** |
  | 登场技 | 上场那一刻响 | 真正决定响不响的是**触发时机** `onDeploy`/`onOtherDeploy`；徽章只被 `tagTimingWarnings` 核对 |
  | 遗计技 | 被击杀那一刻响（样本＝闭月，与锁定技并挂） | 同上＝`onDeath` |
  | 觉醒技 | 满足大条件后变强 | 本作**没有任何觉醒机制** ⇒ 纯粹给人看的标签，待您给定义才谈实现 |
  | （独立开关）强制发动 | 满足触发条件与代价后**直接响**，不用玩家点头；与锁定技、与数值变化／持续生效**都没关系** | `Skill.forced` **存得下来，但编译器与桥接层都不读它** ⇒ 开或关在对局里表现一模一样（v2.8.11 那句"零运行时依据"至今为真）；"不问就响"要与 v2.8.17 的回合结束询问窗对齐语义＝**刀 2**〔**v2.8.25 更正：这一格的"运行时现状"已翻转**——`Skill.forced` 今日由 `SkillTriggerBridge.defersToReactionQueue`（＝`isReactionTrigger(trigger) && forced !== true`）单点读取，是全链路唯一分流位：勾了⇒不注册进问答队列、直接进自动路当场响完；没勾⇒照旧问人。**"存得下来但没人读"与"零运行时依据"两句自本日起作废。** 仍然成立的三条边界：徽章 `tags` 那一列（锁定技／限定技／登场技／遗计技／觉醒技）在结算处**依然零消费**；`onTurnEnd` 型依 2.3.1 单一发动路禁令**不在** `TRIGGER_EVENTS`⇒勾了「强制发动」也照样问人；**今日官方 95 将与仓库 DIY 样本没有一条 `forced:true` 实例**⇒既有对局表现一字未变（锚 B13/B14 逐字即证），真机证人＝#81〔**2026-10-01 #81 已出示**：真实浏览器热座房里**同一张将的同一条「成为技能目标时」**两条定义各走各的门——非 forced 那一条进问窗（问窗两次弹出，出口"点技能"与"🚫跳过"各拿一票），`forced:true` 那一条在问窗之前就以 `TRIGGERED→DRAW` 结算完且**从不出现在选项里**（事件账＋手牌增量 7→8 双证）⇒这一格今日是**真机实证**，不再只有单元钉与四路对账。〕〕 |

  **字段读写契约（只进不出）**：`Skill.tags?: SkillTag[]` 是**唯一写出面**，旧单值 `tag?` **永久只读**（编辑器保存时把带过来的旧字段 `delete`）；理由与 §12-77① 同源——徽章丢失不报错、只会把限制**放宽**。**三条导入路（技能标签列／技能名称尖括号／描述开头自动识别）＋文本手填共用 `parseSkillTagsCell`**，未认识的名称**点名退回**、绝不静默丢。**核对面只点名不动结算**（`tagTimingWarnings`：登场技⇒登场时机、遗计技⇒`onDeath`；只报本轮新引入的、时机一条未填时不报）⇒ **本刀零结算语义、两锚逐字（§H10 末行）**。

### H10 演练装配的默认值与锚名账本（v2.8.16 落地 #41；**内容刀口径：官方池锚因此换名**）

- **裁决原话**＝"练习模式别再随机塞技能"（2026-09-29 用户），承接 §H9 的"默认关闭，只有勾选可选项后才打开"。
- **三处默认值同改一处不落**（全库只有这三处会把注入概率变成非零）：`ai/matchSetup.ts` `defaultMatchConfig` 的 `skillInjection`、`ai/battleCli.ts` 的 `--skill` 默认、`ai/battleHash.ts` 里 URL 缺 `skill` 时的回落值，三条 0.35 ⇒ **0**；演练窗对话框 `AiBattleConfig.tsx` 的 `useState(35)` ⇒ `useState(0)`，提示文案明写"默认 0＝不给将池塞演练技能，想要才调高"。**注入能力一个字没删**：`--skill 0.35`、对话框里把百分比调高、URL 带 `skill=` 三条路都照旧生效（单测用 `skillInjection:1` 证明每将各得一张）。
- **实现形式与用户那句话的对应（如实声明）**：用户说的是"勾选可选项才打开"，落地成**高级设置里那个百分比默认 0**，没有另加一枚复选框——因为**同一个数字框填 0 与填非 0 就是那枚开关**，再加一个框会出现"勾了但值是 0"的第二种分叉（§12-55 同族）。若用户要的是一枚字面复选框，这一处可无痛换成 `practice=on` 编解码，形态归他裁。
- **RNG 消耗面刻意不动**：`matchSetup.ts:260` 那句 `if (random() < config.skillInjection)` **保持无条件掷签**（值为 0 时掷而不中）。若短路成"0 就不掷"，`--skill 0` 那条既有路径的随机游标也会跟着漂 ⇒ **B11 会假性失配**。判据：**关一个开关时先问它有没有附带消耗随机数；有，就只改值、别改掷签次数**，否则一次默认值改动会污染两条锚。
- **锚名账本（后续会话按此读，别再拿旧名当现行门槛）**：

| 锚名 | 含义 | 命令 | 胜席读数 | 状态 |
| --- | --- | --- | --- | --- |
| B9 | 身份锁之前的官方池 | `--games 300 --seed 1` | `{"1":117,"2":183}` | 历史（v2.6.3–v2.7.4） |
| B10 | 身份锁后的官方池（**含 0.35 练习技能注入**） | `--games 300 --seed 1` | `{"1":112,"2":188}` | **历史，止于 v2.8.15** |
| B11 | 仓库固定 DIY 样本池 | `--games 300 --seed 1 --diy-fixture --skill 0` | `{"1":108,"2":192}` | **历史，止于 v2.8.21**（v2.8.9 立；〔2026-10-01 审计更正：v2.8.22/v2.8.23 两格曾登记"B11 逐字"＝**假账**——胜席 108/192 碰巧不变、逐势力小账已漂，见下方换锚记录〕） |
| B12 | 官方池**且默认不注入练习技能**（＝v2.8.16–v2.8.21 实况） | `--games 300 --seed 1` | `{"1":106,"2":194}` | **历史，止于 v2.8.21**（v2.8.16 立；#71 执法刀 c9d3e97 动响应队列⇒读数漂，按"值变即换名"重立为 B13） |
| B13 | 官方池（#71 执法后的今日实况） | `--games 300 --seed 1` | `{"1":104,"2":196}` | **现行官方锚（2026-10-01 审计更正轮立；v2.8.27 刀5 逐字复现＝四轮 `cmp`，含与 v2.8.26 归档捕获的跨版本对照）** |
| B14 | 仓库固定 DIY 样本池（12 张样本那一版） | `--games 300 --seed 1 --diy-fixture --skill 0` | `{"1":108,"2":192}` | **历史，止于 v2.8.26**（v2.8.27 刀5 挪动⇒按"值变即换名"退役，读数一字不删；新锚＝B15） |
| B15 | 仓库固定 DIY 样本池（**13 张**＝第 13 张带「下一次受到的伤害−1」那一版起） | `--games 300 --seed 1 --diy-fixture --skill 0` | `{"1":107,"2":193}` | **现行样本锚（2026-10-03 v2.8.27 刀5 立；换锚成因两条且可分离，见下方复现记录）** |

- **B12 实测（定稿树两轮 `cmp` 逐字节全等）**：won=300、exhausted=0、VIOLATIONS=0，胜席 `{"1":106,"2":194}`；逐势力小账（出场席/胜 · 登场/阵亡 · 攻击/击杀）＝**魏** 108/58 · 182/120 · 16/1；**蜀** 120/55 · 186/121 · 14/1；**吴** 134/69 · 160/111 · 11/1；**群** 127/62 · 200/123 · 11/0；**晋** 111/56 · 159/112 · 6/0（出场合计 600＝2×300、胜合计 300，两账自洽）。
- **为什么换名不叫"B10 重立"**：同一个名字挂两个读数＝后续会话拿旧数当门槛做逐字比对，红也不是、对也不是。**名字只表示"哪一条命令、哪一份池"，值变了就是另一条锚**。历史各刀里写的"硬锚=对 B10 逐字"读作**当时那棵树的事实**，不作今日判据；从 v2.8.16 起非内容刀的硬锚＝**B12 与 B11 同时逐字**〔2026-10-01 审计更正轮起：＝**B13 与 B14 同时逐字**；B12/B11 读作 v2.8.16–v2.8.21 那棵树的事实，见上表与下方换锚记录〕。
- **B11 逐字不变＝本刀最干净的证人**：它显式带 `--skill 0`，与"默认 0"落到同一个 `skillInjection` 值、同一条掷签序列 ⇒ 两轮输出与 v2.8.9/v2.8.15 登记逐字相同。**只有官方池漂了，样本池一格没动＝变化面恰好等于注入默认值这一处**。
- **连带影响面（如实登记，不是遗漏）**：`ai/arena.ts` 走 `defaultMatchConfig` ⇒ 策略档对比（`npm run ai-arena`）自本刀起也不再带演练技能；§G 那条 500 局触发频次审计与 v2.5.4/v2.6.4 的策略档重测**当时是带注入跑的**，将来复跑必须显式 `--skill 0.35` 才能对上旧读数，否则读数差会被误读成"内容变了"。
- **B12／B11 复现记录（v2.8.17，容器层刀 #42 之后的定稿树，各两轮 `cmp` 逐字节全等）**：B12 **{"1":106,"2":194}**、B11 **{"1":108,"2":192}**，五势力／三势力小账与上格 v2.8.16 读数逐格相同。对 v2.8.16 参考捕获做归一化 diff **只剩两行**＝npm 回显包版本号一行＋esbuild 产物体积一行（`216.5kb`→`217.2kb`，CLI 打包体积、非游戏输出）⇒ 回合结束询问窗与两档提示住在**容器层**（不进 EngineState、不进录像、不参与结算），**合法集合谓词只是换成了同一列表的过滤视图**，两锚逐字是本刀"没碰玩法"的数值侧证人。判据（§12-75⑦）：**归一化过滤器之外的每一行 diff 都要点名它住在哪一层**，别靠往过滤器加 pattern 把差异"藏绿"。
- **B12／B11 复现记录（v2.8.18，§八 措辞刀之后的定稿树，各两轮 `cmp` 逐字节全等）**：B12 **{"1":106,"2":194}**、B11 **{"1":108,"2":192}**，五势力／三势力小账逐格等于上两行的既有读数。措辞刀改的是**玩家看得见的字**（组件文案、卡面描述、门槛量名、Excel 写出的细分词、AI 操作日志那一行）⇒ 这些**全部不在 `EngineState`、不在录像、不参与结算**，两锚逐字就是那句"没碰玩法"的外部证人而非自我声明。**注意 B11 也一并复现了**：夹具 `diyGeneralFixture.ts` 里「样·缴械」的**描述文本**被同批改了词，而描述不进结算 ⇒ 样本池读数一格未动＝"卡面文字不影响对局"的最干净实证。
- **B12／B11 复现记录（v2.8.19，#43 徽章刀 1 之后的定稿树，各两轮 `cmp` 逐字节全等）**：B12 **{"1":106,"2":194}**、B11 **{"1":108,"2":192}**，五势力／三势力小账逐格等于上三行的既有读数（胜席合计 300＝全部局分出胜负）。徽章刀 1 改的是**分类标签的读写与显示**（`domain/skillTags.ts`＋编辑器/图鉴/棋盘三处呈现＋导入总结的核对句），**结算面 `src/core`／`src/action`／`src/rules`／`src/skills` 一字未动**；**结构证人比锚更早一步**：官方 95 将卡面**零枚徽章**（徽章只可能来自 Excel／编辑器导入，夹具也没有）⇒ 本刀改的四处**在结构上碰不到对局**，锚是"没有意外波及"的外部证人而非唯一证人。**刀 2（锁定技不可无效／限定技一局额度／强制发动不问就响）一落地就会换锚**——那三件都要进 `EngineState` 或改变发动时机，届时按 §H10 命名规则立新锚名，不得把新读数挂回 B12/B11。


- **B12／B11 复现记录（v2.8.20，#30 决斗刀＝能力刀之后的定稿树，各两轮 `cmp` 逐字节全等）**：B12 **{"1":106,"2":194}**、B11 **{"1":108,"2":192}**，五势力／三势力小账与上两格逐格相同（B12：魏 108/58·182/120·16/1、蜀 120/55·186/121·14/1、吴 134/69·160/111·11/1、群 127/62·200/123·11/0、晋 111/56·159/112·6/0；B11：魏 217/121·339/197·33/2、蜀 193/87·275/186·12/1、吴 190/92·297/214·8/1）；胜席合计 300＝全部局分出胜负（今日 CLI stdout 已不再打印 `won=/exhausted=/VIOLATIONS=` 那三行，按**胜席合计**记账，不抄旧字样＝§12-78 的"读数要现场量"）。**这一格的分量与前三格不同**：本刀**动了 `src/core`＋`src/skills` 的结算路径**（新增第 10 枚可结算原语、新增派生分支、`EventProcessor` 多出一次队首前置、`TransitionCore` 多一次回声）⇒ 按 §12-78④ 判据（"是否可能改变既有对局状态转移**或其输入**"）这是 **A 级**，不是前三轮那种"呈现层所以必然不动"的 B 级。**逐字的真成因**：官方 95 将**没有任何一条 `DUEL` 效果**、仓库 DIY 夹具也没有 ⇒ 新代码在这两池下**结构上进不了场**（`grep` 官方数据可复核）；因此锚在此是**外部证人**（"没有波及既有池"）而非自我声明，而**内部证人**是 `transitionEquivalence.test.ts` 的两例四路对账（常驻／重建／重放／同配置两跑逐字节）。对 v2.8.19 参考捕获做归一化 diff **只剩 npm 回显版本号一行＋esbuild 产物体积一行**（CLI 打包体积、非游戏输出）⇒ 游戏输出逐字节相同。判据沿用 §12-78⑦：**归一化过滤器之外的每一行 diff 都要点名它住在哪一层**，别往过滤器加 pattern 把差异"藏绿"。

- **B12／B11 复现记录（v2.8.21，#69 监听扩面刀之后的定稿树，各两轮）**：B12 **{"1":106,"2":194}**、B11 **{"1":108,"2":192}**，两池的五势力／三势力小账**逐格等于上格的既有读数**（B12：魏 108/58·182/120·16/1、蜀 120/55·186/121·14/1、吴 134/69·160/111·11/1、群 127/62·200/123·11/0、晋 111/56·159/112·6/0；B11：魏 217/121·339/197·33/2、蜀 193/87·275/186·12/1、吴 190/92·297/214·8/1），`won=300 exhausted=0 VIOLATIONS=0`，编译期跳过行数 **82 行未变**（＝两池的可结算面一格没动）。**同轮更正上格里我写错的一句读数**：那格说"今日 CLI stdout 已不再打印 `won=/exhausted=/VIOLATIONS=` 那三行"——**实测今日仍打印**，它们住在**同一行**里（`won=300  exhausted=0  VIOLATIONS=0  avg=…  wall=…`），我把"没数出行首"读成了"消失"。登记照旧按现场读数记；判据补一条：**§12-78"读数要现场量"也适用于别人（包括上一轮的我自己）写进账本的读数**，照抄一句错措辞会让下一轮去找一个不存在的变化。两轮字节级对照：B12 两轮对 `Done in …ms`／`wall=`／`slowest=` 三条壁钟行归一后**逐字节全等**；B11 两轮只差同一行的 `avg/slowest/wall`（`119ms`→`146ms`）⇒游戏输出相同。**本刀逐字的成因比决斗刀那格更硬**：新代码不只是"池里没有实例"，而是**缺省档本身＝扩面前的逐字行为**（`listenerScope` 缺省 `self`、`targetSubType` 缺省 `attackTarget`），且新档今日**没有发射器**（技能指定目标不发通知事件）⇒官方 95 将与夹具**结构上无入口**。按 §12-78④ 这仍是 **A 级**（动了监听消费面＝可能改变既有触发的输入）⇒锚是必需证人；内部证人＝`listenerScope.test.ts` 的桥接消费 6 例（真实对局事件逐档验：缺省不扩响、同席位扩响、跨席位扩响、**以及打本营那一声三档都不响**）。
- **换锚重立记录（2026-10-01 审计更正轮：B12→B13、B11→B14；本格同时更正 v2.8.22／v2.8.23 两格的"两锚逐字"假账）**：① **盘账**：HEAD（`75109e3`）上 B12／B11 两条命令各两轮，对壁钟行归一后**两轮彼此逐字节全等**（确定性无恙），但与旧账比对**"逐字"不成立**——官方池胜席 106/194→**104/196**、五势力小账位移（魏登场/阵亡 182/120→181/122、吴 160/111·11/1→161/113·15/4 等）；样本池胜席 108/192 **碰巧未动**、三势力小账同样漂（魏 339/197·33/2→335/192·19/0 等）⇒ 旧登记只核了胜席一行，**判据：逐字＝全输出归一化 `cmp`＋小账逐格，胜席列不是锚本身**（HANDOFF §12-87①）。② **成因钉死（区间夹逼，§12-87③）**：临时 worktree 检出 `v2.8.21@125f532` 复跑同 seed ⇒ 106/194 与旧小账**逐字复现**（旧账在那棵树是真的，不是当年量错）；`git log --stat` 过滤 `src/` ⇒ 区间内唯一运行时提交＝`c9d3e97`（#71 执法刀，29 文件 1230+/126−）⇒ 漂移＝**玩法级变化**（受击/受伤技能挪进响应队列＋AI 司机代答问窗，【刚烈】类 `onDamageTaken` 监听时机与可见性改变，两条已知限制本就是该刀登记的实玩法语义）。③ **处置＝按"值变即换名"重立，不改写历史格**：新现行锚 **B13 {"1":104,"2":196}**（won=300、exhausted=0、VIOLATIONS=0；五势力出场/胜·登场/阵亡·攻击/击杀＝魏 108/58·181/122·17/1、蜀 120/55·186/121·14/1、吴 134/69·161/113·15/4、群 127/62·200/123·11/0、晋 111/56·159/112·6/0；出场合计 600、胜合计 300 自洽）与 **B14 {"1":108,"2":192}**（三势力＝魏 217/121·335/192·19/0、蜀 193/87·273/184·12/0、吴 190/92·295/213·8/1）；B12／B11 转历史、止于 v2.8.21；自本轮起非内容刀硬锚＝**B13 与 B14 同时逐字**。④ **假账就地更正**：v2.8.22（执法刀落地）与 v2.8.23（已知限制钉测刀）两格曾把"两锚逐字"写实——执法刀当时只跑 33 例专项、未跑全量套件，938 例 83 文件是本轮审计才第一次在 HEAD 复跑全绿（§12-87④：A 级刀不得带"全量未跑"收尾）；更正落点＝HANDOFF §3 两格就地括号＋§9 本轮条＋§12-87。⑤ **最终树复测（docs×7＋`package.json` 一格定稿后）**：B13／B14 各两轮，壁钟行归一后 `cmp` **逐字节全等**；剥去 npm/esbuild 回显头后与第0档 HEAD 捕获**逐字节相同**（唯一 diff＝同一行的计时占位）⇒ 本轮改动面（文档＋同长度版本串）**结构上碰不到对局**，两锚是外部证人。五闸最终树：check 0 错误／全量 **938 例 83 文件**全绿／覆盖率 62.04·53.69·52.74·67.16 过地板（42/34/34/47）／lint **0 错误 29 遗留警告零新增**／build 单文件 2,057.50 kB（gzip 604.37 kB；`dist/index.html`＝2,057,498 字节，与补正前**同字节数**——版本串 `2.8.22`→`2.8.23` 等长替换，gzip 差 1 字节，无玩法成分）。
- **B13／B14 复现记录（v2.8.24，#70 决斗刀 2＝内容刀之后的定稿树，各两轮 `cmp` 逐字节全等）**：**B13 {"1":104,"2":196}**（五势力 魏 108/58·181/122·17/1、蜀 120/55·186/121·14/1、吴 134/69·161/113·15/4、群 127/62·200/123·11/0、晋 111/56·159/112·6/0）、**B14 {"1":108,"2":192}**（三势力 魏 217/121·335/192·19/0、蜀 193/87·273/184·12/0、吴 190/92·295/213·8/1），`won=300 exhausted=0 VIOLATIONS=0`；归一化（计时行＋npm 版本回显行＋esbuild 体积行 `238.9kb`→`244.1kb`）后**两轮彼此全等，且与本刀开工前的基线捕获逐字节相同**（原始件＝本地 `…\tk-audit\duel2base\` 与 `…\duel2final\`，指针已入 HANDOFF §9 本轮条⑤＝GPT 验证标准门 Q2 那笔"证据链固化"账的收口）。**这一刀与上一格审计轮的关系要读准**：#70 动的正是 §H9 里那条"决斗受击不触发"的已知限制（＝挪锚的那一族语义），但它**碰不到两锚池**——决斗效果只挂在 DIY 夹具之外的合成载荷上、官方 95 将零 `DUEL` 实例⇒ 逐字的成因是"新代码在这两池里没有入口"（与 v2.8.20 那格同族），**不是**"改结算所以没关系"。内部证人＝`transitionEquivalence.test.ts` 新三例（开局问讯延后专路／决斗全链四路对账／诚实空转两档）＋`EventProcessor.test.ts` 的 `DUEL_INJURY` 恒等钉。**若下一刀把 `DUEL` 转正进任一锚池，这两行读数必然位移⇒按"值变即换名"立新锚名，不得把新读数挂回 B13/B14。**
- **B13／B14 复现记录（v2.8.25，#72 强制发动执法刀之后的定稿树，各两轮归一化 `cmp` 全等）**：**B13 {"1":104,"2":196}**（五势力 魏 108/58·181/122·17/1／蜀 120/55·186/121·14/1／吴 134/69·161/113·15/4／群 127/62·200/123·11/0／晋 111/56·159/112·6/0）、**B14 {"1":108,"2":192}**（三势力 魏 217/121·335/192·19/0／蜀 193/87·273/184·12/0／吴 190/92·295/213·8/1），两池均 won=300／exhausted=0／**VIOLATIONS=0**，逐格等于 §H10 现行读数⇒**不换锚**。**逐字成立的结构理由**：本刀只改"问不问人"与"哪些事件重入触发链"两件事，而官方 95 将与 DIY 样本**没有一条 `forced:true`**（⇒分流位今日无人触发）、重入集合新增的两类事件在既有锚池里**无听众**（⇒`resolveTriggerChain` 展开为空），且身份过滤 `!events.includes` 对 `DEATH`／`CARD_*` 可证惰性；**归一化口径（本轮补记，供后续会话复用）**＝只取 `[ai-battle]` 起至文末＋把 `avg/slowest/wall` 计时三件套替换为 `TIMING`，因为编译器 `NO_RUNTIME_PAYLOAD` 警告的**打印次序**在两跑之间会不同（它住在比较块之外，不是锚噪声的新来源，而是同一族 §12-22④ 抖动的另一种形态）。原始 stdout 留本地取证目录 `C:\Users\10128\.qoder-cn\tmp\tk-audit\forced25\`（`b13_r1/r2`、`b14_r1/r2` ＋五闸各件与 `exits.txt`）。
- **B13／B15 复现记录（v2.8.27＝2.8 刀5「受到伤害增减」之后的定稿树）**：**B13 {"1":104,"2":196} 逐字未换名**＝四轮归一化 `cmp` 全等（定稿树 bump 后两轮 `dt27bump/b13_r1_n·b13_r2_n` ＋ bump 前一轮 `dt27/b13recheck_n3` ＋ **与归档的 v2.8.26 捕获 `statmod26/b13_r1_norm.txt` 逐字节相同＝跨版本对照，本刀确实没挪官方池**）；五势力小账逐格相符（魏 108/58·181/122·17/1／蜀 120/55·186/121·14/1／吴 134/69·161/113·15/4／群 127/62·200/123·11/0／晋 111/56·159/112·6/0），won=300／exhausted=0／**VIOLATIONS=0**。**这个"逐字"有两半，理由强度不一样，不许混着报**：①**改数那一半是结构保证**——`passiveModifiers.test.ts` 那条入口存在性静态断言在案＝官方 95 将零 `MODIFY_STAT` 效果⇒场上永远不会有单笔 `DAMAGE_TAKEN` 账被 `resolveDamageTaken` 读到⇒新读数点恒等于原数；②**「只有掉血才算受到伤害」那一半是语义改判、不是 no-op**——旧树里护甲全挡那一刀仍发 `DAMAGE`（`hpLost:0`）⇒夏侯惇【刚烈】这一类「受到伤害后」会被问到，新树里那一刀压根不发 `INJURY`⇒不问。B13 逐字因此是**这 300 局里没出现过"护甲全额吃掉一刀"这一型受击**的实测结果，不是结构性不变量。两种局面都当面跑过并留了证人（真机 E2E＋`statModifierPipeline.test.ts`「护甲吃满那一刀＝这一声不存在」），登记为**已知语义变化**；今后若有官方卡或内容刀造出护甲全挡的实战样本，B13 会当场挪＝按"值变即换名"处置，届时不得回头说"刀5 当时就逐字过"。
- **B14→B15 换名（值变即换名，§H10 锚名规则）**：样本池 **{"1":107,"2":193}**（两轮 `cmp` 全等 `dt27bump/b15_r1_n·b15_r2_n`；三势力小账＝魏 出场 212 席 胜 110（51.9%）·登场 300 阵亡 183（61.0%）·攻击 18 击杀 0／蜀 201/95（47.3%）·290/197（67.9%）·8/0／吴 187/95（50.8%·登场 288 阵亡 195＝67.7%）·8/1；合计 600 席＝2×300 自洽）。**挪动的成因有两条、且已被一次专门探针分离清楚**：①**语义改判**（只有掉血才算受到伤害）——同一棵树上把 fixture 退回 12 张跑探针（`dt27/b14sem_n.txt`），标题行**碰巧**回到 `{"1":108,"2":192}`（与旧 B14 同值＝巧合，不可当"没变"读），三势力小账已移位（魏 217/122·338/190·29/1／蜀 193/86·275/192·13/1／吴 190/92·295/213·8/1）⇒**语义确实挪了样本池**；②**分母变化**（第 13 张样本「试作·魏戊：回合开始时，你下一次受到的伤害−1」入场）⇒标题行落到 107/193。两条都不是回归缺陷：样本池本来就是"能力活例"的载体，往它里面加一张带新效果的卡＝按定义改分母。**旧 B14 连同三势力小账整体转为历史锚、读数一字不删**；换样本＝重立 B15，**绝不动 B13**。

> **落地状态（v2.8.14＝#39 报表面修复，非内容刀⇒两锚逐字）**：`battleRunner` 的名单从"手写事件类型清单"换成 **`isSkillEffectEvent(ev)`＝桥接层载荷自证**（`SkillTriggerBridge.translateEffect` 给**每一条**效果事件盖 `skillId`+`effectType`，全库仅此一处盖章 ⇒ 新增效果类型**结构上必然被计入**，不必再有人记得补名单）。同轮查出并修掉第二条**名单错**：`battleCli --skill-stats` 的期望名单此前硬取官方账本，`--diy-fixture` 批次里 12 张样本全被判成"名单外零触发"⇒ 改为 `configuredSkillRows(generalsForPoolSource(...))`（**计数一直是对的，错的是名单**）。三条判据入 HANDOFF §12-71：①"以后不会漏收"类的诉求要落成**由生产端自证的谓词**，不是更长的清单 ②观察层两处（过滤器/名单）必须同源，改一处不改另一处＝显示与生效分叉的报表版 ③报表面失真**不动锚**（§12-59③ 同族），本轮 B10/B11 各两轮逐字。

### H11 玩家可见词汇现行账本（v2.8.18 §八 措辞刀立；**纯词面账本，零结算语义**）

这张表回答一个问题：**同一个游戏事实，玩家面前现在只准写哪一个词**。后续会话改任何文案前先来这里对账，别再从各组件里就地观察（就地观察得到的是"现状"不是"裁定"）。

| 游戏事实 | 现行唯一写出形态 | 只接受、绝不写出的旧词 | 权威住在哪 | 玩家可见面 |
| --- | --- | --- | --- | --- |
| 将领／本营的血 | **体力** | 生命（v2.8.18 起全库源码 0 处） | 字段 `currentHp/maxHp` | 规则页、抽卡窗、棋盘数值格 |
| 那摞资源牌 | **抽牌堆** | 牌堆（门槛手填与旧 Excel，走 `METRIC_ALIASES`）、卡牌池（已消失） | `skills/skillGateText.ts` `GATE_METRIC_LABELS.DECK_COUNT` | 抽卡窗、门槛录入框与回显、演练窗高级设置、棋盘顶栏 |
| 第三种牌种 | **军备**（枚举只有 粮草／材料／军备，"装备"从来不是一个牌种、也没有装备区） | 失去**装备**牌（细分词，走 `LEGACY_CARD_SUB_LABELS`）；效果**类型名**「拆掉装备」按裁决范围保留、不是漏改 | `data/cards.ts:4`、`data/generals.ts` `cardSubLabels`、`skills/skillExcelFormat.ts` `runtimeEffectTypeLabels` | 卡面描述（强袭／枭姬／崩坏／DIY 夹具）、编辑器下拉与预览、门槛细分 |
| 交军备牌换护甲这件事 | **叠甲**；日志行写「叠甲 `id`，军备N张」（与邻居「补给 `id`，用卡N张」同句式） | 装备护甲（旧日志行） | `ai/battleReport.ts` `formatActionLine`（经 `replay/gameplayLog.ts` 进自动保存的操作日志） | 棋盘检视面板按钮、对局操作日志 |
| 将池为空时扣的那一点血 | **本营**（"营地"在棋盘上另有所指＝放将领的三个槽） | 营地（v2.8.18 抽卡窗四行已改） | `action/resolvers/ResolveBaseLossResolver.ts` 发 `BASE_DAMAGE` | 抽卡窗警示块与抽空预警 |
| 本营归零的横幅 | **本营击破** | `BASE DESTROYED`（v2.8.18 翻译；这一行保留不删＝横幅版式靠它起头） | `components/GameBoard.tsx` 覆盖层、`GameOverScreen.tsx` 只认 `gameOverBanner` | 击破覆盖层、结算页。**注**：投降路径**不设**击破横幅＝既有行为 |
| 回合结束问话窗的出口 | **🚫 都不发动** | ⏭️ 跳过并结束回合（v2.8.17 按裁决合并，同一处理器） | `store/gameStore.ts` `skipTurnEndAsk` | 问话窗、`⏭️结束回合`（窗开着时再点＝同一句都不发动） |
| 补给的频率 | **轮到你的回合时，每名将领各可补给一次**（"一局只能一次"是错的，从未上线） | — | `core/eventProcessors/turnEvents.ts:32` `applyTurnActionsResetEvent` 每回合清 `hasSupplied` | 规则页「补给与军备」、词汇表 §二／§八 |
| 护甲挡刀比例 | **每 2 点护甲抵消 1 点伤害；单数护甲挡不下这一刀、原样留在身上** | — | `core/armorDamage.ts:15` 的 `while(remainingDamage>0 && armor>=2)` | 规则页、棋盘「🛡️护甲」格悬停、图鉴同一格悬停 |
| "被点名"这一刻的来路 | **成为目标时→被谁指名**（成为攻击目标／成为技能目标／成为目标（两种都算））；**不选＝只算攻击** | 成为**攻击**目标时（v2.8.21 起这是**整格别名**，只读不写：旧 `.xlsx` 那一格照旧读懂，再导出必写新形式） | `data/generals.ts` `targetSubLabels`＋`skillExcelFormat.ts` `LEGACY_TRIGGER_CELL_ALIASES` | 编辑器「└ 被谁指名」下拉与预览句、Excel 触发栏、词汇表 §四、导入总结的点名句。**要紧的实话**（录入面就地写）：今日只有"攻击"发得出这一声，技能那一路排在 #70/#71 |
| 一条被动听多宽 | **我听谁**（只听自己／听己方（同一席位）／听场上（所有玩家））；**不填＝只听自己**；它是**独立一列／独立下拉**，绝不写进触发那句话 | 友方／队友／全场（这三个词在项目里各有别的所指，"己方"专指**同一席位**而非同势力） | `data/generals.ts` `listenerScopeLabels`（唯一词表）＋`supportsListenerScope`（唯一适用面判定） | 编辑器「└ 我听谁」下拉、Excel 固定列「我听谁」＋「效果N我听谁」、两列表头批注、词汇表 §四 |

| 轴 | 实况 |
|---|---|
| 改词只改表 | 录入面与门槛的词只住在 `skillExcelFormat.ts`（`runtimeEffectTypeLabels`/`runtimeTargetLabels`/`cardSubLabels`）与 `skillGateText.ts`（`GATE_METRIC_LABELS`/`GATE_SYNTAX_HINT`）；Excel 导出单元格、下拉校验串、编辑器下拉、门槛回显、提示语**全部由这几张表派生**⇒不可能出现"界面一个词、导出另一个词"。**第二处是卡面描述文本**（`data/generals.ts`），它不在任何表的派生里，改词时必须单独过一遍。 |
| 只进不出怎么保证 | 解析顺序＝**枚举名 → 现行标签 → 旧行话**，反写（结构→文本／单元格）**只走现行标签**⇒单向门。别名一律接在**严格入口** `readTriggerCell` 的包装层，宽松 `strToTrigger` 的脾气不动。**v2.8.21 起别名分两族**：细分词的旧叫法走 `→` 后半截（`LEGACY_CARD_SUB_LABELS`），**整格的旧主名**走 `LEGACY_TRIGGER_CELL_ALIASES`（「成为攻击目标时」＝改主名那一族的唯一成员）——因为改主名时旧文件那一格**整句**都是旧词，逐截匹配永远匹配不上。 |
| 为什么必须留旧词 | 用户的 `.xlsx` 是他自己维护的长期资产；更关键的是**"读不到"的默认后果常常是把限制放宽**：`strToTrigger` 拿不到细分词时交回不带 `cardSubType` 的 `{type:'onCardLost'}`＝"失去**任意**牌"，枭姬静默变强。**动任何一个玩家可见的词之前，先问"这格读不到时引擎会当成什么"**。 |
| 防漂移钉 | `skillExcelFormat.test.ts`「旧词『失去装备牌』读入侧仍认，但绝不写出」（含 `triggerToStr(...)` 反写不含"装备"、只读半截「失去装备」按没看懂交回、宽松入口保持宽松这三条边界）；`skillGateText.test.ts` 旧写法「牌堆≥5」与新写法解析结果逐字相同且反写必为「抽牌堆…」；`battleReport.test.ts` 钉住「叠甲 …，军备N张」且该行不含"装备"；`skillExcelFormat.test.ts` 另有"下拉每个选项都必须被自家解析器认得"那条承自 v2.8.3 的纪律。 |
| 扫描面按"谁能看见"划分，不按目录划分 | 一次全库换词要过**四类**：组件文案（`src/components`）、卡面文本（`src/data/generals.ts`＋夹具 `src/ai/fixtures`）、报表与日志（`src/ai/battleReport.ts`→`src/replay/gameplayLog.ts`）、录入面词表（`src/skills`）。本轮最易漏的是第三类：那句 `装备护甲` 住在 AI 模块里，却是玩家自动保存的日志正文。 |
| 历史引文不追改 | 本文件与 HANDOFF、双历史里**过去各刀**引用的旧词（如「剥离伤害目标的一张装备卡」这类原文摘录）属**历史记录冻结**，不改写；"现在准写什么"一律以本表为准。刻意保留、有理由的"装备"三处＝读入侧别名、效果类型名、源码注释（详见 HANDOFF §3 本轮条④）。 |
| 裁决圈住什么就改什么 | 第 4 句圈"技能描述"⇒类型名未动；第 3 句只是**确认**了 2 挡 1 的既有规则⇒写进文案而没改结算；第 5 句说徽章"开始真管事"⇒那是**结算刀**，先提案后代码。**"没改"要连理由一起登记**，后续会话才不会把克制当成遗漏。 |



