# PROJECT_HISTORY_AI.md — AI 历史记录

> 本文件只负责**过去发生了什么**。
> 当前规则、当前状态、当前架构和维护规范统一见 `PROJECT_HANDOFF.md`。
> 不在本文件重复维护当前规则；历史记录保留作者/审查/验证模型标记。

## Qoder 1.27：修复本机存档的房间身份漂移
**模型标记：** `[MODEL:COPILOT-SDK-VSCODE]`

### 本轮目标
修复“恢复本机存档后，房间名/人数/房间标识不一致”的问题，避免继续游戏后出现房间身份漂移和后续保存错误。

### 核心修复
- 在本机快照数据中加入 `roomName` 和 `playerCount` 元数据，保存时一并写入。
- 恢复存档时同步修正 `roomName`、`playerCount` 和当前对局状态，不再让 UI 继续保留原先的菜单状态。
- 恢复失败时自动清理坏档，防止无效存档继续被重试。
- 主菜单继续游戏入口会在恢复失败时清理本地存档，避免用户继续看到不可用档案。
- 主菜单版本号更新为 `Qoder V1.27`。

### 影响范围
- 仅影响本机保存/继续游戏恢复链路；不改动正式规则和在线模式结构。
- 这次修正为“保存恢复的稳定性修补”，不扩大底层玩法规则。

### 验证状态
- `verification_actor=[MODEL:COPILOT-SDK-VSCODE]`
- `verification_status=MODEL_REPORTED`
- 需要用户在实际游戏中执行：保存一局、回到主菜单、继续游戏、确认房间名称和人数仍正确；若恢复失败则应自动清理存档。

### 下一步建议
继续保守推进：优先完成本机快照健壮性和后续保存/重开的一致性检查，再考虑扩大到在线或更深的技能收敛路线。

## Qoder 1.28：让坏档清理后菜单立即同步
**模型标记：** `[MODEL:COPILOT-SDK-VSCODE]`

### 本轮目标
在 1.27 已能识别并清理无效存档的基础上，修正主菜单仍短暂显示“继续游戏”的界面问题。

### 核心修复
- 将“是否存在存档”从一次性读取改为页面自身可更新的状态。
- 点击继续游戏时发现存档不存在，立即隐藏“继续游戏”。
- 恢复失败并清理坏档后，立即隐藏“继续游戏”，不需要等待页面重新打开。
- 统一使用本机存档工具清理入口，避免组件直接操作存档键名。
- 版本号和锁文件根版本统一为 `1.28.0`。
- 新版本目录不携带 `node_modules` 和 `dist`。

### 验证状态
- `verification_actor=[MODEL:COPILOT-SDK-VSCODE]`
- `verification_status=MODEL_REPORTED`
- 已完成 `npm run check` 和 `npm run build` 验证。
- 用户仍需实际验证正常存档恢复和坏档清理后的菜单显示。

### 下一步建议
先完成保存、继续游戏、坏档清理三条路径的实际测试，再进入技能运行时收敛或在线连接阶段。

## Qoder 1.29：修复 Rollup 平台依赖缺失导致的独立构建问题

### 本轮任务
- 标记旧的、不再使用的代码为 LEGACY / NON_AUTHORITATIVE。
- 修复 npm 依赖问题，已完成。

### 验证状态
- 依赖审计问题仍延期，尚未执行强制升级。
**模型标记：** `[MODEL:COPILOT-SDK-VSCODE]`

### 本轮目标
只处理 GPT 审计指出的依赖环境问题：归档环境中的 `node_modules` 可能缺少 `@rollup/rollup-linux-x64-gnu`，导致无法独立复现 Vite build。

### 核心修复
- 在 `package.json` 的 `optionalDependencies` 中明确声明 `@rollup/rollup-linux-x64-gnu@4.62.2`。
- 同步更新 `package-lock.json`，保留平台依赖的完整锁定信息。
- 将 `npm run build` 调整为先执行 `npm install --include=optional --ignore-scripts`，再执行 Vite 构建；这样已有但不完整的依赖目录也能先补齐可选依赖。
- 版本号更新为 `1.29.0`。
- 本轮不修改游戏源码、规则、存档逻辑或 UI。

### 验证状态
- `verification_actor=[MODEL:COPILOT-SDK-VSCODE]`
- `verification_status=MODEL_REPORTED`
- `npm ci --include=optional`、`npm run check`、`npm run build` 均已通过。
- 构建完成后已删除本地 `node_modules` 和 `dist`，避免把机器相关依赖带入源码归档。

### 未解决 / 风险
- npm audit 仍报告依赖树中的安全警告，本轮按用户要求不扩大范围，继续 `DEFERRED`。
- Linux 平台的实际构建已通过依赖声明和构建前补齐机制覆盖，但当前验证机器是 Windows，仍建议 GPT 在 Linux 环境复核一次。

## Qoder 1.29 Git 迁移：从复制版本目录改为提交和标签
**模型标记：** `[MODEL:COPILOT-SDK-VSCODE]`

### 本轮目标
参考 GPT 对 `qoder_1_29_audited_clean_archive` 的审计意见，把当前 1.29 作为独立 Git 仓库基线，停止用复制文件夹表达后续版本。

### 审计意见与处理
- 审计确认 1.29 的 Rollup Linux 可选依赖声明和锁文件记录存在，未发现需要修改游戏源码的证据。
- 审计指出正式归档必须排除 `node_modules/` 和 `dist/`；已加入 `.gitignore`，并只把当前源码、配置和三份文档纳入首个提交。
- 审计中的 Linux 独立构建仍属于外部环境待复核，不在本轮冒充已验证。

### 实际行动
- 在 `Qoder/1.29` 初始化独立 Git 仓库，避免继续继承 `D:/THREE_KINGDOMS/.git` 的上级范围。
- 新增 `.gitignore`：排除 `node_modules/`、`dist/`、`.env` 和 `*.log`。
- 使用用户指定的首个提交消息 `v1.16 baseline`。
- 创建当前版本标签 `v1.29`。
- 保留 `Qoder/1.0`～`Qoder/1.29` 旧目录作为备份，不删除、不纳入 1.29 仓库。

### 后续固定流程
每次迭代在 1.29 仓库内执行：
`git add .` → `git commit -m "说明改动"` → `git tag v1.x.x`
不再复制目录；需要查看旧版本时使用 `git show` 或从标签创建临时分支。

### 验证状态
- `verification_actor=[MODEL:COPILOT-SDK-VSCODE]`
- `verification_status=INDEPENDENTLY_VERIFIED`
- 已检查仓库根目录独立于上级仓库。
- 已检查忽略规则覆盖用户指定内容。
- 提交和 `v1.29` 标签待完成后复核。

### 未解决 / 风险
- GPT/Linux 对 1.29 的独立构建仍需在 Linux 环境复核。
- 历史版本目录暂时保留，未来清理前需要用户明确同意。

## [HISTORY]
5.8 Skill Data: DataSkillDefinition+SkillDataRegistry; data-driven skills foundation. Unresolved: full skill runtime. | author=[MODEL:OPENAI-GPT-5.6-LUNA]
5.9 Effect Resolver: skill data→engine events. Unresolved: listeners/priority/full exec. | author=[MODEL:OPENAI-GPT-5.6-LUNA]
5.10 Content Data: GeneralData/CardData/registries; DIY/JSON goal. | author=[MODEL:OPENAI-GPT-5.6-LUNA]
5.11 Import/Export: package/general/skill import+validation; DIY/Workshop/versioning goals. | author=[MODEL:OPENAI-GPT-5.6-LUNA]
5.12 Network Ready: action transport,state snapshot,replay skeleton. | author=[MODEL:OPENAI-GPT-5.6-LUNA]
5.13 Room/Match: room,sessions,lobby,lifecycle,WS sync,reconnect/AI-fill skeleton. | author=[MODEL:OPENAI-GPT-5.6-LUNA]
5.14 Server Authority: server owns authoritative GameEngine target. | author=[MODEL:OPENAI-GPT-5.6-LUNA]
5.15 WebSocket RT: action transmit,room sync,state broadcast. | author=[MODEL:OPENAI-GPT-5.6-LUNA]
5.16 Reconnect+Session: disconnect/reconnect auth, identity persistence. | author=[MODEL:OPENAI-GPT-5.6-LUNA]
5.17 Snapshot/Replay: SnapshotManager/ReplayManager/GameHistory,reconnect/spectator/history skeleton. | author=[MODEL:OPENAI-GPT-5.6-LUNA]
5.18 Agent+AI: HUMAN/LOCAL/AI controller model. | author=[MODEL:OPENAI-GPT-5.6-LUNA]
5.19 AI Bot framework: simple/rule-based/future advanced. | author=[MODEL:OPENAI-GPT-5.6-LUNA]
5.20 Rule Engine: validation separated from UI/network. | author=[MODEL:OPENAI-GPT-5.6-LUNA]
5.21 Card Engine: card/deck/hand/draw/discard/equipment data. | author=[MODEL:OPENAI-GPT-5.6-LUNA]
5.22 Equipment/Status: generic equipment/status; later replaced by real armament model. | author=[MODEL:OPENAI-GPT-5.6-LUNA]
5.23 Turn/Phase Timeline. | author=[MODEL:OPENAI-GPT-5.6-LUNA]
5.24 Trigger/Reaction windows. | author=[MODEL:OPENAI-GPT-5.6-LUNA]
5.25 Skill Trigger migration: runtime ownerId/skillId/enabled/priority; onDeploy/onTurnStart/onDamageTaken/onDamageDealt/onKill/onDeath. | author=[MODEL:OPENAI-GPT-5.6-LUNA]
5.26 history gap: no preserved standalone NOTE; do not invent. | author=[MODEL:OPENAI-GPT-5.6-LUNA]
5.27 Domain correction: pools, factions, base, entity semantics, stats, slots. | author=[MODEL:OPENAI-GPT-5.6-LUNA]
5.28 Setup state separation. | author=[MODEL:OPENAI-GPT-5.6-LUNA]
5.29 General Draft: 10 selected; Qun 1-3; general pool separate. | author=[MODEL:OPENAI-GPT-5.6-LUNA]
5.30 Initial Draw+Turn skeleton. | author=[MODEL:OPENAI-GPT-5.6-LUNA]
5.31 Action types+validation+dispatcher. | author=[MODEL:OPENAI-GPT-5.6-LUNA]
5.32 Resolvers: Deploy/Move/Attack/Supply/Armor. | author=[MODEL:OPENAI-GPT-5.6-LUNA]
5.33 State Mutation bridge. | author=[MODEL:OPENAI-GPT-5.6-LUNA]
5.34 Event-driven state updates. | author=[MODEL:OPENAI-GPT-5.6-LUNA]

5.35.1 Core convergence: Action/Resolver/Event/Mutation/Turn path. | author=[MODEL:OPENAI-GPT-5.6-LUNA]
5.35.2 Controller+Store execution convergence. | author=[MODEL:OPENAI-GPT-5.6-LUNA]
5.35.3 Turn/Draw execution convergence; DRAW action canonical. | author=[MODEL:OPENAI-GPT-5.6-LUNA]
5.35.4 CONFIRM_DRAW + drawState + nextRound. | author=[MODEL:OPENAI-GPT-5.6-LUNA]
5.35.5 BEGIN_DRAW + DRAW_REQUIRED; engine owns draw orchestration. | author=[MODEL:OPENAI-GPT-5.6-LUNA]
5.35.6 EngineState authority for migrated turn/draw; Store compat. | author=[MODEL:OPENAI-GPT-5.6-LUNA]
5.35.7 Deploy convergence. | author=[MODEL:OPENAI-GPT-5.6-LUNA]
5.35.8 Move convergence. | author=[MODEL:OPENAI-GPT-5.6-LUNA]
5.35.9 Attack convergence. | author=[MODEL:OPENAI-GPT-5.6-LUNA]
5.35.10 Damage/Death/Defeat: base→PLAYER_DEFEATED/GAME_OVER; general DEATH→comp draw. | author=[MODEL:OPENAI-GPT-5.6-LUNA]
5.35.11 Supply convergence. | author=[MODEL:OPENAI-GPT-5.6-LUNA]
5.35.11.1 draw blackscreen hotfix: duplicate DRAW_REQUIRED; unsafe hook order; BEGIN_DRAW failure→drawing. | author=[MODEL:OPENAI-GPT-5.6-LUNA]
5.35.11.3 draw flow hotfix: direct next DRAW_REQUIRED; rejected DRAW no fake UI success; index progression fix. | author=[MODEL:OPENAI-GPT-5.6-LUNA]
5.35.12 Armor convergence: canonical ARMOR_EQUIPPED, exact destroyed armor instances; remove generic equipment abstraction. | author=[MODEL:OPENAI-GPT-5.6-LUNA]
5.35.13 Secondary draw: resume player/phase; baseLossPending; exact pending draw owner/total. | author=[MODEL:OPENAI-GPT-5.6-LUNA]
5.35.14 Turn reset: TURN_ACTIONS_RESET; reset flags in Engine lifecycle. | author=[MODEL:OPENAI-GPT-5.6-LUNA]
5.35.15 Legacy Store purge: rules helpers→rules layer; legacy skill damage removed; base loss+surrender engine path. | author=[MODEL:OPENAI-GPT-5.6-LUNA]
5.35.15.1 regressions: DEATH misread as defeat; missing clearDefeatEvent; missing resetGame; enemy-camp melee→base unsupported. Fixed. | author=[MODEL:OPENAI-GPT-5.6-LUNA]
5.35.15.2 type integrity: clean unused/types/Zustand/store API restore; add npm run check. | author=[MODEL:OPENAI-GPT-5.6-LUNA]
5.35.16 draw/board/surrender: correct 0/1/5 rules, dynamic board scale, base-loss before draw, surrender immediate transition. | author=[MODEL:OPENAI-GPT-5.6-LUNA]
5.35.17 draw/surrender/move: nextRound fix; battle single-path explicit target+cancel; index fallback. | author=[MODEL:OPENAI-GPT-5.6-LUNA]
5.35.17.1 critical rule correction: initial ALL players=5; R1 P1=0 others=1; R2+=5; TS18049 fixed. USER VERIFIED check=0,build OK,draw gameplay OK. | author=[MODEL:OPENAI-GPT-5.6-LUNA]
5.35.18 legacy store purge2: editor persistence + testArena actions extracted. | author=[MODEL:OPENAI-GPT-5.6-LUNA]
5.35.19 legacy store purge3: setup logic→src/setup/runtimeSetup.ts. | author=[MODEL:OPENAI-GPT-5.6-LUNA]
5.35.19.1: unused getGeneralsByFaction import removed. | author=[MODEL:OPENAI-GPT-5.6-LUNA]
5.35.20 TestArena convergence: keep test UI mounted through engine turn/draw/surrender; deploy failure safe. | author=[MODEL:OPENAI-GPT-5.6-LUNA]
5.35.20.1 movement correction: only battlefield forces target selection; camp/front one-path original behavior; battle slots clickable. | author=[MODEL:OPENAI-GPT-5.6-LUNA]
5.35.20.3 deploy slot fix: camp occupancy scoped by areaOwnerId/player. | author=[MODEL:OPENAI-GPT-5.6-LUNA]
5.35.21 TestArena HP+animation: animation timer isolation; cap 4; base HP tools restored. USER VERIFIED animation fixed. | author=[MODEL:OPENAI-GPT-5.6-LUNA]
5.35.22 TestArena runtime/draw: duplicate same-name general injection; exact instances; comp draw=1; sandbox draw. | author=[MODEL:OPENAI-GPT-5.6-LUNA]
5.35.22.1 Runtime Identity: instanceId end-to-end across move/attack/supply/armor/test reset/hand consume/animation. USER VERIFIED focused duplicate-general tests. | author=[MODEL:OPENAI-GPT-5.6-LUNA]
5.35.23 Controller convergence: delete duplicate src/player hierarchy; controllers unified. USER smoke-tested,OK. | author=[MODEL:OPENAI-GPT-5.6-LUNA]
5.35.24 network boundary convergence; canonical GameAction/EngineState/Replay/Protocol. | author=[MODEL:OPENAI-GPT-5.6-LUNA]
5.35.24.1 Network export cleanup: explicit network exports; USER VERIFIED OK. | author=[MODEL:OPENAI-GPT-5.6-LUNA]
5.35.25 Replay/Snapshot convergence: ReplayRecorder/Player, SnapshotManager, ReplayManager, StateSerializer, GameEngine automatic replay/snapshot. USER verified local build/runtime around this line. | author=[MODEL:OPENAI-GPT-5.6-LUNA]
5.35.25.1 base-loss defeat continuation: final base HP loss at turn-start now proceeds through normal defeat→next living turn. | author=[MODEL:OPENAI-GPT-5.6-LUNA]
5.35.25.2 Draw Session convergence: engine-owned drawState; skip eliminated seats; detailed DRAW rejection. USER verified build+gameplay OK. | author=[MODEL:OPENAI-GPT-5.6-LUNA]
5.35.26 UI Presentation convergence: responsive app-shell groundwork + intended dual-faction visuals. | author=[MODEL:OPENAI-GPT-5.6-LUNA]
5.35.26.1 card border correction: no card-face fill; only outer border top owner faction/bottom general faction. | author=[MODEL:OPENAI-GPT-5.6-LUNA]
5.35.26.2 card border + general pool randomness: apply border logic to hand/field; remove generalPool.slice order bias via Fisher-Yates while preserving pool composition. | author=[MODEL:OPENAI-GPT-5.6-LUNA]
5.35.26.3 documentation/border finalization: fix null TS issue; intended final border-only implementation; add long-term history log. CURRENT verification of final visual not yet recorded. | author=[MODEL:OPENAI-GPT-5.6-LUNA]

## [2026-09-16 — MULTI-MODEL REVIEW: QODER 1.17 + DEEPSEEK]

primary_reviewer=[MODEL:OPENAI-GPT-5.6-LUNA]
external_review_source=[MODEL:DEEPSEEK]
reviewed_source=Qoder 1.17 PROJECT_HISTORY_AI.md（用户提供）

### Qoder 1.17 日志发现
- [RISK:LOG_ORDER] 1.17 记录出现在 1.9 之前，且后面继续出现 1.10~1.16、1.2~1.8，时间/版本顺序倒置，降低接手时的可读性。
- [RISK:IDENTITY] Qoder 日志顶部 MODEL_LOGGING_RULE 把唯一模型标记写成 [MODEL:COPILOT-SDK-VSCODE]，不适合多模型共存；应改为模型注册表 + 每条记录单独标记。
- [RISK:PROVENANCE] GPT 的 1.10~1.16 与 Qoder 的 1.0~1.9/1.17 被放在同一平面历史列表中，虽然可追溯，但缺少“分支/继承关系”说明；后续应采用 branch/baseline_from 字段，避免把不同作者的版本误认为单线顺序。
- [RISK:VERSION_SCOPE] Qoder 1.x 与项目主线 5.35.x 使用两套版本号，属于可接受的分支版本方案，但日志必须明确“Qoder branch version”与“mainline version”不可互相替代。
- [VERIFICATION] Qoder 1.17 日志中的 npm ci/check/build 通过属于 [MODEL:COPILOT-SDK-VSCODE] 自报结果；本次审查不把它提升为 [MODEL:OPENAI-GPT-5.6-LUNA] 独立验证。
- [CONSISTENCY] 当前 Qoder 日志内部对于“DEFERRED 后下一步”“已完成验证”的叙述整体可读，但仍应继续维护时间顺序与作者边界。

### 对 DeepSeek 意见的采纳情况
[MODEL:DEEPSEEK] 的建议中，以下内容具有长期参考价值并正式吸收到本项目规则：
1. 冻结“核心规则 v1”作为重构护栏：已确认规则不得因代码重构自行漂移；只有用户明确改规则才变更。
2. 保持“单一规则权威 + 单一运行时状态权威”：GameEngine/EngineState 为核心；Zustand 仅投影/兼容，除非有明确语义差异。
3. 在继续堆叠技能、联网、移动端框架前，优先确保最小可玩闭环可端到端运行并有回归验证。
4. 对重构增加可重复、可诊断的验证矩阵/最小集成测试；代码通过不等于玩法已验证。
5. 继续清理遗留/重复系统，但不能为了“减少代码行数”破坏 Test Arena、抽卡、投降、胜负、恢复等明确的特殊语义。
6. 技能系统长期应收敛到单一 canonical runtime 路径，避免并行的第二套技能执行器；但不把该建议误解成现在立即实现全部技能。
7. Git/分支、单机 AI、在线联机、移动端布局等属于工程路线建议，不自动升级为硬性源码规则；是否实施仍由实际阶段目标决定。

### 新增多模型维护规则
- 每个代码迭代必须记录：author_model、review_model（如有）、verification_actor（如有）。
- 仅“提出建议”不视为代码修改；仅“他模型声称通过测试”不视为本模型验证。
- 在没有端到端测试的阶段，优先记录最小可玩闭环状态，而不是只记录架构完成度。
- 主线与外部分支的版本必须通过 baseline_from / branch_scope 说明来源，避免 1.x、5.35.x 等版本号交叉误读。
- 历史记录统一存放在本双日志体系，不恢复 [MODEL:COPILOT-SDK-VSCODE] 已删除的 PHASE_*.md / *_NOTES.md 方案。

### 本轮结论
- Qoder 1.17 的代码审查工作不能仅凭该日志完成源码正确性判断；当前可以确认的是日志存在上述结构/溯源问题。
- 本轮不修改 Qoder 1.17 代码，因为用户提供的是日志审查请求，不是 Qoder 分支代码修复请求。
- 上述审查与 DeepSeek 有价值建议已同步写入双日志。

5.35.26.4 Runtime General Identity + Draw Removal + Cross-Faction Border Fix: runtime instance identity applied to drafted/test-arena generals; Draw removal aligned to the actual randomized selection; deploy membership checked by instance identity; cross-faction/Qun border rendering changed to border-box/padding-box approach; user-reported repeat-general selection/deploy bug later exposed compile omission. author=[MODEL:OPENAI-GPT-5.6-LUNA].
5.35.26.4.1 Compile Fix: fixed missing `cloneWithRuntimeInstance` import in `src/store/gameStore.ts` after user reported TS2304. Source inspection confirms imported symbol exists in `src/utils/runtimeIdentity.ts`; full local check/build not independently executed in this iteration. author=[MODEL:OPENAI-GPT-5.6-LUNA].

## Qoder 1.22
- goal=接入本机对局保存/读取，沿用 1.21 已验证的 StateSerializer 与恢复校验。
- baseline_from=Qoder 1.21; branch_scope=Qoder independent 1.x branch.
- changes=Settings 页面新增“保存当前对局”和“读取本机对局”；快照保存至浏览器 localStorage；读取后复用既有 restoreSerializedSnapshot，不新增第二套规则恢复逻辑；主菜单版本号更新为 Qoder V1.22。
- files=src/components/Settings.tsx; src/components/MainMenu.tsx; package.json; PROJECT_HANDOFF.md.
- author_model=[MODEL:COPILOT-SDK-VSCODE]; review_model=NONE; verification_actor=[MODEL:COPILOT-SDK-VSCODE].
- verification_status=INDEPENDENTLY_VERIFIED; npm run check/build 通过；浏览器实际保存/读取由 [MODEL:COPILOT-SDK-VSCODE] 验证通过。
- unresolved=本机保存仅适用于当前浏览器，不是在线同步；依赖审计风险继续 DEFERRED。
- next_route=完成类型检查和构建后，请用户在一局对战中保存、刷新或返回菜单，再读取并确认牌、回合和当前玩家保持不变。

## Qoder 1.23
- goal=根据用户反馈调整对局保存入口位置与继续游戏流程。
- baseline_from=Qoder 1.22; branch_scope=Qoder independent 1.x branch.
- changes=移除 Settings 页保存/读取区域；新增游戏内顶部“菜单”按钮和暂停菜单中的“保存当前对局”；主菜单在“开始游戏”和“卡牌图鉴”之间新增“继续游戏”；抽取 localGameSnapshot 共用存储工具；版本号更新为 Qoder V1.23。
- files=src/components/GameBoard.tsx; src/components/MainMenu.tsx; src/components/Settings.tsx; src/store/localGameSnapshot.ts; package.json; PROJECT_HANDOFF.md.
- author_model=[MODEL:COPILOT-SDK-VSCODE]; review_model=NONE; verification_actor=[MODEL:COPILOT-SDK-VSCODE].
- verification_status=MODEL_REPORTED; npm run check/build 通过；已复核主菜单顺序和设置页已移除保存按钮；游戏内菜单需用户实际对局确认。
- unresolved=继续游戏按钮在没有保存记录时保持不可用；保存仍仅存在当前浏览器。
- next_route=用户验证游戏内菜单保存、返回主菜单后“继续游戏”恢复对局。

## Qoder 1.24
- goal=修复用户反馈的对局页面看不到“菜单”入口。
- baseline_from=Qoder 1.23; branch_scope=Qoder independent 1.x branch.
- changes=将菜单按钮从顶部信息按钮组移出，改为固定在 GameBoard 右上角、较高显示层级的独立按钮；移除原顶部重复按钮；版本号更新为 Qoder V1.24。
- files=src/components/GameBoard.tsx; src/components/MainMenu.tsx; package.json; PROJECT_HANDOFF.md.
- author_model=[MODEL:COPILOT-SDK-VSCODE]; review_model=NONE; verification_actor=[MODEL:COPILOT-SDK-VSCODE].
- verification_status=INDEPENDENTLY_VERIFIED; npm run check/build 通过；主菜单显示 Qoder V1.24 已复核；用户对局页面需使用 1.24 再确认右上角按钮。
- unresolved=需确认用户启动的是 1.24 而不是旧版本目录。
- next_route=用户在测试场或正式对局确认右上角菜单始终可见。

## Qoder 1.25
- goal=扩展对局菜单功能并改善唤起方式。
- baseline_from=Qoder 1.24; branch_scope=Qoder independent 1.x branch.
- changes=菜单按钮固定到左侧垂直居中；ESC 键切换菜单；新增保存对局并退出、放弃对局并退出（需二次确认）、重开对局、游戏规则、游戏设置；游戏内规则和设置以覆盖层打开并可返回对局；游戏内设置隐藏开发者模式；版本号更新为 Qoder V1.25。
- files=src/components/GameBoard.tsx; src/components/Rules.tsx; src/components/Settings.tsx; src/components/MainMenu.tsx; package.json; PROJECT_HANDOFF.md.
- author_model=[MODEL:COPILOT-SDK-VSCODE]; review_model=NONE; verification_actor=[MODEL:COPILOT-SDK-VSCODE].
- verification_status=MODEL_REPORTED; npm run check/build 通过，主菜单页面显示 Qoder V1.25 已复核；用户实际快捷键、退出、重开验证待完成。
- unresolved=重开对局当前回到主菜单，需用户确认是否符合预期；保存对局并退出会先保存再回主菜单。
- next_route=用户验证 ESC、菜单位置、二次确认、规则/设置返回对局和退出流程。

## Qoder 1.26
- goal=根据用户验证结果完善对局存档、重开和页面快捷键流程。
- baseline_from=Qoder 1.25; branch_scope=Qoder independent 1.x branch.
- changes=Rules/Settings 对局覆盖层支持 ESC 返回；重开清理存档后按当前玩家人数直接 createRoom 回到 lobby；Settings 增加 autoSave 开关，回合结束自动保存；GameOver、放弃和重开清理本地存档；MainMenu 无存档时隐藏继续游戏；localGameSnapshot 增加清理方法；版本号更新为 Qoder V1.26。
- files=src/components/GameBoard.tsx; src/components/Rules.tsx; src/components/Settings.tsx; src/components/GameOverScreen.tsx; src/components/MainMenu.tsx; src/store/gameStore.ts; src/store/localGameSnapshot.ts; package.json; PROJECT_HANDOFF.md.
- author_model=[MODEL:COPILOT-SDK-VSCODE]; review_model=NONE; verification_actor=[MODEL:COPILOT-SDK-VSCODE].
- verification_status=MODEL_REPORTED; npm run check/build 通过；已复核无存档时继续游戏隐藏、主菜单显示 Qoder V1.26、设置页出现自动保存；用户实际自动保存、清理存档、重开流程待完成。
- unresolved=自动保存只在回合正常结束后执行；浏览器本地存档不跨设备。
- next_route=验证 ESC 返回、自动保存开关、完整结束/放弃后继续游戏隐藏、重开回 lobby。

## [DOCUMENTATION_SCOPE]
- Current rules/current state/current workflow: `PROJECT_HANDOFF.md`
- Historical changes: this file.
- Human-readable historical changes: `PROJECT_HISTORY_HUMAN.md`
- Do not create new `PHASE_*.md` / `*_NOTES.md`.

## [2026-09-18 — QODER 1.26 SOURCE AUDIT]

model=[MODEL:OPENAI-GPT-5.6-LUNA]
review_target=Qoder 1.26 source archive provided by user
baseline_scope=Qoder independent 1.x branch; not merged into GPT 5.35.x mainline

### SOURCE REVIEW
- [OK] 1.26 iteration direction is internally coherent: local save/recovery UX, ESC return for Rules/Settings overlays, restart-to-lobby, auto-save toggle, and save cleanup are scoped to the compatibility/UI layer rather than changing core gameplay rules.
- [OK] `src/network/ReplayRecorder.ts` is a compatibility re-export to canonical `src/replay/ReplayRecorder.ts`; it is not a second implementation and should not be removed without checking external imports.
- [RISK:ARCHIVE] The supplied archive contains `node_modules/` and is therefore not a clean source archive. Formal source bundles should exclude `node_modules/` and `dist/`.
- [RISK:VERSION_METADATA] `package.json` is `1.26.0`, while the root `package-lock.json` version remains `1.21.0`. Dependency entries otherwise match the package root at inspection time. Treat the version mismatch as metadata debt and correct it in a dedicated maintenance change.
- [RISK:SAVE_IDENTITY] `restoreSerializedSnapshot()` restores EngineState but does not restore Store `roomName`. A later explicit/automatic save can therefore write the resumed match under a new local room name while EngineState metadata may still refer to the original room. This is not an immediate gameplay rule break, but it is a recovery/network identity consistency risk.
- [RISK:SKILL_CONVERGENCE] `src/skills/SkillEngine.ts`, `SkillRegistry.ts`, `EffectResolver.ts`, `SkillDataRegistry.ts`, `SkillTriggerBridge.ts`, and `src/data/skillEffects.ts` represent multiple historical layers. Static call-site inspection shows `GameEngine` owns `TriggerEngine + SkillTriggerBridge`, but no application call site was found for `registerPlayerSkills()`. Therefore the skill runtime is not yet a complete live gameplay loop. Do not call the skill system finished.
- [RISK:LEGACY_MODULES] `src/card/*`, `src/actions/*`, `src/status/*`, and `src/timeline/TurnManager.ts`/`PhaseManager.ts` appear to be unreferenced or self-contained legacy candidates. They should be explicitly classified before deletion; `src/timeline/PrioritySystem.ts` is still used by `ReactionWindow` and is not included in the legacy deletion suggestion.
- [RISK:LEGACY_SEMANTICS] `src/card/Deck.ts` contains `sort(() => Math.random() - 0.5)`. It appears legacy/unreferenced, but because the project has an explicit unbiased-randomness rule, this helper must never become the canonical GeneralPool/CardPool shuffle implementation.
- [RISK:LEGACY_ACTION] `src/actions/cardActions.ts` defines `createPlayCardAction()` using action type `DRAW`; the module appears unreferenced. It should not be treated as a valid canonical play-card API.

### INDEPENDENT VERIFICATION
- `node node_modules/typescript/bin/tsc --noEmit` on the supplied 1.26 archive completed successfully when using the archive's packaged TypeScript/@types tree.
- Vite build could not be independently reproduced from the supplied archive because its packaged `node_modules` lacks `@rollup/rollup-linux-x64-gnu`; the Qoder log's build claim remains `[MODEL_REPORTED]` rather than `[INDEPENDENTLY_VERIFIED]`.
- The archive contains no `PHASE_*.md` or `*_NOTES.md`, consistent with the current documentation rule.

### DOCUMENTATION RULES ADDED / STRENGTHENED
- Freeze confirmed game rules against accidental refactor drift.
- Record current state in HandOff and historical events in the two History files; do not duplicate full history into HandOff.
- Require author_model / review_model / verification_actor and distinguish MODEL_REPORTED from INDEPENDENTLY_VERIFIED.
- One canonical rule authority: GameEngine + EngineState.
- One canonical Skill Runtime; old skill layers are migration/legacy only and must not execute duplicate rules.
- DIY skills must compose validated primitives rather than arbitrary runtime code.
- Preserve deterministic effect ordering and Event-driven follow-up chains.
- Do not merge cross-model branches without source-level diff, typecheck, build, and critical gameplay regression review.
- Do not optimize refactor by line count alone; preserve Test Arena, draw, surrender, result, recovery, and other intentionally distinct semantics.
- Formal source archives exclude node_modules/dist.

### CURRENT REVIEW STATUS
- Qoder 1.26 is reviewable as an independent branch but is not promoted to GPT mainline authoritative baseline by this audit.
- Main unresolved architectural priority: canonicalize the live Skill Runtime and isolate/remove legacy skill/card/status/turn modules only after call-graph verification.

---

## Qoder 2.0：工程体系与质量门禁建设（六轮迭代）

**模型标记：** `[MODEL:QODER-AGENT]`
**baseline_from：** Qoder 1.29.2 工作树源码（生成 2.0.0 初始提交 `540bd7b`）
**branch_scope：** `Qoder/2.0` 独立仓库（新 init，不与 1.29 仓库共享历史）

### 逐轮记录

- R1 `540bd7b`：1.x 审计与 2.0 生成。清理后的 1.29.2 源码 -> 2.0.0；`.gitignore` 排除 node_modules/dist/coverage。验证：check/build 通过。
- R2 `8099ede`：AI 指令层。AGENTS.md：技术栈表、模块地图、验证命令、数据导入流程、架构与行动流说明。
- R3 `28ef4ea` + `a04de5c` + `8adb2c2`：Vitest 5.0（jsdom）+ 首批 38 测试（EventProcessor / Attack / Move 等核心）；start.bat 一键启动；修复 PowerShell 写入 package.json 携带 UTF-8 BOM 导致的构建失败。验证：38 pass、build 恢复。
- R4 `6dcea25` + `57bc460`：GitHub Actions 工作流（check/test/build）；Deploy/Supply/Surrender 解析器 +38 测试。验证：76 pass。Supply 测试首轮 3 例失败，根因是对 `inEnemyTerritory`（battle 区域恒为 false，extraCost=0）的公式误解，修正预期后通过。
- R5 `51365e5` + `ed6adc5` + `2ee6c45`：Node 18/20/22 测试矩阵 + Pages 自动部署 workflow；ESLint 10 flat config + @vitest/coverage-v8 覆盖率报告（text/html/lcov/json-summary）。验证：矩阵 76 pass，lint 0 errors（遗留架构违规降级为 warn）。
- R6 `530fecf`：+52 测试至 128（Armor 14 / Turn 11 / Draw 8 / BeginDraw 6 / ConfirmDraw 8 / ResolveBaseLoss 5）；覆盖率棘轮阈值入 vitest.config.ts；auto-fix prefer-const（6）、注释豁免 no-empty（2）；对测试文件首次全量 tsc，暴露并修复 3 个旧测试文件的 18 个潜伏类型错误（故意不完整的 payload 断言 `action as any`）。验证：check=0、128 pass、coverage 阈值通过、lint 0 err / 32 warn、build OK。
- 标签：附注标签 `v2.0` 现指向文档同步提交 `95b3540`（初指代码里程碑 `530fecf`，为使标签包含完整交接文档而后移；git show 含 Tagger/Date/说明）。同期补齐 1.29 仓库未提交的 1.29.2 依赖安全修复：提交 `2cfcbbf` + 附注标签 `v1.29.2`；exceljs `^4.4.0 -> ^3.4.0` 经锁文件一致性（解析 3.10.0 + integrity）核实为有意变更。

### Unresolved / Risk
- GitHub Actions 已配置但从未实际运行（无远程仓库）；Pages Source 待推送后在仓库设置中选择 "GitHub Actions"。
- 32 条 react-hooks 遗留警告记录为技术债。GameBoard 的 `if (!cp) return null` 早返回位于后续 hooks 之前，是真实的 rules-of-hooks 隐患，需专门重构，不得批量抑制。
- 整体覆盖率约 13.6%（棘轮只防回退不促提升）；skills / rules / network / store 等模块暂无测试。
- 玩法行为未获得用户运行时验证；上述 VERIFIED 仅指静态验证（typecheck / test / build / lint）。

### Next route
与 HandOff 第 13 节一致：技能系统唯一化 > 最小可玩闭环端到端 > Legacy 安全清理 > UI/移动端收敛 > 在线化。

---

## Qoder 2.0.1：xlsx(SheetJS) 高危漏洞修复

**模型标记：** `[MODEL:QODER-AGENT]`
**baseline_from：** `95b3540`（附注标签 `v2.0`）
**branch_scope：** `Qoder/2.0` 仓库

### 目标与根因
1.29.2 记录的结论"xlsx 漏洞因无可用修复版本仍存在"仅在 npm 注册表视角成立。根因：SheetJS 社区版不再向 npm 发布，注册表永久停在 0.18.5，其中 GHSA-4r6h-8v6p-xvw6（原型污染）与 GHSA-5pgg-2g8v-p4x9（ReDoS）均为 high；官方修复版仅经 SheetJS CDN（cdn.sheetjs.com）分发。

### 修复方法
- 调用面核查：全仓库唯一使用点 `src/components/SkillEditor.tsx`，仅走只读路径 `XLSX.read(data,{type:'array'})` + `XLSX.utils.sheet_to_json(sheet,{header:1})`。
- `npm install https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz --ignore-scripts`；package.json 记录 URL 直锁，lock 含 integrity；API 与类型定义向后兼容，源码零改动。
- 版本号 2.0.0 -> 2.0.1（`npm version`）。

### 验证（会话内独立执行）
- `npm run check` = 0 错误；`npm run test` = 128/128；`npm run lint` = 0 err / 32 warn（与技术债基线一致）；`npm run build` 成功（单文件 1843 kB）。
- `npm audit`：修复前 3 项（1 high + 2 moderate）-> 修复后 2 moderate（exceljs 传递依赖 uuid 链，属既有延期项，本轮不处理）。

### Unresolved / Risk
- exceljs -> uuid 2 项 moderate 仍延期。
- exceljs 版本两仓库不一致：1.29 线 `^3.4.0`（解析 3.10.0）vs 2.0 线 `^4.4.0`，待统一决策。
- 技能编辑器真实 .xlsx 导入回归需用户运行验证，当前 PENDING；本轮 VERIFIED 仅指静态验证。

### Next route
若强制清零 uuid 链，评估 exceljs 版本统一方案（对齐 1.29.2 的 ^3.4.0 策略或等待上游修复）。
