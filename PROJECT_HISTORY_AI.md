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

---

## Qoder 2.0.2：xlsx 漏洞修复收尾（COMPLETE 判定）

**模型标记：** `[MODEL:QODER-AGENT]`
**baseline_from：** `2d7cabf`（附注标签 `v2.0.1`）
**branch_scope：** `Qoder/2.0` 仓库（同步变更 `Qoder/1.29` 仓库）

### 完全修复判定清单（逐条验证）
1. 依赖层：xlsx 指向 SheetJS 官方 CDN 0.20.3（v2.0.1 完成；npm 注册表终版 0.18.5 含高危漏洞）。
2. 运行时证据：新增 `src/components/xlsxSecureReader.test.ts`（3 例）+ 真实夹具 `src/components/__fixtures__/skills-sample.xlsx`（exceljs 生成，6513 字节，含中文与空洞单元格）。jsdom 下解析与生产 vite 打包同一 browser 构建：`XLSX.read` + `sheet_to_json(header:1)` 逐值断言通过；另有版本断言（不得回 0.18.5）。
3. 防回归门禁：`.github/workflows/ci.yml` lint job 新增 `npm audit --audit-level=high` 步骤（本地实测 exit=0）。
4. 锁文件与产物：package-lock 记录 CDN URL + integrity；dist 以 0.20.3 重建（1843.55 kB 单文件）。
5. 全仓清查：2.0 与 1.29 的唯一 xlsx 消费面均为 SkillEditor 只读导入路径；1.29 生产线同步切换 CDN 0.20.3（提交 + 附注标签 `v1.29.3`，check/build 通过）；`Qoder/1.0`~`1.28` 按项目"备份只读"规则不处理。

### 踩坑记录
- 测试初版在 jsdom 内用 exceljs `writeBuffer()` 现场生成字节失败（"Cannot read properties of undefined (reading '0')"）：jsdom/vite 将 exceljs 解析为 browser 构建，Buffer 语义与 node 不同。改为落盘真实夹具 + `node:fs` 读取，更贴近应用真实输入。
- `new URL('./fixture', import.meta.url)` 导致 vitest 收集阶段崩溃（0 test）：Vite 转换后 `import.meta.url` 非 file: URL。改用 `process.cwd()` 拼接（vitest 以项目根为 cwd）。

### 验证（会话内独立执行）
`npm run check` = 0；`npm run test` = 131/131（13 文件）；`test:coverage` 棘轮通过；`lint` 0 err / 32 warn（基线不变）；`build` ok；`npm audit --audit-level=high` exit=0（剩 2 moderate = exceljs→uuid 链，既有延期项）。

### Unresolved / Risk
- uuid 链 2 moderate、两仓库 exceljs 版本不一致（^3.4.0 vs ^4.4.0）：继续登记延期。
- 用户真机浏览器 Excel 导入实测：OPTIONAL（jsdom 同构建回归已覆盖核心路径）。

### Next route
xlsx 议题闭环，无遗留。回到 HandOff 第 13 节主线：技能系统唯一化。

---

## Qoder 2.0.3：依赖安全清零（uuid overrides + exceljs 统一，audit 历史首次 0 漏洞）

**模型标记：** `[MODEL:QODER-AGENT]`
**baseline_from：** `31f2551`（附注标签 `v2.0.2`）
**branch_scope：** `Qoder/2.0` 仓库（同步变更 `Qoder/1.29` 仓库 -> `v1.29.4`）

### 决策与依据
- 前期两项延期登记（exceljs→uuid 2 moderate；两仓库 exceljs ^3.4.0 vs ^4.4.0 不一致）经影响面核查后合并解决：
  - exceljs 4.4.0 仅 1 个文件使用 uuid（`lib/xlsx/xform/sheet/cf-ext/cf-rule-ext-xform.js`，`const {v4: uuidv4} = require('uuid')`，用途是导出条件格式扩展规则时生成 ID）；uuid 8→11 的 `v4` 命名导出接口不变。
  - 结论：npm `overrides` 强制 `uuid: ^11.1.1` 是低风险平替；exceljs 统一取 `^4.4.0`（2.0 线原版本，回归面最小），1.29 线由 ^3.4.0 升上来与 2.0 对齐。

### 变更
- 两仓库 package.json 各 +3 行 overrides；`npm install` 移除嵌套 uuid@8.3.2（2.0 侧 "removed 1 package"）；版本 2.0 线 2.0.2 -> 2.0.3，1.29 线 1.29.3 -> 1.29.4。

### 验证（会话内独立执行）
- `npm audit`：**found 0 vulnerabilities**（修复前 2 moderate）；`--audit-level=high` exit=0。
- 冒烟：exceljs 建簿（含 addConditionalFormatting）→ writeBuffer 导出 → SheetJS CDN 0.20.3 读回 → 行数据逐值一致，SMOKE OK。
- `npm run check` = 0；131/131 测试；lint 0 err / 32 warn（基线）；build ok（dist 已含新依赖树重建）。

### Unresolved / Risk
- 冒烟未直接执行 cf-ext 分支（需要带扩展条件格式的真实文件触发）；该路径仅调用 uuid v4，接口经源码核对兼容。用户真机 Excel 导出/导入回归仍为 OPTIONAL。
- 维护备注已写入 AGENTS.md / HandOff：升级 exceljs 时复查 uuid override。

### Next route
依赖安全议题全部闭环。主线回到：技能系统唯一化。

---

## Qoder 2.0.4：接入 GitHub 私有远程，CI 首轮真实运行并修复环境矩阵

**模型标记：** `[MODEL:QODER-AGENT]`
**baseline_from：** `29b4eaa`（附注标签 `v2.0.3`）
**branch_scope：** `Qoder/2.0` 仓库（远程接入同时覆盖 `Qoder/1.29` 仓库）

### 决策与依据
- 此前所有 CI/CD 均为"已配置未验证"（无远程）。用户确认推送，前提是**不公开资料**：两仓库均建为 GitHub private，Pages 公开部署保持不启用。
- 登录采用 gh CLI device flow；推送 workflow 文件需 token 追加 `workflow` scope（GitHub 对自动化文件改动的保护规定）。

### 变更
- 远程：`origin` -> `https://github.com/DJXD248/three-kingdoms-2.0` / `https://github.com/DJXD248/three-kingdoms-1.29`（private），master + 全部标签已推送。
- `ci.yml`：测试矩阵 18/20/22 -> **22/24**；lint/build Node 20 -> 22；coverage artifact 条件同步改 22。
- `deploy.yml`：触发器 push -> 仅 `workflow_dispatch`（Pages 源未启用且当前无公开计划，避免每推必红）。
- 版本 2.0.3 -> 2.0.4。

### 验证（远端真实执行）
- 首轮（旧矩阵）：Node 22 通过；Node 18 报 `No such built-in module: node:inspector/promises`（Vitest 5 不支持 18）；Node 20 报 jsdom/undici `webidl.util.markAsUncloneable is not a function`（需 Node >=22.5），13 个测试文件 worker 启动失败、coverage 0% 触发棘轮红线；Pages deploy 在 Setup Pages 步骤失败（源未配置，符合预期）。
- 修复后复跑：run `35724339303` **completed success**（lint+audit / test 22 / test 24 / check / coverage 阈值 / build，2m31s）。

### Unresolved / Risk
- Node 18/20 用户环境不再被测试矩阵覆盖（两者均已 EOL）；如遇旧环境兼容需求需单独立项。
- Pages 部署从未成功运行过（设计如此，手动触发 + 配置源后才验证）。

### Next route
"已配置未验证"销案。主线回到：技能系统唯一化。

### 2.0.4 补充（同轮）
- 两仓库新增 `README.md`（快速开始 / Git 远程 / 推送网络处置 / 日常迭代流程）。
- 本机到 GitHub 链路波动：先直推，超时再一次性借道系统代理 `git -c http.proxy=http://127.0.0.1:10808 push`；曾试验仓库级持久代理配置，因代理软件关闭时反致推送失败而撤销（不写死）。

---

## Qoder 2.1.0：技能系统唯一化收敛（注册接线 + 第二套运行栈删除 + 链路回归测试）

**模型标记：** `[MODEL:QODER-AGENT]`
**baseline_from：** `d1ff25c`（附注标签 `v2.0.4` 之后的 README 修订提交）
**branch_scope：** `Qoder/2.0` 仓库

### 决策与依据
- HandOff §13 路线第 1 项。审计确认：canonical 链（TriggerEngine + SkillTriggerBridge + GameEngine）机制完好但存在两个根本断点——(a) `engineExecutionBridge.dispatchStoreAction` 每次 dispatch `new GameEngine(...)`，注册随实例即弃，`registerPlayerSkills` 零业务调用；(b) 没有任何装配路径把玩家在场将领导出成 `DataSkillDefinition`。因此技能系统此前只能标记"骨架已存在、未闭环"。
- 口径坚持不发明玩法：内置武将技能保持纯描述文本，不自动获得结算能力；只有显式携带结构化 `runtime` 载荷的效果才编译进运行时。DIY 技能的可执行化留待编辑器录入 UI（PENDING）。

### 变更
- 新增 `src/skills/skillCompiler.ts`：`compileSkill/compileGeneralSkills`（20 种触发中支持 6 种事件型，逐效果编译，全部跳过路径带显式 reason）+ `syncPlayerSkills`（按 EngineState 每次派生注册，天然兼容快照/读档）。
- `src/skills/SkillTriggerBridge.ts`：修复 `onDeploy` 错误映射到 CUSTOM（现绑 `GENERAL_DEPLOYED`）；首次加入逐触发条件（玩家归属 + 将领实例 + 伤害类别过滤）；效果翻译升级为可结算形态（DRAW {playerId,count}、DAMAGE {damageType:'skill'}）。
- `src/core/armorDamage.ts`：`applyArmorDamage` 从 AttackResolver 提取为共享纯函数；`EventProcessor` 的 DAMAGE 分支对技能伤害按同一护甲规则现场结算，DRAW 分支支持按数量从共享牌堆抽牌（不足洗弃牌堆），选择发生在结算时点，杜绝链式抽牌复制实例。
- `src/data/generals.ts`：`SkillEffect` 新增可选 `runtime?: SkillRuntimeEffect`（纯增量，不动内置数据）。
- `src/store/engineExecutionBridge.ts`：dispatch 前调用 `syncPlayerSkills`。
- 删除（均经双轮 import/call-graph 零引用复核 + 测试引用复核）：`skills/{SkillEngine,EffectResolver,SkillRegistry,types,effectTypes}.ts`、`card/*`、`actions/*`、`status/*`、`timeline/{PhaseManager,TurnManager,index,types}.ts`（保留 canonical `PrioritySystem.ts`）、`rules/{CardRule,TurnRule}.ts`（`RuleEngine/ActionValidator` 在用保留）、`data/skillEffects.ts`（硬编码注册表零调用方；`SkillActivation` 类型收编至 `skills/dataTypes.ts`，gameStore 引用切换）；`ActionTypes` 移除无 resolver 处理的 `USE_SKILL`。
- 保留 `SkillDataRegistry`（importer 引用）与 `dataSkillExamples.ts`（接线夹具）。
- `skills/index.ts` 重写为仅导出 canonical；`vitest.config.ts` 棘轮上调 13/7/10/11 -> 18/11/15/17；版本 2.0.4 -> 2.1.0。

### 验证（本地会话内执行 + 远端 CI 复验）
- `npm run check` = 0 错误；`npm run test` = **152 通过**（13 文件 131 -> 15 文件 152；新增 skillCompiler.test 13 例 + skillPipeline.test 8 例，覆盖此前 0 覆盖的完整链路：回合开始摸牌 / 奸雄受伤摸牌 / 拥有者与将领双重条件隔离 / 技能伤害护甲结算 / 攻防伤害类别过滤 / 抽牌实例唯一 / store 桥多次 dispatch 注册再生效）。
- `npm run test:coverage` 通过新棘轮（skills 目录语句覆盖 72.9%）；`npm run lint` = 0 错误 / 32 警告（stash 基线对照同为 32，零新增）；`npm run build` 单文件成功。
- 远端复验：master@`9f8b453`（附注标签 `v2.1.0`）推送后 GitHub Actions run `35741957716` **全绿**（lint+audit / test(22) 与 test(24) 矩阵含 check+coverage 阈值 / build），直连推送一次成功。
- 技能删除项对玩家可见行为零影响（被删代码本就无调用方），但**正式玩法对局中新链路的实战表现仍属待用户回归**（当前无任何内置技能带 runtime 载荷，实战触发面为空）。

### Unresolved / Risk（即 HandOff §12-9 a-d）
- SkillEditor 无 runtime 数值录入 / Excel 列；HEAL、GAIN_ARMOR 与 14 种触发未接；回合结束询问窗口（冻结规则）实现暂缓；技能致命伤不发 DEATH 事件，onKill 对技能伤不触发。

### Next route
技能线下一刀在内容入口：SkillEditor 结构化效果录入（含 Excel 列）；或转 §13 第 2 项端到端最小可玩闭环回归。

## Qoder 2.2.0：技能编辑器结构化录入（Runtime UI + Excel 6 列效果组 + 纯模块抽取）

**模型标记：** `[MODEL:QODER-AGENT]`
**baseline_from：** `93b528f`（v2.1.0 的最终文档登记提交）
**branch_scope：** `Qoder/2.0` 仓库

### 决策与依据
- HandOff §13 技能线续刀，销 §12-9 a。2.1.0 核心链闭环后，内容侧没有入口——DIY 技能拿不到 `runtime` 载荷，编译器永远输出 skip。本轮把"录入→持久化→编译"打通。口径不变：编辑器只负责诚实录入与如实提示，不发明玩法；HEAL/GAIN_ARMOR 在 UI 标注"暂未接入结算"（数据可录入并往返，编译按 EFFECT_TYPE_UNSUPPORTED 跳过）。
- 结构化录入有意只挂在多效果模式（编译器输入形态即 `SkillEffect.runtime`）；单效果模式保持纯描述，属范围限定非缺陷。

### 变更
- 新增纯模块 `src/skills/skillExcelFormat.ts`：触发字符串↔配置往返、`buildTriggerOptionStrings`、runtime 字段解析（中文标签/枚举双认、正整数校验）、效果列组序列化/解析与组宽检测（表头含"效果N效果类型"→6 列，否则按旧 3 列）。SkillEditor 删除同逻辑改为引用（组件内不再有 triggerToStr/strToTrigger/列组循环）。
- SkillEditor：效果卡新增 `RuntimeEditor`（类型/数值/目标+清除+预览）；导出效果列组 3→6 列（标注|触发|效果类型|数值|目标|描述）并补类型/目标下拉；导入按组宽自动兼容旧文件；导入面板图例更新；`isSkillIncomplete`/`isIncompleteForExport` 计入"类型已选但数值空"。
- 持久化与游戏装配零改动：`runtime` 随 `SkillEffect[]`（gameStore L90 类型已含）流经 skillEdits→localStorage→EngineState→`syncPlayerSkills`。
- 覆盖率棘轮 18/11/15/17 → 27/16/19/23；版本 2.1.0 → 2.2.0（lock 仅改 root 两处版本字段）。

### 验证（本地会话内执行）
- 失败证据（修复前）：测试初稿误设下拉含"击杀将领时"裸标签（该触发全部带→细分后缀），跑红后修正断言；package-lock 版本替换用全局正则误改 archiver-utils 等依赖版本，回滚为"仅前两处"后 diff 复核 + JSON.parse 双文件验证，未流入提交。
- `npm run check` = 0 错误；`npm run test` = **173 通过**（17 文件，+21：`skillExcelFormat.test.ts` 19 例含"Excel 单元格→parseEffectGroup→compileSkill 产出可执行定义/旧格式诚实 skip"两段链路断言；`SkillEditor.runtime.test.tsx` 2 例 @testing-library 真实点击：切多效果→选 摸牌→保存→store 中出现 `{type:'DRAW_CARD',value:1,target:'TARGET'}`，以及"纯描述回退→无 runtime"）；`npm run test:coverage` 通过新棘轮（实测 lines 31.0 / functions 19.4 / branches 22.3 / statements 26.4，skills 目录 84.9% 语句）；`npm run lint` = 0 错误 / 30 警告（基线 32，-2 来自删除组件内 useMemo 逻辑，零新增）；`npm run build` 单文件成功。
- 编辑器录入→实战对局触发的玩家可见表现**待用户回归**（编译输入形态已被组件测试证明进入 store 并可被编译，但真人操作路径未验证）。

### Unresolved / Risk
- §12-9 b/c/d 原样 PENDING：HEAL/GAIN_ARMOR 与 14 种触发无结算原语；回合结束询问窗口未挂接（冻结规则）；技能致命伤不发 DEATH 即 onKill 对技能伤不闭合。
- 旧 3 列文件兼容靠表头检测——若用户手改表头名（非"效果N效果类型"）会按 3 列错位解析，属格式契约内风险。

### Next route
技能线下一刀可选：9d（技能致命伤→DEATH 事件，使 onKill 对技能伤闭合，改动面小）；9b（HEAL/GAIN_ARMOR 结算原语，解锁编辑器已能录入的两类效果）；9c（回合结束询问窗口，`activeSelf` 等触发的使用前提）；或转 §13 第 2 项端到端最小可玩闭环回归。

## Qoder 2.2.1：端到端最小可玩回归 + confirmDraft 编辑器改动断链修复

**模型标记：** `[MODEL:QODER-AGENT]`
**baseline_from：** `e3ee2e5`（v2.2.0 的最终文档登记提交）
**branch_scope：** `Qoder/2.0` 仓库

### 决策与依据
- HandOff §13 路线第 2 项：真实浏览器逐项点击回归最小可玩闭环（①开局/选将 ②初始抽卡 ③部署 ④普攻护甲 ⑤阵亡 ⑥本营胜负 ⑦编辑器"摸牌"技能进局）。①-⑥ 通过；⑦ 首跑失败——编辑器保存"援军"（onTurnStart→DRAW_CARD）后新开对局征召文鸯、登场、回合开始无任何额外摸牌。
- 根因：显示链路 `getGeneralWithEdits` 只作用于 UI；`confirmDraft` 把**原始** `allGenerals` 对象克隆进运行时池，EngineState 里技能永远是征召时点的裸数据。2.2.0 声称"持久化与游戏装配零改动、runtime 自然流到 syncPlayerSkills"是**错的**——装配点在征召，不合并编辑就永远到不了编译器。UI 显示已合并掩盖了断链（教训：显示链路与装配链路必须分别验证）。

### 变更
- `src/store/gameStore.ts` confirmDraft：`cloneWithRuntimeInstance(g)` → `cloneWithRuntimeInstance(get().getGeneralWithEdits(g))`（一行）。
- 新增 `src/store/gameStore.draftEdits.test.ts` 3 例：skillEdits 进池且 compileGeneralSkills 产出 onTurnStart/DRAW_CARD 定义（含 runtime 身份 instanceId 仍逐卡唯一）；generalEdits 数值/改名进池；无编辑时裸数据原样、纯描述技能诚实 skip（NO_RUNTIME_PAYLOAD）不被凭空执行。
- 版本 2.2.0 → 2.2.1（package.json + lock 仅 root 两处版本字段）。

### 验证（本地会话内执行）
- `npm run check` = 0 错误；`npm run test` = 176 通过（18 文件）；coverage 过棘轮（阈值未动，实测 lines 27.7）；`npm run lint` = 0 错误 / 30 遗留警告（零新增）；`vite build` 单文件成功。
- 浏览器复测（修复后全新房间）：晋seat 征召文鸯 → R2 登场（消耗4张将领回池，手牌 11→6）→ R3 回合开始 手牌 6→**12**（常规 5 + 援军 1），抽牌堆 41→35 恰 -6。⑦ 判定 VERIFIED（真人点击路径 + 数值双向对账）。
- 环境注意：后台标签页 setInterval 被 Chrome 限流，骰子动画卡住——页内注入同步补丁（ms≤100 立即跑满 21 tick）绕过；此为测试环境行为，非产品 bug，但提示低性能设备/后台窗口动画时长。

### Unresolved / Risk
- 回归为单场次样本；平衡/手感归用户日常回归。存档=征召时点快照，编辑器后续改动只对新房间生效（口径已写入 HandOff §9，UI 无提示，属可改进项）。
- MainMenu 页脚版本串滞后"Qoder V1.28"（装饰文案）；移动提示残留、攻击按钮禁用无提示两项观察未修。
- CI 远端复验已完成：run `35766373504` 全绿（CI #9，master@1633d09，2m36s，lint+audit / test 22 与 24 矩阵含 check+coverage / build）。

## Qoder 2.2.2：核心玩法流程自动化测试套件（GameAction 直驱）

**模型标记：** `[MODEL:QODER-AGENT]`
**baseline_from：** `1633d09`（v2.2.1 的最终文档登记提交）
**branch_scope：** `Qoder/2.0` 仓库

### 决策与依据
- v2.2.1 完成了浏览器真实点击回归；本轮补另一半——引擎层自动化回归，让"开局抽牌、部署、移动、攻击、结束回合、胜负判定"六条核心流程此后每次改动都有机器把关。用户硬约束：测试必须调用现有 GameAction 接口、不得绕过引擎直接改状态——全部用例走 `new GameEngine(state)` + `dispatch(createAction(...))`，引擎层零 React/zustand 依赖使其可直接裸驱动；手工拼装初始 EngineState 仅作夹具，玩法推进一律走 action。
- 写测试前通读 ActionTypes / ActionValidator / 八个 resolver / EventProcessor / armorDamage / turnRules 建立口径，并沉淀一条关键引擎事实（已写进测试文件头注释）：EventProcessor 内联追加的后续事件（PLAYER_DEFEATED、GAME_OVER、补偿 DRAW_REQUIRED）**不出现在 dispatch() 的返回数组里**——断言必须改看 `engine.state`（phase 'gameOver'、timelinePhase 'GAME_OVER'、metadata.winnerId、drawState）；DEATH 与 TURN_* 链则在返回事件中可见。
- 前置闭环：2.2.1 CI 远端复验 run `35766373504` 全绿（经已登录浏览器确认），证据回填 HANDOFF §3/§9。

### 变更
- 新增 `src/core/gameFlow.test.ts`（约 640 行 / 14 例，9 个 describe）：①开局抽牌（BEGIN_DRAW initial→DRAW→CONFIRM_DRAW 链、非抽牌玩家被拒）②部署将领（登场消耗=HP、消耗将领回池、只能落本方营地、六类拒绝路径）③移动（四条合法路线、每回合一次、文将必须耗卡/武将不得耗卡）④攻击与护甲扣伤（近/远程射程矩阵、每 2 点护甲挡 1 点、每回合一次攻击）⑤将领阵亡与补偿抽牌（DEATH→补偿 DRAW_REQUIRED→结算后恢复原阶段与原行动玩家）⑥本营伤害与胜负判定（本营血量归零→GAME_OVER/winnerId、RESOLVE_BASE_LOSS 正误两态）⑦结束回合推进（TURN_END→TURN_START→TURN_ACTIONS_RESET→DRAW_REQUIRED 链、将池抽空跳抽改为扣本营血）⑧投降判负 ⑨完整一局冒烟（mock `Math.random`=0.99 使抽牌堆洗牌成恒等排列→初始抽卡→部署→行军→两回合打穿本营分出胜者；总账对账放在致胜一击**之前**，因 PLAYER_DEFEATED 会合法清空败方手牌与场上）。所有拒绝路径同时断言 `expect(engine.state).toEqual(structuredClone(before))`——被拒动作必须零副作用。
- 覆盖率棘轮 27/16/19/23 → 34/21/24/29（实测 lines 35.04 / functions 21.93 / branches 25.13 / statements 29.87）。
- 版本 2.2.1 → 2.2.2（package.json + lock 仅 root 两处版本字段，计数守卫替换、git diff 复核）。

### 验证（本地会话内执行）
- 失败证据（编写期三处预期被真实引擎行为纠正，全部按引擎为准修改）：①护甲误设"2 甲挡 2 伤"，实测规则"每 2 点护甲挡 1 点、余伤进血"（hpLost 1）；②整局冒烟第一次 END_TURN 后忘了对手也要过回合，MOVE 吃到 NOT_DRAW_PLAYER；③卡牌总账把将池重复计入（140 vs 160），且校验点误放在击杀后。另修一处 TS2345（事件链数组补 `as const`）。
- `npm run check` = 0 错误；`npm run test` = **190 通过**（19 文件，+14）；`npm run test:coverage` 过新棘轮；`npm run lint` = 0 错误 / 30 条遗留警告（零新增）；`npm run build` 单文件成功（1,853.51 kB / gzip 540.20 kB）。
- CI 远端复验已完成：run `35801947056` 全绿（CI #10，master@6b20f8c，2m45s，lint+audit / test 22 与 24 矩阵含 check+coverage / build，经登录态浏览器确认）。

### Unresolved / Risk
- 本套件守的是**引擎层规则不变量**，不覆盖 UI 渲染、store 装配与浏览器真实点击路径——与 v2.2.1 手工回归互补而非互替；手感与平衡度仍归用户日常回归。
- 整局冒烟的确定性依赖 `vi.spyOn(Math,'random')→0.99` 使 DrawResolver 的 Fisher-Yates 成恒等排列；若洗牌实现改变，该用例需随动改写（文件头注释已声明此依赖）。
- 定时器/异步链路（骰子动画、超时兜底）不在引擎层测试范围内。

## Qoder 2.2.3：AI 对战线·阶段一——合法动作枚举器（getLegalActions）

**模型标记：** `[MODEL:QODER-AGENT]`
**baseline_from：** `eaa5d43`（v2.2.2 的最终文档登记提交）
**branch_scope：** `Qoder/2.0` 仓库

### 决策与依据
- 用户公布 AI 线两目标：①本地 AI-vs-AI 随机对局测 bug（完成本地部署后不得再消耗代理额度→必须是 `npm run` 级本地脚本）②游戏内人机对战（暂定三档难度）。双方共同地基=引擎能回答"此刻该玩家所有合法动作"。经五阶段规划（枚举器→随机 AI+本地对局跑器→三档策略→游戏内接入→收尾），本提交=阶段一。
- 核心设计决策：**枚举器零规则复制**。此前界面按钮的可用性判定散在组件里，若在枚举器里重写一套路由/射程/消耗规则会形成第三套真相（违反本项目一贯的唯一化收敛方向）。方案改为"候选生成 + 引擎同源试探"：候选只从状态枚举几何可能性（手牌将领×槽 0..2、场上将领×全部 zone/slot/areaOwnerId 组合、攻击×敌将+`base_<id>`×近远、补给/装备/窗口动作），合法性一律 `rules.validateAction` + `resolvers.getResolver(action).resolve(state, action)` 判定（返回含 ACTION_REJECTED 即非法）——与真实 dispatch 完全同一条裁判链。
- 试探安全性论证：全部 resolver 为纯函数（注释明示"The EventProcessor owns all state mutation"，grep 确认除 DrawResolver 洗牌外无 Math.random、无写操作）；并加守卫测试"legalActions 前后 state 深相等"，未来若有 resolver 在 resolve 里改状态会当场报红。
- 口径决策：BEGIN_DRAW 不进默认枚举（初始抽由对局装配显式发起，回合开始/补偿抽由引擎内联链发起；开放给策略层会允许 AI 无限重开抽牌窗口）。

### 变更
- 新增 `src/rules/legalActions.ts`（约 200 行）：抽牌窗口分支（DRAW 0..total 全分配 + CONFIRM_DRAW，非抽牌玩家空）；行动窗口分支（部署/移动含文将耗卡配卡/攻击/补给 1-2 卡/装备军备 1-2 卡/RESOLVE_BASE_LOSS/END_TURN/SURRENDER；gameOver/menu 返回空）。
- `GameEngine` 新增 `legalActions(playerId)` 便捷方法（legalActions 对 GameEngine 仅 type-import，无循环依赖）。
- 新增 `src/rules/legalActions.test.ts` 5 例：①试探零副作用 ②抽牌窗口形状+BEGIN_DRAW 缺席+非抽牌玩家空 ③**枚举⇒可执行对账**（每个枚举动作在全新引擎实例上真实 dispatch 均不被拒）+场景必备类型在场 ④典型非法不入列（无资源卡不攻击/不部署、已攻击不再攻击、占用槽不再部署、非当前玩家不给行动、gameOver 空）⑤双随机 AI 只凭清单自对局至 gameOver（自带 LCG 决策随机、Math.random 桩仅锁抽牌堆恒等排列，2000 步上限，54ms）。
- 覆盖率棘轮 34/21/24/29 → 37/23/26/31；版本 2.2.2 → 2.2.3（lock 仅 root 两处）。

### 验证（本地会话内执行）
- 失败证据（修复前，按引擎为准修正）：测试初稿断言"战斗区不可远程攻本营"，枚举对账环节暴露引擎实际**接受** battle→base 远程攻击（AttackResolver `base_(\d+)` 分支），改断言为"应出现 base 候选"——枚举器与裁判一致，错在测试假设。另修一处自造 API（vi.spyOnGlobalRandom 不存在→vi.spyOn(Math,'random')）与一处未使用变量。
- `npm run check` = 0 错误；`npm run test` = **195 通过**（20 文件，+5）；`npm run test:coverage` 过新棘轮（实测 38.39/24.15/27.63/33.2）；`npm run lint` = 0 错误 / 30 遗留警告（零新增）；`npm run build` 单文件成功（1,856.46 kB / gzip 540.86 kB）。
- CI 远端复验已完成：run `35806986372` 全绿（CI #12，master@ad8bafe，经登录态浏览器确认；另 CI #11 run `35802631721` 对 v2.2.2 文档提交复验同样全绿）。

### Unresolved / Risk
- 候选生成对"消耗卡选择"取手牌前缀（如部署取前 hp 张非自身卡）：合法存在性判定够用（resolver 只检查数量/去重/在手），但**不枚举所有消耗组合**——阶段二策略层若需"选哪些卡当费用"（如优先耗将回池）需扩候选或提供 `consumeCards` 变体生成器。
- 军备/补给候选各限 1-2 张；SUPPLY 敌占区+1 附加成本由 resolver 裁决，候选最多 2 张在常规手牌下足够，极端手牌下可能漏更优厚赔方案（不影响合法性对账，影响策略丰富度，阶段二复评）。
- 主动技能（activeSelf/activeOther）无询问窗口（§12-9c 旧欠账），枚举器与人类受同样限制，AI 线阶段二维持此边界。
- 试探性能=每候选一次 validate+resolve（无克隆），实测 2 AI 一局 54ms；阶段二 soak（千局）前应复测最坏手牌（40+ 张、多将领）下的候选规模。

## Qoder 2.2.4：AI 对战线·阶段二——本地随机 AI-vs-AI 对局跑器（npm run ai-battle）

**模型标记：** `[MODEL:QODER-AGENT]`
**baseline_from：** `e4c2c64`（v2.2.3 的最终文档登记提交）
**branch_scope：** `Qoder/2.0` 仓库

### 决策与依据
- 五阶段规划中的阶段二：随机策略 + 本地对局跑器。用户硬约束=交付后本地跑零代理额度→必须是 npm 脚本级工具；跑器的价值定位="随机探雷器"（用海量无脑合法对局轰炸引擎的状态机，验证规则健壮性与卡牌守恒），策略强度留给阶段三。
- 每步镜像生产桥接链路：全新 `new GameEngine(state, opts)` + `syncPlayerSkills(engine, state)` + `engine.dispatch(action)`。不在长活引擎上累积状态，规避 TriggerEngine 按定义 id 的 Map 残留（离场将领旧注册在持久引擎上可能滞留）；与 engineExecutionBridge 每次动作重建的口径一致。
- 内存治理：ReplayRecorder 每动作深克隆 before/after 且 dispatch 里 `replay.export()` 每次全量 structuredClone → O(n²) 时间 + 无界留存，千局 soak 不可行。方案=引擎构造参数 `recordHistory`（默认 true，UI 回放/快照行为逐字不变；false 旁路 replay.record 与 snapshots.capture，before/after 用活引用）。
- 可复现性论证：引擎路径全部随机源（DrawResolver 洗牌/回洗、EventProcessor 坟场回洗、createCardDeck、动作 id）均走全局 Math.random → 单点 mulberry32 补丁即全局确定。但 `cloneWithRuntimeInstance` 的 instanceId 内嵌 Date.now+模块级计数器——跨进程复现会发不同身份证；对策=装配层显式打种子派生确定性戳（`ai<seed>_c<n>`），复放局与生成局卡 id 逐字节一致。
- 复放随机流对齐：--replay 不能只发录制动作——枚举器探测会消耗随机数，跳过策略调用会让后续洗牌流错位。方案=每步照常调用策略（保持消耗），仅把出招替换为录制值，且录制值用字面对象重建（不再次 createAction，避免多耗一次 Math.random）。

### 变更
- 新增 `src/ai/rng.ts` / `matchSetup.ts`（装配：真实将卡卡堆抽样、skillInjection 注入三条已结算演练技能→每批都压编译器→触发器→效果链）/ `policies/randomPolicy.ts`（AiPolicy 契约：engine.legalActions 均匀取一，null=bug 信号）/ `invariants.ts` / `battleRunner.ts` / `battleCli.ts` / `battleRunner.test.ts`（4 例）。
- `invariants.ts` 口径：卡牌账本=牌堆+弃牌+各家手牌/将池/坟场/场上(general+armorCards)，重复占位 DUPLICATED / 变多 MULTIPLIED / 非阵亡局减 VANISHED / 阵亡清扫当步重定基线；`legacy_armor_destroyed_*` 合成牌（EventProcessor L611 回退路径凭空造牌）豁免。结构检查：亡者留牌、本营血<0、血量/护甲越界、(zone|areaOwnerId|slot) 唯一性、槽位上界（营地/前线≤2、战斗区<人数）、抽牌窗存在性与归属、gameOver⇔幸存者≤1、winnerId 与唯一幸存者对账。
- `battleRunner.ts`：开局显式 BEGIN_DRAW(initial,5)，其余全走策略→dispatch→ACTION_REJECTED 即 ENUMERATED_REJECTED；status won/stepsExhausted/violation/replay-diverged；runBatch 聚合。runner 无 fs（vitest 可直跑），落盘只在建 CLI。
- `battleCli.ts`：--games --seed --players(2-4) --pool --deck --skill --max-steps --out --replay；违例局自动写 `ai-battle-failures/match-<seed>.json`（完整动作日志）；exit code 1=有违例。
- `package.json`：`ai-battle` 脚本（esbuild 捆绑 CJS→node；esbuild 在 .bin 系 vite 传递依赖）；版本 2.2.3→2.2.4（lock 仅 root 两处；守卫抓到 json5@2.2.3 第三方撞版本号，未误伤）。`.gitignore` += `.ai-battle/` `ai-battle-failures/`。
- 覆盖率棘轮 37/23/26/31 → 39/25/28/35。

### 验证（本地会话内执行）
- 失败证据（两处自身 bug，均被自家测试当场抓获后修复）：①首跑 4 例 3 败，CARD_VANISHED 定位到账本收集器只认"卡对象"没下钻 fieldGenerals 包装的 .general（首发 DEPLOY 即漏账）；②复放测试在"第一个引用卡对象的动作"（step 33 DEPLOY）报 GENERAL_NOT_IN_HAND——先后踩中录制数组 off-by-one（BEGIN_DRAW 占 actions[0]）与跨进程 instanceId 漂移两个真问题，逐一修复后 4 例全过。引擎本身零违例。
- 本地 soak：`npm run ai-battle` 10 局热身 0 违例 → **1000 局双人（seed 1000..1999）0 违例**（均值 9ms/局、最慢 123ms）→ 400 局三人(pool10/deck80/skill0.7) 0 违例 → 300 局四人(deck90/skill0.9) 0 违例 → 200 局长局(pool16/deck120) 0 违例；合计 1900 局全过逐步不变量。随机策略座位胜负偏斜（双人 322/678）为无脑取牌正常现象，阶段三策略校准胜率。
- `--replay` 跨进程回环实测：match-1000.json 落盘→CLI 读回→status/steps/winner 全同，exit 0。
- `npm run check` = 0 错误；`npm run test` = **199 通过**（21 文件，+4）；`npm run test:coverage` 过新棘轮（实测 lines 40.93 / funcs 25.89 / branches 29.52 / stmts 35.63）；`npm run lint` = 0 错误 / 30 遗留警告（零新增）；`npm run build` 单文件成功（1,856.68 kB / gzip 540.90 kB）。
- CI 远端复验已完成：run `35811273378` 全绿（CI #14，master@d3e166f，经登录态浏览器确认）。

### Unresolved / Risk
- 不变量集合按"必死后成立"口径实现：ALIVE_BASE_DEPLETED（活着但本营血≤0）与 MISSING_GAME_OVER 在 1900 局未触发，但极端并发结算（同步双亡）路径未针对性构造，千局级 soak 仍属抽样而非穷尽。
- 演练技能仅三条已结算效果（DRAW_CARD/DAMAGE），HEAL/GAIN_ARMOR 未注入（2.1.0 结算边界），阶段三若扩结算需同步扩模板。
- PRACTICE_SKILLS 克隆产生的 `undefined__inst...` 技能 instanceId 属外观噪音（技能不进账本），未清理。
- 引擎路径若未来引入 Math.random 之外的随机源（如 crypto/uuid），单点补丁确定性即破——battleRunner.test 的同种子复现例会第一时间报红。

## Qoder 2.2.5：开发者模式·游戏内 AI 对战演练（后台窗口跑器 + 右下角简报 + 日志/录像导出）

### 决策与依据
- 用户插入需求（明确置于阶段三之前）：开发者模式下主菜单出现"AI 对战演练"入口 → 配置弹窗选条件 → **新开后台窗口**跑对战（不占用游戏窗口）→ 结束后输出**操作日志（错误处额外标注）与录像** + 主窗口**右下角结束简报**（局数/完成/错误 + 打开日志与录像的按钮）。
- 后台窗口 = `window.open(同一构建, '#ai-battle?...')`：单文件产物 file:// 与 vite dev 均可用；App.tsx 在**模块加载期读取一次哈希**（每个文档生命周期内哈希不变 → hook 顺序稳定，无 conditional hook lint 问题）。
- 对战核心**零改动复用** `src/ai/battleRunner`（无 fs 依赖正是阶段二的设计红利）：游戏内跑器与 `npm run ai-battle` 是同一条引擎链路，行为/不变量口径完全一致。
- 逐局之间 `await setTimeout(0)` 让出宏任务：主线程不被千局计算饿死，窗口保持可滚动可关闭；StrictMode 双挂载用 startedRef 守卫。
- 子→父通信：`window.opener.postMessage({kind:'qoder-ai-battle-done', params, summary, artifacts(日志文本/录像 JSON/失败文件)}, '*')`；父窗口 `AiBattleDock` 监听并渲染右下角简报。产物**全量随消息回传**（千局内文本量可控），主窗口无需再访问子窗口内存。
- "打开文件夹"在浏览器安全模型下无法唤起 OS 资源管理器：交付为 File System Access"保存到文件夹"（写入所选目录 `ai-battle-log/`）+ 不可用时降级下载，界面文案如实说明。
- 报告层拆为纯函数模块（battleReport/battleHash/browserExport）：组件只留渲染，vitest 无需 DOM 即可锁定 ❌ 标注口径。

### 变更
- 新增 `src/ai/battleReport.ts`（summarizeMatches / formatActionLine 中文动作摘要 / buildOperationLog（违例步、拒绝步 ❌ 整行前缀；越界违例单列；零违例局 ✔）/ buildReplayBundle（CLI 兼容记录数组）/ buildFailureFiles（与 CLI 落盘同 schema））。
- 新增 `src/ai/battleHash.ts`（AiBattleParams + parseAiBattleHash：games 1-5000 / players 2-4 / pool / deck / skill 0-1 显式 0 合法 / maxSteps 钳制，缺 key 走默认而非 0）、`src/ai/browserExport.ts`（triggerDownload / 错峰 downloadFiles / saveToFolder→'saved'|'unavailable'|'cancelled'）。
- 新增组件 `AiBattleConfig`（弹窗：2-4 AI 选择、局数/种子/步数、高级 将池/牌堆/技能注入；window.open 返回 null → 弹窗内出现 `target=_blank` 手动打开链接兜底；z-140）/ `AiBattleWindow`（哈希路由后台窗口：实时日志红色违例高亮、头部导出按钮、完成行统计）/ `AiBattleDock`（右下角 z-130 结束简报 + 导出，developerMode 才渲染）。
- 接线：`MainMenu.tsx` developerMode 下新增"🤖 AI 对战演练"（游戏设置之后）+ 弹窗挂载；`App.tsx` 哈希分支 + `<AiBattleDock/>`。
- 新增 `src/ai/battleReport.test.ts` 6 例；`vitest.config.ts` 对 Node>=24 自动 `pool:'vmThreads'`（本地 Node 升 v24 后 vitest 5.0.1 默认 forks/threads worker 全崩 `Cannot read properties of undefined (reading 'config')`，vmThreads 205/205 全绿；CI Node 20/22 保持默认池）。版本号 2.2.4→2.2.5（package.json + lock 前两处，第三方撞号守卫通过）。

### 验证
- `npm run check` = 0 错误；`npm run test` = **205 通过**（22 文件，+6）；覆盖率棘轮未动实测 40.39/26.03/29.51/35.43 通过；`npm run lint` = 0 错误 / 30 遗留警告（新文件零警告：纯函数出组件文件保 fast-refresh）；`vite build` 单文件成功（1,884.70 kB / gzip 550.47 kB）。
- 浏览器 E2E（真实点击 + dev 服务器 5199）：设置页密码解锁开发者模式 → 主菜单出现"AI 对战演练" → 弹窗填参（局数改 3）→ 后台窗口路由渲染并**真跑 2 局：全部获胜、0 违例、96ms**，完成行与实时进度逐局可见 → 主窗口右下角结束简报按子窗口消息格式**完整渲染**（共 2 局/胜方分布/违例 0/耗时 + 三导出按钮）→ 模拟弹窗被拦：兜底提示与手动打开链接（含正确 hash 参数）出现。
- E2E 期间实发发现：右下角简报（z-130）与配置弹窗（z-120）重叠导致按钮不可点 → 弹窗层级提至 z-140。
- 未端到端验证（诚实标注）：真实 OS 弹窗的 opener.postMessage 往返在本自动化浏览器无法测试（弹窗被硬拦，window.open 返回 null）；机制为标准 API，且拦截兜底路径已验证。CI 远端复验已完成：run `35817697563` 全绿（CI #16，master@e0f4cf3，经登录态浏览器确认）。

### Unresolved / Risk
- 千局级浏览器内跑批受页面内存上限约束（MatchResult 全量留存）；>1000 局仍推荐 `npm run ai-battle` CLI，游戏内定位是"体验/找错"量级。
- File System Access 仅安全上下文可用（https/localhost），file:// 单文件版走下载降级；"打开系统文件夹"无法在浏览器内实现，已按能力如实交付。
- 后台窗口关闭按钮依赖脚本 `window.close()`（仅对 window.open 打开的窗口有效），手动新开标签页访问 `#ai-battle` 时该按钮无效——属可接受的边缘（正常入口均从弹窗打开）。

## Qoder 2.2.6：对局结束录像/操作日志保存体系（结算窗口询问行 + 设置页路径与自动保存）

### 决策与依据
- 用户裁定：浏览器不能"打开电脑文件夹窗口"，改为新形态——所有模式的对局结束结算窗口下方加"是否保存录像"询问（左侧重命名输入框、右侧保存按钮）；设置页新增"录像保存路径"+"每局自动保存录像"开关；操作日志另存独立子文件夹且默认自动保存；命名=房间名+玩家势力+年月日时缩写。
- 生产链路每次 dispatch 都新建 GameEngine（engineExecutionBridge），引擎自带 replay 记录器活不过一步 → 单局录像必须由一个长生命周期模块承接。选择挂在 `dispatchStoreAction` 这个**全模式动作唯一收口点**之后，UI 侧只在结算窗口收口（GameOverScreen 是 phase==='gameOver' 的唯一渲染），自动保存用挂载 effect 实现"每局结束"语义。
- 录像数据形态直接复用 canonical `ReplayDocument`（ReplayRecorder/ReplayPlayer/serialize/deserialize 工具链零改动兼容），不发明第二格式。
- 浏览器安全边界（如实交代）：无法写"手输路径"，路径=File System Access 选一次真实文件夹，句柄存 IndexedDB；重启浏览器后权限回到 prompt 态需再授权（写入前 queryPermission 非侵入检查，拿不到就降级下载）；这是平台限制的诚实等价，不是半途而废。

### 变更
- 新增 `src/replay/liveReplayRecorder.ts`（单例捕获器：懒建档、初始 BEGIN_DRAW 永远重开文档防继承、只存 afterState 链式减半克隆、reset 挂 createRoom/resetGame/restoreEngineState/startTestArena）、`replayNaming.ts`（默认名/清洗/「录像」「操作日志」子文件夹常量）、`gameplayLog.ts`（ReplayDocument→中文日志，ACTION_REJECTED 步整行 ❌ 附码，复用 ai/battleReport.formatActionLine）、`replayStorage.ts`（IndexedDB 句柄库+localStorage 设置；saveArtifacts 目录优先、下载兜底）。
- `engineExecutionBridge.dispatchStoreAction` 每步 `recordLiveDispatch`；`gameStore` settings 扩 3 字段（autoSaveReplay 默认关/autoSaveLog 默认开/replayDirName），updateSettings 顺带 persist；`GameOverScreen` 询问卡（预填默认名可改、保存按钮、📥/💾 状态行、无数据禁用、StrictMode ref 守卫只自动存一次）；`Settings.tsx` "录像与日志"组（选文件夹/清除/两开关/prompt 重授权提示/能力说明）。
- `main.tsx` dev-only `window.__TK__`（store+捕获器）用于结算窗口 E2E 装配，`import.meta.env.DEV` 分支生产整体消除；补 `src/vite-env.d.ts`（tsconfig types:["node"] 下 import.meta.env 需要 vite/client reference）。
- 测试 +14 → 219 例 / 27 文件（见 HANDOFF §9 2.2.6 明细）。

### 验证
- check 0 错误 / 219 通过 / 覆盖率棘轮不动（40.3/26.67/29.91/35.51 过 39/25/28/35）/ lint 0 错误 30 遗留警告零新增 / build 单文件 1,896.11 kB(gzip 554.52 kB)。
- 浏览器 E2E：设置页组渲染与默认态→开关 localStorage 持久化→开发者解锁→结算窗口（dev 钩子喂 3 步真数据含 1 个被拒动作）：默认名 `E2E结算房-蜀-20260923-13` 正确、自动保存（日志+录像）📥 行出现、改名后手动保存 💾 成功。
- CI 远端复验已完成：run `35822419623` 全绿（CI #18，master@6d82741，lint+audit / test 22 与 24 矩阵含 check+coverage / build）。

### Unresolved & Risk
- 测试场沙盒内"投降"按既有口径钉在 testArena 不跳结算窗（buildTestArenaState 结果被显式 phase 覆盖）——既有行为非本轮回归；正常对局与复盘恢复不受影响。
- 存档恢复的对局只能从恢复点起捕获录像（动作历史在存档前丢失属预期，日志抬头步数会偏少）。
- 长时间对局的捕获内存=O(步数×状态克隆)，与 GameEngine recordHistory 默认行为同量级；若未来要做"全程回放播放器"需再上快照差分。
- 多文件连发下载浏览器可能弹"允许下载多个文件"授权；File System Access 仅 secure context 可用（localhost/https）。


## Qoder 2.2.7：AI 对战线阶段三——三档策略 AI + 擂台互胜率（含一枚策略暴露的引擎占位真 bug）

### 决策与依据
- 用户批准 AI 线五阶段后明示"进行阶段三"：在 2.2.4 跑器上换装三档策略（保守/均衡/激进），以擂台互胜率校验强弱，硬门槛=全程零违例。
- 策略架构沿袭既有不变量：**策略与规则彻底解耦**——候选一律来自 `engine.legalActions`（引擎同源裁判），策略只做"看一步"评估：每个候选在一次性引擎（`recordHistory:false`；GameEngine.dispatch 为函数式，不污染调用方）试探执行，`evaluateState` 零和估值（本营血/场上与阵亡将领/护甲/位置价值/抽牌预期按档位权重加总，本营濒危 +100 挂账）取 argmax，同分取枚举序最小。**不消耗随机数**→同种子跨档位严格可比。
- 档位画像：保守 ownBase4/enemyBase1.5（重保全）、均衡 3/2.5、激进 ownBase3/enemyBase4/position1.6（重推进）。抽牌拆分独立打分并带稀缺上下文。
- 擂台公平性：`runDuelSeries` 每局交换两座位抵消先手偏置；`npm run ai-arena` 任何违例 exit 1——擂台同时是策略路径的规则 soak。
- 主动放弃：不做蒙特卡洛树/多步搜索（单步看一步已能拉开稳定强弱序，成本与确定性收益不匹配）；不做人类难度标定（留阶段四）。

### 变更
- 新增 `src/ai/policies/strategyPolicy.ts`（AiTier/TIER_PROFILES/parseTier 含中文名/positionValue/evaluateState/scoreDrawSplit/scoreLegalActions/createStrategyPolicy/policyByName）、`arena.ts`、`arenaCli.ts` + `npm run ai-arena` 脚本；`battleRunner.RunOptions.seatPolicies`（按座位装配，缺省回退全局 policy）。
- `battleHash` 契约扩 `policies`（过滤非法键、缺位补 random、长度钉到 players）；`AiBattleConfig` 每座位策略下拉（默认座位1激进）；`AiBattleWindow` seatPolicies 接入 + 配置行显示"策略：座位N=…"。
- **引擎修复**（独立提交）：`DeployGeneralResolver` 营地占位检查从"只扫登场者自己的 fieldGenerals"改为**全玩家扫描**——敌方入侵将领驻于我方营地时其记录挂在入侵者名下，旧检查不可见导致两将同格（不变量哨兵在激进 soak 首报：seed 902 camp|2|2、seed 7 camp|3|0；MOVE 侧 findAvailableSlot 与规则层 battlefieldRules 本就全局扫描，DEPLOY 是唯一漏网者）。回归测试：入侵者占 0 格→DEPLOY 到该格拒、换空格放行；两旧违例种子修复后 202/141 步正常终局零违例。
- 开发期抓到的两处系统性事实（非引擎 bug、但决定策略形态，已固化进注释与测试）：①DRAW 不关闭抽牌窗口（phase 停在 drawing、totalCards 不递减直到 CONFIRM_DRAW）→无状态 argmax 死循环抽牌，修复=policy 闭包按 `${reason}:${playerId}:${turn}` 记账、每窗口抽一次随即确认；②激进档纯抽卡→全场零 DEPLOY/ATTACK，修复=抽牌打分稀缺上下文（场上 0 将→将领权重×2、资源≥4→卡牌权重×0.4）。

### 验证
- check 0 错误 / `npm run test` = 235 通过（29 文件，+16）/ 覆盖率棘轮上调 lines40/funcs27/branches30/stmts36（实测 41.83/28.09/31.36/37.11）/ lint 0 错误 30 遗留警告零新增 / build 单文件 1,900.95 kB（gzip 556.58 kB）。
- 擂台：每对 500 局×6 对（seed 777 起）+ 四人混战 200 局（seed 555）+ 激进镜像 200 局（seed 9000）= **3400 局违例 0**；duel 强弱序完全成立：激进 vs 均衡 66.4/33.6、跨档其余对局均 100% 上位；ffa 胜率 激进 54.5% > 均衡 37.0% > 保守 4.0% > 随机 0%（混战步数耗尽 9 局属长局正常、非违例）。产物 `.ai-battle/arena-soak-500.json`（gitignore 内）。
- 浏览器 E2E：`#ai-battle?policies=aggressive,balanced,conservative` 真跑 3 局——策略配置行正确、3 局全部分出胜负、违例 0。
- CI 远端复验已完成：run `35829214827` 全绿（CI #20，master@7c7d111，lint+audit / test 22 与 24 矩阵含 check+coverage / build）。

### Unresolved & Risk
- 档位强弱依赖当前手工权重与现行规则数值；规则若调数值需重跑 `npm run ai-arena` 验证序不塌。
- 主菜单弹窗内策略下拉为开发者模式密码保护路径，本轮只经哈希链路+单测覆盖，未做该弹窗内真机点击复验（同一弹窗骨架 2.2.5 已验）。
- 技能致命伤/主动技能询问窗口等 §12-9 旧边界对策略同样生效：策略看不见"不存在的动作"，无额外风险但也无补偿能力。
- 阶段四需把擂台档位映射为玩家难度并做手感标定——AI"赢人类"与 AI"打赢另一档 AI"不是一回事。

## Qoder 2.2.8：势力平衡统计（胜率/死亡率/击杀率）+ AI 对战自选势力与将领（整批锁定）

### 决策与依据
- 用户两点需求：①结束简报加每势力胜率、将领死亡率、击杀率，为势力平衡调参提供数据；②AI 对战支持自选 AI 势力与将领，**允许复数相同势力/将领**，选定后打完指定局数前不再变更。用户同时提供开发者模式密码解锁真机 E2E（密码不入任何仓库文档/提交）。
- 统计口径设计为 **per-seat 记账**：出场席=势力占座次数（镜像局计两席，与"胜率"分母一致）；胜率=胜席/出场席；死亡率=阵亡/登场（名册移除**不问死因**）；击杀率=击杀/攻击（击杀=成功 ATTACK 步内他席移除，含反杀与攻击触发技能死——宽口径有意为之，宁泛不漏战斗贡献）。口径三处同步：battleRunner 类型注释、battleReport 口径注释、文档。
- 采集点选在 `runMatch.dispatchStep` 内、**完整接受的步骤**上对 `snapshotFieldRoster` 前后做差——违例步即终止对局，若记账会引入噪声；名册键 instanceId 优先保证同将多份不互相吞并。
- 装配决策（行为变化，已接受）：默认每座位**势力纯化抽池**（不选座位也生效）——自选功能与"每座位一色"天然一致、且让胜率/死亡率按势力归因有意义；代价是旧跨势力混抽种子档案不再逐字可比，已登记 §12-12①。
- 整批锁定的实现取向：不加运行中可变状态，而是**一次性编码进 URL 哈希**（`seats=魏:wei_001,wei_001|蜀|`），后台窗口仅加载期读哈希——机制即需求，无额外锁代码。
- 主动放弃：统计不做人类对局侧（仅跑器批次视角）；不做中途换阵（契约留给阶段四）。

### 变更
- `battleRunner`：`SeatStats`/`FactionBalanceStat`/`absorbSeatStats`/`sortFactionStats`（魏蜀吴群晋规范序）/`aggregateFactionStats`/`snapshotFieldRoster`；`MatchResult.seatStats`、`BatchSummary.factionStats`；胜者座位 `won=1`。
- `battleReport`：`BattleSummary.factionStats`（旧数据→[]）、`rate()` 零分母 '-'、`formatFactionStats` 文本行、操作日志抬头"势力平衡统计"块；`battleCli` 控制台同块。
- `matchSetup`：`SeatConfig`/`MatchConfig.seatConfigs`、`sampleFrom` 泛型化；势力判定=自选势力>首个存活自将领>种子随机；名单原样成池（重复合法，克隆 `_pN`+种子打戳防撞）；`EnginePlayer.faction?`、`generals.ts` 导出 `allFactions`。
- `battleHash`：`AiBattleSeat`、`seats` 解析（切片钳制/非法势力→''/id 透传装配层过滤）+ `encodeSeats` 逆函数。
- UI：`AiBattleConfig` 座位势力下拉+按势力过滤的添加将领下拉+chips 单删/清空（仅当有选择才写 seats）；`AiBattleWindow` "阵容：…（整批锁定不变）"行 + seatConfigs 注入 + 完成横幅势力平衡块；`AiBattleDock` 简报 HTML 平衡表格（势力/出场/胜率/登场·阵亡/死亡率/攻击·击杀/击杀率）。

### 验证
- check 0 错误 / `npm run test` = 250 通过（31 文件，+15：matchSetup.test.ts 7、battleRunner seatStats 1、battleReport 聚合/契约 5、AiBattleDock.test.tsx 3）/ 覆盖率棘轮上调 lines42/funcs28/branches31/stmts37（实测 42.88/29.01/31.93/38.1）/ lint 0 错误 30 遗留警告零新增 / build 单文件 1,908.49 kB（gzip 559.62 kB）。
- 行为改动后全量重 soak（硬门槛零违例）：`npm run ai-battle` 2000 局 0 违例——五势力胜率 48.0–51.1%、死亡率 65.3–72.3%、击杀率 5.1–13.6%；擂台复跑 duel 300 局 66.3/33.7、四人混战 150 局 51.3/43.3/0.7/0，强弱序在纯化池下不变；自选阵容专项 350 局 0 违例（魏名单 vs 蜀 200、三座位同吴+跨势力名单 4p 150、座位统计自洽 60、旧形态兼容），三席同势力显示"出场450席"实证镜像计数。
- 如实记录并排除的一处疑点：soak 断言抓到 seed 44001 座位统计全 0——查证为合法对局（随机策略 16 步两次 SURRENDER 终局、无人登场），改断言为"零登场必须伴随投降"后全绿。非产品缺陷。
- 浏览器 E2E（真实点击，开发者模式经用户提供密码解锁）：弹窗选 座位1=魏+曹操×2、座位2=蜀 → URL `…&seats=%E9%AD%8F%3Awei_001%2Cwei_001%7C%E8%9C%80` → 后台窗口 20 局真跑，"阵容：座位1=魏（自选：曹操、曹操） · 座位2=蜀（整池随机抽）（整批锁定不变）"与势力平衡两行（魏 100.0%/13.0%/31.8%；蜀 0.0%/100.0%/15.0%）实际渲染。附带关闭 2.2.7 诚实边界③：策略下拉已在开发者模式弹窗内真机选择并确认流入 URL/窗口显示行。
- CI 远端复验已完成：run `35843848131` 全绿（CI #22，master@71bbad4，lint+audit / test 22 与 24 矩阵含 check+coverage / build）。

### Unresolved & Risk
- 简报 dock 的 opener→子窗口真实弹窗链路在自动化浏览器仍不可端到端复验（弹窗塌缩回同页、注入式伪造被策略禁止），表格渲染以同形状 payload 的组件测试覆盖——若用户真机发现 dock 表格异常，以 `AiBattleDock.test.tsx` 的形状为准排查回传侧。
- E2E 的 20 局 100%/0% 属小样本+自选阵容 vs 随机策略，不是平衡结论；平衡判断以 2000 局区间为准。
- 死亡率整体 65–72% 偏高与随机策略"登场即送"相关——阶段四做人机难度标定时应以策略档重测基线。
- 旧登记种子（2.2.4/2.2.7 引用的复现种子）在纯化池下行为改变，复现档案需重跑生成。

## Qoder 2.2.9：AI 对战线阶段四——游戏内人机对战（生产 store 链路司机 + 全 AI 观战 + 席位档位）

### 决策与依据
- 用户指示"那接下来进行阶段四吧"：任何座位可设为 AI（保守/均衡/激进/随机），AI 自动征召、自动抽牌、自动出招，且**不得旁挂第二套玩法链路**——一切动作走生产 store 函数（与人类按钮同一批 `deployGeneral/attack/executeDraw/endTurn…`），规则校验、2.2.6 现场录像捕获、状态写回、动画天然与人类操作同路径。
- 大脑零新代码：直接复用 2.2.7 `createStrategyPolicy`。关键约束=策略的抽牌窗口记账在闭包里 → **每座位整局必须共用一个 policy 实例**（`seatPolicies: Map<"${playerId}:${tier}">`），对局边界（phase 回 lobby）`resetAiControllers()` 清表。
- 防呆护栏：策略零随机 ⇒ 同状态必选同动作；司机对每步记 `lastChoiceKey=${playerId}|${turn}|${type}|${JSON(payload)}`，紧邻重复→null→回退到恒合法动作（drawing→confirmDraw；playing→endTurn）。永不死循环、永不卡窗口。
- 节奏：`AiDirector` 组件 700ms setInterval、每 tick 最多一个 store 动作（人类可见的"AI 出手中…"步进感）；`isTestMode` 直接跳过；#ai-battle 后台窗口因 App.tsx 早退分支不挂载司机，与演练窗完全隔离。
- 全 AI 观战链：lobby 全 AI→自动 startGame；diceRoll 全 AI→立即 rollDice+setPhase(factionAssign)+assignFactions（跳过骰子动画、真实座次照算）；generalDraft AI 座→aiAutoDraft（固定 7 势力主+3 群，凑不满 10 回退人类界面）。混战局对人类阶段一律 hands-off（测试断言）。
- 席位打戳形态：`isAi/aiTier` 挂在 Player 对象上而非旁表——经骰子重排展开、引擎 structuredClone、gameStateAdapter 映射、EnginePlayer 索引签名全程存活（专门回归测试锁定），AI 回合判定= store 座位 isAi 且 engineState.currentPlayerId 对账。
- 主动放弃：不做 AI 中途换阵；不做"聪明的"征召（7+3 固定即可）；不做难度手感标定（映射判断归用户回归，文档已声明 700ms 节奏≠难度曲线）。

### 变更
- 新增 `src/ai/aiTurnDriver.ts`（runAiStep/pickPolicyAction/applyPolicyAction 十种 ActionType→store 调用映射/resetAiControllers/allSeatsAi/policyFor）、`src/ai/aiTurnDriver.test.ts` 8 例、`src/components/AiDirector.tsx`。
- `src/setup/runtimeSetup.ts`：`AiSeatTier/AiSeatMode/AI_TIER_KEYS/AI_TIER_LABELS/defaultSeatModes/pickAiDraftPicks`；`SetupPlayerSeed.isAi?/aiTier?`；`createLobbyPlayers` 打戳+AI 座命名 `AI·档位`。
- `src/store/gameStore.ts`：`Player.isAi?/aiTier?`、`seatModes` 状态、`setSeatMode`、`aiAutoDraft`；createRoom 透传 seatModes。
- UI：`CreateRoom` "席位安排"区块（每座位 人类/AI 切换 + 四档芯片 + 悬停提示）；`GameBoard` 🤖 徽标 + 回合条"AI 出手中…"；`UnifiedDraw` AI 抽牌横幅"正在决定抽卡…"并隐藏人类分配控件；`App.tsx` 挂载 AiDirector。
- 版本 2.2.8 → 2.2.9（package.json + lock 仅 root 版本字段）。

### 验证
- check 0 错误 / `npm run test` = 258 通过（32 文件，+8：含**纯 runAiStep 驱动两 AI 局打到 gameOver**、人机交错、全 AI 链、hands-off 断言）/ 覆盖率棘轮上调 lines46/funcs32/branches34/stmts41（实测 46.47/32.33/34.55/41.43，驱动测试跑整局引擎对局故跳升）/ lint 0 错误 30 遗留警告零新增 / build 单文件 1,914.95 kB（gzip 561.72 kB）。
- 浏览器 E2E 两局真实点击（evaluate_script el.click，见 HANDOFF §12-13 环境注记）：①全 AI 观战（保守 vs 激进）lobby 起全自动至 gameOver（第 8 轮、胜方 seat2、本营 [0,6]），棋盘"回合：AI·激进"、双座 🤖、回合条"AI 出手中…"，结算窗含 2.2.6 录像行（默认名 人机演武-蜀-20260923-18）；②混战（人类 vs AI·均衡）——骰子后 AI 座自动征召（池=10）与自动初始抽牌（手牌 5），人类征召/抽牌界面司机零干预（页面捕获"AI·均衡 正在决定抽卡…"），人类真实点击完成全流程后投降→判负 AI·均衡。两局控制台 0 错误 0 警告。
- CI 远端复验已完成：run `35866565864` 全绿（CI #24，master@eca25d9，lint+audit / test 22 与 24 矩阵含 check+coverage / build），经登录态浏览器确认；证据同步回填 HANDOFF §3/§9。

### Unresolved & Risk
- 700ms 节奏与档位→人类难度映射是工程取向，非玩法标定；强弱序证据只来自擂台（AI-vs-AI），人类体感待用户回归。
- 热座规则未改：AI 回合棋盘仍显示该座手牌，人类可代打——与既有热座行为一致，如未来要"隐藏 AI 手牌"需另立需求。
- seatModes 为会话态：不随存档持久化，刷新回全人类默认；跨房间"再来一局"沿用（已按特性登记）。
- 司机每 tick 单动作+700ms ⇒ 长局观战耗时线性；若用户嫌慢可下调 AI_TICK_MS（单点常量），未做每 tick 多动作（会失去可读节奏）。
- §12-9 b/c/d 旧边界（部分触发未接入、回合结束询问窗缺席、技能致命伤无 DEATH）对人机同样生效：AI 与人类受同一规则世界限制。

## Qoder 2.2.10：录像/日志自动保存治本改造（无人值守永不触发系统弹窗）

### 决策与依据
- 用户查明 v2.2.6 需求消息反复重投的根因=自动保存走浏览器下载→Windows"另存为"弹窗→远程无人点掉→挂起→消息重投（登记于 HANDOFF §12-12⑤，提交 228db30）。用户拍板"按治本方式做吧"：从产品侧消灭该弹窗，而非只给浏览器设置建议。
- 口径：弹窗只能出现在**有用户手势且预期有交互**的路径（手动点"保存"）。自动保存属无人值守路径，任何"需要点掉才能继续"的系统界面都是设计缺陷。

### 变更
- `src/replay/replayStorage.ts`：`saveArtifacts(files, { unattended? })` 双路分流。unattended 仅经 `getSilentlyWritableReplayDirectory()`（只认 `queryPermission==='granted'`，绝不调 requestPermission）静默写目录；否则进模块级暂存队列（`PENDING_CAP=12`，丢最旧）返回新结局 `'pending'`。任何目录写成功（自动/手动）都 `flushPendingAutoSaves()` 补存。attended 路径原样：目录（可 requestPermission，有手势）→下载兜底。新增测试注入口 `__setDirectoryHandleForTests/__clearDirectoryHandleOverrideForTests`（覆盖"已记忆目录"，权限检查仍走真实代码；`checkReplayDirectoryPermission` 同步读注入口）。
- `src/components/GameOverScreen.tsx`：两个自动保存作业传 `{ unattended: true }`；'pending' 文案"未授权保存目录，已暂存浏览器内存（不弹保存窗口），授权目录或点'保存'后自动补存"；面板说明改写。
- `src/components/Settings.tsx`："选择文件夹"成功即 `flushPendingAutoSaves()` 并在提示里报补存份数；未选择/清除路径文案改为"自动保存暂存、手动才下载"。
- 版本号 2.2.10。

### 验证
- check 0 错误；`npm run test` = 264 通过 / 32 文件（replayStorage.test +6：granted 静默写目录零下载零 requestPermission；prompt 态只暂存；授权后下一次保存自动补存且顺序=本次先/暂存后；手动无目录仍下载且不清暂存、flush=0；队列封顶 12 丢最旧；无 API 环境 unattended 不下载）。
- coverage 棘轮维持 46/32/34/41（实测 lines 46.73 / funcs 32.54 / branches 34.49 / stmts 41.72）；lint 0 错误 / 30 遗留警告（零新增）；`vite build` 单文件成功（1,916.32 kB / gzip 562.27 kB）。
- 浏览器 E2E（dev 页 `__TK__` 装配真实录像数据 + `HTMLAnchorElement.prototype.click` 下载探针计数，evaluate_script 全程 `\uXXXX` 转义）：①自动保存→结算横幅"已暂存"文案出现、探针 dl=0（无下载尝试=无系统弹窗可能）；②手动点"保存"→dl=1、"已按浏览器下载方式保存"（降级链路完好）；控制台 0 错误。
- 功能提交 `babb57b`；CI 远端复验已完成（用户开代理后补推）：run `35880374035` 全绿（CI #26，master@b005cb6，lint+audit / test 22 与 24 矩阵含 check+coverage（264/264）/ build，2m48s），经登录态浏览器确认；四提交（228db30/babb57b/d15eb61/b005cb6）+ 标签 v2.2.10→d15eb61 均已推送。E2E 教训：手动保存探针放行了真实下载，在用户连接的浏览器弹了一次"另存为"（已请用户点取消），登记 HANDOFF §12-13⑥——浏览器侧探针须拦截计数不调原 click。

### Unresolved & Risk
- 暂存队列仅内存：刷新/关页即失。接受——触发前提（未授权目录+自动保存）本来就无处可写，正解是授权目录后自动补存。
- 用户浏览器"下载前询问保存位置"设置仍会影响**手动**下载与其他网站下载，本轮边界=游戏自动保存绝不走下载。
- 若未来出现第二个自动保存调用点，必须显式传 `{ unattended: true }`，否则默认是带下载兜底的手动语义。

## Qoder 2.2.10-postscript：版本收尾流水线固化为仓库文档（PROJECT_RELEASE_PIPELINE.md）

### 决策与依据
- 收尾流水线（本地验证→三方登记→feat/docs 提交+附注标签→推送降级链→CI 核验→证据回填→汇报）此前逐字执行但规则散在 Qoder 本机记忆；用户要求接手模型读完交接文档/双历史/Git 后就能完整发现并复跑该流程。
- 落地三件：① 新增仓库根文档 `PROJECT_RELEASE_PIPELINE.md`（E2E 血泪坑、推送固定降级链、无 gh CLI 的 browser-use CI 路径、录像需求重投口径、完成判据全在内）；② HANDOFF §1 读取顺序第 6 条、§10 修改后第 9 条指向该文档；③ Qoder 本机个人技能库同步建 `three-kingdoms-tripartite-registration`（内容等价，仅本机生效、不随仓库分发——仓库文档为跨模型权威，技能只是 Qoder 便捷入口）。

### 验证
- 纯文档改动：源码/配置零变化，无需重跑 check/test/build；两份文档修改 + 一份新收档文档进本 docs 提交。

### 状态更新（同日）
- 登记提交 `ddf6706` 已推送：直推超时→一次性 `-c http.proxy=http://127.0.0.1:10808` 成功，origin/master=ddf6706。CI run 证据**待回填**（当时 browser-use 仅有内置浏览器：不走代理、无登录态），待办已登记 HANDOFF §12-14。

### Unresolved & Risk
- 技能与文档双处两源：流程若变，先改仓库文档，再同步 Qoder 技能，以文档为准。
- 文档内代理端口 10808、仓库名、登录态为当前事实；环境变化时按其"先直推、失败如实报"原则处理，勿迷信具体值。

## Qoder 2.2.11：纯文档/契约冻结版（外部架构评审共识落地 + PROJECT_ARCH_MAP 建立）[Qoder/Qwen]

### 背景（用户驱动）
- 用户担心 2.x 高速迭代偏离 1.x 原作者（网页版 GPT）方向，要求导出 v2.2.10 源码包交其评审；GPT 静态审计结论：**玩法方向未偏离**，但"功能推进速度已快过架构与文档同步速度"，实测抓到 README（131 例）、AGENTS（910 行/status 幽灵模块）、CHANGELOG（谎称删除 start.bat）三处漂移，并建议进入稳定期、建立全项目架构地图。
- Qoder 逐条对源码核实（全部属实）后与 GPT 在浏览器会话内完成一轮技术讨论（常驻引擎/重建对账、RNG 入 EngineState+录像记结果、CardSelectionPolicy、旧录像只读原则、拆分顺序、阶段 A~F 排期），用户以"我相信你们的合作"拍板开工 2.2.11。

### 变更（零行为改动）
- README：测试数 264/32（as-of 戳）、补 ai-battle/ai-arena 命令、文档清单加 ARCH_MAP/RELEASE_PIPELINE、日常迭代流程写明五文档登记纪律。
- AGENTS：模块地图删 `card/`、`status/` 幽灵条目并刷新文件名；gameStore 956 / EventProcessor 852（as-of 戳）；棘轮 46/32/34/41、警告 30 条刷新；加"volatile numbers 以 ARCH_MAP 为准"指针。
- CHANGELOG：新增 2.2.11 条目 + 补建 2.0.1/2.0.2/2.0.3/2.1.0/2.2.0-2.2.10 年表；2.0.0"Removed start.bat"更正为从未删除。
- `PROJECT_ARCH_MAP.md`（新）：十字段模块表（含 grep 实证 DORMANT 四模块与 LEGACY 旧 AI 三件套）、权威执行链图、C 注记（引擎重建式现状/三率口径/unattended 不变量）、D-1~D-8 债务决议表、E 诚实清单。
- `src/rules/legalActions.ts`：getLegalActions JSDoc 由"every action"钉准为**候选枚举契约**（引用 ARCH_MAP D-5），行为零变化。
- `PROJECT_RELEASE_PIPELINE.md`：铁律增补第四项（周边文档核对义务+根因）；HANDOFF §1 读取顺序插 ARCH_MAP、§3 本轮段、§9 验证条、§12-15 八项决议登记、§13 稳定期状态。

### 验证
- check 0 错误；264 测试通过（32 文件，零增删）；覆盖率棘轮 46/32/34/41 通过；lint 0 错误/30 遗留警告（零新增）；build 单文件成功（1,916.32 kB / gzip 562.27 kB）。无行为改动故免浏览器 E2E。CI 远端复验已完成：run `35894015044` 全绿（CI #31，master@95f13ab，3m31s，test(22)/test(24) 双矩阵各 32 文件 264/264 通过，lint、build 均过）；功能提交 `cc49efb`、登记提交 `95f13ab` 与附注标签 `v2.2.11` 均已直推成功。顺带销案 §12-14：`ddf6706`=run `35884182230`（CI #28）、`29544c2`=run `35885055709`（#29）、`fd10565`=run `35885161915`（#30）经浏览器核验均全绿。

### Unresolved & Risk
- 稳定期纪律：阶段 A（本版）~F 排期钉在 ARCH_MAP D 表，未经用户解锁不得偷跑架构/功能改动。
- ARCH_MAP 的 Introduced 列 1.x 区间为约记、controllers/RuleEngine 边界属低把握条目（E 清单已标 UNVERIFIED），后续动到时先对码再信图。
- 讨论全程未消耗 GPT 附件额度（纯文本往返）；若 GPT 需逐文件复核，按仓库外 `GPT_REVIEW_PROMPT_20260924.md` 的粘贴模板走。
