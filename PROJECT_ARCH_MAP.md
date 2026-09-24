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
  → store/engineExecutionBridge（每动作重建引擎：见 C-1）
  → core/GameEngine.dispatch
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
| `core/EngineState`（经 `core/GameState.ts`） | State | 对局唯一持久真相源，可序列化/重建 | CANONICAL | 它自己（一切状态以它为准） | game-scoped（持久于 store） | PURE（数据本身） | UT/CI | 无 rngState（见 D-2） | 1.x |
| `core/GameEngine.ts` | Engine | dispatch 编排：校验→resolver→事件应用 | CANONICAL | 引擎对"一次动作如何执行"负责 | **action-scoped（现状）**：每次 dispatch 被 bridge 重建 | RNG（内部掷骰走 Math.random） | UT/IT/CI | 长生命周期需求（Reaction/网络）未满足，见 D-1 | 1.x |
| `core/EventProcessor.ts`（93 行，2.2.13 时点；原 852） | Event | 事件→状态迁移唯一应用入口（process 队列循环 + apply 薄分发；D-6 阶段 B 第二刀纯移动拆分，处理器逐字移入 eventProcessors/，唯一入口纪律不变） | CANONICAL | 状态如何变化它说了算 | 随引擎重建 | PURE（除 legacy 护甲兜底用 Date.now，见 D-4） | UT/CI（17+ 用例） | 已按事件族拆分（2.2.13） | 1.x |
| `core/eventProcessors/*`（6 文件 844 行：damageEvents 168 / drawEvents 178 / generalEvents 214 / playerEvents 77 / turnEvents 95 / chainedConsequences 112） | Event | 事件族处理器（纯 (state, event) → state 函数）+ 派生事件入队（DAMAGE/DEATH/BASE_DAMAGE/PLAYER_DEFEATED 连锁） | CANONICAL（仅经 EventProcessor 单一入口调用，禁第二入口） | — | 随引擎重建 | PURE（DRAW 堆不足时洗弃牌堆用 Math.random，见 D-2） | UT/CI | 2.2.13 引入，纯移动零行为变化 | 2.2.13 |
| `core/EngineDispatchFlow.ts` | Engine | dispatch 流程辅助 | CANONICAL | — | action-scoped | PURE | UT | — | 1.x |
| `action/ActionDispatcher.ts` + `resolvers/*`（11 个） | Action | 动作→事件产出 | CANONICAL | 各 resolver 对自己动作的事件形态负责 | request-scoped | PURE/RNG（抽牌类） | UT 全覆盖/CI | HEAL/GAIN_ARMOR 类技能效果尚无完整结算（D-3 前置） | 1.x |
| `rules/ActionValidator.ts` | Rule | **合法性最终裁判** | CANONICAL | 合法/非法它说了算 | request-scoped | PURE | UT/E2E | — | 1.x |
| `rules/legalActions.ts` | Rule | **候选动作枚举**（供 AI；同类资源用代表卡收窄） | CANONICAL | 只产候选，无合法性权威（契约措辞 2.2.11 已改准） | request-scoped | PURE | UT（与引擎裁判对账测试） | 指定卡消耗需求出现时按 D-5 引入 CardSelectionPolicy | 2.2.3 |
| `rules/RuleEngine.ts`、`battlefieldRules.ts` | Rule | 规则查询辅助 | CANONICAL/COMPAT | 战场规则查询 | request-scoped | PURE | UT | 与 ActionValidator 边界未逐条钉死 | 1.x |
| `domain/*`（combat/cost/regions/constants） | Rule | 数值与区域规则口径 | CANONICAL | 常量与公式 | 静态 | PURE | UT | — | 1.x |
| `data/generals.ts`、`cards.ts`、`registries/*` | Data | 卡牌/将领静态数据与注册表 | CANONICAL | 数据内容 | 进程级 | PURE | UT/E2E | — | 1.x |
| `skills/skillCompiler.ts` → `SkillTriggerBridge.ts` → `triggers/TriggerEngine.ts` | Skill | 数据化技能唯一运行时链路 | CANONICAL | 技能何时触发、产出什么事件 | 随引擎 | PURE（编译）/RNG（触发结算可致伤） | UT/CI/E2E（2.2.1 真机贯通） | 触发覆盖不全（onTurnEnd 等待接）；技能致死未自然产 DEATH→onKill 断链（D-3） | 2.1.0 |
| `skills/skillExcelFormat.ts`、`SkillDataRegistry.ts` | Skill | Excel 六列导入导出与数据登记 | CANONICAL | — | request/进程级 | PURE | UT | — | 2.2.0 |
| `store/gameStore.ts`（622 行，2.2.12 时点；原 956） | Store | 会话态 + UI 投影 + 对局动作装配（编辑器/恢复/演练场切片已外移） | CANONICAL（会话态） | 界面与流程状态；对局真相仍以 EngineState 为准 | 页面级（内存，刷新即失） | TIME/EXT | UT/E2E | D-6 阶段 B 第一刀已落地（2.2.12 纯移动拆分，见 gameStoreTypes/EditorActions/Recovery 行）；GPT 评审确认非"规则回灌"，是"应用层 Store+兼容层" | 1.x |
| `store/gameStoreTypes.ts`（135 行）、`gameStoreEditorActions.ts`（137 行）、`gameStoreRecovery.ts`（70 行） | Store | 2.2.12 自 gameStore 拆出：类型面全量、编辑器/开发者动作工厂、快照恢复动作工厂 | CANONICAL（gameStore 的组成部分；gameStore 再导出类型保持消费口径） | 无独立权威——宿主仍是 gameStore | 页面级 | 编辑器/恢复路径 EXT | UT（复用 gameStore 测试面）/E2E 冒烟 | 纯移动拆分零行为变化；后续切片按同模式继续 | 2.2.12 |
| `store/engineExecutionBridge.ts` | Store | store↔引擎桥（重建式执行发生地） | CANONICAL | — | action-scoped | PURE | UT/IT | D-1 的落点 | 1.x |
| `store/gameStateAdapter.ts`、`engineAwareSetter.ts`、`localGameSnapshot.ts`、`editorPersistence.ts`、`testArenaActions.ts`（441 行，2.2.12 起含 buildTestArenaState/settleDrawInTestArena） | Store | 引擎↔store 投影、存档、编辑器持久化、演练场动作+演练场状态推导 | CANONICAL/COMPAT | 投影规则归 adapter | 页面级 | EXT（localStorage） | UT | — | 1.x-2.x |
| `ai/policies/*`（三档策略+随机） | AI | 从候选中选动作（激进>均衡>保守>随机，擂台 3400 局零违例） | CANONICAL | 选什么动作 | 会话级 | PURE（零随机——司机卡死检测前提） | UT/arena/CI | 权重静态手工标定，规则数值变动需重跑 ai-arena | 2.2.7 |
| `ai/aiTurnDriver.ts` | AI | 生产 store 链路的人机座位司机（征召/抽牌/出招/护栏） | CANONICAL | AI 座位节奏 | 对局级 | PURE 前提 | UT/E2E 两局 | 引入随机策略需重审 lastChoiceKey 回退 | 2.2.9 |
| `ai/battleRunner.ts`、`arena.ts`、`battleReport.ts`、`matchSetup.ts`、`invariants.ts`、`battleHash.ts`、`rng.ts`、`browserExport.ts`、`arenaCli.ts`、`battleCli.ts` | AI | 离线模拟/擂台/报告/不变量/种子 RNG/导出 | CANONICAL（工具线） | 仅分析用途，不触生产 | 进程级（node/浏览器窗） | RNG（withSeededRandom 全局替换 Math.random，try/finally 恢复；见 D-2） | UT/CI + 千局 soak | seatModes 等会话态不持久化 | 2.2.4-2.2.8 |
| `ai/Bot.ts`、`Difficulty.ts`、`RandomStrategy.ts` | AI | 早期脚手架 | **LEGACY**（全库无引用，2026-09-24 grep 确认） | 无 | — | — | 无 | 待删（2.3 前清理登记） | 1.x |
| `replay/liveReplayRecorder.ts` + `GameHistory.ts`、`ReplayManager.ts`、`ReplayPlayer.ts`、`SnapshotManager.ts` | Replay | 对局 dispatch 录制与回放 | CANONICAL | 录像数据结构 | 对局级 | EXT（依赖引擎重建重放） | UT/E2E | 无 schemaVersion 头（D-4）；重放依赖"重建式执行"（引擎迁移时必须保持） | 2.2.5-2.2.6 |
| `replay/replayNaming.ts`、`replayStorage.ts`（309 行）、`gameplayLog.ts` | Replay | 命名口径 / 目录句柄+静默写+暂存队列 / 操作日志 | CANONICAL | 保存行为：自动=永不下载（2.2.10 治本），手动=可下载兜底 | 页面级（暂存队列内存态） | EXT（File System Access/IndexedDB/下载） | UT（264 中占 9+）/E2E | 暂存队列刷新即失（有意接受） | 2.2.6/2.2.10 |
| `components/GameBoard.tsx`、`SkillEditor.tsx`、`TestArena.tsx`、`GameOverScreen.tsx`、`Settings.tsx`、`AiBattle*`、`UnifiedDraw.tsx`、`DiceRoll.tsx`、`Codex.tsx`、`MainMenu/CreateRoom/Lobby/GeneralDraft/Rules.tsx`、`DeveloperOverlay.tsx`、`AiDirector.tsx` | UI | React 界面 | CANONICAL（UI 层） | 呈现与交互；规则不在此 | 组件级 | EXT | UT（部分）/E2E/UP | 三大 UI 文件（SkillEditor≈70KB/GameBoard≈56KB/TestArena≈47KB）拆分排最后（D 阶段 F）；30 条 react-hooks 遗留警告 | 1.x-2.x |
| `controllers/*`（Hotseat/Human/AI/Local） | Controller | 座位输入控制器 | COMPAT | 输入路由 | 对局级 | PURE | UT | 与 aiTurnDriver 职责边界需在引擎迁移时一并钉死 | 1.x |
| `setup/*`（draft/pool/runtimeSetup） | Setup | 开局装配（势力纯化默认、征召分发） | CANONICAL | 装配不变量（confirmDraft 合并编辑锁定） | 开局阶段 | RNG（池抽取） | UT/E2E | — | 1.x-2.2.1 |
| `importer/*` + `components/xlsxSecureReader` | Data | Excel 导入 + 安全读取（SheetJS 防线） | CANONICAL | — | request-scoped | EXT | UT（真实 .xlsx fixture） | — | 1.x/2.0.1 |
| `timeline/PrioritySystem.ts` | Rule | 优先级时序 | COMPAT | — | 对局级 | PURE | UT | 原 AGENTS 所称 PhaseManager/TurnManager 不存在（2.2.11 勘误） | 1.x |
| `network/*`、`room/*`、`server/*`、`session/*` | Net | 多人化脚手架 | **DORMANT**（模块外零引用，2026-09-24 grep 确认） | 无（未接入生产链路） | — | — | UT 局部 | 激活前必须先完成 D-1/D-2 | 1.x |
| `utils/runtimeIdentity.ts` | Util | 卡牌运行时身份唯一提取 | CANONICAL | 身份口径 | 静态 | PURE | UT | — | 1.19-1.20 |

## C. 关键注记

**C-1 引擎现状（重要）**：`engineExecutionBridge` 每次动作 `new GameEngine → syncPlayerSkills → dispatch → 取回 EngineState → 丢弃实例`。持续存在的只有 EngineState（数据）。这是有意的权衡：录像确定性、测试无残留、存档单一天性。代价与迁移边界见 D-1。

**C-2 三率口径**（平衡统计基线）：阵亡不问死因；击杀含反杀与攻击触发技能死。改动须同步 battleRunner 注释、battleReport 口径注释、本文档三处。

**C-3 自动保存不变量**（2.2.10）：新增任何自动保存调用点**必须显式传 `{ unattended: true }`**，否则得到手动语义（可申请权限/下载兜底）。

## D. 已登记的架构债与迁移目标（2026-09-24 与外部评审达成共识，进入 2.3 前按序消化）

| # | 债务 | 钉死的决议 | 排期 |
|---|---|---|---|
| D-1 | GameEngine action-scoped，无法满足 Reaction/网络/长生命周期 | **短期允许双路验证，禁止双路长期执行**：抽出唯一 `TransitionCore.transition(state,action,ctx)`；常驻引擎只是持有 currentState/rngState 的执行容器；重建式执行降级为对账工具；测试断言 常驻结果===重建结果 | 阶段 E |
| D-2 | RNG：withSeededRandom 全局替换 Math.random（并行/服务器下有危险）；重放"重新掷骰"脆弱 | RNG 进 `EngineState.rngState`；随机行为产出 **RandomOutcome 事件**（purpose/value/稳定 id）；**录像记结果不记重掷**；禁止 Resolver 私拿随机源，统一 ExecutionContext.random() | 阶段 D（单独迁移，勿与 D-1 同期） |
| D-3 | 技能 Effect/Trigger 覆盖半成品：HEAL/GAIN_ARMOR 未完整结算；onTurnEnd/onOtherDeploy/onBecomingTarget 等未全接；技能致死不产 DEATH→onKill 断链 | 先钉死 Event→Trigger→Effect→State mutation 权威边界再加覆盖面，防第二轮技能膨胀 | 阶段 C |
| D-4 | legacy 护甲兜底 `legacy_armor_destroyed_${Date.now()}` 伪造牌实例（现居 `eventProcessors/damageEvents.ts:151`，2.2.13 拆分前在 EventProcessor.ts:613） | 确认全部调用方供真实实例后移除；**旧录像永不回填改写**（历史证据）；加 ReplayHeader{schemaVersion,gameVersion}，旧录像经 Adapter 转 canonical 只读加载 | 阶段 B 定策、C 执行 |
| D-5 | 候选枚举"指定卡消耗"扩展性 | 标志挂 **Action 语义**不挂卡：`CardSelectionPolicy: EQUIVALENT / INSTANCE_REQUIRED (/PREFERRED)`；EQUIVALENT 保持代表卡收窄防动作空间爆炸 | 需求出现时 |
| D-6 | 热点文件多职责 | 拆分顺序已钉：**gameStore → EventProcessor（单一 processEvent 入口+事件族分文件）→ SkillEditor → GameBoard/TestArena**；EventProcessor 拆分不许出现第二入口。**进度：阶段 B 前两刀已落地——gameStore（2.2.12，956→622 行）、EventProcessor（2.2.13，852→93 行入口 + eventProcessors/ 六族文件，纯移动零行为变化）；下一刀轮 F 阶段 SkillEditor/GameBoard/TestArena** | 阶段 B（前二，完）/F（后三） |
| D-7 | `npm run build` 内嵌 `npm install`（构建依赖网络、伪装安装语义） | 评审异议记录在案；本仓离线单文件分发场景为初因，改动需连同分发文档，列入 2.3 议题而非 2.2.11 | 2.3 议 |
| D-8 | 周边文档易漂移 | 2.2.11 起登记纪律扩至五文档（README/AGENTS/CHANGELOG 纳入核对），见 PROJECT_RELEASE_PIPELINE.md | **已落地** |

## E. UNVERIFIED / 低把握条目（诚实清单）

- `rules/RuleEngine.ts` 与 `ActionValidator` 的职责边界未逐条对账（表中记 COMPAT 系保守判断）。
- `controllers/*` 实际调用面未逐一核实（E2E 覆盖主链路），D-1 动它之前先补读。
- 旧 AI 三件套（Bot/Difficulty/RandomStrategy）判定 LEGACY 仅依据"全库零引用"，删除前需再确认开发者窗口无动态引用。
- 各模块 "Introduced" 列在 1.x 区间为约记（精确到小版本需翻 1.x 仓库历史，未做）。
