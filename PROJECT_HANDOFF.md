# PROJECT_HANDOFF.md — 项目当前状态与跨模型交接规范

> **第一优先级交接入口。**
>
> 职责严格分离：
> - `PROJECT_HANDOFF.md`：当前规则、当前状态、当前架构、当前风险、当前协作/验证/维护规范。
> - `PROJECT_HISTORY_AI.md`：AI 可读历史记录。
> - `PROJECT_HISTORY_HUMAN.md`：人类可读历史记录。
>
> **HandOff = 现在；History = 过去。**
> 本文件应持续更新当前事实，不应变成版本流水账。

## 1. 接手项目的读取顺序

任何新的 AI / 模型 / Agent 接手项目时：
1. 先读取本文件。
2. 再读取 `PROJECT_HISTORY_AI.md`。
3. 再读取 `PROJECT_HISTORY_HUMAN.md`。
4. 再检查最新源码。
5. 当前事实以“最新源码 + 本文件”为主；History 用于解释演化原因。

不得依赖已经结束的聊天上下文推断当前代码状态。

## 2. 项目定位

这是三国题材数字桌游 / 卡牌对战模拟器。

目标：
- 2～4 名玩家。
- PC + 手机。
- 单机 vs AI。
- 同设备热座多人。
- 真正远程多人：统一连接在线房间 / 服务端。
- 后续支持大量官方武将、DIY 武将、技能扩展、Replay、Spectator、Reconnect。
- 技能数据驱动，避免每个武将建立独立硬编码执行器。

技术栈：
- React
- TypeScript
- Vite
- Zustand
- Tailwind CSS

原始项目由 ArenaCN 代理模式生成，后由多个模型共同维护。

## 3. 当前主线与分支

### 已完成任务
- 标记旧的、不再使用的代码为 LEGACY / NON_AUTHORITATIVE
- 修复 npm 依赖问题，包括依赖升级和风险记录

### GPT 主线
当前已知基线：`Phase 5.35.26.4.1`

最近：
- 5.35.26.4：runtime general identity、随机抽取后的实际实例移除、跨势力边框修复。
- 5.35.26.4.1：修复 `cloneWithRuntimeInstance` 缺失 import 导致的 TS2304。

### Qoder 分支
Qoder 使用独立版本号（`1.x` / `2.x`），不等同于 GPT `5.35.x`。
分支记录必须明确 `baseline_from` / `branch_scope`。

当前最新 Qoder 版本：`2.2.6`（独立仓库 `Qoder/2.0`，附注标签 `v2.2.6`；里程碑标签 `v2.0` -> 提交 `95b3540`）
本轮调整（2.2.6）：录像与操作日志的"对局结束保存体系"落地（用户指示：既然网页不能直接打开电脑文件夹，改为——所有模式的对局结束结算窗口下方新增"是否保存录像"询问，左侧可直接重命名、右侧保存按钮；设置页新增"录像保存路径"与"每局自动保存录像"选项，开启后每局结束自动保存导出；录像默认命名=房间名+玩家势力+年月日时缩写；操作日志另外保存在独立子文件夹且默认自动保存，命名同格式）。核心：`src/replay/liveReplayRecorder.ts` 现场录像捕获器——生产链路每次 dispatch 新建引擎（engineExecutionBridge），单局录像必须由这个**唯一长生命周期记录器**承接：`dispatchStoreAction`（所有模式动作的唯一收口点）每步投喂一条，条目只存 afterState、beforeState 沿上一步链式衔接（克隆减半），初始 BEGIN_DRAW 永远重开文档（新对局绝不可能继承上一局历史），createRoom/resetGame/restoreEngineState（存档恢复后从恢复点重新捕获）/startTestArena 四处显式清零。数据形态=既有 canonical `ReplayDocument`（ReplayRecorder.serialize/deserialize/ReplayPlayer 工具链直接兼容）。`replayNaming.ts`：默认名 `房间名-势力-yyyyMMdd-HH`（如 桃园结义-蜀-20260923-14）+ 文件名非法字符清洗 + 子文件夹常量（录像→「录像」、日志→「操作日志」，均在所选目录下）。`gameplayLog.ts`：ReplayDocument→中文操作日志（抬头含房间/玩家势力/胜负结果，逐步复用 ai/battleReport.formatActionLine，ACTION_REJECTED 步整行 ❌ 标注附拒绝码与原因）。`replayStorage.ts`：目录句柄存 IndexedDB（localStorage 存不了句柄）、开关与目录名存 localStorage；保存优先写入已授权目录的对应子文件夹，未选择/浏览器重启未再授权/写入失败→自动降级为浏览器下载；queryPermission 非侵入检查（不打扰用户）。UI：`GameOverScreen` 结算窗口下方新增保存询问卡（左"录像名称"输入框预填默认名、右"保存"按钮、无录像数据时禁用；挂载时执行自动保存——日志默认开、录像按开关，📥 行展示自动保存结果，💾 行展示手动结果；StrictMode 双挂载 ref 守卫每局只自动存一次）；设置页新增"录像与日志"组（路径选择/清除按钮+默认文案"未选择（保存时走浏览器下载）"、每局自动保存录像开关（默认关）、自动保存操作日志开关（默认开）、prompt 态重新授权提示、能力边界说明）；`main.tsx` 仅 dev 构建暴露 `window.__TK__`（store+捕获器）供 E2E 装配结算态，生产 bundle 由 import.meta.env.DEV 分支整体消除，并补 `src/vite-env.d.ts`（vite/client 类型，tsconfig types:["node"] 下 import.meta.env 需要显式 reference）。测试 +14（replayNaming 5/liveReplayRecorder 3/gameplayLog 2/replayStorage 3/桥接接线 1）→ 219 例 / 27 文件。验证：check 0 错误 / `npm run test` = 219 通过 / 覆盖率棘轮不动实测 lines 40.3 / funcs 26.67 / branches 29.91 / stmts 35.51 通过 / lint 0 错误 30 遗留警告（零新增）/ build 单文件成功（1,896.11 kB / gzip 554.52 kB）/ 浏览器 E2E（真实操作）：设置页"录像与日志"组渲染与默认态（录像自动保存关/日志开）→ 开关切换并确认 localStorage 持久化 → 开发者解锁 → 结算窗口经 dev 钩子装配真实捕获数据：默认名 `E2E结算房-蜀-20260923-13` 正确、自动保存两行提示出现、改名"自定义测试录像名"后手动保存成功显示下载提示。诚实边界：①浏览器安全模型不允许"手输路径直写磁盘/打开文件夹窗口"，路径=选一次真实文件夹（句柄持久化），重启后可能需浏览器再授权（UI 有提示），无路径时等价降级为下载；②测试场沙盒按既有口径把 phase 钉在 testArena（投降不跳结算窗），结算 E2E 走 dev 钩子装配而非沙盒投降；③多文件连发下载在部分浏览器会弹"允许下载多个文件"授权，属浏览器行为。CI 远端复验已完成：run `35822419623` 全绿（CI #18，master@6d82741）。
上一轮（2.2.5）：AI 对战线"游戏内开发者模式 AI 对战体验"落地（用户要求：开发者模式开启后主菜单出现入口，可选几个 AI 混战/打多少局等条件；对战在**新开后台窗口**运行、不占用游戏窗口；结束后输出**操作日志**（错误处额外标注）与**录像**，并在主窗口**右下角弹出结束简报**（几局完成、多少错误 + 打开日志/录像的按钮）；阶段三策略 AI 按用户指示顺延）。新增纯函数报告层 `src/ai/battleReport.ts`：`summarizeMatches`（局数/胜负/违例/耗时聚合）、`formatActionLine`（逐动作中文摘要）、`buildOperationLog`（整批操作日志：违例步、引擎拒绝步以 ❌ 前缀整行标注，超出动作序列的违例单列 ❌ 行，零违例局带 ✔ 行）、`buildReplayBundle`（CLI 兼容的全量录像数组）、`buildFailureFiles`（失败局文件，schema 与 `npm run ai-battle` 落盘一致）——UI 与测试共用、无 DOM 依赖。`src/ai/battleHash.ts`：父子窗口 `#ai-battle?...` 参数契约与钳制解析（纯函数独立成模块以保 fast-refresh 干净）。`src/ai/browserExport.ts`：Blob 下载 + File System Access"保存到文件夹"（写入所选目录的 `ai-battle-log/` 子目录；环境不支持/用户取消 → 降级为下载；浏览器无法唤起 OS 文件浏览器，此为如实替代）。三个组件：`AiBattleConfig`（主菜单配置弹窗：2-4 个 AI、局数 1-5000、起始种子、步数上限 + 高级设置将池/牌堆/技能注入；`window.open` 被弹窗拦截时显示手动打开链接兜底；层级 z-140 高于简报面板）、`AiBattleWindow`（哈希路由后台窗口本体：复用与 `npm run ai-battle` **完全相同**的 battleRunner 引擎链路，逐局之间让出宏任务保窗口不卡死，实时日志违例红色高亮，完成后经 `window.opener.postMessage` 把简报+全部产物发回主窗口，头部含 操作日志/录像/保存到文件夹/关闭 按钮，StrictMode 双启由 startedRef 守卫）、`AiBattleDock`（主窗口右下角 z-130 结束简报：总局数/分出胜负+胜方分布/步数耗尽/违例局与条目/耗时统计 + 导出按钮，仅开发者模式显示）。接线：MainMenu 在 developerMode 下新增"🤖 AI 对战演练"入口；App.tsx 模块加载期读取一次哈希（窗口存续期不变，hook 顺序稳定）路由到后台窗口并挂载 Dock。新增 `battleReport.test.ts` 6 例（汇总统计 / ❌ 三类标注 / 干净局 ✔ / 中文动作行 / 录像 bundle 形状 / 失败文件筛选 / 哈希钳制与缺省）→ 205 例 / 22 文件。本地测试环境修复：用户 Node 升级 v24 后 vitest 5.0.1（已为该 major 最新版）默认 forks/threads worker 全线报 `Cannot read properties of undefined (reading 'config')`，`vitest.config.ts` 加 `pool: nodeMajor>=24 ? 'vmThreads' : undefined` 兜底——CI（Node 20/22）默认池行为逐字不变。验证：check 0 错误 / `npm run test` = 205 通过（22 文件，+6）/ 覆盖率棘轮不动实测 lines 40.39 / funcs 26.03 / branches 29.51 / stmts 35.43 通过 / lint 0 错误 30 遗留警告（零新增）/ build 单文件成功 / 浏览器 E2E 真实点击：开发者模式→主菜单入口→配置弹窗填参→后台窗口真跑 2 局全部获胜零违例（96ms）→主窗口右下角简报面板按子窗口回传消息格式完整渲染→弹窗拦截兜底链接出现；E2E 中还实发发现并修复简报面板与配置弹窗的层级重叠。诚实边界：真实 OS 弹窗的父子 postMessage 往返在本自动化浏览器无法端到端复验（其弹窗被硬拦），机制为标准 window.open+opener.postMessage 且拦截兜底已验证；"打开文件夹"按浏览器能力交付为"保存到文件夹/下载"。CI 远端复验已完成：run `35817697563` 全绿（CI #16，master@e0f4cf3，lint+audit / test 22 与 24 矩阵含 check+coverage / build）。
上一轮（2.2.4）：AI 对战线·阶段二"本地随机 AI-vs-AI 对局跑器"落地（用户硬要求：完成后本地 `npm run ai-battle` 即跑，不再消耗代理额度）。新增 `src/ai/` 七文件：`rng.ts`（mulberry32 种子随机 + withSeededRandom 全局补丁——引擎路径全部随机源均走 Math.random，单点补丁即整局可复现）、`matchSetup.ts`（对局装配：真实 allGenerals/createCardDeck 抽样、可配人数/将池/牌堆/本营血、skillInjection 概率注入三条已结算演练技能让编译器→触发器→效果链每批都被跑到；实例 id 改为种子派生确定性打戳——cloneWithRuntimeInstance 内嵌 Date.now+全局计数器会让复现局发新身份证）、`policies/randomPolicy.ts`（`AiPolicy` 契约：只从 engine.legalActions 均匀取一，null=bug 信号，策略与规则彻底解耦，阶段三换策略不改跑器）、`invariants.ts`（每步不变量哨兵：卡牌账本守恒【牌堆/弃牌/手牌/将池/坟场/场上 general+armorCards 全收口，重复占位=DUPLICATED、变多=MULTIPLIED、非阵亡局减=VANISHED、阵亡清扫当步重定基线、legacy_armor_destroyed 合成牌豁免】+ 结构检查：亡者留牌/负本营血/血量护甲越界/同位置双将/槽位越界/抽牌窗归属/终局⇔幸存者一致性/胜者 id 对账）、`battleRunner.ts`（无 fs 核心：每步全新 `new GameEngine(state,{recordHistory:false})` + `syncPlayerSkills` 镜像生产桥接链路；开局显式 BEGIN_DRAW initial，其余走策略→dispatch→拒检→逐步不变量；status won/stepsExhausted/violation/replay-diverged；runBatch 聚合胜率/耗时/违例）、`battleCli.ts`（argv：--games --seed --players(2-4) --pool --deck --skill --max-steps --out --replay；违例局自动落盘 `ai-battle-failures/match-<seed>.json` 含完整动作日志；--replay 读回同种子重装配+逐招复放且保持与生成局相同的随机数消耗次序（策略照询、复放用字面对象不再生成 id）验证精确复现，exit code 供脚本判定）、`battleRunner.test.ts` 4 例（双人局必 won 且零违例 / 三人+0.8 技能注入 / 同种子两跑 winner 与步数全同 / 录盘复放整局回环：每个复放动作必被引擎接受且终局一致）。`GameEngine` 新增 `GameEngineOptions.recordHistory`（默认 true 保持 UI 回放/快照行为逐字不变；false 时 replay/snapshots 全部旁路——否则每动作深克隆前后状态 O(n²) 留存，千局 soak 会吃爆内存）。package.json 新增 `ai-battle` 脚本（esbuild 单文件捆绑→node 直跑，esbuild 为 vite 传递依赖已在 .bin）；.gitignore 加 `.ai-battle/` `ai-battle-failures/`。本地 soak 实测：1000 局双人 0 违例（均值 9ms/局、最慢 123ms）、400 局三人 0 违例、300 局四人+0.9 注入 0 违例、200 局长局（pool16/deck120）0 违例，合计 **1900 局全过不变量**；随机策略下座位胜负分布偏斜（双人 322/678）属随机策略无脑取牌的正常现象非引擎缺陷，留待阶段三策略 AI 校准。过程如实交代两处自身 bug 均由测试当场抓获并修复：复放数组 off-by-one（BEGIN_DRAW 占 actions[0] 导致整体错位一步）、账本收集器漏收 fieldGenerals 包装对象的 .general（首发 DEPLOY 即报 VANISHED）。验证：check 0 错误 / `npm run test` = 199 通过（21 文件，+4）/ 覆盖率棘轮上调 lines 39 / functions 25 / branches 28 / statements 35（实测 lines 40.93 / funcs 25.89 / branches 29.52 / stmts 35.63）通过 / lint 0 错误 30 遗留警告（零新增）/ build 单文件成功。CI 远端复验已完成：run `35811273378` 全绿（CI #14，master@d3e166f）。诚实边界：本阶段是"随机探雷器"——验证规则/状态机健壮性与可复现性，不提供策略强度；主动技能询问窗口（§12-9c）仍缺席，AI 与人类同限制；阶段三将在此跑器上换装三档策略并以胜率校验。
上一轮（2.2.3）：AI 对战线·阶段一"可选动作清单"地基落地（用户规划：①本地 AI-vs-AI 随机对局测 bug、完成本地部署后零额度消耗 → ②游戏内人机对战三档难度；本阶段服务两者共同地基）。新增 `src/rules/legalActions.ts`：`getLegalActions(engine, playerId)` 返回当前玩家此刻所有合法动作。设计不变量：**枚举器绝不复制规则**——只从状态生成候选（手牌将领×营地槽、场上将领×全几何目标、攻击×敌将/本营×近远、补给/装备/END_TURN/SURRENDER/RESOLVE_BASE_LOSS、抽牌窗口的全分配组合），合法性一律交给引擎自己的 `RuleEngine.validateAction` + 对应 resolver 试探判定（与真实 dispatch 同一裁判链路）。安全性依据：全 resolver 为纯函数（EventProcessor 是唯一改动者，`legalActions.test.ts` 第 1 例守卫"试探前后 state 深相等"，未来若有 resolver 在 resolve 里改状态会立刻报红）。口径决策：BEGIN_DRAW 不进默认枚举（抽牌窗口由引擎链/开局装配驱动，防 AI 无限重开抽牌）；文将移动候选自动配消耗卡、武将候选无消耗；军备卡才进 EQUIP_ARMOR 候选。`GameEngine` 新增便捷方法 `legalActions(playerId)`。新增 `src/rules/legalActions.test.ts` 5 例：试探零副作用 / 抽牌窗口 6 分配+确认且非抽牌玩家空 / **枚举⇒可执行对账**（每个枚举动作在全新引擎上真实 dispatch 必须不被拒）/ 典型非法不入列（无消耗牌、已攻击、槽位占用、非当前玩家、gameOver）/ 双随机 AI 只凭清单自对局打到 gameOver（种子 LCG 可复现，54ms 一局，提前验证阶段二可行性）。修正测试期一处口径误判：战斗区**可**远程攻击本营（引擎实测接受），断言以引擎为准。覆盖率棘轮上调 lines 37 / functions 23 / branches 26 / statements 31（实测 38.39/24.15/27.63/33.2）。验证：check 0 错误 / `npm run test` = 195 通过（20 文件，+5）/ 新阈值通过 / lint 0 错误 30 遗留警告（零新增）/ build 单文件成功（1,856.46 kB / gzip 540.86 kB）。CI 远端复验已完成：run `35806986372` 全绿（CI #12，master@ad8bafe）。诚实边界：枚举器覆盖现有全部 ActionType；主动技能（activeSelf 等）仍无询问窗口（§12-9c 旧欠账），AI 与人类受同一限制。
上一轮（2.2.2）：核心玩法流程自动化测试套件落地（用户硬性要求：一律通过引擎既有 `GameAction` 接口驱动，不得绕过引擎直接改状态）。新增 `src/core/gameFlow.test.ts` 14 例，全部以 `new GameEngine(state)` + `engine.dispatch(createAction(...))` 直驱（初始 EngineState 手工构造属既有引擎测试通用夹具做法）：①开局抽牌（BEGIN_DRAW initial 链式推进两玩家 + NOT_DRAW_PLAYER/DRAW_TOTAL_MISMATCH/NO_PENDING_DRAW_CONFIRMATION 门禁）②部署将领（登场血量=消耗张数、槽位互斥、四类前置校验）③移动（营地→前线→战斗区→敌前线、每回合一次、文将移动耗卡/武将不许耗卡）④攻击与护甲（每 2 甲吸收 1 点、1 甲原地保留、消耗牌硬性前置、每回合一次）⑤阵亡与补偿（DEATH→被杀方自动 1 张补偿抽+现场恢复）⑥本营伤害与胜负（攻本营固定 -1 → PLAYER_DEFEATED → GAME_OVER → `metadata.winnerId`）⑦结束回合四事件链+座位/轮次抽牌数+行动标记复位+空将池 RESOLVE_BASE_LOSS 扣本营 ⑧投降判负 ⑨完整一局冒烟（menu 开局→部署→三段推进→两回合攻摧毁本营获胜，含牌堆账本守恒断言）。重要引擎事实（已写入测试文件头注释）：EventProcessor 内联追加的连锁事件（PLAYER_DEFEATED/GAME_OVER/补偿 DRAW_REQUIRED）**不出现在 dispatch() 返回值中**，只能通过 engine.state 断言。覆盖率棘轮上调 lines 34 / functions 21 / branches 24 / statements 29（实测 35.04/21.93/25.13/29.87）。验证：check 0 错误 / `npm run test` = 190 通过（19 文件，+14）/ 新阈值通过 / lint 0 错误 30 遗留警告（零新增）/ build 单文件成功。同时补记：v2.2.1 的 CI 远端复验已完成（run `35766373504` 全绿，经登录态浏览器确认）。本轮（2.2.2）CI 远端复验已完成：run `35801947056` 全绿（CI #10，master@6b20f8c，2m45s）。诚实边界：本套件是引擎层自动化回归，与浏览器真实点击回归互补而非互替；手感与平衡度仍待用户回归。
上一轮（2.2.1）：端到端最小可玩对局浏览器回归完成（真实点击走完 开局→选将→初始抽卡→部署→普攻/护甲→阵亡→本营胜负→编辑器技能进局 全链条），并修复回归暴露的唯一真 bug：`confirmDraft` 征召确认时克隆的是**原始**武将定义，编辑器 `skillEdits/generalEdits` 从未流入运行时卡片——表现为"编辑器里配好'援军（回合开始摸一张牌）'并保存成功、UI 也显示，但进对局永不触发"（显示链路 `getGeneralWithEdits` 只作用于展示，运行时 `syncPlayerSkills` 读的是 EngineState 里的征召快照）。修复=征召落池时改为 `cloneWithRuntimeInstance(get().getGeneralWithEdits(g))` 一行；新增回归测试 `src/store/gameStore.draftEdits.test.ts` 3 例（skillEdits 进池并可被编译器产出 onTurnStart DRAW_CARD 定义 / generalEdits 数值进池 / 无编辑时保持原样且纯描述不被凭空执行）。浏览器实测：新房间晋seat 征召文鸯→登场→其回合开始手牌 6→12（常规 5 + 援军 1），抽牌堆同步 41→35 恰为 6 张，技能真实结算。验证：check 0 错误 / `npm run test` = 176 通过（18 文件，+3）/ 覆盖率达棘轮（阈值未动，lines 实测 27.7）/ lint 0 错误 30 遗留警告（零新增）/ build 单文件成功。回归附带口径澄清（非缺陷）：a) 已保存对局是征召时点快照，之后编辑器改动只对新房间生效；b) 页面处于后台时骰子动画被浏览器限流拉长，属运行环境行为非产品 bug；c) MainMenu 页脚仍显示旧版本串"Qoder V1.28"（装饰性文案滞后，见 §12）。
上一轮（2.2.0）：技能编辑器结构化录入落地（销 §12 第 9 条 a）。多效果模式的每个效果卡新增"⚡ 结构化效果"编辑区（RuntimeEditor：类型/数值/目标；类型仅 摸牌・伤害 可直接选用，HEAL/GAIN_ARMOR 对既有数据只读显示"暂未接入结算"），写入 `SkillEffect.runtime` 后即成为 2.1.0 编译器的可结算输入——DIY 技能从"只能写描述"变为"能真正进对局执行"。Excel 效果列组由 3 列升级为 6 列（标注|触发|效果类型|数值|目标|描述），导入按表头自动识别新旧组宽（出现"效果N效果类型"即按 6 列解析），旧导出文件保持兼容；导出改出新 6 列并补效果类型/目标下拉。触发字符串↔配置、runtime 字段解析、效果列组序列化等抽入纯模块 `src/skills/skillExcelFormat.ts`（SkillEditor 改为引用，删除组件内同逻辑），校验口径升级："选了效果类型但数值空"计入未完成（⚠ 过滤与导出设定备注均可见）。持久化与游戏装配零改动：`runtime` 随 `SkillEffect[]` 经 skillEdits→gameStore→EngineState 自然流到 `syncPlayerSkills`。验证：check 0 错误 / `npm run test` = 173 通过（+21：skillExcelFormat 19 例含"Excel 单元格→编译定义"打通断言、SkillEditor 组件冒烟 2 例经 @testing-library 真实点击 录入→保存→store 断言）/ 覆盖率棘轮上调 lines 27・functions 16・branches 19・statements 23 / lint 0 错误 30 遗留警告（较基线 -2，零新增）/ build 单文件成功。诚实边界：结构化录入仅覆盖多效果模式，单效果模式仍为纯描述；编辑器录入的实战对局表现待用户回归；§12-9 b/c/d（HEAL/GAIN_ARMOR 与 14 种触发、回合结束询问窗口、技能致命伤不发 DEATH）维持 PENDING。
上一轮（2.1.0）：技能系统唯一化收敛（§13 路线第 1 项落地）。全项目现在只有一条技能运行时链路：`data/generals.ts Skill(+runtime 载荷) → skills/skillCompiler.ts → DataSkillDefinition → skills/SkillTriggerBridge（触发条件+效果翻译） → TriggerEngine → core/GameEngine 事件链 → EventProcessor 结算`。修复了两个根本断点：(a) 每次 dispatch 重建 GameEngine 导致注册丢失——现由 `syncPlayerSkills` 在 `engineExecutionBridge.dispatchStoreAction` 内每次派生注册（随快照/读档天然一致）；(b) 没有任何业务把玩家将领导出成技能定义——现由编译器统一导出。同时删除了经二次调用图复核为零引用的第二套实现（skills/SkillEngine・EffectResolver・SkillRegistry・types・effectTypes，card/、actions/、status/ 三目录，timeline 除 PrioritySystem 外全部，rules/CardRule・TurnRule，data/skillEffects.ts 硬编码注册表），`SkillActivation` 类型收编至 `skills/dataTypes.ts`。行为口径：只有带结构化 `runtime` 载荷的效果会被执行，内置武将仍是纯描述文本（不参与结算，不发明玩法）；本轮真实新增结算能力=技能摸牌（EventProcessor DRAW 支持按数量从共享牌堆抽取、不足洗坟场）与技能伤害（DAMAGE 事件 damageType:'skill' 走与普攻同一 applyArmorDamage 规则，该函数提取至 `core/armorDamage.ts` 共享）。诚实边界（PENDING，见 §12）：DIY 编辑器尚无 runtime 数值录入入口；HEAL/GAIN_ARMOR、modify*/onBase*/passive/active*/untilExpire 等 14 种触发未接入；回合结束技能询问窗口（§4 冻结规则）仍未挂接；技能致命伤不产生 DEATH 事件即 onKill 对技能伤不触发。验证：check 0 错误 / 152 测试通过（新增 21 例技能链路闭环测试，此前技能链覆盖率=0）/ 覆盖率棘轮上调 lines 18・functions 11・branches 15・statements 17 / lint 0 错误 32 遗留警告（与基线一致）/ build 成功。
上一轮（2.0.4）：接入 GitHub 私有远程并完成 CI 首轮真实运行。两仓库推送至 `DJXD248/three-kingdoms-2.0` 与 `DJXD248/three-kingdoms-1.29`（均 private）。首轮 CI 暴露环境兼容问题并已修复：测试矩阵 Node 18/20/22 -> 22/24（Vitest 5 需 `node:inspector/promises`，jsdom 的 undici 需 `webidl.markAsUncloneable`，均不在旧版运行时）；lint/build job 统一 Node 22；Pages 部署工作流改为仅手动触发（`workflow_dispatch`），因 Pages 源尚未启用且当前不打算公开网页。修复后 CI 运行结果见本节末"当前验证状态"。
上一轮（2.0.3）：依赖安全清零。以 npm `overrides` 强制传递依赖 uuid `^11.1.1`（消除 exceljs 内置 uuid@8.3.2 的 2 项 moderate）；与 1.29 线统一 exceljs `^4.4.0`（同时终结两仓库版本不一致问题）。`npm audit` = found 0 vulnerabilities（历史首次全绿）；exceljs 导出→SheetJS 读回冒烟测试（含条件格式）通过；check/test(131)/lint/build 全通过。1.29 仓库同步发布 `v1.29.4`。
更早（2.0.2）：xlsx 漏洞修复收尾，判定 COMPLETE。新增真实 .xlsx 夹具回归测试 `src/components/xlsxSecureReader.test.ts`（3 例，夹具 `src/components/__fixtures__/skills-sample.xlsx`，jsdom 下以与生产一致的 browser 构建解析成功，覆盖 SkillEditor 导入路径）；CI lint job 增加 `npm audit --audit-level=high` 硬门禁；dist 以 0.20.3 重建；1.29 生产线同步完成 CDN 切换（tag `v1.29.3`）。测试总数 131（13 文件）。
更早（2.0.1）：修复 xlsx(SheetJS) 高危漏洞。npm 注册表的 xlsx 永久停在含漏洞的 0.18.5（GHSA-4r6h-8v6p-xvw6 原型污染 + GHSA-5pgg-2g8v-p4x9 ReDoS），官方修复版只发布在 SheetJS CDN；依赖已切换为 `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`，无需改动业务源码（唯一消费方 SkillEditor 仅用 XLSX.read / sheet_to_json 只读 API，版本兼容）。`npm audit` 由 3 项（含 1 high）降至 2 moderate（exceljs 传递依赖 uuid，维持延期）；check/test/lint/build 全量通过。
更早（2.0）：基于 1.29.2 源码生成 2.0.0；引入 Vitest（128 测试，覆盖全部 action resolvers + EventProcessor）与覆盖率阈值棘轮；引入 ESLint flat config 0-errors 门禁；配置 GitHub Actions lint / Node 18,20,22 测试矩阵 / build / Pages 部署工作流；新增 `npm run test` / `test:coverage` / `lint` / `lint:fix` 验证命令。CI 因未配置远程仓库属"已配置未验证"。
更早（1.29.2）：修复依赖安全漏洞，升级 uuid 与 vite，exceljs 有意调整为 `^3.4.0`（锁文件解析至 3.10.0）；验证 npm run check/build 通过；xlsx 漏洞因无可用修复版本仍存在。

版本号不能单独用于判断跨模型分支的先后关系。

### Git 管理状态
从 Qoder 1.29 开始，当前版本目录已作为独立 Git 仓库管理。旧的 `Qoder/1.0`～`Qoder/1.29` 文件夹暂时保留为备份，不再通过复制文件夹创建新版本。

`Qoder/2.0` 是与 `Qoder/1.29` 相互独立的另一个 Git 仓库，两者不共享提交历史：2.0 仓库里程碑为 `95b3540`（附注标签 `v2.0`，代码里程碑 `530fecf`），1.29 仓库最新为 `v1.29.4`。自 2.0.4 起两仓库均已配置 GitHub 私有远程（`origin` -> `https://github.com/DJXD248/three-kingdoms-2.0` / `https://github.com/DJXD248/three-kingdoms-1.29`，visibility=private，非公开不可被他人访问），master 与全部标签已推送；2.0 的 GitHub Actions 已实际运行（首轮 Node 18/20 失败已按上文修复），1.29 仓库无工作流文件、仅作为代码托管与备份。日常验证命令：本地 `npm run check/test/lint/build` 之后 `git push`，CI 绿灯即视为远端验证通过。

常用命令：
- 查看当前状态：`git status`
- 查看提交历史：`git log --oneline --decorate --all`
- 查看所有版本标签：`git tag --list`
- 保存一次迭代：`git add .` → `git commit -m "说明改动"` → `git tag v1.x.x`
- 查看某个版本：`git show v1.29`
- 切换到某个版本查看：`git switch --detach v1.29`
- 从历史版本恢复工作：`git switch -c restore-v1.29 v1.29`
- 返回最新分支：`git switch master`

当前基线提交按用户要求使用消息 `v1.16 baseline`，当前版本标签为 `v1.29`。

推送环境备注：本机到 GitHub 链路波动（直连与系统代理 `127.0.0.1:10808` 交替可用），代理只按需用一次性参数 `git -c http.proxy=...`，不写入持久配置；详见各自 `README.md`（新增，含快速开始与日常迭代流程）。

## 4. 冻结的核心游戏规则

> 下列规则属于用户已确认的产品规则。模型进行代码重构、性能优化、架构迁移时不得自行修改；如发现源码与规则冲突，应先记录并核实，不能用“重构顺便修规则”的方式自行决定。

### 玩家 / 势力
- 正式游戏 2～4 人；测试场 2～4 人。
- 势力：魏、蜀、吴、群、晋。
- 群雄不是玩家可选择的主势力，但可作为将领原 / 有效势力。

### 卡池
- 每名玩家独立将领池。
- 普通卡牌池共享。
- 将领卡与普通资源卡不同。
- 将领登场后成为运行时实体。

### 卡牌分类
- 游戏内容分为将领牌与资源 / 军备牌两大类。
- 将领牌分为武将、文将；将领用于登场成为场上角色，也可以在规则允许时作为消耗品。
- 普通卡牌分为粮草、材料、军备三类；它们默认没有独立技能效果，主要作为消耗品使用。
- 军备牌的特殊性是可以附着在场上将领上形成护甲，而不是传统“装备槽 / RPG 装备系统”。


### 抽卡
- 开局每名玩家 5 张。
- 第 1 轮回合开始：玩家 1 抽 0，其余玩家各抽 1。
- 第 2 轮起：每名玩家自己回合开始抽 5。
- 将领死亡补偿抽 1。
- 自己回合开始将领池为空：本营 -1 HP。
- 因此 HP ≤ 0：`PLAYER_DEFEATED`，清空手牌 / 场上，然后到下一名存活玩家；无存活玩家则 `GAME_OVER`。
- 不得因结算流程卡死。
- 将领池抽取必须随机 / 无选择顺序偏差。

### 回合与行动
- 一个回合包含回合开始、回合内、回合结束三个阶段。
- 回合开始先处理该回合固定抽卡及将领池为空导致的本营掉血；完成抽卡后进入行动阶段。
- 回合内可以进行任意次合法行动；在没有伤害或技能正在执行/结算时，可以随时结束回合。
- 回合结束如存在可发动的将领技能，应进入对应技能询问/结算窗口，确认不发动后再完成回合结束结算。（规则本身有效；实现为 PENDING——`ReactionWindow` 类已存在但回合结束流程尚未调用，见 §12 第 9 条 c。2.1.0 收敛时经用户主线授权明确暂缓，不得视为已履行。）
- 检视手牌、墓地、场上将领不算行动，属于行动外查看。

### 消耗
- 默认“消耗”是弃置手牌。
- 被消耗的将领牌回到对应玩家的将领池底部；被消耗的资源牌进入弃牌堆。
- 标注“无消耗”的行动不需要手牌成本。
- 将领登场时必须使用“将领自身以外”的手牌作为初始 HP：可消耗 1～该将领 maxHP 张手牌；若手牌不足或营地已满则不能登场。
- 武将和文将都可在规则允许的情况下作为普通消耗品；它们不是普通资源卡，但运行时身份必须独立。

### 登场 / 移动 / 攻击
- 一般情况下，将领只能从手牌登场，并在己方营地区域占用一个空槽。
- 武将在登场回合可以移动和攻击；文将在登场回合只能在移动与攻击中选择一项。
- 将领默认一回合仅能移动一次。武将移动不耗手牌；文将移动默认消耗 1 张手牌。
- 移动不能进入被其他玩家占领的区域；己方将领可以进入己方占领或无人区域。
- 近战攻击作用于相邻区域目标；远程攻击跨越一个区域。
- 营地中的将领可远程攻击战场目标；前线将领可远程攻击其他前线目标；战场将领可远程攻击营地目标。
- 敌方营地中的近战将领可以攻击敌方本营。
- 武将攻击与文将攻击默认需要消耗 1 张手牌；具体行动是否“无消耗”以技能/特殊规则为准。

### 补给
- 补给只能由回合玩家对己方场上将领执行。
- 默认一个将领一回合只能补给一次。
- 每消耗 1 张手牌，恢复等量 HP，但不能超过目标 maxHP。
- 将领处于敌方区域时，补给额外消耗 1 张手牌。
- 补给可消耗将领牌或资源牌；其去向仍遵循通用消耗规则。

### 战场 / 本营
- 营地、前线各 3 槽。
- 本营初始 6 HP。
- 本营无普通角色 maxHP。
- 本营是目标，不是角色实体。
- 本营单次受击伤害上限 1。

### 将领
- 武将默认 2 近战 / 1 远程。
- 文士默认 1 近战 / 2 远程。
- 同名将领不是同一实体。
- `definitionId` 可相同；每个运行时实体必须有独立 `instanceId`。
- 选择、登场、移动、攻击、受伤、消耗、装备、动画均按实例区分。

### 移动
- 营地 / 前线单一合法目的地可保留自动移动。
- 战场移动必须显式选目标，即使只有一个方向，并可取消。
- 前线 → 战场空槽可点击。
- 从营地移出后原槽位必须可复用。

### 装备
- 武装卡附着具体 `GeneralInstance`。
- 破坏时处理准确卡牌实例。
- 不恢复已淘汰的泛化 Equipment 作为第二套权威。

### 投降
- 本营 HP = 0。
- 清空手牌 / 场上。
- 立即进入下一名存活玩家。
- 不要求额外 END_TURN。

### 角色、目标、检视与观战
- “角色”仅指场上存在的将领；“目标”可以是具有 HP 概念的场上对象，包括将领与本营。
- 指定“角色”的效果不能把本营作为目标；指定“目标”的效果可以选择本营。
- 玩家可随时检视手牌、墓地和场上将领；检视不是 Action。
- 观战状态未来允许查看玩家视角、手牌数量但不查看手牌内容，并可检视场上将领；观战退出不改变对局结果。

### 保存与恢复（当前本机功能）
- 当前保存是浏览器 `localStorage` 本机存档，不等同于在线同步。
- 存档的权威内容是 `EngineState` 快照；Zustand UI 展示字段不能成为游戏恢复规则来源。
- 自动保存当前仅在正常回合结束后执行；显式“保存并退出”会立即保存。
- GAME_OVER、放弃对局、重开对局应清理旧的本机存档。
- 恢复时必须校验快照结构；无效快照不得写入 EngineState。
- 恢复/重连的 `roomId` / `roomName` 必须保持一致；1.27 已补齐快照中的房间名称和人数，1.28 进一步保证坏档清理后菜单显示立即同步。


## 5. 架构：单一权威

目标链路：

`UI → Controller → Action → GameEngine → Event → EngineState`

规则：
- `GameEngine`：唯一游戏规则执行权威。
- `EngineState`：唯一运行时状态权威。
- Zustand：UI 投影 / 兼容层，不得成为第二规则引擎。
- Controller 产生 / 驱动 Action，不复制规则。
- Resolver / Engine 解释 Action 并产生状态变化 / Event。
- Network 以 `GameAction + EngineState` 为边界。
- Replay 基于 Action / Event / State；ReplayPlayer 复用 GameEngine。
- 在线模式目标为 server-authoritative。

Controllers 目标位置：
- `src/controllers`
- Human / Local / Hotseat / AI

不得重新建立并行的重复 `src/player` 控制器体系。

## 6. 技能系统：只允许一套运行时

唯一目标链路：

`SkillDefinition → Trigger → Condition → Target → Cost → Effect → Event → EngineState`

必须遵守：
1. 最终只保留一套 canonical Skill Runtime。
2. GameEngine 是技能规则执行权威。
3. 旧技能系统迁移期间可标为 `LEGACY` / 兼容，但不得并行执行同一规则。
4. 不得因新增武将重新建立第二套技能执行器。
5. DIY 技能只能组合经过验证的原语，不允许直接注入任意运行时代码。
6. 技能效果尽量数据驱动。
7. 有顺序的效果必须有确定执行顺序；连续效果通过 Event / Effect 链处理。

原语方向：
- Trigger：`ON_DEPLOY`、`ON_TURN_START`、`ON_DAMAGE_TAKEN`、`ON_DAMAGE_DEALT`、`ON_KILL`、`ON_DEATH` 等。
- Condition：区域、HP、手牌数、目标状态等。
- Effect：`DEAL_DAMAGE`、`DRAW_CARDS`、`HEAL`、`MOVE`、`GAIN_ARMOR`、`DISCARD_CARDS` 等。
- Target：`SELF`、`ALLY_ONE`、`ALLY_ALL`、`ENEMY_ONE`、`ENEMY_ALL`、`BASE`、`GENERAL_OR_BASE`、事件上下文目标等。
- Cost：弃牌、失去 HP、消耗资源等。

原语可扩展，但必须进入唯一 runtime。

## 7. Legacy 与重复系统治理规则

- “文件存在”不等于“系统仍然有效”；判断 canonical / legacy 必须依据真实 import/call graph 和运行时入口。
- 发现旧系统时先标记 `LEGACY` / `NON_AUTHORITATIVE`，完成调用方审计后再删除；不得仅因文件看起来重复就直接删除。
- 已确认的 canonical 系统不得再建立同义第二套运行时。
- 代码行数最少不是重构目标；行为、规则权威和边界清晰优先。
- 兼容 re-export 可以保留，但必须注明 canonical 实现位置。
- 2.1.0 已完成这批清理：`src/skills/SkillEngine.ts`、`EffectResolver.ts`、`SkillRegistry.ts`、`types.ts`、`effectTypes.ts`、`src/card/*`、`src/actions/*`、`src/status/*`、`src/timeline/*`（仅保留 canonical 的 `PrioritySystem.ts`）、`src/rules/CardRule.ts`、`TurnRule.ts`、`src/data/skillEffects.ts` 经双轮 import/call-graph 复核零引用后删除；`USE_SKILL` 动作类型（无任何 resolver 处理）一并移除。
- 技能执行权威唯一：`GameEngine + TriggerEngine + SkillTriggerBridge + skillCompiler`。2.1.0 起 `registerPlayerSkills` 已由 `syncPlayerSkills` 在每次 store dispatch 时实际调用并有端到端测试，此前"骨架已存在、运行时尚未闭环"的口径升级为：**核心链已闭环并有回归测试**；2.2.0 起内容入口同步打通——SkillEditor 多效果模式可录入结构化 runtime（类型/数值/目标）、Excel 效果列 6 列往返，DIY 技能已可产生可结算效果。技能系统整体仍未完成（HEAL/GAIN_ARMOR 与其余触发原语、回合结束询问窗口、技能致命伤 DEATH 事件未接入；实战表现待用户回归），对外表述仍须附此边界，不得宣称技能系统全部完成。

## 8. 多模型协作规则

当前模型标记：
- `[MODEL:OPENAI-GPT-5.6-LUNA]`：GPT-5.6 Luna / ChatGPT 主线。
- `[MODEL:COPILOT-SDK-VSCODE]`：Qoder CN / VS Code Copilot SDK 分支。
- `[MODEL:DEEPSEEK]`：DeepSeek 外部评审来源。

模型标记只用于溯源，不代表质量评分。

每次迭代尽可能记录：
- `author_model`
- `review_model`
- `verification_actor`
- `verification_status`

状态：
- `CODE_CHANGED`
- `MODEL_REPORTED`
- `INDEPENDENTLY_VERIFIED`
- `VERIFIED`
- `PENDING`
- `DEFERRED`
- `BLOCKED`
- `LEGACY`
- `AUTHORITATIVE`
- `NON_AUTHORITATIVE`

规则：
- 一个模型自报通过 = `MODEL_REPORTED`，不能冒充其他模型已验证。
- 不覆盖其他模型历史作者标记。
- 不把外部建议冒充自己提出。
- 不把其他模型测试结果冒充自己的验证。
- 分支必须说明 `baseline_from` / `branch_scope`。
- 跨模型分支不得默认直接合并；正式合并前必须先做源码级差异审查、类型检查、构建和关键玩法回归。
- 一个模型的重构版本若未经另一模型或用户验证，不得直接升级为主线 authoritative baseline。

## 9. 当前验证状态与路线

- 1.21：用户已实际确认双色卡外框和补给行动正常。
- 1.22：已接入本机对局快照能力。
- 1.23：已将保存入口移入游戏内菜单，将读取入口移入主菜单“继续游戏”。
- 1.24：游戏内菜单固定显示在右上角；类型检查、构建通过，主菜单版本号页面复核通过。
- 1.25：对局菜单扩展完成；类型检查、构建和主菜单页面复核通过，用户对局验证待完成。
- 1.26：Qoder 的对局存档/自动保存 UI 流程已完成；Qoder 日志声称 `npm run check/build` 通过，但本次 GPT 独立复核：TypeScript 源码检查通过，Vite build 未能在所附 `node_modules` 环境中独立复现（缺少 Rollup Linux optional dependency），因此 build 保持 `MODEL_REPORTED`。
- 1.26 归档发现：源码包携带 `node_modules`，不符合当前“干净源码归档”规则；同时 `package.json` 为 1.26.0，而 `package-lock.json` 根版本仍为 1.21.0，属于版本元数据不一致，建议后续修正。
- 1.26 源码审计发现：技能运行时尚未形成完整业务闭环；多个历史技能/卡牌/状态/回合类模块仍以非权威或 legacy 候选形式存在，后续应先做 canonical 收敛。
- 1.27：修复本机存档恢复过程中 `roomId/roomName/playerCount` 不一致的问题；恢复时同步写回房间元数据，失败时清理坏档，避免继续游戏出现房间身份漂移。
- 1.28：坏档恢复失败后立即隐藏“继续游戏”；版本号和锁文件版本统一为 1.28.0；新版本归档不包含 `node_modules` / `dist`。
- 1.29：明确加入 `@rollup/rollup-linux-x64-gnu` 可选依赖；构建前自动执行 `npm install --include=optional`，避免归档环境缺少 Rollup 平台包导致无法独立构建。
- Git 迁移：1.29 已初始化独立仓库，加入 `.gitignore`，完成首个基线提交并打上 `v1.29` 标签；旧版本文件夹保留为备份。
- 下一阶段：继续完善真实服务器连接、重连和技能运行时收敛；本机保存不等同于在线同步。
- 已知风险：依赖审计问题仍延期，尚未执行强制升级。
- 2.0（本地独立验证于会话内执行）：`npm run check` = 0 错误；`npm run test` = 128 通过；`npm run test:coverage` 达到棘轮阈值（lines>=13 / statements>=11 / branches>=10 / functions>=7）；`npm run lint` = 0 错误 / 32 条 react-hooks 遗留警告（技术债，见 AGENTS.md）；`npm run build` 成功。
- 2.1.0（本地会话内验证）：`npm run check` = 0 错误；`npm run test` = 152 通过（15 文件，含新增 `src/skills/skillCompiler.test.ts` 13 例与 `src/skills/skillPipeline.test.ts` 8 例端到端闭环：回合开始摸牌、奸雄型受伤摸牌、拥有者/将领双重条件隔离、技能伤害按护甲规则结算、攻/技伤害筛选、抽牌不重复实例、store 桥多次 dispatch 依然生效）；`npm run test:coverage` 通过新棘轮（lines>=18 / functions>=11 / branches>=15 / statements>=17，skills 目录 72.9% 语句）；`npm run lint` = 0 错误 / 32 条遗留 react-hooks 警告（数量与基线一致，本轮零新增）；`npm run build` 成功（单文件 dist）。CI 远端复验已完成：run `35741957716` 全绿（lint+audit / test 22 与 24 矩阵含 check+coverage / build，master@9f8b453，附注标签 `v2.1.0` 同指）。
- 2.2.1（本地会话内验证）：`npm run check` = 0 错误；`npm run test` = 176 通过（18 文件，+3：`src/store/gameStore.draftEdits.test.ts` 锁定 confirmDraft 征召时合并 skillEdits/generalEdits 且纯描述技能不被凭空执行）；`npm run test:coverage` 通过现棘轮（阈值未上调，实测 lines 27.7）；`npm run lint` = 0 错误 / 30 条遗留警告（零新增）；`vite build` 单文件成功。同日完成浏览器端到端最小可玩回归（真实点击）：①开局/选将 ②初始抽卡（滑块分配 将领池/卡牌池） ③部署（登场消耗=HP、消耗将领回池、只能落本方营地） ④普攻与护甲扣伤 ⑤将领阵亡 ⑥本营胜负 全部通过；⑦编辑器"援军"技能进局首次实测失败→定位为 confirmDraft 断点→修复后复测通过（文鸯登场后其回合开始 手牌 6→12、抽牌堆 -6）。注意：修复前创建的旧对局存档仍不含编辑器改动（征召时点快照），验证技能改动必须新建房间。CI 远端复验已完成：run `35766373504` 全绿（CI #9，master@1633d09，2m36s，lint+audit / test 22 与 24 矩阵含 check+coverage / build）。
- 2.2.6（本地会话内验证）：`npm run check` = 0 错误；`npm run test` = 219 通过（27 文件，+14：`src/replay/replayNaming.test.ts` 5 例（时间戳缩写/默认命名 房间名-势力-年月日时/无势力占位/非法字符清洗/后缀与子文件夹常量）、`liveReplayRecorder.test.ts` 3 例（建档+链式衔接+序列化可被官方解析器读回 / 新初始 BEGIN_DRAW 重开文档 / reset 清空）、`gameplayLog.test.ts` 2 例（抬头+中文步骤行+零 ❌ / 拒绝步整行 ❌ 附 [code] 原因）、`replayStorage.test.ts` 3 例（默认值/持久化往返+坏 JSON 回退/无 File System Access 环境降级下载）、`engineExecutionBridge.replay.test.ts` 1 例（真实引擎经桥接层逐步入册，含被拒动作可审计））；`npm run test:coverage` 通过现棘轮（阈值未动，实测 lines 40.3 / funcs 26.67 / branches 29.91 / stmts 35.51）；`npm run lint` = 0 错误 / 30 条遗留警告（零新增）；`vite build` 单文件成功（1,896.11 kB / gzip 554.52 kB）；浏览器 E2E：设置页"录像与日志"组渲染+默认态（自动保存录像关/日志开）→ 切换开关并验证 localStorage 持久化 → 开发者模式解锁 → 结算窗口（dev 钩子装配真实捕获 3 步 + 1 拒绝步数据）：询问卡出现、默认名 `E2E结算房-蜀-20260923-13`、📥 自动保存双行提示、改名后手动保存成功；测试场沙盒按既有口径不跳结算窗（投降钉在 testArena），故结算 E2E 走 `window.__TK__` dev 钩子（生产 bundle 不含）。CI 远端复验已完成：run `35822419623` 全绿（CI #18，master@6d82741，lint+audit / test 22 与 24 矩阵含 check+coverage / build）。
- 2.2.5（本地会话内验证）：`npm run check` = 0 错误；`npm run test` = 205 通过（22 文件，+6：`src/ai/battleReport.test.ts` 汇总统计/❌ 三类标注/干净局 ✔/中文动作行/录像 bundle 形状/失败文件筛选/哈希钳制缺省）；`npm run test:coverage` 通过现棘轮（阈值未动，实测 lines 40.39 / funcs 26.03 / branches 29.51 / stmts 35.43）；`npm run lint` = 0 错误 / 30 条遗留警告（零新增）；`vite build` 单文件成功；浏览器 E2E（真实点击，dev 服务器）：开发者模式解锁→主菜单"AI 对战演练"出现→配置弹窗（人数/局数/种子/步数上限/高级项）→后台窗口 `#ai-battle` 真跑 2 局全部获胜、零违例、96ms→主窗口右下角结束简报按子窗口回传消息完整渲染→弹窗拦截时手动打开链接兜底出现；期间发现并修复简报面板与弹窗的层级重叠。环境适配：本地 Node 升至 v24 后 vitest 5.0.1 默认 worker 全线崩溃，`vitest.config.ts` 对 Node>=24 自动切 `vmThreads` 池（CI Node 20/22 行为不变）。真实 OS 弹窗父子 postMessage 往返在自动化浏览器无法端到端复验（弹窗被硬拦），已在 HANDOFF 诚实标注；CI 远端复验已完成：run `35817697563` 全绿（CI #16，master@e0f4cf3，lint+audit / test 22 与 24 矩阵含 check+coverage / build），附注标签 `v2.2.5` 指向本轮登记文档提交。
- 2.2.4（本地会话内验证）：`npm run check` = 0 错误；`npm run test` = 199 通过（21 文件，+4：`src/ai/battleRunner.test.ts` 种子局零违例×2、同种子复现、录盘整局复放回环）；本地 soak `npm run ai-battle`：1000 局双人 + 400 局三人 + 300 局四人（skill 0.9）+ 200 局长局共 1900 局 0 违例（均值 9-55ms/局），`--replay` 跨进程读回 match JSON 精确复现（同 winner同步数）；`npm run test:coverage` 通过上调后新棘轮（lines>=39 / functions>=25 / branches>=28 / statements>=35，实测 40.93/25.89/29.52/35.63）；`npm run lint` = 0 错误 / 30 条遗留警告（零新增）；`vite build` 单文件成功。CI 远端复验已完成：run `35811273378` 全绿（CI #14，master@d3e166f，lint+audit / test 22 与 24 矩阵含 check+coverage / build），附注标签 `v2.2.4` 指向本轮登记文档提交。
- 2.2.3（本地会话内验证）：`npm run check` = 0 错误；`npm run test` = 195 通过（20 文件，+5：`src/rules/legalActions.ts` 合法动作枚举器——候选生成 + 引擎同源裁判试探，`legalActions.test.ts` 含"枚举⇒dispatch 必被接受"对账、试探零副作用守卫、双随机 AI 只凭清单自对局至终局冒烟）；`npm run test:coverage` 通过上调后新棘轮（lines>=37 / functions>=23 / branches>=26 / statements>=31，实测 38.39/24.15/27.63/33.2）；`npm run lint` = 0 错误 / 30 条遗留警告（零新增）；`vite build` 单文件成功（1,856.46 kB / gzip 540.86 kB）。CI 远端复验已完成：run `35806986372` 全绿（CI #12，master@ad8bafe，lint+audit / test 22 与 24 矩阵含 check+coverage / build），附注标签 `v2.2.3` 指向本轮登记文档提交。
- 2.2.2（本地会话内验证）：`npm run check` = 0 错误；`npm run test` = 190 通过（19 文件，+14：`src/core/gameFlow.test.ts` 核心玩法流程 GameAction 直驱端到端——开局抽牌链/部署/移动/攻击护甲/阵亡补偿/本营胜负/结束回合四事件链/空将池 RESOLVE_BASE_LOSS/投降/完整一局冒烟+牌堆账本守恒；拒绝路径逐项断言且验证状态零变化）；`npm run test:coverage` 通过上调后新棘轮（lines>=34 / functions>=21 / branches>=24 / statements>=29，实测 35.04/21.93/25.13/29.87）；`npm run lint` = 0 错误 / 30 条遗留警告（零新增）；`vite build` 单文件成功（1,853.51 kB / gzip 540.20 kB）。CI 远端复验已完成：run `35801947056` 全绿（CI #10，master@6b20f8c，2m45s，lint+audit / test 22 与 24 矩阵含 check+coverage / build），附注标签 `v2.2.2` 指向本轮登记文档提交。
- 2.2.0（本地会话内验证）：`npm run check` = 0 错误；`npm run test` = 173 通过（17 文件，+21：`src/skills/skillExcelFormat.test.ts` 19 例覆盖触发字符串往返/效果列组 3↔6 列新旧格式/单元格→编译定义打通，`src/components/SkillEditor.runtime.test.tsx` 2 例经 @testing-library 真实点击完成"切换多效果→选结构化类型→保存→store 中出现 runtime 载荷"）；`npm run test:coverage` 通过新棘轮（lines>=27 / functions>=16 / branches>=19 / statements>=23，实测 31.0/19.4/22.3/26.4，skills 目录 84.9% 语句）；`npm run lint` = 0 错误 / 30 条遗留 react-hooks 警告（较基线 -2，零新增）；`npm run build` 成功（单文件 dist）。编辑器录入的实战对局表现仍属待用户回归（PENDING）。CI 远端复验已完成：run `35747930832` 全绿（lint+audit / test 22 与 24 矩阵含 check+coverage / build，master@9f74622），附注标签 `v2.2.0` 指向本条登记文档提交。
- 2.0.4：两仓库已推送 GitHub 私有远程（`DJXD248/three-kingdoms-2.0` / `three-kingdoms-1.29`）。CI 首轮真实运行暴露 Node 18（缺 `node:inspector/promises`）与 Node 20（jsdom/undici 缺 `webidl.markAsUncloneable`）不兼容，矩阵调整为 22/24 后复跑 **全绿**（run 35724339303：lint+audit / 22 与 24 矩阵 test+coverage / check / build，2m31s）。Pages 部署改为仅手动触发（`workflow_dispatch`），启用公开网页前需 Settings -> Pages -> Source = "GitHub Actions"；当前定位：私有托管 + CI 验证，不公开。
- 2.0.1：xlsx(SheetJS) 高危漏洞经 SheetJS CDN 0.20.3 修复（会话内独立验证：check=0 / 128 pass / lint 0 err / build ok / audit 剩 2 moderate）。技能编辑器 Excel 导入的真实文件回归待用户验证（PENDING）。
- 2.0.3：上述两项依赖风险均已销案——两仓库统一 exceljs `^4.4.0`，npm overrides 强制 uuid `^11.1.1`，`npm audit` 全绿（0 漏洞）。维护备注：今后升级 exceljs 时需复查 overrides 中 uuid 的版本约束是否仍适用（uuid 8→11 的 `v4` 接口兼容，exceljs 仅 cf-rule-ext-xform.js 一处使用）。
- 2.0.2：xlsx 修复判定 COMPLETE——依赖/产物/锁文件三层无漏洞版本，自动化回归（jsdom browser 构建 + 真实夹具）+ CI audit high 门禁 + 版本断言测试防回退；1.29 线同步修复（`v1.29.3`，check/build 通过）。用户端浏览器真机实测欢迎但不再阻塞（jsdom 回归已覆盖同一构建路径）。`npm audit --audit-level=high` 实测 exit=0。

## 9. 文档职责：规则与记录彻底分离

### PROJECT_HANDOFF.md
只负责：
- 当前规则
- 当前架构
- 当前版本 / 分支
- 当前权威实现
- 当前已知风险
- 当前验证状态
- 当前路线
- 多模型协作规则
- 文档维护规则

它是**当前状态快照**，更新 / 覆盖，不做历史流水账。

### PROJECT_HISTORY_AI.md
只负责历史：
- 版本 / Phase
- Goal
- Issue
- Root Cause
- Fix / Method
- Files
- Resolution order
- Verification
- Unresolved / Risk
- User test status
- Next route
- 模型作者 / 审查 / 验证身份

### PROJECT_HISTORY_HUMAN.md
只负责历史：
- 人类可读的开发过程
- 决策原因
- 问题与修复
- 作者
- 验证
- 未解决事项

### 源码归档
- 正式源码 ZIP 默认只保留源码、配置、依赖清单和三份项目文档。
- `node_modules/` 与 `dist/` 默认不进入正式归档；需要验证时在本地通过 `npm ci` 重建。
- 归档不得因为包含本地依赖缓存而掩盖真实依赖完整性问题。

### 禁止
- 不再创建 `PHASE_*.md`。
- 不再创建 `*_NOTES.md`。
- 不再创建第四份长期历史日志。
- 不把完整历史复制进 HandOff。
- 当前规则变化时必须更新 HandOff，不能只写 History。

## 10. 每次迭代固定流程

### 修改前
1. 读 HandOff。
2. 读双 History 最近记录。
3. 检查最新源码。
4. 确认 canonical 实现。
5. 明确 `baseline_from`、目标、风险、验证方案。
6. 不得自行改变已冻结规则。

### 修改中
- 优先复用 canonical path。
- 优先安全清理 Legacy，而不是新增并行系统。
- 未证明语义等价时，不为减少代码行数强行合并。
- 发现规则与源码不一致时先记录 / 核实，不猜。

### 修改后
必须：
1. 更新 HandOff 的当前状态。
2. 向 AI History 追加历史。
3. 向 Human History 追加历史。
4. 新记录带作者模型标记。
5. 写清验证者和验证状态。
6. 不生成 PHASE / NOTES。
7. 若源码有改动，明确是否生成源码 ZIP。
8. 未验证必须 `PENDING`，不能把“代码改了”写成“玩法已修复”。

## 11. 验证规则

- 对核心多人流程，优先至少覆盖 2P 与 4P 两个边界场景；涉及被淘汰座位、抽卡、投降、GAME_OVER 的改动要特别验证跳过已淘汰玩家。

推荐：
1. `npm run check`
2. `npm run test` / `npm run test:coverage`
3. `npm run lint`
4. `npm run build`
5. 关键流程实际运行
6. 回归验证
7. 用户验证

注意：
- 类型检查 / 构建通过 ≠ 玩法已验证。
- `MODEL_REPORTED` ≠ `INDEPENDENTLY_VERIFIED`。
- 行为修复必须有运行时 / 用户证据后才标为 `VERIFIED`。

## 12. 当前状态

已解决 / 有明确修复链：
- 初始抽牌黑屏 / 卡死相关主要状态迁移。
- 开局 5 张、R1 0/1、R2+5。
- 将领池为空 → 本营 -1 HP。
- turn-start base-loss 败北后继续。
- 普通死亡与玩家败北区分。
- 投降推进。
- 敌方营地近战 → 本营。
- 战场单一路径显式选择 / 取消。
- 前线 → 战场空槽选择。
- 测试场 4P 上限、工具栏、HP、抽卡 / 投降主要流程。
- 同名将领 runtime instance identity 及移动 / 攻击 / 消耗 / 动画隔离。
- Network export 冲突。
- 5.35.26.4.1 的 `cloneWithRuntimeInstance` import 错误。
- 1.27：保存恢复时的 `roomId/roomName/playerCount` 同步问题已修正，坏档会自动清理。

仍需验证 / 风险：
0. （2.2.1 记录）最小可玩闭环七项浏览器回归已全部通过一次（含编辑器技能进局），但属单场次样本：手感、平衡、长时间多轮对局仍归用户日常回归。已知小瑕疵：MainMenu 页脚版本串仍是旧的"Qoder V1.28"（装饰性文案，未随版本更新）；移动模式提示语偶有残留、攻击按钮禁用无原因提示（观察项，未修）。
1. 5.35.26.4 跨势力 / 群势力外框最终视觉。
2. 将领池随机长期样本。
3. 非棋盘页面响应式 / 移动端体验。
4. Skill Runtime 最终唯一化与旧系统清理（2.1.0 已完成核心收敛；剩余见第 9 条）。
5. 真正在线 WebSocket / Session / DB / 生产服务。
6. Qoder 分支如需合并，必须基于实际源码独立审查，不能仅凭日志判断。
7. Qoder 1.29 `package-lock.json` 已与 `package.json` 版本号保持一致，并明确记录 Rollup Linux 可选依赖；Git 已通过 `.gitignore` 排除 `node_modules/`、`dist/`、`.env` 和 `*.log`。
8. 本机存档恢复和坏档清理仍需实际用户回归验证。
9. （2.1.0 已销案：多套并存的运行时结构已删除，canonical 路径已被实际业务调用并有端到端回归。）技能系统当前真实边界，PENDING 待办：a)（2.2.0 已销案：SkillEditor 多效果模式已支持结构化 runtime 录入（类型/数值/目标），Excel 效果列组升级 6 列并兼容旧 3 列导入；单效果模式仍为纯描述，属有意范围限定而非缺陷）；b) HEAL / GAIN_ARMOR 效果与 modify* / onBase* / passive / active* / untilExpire / onOtherDeploy / onTurnEnd / onBecomingTarget / onTargetConfirmed / onOtherSkillActivated 等触发未接入原语（编辑器已能录入 HEAL/GAIN_ARMOR 数据并诚实标注"暂未接入结算"，编译器按 EFFECT_TYPE_UNSUPPORTED 跳过）；c) 回合结束技能询问窗口（§4 冻结规则）中 `ReactionWindow.open` 仍无业务入口，规则本身不变、实现暂缓；d) 技能伤害致死由 EventProcessor 直接移除将领，不产生 DEATH 事件，故 onKill 对技能致命伤不触发。
10. GPT 审计指出的 1.29 归档边界问题已纳入迁移规则：正式提交不得包含 `node_modules/`、`dist/` 或空的依赖目录。

## 13. 当前默认路线

1. 技能系统唯一化。（2.1.0 完成：唯一运行时 + 注册接线 + 零引用旧栈删除 + 回归测试；2.2.0 追加：内容入口打通——编辑器结构化录入 + Excel 6 列，§12-9a 销案；后续推进归入第 9 条 b-d 待办。）
2. 保持最小可玩闭环端到端可运行。
3. 安全清理 Legacy / 重复系统。
4. UI / Mobile convergence。
5. Network productionization。
6. DIY 内容平台。

## 14. 交接检查清单

- [ ] 当前基线已写明。
- [ ] HandOff 当前状态已更新。
- [ ] 双 History 已更新。
- [ ] 作者模型标记正确。
- [ ] 验证者 / 状态明确。
- [ ] 未验证事项保持 PENDING。
- [ ] 无新的 PHASE / NOTES。
- [ ] 无模型冒认。
- [ ] 分支有 `baseline_from` / `branch_scope`。
- [ ] 下一模型只需 HandOff + 双 History + 最新源码即可继续。

## 15. 一句话原则

**规则放 HandOff，历史放 History；HandOff 说明现在是什么，History 说明过去发生了什么。**
