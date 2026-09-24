# PROJECT_ARCH_MAP — 全项目架构与权威地图

基线：**v2.2.10**（本文档随 2.2.11 建立；该版本仅文档与措辞修正，无行为变更，地图内容对 2.2.10==2.2.11 均成立）。
最近一次全量验证时点：2026-09-24（本地五项验证全绿 + CI run `35880374035`）。

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
| `core/EngineState`（经 `core/GameState.ts`） | State | 对局唯一持久真相源，可序列化/重建；2.2.18 起携带 `rngState?`（引擎随机游标，纯数据 {s}，structuredClone 友好） | CANONICAL | 它自己（一切状态以它为准） | game-scoped（持久于 store） | PURE（数据本身） | UT/CI | rngState 已落地（2.2.18 阶段 D 首刀）；缺字段旧快照由 applyDrawEvent 惰性重播种；RandomOutcome 事件流仍 PENDING（见 D-2；建局随机迁移已于 2.2.19 销案） | 1.x |
| `core/rng.ts`（2.2.18 新增，49 行） | State | 引擎种子 RNG 原语：`createRngState/cloneRngState/rngNext/rngShuffle`（mulberry32，uint32 游标，可 JSON 序列化；rngShuffle 返新数组） | CANONICAL | 引擎路径唯一随机算法 | 随 EngineState | SEEDABLE（游标即状态） | UT（rng.test 8 例） | 仅抽牌链在用；建局牌堆/骰子/action.id 仍走别处（D-2 后续刀） | 2.2.18 |
| `core/TransitionCore.ts`（2.2.20 新增，96 行） | Engine | **唯一纯转移函数** `transition(state, action, ctx{rules,resolvers,processor,triggers}) → {state, events, accepted}`：校验（ACTION_REJECTED 早退）→ getResolver（NO_RESOLVER 早退）→ ACTION_ACCEPTED+resolve → 触发链展开 → EventProcessor 结算 → 派生 DEATH 有界重入（≤8 轮，TRIGGER_REENTRY_LIMIT 哨兵，常量唯一定义处）；不发 STATE_CHANGED、不盖事件 id/timestamp | CANONICAL | "一次动作如何改变状态"唯一算法（D-1 禁双路纪律：全库不得出现第二份转移逻辑） | PURE（state 进 state 出，副作用零） | 不触随机（随机只在 EventProcessor 消费 rngState） | UT（transitionEquivalence 三路对账，2.2.21 起扩为四路） | store 常驻迁移已落地（2.2.21 阶段 E 第二刀，见 bridge 行与 C-1） | 2.2.20 |
| `core/GameEngine.ts`（109 行，2.2.17 时点 153；2.2.20 降为容器壳） | Engine | dispatch 容器：调用 TransitionCore.transition + 纯路径外必须留的效应——rejected 即时 emit、接受路径尾部 push STATE_CHANGED 快照、EventBus 发射循环、recordHistory 门控的 replay.record + snapshots.capture；持有 replay/snapshots/reactions/skillTriggers 等装配件 | CANONICAL | 引擎对"副作用与事件外发"负责 | **容器生命周期**：实况 UI 经 2.2.21 起的模块级常驻容器（bridge 每步 adopt 入参 engineState 克隆——状态唯一来源仍是入参，容器对 store 无漂移）；ReplayPlayer 与对账路径仍各自重建/真常驻（2.2.20 起每步 dispatch 前 syncPlayerSkills） | RNG 无关（转移纯，随机在状态里） | UT/IT/CI | 长生命周期装配件（Reaction/网络）容器已就位但业务入口仍未接线（§12-9c/D-3），D-1 本体两刀已收线 | 1.x |
| `core/EventProcessor.ts`（106 行，2.2.13 时点 93；原 852） | Event | 事件→状态迁移唯一应用入口（process 队列循环 + apply 薄分发；D-6 阶段 B 第二刀纯移动拆分，处理器逐字移入 eventProcessors/，唯一入口纪律不变；2.2.17 增可选 `collected[]` 追加收集参：队列中途派生事件在入队点被收集供 GameEngine 重入，仍是唯一改动入口 D-2） | CANONICAL | 状态如何变化它说了算 | 随引擎重建 | PURE（除 legacy 护甲兜底用 Date.now，见 D-4） | UT/CI（17+ 用例） | 已按事件族拆分（2.2.13） | 1.x |
| `core/eventProcessors/*`（6 文件 939 行：damageEvents 168 / drawEvents 199 / generalEvents 264 / playerEvents 77 / turnEvents 95 / chainedConsequences 136） | Event | 事件族处理器（纯 (state, event) → state 函数）+ 派生事件入队（DAMAGE/DEATH/BASE_DAMAGE/PLAYER_DEFEATED 连锁；2.2.17：generalEvents += applyHealEvent/applyGainArmorEvent，chainedConsequences DAMAGE 分支对技能致死补发 DEATH（skillKill 标记，damageType 门与 AttackResolver 自带 DEATH 去重）；2.2.18：drawEvents 的 applyDrawEvent 收敛为**全引擎唯一抽牌选牌点**——将池种子洗牌、牌堆顶切、弃牌堆种子重洗（替代旧有偏 sort(()→Math.random())），游标推进写回 state.rngState，缺游标旧局按 turn/round/deck 派生确定性兜底种子） | CANONICAL（仅经 EventProcessor 单一入口调用，禁第二入口） | — | 随引擎重建 | SEEDABLE（2.2.18 起抽牌/重洗全部消费 rngState，事件族处理器内已无 Math.random） | UT/CI | 2.2.13 引入，纯移动零行为变化；2.2.17 起承载阶段 C 行为扩展；2.2.18 起承载阶段 D 确定性 | 2.2.13 |
| `core/EngineDispatchFlow.ts` | Engine | dispatch 流程辅助 | CANONICAL | — | action-scoped | PURE | UT | — | 1.x |
| `action/ActionDispatcher.ts` + `resolvers/*`（11 个） | Action | 动作→事件产出 | CANONICAL | 各 resolver 对自己动作的事件形态负责 | request-scoped | PURE（2.2.18 起抽牌类亦然：DrawResolver 只校验+产计数 DRAW 事件，选牌收敛到 applyDrawEvent，D-2"禁 Resolver 私拿随机源"达成，测试有 Math.random 抛错探针） | UT 全覆盖/CI | —（技能效果结算缺口已于 2.2.17 闭合，见 skills/eventProcessors 行） | 1.x |
| `rules/ActionValidator.ts` | Rule | **合法性最终裁判** | CANONICAL | 合法/非法它说了算 | request-scoped | PURE | UT/E2E | — | 1.x |
| `rules/legalActions.ts` | Rule | **候选动作枚举**（供 AI；同类资源用代表卡收窄） | CANONICAL | 只产候选，无合法性权威（契约措辞 2.2.11 已改准） | request-scoped | PURE | UT（与引擎裁判对账测试） | 指定卡消耗需求出现时按 D-5 引入 CardSelectionPolicy | 2.2.3 |
| `rules/RuleEngine.ts`、`battlefieldRules.ts` | Rule | 规则查询辅助 | CANONICAL/COMPAT | 战场规则查询 | request-scoped | PURE | UT | 与 ActionValidator 边界未逐条钉死 | 1.x |
| `domain/*`（combat/cost/regions/constants） | Rule | 数值与区域规则口径 | CANONICAL | 常量与公式 | 静态 | PURE | UT | — | 1.x |
| `data/generals.ts`、`cards.ts`、`registries/*` | Data | 卡牌/将领静态数据与注册表 | CANONICAL | 数据内容 | 进程级 | PURE | UT/E2E | — | 1.x |
| `skills/skillCompiler.ts`（212 行）→ `SkillTriggerBridge.ts`（283 行）→ `triggers/TriggerEngine.ts` | Skill | 数据化技能唯一运行时链路（2.2.17：可结算效果面 = DRAW_CARD/DAMAGE/HEAL/GAIN_ARMOR 四类型；bridge 把 HEAL/GAIN_ARMOR 翻译为真实事件含目标解析；致死链经 chainedConsequences 补发 DEATH 打通 onKill/onDeath/补偿抽） | CANONICAL | 技能何时触发、产出什么事件 | 随引擎 | PURE（编译）/RNG（触发结算可致伤） | UT/CI/E2E（2.2.1 真机贯通；2.2.17 store 直驱实测疗愈/固甲/技能击杀链） | 触发覆盖不全（modify*/onBase*/passive/active*/untilExpire/onOtherDeploy/onTurnEnd/onBecomingTarget/onTargetConfirmed/onOtherSkillActivated 无引擎事件支撑，仍待接；ReactionWindow 业务入口见 D-3/c 项） | 2.1.0 |
| `skills/skillExcelFormat.ts`（241 行）、`SkillDataRegistry.ts` | Skill | Excel 六列导入导出与数据登记（2.2.17：`SETTLEABLE_RUNTIME_TYPES` 四类型，编辑器"暂未接入结算"标注随数据源消失） | CANONICAL | — | request/进程级 | PURE | UT | — | 2.2.0 |
| `store/gameStore.ts`（622 行，2.2.12 时点；原 956） | Store | 会话态 + UI 投影 + 对局动作装配（编辑器/恢复/演练场切片已外移） | CANONICAL（会话态） | 界面与流程状态；对局真相仍以 EngineState 为准 | 页面级（内存，刷新即失） | TIME/EXT | UT/E2E | D-6 阶段 B 第一刀已落地（2.2.12 纯移动拆分，见 gameStoreTypes/EditorActions/Recovery 行）；GPT 评审确认非"规则回灌"，是"应用层 Store+兼容层" | 1.x |
| `store/gameStoreTypes.ts`（135 行）、`gameStoreEditorActions.ts`（137 行）、`gameStoreRecovery.ts`（70 行） | Store | 2.2.12 自 gameStore 拆出：类型面全量、编辑器/开发者动作工厂、快照恢复动作工厂 | CANONICAL（gameStore 的组成部分；gameStore 再导出类型保持消费口径） | 无独立权威——宿主仍是 gameStore | 页面级 | 编辑器/恢复路径 EXT | UT（复用 gameStore 测试面）/E2E 冒烟 | 纯移动拆分零行为变化；后续切片按同模式继续 | 2.2.12 |
| `store/engineExecutionBridge.ts`（2.2.21 起常驻化） | Store | store↔引擎唯一执行收口点：**模块级常驻 GameEngine 容器**（recordHistory:false，对局级录像仍由 liveReplayRecorder 单路承接）——每步 adopt 入参 engineState（克隆）+ 技能注册表全量重登记（unregister 上一批 owner 再 syncPlayerSkills），再 dispatch+snapshot+recordLiveDispatch；旧每步重建降级为 `dispatchStoreActionReconcile`（对账工具专用、不喂录像器） | CANONICAL | — | **模块级常驻容器**（无失效钩子：adopt-clone 使外部改写 store 态天然被尊重） | PURE（相对 store——唯一真相来源永远是入参） | UT（四路对账+容器三例：实例复用/resync 清死将/别名态变更被消费）/IT | D-1 落点（两刀收线）；测试缝 `__resetResidentEngineContainer/__residentEngineProbe` | 1.x（2.2.21 常驻化） |
| `store/gameStateAdapter.ts`、`engineAwareSetter.ts`、`localGameSnapshot.ts`、`editorPersistence.ts`、`testArenaActions.ts`（441 行，2.2.12 起含 buildTestArenaState/settleDrawInTestArena） | Store | 引擎↔store 投影、存档、编辑器持久化、演练场动作+演练场状态推导；2.2.18 起 `seedRngState`：建房播种 rngState 一次（Date.now^random），局中已有游标绝不重置 | CANONICAL/COMPAT | 投影规则归 adapter | 页面级 | EXT（localStorage）；TIME 仅播种一次 | UT（含 executeDraw.rng 建房播种例） | — | 1.x-2.x |
| `ai/policies/*`（三档策略+随机） | AI | 从候选中选动作（激进>均衡>保守>随机，擂台 3400 局零违例） | CANONICAL | 选什么动作 | 会话级 | PURE（零随机——司机卡死检测前提） | UT/arena/CI | 权重静态手工标定，规则数值变动需重跑 ai-arena | 2.2.7 |
| `ai/aiTurnDriver.ts` | AI | 生产 store 链路的人机座位司机（征召/抽牌/出招/护栏） | CANONICAL | AI 座位节奏 | 对局级 | PURE 前提 | UT/E2E 两局 | 引入随机策略需重审 lastChoiceKey 回退 | 2.2.9 |
| `ai/battleRunner.ts`、`arena.ts`、`battleReport.ts`、`matchSetup.ts`、`invariants.ts`、`battleHash.ts`、`browserExport.ts`、`arenaCli.ts`、`battleCli.ts` | AI | 离线模拟/擂台/报告/不变量/种子盖戳/导出 | CANONICAL（工具线） | 仅分析用途，不触生产 | 进程级（node/浏览器窗） | RNG（2.2.19 起三流显式分离：对局内抽牌消费 `rngState=createRngState(seed)`（引擎路径）；matchSetup 自带装配流（seed^0x9e3779b9，建堆/阵营/采样/技能注入）；battleRunner 自带策略流（seed^0x85ebca6b，经 AiPolicy 可选 random 参注入）；`ai/rng.ts withSeededRandom` 已删除） | UT/CI + 千局 soak | seatModes 等会话态不持久化；复放模式 2.2.19 起不再咨询策略（记录动作经 createAction 重建），旧"总是咨询策略"lockstep 技巧已清理 | 2.2.4-2.2.8 |
| `ai/Bot.ts`、`Difficulty.ts`、`RandomStrategy.ts` | AI | 早期脚手架 | **LEGACY**（全库无引用，2026-09-24 grep 确认） | 无 | — | — | 无 | 待删（2.3 前清理登记） | 1.x |
| `replay/liveReplayRecorder.ts` + `GameHistory.ts`、`ReplayManager.ts`、`ReplayPlayer.ts`、`SnapshotManager.ts` | Replay | 对局 dispatch 录制与回放 | CANONICAL | 录像数据结构 | 对局级 | EXT（依赖引擎重建重放） | UT/E2E | 无 schemaVersion 头（D-4）；重放依赖"重建式执行"（引擎迁移时必须保持）；2.2.20：ReplayPlayer 每步 dispatch 前 syncPlayerSkills（中途登场将技能注册与实况同构，本轮唯一行为变化） | 2.2.5-2.2.6 |
| `replay/replayNaming.ts`、`replayStorage.ts`（309 行）、`gameplayLog.ts` | Replay | 命名口径 / 目录句柄+静默写+暂存队列 / 操作日志 | CANONICAL | 保存行为：自动=永不下载（2.2.10 治本），手动=可下载兜底 | 页面级（暂存队列内存态） | EXT（File System Access/IndexedDB/下载） | UT（268 中占 9+）/E2E | 暂存队列刷新即失（有意接受） | 2.2.6/2.2.10 |
| `components/GameBoard.tsx`（689 行，2.2.15 时点；原 704）、`SkillEditor.tsx`（868 行，2.2.14 时点）、`TestArena.tsx`（483 行，2.2.16 时点；原 485）、`GameOverScreen.tsx`、`Settings.tsx`、`AiBattle*`、`UnifiedDraw.tsx`、`DiceRoll.tsx`、`Codex.tsx`、`MainMenu/CreateRoom/Lobby/GeneralDraft/Rules.tsx`、`DeveloperOverlay.tsx`、`AiDirector.tsx` | UI | React 界面 | CANONICAL（UI 层） | 呈现与交互；规则不在此 | 组件级 | EXT | UT（部分）/E2E/UP | 三大 UI 文件全部已拆（D-6 收线）：SkillEditor 2.2.14（1253→868）、GameBoard 2.2.15（704→689 → gameBoard/uiPrimitives.tsx）、TestArena 2.2.16（485→483 → testArena/compactPrimitives.tsx）；三者剩余可拆面全是闭包绑定件（Slot/BSlot/Territory*/Dev 面板/动作处理器/IO 回调），继续瘦身需解闭包、单独立项；30 条 react-hooks 遗留警告 | 1.x-2.x |
| `components/testArena/compactPrimitives.tsx`（10 行） | UI | 演练场拆出件：SC/Bar/Btn 三个无状态捕获纯 props 原语（棋盘版 uiPrimitives 的紧凑 CSS 变体） | CANONICAL | 呈现；无业务判定 | 组件级 | PURE（纯 props→DOM） | UT（随 TestArena 渲染路径间接）/E2E（2.2.16 真实点击：登场/补给操作条与按钮禁用态、检视统计卡、本回合计数） | 与 gameBoard/uiPrimitives 刻意不合并（合并=改样式=行为变化）；未来统一需单独立项做视觉回归；TestArena 无 StatPill/Modal 等价件（检视弹窗为内联 JSX） | 2.2.16 |
| `components/gameBoard/uiPrimitives.tsx`（21 行） | UI | 棋盘拆出件：SC/StatPill/Bar/Btn/Modal 五个无状态捕获的纯展示原语 | CANONICAL | 呈现；无业务判定 | 组件级 | PURE（纯 props→DOM） | UT（随 GameBoard 渲染路径间接）/E2E（2.2.15 真实点击：弹窗计数/inspect 统计卡/登场操作条与按钮禁用态） | 全库仅 GameBoard 引用（2026-09-24 grep 确认），导出面为聚合 export 一行 | 2.2.15 |
| `components/skillEditor/skillExcelParsers.ts`（228 行）、`TriggerEditor.tsx`（106）、`RuntimeEditor.tsx`（78） | UI | 编辑器拆出件：Excel/文本导入纯解析器 + 触发时机子编辑器 + 结构化效果子编辑器 | CANONICAL | 解析/子表单交互；合法性仍归引擎与 store | 组件级 | PURE（解析器无 IO/状态） | UT（SkillEditor.runtime 等经组件路径）/E2E（真实点击+真实 xlsx 注入往返） | handleImportFile/handleExport 仍闭包于组件态，继续拆分需解闭包（非纯移动，单独立项） | 2.2.14 |
| `controllers/*`（Hotseat/Human/AI/Local） | Controller | 座位输入控制器 | COMPAT | 输入路由 | 对局级 | PURE | UT | 与 aiTurnDriver 职责边界需在引擎迁移时一并钉死 | 1.x |
| `setup/*`（draft/pool/runtimeSetup） | Setup | 开局装配（势力纯化默认、征召分发） | CANONICAL | 装配不变量（confirmDraft 合并编辑锁定） | 开局阶段 | RNG（池抽取） | UT/E2E | — | 1.x-2.2.1 |
| `importer/*` + `components/xlsxSecureReader` | Data | Excel 导入 + 安全读取（SheetJS 防线） | CANONICAL | — | request-scoped | EXT | UT（真实 .xlsx fixture） | — | 1.x/2.0.1 |
| `timeline/PrioritySystem.ts` | Rule | 优先级时序 | COMPAT | — | 对局级 | PURE | UT | 原 AGENTS 所称 PhaseManager/TurnManager 不存在（2.2.11 勘误） | 1.x |
| `network/*`、`room/*`、`server/*`、`session/*` | Net | 多人化脚手架 | **DORMANT**（模块外零引用，2026-09-24 grep 确认） | 无（未接入生产链路） | — | — | UT 局部 | 激活前必须先完成 D-1/D-2 | 1.x |
| `utils/runtimeIdentity.ts` | Util | 卡牌运行时身份唯一提取 | CANONICAL | 身份口径 | 静态 | PURE | UT | — | 1.19-1.20 |

## C. 关键注记

**C-1 引擎现状（重要，2.2.21 更新）**：`engineExecutionBridge` 由**一个模块级常驻 GameEngine 容器**承接（D-1 第二刀）。每步动作：容器 adopt 入参 engineState（克隆，与旧重建路径消费的输入完全同源）→ 技能注册表全量重登记（先注销上一批 owner 再 syncPlayerSkills，逐字复刻 fresh-engine 注册语义——亡将不可能靠常驻表续触）→ dispatch → snapshot 返回。**容器不是第二真相源**：状态唯一来源永远是 store 给的入参，gameStore 投影对快照数组的别名就地改写也因 adopt-clone 每步重读而被如实消费（计划稿的"快照同一性匹配复用"经设计评审否决——别名使同一性判定漏检，adopt-clone 结构上恒等于重建路径且保留容器供未来 Reaction/网络接线）。外部改态（读档、resetGame、testArena 装配）无需显式失效钩子，adopt 天然回到正确状态。旧每步重建保留为 `dispatchStoreActionReconcile`（对账工具，刻意不喂录像器，两路可并跑不双录）；对账测试（transitionEquivalence 四路）钉死 常驻===重建===录像回放。转移逻辑仍全库唯一（TransitionCore），禁双路纪律不破。

**C-2 三率口径**（平衡统计基线）：阵亡不问死因；击杀含反杀与攻击触发技能死。改动须同步 battleRunner 注释、battleReport 口径注释、本文档三处。

**C-3 自动保存不变量**（2.2.10）：新增任何自动保存调用点**必须显式传 `{ unattended: true }`**，否则得到手动语义（可申请权限/下载兜底）。

## D. 已登记的架构债与迁移目标（2026-09-24 与外部评审达成共识，进入 2.3 前按序消化）

| # | 债务 | 钉死的决议 | 排期 |
|---|---|---|---|
| D-1 | GameEngine action-scoped，无法满足 Reaction/网络/长生命周期 | **短期允许双路验证，禁止双路长期执行**：抽出唯一 `TransitionCore.transition(state,action,ctx)`；常驻引擎只是持有 currentState/rngState 的执行容器；重建式执行降级为对账工具；测试断言 常驻结果===重建结果。**进度（2.2.20 阶段 E 首刀）：TransitionCore.ts 已落地（校验→解析→触发链→结算→有界重入逐字移入，纯路径无 STATE_CHANGED 无打戳），GameEngine 降为容器壳（109 行），transitionEquivalence 3 例钉死 常驻===每步重建===录像重建回放（含技能击杀链与拒绝步，仅归一化容器打戳层）；ReplayPlayer 补每步 syncPlayerSkills（本轮唯一行为变化）。**进度（2.2.21 阶段 E 第二刀·收线）：store 常驻迁移落地——engineExecutionBridge 改由模块级常驻 GameEngine 容器执行（每步 adopt 入参 engineState 克隆 + 技能注册表全量重登记，与旧重建路径结构化等价；计划稿"快照同一性匹配"经设计评审改采 adopt-clone，别名改写不漏检），重建式执行降级为对账工具 dispatchStoreActionReconcile；transitionEquivalence 扩为四路对账+容器专例（实例复用/resync 清死将/别名态被消费），行为零变化以 ai-battle 300 局分布逐字一致兜底。本决议两刀收线；长生命周期业务接线（ReactionWindow/网络）随各自需求另立刀次** | 阶段 E（两刀完，本决议收线） |
| D-2 | RNG：withSeededRandom 全局替换 Math.random（并行/服务器下有危险）；重放"重新掷骰"脆弱 | RNG 进 `EngineState.rngState`；随机行为产出 **RandomOutcome 事件**（purpose/value/稳定 id）；**录像记结果不记重掷**；禁止 Resolver 私拿随机源，统一 ExecutionContext.random()。**进度（2.2.18 阶段 D 首刀）：rngState 已进 EngineState（可选字段、缺字段惰性重播种、不 bump 任何版本号）；引擎内抽牌/弃牌堆重洗的选牌全部收敛到 applyDrawEvent 消费种子游标（Resolver 禁随机达成，测试探针钉死）；录像 initialState 含游标→重建式回放自此可复现（重掷=可复现的重掷，"记结果不记重掷"仍未达成=PENDING）。剩余刀（PENDING 登记）：RandomOutcome 事件流、建局牌堆/骰子/势力采样迁入 rngState、action.id/instanceId 确定性、withSeededRandom 彻底退役、battleRunner lockstep 清理。**进度（2.2.19 阶段 D 第二刀）：建局随机（createCardDeck/runtimeSetup 四函数加 random 注入参，gameStore 建局五步走 setupCursor/commitSetup 消费 rngState；matchSetup 自带装配流 seed^0x9e3779b9）已迁入游标/独立播种；action.id 进程计数器化、instanceId 纯计数器化（matchSetup 种子盖戳扩到卡与技能）；withSeededRandom 彻底退役（ai/rng.ts 删除，策略流经 AiPolicy 可选 random 参注入 seed^0x85ebca6b）；battleRunner lockstep 清理（复放不咨询策略，记录动作经 createAction 重建）。行为变化披露：AI 对战 seed→胜席分布改变（300 局 seed1：{1:112,2:188}→{1:109,2:191}），平衡观测台历史需重锚。D-2 仅剩：a) RandomOutcome 事件流（单独一刀）+ e) 观察项（ReactionWindow 窗口 id、DiceRoll 纯 UI 骰子，§12-16 PENDING）** | 阶段 D（二刀完，RandomOutcome 待排） |
| D-3 | 技能 Effect/Trigger 覆盖半成品：**（2.2.17 已闭合两项）**HEAL/GAIN_ARMOR 已完整结算、技能致死已补发 DEATH→onKill/onDeath/补偿抽接通；**剩余**：onTurnEnd/onOtherDeploy/onBecomingTarget 等触发无引擎事件支撑仍待接、ReactionWindow 业务入口（§12-9c）仍缺 | 先钉死 Event→Trigger→Effect→State mutation 权威边界再加覆盖面，防第二轮技能膨胀（边界已钉：EventProcessor 唯一入口 + collected 追加收集 + 有界重入） | 阶段 C（b/d 完，c 顺延） |
| D-4 | legacy 护甲兜底 `legacy_armor_destroyed_${Date.now()}` 伪造牌实例（现居 `eventProcessors/damageEvents.ts:151`，2.2.13 拆分前在 EventProcessor.ts:613） | 确认全部调用方供真实实例后移除；**旧录像永不回填改写**（历史证据）；加 ReplayHeader{schemaVersion,gameVersion}，旧录像经 Adapter 转 canonical 只读加载 | 阶段 B 定策、C 执行 |
| D-5 | 候选枚举"指定卡消耗"扩展性 | 标志挂 **Action 语义**不挂卡：`CardSelectionPolicy: EQUIVALENT / INSTANCE_REQUIRED (/PREFERRED)`；EQUIVALENT 保持代表卡收窄防动作空间爆炸 | 需求出现时 |
| D-6 | 热点文件多职责 | 拆分顺序已钉：**gameStore → EventProcessor（单一 processEvent 入口+事件族分文件）→ SkillEditor → GameBoard/TestArena**；EventProcessor 拆分不许出现第二入口。**进度：五刀全部落地、本决议收线——gameStore（2.2.12，956→622 行）、EventProcessor（2.2.13，852→93 行入口 + eventProcessors/ 六族文件）、SkillEditor（2.2.14，1253→868 行 + components/skillEditor/ 三文件）、GameBoard（2.2.15，704→689 行 + components/gameBoard/uiPrimitives.tsx 纯展示原语）、TestArena（2.2.16，485→483 行 + components/testArena/compactPrimitives.tsx 紧凑原语，与棋盘原语刻意不合并），均为纯移动零行为变化；三文件余下均为闭包绑定件，再拆需解闭包——**用户已决定（2026-09-24）：不解闭包、不做，除非有明确收益**。阶段 C 首刀已落地（2.2.17，b/d 销案）；阶段 D 首刀已落地（2.2.18，rngState 见 D-2 进度）；稳定期下一轮按序：阶段 E（引擎生命周期常驻，D-1），开工前待用户口令** | 阶段 B（前二，完）/F（完） |
| D-7 | `npm run build` 内嵌 `npm install`（构建依赖网络、伪装安装语义） | 评审异议记录在案；本仓离线单文件分发场景为初因，改动需连同分发文档，列入 2.3 议题而非 2.2.11 | 2.3 议 |
| D-8 | 周边文档易漂移 | 2.2.11 起登记纪律扩至五文档（README/AGENTS/CHANGELOG 纳入核对），见 PROJECT_RELEASE_PIPELINE.md | **已落地** |

## E. UNVERIFIED / 低把握条目（诚实清单）

- `rules/RuleEngine.ts` 与 `ActionValidator` 的职责边界未逐条对账（表中记 COMPAT 系保守判断）。
- `controllers/*` 实际调用面未逐一核实（E2E 覆盖主链路），D-1 动它之前先补读。
- 旧 AI 三件套（Bot/Difficulty/RandomStrategy）判定 LEGACY 仅依据"全库零引用"，删除前需再确认开发者窗口无动态引用。
- 各模块 "Introduced" 列在 1.x 区间为约记（精确到小版本需翻 1.x 仓库历史，未做）。
