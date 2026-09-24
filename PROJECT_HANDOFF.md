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
4. 再读取 `PROJECT_ARCH_MAP.md`（全项目架构与权威地图，v2.2.10 基线，2.2.11 建：模块职责/权威/生命周期/确定性/验证级别/架构债 D-1~D-8——动任何模块前查它，改完地图随之更新）。
5. 再检查最新源码。
6. 当前事实以“最新源码 + 本文件”为主；History 用于解释演化原因；地图与代码不符时以代码为准并登记勘误。
7. 版本收尾（登记/提交/标签/推送/CI 核验/回填）按 `PROJECT_RELEASE_PIPELINE.md` 逐字执行——每次改动完成后的固定流水线，所有模型通用（Qoder 端另有等价个人技能，仅本机生效，以该文档为准）。

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

当前最新 Qoder 版本：`2.2.20`（独立仓库 `Qoder/2.0`，附注标签 `v2.2.20`；里程碑标签 `v2.0` -> 提交 `95b3540`）
本轮调整（2.2.20）：**稳定期阶段 E 首刀（决议 D-1）——唯一纯转移函数 TransitionCore 抽出、重建式执行降级为对账工具、ReplayPlayer 技能注册修复 + 三路对账测试**（用户口令"开工吧"+授权创建 TransitionCore.ts；范围口径确认：①纯转移抽出 ②常驻 vs 重建对账测试 ③ReplayPlayer 修复 ④除③外零行为变化，store 常驻迁移（gameStore 持有长生命周期引擎）明确顺延下一刀）。① **新增 `core/TransitionCore.ts`（97 行）**：`transition(state, action, ctx: TransitionContext{rules,resolvers,processor,triggers}) → {state, events, accepted}`——原 GameEngine.dispatch 的"校验（ACTION_REJECTED 早退）→ getResolver（NO_RESOLVER 早退）→ ACTION_ACCEPTED + resolver.resolve → resolveTriggerChain 触发链 → EventProcessor.process 结算 → 有界 DEATH 重入循环（MAX_TRIGGER_REENTRY_ROUNDS=8 常量随迁，超上限发 CUSTOM TRIGGER_REENTRY_LIMIT）"**逐字移入**；纯路径不发 STATE_CHANGED、不给事件盖 id/timestamp（EventBus.emit 就地打戳留在容器层）。② **GameEngine 降为薄容器**：dispatch=调用 transition + 容器侧效应（rejected 事件即时 emit；接受路径在事件尾 push STATE_CHANGED 快照、emit 循环、recordHistory 门控的 replay.record + snapshots.capture，sequence=录像条目数+1）；可观测行为逐字不变，快照/发射/录像记录全部留在容器。③ **三路对账测试 `core/transitionEquivalence.test.ts` 新增 3 例（291→294）**：常驻实例（一个引擎连跑 4 步脚本）vs 每步重建（生产桥 `dispatchStoreAction`）——逐步原始事件序列全等 + 终态全等；第三路把常驻引擎的录像文档交 ReplayPlayer 重建整局，逐步事件与终态亦全等。脚本覆盖技能击杀链（烈攻补伤+枭斩 onKill+遗志 onDeath→DEATH 有界重入触发链）、前进移动、补偿抽窗拦截 END_TURN 的拒绝步；归一化仅剥离容器层打戳产物（事件对象的 id/timestamp、时间派生 rootEventId），不触碰引擎语义字段。④ **ReplayPlayer 修复（本轮唯一行为变化，如实披露）**：重建式回放此前只在构造时注册初始场面技能，**中途登场将领的技能不会注册**——现每次 dispatch 前 `syncPlayerSkills(engine, engine.state)`（与实况每步路径即生产桥完全同构）；TriggerEngine.register 按 id Map.set 幂等，常驻实例重复注册安全。ReplayPlayer 无 UI 消费方（仅录像工具链），影响面=录像重建回放与实况一致性。⑤ **D-1"禁止双路长期执行"纪律落实**：转移逻辑现在只有一份（TransitionCore），常驻/重建只是两种持有状态的外壳；store 常驻迁移顺延。**行为变化披露：仅④**，其余全部可观测行为零变化（ai-battle 300 局分布与 2.2.19 基线逐字一致佐证）。验证：check 0 错误 / 294 测试通过（37 文件，+3）/ 覆盖率棘轮维持 42/34/34/47（实测 stmts 43.04 / branch 35.54 / funcs 34.55 / lines 48.11，四项均较 2.2.19 微升）/ lint 0 错误 30 遗留警告（零新增）/ build 单文件成功（1,919.03 kB / gzip 563.48 kB）/ `npm run ai-battle -- --games 300 --seed 1` 胜席分布 {1:109,2:191} 与 2.2.19 基线逐字一致（won=300、VIOLATIONS=0，D-1 对 AI 整局链路零漂移）。浏览器真机 E2E（dev 5199 人机对战 2 人房，DOM 真实点击+骰子限流技巧）：登场庞德（手牌 5→1）→🚶前进至前线（engineState position 实证 front:0）→⏭️结束回合→AI 完整回合（抽卡+登场邓艾+前进+结束回合，全部走 TransitionCore 新链路）→第 2 轮玩家抽卡确认→🏹远程攻击流程（选消耗卡→目标高亮）全通，console 0 错误 0 警告。E2E 中一段登场"无响应"经查为测试驱动污染 GameBoard 局部选择态（多次嵌套点击），非引擎回归——`dispatchStoreAction` 直驱探针返回 ACTION_ACCEPTED+GENERAL_DEPLOYED 实证，教训已入记忆（一次 evaluate 只点一个 React 元素）。CI 远端复验（已回填）：feat `518bb6f` + docs `ee761ba` + 附注标签 `v2.2.20` 一次推送（直连超时→一次性借道本地代理 127.0.0.1:10808 成功，未写持久配置）；push 事件按顶端提交建单 run——CI **#52**（run `35995323024`，master@ee761ba，覆盖 feat+docs 全树）**全绿**：test(22)/test(24)（294 例双 Node 全过）/lint/build 四 job 页面 aria-label 全部 completed successfully，零失败标记。
上一轮（2.2.19）：**稳定期阶段 D 第二刀（决议 D-2 之 b/c/d 三项）——建局随机全面迁入 rngState 游标、运行时 id 确定性化、withSeededRandom 彻底退役 + battleRunner lockstep 清理**（用户口令"补阶段 D 第二刀"；范围问答确认 b+c+d 本刀、a RandomOutcome 事件流单独一刀）。① **b) 建局随机入游标**：`createCardDeck` 与 `runtimeSetup` 四函数（createLobbyPlayers/rollAndSortPlayers/assignFactions/buildDraftCandidates）新增 `random` 注入参（默认 Math.random 仅供 dev 工具与 UI 骰子）；`gameStore` 建局五步（createRoom/rollDice/assignFactions/distributeDraftGenerals/confirmDraft 候选补抽分支）统一消费 `EngineState.rngState` 游标克隆，经新 `commitSetup` 与补丁同批提交（投影与 engine-aware setter 等价，唯一可观测差=游标前进）；人机实战 aiTurnDriver 走 store 动作自动覆盖。② **c) id 确定性化**：`createAction` id 改进程计数器 `action_N`（消费方只做关联从不按 id 查找）；`createRuntimeInstanceId` 去掉 Date.now+Math.random 改纯计数器（全库按相等性使用；旧录像 id 已内嵌 initialState 故不受影响）；matchSetup 种子盖戳（`ai{seed}_c{n}`）扩展到卡与注入技能——原先靠测试归一化豁免的泄漏面消失。③ **d) withSeededRandom 退役**：删除 `src/ai/rng.ts`（全库无 Math.random 全局补丁残留于 AI 链路）；`matchSetup` 自带装配流（`seed ^ 0x9e3779b9` 播种，卡堆/阵营/采样/技能注入/时机全部消费同一局部流）、`battleRunner` 自带策略流（`seed ^ 0x85ebca6b`，经 `AiPolicy` 新增可选第三参 `random` 注入；实战域 random-tier 无注入时回落 Math.random，属预期内）；三条播种流（局内 rngState / 装配 / 策略）显式分离。④ **lockstep 清理**：复放模式不再咨询策略——录像动作经 `createAction` 按记录直接重建（"总是咨询策略"的 lockstep 技巧在双轨下已属冗余，随本刀删除）。测试钉：新增 `store/setupDeterminism.test.ts` 3 例（同 seed 建局逐字段全等 / 异 seed 分歧 / createRoom 后游标确已前进）；`battleRunner.test` 确定性断言升级为动作序列全等 + 新增"无补丁全局局"（Math.random 换成抛错函数跑完整对局）；`matchSetup.test` 去掉 withSeededRandom 包装后同 seed deep-equal 全状态；`DrawResolver.test` 抛错探针收紧（动作构造也移入探针内，证明连 createAction 都不触随机源）。**行为变化披露：AI 对战 seed→胜负分布改变**——2.2.18 基线 `ai-battle --games 300 --seed 1` 胜席分布 {1:112,2:188} → 2.2.19 为 {1:109,2:191}（两轮均 won=300/VIOLATIONS=0，规则语义不变），平衡观测台历史数据需重锚。验证：check 0 错误 / 291 测试通过（36 文件，净增 +4）/ 覆盖率棘轮上调 functions 33→34（实测 42.61-42.81 / branch 35.19-35.54 / funcs 34.26-34.45 / lines 47.59-47.84；branch 地板留 34 防抖动，与 2.2.17 同一处置）/ lint 0 错误 30 遗留警告（零新增）/ build 单文件成功（1,918.71 kB / gzip 563.39 kB）/ `npm run ai-battle -- --games 300 --seed 1` 两遍输出内容逐字一致（仅耗时行不同）。**§12-16 浏览器真机抽牌 E2E 补账销案**：dev 5199 人机对战 2 人房真实点击全链路（建房→骰子 9/8→势力分配→征召 10 将→回合 1 抽牌面 2 将领+3 卡盖→选择确认→playing），console 0 错误；因内置浏览器视口隐藏，CDP 指针级输入不可用（NATIVE_BROWSER_VIEWPORT_UNAVAILABLE），以 evaluate_script 派发真实 DOM `.click()`（React 走真实事件处理器），骰子按既有测试技巧同步限流补丁处理，属测试环境行为非产品变化。剩余 D-2 欠账（§12-16 维持 PENDING）：a) RandomOutcome 事件流（"记结果不记重掷"，单独一刀）；e) 观察项（ReactionWindow 窗口 id、DiceRoll.tsx 纯 UI 骰子，与 §12-9c 同源）。CI 远端复验（已回填）：feat `086ff39` + docs `8646a05` + 附注标签 `v2.2.19` 一次推送（直连超时→一次性借道本地代理 127.0.0.1:10808 成功，未写持久配置）；push 事件按顶端提交建单 run——CI **#50**（run `35984979124`，master@8646a05，覆盖 feat+docs 全树）**全绿**：test(22)/test(24)（291 例双 Node 全过）/lint 1m14s/build 1m17s 四 job 均 completed successfully，run 页零失败标记。
上一轮（2.2.18）：**稳定期阶段 D 首刀（决议 D-2 主件）——引擎随机进 EngineState.rngState：抽牌选牌全链收敛为单一可播种游标**（用户口令"开始阶段D"；范围两问用户均"无偏好"→按既定口径代决=中刀：引擎核心抽牌链+AI 种子统一，withSeededRandom 收窄不删除；旧数据兼容=缺字段惰性播种、不 bump 任何版本号）。① 新增 `core/rng.ts`（49 行）：mulberry32 游标 `{ s: uint32 }` 纯数据（structuredClone/JSON 友好）+ `createRngState/cloneRngState/rngNext/rngShuffle`（洗牌返新数组，替代旧有偏 `sort(()=>Math.random()-.5)`）。② `EngineState.rngState?` 可选字段（旧快照/旧录像缺字段仍可加载）；`createInitialEngineState` 播种常量 0x9e3779b9，真实对局建房时由 adapter 重新播种。③ **DrawResolver 收敛（D-2"禁 Resolver 私拿随机源"）**：只校验（NO_PENDING_DRAW/DRAW_PLAYER_NOT_FOUND/DRAW_TOTAL_MISMATCH）+ 产**计数式** DRAW 事件（requestedGeneral/requestedCards/count/reason），不再选牌、Math.random 归零；测试内把 Math.random 换成抛错函数证明 resolver 不触随机源，另加纯等性断言（同状态同动作两次 resolve 全等）。④ `applyDrawEvent` 成为**全引擎唯一抽牌选牌点**：将池 rngShuffle、牌堆顶切片、弃牌堆种子重洗，游标推进写回 `state.rngState`；EventProcessor.process 单克隆+队列贯穿→多事件链上游标连续消费；缺游标旧局按 `(turn+1,round+1,deckLen)` 派生确定性兜底种子（旧档首抽也可复现）。技能摸牌裸 count 载荷保持兼容（SkillTriggerBridge DRAW_CARD 零改动）。⑤ `gameStateAdapter.seedRngState`：建房播种一次（Date.now^random），局中已有游标绝不重置；`isRestorableEngineState`/序列化白名单对未知字段宽容→**存档/录像零版本号变更**（NETWORK_SNAPSHOT_VERSION=1、ReplayDocument.version=1、EngineState.version=1 全部不动）。⑥ AI 对战：`buildMatchState` 直接给 `rngState=createRngState(seed)`——对局内抽牌流从状态游标来，与 withSeededRandom 全局补丁（继续覆盖建堆/采样/policy）双轨分立；录像 initialState 含游标→重建式回放可复现（"记结果不记重掷"仍未达成，PENDING）。测试 268→287（+19/−1 净口径：rng.test 8 例、drawEvents.test 8 例〔新建〕、DrawResolver.test 重写 8 例〔旧 3 例选牌断言换计数契约+探针+纯等性〕、executeDraw.rng.test 3 例〔生产 store 建房播种/同状态重放同抽/异种子变抽〕、gameFlow ①⑨ 两处旧"Math.random mock=恒等洗牌"断言改为阵营纯度正则）。**行为变化披露：抽牌结果分布与 2.2.17 前不同（种子洗牌+流拆分，属 D-2 预期内）**；牌堆顶顺序、补偿抽规则、UI 明牌（afterHand.slice 手牌差分）零变化。验证：check 0 错误 / 287 测试通过（35 文件）/ 覆盖率棘轮维持 42/34/33/47（实测 42.55/35.14/34.01/47.55，四项全部≥基线且四项实测值均较 2.2.17 微升，暂不上调地板）/ lint 0 错误 30 遗留警告（零新增）/ build 单文件成功（1,918.75 kB / gzip 563.32 kB）/ `npm run ai-battle -- --games 300 --seed 1` 两轮完全一致（won=300 VIOLATIONS=0 胜席分布 {1:112,2:188}）+ 既有 aiTurnDriver 全店链路（生产 store 跑完整 AI 局）在 287 例内通过。**诚实边界（浏览器 E2E 未做）**：本轮自动化环境权限分类器拒绝任何页面导航（browser-use navigate/new_page 通道均被拦），无法打开 dev 5203 页面做真机验证——等效验证降级为 vitest 生产 store 链路（executeDraw.rng.test + aiTurnDriver 全店局），真机点击面 PENDING；见 §12-16。剩余 D-2 刀（PENDING 登记 §12-16）：RandomOutcome 事件流、建局牌堆/骰子/势力采样迁入 rngState、action.id/instanceId 确定性、withSeededRandom 彻底退役、battleRunner lockstep 清理。CI 远端复验（已回填）：首跑 #46（run 35974231930，docs 提交 265d225）**失败**——test(22)/test(24) 在 `npm run check` 步骤报 TS6133（`executeDraw.rng.test.ts:11` 残留未使用导入 `createLobbyPlayers`；lint 绿、build 被跳过）。复盘：本地"check 0 错误"运行早于该测试文件最后一次编辑，属陈旧验证——教训已入档：**全套验证必须发生在所有文件定稿之后、提交之前**。修复提交 620a0a0（仅删该导入行，零行为变化，本地五项验证重跑全绿：check 0/287 测试/覆盖率同值/lint 0 错 30 警告/build 1,918.75 kB）；经用户授权（2026-09-24）标签 v2.2.18 由 265d225 强制重指至 620a0a0（仅此一处 tag ref，master 未强推，旧标签对象 97c3cf3 作废）。推送：直连超时→一次性借道 `127.0.0.1:10808` 成功（master 265d225..620a0a0 + tag forced update，未写持久配置）。CI #47（run 35975699142，master@620a0a0）**全绿**：test(22) 1m59s / test(24) 1m3s / lint 1m15s / build 59s 四 job 全部 completed successfully。
上一轮（2.2.17）：**稳定期阶段 C 开工（旧 §12-9 b/d 两项销案）——技能覆盖面补齐：HEAL/GAIN_ARMOR 真实结算 + 技能击杀→DEATH→onKill/onDeath 链**（用户口令"好吧，做阶段C"；范围经确认=b+d，c 即 ReactionWindow 业务入口与 modify*/onBase*/passive/active*/untilExpire 等无引擎事件触发种类**继续 PENDING**）。① HEAL/GAIN_ARMOR：`core/Event.ts` 事件联合 += 两类型；`eventProcessors/generalEvents.ts` 新增纯处理器 `applyHealEvent`（治疗封顶 maxHp，不在场武将=诚实 no-op）与 `applyGainArmorEvent`（currentArmor 点数累加，护甲点数货币而非实体护甲卡，与编辑器预览"获得 N 点护甲"口径一致）；`SkillTriggerBridge` 把两效果翻译为真实事件（含 target 解析）；`skillCompiler` SUPPORTED_EFFECT_TYPES 四类型（DRAW_CARD/DAMAGE/HEAL/GAIN_ARMOR）；`skillExcelFormat.SETTLEABLE_RUNTIME_TYPES` 同步四项——编辑器"暂未接入结算"标注自动消失。② 技能击杀链：技能致命伤此前由 DAMAGE 处理器直接移除将领、不发 DEATH（onKill/onDeath/补偿抽全链路缺失）。根因=技能致死只在 apply 时刻（链跑完冻结态之后）才可知。解法：`chainedConsequences` 对 damageType==='skill' 且目标将领 from→to 消失时派生 DEATH（普攻击杀已由 AttackResolver 自带 DEATH，damageType 门=去重）；`EventProcessor.process` 增可选第三参 `collected[]`（仅追加收集队列中途派生事件，单一改动入口 D-2 纪律不破）；`GameEngine.dispatch` 增加**有界重入回合**（MAX_TRIGGER_REENTRY_ROUNDS=8）：派生 DEATH 以应用后状态再展开触发链，每条 DEATH 只被状态处理一次，超上限发 CUSTOM `TRIGGER_REENTRY_LIMIT` 标记。优先级事实（链上实证）：onDeath(100) 先于 onKill(60) 结算→被害者遗志摸牌排在击杀者摸牌之前（牌堆序后果，测试钉死）。测试净增 +4 → 268 例/32 文件（编译器 HEAL/GAIN_ARMOR 编译断言替换跳过断言；管线 4 例：HEAL 封顶/GAIN_ARMOR 累加/技能击杀集成链/普攻击杀去重）。内置武将仍全为纯描述（编译器跳过），对现有内容零行为变化；`npm run ai-battle` 300 局 seed1 VIOLATIONS=0。验证：check 0 错误 / 268 测试通过（32 文件）/ 覆盖率棘轮上调 42/34/33/47（实测 42.46/35.11/33.85/47.49；branch 两轮抖动 35.11–35.28，地板保守留 34）/ lint 0 错误 30 遗留警告（零新增）/ build 单文件成功（1,918.69 kB / gzip 563.24 kB）；浏览器 E2E（dev 5203，store 直驱 `__TK__`，本轮真实点击被自动化环境拒绝改用既受口径——正式流程 建房→骰子→征召（skillEdits  baked 烈攻/枭斩/疗愈/遗志）→初始抽牌 全走后，restoreEngineState 种场面 + 真实 endTurn/attackTarget）：场景A p2 结束回合→p1 TURN_START 疗愈 hp2→4 封顶+固甲护甲 0→2 实测；场景B 黄盖（运行时 instanceId）近战 2+烈攻技能 3 击杀满血许褚→进入墓地、遗志 onDeath 摸牌 p2+1、枭斩 onKill 摸牌 p1+1、"玩家2 击破补偿抽卡"窗口出现并结算、回合权恢复归 p1 playing；UI 快照 黄盖 🛡️2 ❤️4/4、墓地(1)、控制台 0 错误。诚实边界：截图因页面处于后台 viewport 不可见无法产出（快照+控制台代替）；ReactionWindow（c 项）与其余触发种类仍未接入。**另记用户决定（2026-09-24）：三大 UI 文件闭包解绑"决定不做，除非有明确收益"**——稳定期路线中正式除名。CI 远端复验已完成：run `35965467286` 全绿（CI #44，master@926a530，3m 14s，test(22)/test(24)/lint/build 四 job 均 completed successfully，268 例双 Node 全过）；功能提交 `37fecc1`、登记提交 `926a530` 与附注标签 `v2.2.17` 已推送（直推成功，未借道代理）。
上一轮（2.2.16）：**稳定期 F 序列最后一刀——TestArena 纯移动拆分，D-6"三大 UI 文件"就此收线**（零行为改动，玩法/引擎/规则一字未动）。components/TestArena.tsx 485→483 行：尾部 3 个纯展示原语——SC（统计小卡）、Bar（底部浮动操作条）、Btn（确认/取消按钮，含禁用态）——逐字移入 `testArena/compactPrimitives.tsx`(10 行)；TestArena 顶部新增一行 import 随动。范围说明：TestArena 全屏仅这 3 个无状态捕获的顶层原语可纯移动外移；`Slot`/`BSlot`/`TerritoryBottom/Top/Side` 内联子组件、Dev 面板三标签与全部动作处理器因闭包依赖组件/store 状态**留守**（继续拆分需解闭包、须单独立项）。**刻意不与棋盘版 `gameBoard/uiPrimitives` 合并**：同名 SC/Bar/Btn 是紧凑变体（p-2 vs p-2.5、text-lg vs text-xl、bottom-[90px] vs bottom-[110px]、gap-3 vs gap-4 等 CSS 尺寸不同），合并=改样式=行为变化，违背纯移动纪律；新文件头注释已钉死该决定，未来统一需单独立项做视觉回归。另：TestArena 无 StatPill/Modal（检视弹窗为内联 JSX，非组件）。验证：check 0 错误 / 264 测试通过（32 文件，零增删）/ 覆盖率棘轮维持 41/34/32/46（实测 41.90/34.49/33.33/46.93，与上轮完全持平）/ lint 0 错误 30 遗留警告（零新增）/ build 单文件成功（1,916.59 kB / gzip 562.85 kB）；浏览器真实点击回归（dev 5204，startTestArena 4 人局，全走拆分后 compactPrimitives 实例）：将领池搜索"廖化"→点击入手牌→手牌瓷砖 inspect 弹窗 SC×4（❤️4/⚔️2/🏹1/🛡️0）→⚔️登场将领→**Bar**"登场：廖化 (消耗0/4)"+**Btn** 确认(禁用)/取消→选 4 张消耗牌→确认解禁→deployTarget **Bar**"📍点击营地空格放置"→点绿框营地格真实落子（camp:0、手牌 6→1）→场上武将 inspect SC 实时 4/4+本回合计数行+近战/远程/补给禁用态（射程内无敌/满血/无手牌）→🚶前进单目标直连移动（front:0）→Dev 面板"场上"标签执行伤害 3/4+命中动画→补给 **Bar**"补给(已选0张，补0点)"确认禁用→选 1 张军粮解禁→确认→回到 4/4 手牌清空→计数行"🚶移动 1次💊补给 1次"→玩家切换(0→1)→⏭️结束回合(0→2)→✕ 退出归 menu；控制台 0 错误 0 警告。CI 远端复验已完成：run `35952936795` 全绿（CI #42，master@3b3bf36，test(22)/test(24)/lint/build 四 job 均 completed successfully）；功能提交 `35880e0`、登记提交 `3b3bf36` 与附注标签 `v2.2.16` 已推送（直推成功，未借道代理）。
上一轮（2.2.15）：**稳定期 F 序列第二刀——GameBoard 纯移动拆分**（决议 D-6 后三件之二；零行为改动，玩法/引擎/规则一字未动）。components/GameBoard.tsx 704→689 行：尾部 5 个纯展示原语——SC（统计小卡）、StatPill（带 toneMap 的计数药丸）、Bar（底部浮动操作条）、Btn（确认/取消按钮）、Modal（弹窗骨架）——逐字移入 `gameBoard/uiPrimitives.tsx`(21 行)。微改仅关键字层面：文件尾新增一行 `export { SC, StatPill, Bar, Btn, Modal }` 聚合导出（各函数体一字未动，`React.ReactNode` 经 UMD 全局类型解析无需 import，check 0 错误证实）；GameBoard 顶部新增一行 import。范围说明：本轮拆出的是**无状态捕获的顶层原语**；`Slot`/`BSlot`/`TerritoryBottom/Top/Side` 与全部动作处理器因闭包依赖组件状态**留守**（非纯移动范围，继续拆分需解闭包、须单独立项）；`arrange()`、四个 useMemo 与全部 useEffect 不动。5 个原语全库仅 GameBoard 使用（2026-09-24 grep 确认，无外部引用方）。验证：check 0 错误 / 264 测试通过（32 文件，零增删）/ 覆盖率棘轮维持 41/34/32/46（实测 stmts 41.90 / branch 34.49 / funcs 33.33 / lines 46.93，较上轮微降系新文件头注释行摊薄，无行状态回归）/ lint 0 错误 30 遗留警告（零新增）/ build 单文件成功（1,916.59 kB / gzip 562.86 kB）；浏览器真实点击回归（dev 5203，全走拆分后组件实例）：正式流程建房(2人)→掷骰直驱→定势力（魏/蜀）→双人征召各 10 将→初始抽牌含 2 武将入手→playing 棋盘渲染；将领池弹窗 StatPill 计数正确（武将9/文将1/魏7/蜀0/吴0/群3/晋0）、抽牌堆弹窗（粮草14/材料12/军备16=42 张卡片）、弃牌堆/墓地空态文案；手牌武将 inspect 五张 SC（体力/护甲/近战/远程/基础）+登场按钮；登场 Bar（"登场：廖化 (消耗0/4张)"）+Btn 禁用态→选满 4 张消耗后解禁→确认→deployTarget 提示条→点营地格真实落子（廖化@camp:0、手牌清空）；场面武将 inspect SC 实时值 4/4→🚶前进单目标直连移动（front:0）；⏸️菜单浮层（保存对局/保存并退出/放弃/重开/规则/设置/返回）+保存对局+返回棋盘+resetGame 归 menu；控制台 0 错误。CI 远端复验已完成：run `35948875546` 全绿（CI #39，master@ab78fd0，test(22)/test(24)/lint/build 四 job 均 completed successfully，双矩阵各 32 文件/264 用例）；功能提交 `5ba8a53`、登记提交 `ab78fd0` 与附注标签 `v2.2.15` 已推送（直连遇网络波动超时，一次性借道本地代理 127.0.0.1:10808 成功，未写任何持久代理配置）。
上一轮（2.2.14）：**稳定期 F 序列第一刀——SkillEditor 纯移动拆分**（决议 D-6 后三件之首；零行为改动，玩法/引擎/规则一字未动）。components/SkillEditor.tsx 1253→868 行：Excel/文本导入解析器（parseSkillCell/clean/isDetailedFormat/isRowPerSkillFormat/resolveGeneralByNameFaction/parseRowPerSkillSheet/parseLegacyDetailedRow）逐字移入 `skillEditor/skillExcelParsers.ts`(228 行)；触发时机子组件 TriggerEditor（含 selectCls）与结构化效果子组件 RuntimeEditor（含 runtimeSelectCls/runtimePreviewText）逐字移入 `skillEditor/TriggerEditor.tsx`(106 行)/`skillEditor/RuntimeEditor.tsx`(78 行)。披露的微改仅类型/关键字层面：新增导出接口 `SkillEditEntry`（与组件内联 editingSkills 状态类型逐字段一致）取代解析器内 5 处 `typeof editingSkills`、组件 useState 改用该类型；迁出函数加 `export`（clean 保持模块私有）；解析器随迁出解除组件内 2 格缩进；SkillEditor 顶部 import 面随之收窄。`handleImportFile`/`handleExport`/`isIncompleteForExport` 因闭包依赖组件状态本轮**留守**（非纯移动范围）。验证：check 0 错误 / 264 测试通过（32 文件，零增删）/ 覆盖率棘轮维持 41/34/32/46（实测与上轮持平 42.09/34.67/33.45/47.16）/ lint 0 错误 30 遗留警告（零新增）/ build 单文件成功（1,916.59 kB / gzip 562.85 kB）；浏览器真实点击回归（dev 5202，全部经拆分后的组件实例）：图鉴→开发者模式→编辑器挂载、95 将列表渲染；TriggerEditor 触发下拉 20 项→onDamageTaken→伤害类型子下拉→预览"受到伤害后→攻击伤害"→保存入 store（trigger 含 damageSubType）→批删还原 0 编辑；多效果模式→RuntimeEditor 类型下拉（纯描述/DRAW_CARD/DAMAGE）→数值 3→目标下拉→预览"造成 3 点技能伤害→被作用者"；真实 .xlsx（row-per-skill 11 列表头）经隐藏文件输入注入→走拆分后 isDetailedFormat/isRowPerSkillFormat/parseRowPerSkillSheet→"✅ 从 1 个工作表导入 1 名将领"且 store 落库正确→清理还原 0；导出按钮→"✅ 已导出Excel文件"；控制台 0 错误。CI 远端复验已完成：run `35944672735` 全绿（CI #37，master@f3e295c，test(22)/test(24)/lint/build 四 job 均 completed successfully）；功能提交 `0580e08`、登记提交 `f3e295c` 与附注标签 `v2.2.14` 已推送（直推成功，未借道代理）。
上一轮（2.2.13）：**稳定期阶段 B 第二刀——EventProcessor 纯移动拆分**（决议 D-6 推进；零行为改动，玩法/引擎/规则一字未动）。core/EventProcessor.ts 852→93 行：类只保留唯一入口 `process`（克隆+队列循环）与 `apply`（薄 switch 分发到事件族处理器），派生事件连锁（DAMAGE→PLAYER_DEFEATED、DEATH→DRAW_REQUIRED、BASE_DAMAGE→PLAYER_DEFEATED、PLAYER_DEFEATED→GAME_OVER/回合交接）逐字移入 `eventProcessors/chainedConsequences.ts` 的 `enqueueDerivedConsequences(queue, event, before, next)`；15 个 case 处理器按族逐字移入 `eventProcessors/` 五文件——damageEvents(168 行：BASE_DAMAGE+DAMAGE，含技能伤害护甲结算与 legacy 护甲兜底)、drawEvents(178：DRAW_REQUIRED+DRAW+DRAW_CONFIRMED)、generalEvents(214：登场/移动/补给/披甲+RESOURCE_TYPES)、playerEvents(77：PLAYER_DEFEATED+GAME_OVER)、turnEvents(95：TURN_END/TURN_ACTIONS_RESET/TURN_START/PHASE_CHANGED)。纪律钉死：**唯一入口**，事件族处理器是纯 (state,event)→state 函数、仅经 EventProcessor 调用（类头注释已写入禁令）；`core/index.ts` 导出面不变。AGENTS/ARCH_MAP 行数、D-4 兜底位置指针与 D-6 进度注记同轮刷新。验证：check 0 错误 / 264 测试通过（32 文件，零增删）/ 覆盖率棘轮维持（实测 42.09/34.67/33.45/47.16 ≥ 41/34/32/46，funcs 由 32.84 升至 33.45）/ lint 0 错误 30 遗留警告（零新增）/ build 单文件成功（1,916.89 kB / gzip 562.51 kB）；结构性重构加浏览器冒烟（dev `__TK__` 直驱真实 store+引擎装配）：建房→lobby、startTestArena 后连 endTurn 四次驱动 TURN_END/TURN_START/DRAW_REQUIRED/DRAW_CONFIRMED/PHASE_CHANGED 走拆分后处理器（turn 2→5、round 进位到 2）、快照创建(4,565 字符)+恢复 true、空房号守卫与错房拒收、错误密码拒入开发者模式，应用自身控制台 0 报错（仅两条为故意投喂坏数据触发的守卫拒收日志）。CI 远端复验已完成：run `35940699193` 全绿（CI #35，master@262167f，test(22)/test(24)/lint/build 四 job 均 completed successfully）；功能提交 `6617b52`、登记提交 `262167f` 与附注标签 `v2.2.13` 已推送（直推成功，未借道代理）。
上一轮（2.2.12）：**稳定期阶段 B 第一刀——gameStore 纯移动拆分**（决议 D-6 落地开始；零行为改动，玩法/引擎/规则一字未动）。gameStore.ts 956→622 行：① 新建 `store/gameStoreTypes.ts`（135 行）承接全部 store 级类型（GamePhase/DrawContext/Position/FieldGeneral/Player/GameState），gameStore `export *` 再导出、消费方导入口径不变；② 新建 `store/gameStoreEditorActions.ts`（137 行）——开发者模式+技能/武将编辑九动作收进 `buildEditorActions(get,set)` 工厂（沿用 buildTestArenaActions 既有模式）；③ 新建 `store/gameStoreRecovery.ts`（70 行）——快照序列化/恢复三动作收进 `buildRecoveryActions(get,set)`；④ `settleDrawInTestArena`/`buildTestArenaState` 迁入 `testArenaActions.ts`（297→441 行，演练场职责聚合）。全部为逐字搬移，仅 gameStore 装配处引用新工厂；AGENTS/ARCH_MAP 行数与 D-6 进度注记同轮刷新。验证：check 0 错误 / 264 测试通过（32 文件，零增删）/ 覆盖率棘轮维持（实测 41.96/34.85/32.84/47 ≥ 41/34/32/46）/ lint 0 错误 30 遗留警告（零新增）/ build 单文件成功（1,916.39 kB / gzip 562.33 kB）；结构性重构加浏览器冒烟（dev `__TK__` 直驱真实 store 装配）：建房→lobby、编辑器存取删回环、快照创建+恢复 true、演练场进入且 endTurn 保持驻留、resetGame 保留偏好，控制台 0 错误。CI 远端复验已完成：run `35935393466` 全绿（CI #33，master@c5c82c1，3m3s，test(22)/test(24)/lint/build 四 job 均过）；功能提交 `9f8e426`、登记提交 `c5c82c1` 与附注标签 `v2.2.12` 已推送（直推超时→一次性代理成功）。
上一轮（2.2.9）：AI 对战线·阶段四"游戏内人机对战"落地（用户指示"那接下来进行阶段四吧"；复用 2.2.7 三档策略大脑，驱动层全部走生产 store 动作，人类热座规则零改动）。**架构**：AI 座位不是旁挂机器人，而是给生产链路加一个"代打司机"——`src/ai/aiTurnDriver.ts` 的 `runAiStep(state)` 每 tick 最多执行**一个** store 动作（`deployGeneral/moveGeneral/attack/supply/armGeneral/executeDraw/confirmDraw/resolvePendingDrawLoss/endTurn/aiAutoDraft/startGame/rollDice/skip` 等，均为人类按钮背后的同一批函数），因此规则校验、录像捕获（2.2.6 liveReplayRecorder）、写回、动画与人类操作逐字同路径。策略动作→store 调用按 payload 字段一一映射（DEPLOY_GENERAL {general,slot,consumeCards}→deployGeneral 等；DRAW {fromGeneralPool,fromCardPool}→executeDraw，失败即 confirmDraw 防卡窗）。**大脑按座位复用**：`seatPolicies = Map<"${playerId}:${tier}", AiPolicy>`——strategyPolicy 的抽牌窗口记账在闭包里，同一座位整局必须共用一个实例；对局边界（phase 回到 lobby）由 `resetAiControllers()` 清表。**防呆护栏**：策略零随机、可能同状态反复选出同一动作，司机对每步记 `lastChoiceKey = ${playerId}|${turn}|${type}|${JSON(payload)}`，紧邻重复→返回 null→回退（drawing 中 confirmDraw、playing 中 endTurn，两者恒合法），保证永不死循环。**UI 与装配**：`runtimeSetup.ts` 新增 `AiSeatTier/AiSeatMode/AI_TIER_KEYS/AI_TIER_LABELS/defaultSeatModes/pickAiDraftPicks`（AI 征召=势力主 7 + 群 3 固定策略，凑不满 10 回退人类界面）；`SetupPlayerSeed`/`Player` 增加 `isAi?/aiTier?` 打戳——经骰子重排 `{...player}`、引擎 structuredClone、gameStateAdapter 映射与 EnginePlayer 索引签名全程存活（测试实证）；`gameStore` 新增 `seatModes`/`setSeatMode`/`aiAutoDraft`；`CreateRoom` 新增"席位安排"区块（每座位 👤人类/🤖AI 切换 + 四档芯片，中文档名 随机/保守/均衡/激进 + 悬停提示）；`App.tsx` 挂载 `AiDirector`（700ms setInterval，`isTestMode` 直接跳过，#ai-battle 后台窗口因早退分支不挂载）；`GameBoard` 玩家栏 AI 座加 🤖、底部回合条显示"AI 出手中…"；`UnifiedDraw` 对 AI 抽牌加"🤖 …正在决定抽卡…"横幅并隐藏人类分配控件（保留结果展示链）。**全 AI 观战链**：lobby 全 AI→自动 startGame；diceRoll 全 AI→立即 rollDice+跳factionAssign+assignFactions（跳过骰子动画，真实座次照算）；generalDraft AI 座→aiAutoDraft；混战局司机对人类阶段一律不动手（测试断言 mixed lobby 2.5s 无动作）。测试 +8 → 258 例 / 32 文件（`aiTurnDriver.test.ts` 新文件：打戳与命名、pickAiDraftPicks 7+3 与短池回退、双 AI 自动征召进 drawing、人类座不动、全 AI lobby→diceRoll→factionAssign 链（vi.useFakeTimers 隔离 assignFactions 的 1500ms 定时器）、混战 lobby hands-off、**纯 runAiStep 驱动两 AI 局打到 gameOver**（约 1–2 秒/局）、人机交错：人类征召→司机代抽 AI 座→人类抽牌窗司机不碰→人类抽完→AI 回合自动出手）。验证：check 0 错误 / `npm run test` = 258 通过 / 覆盖率棘轮上调 lines 46 / funcs 32 / branches 34 / stmts 41（实测 lines 46.47 / funcs 32.33 / branches 34.55 / stmts 41.43——驱动测试跑完整局引擎对局故跳升明显）/ lint 0 错误 30 遗留警告（零新增）/ build 单文件成功（1,914.95 kB / gzip 561.72 kB）/ 浏览器 E2E 两局真实点击（经 evaluate_script 触发真实按钮，见 §12 环境注记）：①全 AI 观战"人机演武"（座位1=AI·保守, 座位2=AI·激进）——lobby 起全自动推进至 gameOver（第 8 轮，胜方 seat2 本营 [0,6]），棋盘显示"回合：AI·激进"、双座 🤖、回合条"AI·激进(蜀) — AI 出手中…"，结算窗含 2.2.6 录像保存行（默认名 人机演武-蜀-20260923-18）；②混战"人机演武2"（座位1=人类, 座位2=AI·均衡）——骰子后 AI 座自动征召（池=10）、AI 初始抽牌自动完成（手牌 5），人类抽牌窗与征召界面司机零干预（页面捕获"AI·均衡 正在决定抽卡…"），人类真实点击完成征召与回合，人类投降→gameOver 胜方"AI·均衡"；两局控制台 0 错误 0 警告（仅 vite/React info）。CI 远端复验已完成：run `35866565864` 全绿（CI #24，master@eca25d9，lint+audit / test 22 与 24 矩阵含 check+coverage / build）。诚实边界：①700ms 节奏与档位映射不是人类手感难度标定（强弱序来自 2.2.7 擂台，人机难度体感待用户回归）；②热座规则未改——AI 回合棋盘仍显示该座手牌，人类可代打（与既有热座行为一致）；③seatModes 跨房间保留（再来一局沿用上次席位设置，属特性非缺陷）；④AI 征召是固定 7+3 策略而非"聪明选人"；⑤全 AI 观战跳过骰子动画（rollDice 立即结算，座次仍真实随机）。CI 远端复验已完成：run `35866565864` 全绿（CI #24，master@eca25d9），附注标签 `v2.2.9` 指向本轮登记文档提交。
上一轮（2.2.8）：AI 对战线"势力平衡统计 + 自选势力/将领"落地（用户指示：①结束简报加每个势力的胜率、将领死亡率、击杀率，方便调整势力平衡；②AI 对战支持自选 AI 势力和将领、允许复数相同势力/将领、选定后打完指定局数前不再变更）。**统计口径（per-seat 记账，写死在 battleRunner/battleReport 注释）**：出场席=该势力在本批次占过的座位数（镜像局计两席）· 胜率=胜席/出场席 · 死亡率=阵亡/登场（登场/阵亡=场上名册新增/移除，移除**不问死因**全计）· 击杀率=击杀/攻击（击杀=己方成功 ATTACK 步内**他席**名册移除数，含反杀与攻击触发的技能死，宽口径系有意为之）。采集点：`runMatch.dispatchStep` 每个**完整接受**的步骤前后对 `snapshotFieldRoster`（名册键 instanceId 优先）做差，违例步不记账（该步即终止对局）；胜者座位 `won=1`。数据通路：`MatchResult.seatStats` → `runBatch`/`aggregateFactionStats` 聚合 `FactionBalanceStat`（规范序 魏蜀吴群晋、余者按出场数）→ `BattleSummary.factionStats` → 三处出口：`formatFactionStats` 文本行（`npm run ai-battle` 控制台 + 后台窗口完成横幅下 + 操作日志抬头"势力平衡统计"块）与 `AiBattleDock` 右下角简报 HTML 表格（势力/出场/胜率/登场·阵亡/死亡率/攻击·击杀/击杀率，仅开者模式显示）。旧形态数据（无 seatStats 的手工夹具/历史复放）→ 空数组，向后兼容不崩。**自选阵容**：`SeatConfig`/`MatchConfig.seatConfigs`（matchSetup）——每座位 势力标签（自选势力 > 自选名单首个存活将领的势力 > 种子随机）+ 将池（自选名单**原样**为将池、可重复；否则从该势力池内抽满 poolPerPlayer）；**行为变化**：默认（不选座位）也改为"势力纯化抽池"——旧 2.2.4 跨势力混抽每座位可能多势力并存，现每座位一色，同种子历史对局结果因此改变，属接受范围（用户需求的自然延伸）。重复合法：同势力可占多座、同名将领可多份（克隆后 id 带 `_pN` 后缀 + 种子打戳互不冲突）。哈希契约：`battleHash` 扩 `seats=魏:wei_001,wei_001|蜀|`（`|` 分隔座位、`:` 后逗号名单），解析非法势力→''（=随机）、id 透传由装配层过滤、长度钉到 players；`encodeSeats` 为其逆函数。**整批锁定**由机制天然保证：配置弹窗"开始对战"一次性编码进 URL，后台窗口只在加载期读一次哈希。UI：`AiBattleConfig` 弹窗新增"每个座位的势力 / 阵容（可选 · 允许重复 · 选定后整批锁定）"区块——每座位 势力下拉（随机势力+五势力，切换势力清空已选将）+ "＋添加将领…"下拉（选项按该座位势力过滤为势力内武将）+ 已选将领 chips（单个 ✖ 移除 / 一键"清空回到该势力整池随机抽"），仅当至少一个座位有选择时才写入 `seats` 参数；`AiBattleWindow` 配置行新增"阵容：座位N=势力（自选：名单）/（整池随机抽）（整批锁定不变）"。引擎数据面：`EnginePlayer.faction?`（string 保持数据无关性）、`data/generals.ts` 新增 `allFactions` 规范序。测试 +15 → 250 例 / 31 文件（`matchSetup.test.ts` 新文件 7 例：势力纯化默认、同种子确定性、显式势力+重复势力合法、空/非法势力视为未选、自选名单原样成池含重复项、名单无势力时标签取首个存活将、池小于需求回绕成重复；`battleRunner.test.ts` seatStats 自洽例：激进镜像局 deaths≤deployed、kills≤他席阵亡、attacks 合计=ATTACK 步数、恰好一个 won、同种子两跑统计全同；`battleReport.test.ts` 聚合口径/零分母'-'/日志块有与无/seats 解析钳制/encodeSeats 往返；`AiBattleDock.test.tsx` 新文件 3 例：真实形状 payload→表格三率渲染、非开发者模式隐藏、无 factionStats 旧形态无表不崩）。验证：check 0 错误 / `npm run test` = 250 通过 / 覆盖率棘轮上调 lines 42 / funcs 28 / branches 31 / stmts 37（实测 lines 42.88 / funcs 29.01 / branches 31.93 / stmts 38.1）/ lint 0 错误 30 遗留警告（零新增）/ build 单文件成功（1,908.49 kB / gzip 559.62 kB）/ 浏览器 E2E（真实点击，开发者模式经用户提供的密码解锁——密码不入档）：弹窗内座位1 选魏+自选"曹操、曹操"、座位2 选蜀，生成 URL `…&policies=aggressive,random&seats=%E9%AD%8F%3Awei_001%2Cwei_001%7C%E8%9C%80`，后台窗口真跑 20 局：配置行显示"阵容：座位1=魏（自选：曹操、曹操） · 座位2=蜀（整池随机抽）（整批锁定不变）"，完成横幅势力平衡两行（魏 胜率 100.0%/死亡率 13.0%/击杀率 31.8%；蜀 0.0%/100.0%/15.0%）。**行为改动后全量重 soak（硬门槛零违例）**：`npm run ai-battle` 2000 局 0 违例，五势力胜率 48.0–51.1%（魏 51.1/蜀 49.9/吴 48.0/群 50.1/晋 51.0）、死亡率 65.3–72.3%、击杀率 5.1–13.6%——势力平衡基线首次可用；擂台复跑 aggressive vs balanced 300 局 66.3/33.7、四人混战 150 局 51.3/43.3/0.7/0.0，强弱序 激进>均衡>保守>随机 在纯化池下仍成立、0 违例；自选阵容专项 soak 350 局 0 违例（魏名单 vs 蜀 200 局、4 人三座位同吴+跨势力名单 150 局、60 局三人座位统计自洽、旧形态兼容），镜像计数实证：三座位同势力行显示"出场450席"。soak 中一处疑点如实记录：seed 44001 座位统计全 0——查证为合法对局（随机策略 16 步内直接两次 SURRENDER 分出胜负、无人登场），非缺陷，专项断言改为"零登场必须伴随投降"。CI 远端复验已完成：run `35843848131` 全绿（CI #22，master@71bbad4，lint+audit / test 22 与 24 矩阵含 check+coverage / build）。诚实边界：①统计是跑器批次（AI-vs-AI）视角，与人类对局 UI 无关；三率口径宽（击杀含反杀与攻击触发技能死），跨轮次对比须按本口径；②E2E 那 20 局的 100%/0% 是小样本+曹操×2 自选阵容对阵随机策略的结果，**不是**势力平衡结论，平衡判断以 2000 局 soak 区间为准；③简报 dock 的父子窗口真实弹窗链路在本自动化浏览器仍无法端到端复验（弹窗塌缩回同页），其表格渲染以与真实回传同形状的 payload 走组件测试覆盖；④势力纯化改变了默认装配，旧种子档案（如 2.2.4 登记的复现种子）不再逐字可比。另：2.2.7 诚实边界③（策略下拉未做真机弹窗点击）本轮随开发者模式解锁一并关闭——座位策略下拉已真机选择并确认落入 URL 与后台窗口显示行。
上一轮（2.2.7）：AI 对战线·阶段三"三档策略 AI + 擂台互胜率"落地（用户指示"进行阶段三吧"；沿用 2.2.4 跑器与 2.2.3 枚举器，策略可换装而跑器零改动）。新增 `src/ai/policies/strategyPolicy.ts`：三档策略（保守 conservative／均衡 balanced／激进 aggressive）共用同一"看一步"评估骨架——对 `engine.legalActions` 每个候选在全新一次性引擎（`recordHistory:false`，dispatch 为函数式、不污染调用方状态）上试探执行，再用零和静态估值函数 `evaluateState`（本营血/场上将/阵亡将/护甲/位置价值/抽牌预期按档位权重打分，本营濒危 +100 惩罚挂账）取 argmax；同分取枚举序号最小者，**策略不消耗任何随机数**（同种子跨档位可比）。档位权重：保守重自家本营与保全（ownBase 4 / enemyBase 1.5），均衡攻守居中（3/2.5），激进重打击推进（ownBase 3 / enemyBase 4 / position 1.6）。两处开发期抓到的系统性事实并已固化：①引擎 DRAW 动作**不关闭抽牌窗口**（phase 停在 drawing、totalCards 不递减直到 CONFIRM_DRAW）——无状态 argmax 会永远重挑最优拆法导致死循环抽牌，修复=policy 闭包内按 `${reason}:${playerId}:${turn}` 记账，每窗口只抽一次随即 CONFIRM；②激进档纯抽卡会导致手里永远没有将领可登场（整局零 DEPLOY/ATTACK），修复=抽牌拆分加入稀缺上下文（场上 0 将→将领权重×2、资源卡≥4→卡牌权重×0.4）。跑器与擂台：`battleRunner.RunOptions` 新增 `seatPolicies?: AiPolicy[]`（按座位索引，缺省回退 `options.policy`）；新增 `src/ai/arena.ts`（`runDuelSeries` 每局**交换座位**抵消先手偏置、`runFreeForAll` 2-4 家、`runRoundRobin` 全对阵、`formatArenaSummary`）与 `src/ai/arenaCli.ts`（`npm run ai-arena`，默认四键含随机基线，**任何违例 exit 1**——擂台同时是策略路径的规则 soak）。游戏内入口：`battleHash` 契约扩 `policies`（逗号分隔，非法键过滤、缺位补 random、长度钉到 players）；`AiBattleConfig` 弹窗新增"每个座位的 AI 策略"下拉（默认座位1激进、其余随机），`AiBattleWindow` 把 policies 映射为 seatPolicies 并在配置行显示"策略：座位N=…"。引擎真 bug 一枚（由策略对局首次暴露、不变量哨兵抓获）：`DeployGeneralResolver` 的 CAMP_SLOT_OCCUPIED 只扫**登场者自己**的 fieldGenerals——敌方入侵将领驻在我方营地格时存在于入侵者自己的记录里，登记不可见→两将同格（seed 902 camp|2|2、seed 7 camp|3|0 实锤复现）。MOVE 侧（findAvailableSlot/allFieldGenerals）与规则层 battlefieldRules 本就是全局扫描，DEPLOY 是唯一漏网者。修复=登场占位检查改为全玩家扫描（新增回归测试：入侵者占据我营地 0 格时 DEPLOY 到该格被拒、换空格放行）；两个旧违例种子修复后分别 202/141 步正常分出胜负零违例。测试 +16 → 235 例 / 29 文件（strategyPolicy 专测：档位取向对局、确定性、抽牌窗口两步收敛、本营濒危计分、策略座位跑器零违例、policyByName 中文档位名；arena 专测：duel/ffa/round-robin/未知键抛错/格式化；battleHash policies 解析钉长与过滤）。验证：check 0 错误 / `npm run test` = 235 通过 / 覆盖率棘轮上调 lines 40 / funcs 27 / branches 30 / stmts 36（实测 lines 41.83 / funcs 28.09 / branches 31.36 / stmts 37.11）/ lint 0 错误 30 遗留警告（零新增）/ build 单文件成功（1,900.95 kB / gzip 556.58 kB）/ 浏览器 E2E（真实导航）：`#ai-battle` 带 policies=aggressive,balanced,conservative 真跑 3 局——配置行显示"座位1=激进·座位2=均衡·座位3=保守"、3 局全部获胜、违例 0。擂台数字（硬门槛零违例达成）：主 soak 每对 500 局（seed 777 起、座位轮换）共 3000 局**违例 0**——激进 vs 均衡 66.4%/33.6%、激进 vs 保守 100%、激进 vs 随机 100%、均衡 vs 保守 100%、均衡 vs 随机 100%、保守 vs 随机 100%（强弱序 激进>均衡>保守>随机 完全成立）；四人混战 200 局（seed 555）违例 0，胜率 激进 54.5% > 均衡 37.0% > 保守 4.0% > 随机 0%（步数耗尽 9 局属混战长局正常）；激进镜像互搏 200 局（seed 9000）违例 0。CI 远端复验已完成：run `35829214827` 全绿（CI #20，master@7c7d111）。诚实边界：①档位强弱只在当前估值权重与规则版本下成立，非人类手感难度标定（阶段四人机对战再做映射）；②策略仅消费 legalActions，主动技能询问窗口（§12-9c）缺席下 AI 与人类同限制；③主菜单弹窗内新增的策略下拉控件本轮经哈希链路+单测覆盖，真机弹窗内选择属开发者模式密码保护路径未做浏览器点击复验（2.2.5 已验证同一弹窗骨架）。
上一轮（2.2.6）：录像与操作日志的"对局结束保存体系"落地（用户指示：既然网页不能直接打开电脑文件夹，改为——所有模式的对局结束结算窗口下方新增"是否保存录像"询问，左侧可直接重命名、右侧保存按钮；设置页新增"录像保存路径"与"每局自动保存录像"选项，开启后每局结束自动保存导出；录像默认命名=房间名+玩家势力+年月日时缩写；操作日志另外保存在独立子文件夹且默认自动保存，命名同格式）。核心：`src/replay/liveReplayRecorder.ts` 现场录像捕获器——生产链路每次 dispatch 新建引擎（engineExecutionBridge），单局录像必须由这个**唯一长生命周期记录器**承接：`dispatchStoreAction`（所有模式动作的唯一收口点）每步投喂一条，条目只存 afterState、beforeState 沿上一步链式衔接（克隆减半），初始 BEGIN_DRAW 永远重开文档（新对局绝不可能继承上一局历史），createRoom/resetGame/restoreEngineState（存档恢复后从恢复点重新捕获）/startTestArena 四处显式清零。数据形态=既有 canonical `ReplayDocument`（ReplayRecorder.serialize/deserialize/ReplayPlayer 工具链直接兼容）。`replayNaming.ts`：默认名 `房间名-势力-yyyyMMdd-HH`（如 桃园结义-蜀-20260923-14）+ 文件名非法字符清洗 + 子文件夹常量（录像→「录像」、日志→「操作日志」，均在所选目录下）。`gameplayLog.ts`：ReplayDocument→中文操作日志（抬头含房间/玩家势力/胜负结果，逐步复用 ai/battleReport.formatActionLine，ACTION_REJECTED 步整行 ❌ 标注附拒绝码与原因）。`replayStorage.ts`：目录句柄存 IndexedDB（localStorage 存不了句柄）、开关与目录名存 localStorage；保存优先写入已授权目录的对应子文件夹，未选择/浏览器重启未再授权/写入失败→自动降级为浏览器下载；queryPermission 非侵入检查（不打扰用户）。UI：`GameOverScreen` 结算窗口下方新增保存询问卡（左"录像名称"输入框预填默认名、右"保存"按钮、无录像数据时禁用；挂载时执行自动保存——日志默认开、录像按开关，📥 行展示自动保存结果，💾 行展示手动结果；StrictMode 双挂载 ref 守卫每局只自动存一次）；设置页新增"录像与日志"组（路径选择/清除按钮+默认文案"未选择（保存时走浏览器下载）"、每局自动保存录像开关（默认关）、自动保存操作日志开关（默认开）、prompt 态重新授权提示、能力边界说明）；`main.tsx` 仅 dev 构建暴露 `window.__TK__`（store+捕获器）供 E2E 装配结算态，生产 bundle 由 import.meta.env.DEV 分支整体消除，并补 `src/vite-env.d.ts`（vite/client 类型，tsconfig types:["node"] 下 import.meta.env 需要显式 reference）。测试 +14（replayNaming 5/liveReplayRecorder 3/gameplayLog 2/replayStorage 3/桥接接线 1）→ 219 例 / 27 文件。验证：check 0 错误 / `npm run test` = 219 通过 / 覆盖率棘轮不动实测 lines 40.3 / funcs 26.67 / branches 29.91 / stmts 35.51 通过 / lint 0 错误 30 遗留警告（零新增）/ build 单文件成功（1,896.11 kB / gzip 554.52 kB）/ 浏览器 E2E（真实操作）：设置页"录像与日志"组渲染与默认态（录像自动保存关/日志开）→ 开关切换并确认 localStorage 持久化 → 开发者解锁 → 结算窗口经 dev 钩子装配真实捕获数据：默认名 `E2E结算房-蜀-20260923-13` 正确、自动保存两行提示出现、改名"自定义测试录像名"后手动保存成功显示下载提示。诚实边界：①浏览器安全模型不允许"手输路径直写磁盘/打开文件夹窗口"，路径=选一次真实文件夹（句柄持久化），重启后可能需浏览器再授权（UI 有提示），无路径时等价降级为下载；②测试场沙盒按既有口径把 phase 钉在 testArena（投降不跳结算窗），结算 E2E 走 dev 钩子装配而非沙盒投降；③多文件连发下载在部分浏览器会弹"允许下载多个文件"授权，属浏览器行为。CI 远端复验已完成：run `35822419623` 全绿（CI #18，master@6d82741）。
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
- 2.2.10（本地会话内验证）：录像/日志自动保存治本改造（v2.2.6 重投根因的产品侧根治，用户指示"按治本方式做吧"）。`npm run check` = 0 错误；`npm run test` = 264 通过（32 文件，+6：`replayStorage.test.ts` 暂存队列——granted 静默写目录且不 requestPermission、prompt 态只暂存零下载、授权后下一次保存自动补存（本次文件先/暂存后）、手动保存保留下载兜底且不清暂存、无目录 flush=0、队列封顶 12 丢最旧、无 API 环境 unattended 不下载）；`npm run test:coverage` 棘轮维持 lines>=46 / functions>=32 / branches>=34 / statements>=41（实测 46.73/32.54/34.49/41.72）通过；`npm run lint` = 0 错误 / 30 条遗留警告（零新增）；`vite build` 单文件成功（1,916.32 kB / gzip 562.27 kB）；浏览器 E2E（dev 页 `__TK__` 装配真实捕获数据 + 锚点下载探针）：自动保存场景 dl=0（零下载尝试=不可能弹"另存为"）、结算横幅显示"已暂存"文案；手动"保存"dl=1 且状态行确认下载兜底完好；控制台 0 错误。功能提交 `babb57b`；诚实边界：暂存队列仅内存（刷新即失）、用户浏览器"下载前询问"设置仍影响**手动**下载。CI 远端复验已完成：run `35880374035` 全绿（CI #26，master@b005cb6，264/264），附注标签 `v2.2.10` 指向登记提交 d15eb61，四提交+标签均已推送（用户开代理后一次性直推成功）。
- 2.2.20（本地会话内验证）：稳定期阶段 E 首刀（决议 D-1）——TransitionCore 唯一纯转移抽出 + 常驻 vs 重建三路对账 + ReplayPlayer 技能注册修复。`npm run check` = 0 错误；`npm run test` = 294 通过（37 文件，+3：transitionEquivalence 常驻/重建/录像回放三路对账，含技能击杀链与拒绝步）；`npm run test:coverage` 棘轮维持 42/34/34/47（实测 stmts 43.04 / branch 35.54 / funcs 34.55 / lines 48.11，四项均较 2.2.19 微升）通过；`npm run lint` = 0 错误 / 30 条遗留警告（零新增）；`vite build` 单文件成功（1,919.03 kB / gzip 563.48 kB）；`npm run ai-battle -- --games 300 --seed 1` 胜席分布 {1:109,2:191} 与 2.2.19 基线逐字一致（won=300、VIOLATIONS=0）。改动面：新增 core/TransitionCore.ts（97 行，校验→解析→触发链→结算→有界重入逐字移入，MAX_TRIGGER_REENTRY_ROUNDS 随迁）；GameEngine.dispatch 降为薄容器（transition + 打戳发射/STATE_CHANGED/录像与快照侧效应）；ReplayPlayer 每步 dispatch 前 syncPlayerSkills（本轮唯一行为变化，无 UI 消费方）。浏览器真机 E2E（dev 5199 人机对战房）：登场庞德→前进 front:0→结束回合→AI 完整回合（抽卡+登场邓艾+前进+结束）→第 2 轮抽卡确认→远程攻击选卡高亮，console 0 错误；一段登场无响应查明为测试驱动污染 UI 局部态（evaluate 直驱探针实证引擎接受），非回归。CI 远端复验已完成：run `35995323024` 全绿（CI #52，master@ee761ba，feat `518bb6f`+docs `ee761ba`+tag `v2.2.20` 一次推送；直连超时→一次性代理成功；test(22)/test(24)/lint/build 四 job 均 completed successfully）。
- 2.2.19（本地会话内验证）：稳定期阶段 D 第二刀（决议 D-2 之 b/c/d）——建局随机入 rngState 游标、id 确定性化、withSeededRandom 退役 + lockstep 清理。`npm run check` = 0 错误；`npm run test` = 291 通过（36 文件，净 +4：setupDeterminism 3 新建 / battleRunner 无补丁全局局 1 新建，另 matchSetup/DrawResolver/battleRunner 既有例断言收紧持平）；`npm run test:coverage` 棘轮上调 functions 33→34（实测 42.61-42.81 / branch 35.19-35.54 / funcs 34.26-34.45 / lines 47.59-47.84；branch 地板留 34 防抖动，与 2.2.17 同一处置）通过；`npm run lint` = 0 错误 / 30 条遗留警告（零新增）；`vite build` 单文件成功（1,918.71 kB / gzip 563.39 kB）；`npm run ai-battle -- --games 300 --seed 1` 两遍输出内容逐字一致（won=300、VIOLATIONS=0、胜席分布 {1:109,2:191}）。行为变化披露：AI 对战 seed→胜负分布较 2.2.18 基线 {1:112,2:188} 改变（装配流拆分所致，规则语义不变），平衡观测台历史需重锚。改动面：runtimeSetup 四函数+createCardDeck 加 random 注入参；gameStore 建局五步走 setupCursor/commitSetup；createAction id 计数器化、createRuntimeInstanceId 纯计数器化、matchSetup 卡与技能统一种子盖戳；删除 src/ai/rng.ts；matchSetup 装配流（seed^0x9e3779b9）、battleRunner 策略流（seed^0x85ebca6b，AiPolicy 可选第三参注入）、复放不咨询策略改 createAction 重建。浏览器真机 E2E（§12-16 欠账销案，dev 5199 人机对战 2 人房）：建房→骰子 9/8→势力→征召 10 将→回合 1 抽牌面 2 将领+3 卡盖→确认→playing，console 0 错误；视口隐藏故以 evaluate_script 派发真实 DOM 点击（React 真实处理器）+ 骰子测试限流补丁，属测试环境行为。CI 远端复验已完成：run `35984979124` 全绿（CI #50，master@8646a05，feat `086ff39`+docs `8646a05`+tag `v2.2.19` 一次推送；直连超时→一次性代理成功；test(22)/test(24)/lint/build 四 job 均 completed successfully）。
- 2.2.18（本地会话内验证）：稳定期阶段 D 首刀（决议 D-2 主件）——引擎随机进 EngineState.rngState。`npm run check` = 0 错误；`npm run test` = 287 通过（35 文件，净 +19：rng 8 / drawEvents 8 / executeDraw.rng 3 / DrawResolver 重写持平）；`npm run test:coverage` 棘轮维持 42/34/33/47（实测 42.55/35.14/34.01/47.55，四项实测均较 2.2.17 微升）通过；`npm run lint` = 0 错误 / 30 条遗留警告（零新增）；`vite build` 单文件成功（1,918.75 kB / gzip 563.32 kB）；`npm run ai-battle -- --games 300 --seed 1` 两轮结果完全一致（won=300、VIOLATIONS=0、胜席 {1:112,2:188}）。改动面：core/rng.ts 新增、EngineState.rngState 可选字段、DrawResolver 收敛为纯校验+计数事件（Math.random 归零，抛错探针钉死）、applyDrawEvent 成唯一选牌点（种子洗牌/重洗+游标写回+旧档惰性兜底种子）、gameStateAdapter 建房播种一次、matchSetup 按 seed 播 rngState、ai/rng.ts 头注收窄口径。零版本号变更（存档/录像/网络快照版本全不动）。行为变化披露：抽牌结果分布与旧版不同（D-2 预期内），牌堆顶序/补偿抽/UI 明牌零变化。浏览器 E2E 本轮未做：自动化权限分类器拒绝页面导航（等效验证=vitest 生产 store 链路），真机面 PENDING（§12-16）。CI 远端复验已完成（含一次真实失败）：docs 提交 265d225 首跑 #46（run 35974231930）因测试文件未使用导入 TS6133 在 check 步骤失败（本地 check 为陈旧运行未兜住，教训：验证须在全部文件定稿后）；修复提交 620a0a0 后 #47（run 35975699142）test(22)/test(24)/lint/build 四 job 全绿；标签 v2.2.18 经用户授权强制重指至 620a0a0；推送直连超时→一次性代理成功。
- 2.2.17（本地会话内验证）：稳定期阶段 C 首刀（旧 §12-9 b/d 销案，c 维持 PENDING）——技能覆盖面补齐。`npm run check` = 0 错误；`npm run test` = 268 通过（32 文件，+4 管线例 +1 编译器改写例）；`npm run test:coverage` 棘轮上调 statements>=42 / branches>=34 / functions>=33 / lines>=47（实测 42.46/35.11/33.85/47.49；branch 抖动 35.11–35.28 故地板保守）通过；`npm run lint` = 0 错误 / 30 条遗留警告（零新增）；`vite build` 单文件成功（1,918.69 kB / gzip 563.24 kB）；`npm run ai-battle -- --games 300 --seed 1` VIOLATIONS=0（won=300、均值 19ms）。改动面：Event.ts +HEAL/GAIN_ARMOR 事件、generalEvents +两纯处理器、EventProcessor +collected 追加收集参、chainedConsequences 技能击杀派生 DEATH（damageType 门与普攻击杀去重）、GameEngine 有界重入回合（≤8 轮、TRIGGER_REENTRY_LIMIT 哨兵）、SkillTriggerBridge 两效果真实事件化、skillCompiler/skillExcelFormat 结算面同步四类型。浏览器 E2E（dev 5203 store 直驱）：疗愈/固甲经真实 endTurn 实测（hp 封顶+护甲点数）、技能击杀链经真实 attackTarget 实测（墓地/遗志/枭斩/补偿抽窗/回合权恢复全对）、控制台 0 错误；截图受后台 viewport 限制未产出（快照代替，如实登记）。CI 远端复验已完成：run `35965467286` 全绿（CI #44，master@926a530，test(22)/test(24)/lint/build 四 job 均 completed successfully）；feat `37fecc1` + docs `926a530` + tag `v2.2.17` 直推成功，未借道代理。
- 2.2.16（本地会话内验证）：稳定期 F 序列最后一刀——TestArena 纯移动拆分，D-6 三大 UI 文件收线（零行为改动）。`npm run check` = 0 错误；`npm run test` = 264 通过（32 文件，零增删）；`npm run test:coverage` 棘轮维持 41/34/32/46（实测 41.90/34.49/33.33/46.93，与 2.2.15 完全持平）通过；`npm run lint` = 0 错误 / 30 条遗留警告（零新增）；`vite build` 单文件成功（1,916.59 kB / gzip 562.85 kB）；浏览器真实点击回归（dev 5204，startTestArena 4 人局，全走拆分后 compactPrimitives 实例）：将领池搜索抽廖化入手牌→手牌 inspect SC×4→登场 Bar+Btn（0/4 禁用→选满 4 张消耗→确认→deployTarget Bar→点绿框营地格落子）→场上 inspect SC 实时值+本回合计数行+近战/远程/补给禁用态→前进单目标直连 front:0→Dev 面板"场上"伤害 3/4 触发命中动画→补给 Bar（已选 0 张确认禁用→选 1 张军粮→确认回 4/4）→计数行移动 1/补给 1→玩家切换→结束回合→✕ 退出归 menu；控制台 0 错误 0 警告。结构：TestArena.tsx 485→483 行，新文件 components/testArena/compactPrimitives.tsx（10 行，SC/Bar/Btn 逐字外移）；Slot/BSlot/Territory*/Dev 面板/动作处理器因闭包依赖状态留守；与棋盘版 gameBoard/uiPrimitives 同名但为紧凑 CSS 变体，刻意不合并（合并=改样式=行为变化），文件头注释钉死、统一需单独立项做视觉回归。CI 远端复验已完成：run `35952936795` 全绿（CI #42，master@3b3bf36，test(22)/test(24)/lint/build 四 job 均 completed successfully）；功能提交 `35880e0`、登记提交 `3b3bf36` 与附注标签 `v2.2.16` 已推送（直推成功，未借道代理）。
- 2.2.15（本地会话内验证）：稳定期 F 序列第二刀——GameBoard 纯移动拆分（决议 D-6 后三件之二；零行为改动）。`npm run check` = 0 错误；`npm run test` = 264 通过（32 文件，零增删）；`npm run test:coverage` 棘轮维持 lines>=46 / functions>=32 / branches>=34 / statements>=41（实测 41.90/34.49/33.33/46.93，较上轮微降系新文件头注释摊薄）通过；`npm run lint` = 0 错误 / 30 条遗留警告（零新增）；`vite build` 单文件成功（1,916.59 kB / gzip 562.86 kB）；浏览器真实点击回归（dev 5203，全走拆分后组件实例）：正式建房→征召→抽牌（含 2 武将）→playing；将领池/抽牌堆弹窗 StatPill 计数正确、弃牌堆/墓地空态、手牌与场面武将 inspect 五张 SC、登场 Bar+Btn（禁用→选满 4 张消耗→确认→deployTarget→点营地格落子）、前进单目标直连移动、⏸️菜单保存对局/返回/重置，控制台 0 错误。结构：GameBoard.tsx 704→689 行，新文件 components/gameBoard/uiPrimitives.tsx（21 行，SC/StatPill/Bar/Btn/Modal 逐字外移+聚合 export 一行）；Slot/BSlot/Territory*/动作处理器因闭包依赖状态留守（继续拆分需解闭包、单独立项）。CI 远端复验已完成：run `35948875546` 全绿（CI #39，master@ab78fd0，test(22)/test(24)/lint/build 四 job 均 completed successfully）；功能提交 `5ba8a53`、登记提交 `ab78fd0` 与附注标签 `v2.2.15` 已推送（直连超时后一次性借道本地代理成功，未写持久配置）。
- 2.2.14（本地会话内验证）：稳定期 F 序列第一刀——SkillEditor 纯移动拆分（决议 D-6 后三件之首；零行为改动）。`npm run check` = 0 错误；`npm run test` = 264 通过（32 文件，零增删）；`npm run test:coverage` 棘轮维持 lines>=46 / functions>=32 / branches>=34 / statements>=41（实测 42.09/34.67/33.45/47.16，与上轮持平）通过；`npm run lint` = 0 错误 / 30 条遗留警告（零新增）；`vite build` 单文件成功（1,916.59 kB / gzip 562.85 kB）；浏览器真实点击回归（dev 5202，全走拆分后组件实例）：编辑器挂载、95 将列表、TriggerEditor 类型→子下拉→预览→保存→store 含 damageSubType→批删还原、多效果→RuntimeEditor 类型/数值/目标→预览、真实 .xlsx 经文件输入走拆分后解析器导入成功并落库、导出成功、控制台 0 错误。结构：SkillEditor.tsx 1253→868 行，新目录 components/skillEditor/ 三文件（skillExcelParsers 228 / TriggerEditor 106 / RuntimeEditor 78），微改仅类型层面（SkillEditEntry 接口、export 关键字、去缩进、import 收窄）。CI 远端复验已完成：run `35944672735` 全绿（CI #37，master@f3e295c，test(22)/test(24)/lint/build 四 job 均 completed successfully）；功能提交 `0580e08`、登记提交 `f3e295c` 与附注标签 `v2.2.14` 已推送（直推成功，未借道代理）。
- 2.2.13（本地会话内验证）：稳定期阶段 B 第二刀——EventProcessor 纯移动拆分（决议 D-6；零行为改动，唯一入口纪律保持）。`npm run check` = 0 错误；`npm run test` = 264 通过（32 文件，零增删）；`npm run test:coverage` 棘轮维持 lines>=46 / functions>=32 / branches>=34 / statements>=41（实测 stmts 42.09 / branch 34.67 / funcs 33.45 / lines 47.16）通过；`npm run lint` = 0 错误 / 30 条遗留警告（零新增）；`vite build` 单文件成功（1,916.89 kB / gzip 562.51 kB）；浏览器冒烟（dev `__TK__` 直驱真实 store+引擎装配）：createRoom→lobby、startTestArena 连 endTurn×4 驱动 TURN_END/TURN_START/DRAW_REQUIRED/DRAW_CONFIRMED/PHASE_CHANGED 走拆分后处理器（turn 2→5、round 进位 2）、createSerializedSnapshot('EP-Room-1')(4,565 字符)+restore=true、错房号 restore=false、空房号创建抛既有守卫错、错误密码 toggleDeveloperMode=false；应用 0 意外报错（两条 error 日志均为故意投喂坏数据的守卫拒收演示）。结构：core/EventProcessor.ts 852→93（process 队列循环+apply 薄分发+单入口禁令注释），新目录 core/eventProcessors/ 六文件（damageEvents 168 / drawEvents 178 / generalEvents 214 / playerEvents 77 / turnEvents 95 / chainedConsequences 112），D-4 兜底位置随迁至 damageEvents.ts:151。CI 远端复验已完成：run `35940699193` 全绿（CI #35，master@262167f，test(22)/test(24)/lint/build 四 job 均 completed successfully）；功能提交 `6617b52`、登记提交 `262167f` 与附注标签 `v2.2.13` 已推送（直推成功，未借道代理）。
- 2.2.12（本地会话内验证）：稳定期阶段 B 第一刀——gameStore 纯移动拆分（决议 D-6；零行为改动）。`npm run check` = 0 错误；`npm run test` = 264 通过（32 文件，零增删）；`npm run test:coverage` 棘轮维持 lines>=46 / functions>=32 / branches>=34 / statements>=41（实测 47/32.84/34.85/41.96）通过；`npm run lint` = 0 错误 / 30 条遗留警告（零新增）；`vite build` 单文件成功（1,916.39 kB / gzip 562.33 kB）；浏览器冒烟（dev `__TK__` 直驱拆分后的真实 store 装配）：createRoom→lobby、toggleDeveloperMode/updateSkillEdit/getGeneralWithEdits/batchDeleteEdits 存取删回环、createSerializedSnapshot(5326 字符)+restoreSerializedSnapshot=true、startTestArena 后 endTurn 保持驻留 testArena、resetGame 回 menu 且偏好保留；控制台 0 错误。结构：gameStore.ts 956→622 行，新文件 gameStoreTypes.ts(135)/gameStoreEditorActions.ts(137)/gameStoreRecovery.ts(70)，testArenaActions.ts 297→441（吸收 buildTestArenaState）。CI 远端复验已完成：run `35935393466` 全绿（CI #33，master@c5c82c1，3m3s，test(22)/test(24)/lint/build 四 job 均 completed successfully）；功能提交 `9f8e426`、登记提交 `c5c82c1` 与附注标签 `v2.2.12` 已推送（直推超时→一次性代理成功）。
- 2.2.11（本地会话内验证）：纯文档/契约冻结版（外部架构评审共识落地，见 §12-15；无行为改动，不需 E2E）。`npm run check` = 0 错误；`npm run test` = 264 通过（32 文件，本轮零增删）；`npm run test:coverage` 棘轮维持 lines>=46 / functions>=32 / branches>=34 / statements>=41 通过；`npm run lint` = 0 错误 / 30 条遗留警告（零新增）；`vite build` 单文件成功（1,916.32 kB / gzip 562.27 kB）。落地：README/AGENTS/CHANGELOG 漂移修正（264/32、删 card//status/ 幽灵模块、行数与阈值与警告数刷新、CHANGELOG 补 2.0.1→2.2.10 年表并更正 start.bat 失实记载）、新建 `PROJECT_ARCH_MAP.md`、`legalActions.ts` 契约措辞钉准（候选枚举）、`PROJECT_RELEASE_PIPELINE.md` 铁律第四项（五文档登记纪律）。CI 远端复验已完成：run `35894015044` 全绿（CI #31，master@95f13ab，3m31s，test(22)/test(24) 双矩阵各 32 文件 264/264 通过，lint、build 均过）；功能提交 `cc49efb`、登记提交 `95f13ab` 与附注标签 `v2.2.11` 均已直推成功。
- 2.2.9（本地会话内验证）：AI 对战线·阶段四"游戏内人机对战"。`npm run check` = 0 错误；`npm run test` = 258 通过（32 文件，+8：`src/ai/aiTurnDriver.test.ts`——席位打戳与命名、AI 征召 7+3 与短池回退、双 AI 自动征召进抽牌、人类座不动、全 AI lobby→diceRoll→factionAssign 链（fake timers 隔离 assignFactions 1500ms 定时器）、混战 lobby hands-off、**纯 runAiStep 驱动两 AI 局打到 gameOver**、人机交错全流程）；`npm run test:coverage` 棘轮上调 lines>=46 / functions>=32 / branches>=34 / statements>=41（实测 46.47/32.33/34.55/41.43）通过；`npm run lint` = 0 错误 / 30 条遗留警告（零新增）；`vite build` 单文件成功（1,914.95 kB / gzip 561.72 kB）；浏览器 E2E 两局真实点击：全 AI 观战（保守 vs 激进）lobby 起全自动至 gameOver（第 8 轮胜方 AI·激进、结算窗录像默认名 人机演武-蜀-20260923-18）；混战（人类 vs AI·均衡）——AI 座自动征召/自动初始抽牌、人类界面司机零干预、人类投降判负；两局控制台 0 错误。诚实边界：700ms 节奏非难度标定、热座下 AI 回合人类可代打（既有行为）、AI 征召固定 7+3、全 AI 观战跳过骰子动画。CI 远端复验已完成：run `35866565864` 全绿（CI #24，master@eca25d9，lint+audit / test 22 与 24 矩阵含 check+coverage / build），附注标签 `v2.2.9` 指向本轮登记文档提交。
- 2.2.7（本地会话内验证）：`npm run check` = 0 错误；`npm run test` = 235 通过（29 文件，+16：`src/ai/policies/strategyPolicy.test.ts`——档位取向（激进选攻击/保守选补给）、逐着合法性、确定性、抽牌窗口"抽一次即确认"收敛、本营濒危计分、策略座位跑器零违例、policyByName 中文名；`src/ai/arena.test.ts`——duel 座位轮换/ffa/round-robin 键名/未知键抛错/格式化；`battleReport.test.ts` policies 哈希契约 3 例增改）；`npm run ai-arena` 擂台 soak：每对 500 局×6 对（seed 777 起）+ 四人混战 200 局（seed 555）+ 激进镜像 200 局（seed 9000），**合计 3400 局违例 0**；强弱序 激进>均衡>保守>随机 成立（duel：激进 vs 均衡 66.4%，其余跨档对局 100%；ffa：54.5/37.0/4.0/0.0）；引擎修复：`DeployGeneralResolver` 营地占位检查改全玩家扫描（修复策略对局暴露的"入侵者占格仍可登场"POSITION_CONFLICT 真 bug，附回归测试）；`npm run test:coverage` 棘轮上调 lines>=40 / functions>=27 / branches>=30 / statements>=36（实测 41.83/28.09/31.36/37.11）通过；`npm run lint` = 0 错误 / 30 条遗留警告（零新增）；`vite build` 单文件成功（1,900.95 kB / gzip 556.58 kB）；浏览器 E2E：`#ai-battle?policies=aggressive,balanced,conservative` 真跑 3 局全胜零违例、配置行策略标注正确。CI 远端复验已完成：run `35829214827` 全绿（CI #20，master@7c7d111，lint+audit / test 22 与 24 矩阵含 check+coverage / build），附注标签 `v2.2.7` 指向本条登记文档提交。
- 2.2.8（本地会话内验证）：`npm run check` = 0 错误；`npm run test` = 250 通过（31 文件，+15：`src/ai/matchSetup.test.ts` 新文件 7 例（势力纯化默认、同种子确定性、显式/重复势力、空与非法势力视为未选、自选名单原样成池含重复、无势力名单标签取首将、池不足回绕成重复）；`battleRunner.test.ts` seatStats 自洽例（deaths≤deployed、kills≤他席阵亡、attacks 合计=ATTACK 步数、恰好一个 won、同种子两跑统计全同）；`battleReport.test.ts` 聚合口径/零分母'-'/日志块有无/seats 解析/encodeSeats 往返；`AiBattleDock.test.tsx` 新文件 3 例（真实形状 payload→三率表格渲染、非开发者隐藏、无 factionStats 旧形态不崩））；势力平衡统计（胜率/死亡率/击杀率 per-seat 口径）接入 CLI/后台窗口/操作日志/简报 dock 四出口 + 自选势力/将领（seats 哈希、整批锁定、默认改势力纯化抽池）；行为改动后全量重 soak：`npm run ai-battle` 2000 局 0 违例（五势力胜率 48.0–51.1%、死亡率 65.3–72.3%、击杀率 5.1–13.6%）、擂台复跑 duel 300 局 66.3/33.7 + 混战 150 局 51.3/43.3/0.7/0 强弱序不变 0 违例、自选阵容专项 350 局 0 违例（含镜像三席"出场450席"计数实证、seed 44001 零登场经查为双投降合法局非缺陷）；`npm run test:coverage` 棘轮上调 lines>=42 / functions>=28 / branches>=31 / statements>=37（实测 42.88/29.01/31.93/38.1）通过；`npm run lint` = 0 错误 / 30 条遗留警告（零新增）；`vite build` 单文件成功（1,908.49 kB / gzip 559.62 kB）；浏览器 E2E（开发者模式经用户密码真机解锁）：弹窗选 座位1=魏（自选 曹操×2）/座位2=蜀 → URL seats 参数 → 后台窗口 20 局真跑，"阵容：…（整批锁定不变）"行与势力平衡两行实际渲染；并关闭 2.2.7 诚实边界③（策略下拉真机点击复验）。诚实边界：简报 dock 弹窗链路在本自动化浏览器仍无法独立成页，其表格以同形状 payload 的组件测试覆盖；E2E 小样本 100%/0% 非平衡结论。CI 远端复验已完成：run `35843848131` 全绿（CI #22，master@71bbad4，lint+audit / test 22 与 24 矩阵含 check+coverage / build），附注标签 `v2.2.8` 指向本条登记文档提交。
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
9. 上述登记之后的提交、标签、推送、CI 核验与证据回填，按 `PROJECT_RELEASE_PIPELINE.md` 执行（降级链与特殊口径均在该文档）。

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
9. （2.1.0 已销案：多套并存的运行时结构已删除，canonical 路径已被实际业务调用并有端到端回归。）技能系统当前真实边界，PENDING 待办：a)（2.2.0 已销案：SkillEditor 多效果模式已支持结构化 runtime 录入（类型/数值/目标），Excel 效果列组升级 6 列并兼容旧 3 列导入；单效果模式仍为纯描述，属有意范围限定而非缺陷）；b)（HEAL/GAIN_ARMOR 已于 2.2.17 销案：EventProcessor 新增两纯处理器、SkillTriggerBridge 真实事件化、编译器与编辑器结算标注同步——治疗封顶 maxHp、护甲按点数累加；实测回合开始疗愈+固甲生效。**剩余触发种类 modify* / onBase* / passive / active* / untilExpire / onOtherDeploy / onTurnEnd / onBecomingTarget / onTargetConfirmed / onOtherSkillActivated 仍无引擎事件支撑，继续 PENDING**，属 c 项同一欠账根）；c) 回合结束技能询问窗口（§4 冻结规则）中 `ReactionWindow.open` 仍无业务入口，规则本身不变、实现暂缓（2.2.17 范围经用户确认不含此项）；d)（已于 2.2.17 销案：技能伤害致死现在派生 DEATH 事件——chainedConsequences 以 damageType==='skill' 且目标将领 from→to 离场为条件派生（普攻击杀由 AttackResolver 自带 DEATH，门条件即去重），GameEngine.dispatch 有界重入回合让派生 DEATH 以应用后状态再展开触发链（≤8 轮 + TRIGGER_REENTRY_LIMIT 哨兵，每条 DEATH 仅状态处理一次）。onDeath/onKill/击破补偿抽全部接通；优先级实测 onDeath(100) 先于 onKill(60)。管线测试 4 例 + 浏览器真实 attackTarget 链路复验。）
10. GPT 审计指出的 1.29 归档边界问题已纳入迁移规则：正式提交不得包含 `node_modules/`、`dist/` 或空的依赖目录。
11. （2.2.7 记录，2.2.9 更新）AI 对战线阶段三已闭环（三档策略+擂台 3400 局零违例、强弱序 激进>均衡>保守>随机）。阶段四"游戏内人机对战"已于 2.2.9 落地（席位 AI 开关+档位、生产 store 链路司机、全 AI 观战、两局浏览器 E2E）。待办：阶段五收线（约 2.3.0）；档位→人类难度体感映射仍属用户回归判断（700ms 节奏与档位映射≠难度标定）；策略权重为静态手工标定，若规则数值调整需重跑 `npm run ai-arena` 回归强弱序。
12. （2.2.8 记录）势力平衡统计与自选阵容已闭环。后续注意：①默认装配**由跨势力混抽改为每座位势力纯化**（不选座位也生效），2.2.4 时代登记的复现种子（如 902/7）行为档案不再逐字可比，重查须重跑；②三率口径（阵亡不问死因、击杀含反杀与攻击触发技能死）是平衡调参基线口径，改动口径须同步 battleRunner 注释、battleReport 口径注释与文档三处；③当前基线（2000 局随机对局）：胜率 48.0–51.1%、死亡率 65.3–72.3%、击杀率 5.1–13.6%——死亡率整体偏高与随机策略"登场即送"有关，阶段四人机难度标定时应改用策略档重测；④`seats` 哈希与 `SeatConfig` 是"整批锁定"的实现载体（URL 一次编码、窗口一次性读取），阶段四若要中途换阵需另立契约；⑤v2.2.6 的录像/日志保存体系与本轮无交集（该需求消息在会话内被反复重投递送，均已按"已交付"处理，未重复实现）。**重投根因已由用户查明（2026-09-23）**：对局结束自动保存录像/日志时，浏览器下载走 Windows"另存为"系统弹窗，用户远程操作时无法点掉、窗口一直挂起，导致该需求消息在会话里被反复重投递送——属**运行环境行为，非产品缺陷、非用户重复发问**。处置口径：再见到该消息重复送达，按"已交付（v2.2.6）"简短确认即可，绝不重实现；规避弹窗的正规路径=在设置页预先授权"录像保存路径"目录（File System Access 写入不再走下载），或浏览器关闭"下载前询问每个文件的保存位置"，或远程场景临时关掉"每局自动保存"开关。**治本已落地（2.2.10）**：自动保存路径改为"仅静默写已授权目录，否则内存暂存、后续自动补存"，无人值守时**绝不触发下载**，从产品侧消灭了该弹窗；手动保存仍保留下载兜底。
13. （2.2.9 记录）人机对战与浏览器自动化的环境注记（后续会话直接引用，避免重复踩坑）：①本自动化浏览器对页面的 browser-use `click` 工具**报成功但实际不触发**，改用 `evaluate_script` 内 `el.click()`（React 合成事件正常触发，仍属真实 UI 路径）；②`evaluate_script`/`fill` 脚本里写**裸中文字符串**会触发行动分类器拦截（Stage 2 classifier error），须用 `\uXXXX` 转义（如 保守 → \\u4fdd\\u5b88）；③`assignFactions` 内嵌 `setTimeout(distributeDraftGenerals, 1500)` 真实定时器——store 层测试若走真 assignFactions 会在后续测试中途重置征召，须 fake timers 隔离或直接调 `distributeDraftGenerals()`；④司机护栏依赖"策略零随机"这一前提（同状态必选同动作→重复签名即卡死信号），若未来策略引入随机化，须同步重审 lastChoiceKey 回退逻辑；⑤`seatModes` 是 store 会话态、不随房间存档持久化，重开页面回默认全人类；⑥（2.2.10 教训）**不要在用户真实连接的浏览器里点"手动保存"来验证下载兜底**——本轮 E2E 探针放行了真实 anchor click，触发了一次 Windows"另存为"挂起弹窗（文件名 ZB-TEST-魏-20260923-20.json 即当次测试注入的房间名），下载兜底路径的验证应以单测为准，浏览器侧探针必须**拦截**（计数后不调用原 click）而非放行。

14. （2026-09-23 记录）收尾流水线已双轨固化：Qoder 本机技能 `three-kingdoms-tripartite-registration`（仅本机）+ 仓库权威文档 `PROJECT_RELEASE_PIPELINE.md`（随 Git 走，§1-6/§10-9 指向）。文档提交 `ddf6706` 已推送（直推超时→一次性代理成功），但其 **GitHub Actions CI run 证据尚未回填**——当时 browser-use 仅有 Qoder 内置浏览器（不走系统代理、无 GitHub 登录态，直连 GitHub 亦不通）。待办：下次收尾或用户接入已登录外部浏览器时，查 `ddf6706`（及后续登记提交）对应 run id/CI #，回填双历史相应条目并销掉本条。本条属**流程文档类待办，不阻塞任何版本发布**。**已销案（2.2.11 回填）**：经已登录浏览器核验 GitHub Actions，`ddf6706`=run `35884182230`（CI #28）、`29544c2`=run `35885055709`（CI #29）、`fd10565`=run `35885161915`（CI #30）三笔登记提交均 completed successfully 全绿。
15. （2.2.11 记录）外部架构评审与八项钉死决议：用户将 v2.2.10 源码包交网页版 GPT（1.x 时代原作者模型）做"方向体检"，结论**未发现玩法方向偏离**，但判定"功能推进速度已快过架构与文档同步速度"，实测抓到 README/AGENTS/CHANGELOG 三处漂移（131 例/910 行+status 幽灵/start.bat 失实）。后续讨论回合双方达成八项决议（详情与排期见 `PROJECT_ARCH_MAP.md` D 表）：D-1 常驻 GameEngine 迁移必须与重建式校验共享唯一 TransitionCore、**禁止双路长期执行**；D-2 RNG 进 EngineState、**录像记随机结果不记重掷**、禁 Resolver 私拿随机源；D-3 先钉 Event→Trigger→Effect→State 权威边界再扩技能覆盖面（HEAL/GAIN_ARMOR、触发覆盖、技能致死接 DEATH 属阶段 C）；D-4 **旧录像永不回填改写**（历史证据），加 ReplayHeader{schemaVersion,gameVersion} 经适配器只读加载，legacy_armor 兜底在真实调用方全量供实例后清除；D-5 指定卡消耗用动作语义 `CardSelectionPolicy`（EQUIVALENT/INSTANCE_REQUIRED）而非卡上标志，防动作空间爆炸；D-6 热点拆分顺序 gameStore→EventProcessor（单一 processEvent 入口+事件族内部分文件，**不许出现第二入口**）→SkillEditor→GameBoard/TestArena；D-7 `npm run build` 内嵌 npm install 的网络耦合列 2.3 议题（改它须连分发文档一起）；D-8 登记纪律扩至五文档（RELEASE_PIPELINE 铁律第四项）。**How to apply**：进入 2.3 前按 D 表排期消化，勿在稳定期偷跑架构改动；任何模型对本图的异议以证据（代码+测试）对话，讨论记录在 G 盘 `GPT_DISCUSSION_REPLY_1.md`（仓库外）。另：GPT 侧"独立验证"仅静态审计（其沙箱 npm install 超时），264/CI 全绿仍按我方 run `35880374035` 口径为准。
16. （2.2.18 记录，2.2.19 更新）阶段 D 首刀已落地（D-2 主件：rngState 进 EngineState、抽牌选牌单点化、Resolver 禁随机）。**二刀已落地（2.2.19）**：b) 建局随机迁入 rngState **已销案**——`createCardDeck` 与 `setup/runtimeSetup.ts` 四函数加 `random` 注入参，`gameStore` 建局五步统一消费 rngState 游标（setupCursor/commitSetup），`ai/matchSetup.ts` 改自带装配播种流（seed^0x9e3779b9）；c) 非选择型不确定源 **已销案**——`action/ActionTypes.ts` action.id 改进程计数器、`utils/runtimeIdentity.ts` instanceId 改纯计数器（matchSetup 种子盖戳扩到卡与技能补齐确定性）；d) `ai/rng.ts withSeededRandom` **已彻底退役（文件删除）**，battleRunner"总是咨询策略"lockstep **已清理**（复放经 createAction 直接重建记录动作，不咨询策略；策略流独立播种 seed^0x85ebca6b 经 AiPolicy 可选 random 参注入）。**2.2.18 浏览器真机 E2E 欠账也已销案**：2.2.19 于 dev 5199 人机对战 2 人房真实点击全链路（建房→骰子→势力→征召→抽牌面 2 将领+3 卡盖→确认→playing），console 0 错误；因内置浏览器视口隐藏，CDP 指针输入不可用，以 evaluate_script 派发真实 DOM 点击（React 走真实处理器）完成，属测试环境形态而非产品变化。**仍 PENDING**：a) RandomOutcome 事件流（随机行为产出 purpose/value/稳定 id 的结果事件，录像"记结果不记重掷"——现达成的是"全局可复现"，非"记结果"；用户已定夺单独一刀）；e) 独立观察项：`ReactionWindow.ts` 窗口 id 的 Math.random（§12-9 c 同源）与 `DiceRoll.tsx` 纯 UI 骰子（不属引擎路径，刻意不动）；另 `testArenaActions` 骰子/洗牌与 `generateRoomName` 为 dev 工具/装饰性，登记为豁免面。

## 13. 当前默认路线

**当前状态（2.2.11 起）：稳定期**。用户已拍板进入"文档/契约冻结→小步结构治理→技能功能闭环"路线（阶段 A~F 见 §12-15 与 ARCH_MAP D 表；阶段五收线并入此路线，2.3 形态由稳定期结果决定）。稳定期内功能开发暂停，除非用户另行解锁。**进度（2.2.17）：阶段 A 完成；阶段 B 两刀均已落地——gameStore（2.2.12，956→622 行）与 EventProcessor（2.2.13，852→93 行入口+eventProcessors/ 六族文件，均为纯移动零行为变化）。阶段 B 收线。F 序列三刀全部落地（D-6 收线）：SkillEditor（2.2.14，1253→868 行 + skillEditor/ 三文件）、GameBoard（2.2.15，704→689 行 + gameBoard/uiPrimitives.tsx 五原语）、TestArena（2.2.16，485→483 行 + testArena/compactPrimitives.tsx 三原语），均为纯移动零行为变化。三大 UI 文件剩余可拆面全部是闭包绑定件（Slot/BSlot/Territory*/Dev 面板/动作处理器/IO 回调），继续瘦身需解闭包——**用户已决定（2026-09-24）：不解闭包、不做，除非出现明确收益**，该方向从稳定期路线正式除名；紧凑原语与棋盘原语刻意不合并（合并=改样式，需单独立项做视觉回归）。阶段 C 首刀已落地（2.2.17，用户口令"好吧，做阶段C"）：旧 §12-9 b（HEAL/GAIN_ARMOR 结算）与 d（技能击杀→DEATH→onKill/onDeath 链）销案；c（ReactionWindow 业务入口）与无引擎事件支撑的触发种类（modify*/onBase*/passive/active*/untilExpire/onOtherDeploy/onTurnEnd/onBecomingTarget/onTargetConfirmed/onOtherSkillActivated）维持 PENDING、顺延后续。**进度（2.2.18）：阶段 D 首刀已落地（用户口令"开始阶段D"，决议 D-2 主件）——引擎随机进 EngineState.rngState：抽牌选牌单点化（applyDrawEvent）、DrawResolver 收敛为纯校验+计数事件（禁 Resolver 私拿随机源达成）、AI 对战按 seed 播种、旧档缺字段惰性重播种且零版本号变更；D-2 剩余欠账（RandomOutcome 事件流/建局随机迁移/id 确定性/withSeededRandom 退役）登记 §12-16 PENDING。下一轮按序轮到阶段 E（引擎生命周期常驻，决议 D-1），开工前待用户口令。** **进度（2.2.19）：阶段 D 第二刀已落地（用户口令"补阶段 D 第二刀"，范围确认 b+c+d 本刀、a 单独一刀）——建局随机全面迁入 rngState 游标、action.id/instanceId 确定性化、withSeededRandom 彻底退役且 battleRunner lockstep 清理，§12-16 之 b/c/d 与 2.2.18 真机 E2E 欠账同日销案；D-2 仅剩 a) RandomOutcome 事件流（"记结果不记重掷"，单独一刀）与 e) 观察项。下一轮按序仍轮到阶段 E（D-1），开工前待用户口令。** **进度（2.2.20）：阶段 E 首刀已落地（用户口令"开工吧"+授权创建 TransitionCore.ts，决议 D-1）——唯一纯转移函数 core/TransitionCore.ts 抽出（校验→解析→触发链→结算→有界重入逐字移入，D-1"禁双路"纪律达成：转移逻辑全库仅一份），GameEngine 降为容器壳（打戳发射/STATE_CHANGED/录像/快照），三路对账测试钉死 常驻===每步重建===录像重建回放（含技能击杀链）；ReplayPlayer 补每步 syncPlayerSkills（本轮唯一行为变化）；下一刀按序=store 常驻迁移（gameStore 持有长生命周期引擎，用户口径明确顺延），D-2 欠账 a/e 不变。**

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
