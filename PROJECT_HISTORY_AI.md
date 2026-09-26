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

## Qoder 2.2.12：稳定期阶段 B 第一刀——gameStore 纯移动拆分（D-6 落地开始）[Qoder/Qwen]

### 背景
2.2.11 共识路线阶段 B（热点文件小步拆分，顺序 gameStore→EventProcessor→…）。用户口令"按刚才的计划开始工作"开工。原则：本轮只做逐字搬移的纯结构拆分，零行为变化，264 测试面一字不改作为回归锁。

### 变更
- 新建 `src/store/gameStoreTypes.ts`（135 行）：全部 store 级类型外移；gameStore `export * from './gameStoreTypes'` 再导出，消费方（GameBoard/SkillEditor/aiTurnDriver 等约 20 文件）导入口径零变化。
- 新建 `src/store/gameStoreEditorActions.ts`（137 行）：`buildEditorActions(get,set)` 工厂承接开发者模式开关+技能/武将编辑+批量禁用+文本导入+getGeneralWithEdits 共九动作（模式先例：buildTestArenaActions）。
- 新建 `src/store/gameStoreRecovery.ts`（70 行）：`buildRecoveryActions(get,set)` 承接 createSerializedSnapshot/restoreEngineState/restoreSerializedSnapshot。
- `settleDrawInTestArena`/`buildTestArenaState` 迁入 `testArenaActions.ts`（297→441 行）：演练场职责聚合；testArenaActions 对引擎桥的依赖经 dispatchStoreAction 直连（type-only 回指 gameStore，无运行环）。
- gameStore.ts 956→622 行；`deriveResultState`、对局动作、设置持久化留在本体（下一刀候选：EventProcessor 拆分与 gameStore 对局动作分组）。
- 同步刷新：AGENTS 模块地图与 Key Files（622 as-of 2.2.12）、ARCH_MAP gameStore/testArenaActions 行+新文件行+D-6 进度注记、CHANGELOG [2.2.12]。

### 验证
- check 0 错误；264 测试通过（32 文件，零增删）；覆盖率棘轮实测 stmts 41.96 / branch 34.85 / funcs 32.84 / lines 47（棘轮 41/34/32/46 维持通过，无阈值调整）；lint 0 错误/30 遗留警告（零新增）；build 单文件 1,916.39 kB / gzip 562.33 kB。
- 浏览器冒烟（dev `__TK__` 直驱拆分后真实装配，非旁路）：createRoom→lobby；编辑器九动作存取删回环（含 getGeneralWithEdits 合并结果断言）；快照创建（5326 字符）+恢复 true；startTestArena+endTurn 驻留；resetGame 保偏好；控制台 0 错误。
- CI 远端复验已完成：run `35935393466` 全绿（CI #33，master@c5c82c1，3m3s，test(22)/test(24)/lint/build 四 job 均 completed successfully）；`9f8e426`+`c5c82c1`+标签 `v2.2.12` 已推送（直推超时→一次性代理成功）。

### Unresolved & Risk
- 纯移动拆分未触碰任何 set() 载荷语义；唯一微改写是 toggleDeveloperMode 从函数式 set 改为 get()+对象 set（等价求值，devMode 冒烟通过）。
- gameStore 剩余 622 行仍含对局动作+流程状态两组职责，阶段 B 第二对象是 EventProcessor（852 行，D-6：单一 processEvent 入口+事件族分文件，禁第二入口）。

## Qoder 2.2.13：稳定期阶段 B 第二刀——EventProcessor 纯移动拆分（D-6 推进）[Qoder/Qwen]

背景：用户在 2.2.12 闭环后口令"进行下一步"，按稳定期路线推进阶段 B 第二刀（决议 D-6：EventProcessor 拆分，单一 processEvent 入口+事件族分文件，不许出现第二入口）。零行为改动红线：玩法/引擎/规则一字未动。

变更（全部逐字搬移）：
- `core/EventProcessor.ts` 852→93 行：类只保留 `process`（cloneEngineState + 队列循环 + apply）与 `apply`（薄 switch 15 案例分发），类头注释新增单入口禁令（"do not add a second entry point that mutates EngineState from events"）。
- 新目录 `core/eventProcessors/`：`damageEvents.ts`(168，BASE_DAMAGE+DAMAGE，含技能伤害 applyArmorDamage 结算与 legacy 护甲兜底 Date.now——D-4 位置指针随迁至 damageEvents.ts:151)、`drawEvents.ts`(178，DRAW_REQUIRED+DRAW 含堆不足洗弃牌堆+DRAW_CONFIRMED 含补偿抽回归)、`generalEvents.ts`(214，GENERAL_DEPLOYED/GENERAL_MOVED/SUPPLY_RESOLVED/ARMOR_EQUIPPED+RESOURCE_TYPES)、`playerEvents.ts`(77，PLAYER_DEFEATED+GAME_OVER)、`turnEvents.ts`(95，TURN_END/TURN_ACTIONS_RESET/TURN_START/PHASE_CHANGED)、`chainedConsequences.ts`(112，`enqueueDerivedConsequences(queue,event,before,next)` 承接原 process 内联的四段派生连锁：DAMAGE 本营致死→PLAYER_DEFEATED、DEATH→DRAW_REQUIRED 补偿抽、BASE_DAMAGE→PLAYER_DEFEATED、PLAYER_DEFEATED→GAME_OVER/回合交接四连发)。
- 处理器一律纯 (state, event) → state 函数、仅经 EventProcessor 调用；`core/index.ts` 与外部消费方（GameEngine/测试）口径不变。
- AGENTS（模块图 core/ 行+Key Files 行）、ARCH_MAP（EventProcessor 行改 93 行时点、新增 eventProcessors/* 行、D-4 指针、D-6 进度"前两刀落地，剩 F 阶段 UI 三文件"）、CHANGELOG [2.2.13] 同轮刷新。

验证：
- check 0 错误；264 测试通过（32 文件，零增删）；覆盖率棘轮 41/34/32/46 维持通过（实测 stmts 42.09 / branch 34.67 / funcs 33.45 / lines 47.16，funcs 较上轮 +0.61 系拆出函数被真实测到）；lint 0 错误/30 遗留警告（零新增）；build 单文件 1,916.89 kB / gzip 562.51 kB。
- 浏览器冒烟（dev `__TK__` 直驱拆分后真实 store+引擎装配，非旁路）：createRoom→lobby；startTestArena 后 endTurn×4 连续驱动 TURN_END/TURN_START/DRAW_REQUIRED/DRAW_CONFIRMED/PHASE_CHANGED 走拆分后处理器（引擎 turn 2→5、round 1→2 进位正确、phase playing/ACTION 驻留）；快照链 createSerializedSnapshot('EP-Room-1')=4,565 字符→restoreSerializedSnapshot=true、错房号=false、空房号=既有守卫抛错；错误密码 toggleDeveloperMode=false。控制台仅两条 [Recovery] 拒收日志，均为故意投喂坏数据的演示性断言，应用自身 0 报错。
- CI 远端复验已完成：run `35940699193` 全绿（CI #35，master@262167f，test(22)/test(24)/lint/build 四 job 均过）；`6617b52`/`262167f`/标签 `v2.2.13` 直推成功。

Unresolved & Risk：①DAMAGE 案例内 `fallbackDestroyedArmor` 仍用 Date.now（D-4 待办，位置已迁、行为未动）；②DRAW 洗堆仍用 Math.random（D-2 待办）；③阶段 B 定义内的两刀已完成，剩余 SkillEditor/GameBoard/TestArena 整理属 F 序列，需用户口令再动。

## Qoder 2.2.14：稳定期 F 序列第一刀——SkillEditor 纯移动拆分（D-6 后三件之首）[Qoder/Qwen]

背景：用户在 2.2.13 闭环汇报后口令"继续"，授权开 F 序列第一件（决议 D-6 后三件：SkillEditor → GameBoard/TestArena）。零行为改动红线：玩法/引擎/规则一字未动，编辑器交互行为逐字保持。

变更（全部逐字搬移）：
- `components/SkillEditor.tsx` 1253→868 行。
- 新目录 `components/skillEditor/`：`skillExcelParsers.ts`(228，Excel/文本导入解析器七件套 parseSkillCell/clean/isDetailedFormat/isRowPerSkillFormat/resolveGeneralByNameFaction/parseRowPerSkillSheet/parseLegacyDetailedRow)、`TriggerEditor.tsx`(106，触发时机子编辑器含 selectCls——grep 证实该常量仅其内部使用)、`RuntimeEditor.tsx`(78，结构化效果子编辑器含 runtimeSelectCls/runtimePreviewText)。
- 披露微改（全部类型/关键字层面）：新导出接口 `SkillEditEntry`（与组件内联 editingSkills 状态类型逐字段一致）替换解析器内 5 处 `typeof editingSkills`，组件 useState 同步改用；迁出函数加 export（clean 保持私有）；解析器解除组件内 2 格缩进；SkillEditor import 面收窄（strToTrigger/detectEffectGroupWidth/parseEffectGroup 等随解析器迁走，TriggerEditor 系列符号随子组件迁走）。
- 有意留守：`handleImportFile`/`handleExport`/`isIncompleteForExport` 闭包依赖组件状态与 setter，非纯移动范围，留待下一刀评估。
- AGENTS（无 SkillEditor 行数引用，免改）、ARCH_MAP（UI 行更新+新增 skillEditor/* 行+D-6 进度"前三刀落地"）、CHANGELOG [2.2.14]、HANDOFF §3/§9/§13 同轮刷新。

验证：
- check 0 错误；264 测试通过（32 文件，零增删）；覆盖率棘轮 41/34/32/46 维持通过（实测 42.09/34.67/33.45/47.16，与上轮持平）；lint 0 错误/30 遗留警告（零新增）；build 单文件 1,916.59 kB / gzip 562.85 kB。
- 浏览器真实点击回归（dev 5202，全走拆分后组件实例）：图鉴→开发者模式→编辑器挂载、95 将列表；TriggerEditor 触发下拉 20 项→onDamageTaken（先试 onDeploy 无子项属既有口径非回归）→伤害类型子下拉 attackDamage→预览"受到伤害后→攻击伤害"→保存→store skillEdits 含 damageSubType→批删还原 0 编辑；多效果模式→RuntimeEditor 类型下拉（纯描述/DRAW_CARD/DAMAGE）→数值 3→目标下拉（自身/伤害来源/被作用者）→预览"造成 3 点技能伤害→被作用者"；真实 row-per-skill 11 列 .xlsx 经隐藏文件输入 fetch+DataTransfer 注入→拆分后解析器全链路→"✅ 从 1 个工作表导入 1 名将领"且落库正确→清理还原 0；导出按钮→"✅ 已导出Excel文件"；控制台 0 错误（仅 vite/React DevTools 常规信息）。
- CI 远端复验已完成：run `35944672735` 全绿（CI #37，master@f3e295c，test(22)/test(24)/lint/build 四 job 均 completed successfully）；功能提交 `0580e08`、登记提交 `f3e295c` 与附注标签 `v2.2.14` 已推送（直推成功，未借道代理）。

Unresolved & Risk：①GameBoard/TestArena 拆分（F 序列尾刀）仍待用户口令；②handleImportFile/handleExport 留守件是本文件剩余主体（868 行），下一刀若继续拆需先解闭包（非纯移动，需单独立项审批口径）；③2.2.0 登记的 §12-9 b/c/d 技能覆盖面待办不受本轮影响，维持 PENDING。

## Qoder 2.2.15：稳定期 F 序列第二刀——GameBoard 纯展示原语纯移动拆分（D-6 后三件之二）[Qoder/Qwen]

**背景**：用户对外报"下一步轮到棋盘与演练场"后回复"继续"，F 序列尾件获授权；按一刀一版本惯例本轮只做 GameBoard（TestArena 485 行留作下一刀，仍待口令）。盘点结论：GameBoard 704 行中，真正无状态捕获、可纯移动外迁的是**文件尾部五个顶层纯展示原语**（第 690-704 行）；`Slot`/`BSlot`/`TerritoryBottom/Top/Side`、`arrange()`、全部动作处理器/备忘录/副作用均闭包于组件 state 与 props，属非纯移动范围，本轮一律留守（与 2.2.14 SkillEditor 的 handleImportFile/handleExport 留守同理）。grep 确认五原语全库仅 GameBoard 自身引用。

**变更**：
- `components/GameBoard.tsx` 704→689 行（-16/+1）。
- 新文件 `components/gameBoard/uiPrimitives.tsx`（21 行）：SC（体力/护甲/近战/远程/基础统计小卡）、StatPill（toneMap 六色计数药丸）、Bar（底部浮动操作条）、Btn（确认/取消按钮，含禁用态）、Modal（弹窗骨架）逐字外移。
- 披露微改（全部关键字/注释层面）：文件尾新增一行聚合 `export { SC, StatPill, Bar, Btn, Modal }`（五个函数体一字未动）；头部中文说明注释三条。`React.ReactNode` 不 import React 亦可解析（TS UMD 全局类型规则），check 0 错误证实，未做任何类型改写。GameBoard 顶部新增一行 import。
- AGENTS/README（无 GameBoard 行数引用，免改）、ARCH_MAP（UI 行刷新+新增 uiPrimitives 行+D-6 进度"前四刀落地"）、CHANGELOG [2.2.15]、HANDOFF §3/§9/§13 同轮登记。

**验证**：check 0 错误；264 测试通过（32 文件零增删）；覆盖率棘轮 41/34/32/46 维持（实测 41.90/34.49/33.33/46.93，较 2.2.14 的 42.09/34.67/33.45/47.16 微降——纯系新文件头注释行摊薄，移动行两侧均未覆盖、状态无回归）；lint 0 错误 30 遗留警告零新增；build 单文件 1,916.59 kB/gzip 562.86 kB。浏览器真实点击回归（dev 5203，全部走拆分后组件实例）：正式流程建房(2人)→掷骰→定势力→双人征召各 10 将→初始抽牌 executeDraw(2) 两武将入手→playing；将领池 Modal+StatPill（武将9/文将1/魏7/群3 计数正确）、抽牌堆 Modal（14/12/16=42 卡片齐全）、弃牌堆/墓地空态；手牌武将 inspect 五张 SC+登场按钮；登场 Bar（消耗0/4）+Btn 禁用→选满 4 张→确认→deployTarget 提示→点营地格真实落子（廖化@camp:0，手牌清空）；场面武将 inspect SC 实时 4/4→🚶前进单目标直连（front:0）；⏸️菜单浮层七按钮+保存对局+返回+resetGame 归 menu；控制台 0 错误。注：后台标签定时器限流导致骰子动画组件卡"投掷中"，为既有环境现象非回归，改用 store 直驱跳过（2.2.13 冒烟同款手法）。

**Unresolved**：①TestArena（485 行）为 D-6 后三件最后一刀，开工前待用户口令；②GameBoard 进一步瘦身（Slot/Territory 等）需解闭包=非纯移动，单独立项待评估；③§12-9 b-d（技能覆盖面，阶段 C）维持 PENDING。
（收尾补记：推送后云端 CI #39 全绿——run 35948875546，master@ab78fd0，test(22)/test(24)/lint/build 四 job 均 completed successfully、双矩阵各 32 文件/264 用例。推送直连超时，一次性借道本地代理 127.0.0.1:10808 成功，未写持久配置。）

## Qoder 2.2.16：稳定期 F 序列最后一刀——TestArena 紧凑原语纯移动拆分（D-6 就此收线）[Qoder/Qwen]

**背景**：用户回复"继续F序列"，D-6 后三件的最后一件（TestArena，485 行）获授权。盘点结论：全文件真正无状态捕获、可纯移动外迁的只有**尾部三个顶层展示原语** SC/Bar/Btn（第 483-485 行）；`Slot`/`BSlot`/`TerritoryBottom/Top/Side` 内联子组件、Dev 面板三标签（玩家/场上/将领池）与全部动作处理器均闭包于组件 state 与 store，留守（与 2.2.14/2.2.15 同理）。关键边界决定：这三个原语与棋盘版 `gameBoard/uiPrimitives` 同名但是**紧凑 CSS 变体**（p-2 vs p-2.5、text-lg vs text-xl、bottom-[90px] vs bottom-[110px]、gap-3 vs gap-4、px-3 py-1 text-xs vs px-4 py-1.5 text-sm），**刻意不合并**——合并=改样式=行为变化，违背纯移动纪律；TestArena 也没有 StatPill/Modal 等价件（其检视弹窗是内联 JSX，不是组件）。

**变更**：
- `components/TestArena.tsx` 485→483 行（-3/+1）。
- 新文件 `components/testArena/compactPrimitives.tsx`（10 行）：SC（统计小卡）/Bar（底部浮动操作条）/Btn（确认/取消按钮，含禁用态）逐字外移；文件头四条中文注释钉死"紧凑变体刻意不合并、未来统一需单独立项做视觉回归"的决定。零微改：三个函数体一字未动，`React.ReactNode` 依旧走 UMD 全局类型解析；TestArena 顶部新增一行 import。
- AGENTS/README（无 TestArena 行数引用，免改）、ARCH_MAP（UI 行三文件全刷新+新增 compactPrimitives 行+D-6 收线）、CHANGELOG [2.2.16]、HANDOFF §3/§9/§13（F 序列收线、下一轮阶段 C 待口令）同轮登记。

**验证**：check 0 错误；264 测试通过（32 文件零增删）；覆盖率棘轮 41/34/32/46 维持（实测 41.90/34.49/33.33/46.93，与 2.2.15 完全持平）；lint 0 错误 30 遗留警告零新增；build 单文件 1,916.59 kB/gzip 562.85 kB。浏览器真实点击回归（dev 5204，startTestArena 四人演练场，全部走拆分后 compactPrimitives 实例）：将领池标签搜索"廖化"→点击入手牌（5→6）→手牌瓷砖 inspect SC×4（❤️4/⚔️2/🏹1/🛡️0）→⚔️登场将领→Bar"登场：廖化 (消耗0/4)"+Btn 确认禁用→点 4 张消耗瓷砖→确认解禁→deployTarget Bar"📍点击营地空格放置"→点绿框(borderColor rgb(34,197,94))营地格真实落子（camp:0，手牌 6→1）→场上 inspect SC 实时 4/4+本回合计数行+近战/远程/补给禁用态（射程无敌/满血/手牌不足）→🚶前进单目标直连（front:0）→Dev"场上"标签执行伤害（4/4→3/4，animate-base-hit 命中动画触发）→补给 Bar"已选0张，补0点"确认禁用→选 1 张军粮→确认回 4/4、手牌清空→计数行"🚶移动 1次💊补给 1次"→玩家切换 idx 0→1→⏭️结束回合 1→2→✕ 退出归 menu；控制台 0 错误 0 警告。

**Unresolved**：①阶段 C（技能覆盖面：HEAL/GAIN_ARMOR、触发、技能击杀→DEATH 链，即旧 §12-9 b-d）为稳定期下一轮，开工前待用户口令；②三大 UI 文件进一步瘦身（Slot/Territory/Dev 面板等闭包绑定件）需解闭包=非纯移动，单独立项待评估；③compactPrimitives 与 uiPrimitives 的合并统一同上（需视觉回归），稳定期内不动。
（收尾补记：推送后云端 CI #42 全绿——run 35952936795，master@3b3bf36，test(22)/test(24)/lint/build 四 job 均 completed successfully。直推成功，未借道代理。）

## Qoder 2.2.17：稳定期阶段 C 首刀——HEAL/GAIN_ARMOR 真实结算 + 技能击杀→DEATH 链接通（旧 §12-9 b/d 销案）[Qoder/Qwen]

**背景**：用户口令"好吧，做阶段C"。范围经盘点后与用户口径确认为 b+d 两项：HEAL/GAIN_ARMOR 效果接入结算、技能致命伤补发 DEATH 打通 onKill/onDeath/补偿抽链；c（ReactionWindow 业务入口）与无引擎事件支撑的触发种类（modify*/onBase*/passive/active*/untilExpire/onOtherDeploy/onTurnEnd/onBecomingTarget/onTargetConfirmed/onOtherSkillActivated）维持 PENDING。核心难点（d）：技能致死只在 **apply 时刻**才可知，而触发链跑在 dispatch 前冻结态上——DAMAGE 处理器直接移除将领后没有任何事件告诉引擎"这人死于技能"。解法定型为"派生 DEATH + 有界重入"：既守住 D-2 单一改动入口（EventProcessor.process 是唯一 state→state 通道），又让死亡技能链完整展开。

**变更**：
- `core/Event.ts`：GameEventType += `HEAL | GAIN_ARMOR`。
- `core/eventProcessors/generalEvents.ts`：新增纯处理器 `applyHealEvent`（治疗封顶 maxHp；不在场武将=诚实 no-op，如自身 onDeath 治疗）与 `applyGainArmorEvent`（currentArmor 点数累加——护甲点数货币而非实体护甲卡，与编辑器预览"获得 N 点护甲"口径一致）。
- `core/EventProcessor.ts`：apply() += 两 case；`process(state, events, collected?)` 增可选**追加收集**参——队列中途派生的事件在入队点被收集（队列切片差），旧调用方零影响。
- `core/eventProcessors/chainedConsequences.ts`：DAMAGE 分支扩展——`damageType==='skill'` 且目标将领 before→after 从 fieldGenerals 消失时派生 `DEATH{targetPlayerId, targetId, attackerPlayerId, attackerId, skillKill:true}`；普攻击杀已由 AttackResolver 自带 DEATH，该门条件即去重保证。
- `core/GameEngine.ts`：dispatch 增加**有界重入回合**（`MAX_TRIGGER_REENTRY_ROUNDS=8`）：收集到的派生 DEATH 以应用后状态再展开触发链（DEATH/TRIGGERED 本身不重复状态处理），超出上限发 CUSTOM `TRIGGER_REENTRY_LIMIT` 哨兵。
- `skills/SkillTriggerBridge.ts`：HEAL/GAIN_ARMOR 效果翻译为真实事件（findGeneralRef 解析目标所在玩家；命中基地目标的兜底 playerIdFromBase）。
- `skills/skillCompiler.ts` / `skills/skillExcelFormat.ts`：SUPPORTED_EFFECT_TYPES 与 SETTLEABLE_RUNTIME_TYPES 升为四类型——编辑器"暂未接入结算"标注随数据源自动消失。
- 测试：`skillCompiler.test.ts` 的 HEAL/GAIN_ARMOR 跳过断言改写为编译断言；`skillPipeline.test.ts` +4（HEAL 封顶 5→maxHp、GAIN_ARMOR 0→2、技能击杀集成：onDeath(100) 先于 onKill(60) 结算的牌堆序断言+graveyard+补偿 drawState、普攻击杀恰好 1 条 DEATH 去重）。264→268 例/32 文件。内置武将全部仍为纯描述（编译器跳过），现有内容零行为变化。
- 覆盖率棘轮上调 42/34/33/47（实测 42.46/35.11/33.85/47.49；branch 两轮抖动 35.11–35.28，地板留 34 防 CI 矩阵误杀）。
- AGENTS/README（无需改动项经 cross-check 确认）、ARCH_MAP（Event/GameEngine/EventProcessor/eventProcessors/skills 行刷新）、CHANGELOG [2.2.17]、HANDOFF §3/§9/§12-9/§13 同轮登记；另记用户决定：三大 UI 文件解闭包瘦身**不再进行，除非有明确收益**。

**验证**：check 0 错误；268 测试通过（32 文件）；lint 0 错误 30 遗留警告零新增；build 单文件 1,918.69 kB/gzip 563.24 kB；`npm run ai-battle -- --games 300 --seed 1` VIOLATIONS=0（won=300、均值 19ms、最慢 136ms）。浏览器 E2E（dev 5203，store 直驱 `__TK__`——本轮真实点击被自动化环境连续拒绝，改用 2.2.13 起既受口径的直驱法，如实登记）：正式流程（建房 2 人→掷骰→定势力→双人征召含 updateSkillEdit 烘焙 烈攻/枭斩/疗愈/遗志→初始抽牌 executeDraw+confirmDraw）进 playing 后 `restoreEngineState` 种场面（黄盖 hp2 上手加固甲、许褚满血 hp4 入 p2 场、粮草入手），再走**真实 store 动作**：①setCurrentPlayerIndex(1)+endTurn→p1 TURN_START 疗愈 hp 2→4（+3 封顶）+ 固甲护甲 0→2；executeDraw(0,5)+confirmDraw 过回合抽；②attackTarget（**运行时 instanceId**——首次用裸定义 id 被 ATTACKER_NOT_CONTROLLED 正确拒绝，改 instanceId 后放行）近战 2+烈攻技能 3 击杀满血许褚→墓地收尸、遗志 onDeath p2 手牌+1、枭斩 onKill p1 手牌+1（耗 1 粮后净+0 对上）、"玩家2 击破补偿抽卡" drawContext 呈现→executeDraw(0,1)+confirmDraw→phase playing、currentPlayerId 归 1；③UI 快照 黄盖"⚔️ 黄盖 🛡️2 ❤️4/4"、墓地(1)、抽牌堆 43，控制台 0 错误。诚实边界：截图未产出（页面后台 viewport 不可见，快照+控制台代替）；editor 下拉新标注以服务端模块 fetch（同源 5203 确认 SETTLEABLE 四项）+jsdom 冒烟覆盖，未做弹窗内真机点击。

**Unresolved**：①§12-9c（ReactionWindow 业务入口）与无引擎事件触发种类维持 PENDING，属阶段 C 剩余面；②下一轮按序为阶段 D（RNG 进 EngineState.rngState，决议 D-2），待用户口令；③有界重入的 8 轮上限在真实内容规模下（当前无任何内置武将带 runtime）不可能被触达，哨兵仅防守未来链式自炸内容。

（收尾补记：推送后云端检查一次通过——编号 35965467286（CI #44，master@926a530，3m 14s），test(22)/test(24)/lint/build 四 job 均 completed successfully，双 Node 矩阵各 268 例/32 文件全过；本次直连推送即成功，没有借用代理。）

## Qoder 2.2.18：稳定期阶段 D 首刀——引擎随机进 EngineState.rngState（决议 D-2 主件）[Qoder/Qwen]

**背景**：用户口令"开始阶段D"。范围与旧数据兼容两问均答"[No preference]"→代决定为**中刀**（引擎核心抽牌链+AI 种子统一，withSeededRandom 收窄不删除）+ **缺字段惰性播种、不 bump 任何版本号**。盘点（Explore 全库扫）钉死随机源分布：引擎路径=Math.random 在 DrawResolver 两处（将池洗牌/弃牌堆有偏重洗）与 drawEvents 技能摸牌一处（有偏重洗）；建局路径（createCardDeck/runtimeSetup/matchSetup）与 policy 属外围；action.id/instanceId 是非选择型不确定源（本轮不动，PENDING）。架构约束决定收敛方向：resolver 契约是"描述发生了什么"、不得改动状态，因此 RNG 消费点必须在 EventProcessor 家族——把 DrawResolver 的选牌整体迁入 applyDrawEvent（该处技能摸牌分支本就在处理器选牌，两分支合一）。录像明牌 UI 安全性经审：gameStore.executeDraw 的 revealed 来自手牌差分（afterHand.slice(beforeHand)）而非事件载荷，删字段无 UI 影响。

**变更**：
- 新增 `core/rng.ts`（49 行）：mulberry32 游标 `{ s: uint32 }` 纯数据（structuredClone/JSON 双友好）；`createRngState/cloneRngState/rngNext/rngShuffle`（返新数组；替代有偏 `sort(()=>Math.random()-.5)`）。
- `core/GameState.ts`：`EngineState.rngState?` **可选**字段（旧快照/旧录像宽容加载、零版本号变更）；createInitialEngineState 播种常量 0x9e3779b9。
- `action/resolvers/DrawResolver.ts` 重写：只校验三拒（NO_PENDING_DRAW/DRAW_PLAYER_NOT_FOUND/DRAW_TOTAL_MISMATCH），产**计数式** DRAW 事件 `{playerId, requestedGeneral, requestedCards, count, reason}`——选牌与 Math.random 全部清零（D-2"禁 Resolver 私拿随机源"达成）。
- `core/eventProcessors/drawEvents.ts`：applyDrawEvent 成为**全引擎唯一抽牌选牌点**——将池 rngShuffle、牌堆顶切、弃牌堆种子重洗；游标推进写回返回态；EventProcessor.process 单克隆贯穿队列→多事件链游标连续；缺游标旧局按 `(turn+1,round+1,deckLen)` 派生确定性兜底种子（旧档首抽可复现）。技能摸牌裸 count 载荷（SkillTriggerBridge 的 `{...data, playerId, count}`）经 `data.requestedCards ?? data.count ?? data.value` 兼容，bridge 零改动。
- `store/gameStateAdapter.ts`：`seedRngState`——建房播种一次（Date.now^random），局中已有游标绝不重置（防中途重掷）；isRestorableEngineState 不动（未知字段宽容=向后兼容策略 D-4 口径）。
- `ai/matchSetup.ts`：buildMatchState 返回 `rngState: createRngState(config.seed)`——AI 局引擎抽牌流从状态游标来，与 withSeededRandom（继续覆盖建堆/采样/policy）双轨分立。
- `ai/rng.ts` 头注刷新为收窄口径（全退 PENDING）。
- 测试 268→**287/35 文件**（净 +19）：`core/rng.test.ts` 8（同种子同流/异种异流/[0,1) 界/JSON 往返续流/clone 兜底/洗牌确定性/真置换/游标就地推进）；`eventProcessors/drawEvents.test.ts` 8（同状态重放同结果/仅随机选择才耗游标/将池抽牌落库/弃牌堆重洗/裸 count 技能摸牌/旧档惰性播种且游标写回可续/多事件队列贯穿/两类 no-op）；`DrawResolver.test.ts` 重写 8（三拒+计数契约+**Math.random 抛错探针**+resolve 纯等性；旧 3 例选牌断言换契约）；`store/executeDraw.rng.test.ts` 3（生产 store 建房游标可序列化/同 engineState 快照重放同抽/改种子变抽）；gameFlow ①⑨ 两处"Math.random mock=恒等洗牌"精确 id 断言改阵营纯度正则（rngState 下 mock 已无效，如实登记）。

**行为变化（披露）**：抽牌结果分布与 2.2.17 前不同（种子洗牌替代有偏 sort+流拆分，D-2 预期内）；牌堆顶序、补偿抽、UI 明牌零变化；旧录像/旧存档照常加载（缺 rngState 走惰性兜底种子）。

**验证**：check 0 错误；287 测试通过；覆盖率棘轮**维持** 42/34/33/47（实测 42.55/35.14/34.01/47.55，四项均较 2.2.17 微升，地板不动）；lint 0 错误 30 遗留警告零新增；build 单文件 1,918.75 kB/gzip 563.32 kB；`npm run ai-battle -- --games 300 --seed 1` **两轮摘要完全一致**（won=300、VIOLATIONS=0、胜席 {1:112,2:188}）——同种子确定性在 300 局规模实证。**浏览器真机 E2E 未做**（诚实边界）：本轮自动化权限分类器对页面导航全通道拒绝（browser-use navigate 两条路径均被拦、chrome-devtools 无 Chrome 可执行），等效验证降级为 vitest 生产 store 链路（executeDraw.rng 3 例 + aiTurnDriver 全店完整局在 287 内）；真机抽牌面回归登记 PENDING。

**Unresolved**：①D-2 剩余欠账登记 §12-16：RandomOutcome 事件流（"记结果不记重掷"仍未达成，现状态是"重掷可复现"）、建局随机迁入 rngState、action.id/instanceId 确定性、withSeededRandom 彻底退役、battleRunner lockstep 清理、ReactionWindow 窗口 id（§12-9c 同源）；②本刀浏览器真机面待下个可做版本优先补；③下一轮按序为阶段 E（引擎生命周期常驻，D-1），开工前待用户口令。

（收尾补记：云端检查第一遍**没过**——docs 提交 265d225 的 run #46（编号 35974231930）里 test(22)/test(24) 在 `npm run check` 步骤报 TS6133：`src/store/executeDraw.rng.test.ts` 第 11 行残留一个没用到的导入 `createLobbyPlayers`（lint 绿、build 被跳过）。根因复盘：本地那次"check 0 错误"跑在该测试文件最后一次编辑**之前**，属陈旧验证——以后全套验证一律放到所有文件定稿之后、提交之前再跑。处置：删该导入（零行为变化）→ 本地 check 0/287 测试/覆盖率 42.55-35.14-34.01-47.55/lint 0 错 30 警告/build 1,918.75 kB 重跑全绿 → fix 提交 620a0a0；经用户授权标签 v2.2.18 强制重指到 620a0a0（只动这一个 tag ref，master 正常推送）。推送：直连超时→一次性 `-c http.proxy=http://127.0.0.1:10808` 成功（未写持久配置）。CI #47（编号 35975699142，master@620a0a0）全绿：test(22) 1m59s、test(24) 1m3s、lint 1m15s、build 59s，四 job 全部 completed successfully。）

## Qoder 2.2.19：稳定期阶段 D 第二刀——建局随机入游标、id 确定性化、withSeededRandom 彻底退役（决议 D-2 之 b/c/d）[Qoder/Qwen]

**背景**：用户口令"补阶段 D 第二刀"。范围问答确认 **b+c+d 本刀、a（RandomOutcome 事件流）单独一刀**。§12-16 欠账清单即本刀任务书：b) 建局随机迁入 rngState、c) action.id/instanceId 确定性化、d) withSeededRandom 退役+lockstep 清理；另 2.2.18 欠的浏览器真机 E2E 本刀补上。关键盘点事实：engine-aware setter 每次 set 都会从 store 态重建 engineState 投影——若建局步骤先消耗 Math.random 再 set，游标会被播种覆盖，因此建局五步必须**同批**提交"补丁+推进后的游标"，这就是 setupCursor/commitSetup 模式的由来（commitSetup 手工构造与 setter 投影等价的 engineState，唯一可观测差=游标前进）。

**变更**：
- **b) 建局随机入游标**：`data/cards.ts` `createCardDeck(random = Math.random)`；`setup/runtimeSetup.ts` 四函数（createLobbyPlayers/rollAndSortPlayers/assignFactions/buildDraftCandidates）加 `random` 注入参并贯穿全部洗牌/采样；`store/gameStore.ts` 新增 `setupCursor()`（=`cloneRngState(engineState.rngState, 1)`）与 `commitSetup(patch, rng)`，createRoom/rollDice/assignFactions/distributeDraftGenerals/confirmDraft 候选补抽五步统一消费游标；默认 Math.random 回落仅供 dev 工具与 UI 骰子。人机实战 aiTurnDriver 走 store 动作故自动覆盖；`gameStateAdapter.seedRngState` 仍是唯一实战熵入口（建房一次性、局中不重置）。
- **c) id 确定性化**：`action/ActionTypes.ts` `createAction` id→进程计数器 `action_N`（消费方仅做关联、从不按 id 查找）；`utils/runtimeIdentity.ts` `createRuntimeInstanceId` 去掉 Date.now+Math.random→纯计数器 `__inst_{serial36}`（全库按相等性使用；旧录像 id 已内嵌 initialState 不受影响）；`ai/matchSetup.ts` 种子盖戳（`ai{seed}_c{n}`）扩到卡与注入技能——原靠测试归一化豁免的泄漏面消失。
- **d) withSeededRandom 退役**：删除 `src/ai/rng.ts`。三流显式分离：局内引擎抽牌 `rngState=createRngState(seed)`；装配流 matchSetup 内部 `createRngState((seed ^ 0x9e3779b9)>>>0)` 贯穿建堆/阵营/采样/技能注入；策略流 battleRunner `createRngState((seed ^ 0x85ebca6b)>>>0)` 经 `AiPolicy` 新增可选第三参 `random?: () => number` 注入（randomPolicy 默认回落 Math.random——实战域人机对战无注入属预期行为，aiTurnDriver 两参调用不变）。**lockstep 清理**：复放模式不再咨询策略，录像动作按记录经 `createAction(rec.type, rec.playerId, rec.payload)` 直接重建；runMatch 体包进 `const run = (): MatchResult => {...}; return run();`（避免整段重缩进）。
- **测试** 287→**291/36 文件**（净 +4）：新建 `store/setupDeterminism.test.ts` 3 例（固定种子 setState 后跑建局五步：同 seed 玩家/牌堆/征召候选/游标逐字段全等、异 seed 分歧、createRoom 后游标确已前进且≠初值）；`battleRunner.test.ts` 确定性断言升级为**动作序列全等** + 新增"无补丁全局局"（Math.random 换抛错函数跑完 seed 505 整局，证明 AI 链路已无全局随机源依赖）；`matchSetup.test.ts` 去包装重写（同 seed 全状态 deep-equal、首卡 id 精确 `ai77_c0`）；`DrawResolver.test.ts` 抛错探针收紧（action 构造也移入探针内）。
- 覆盖率棘轮 functions 33→**34**（实测 funcs 34.26-34.45；branch 地板留 34 防抖动，与 2.2.17 同一处置）。

**行为变化（披露）**：**AI 对战 seed→胜负分布改变**——装配流从全局补丁拆为独立播种流所致：`ai-battle --games 300 --seed 1` 胜席 {1:112,2:188}（2.2.18 基线）→ {1:109,2:191}（本刀），两轮均 won=300/VIOLATIONS=0、两遍输出内容逐字一致；规则语义零变化，但**平衡观测台历史数据需重锚**。实战人机对战建局/抽牌分布随游标化亦有种子层面变化（D-2 预期内，延续 2.2.18 披露口径）。旧录像/存档加载不受影响（instanceId/action.id 内嵌于 initialState 或仅做相等性关联）。

**验证**（定稿红线：全部文件定稿后、提交前跑满五闸）：check 0 错误；291 测试通过；覆盖率 42.61-42.81/35.19-35.54/34.26-34.45/47.59-47.84 过 42/34/34/47；lint 0 错误 30 遗留警告零新增；build 单文件 1,918.71 kB/gzip 563.39 kB；ai-battle 300 局×2 遍内容逐字一致。**浏览器真机抽牌 E2E（§12-16 欠账销案）**：dev 5199（复用既存 vite 实例，Vite 读盘即最新版）人机对战 2 人房真实点击全链路——建房→骰子 9/8→势力分配→征召 10 将（含许褚点选核对）→回合 1 抽牌面 2 将领+3 卡盖→选择确认→playing 渲染，console 0 错误。环境形态如实登记：内置浏览器视口隐藏致 CDP 指针输入不可用（NATIVE_BROWSER_VIEWPORT_UNAVAILABLE；chrome-devtools MCP 无 Chrome 可执行），改以 `evaluate_script` 派发真实 DOM `.click()`（React 走真实事件处理器）+ 既有测试骰子限流补丁（后台标签 setInterval 被 Chrome 拉长所致，非产品 bug），每次刷新需重注入。

**Unresolved**：①D-2 仅剩 a) RandomOutcome 事件流（"记结果不记重掷"——当前达成的是"全局可复现"而非"记结果"；用户已定夺单独一刀）与 e) 观察项（ReactionWindow 窗口 id、DiceRoll.tsx 纯 UI 骰子、testArenaActions/generateRoomName 豁免面，均 §12-16 登记）；②平衡观测台历史数据用新基线 {1:109,2:191} 重锚待做；③下一轮按序仍为阶段 E（引擎生命周期常驻，D-1），开工前待用户口令。

（收尾补记：feat `086ff39`、docs `8646a05` 与附注标签 `v2.2.19` 一次推送——直连超时，一次性借道本地代理 127.0.0.1:10808 成功，未写持久配置。push 事件按顶端提交建单 run：CI #50（编号 35984979124，master@8646a05，覆盖 feat+docs 全树）**全绿**，test(22)/test(24)（291 例双 Node）/lint 1m14s/build 1m17s 四 job 均 completed successfully，run 页零失败标记。）


## Qoder 2.2.20：稳定期阶段 E 首刀——TransitionCore 唯一纯转移抽出、三路对账钉死、ReplayPlayer 技能注册修复（决议 D-1）[Qoder/Qwen]

**背景**：用户口令"开工吧"+授权创建 TransitionCore.ts；范围口径确认四点：①纯转移抽出 ②常驻 vs 重建对账测试 ③ReplayPlayer 修复 ④除③外零行为变化——**store 常驻迁移（gameStore 持有长生命周期引擎）明确顺延下一刀**。盘点关键事实：所有实况消费方（engineExecutionBridge/battleRunner/ReplayPlayer）此前各自新建引擎，转移逻辑藏在 GameEngine.dispatch 里与容器副作用（打戳发射/STATE_CHANGED/录像/快照）缠绕；EventBus.emit 会**就地**给事件对象盖 id/timestamp，并经 TRIGGERED.data.sourceEvent 共享引用与时间派生 rootEventId 泄漏进事件载荷——对账测试必须归一化这一层，纯转移路径本身不产生这些字段。

**变更**：
- **新增 `core/TransitionCore.ts`（97 行）**：`transition(state, action, ctx: TransitionContext{rules,resolvers,processor,triggers}) → {state, events, accepted}`。原 dispatch 的"校验（ACTION_REJECTED 早退）→ getResolver（NO_RESOLVER 早退）→ ACTION_ACCEPTED + resolver.resolve → resolveTriggerChain → EventProcessor.process → DEATH 有界重入循环"逐字移入；`MAX_TRIGGER_REENTRY_ROUNDS=8` 常量随迁（GameEngine 中彻底移除，曾出现重复声明导致编译错，一并清除）。
- **GameEngine 降为薄容器（~113 行）**：`dispatch` = `transition(this.state, action, this)` + 容器侧效应——rejected 即时 emit（录像记 before=after 同快照）；接受路径 transition 之后 push `STATE_CHANGED{action, snapshot}`、emit 循环、recordHistory 门控的 `replay.record` + `snapshots.capture`（sequence=export().length+1）。可观测行为逐字不变。
- **ReplayPlayer 修复（本轮唯一行为变化）**：此前只在构造时 registerPlayerSkills，**中途登场将领的技能在重建回放里永不注册**；现循环内每次 dispatch 前 `syncPlayerSkills(engine, engine.state)`——与实况每步路径（生产桥）完全同构。安全性依据：SkillTriggerBridge 触发 id=`skill:${ownerId}:${skill.id}`，TriggerEngine.register 按 id Map.set 幂等替换，常驻实例重复注册无害。ReplayPlayer 无 UI 消费方，影响面仅录像工具链。
- **三路对账测试 `core/transitionEquivalence.test.ts` 3 例（291→294/37 文件）**：4 步脚本（近战击杀链：烈攻 onDamageDealt 补伤→遗志 onDeath 摸牌→枭斩 onKill 摸牌→DEATH 重入触发链；前进移动；补偿抽窗拦截 END_TURN 的 ACTION_REJECTED 步）。路径 A=单个常驻引擎连跑；路径 B=每步经生产桥 `dispatchStoreAction` 重建；路径 C=把 A 的录像文档交 ReplayPlayer 重建整局。断言 **逐步原始事件序列全等 + 终态 JSON 全等**（三路一致）。归一化只剥离容器打戳产物：{type,data} 形事件对象的 id/timestamp 与时间派生 rootEventId；首跑 2/3 失败即因 emit 就地打戳经 sourceEvent 共享引用漏进比对，补 normalize 后 3/3 绿——该层事实已写入文件头注释。
- D-1"禁止双路长期执行"纪律达成：**转移逻辑全库仅 TransitionCore 一份**，常驻与重建只是两种持有状态的外壳，重建式执行降级为对账工具。

**行为变化（披露）**：仅 ReplayPlayer 每步技能注册修复（录像重建回放与实况一致性提升；无 UI 消费方）。其余零变化——`ai-battle --games 300 --seed 1` 胜席分布 {1:109,2:191} 与 2.2.19 基线**逐字一致**（won=300/VIOLATIONS=0），AI 整局链路零漂移实锤。

**验证**（定稿红线：全部文件定稿后、提交前跑满五闸）：check 0 错误；294 测试通过（37 文件，+3）；覆盖率棘轮维持 42/34/34/47（实测 stmts 43.04 / branch 35.54 / funcs 34.55 / lines 48.11，四项均较 2.2.19 微升，地板不动）；lint 0 错误 30 遗留警告零新增；build 单文件 1,919.03 kB/gzip 563.48 kB；ai-battle 300 局分布与基线一致。**浏览器真机 E2E（dev 5199 人机对战 2 人房，DOM 真实点击+骰子限流技巧）**：登场庞德（手牌 5→1）→🚶前进（engineState 实证 position=front:0/areaOwnerId=1）→⏭️结束回合→AI 完整回合（抽卡+登场邓艾+前进+结束，全部经 TransitionCore 新链路）→第 2 轮玩家抽卡确认（骰子明牌 5 张）→🏹远程攻击流程（近战因射程内无敌被禁用属规则正确，选消耗卡→"点击高亮目标"提示条出现）——console 全程 0 错误 0 警告。E2E 插曲如实登记：登场环节数次"点击营地无响应"，经 `dispatchStoreAction` 直驱探针（返回 ACTION_ACCEPTED+GENERAL_DEPLOYED+STATE_CHANGED）排除引擎回归，根因=测试驱动在同一 evaluate 里批量点击多个嵌套节点污染了 GameBoard 局部选择态；教训"一次 evaluate 只点一个 React 元素"已入项目记忆。另确认 Vite HMR 陷阱：console `import('/src/store/gameStore.ts')` 拿到的是全新模块实例（phase:menu），必须用 performance 资源条目里的 `?t=` 时间戳 URL 才能触达活 store。

**Unresolved**：①store 常驻迁移（gameStore 持长生命周期引擎）顺延下一刀（用户口径）；②D-2 欠账不变：a) RandomOutcome 事件流（单独一刀）+ e) 观察项（§12-16）；③CI 远端复验待回填。

（收尾补记：feat `518bb6f`、docs `ee761ba` 与附注标签 `v2.2.20` 一次推送——直连超时，一次性借道本地代理 127.0.0.1:10808 成功，未写持久配置。push 事件按顶端提交建单 run：CI #52（编号 35995323024，master@ee761ba，覆盖 feat+docs 全树）**全绿**，test(22)/test(24)（294 例双 Node）/lint/build 四 job 页面徽标全部 completed successfully、零失败标记。回填提交另起一 run，按约定只核验回填这一级。）


## Qoder 2.2.21：稳定期阶段 E 第二刀（收线）——store 常驻迁移落地：桥内唯一长生命周期引擎容器、adopt-clone 语义、重建式执行降级为对账工具（决议 D-1 闭环）[Qoder/Qwen]

**背景**：用户批准两刀连做计划（先 v2.2.21 store 常驻迁移、后 RandomOutcome 事件流一刀，除中途暴露需优先解决的问题外不打断），本刀为阶段 E 第二刀。计划稿原案="入参 engineState 与容器上次 snapshot 同一性匹配则复用常驻引擎，否则保守降级重建"。**实施前设计评审否决了同一性匹配**：gameStore 的 engine-aware setter 每次 set 都把投影字段与快照**别名共享**（`players: engineState.players` 是同一数组对象），任何就地改写都不会改变引用同一性，匹配判定会漏检——双头真相风险恰恰藏在"看起来能省钱"的那一步。改采 **adopt-clone 语义**：常驻容器每步无条件采纳入参 engineState 的克隆作为自己的状态。这在结构上恒等于旧重建路径消费的输入（同一份数据、同一条 TransitionCore），却保住了容器实例供未来 Reaction/网络接线；外部改写 store 态（读档、resetGame、testArena 装配）因"每步重读入参"天然被尊重，**计划稿的重建失效钩子整个不需要了**。

**变更**：
- **`store/engineExecutionBridge.ts` 常驻化**：模块级单例 `{engine, registeredOwners, dispatches}`，`new GameEngine(state, {recordHistory: false})`——对局级录像已由 liveReplayRecorder 每步投喂单路承接，常驻引擎若再挂自己的 ReplayRecorder/SnapshotManager 链=零读者的双倍内存增长，故旁路。dispatch 序：adopt 克隆 → 技能注册表全量重登记 → `engine.dispatch` → `snapshot()` → `recordLiveDispatch`。gameStore 八个调用点签名不变、零改动。
- **技能注册每步 resync（复刻 fresh-engine 语义）**：`syncPlayerSkills` 只注册从不注销（Map.set），常驻表会让上一步阵亡的将领继续触发。现每步先按上一批 ownerId `unregisterPlayerSkills` 再全量 sync——注册表内容与"新建引擎跑这一步"逐字节一致（TriggerEngine 排序稳定，Map 插入序即优先级并列序）。
- **重建式执行降级为对账工具**：`dispatchStoreActionReconcile` 保留 2.2.21 前的每步重建语义（新引擎、默认 recordHistory），**刻意不喂 liveReplayRecorder**——生产录像归常驻路独占，两路因此在测试里可并跑对账而零双录。
- **测试 294→297 / 37 文件**（`core/transitionEquivalence.test.ts` 3→6 例）：主对账升级为**四路全等**（A 直接常驻引擎连跑 === B `dispatchStoreActionReconcile` 重建 === C store 常驻桥 `dispatchStoreAction` === D ReplayPlayer 回放 A 的录像文档，逐步原始事件序列+终态全等）；容器专例 3——①连续 dispatch 复用同一 GameEngine 实例（`__residentEngineProbe()` 引用同一性+dispatches 1→2）；②跨步 resync 清死将：第 1 步击杀后 `:g2:` 绑定仍在表中，第 2 步 resync 后与全新重建的注册表全等且无 g2；③别名态被消费：直接就地改写入参 `players[0].hand`（模拟 gameStore 别名改写），桥与对账路结果仍全等。测试缝 `__resetResidentEngineContainer`/`__residentEngineProbe`。
- 文档随刀修正：`skillCompiler.ts` 过时注释（"store 每次 dispatch 新建引擎"）、ARCH_MAP（C-1 引擎现状、B 表 bridge/GameEngine/TransitionCore 行、D-1 行标收线、D-2 行建局随机销案状态滞后）、AGENTS 引擎生命周期条目（D-1 closed 口径+禁把容器当真相源）、README/HANDOFF 测试数 297。

**行为变化（披露）**：**零**——这不是"变化后重锚"，是"根本没动"：`ai-battle --games 300 --seed 1` 胜席分布 {1:109,2:191} 与 2.2.19/2.2.20 基线**逐字一致**（won=300/VIOLATIONS=0）；测试面除新增例外全部原断言通过（含 skillPipeline 连跑多步过桥的既有用例）；package.json/lock 2.2.20→2.2.21。

**验证**（定稿红线：全部文件定稿后、提交前跑满五闸）：check 0 错误；297 测试通过（37 文件）；覆盖率棘轮维持 42/34/34/47（实测 stmts 43.30 / branch 35.52 / funcs 34.95 / lines 48.40，branch -0.02 系桥文件拆常驻容器后的分母漂移，地板不动）；lint 0 错误 30 遗留警告零新增；build 单文件 1,919.38 kB/gzip 563.60 kB；ai-battle 300 局分布与基线逐字一致。**浏览器真机 E2E（dev 5199 人机对战 2 人房，DOM 真实点击+骰子限流技巧，全新起服故活 store 走裸 `import('/src/store/gameStore.ts')` 无需 `?t=`）**：完整开局链（骰子 7/6→确认座次→AI 座自动征召→玩家真实点击征召 7 晋+3 群→确认→初始抽卡 2 将+3 卡→AI 抽卡→开始行动→playing）+对局链**全程走常驻桥**：登场司马懿（点手牌→登场将领→**至少消耗 1 张手牌**的口径：点锡矿使"确认位置"解禁→deployTarget 点己方营地格落子 camp:2；probe dispatches 10→11）→⏭️结束回合→AI 司机完整回合（→17）→第 2 轮玩家回合抽 5 张确认→开始行动→🚶前进（选精钢锭耗卡→营地→前线 slot2 自动落位 hasMoved=true；→20）。`__residentEngineProbe()` 实证单容器单调复用无重建；console 0 错误 0 警告（仅 vite/React info）。登场 UI 小插曲如实登记：先按记忆口径点营地/前线格无反应，查 `GameBoard.tsx:507` 确认"确认位置"启用条件是 `depCards.length>0`（登场至少耗 1 张），属 UI 规则而非本刀回归。

**Unresolved**：①D-2 欠账不变：a) RandomOutcome 事件流（下一刀 2.2.22，同一授权）+ e) 观察项（§12-16）；②常驻容器的长生命周期业务接线（ReactionWindow 入口/网络）随各自需求另立刀次。（③CI 远端复验**已回填**：当晚 v2rayN 未启动致直连/代理双败，用户开启后一次性代理补推 `060a8e9`+`d164be7`+标签 `v2.2.21` 成功，CI #54 run `36007805969`（master@d164be7，覆盖 feat+docs 全树）completed successfully，经登录态浏览器核验。）

## Qoder 2.2.22：稳定期阶段 D 收尾刀——RandomOutcome 事件流落地：录像自此"记结果不记重掷"，回放逐字重放抽牌结果、旧档双读兼容零 schema 变更（决议 D-2a，§12-16a 销案）

**背景**：两刀连做计划（v2.2.21 常驻迁移 → 本刀）的第二刀，决议 D-2 的收线件。2.2.18 达成的是"全局可复现"（游标进状态、重掷可复现），D-2 原文要的是更强的"记结果不记重掷"：随机行为应当作为**结果事件**进入可观察流，录像记录结果本体，回放消费结果而非再次依赖 RNG 复现。建局随机不并入（store 层无事件流可挂，且录像 initialState 自带建局后状态、本无"建局重掷"问题——2.2.19 游标化即终态），本刀只收引擎事件流内的局内消费点（当前唯一随机消费点=抽牌选牌）。

**变更**：
- **事件面（`core/Event.ts`）**：新增 `RANDOM_OUTCOME` 类型 + `RandomOutcomeData{purpose:'DRAW_SELECTION', stableId, value}`；`value={playerId, generalKeys, deckTake, reshuffleKeys, cursorAfter}`——选中的将/卡用 cardRemovalKey 身份键表达（不是对象引用），牌堆顶取走数与弃牌堆重洗抽走键分列，cursorAfter=本次消费后的游标快照。
- **实况路（`eventProcessors/drawEvents.ts` + `core/TransitionCore.ts` + `core/EventProcessor.ts`）**：`transition()` 每次接受的动作创建 per-dispatch `DrawOutcomeFlow{produced, overrides?, overridePos}`，经 `EventProcessor.process` 可选第四参贯穿（只喂 DRAW 族处理器；process 仍是全引擎唯一状态改道入口，D-2"禁第二入口"不破）；`applyDrawEvent` 把真实选牌结果 push 进 produced；重入循环结束后 TransitionCore 统一盖戳 stableId（`ro:<turn>:<round>:<playerId>:<index>`）并把结果事件追加进返回流。live 路径 produced 每条 stableId 初始为空串由引擎盖戳（测试②钉格式）。
- **回放路（`replay/ReplayPlayer.ts` + `core/GameEngine.ts`）**：ReplayPlayer 每步把条目内记录的 RANDOM_OUTCOME 载荷结构化克隆后经容器新字段 `engine.outcomeOverrides` 注入（dispatch 两出口即清，杜绝泄漏到下一步）；`takeOverride` 按 DRAW 事件逐步消费一个槽位（purpose+playerId 不合即视未命中），命中后 `materializeSelection` **严格校验**：记录计数必须逐项等于确定性公式（min(requested, 各堆现存长度)）且每个身份键都能在当前将池/牌堆/弃牌堆解析出实体——全过才逐字应用记录结果、游标直跳 cursorAfter **完全不碰 RNG**；消费的载荷转发进 flow.produced，使回放事件流与实况逐步全等（含 RANDOM_OUTCOME 本身，四路对账测试的断言面因此不用改）。任何一环不符→自动降级回种子重掷老路。
- **旧档兼容（D-8 策略）**：RANDOM_OUTCOME 寄居既有 `entry.events` 数组随 ReplayRecorder structuredClone 顺带录制——`ReplayDocument.version` 保持 1，不 bump 任何版本号/字段白名单；2.2.22 之前的录像没有结果事件→走 2.2.18 起"initialState 含游标"的可复现重掷，双读诚实共存（测试⑥）。
- **测试 297→305 / 38 文件**：新文件 `core/randomOutcome.test.ts` 8 例——①活抽记录 1 条结果（stableId 'ro:2:2:1:0'、键表/计数/游标推进/手牌态消费全查）②纯牌堆顶抽记录空键、游标不动③store 桥 BEGIN_DRAW→DRAW 结果落进活录像文档末条④**篡改 initialState.rngState 后回放仍与实况全等**（结果消费实证）⑤篡改+剥离结果→必漂（结果通道承重实证，防"假通过"）⑥剥离但游标完好=旧档路径回放全等⑦伪造 generalKeys→回退重掷且与实况全等⑧outcome 回放全程 Math.random 抛错探针零触发。
- 顺手修正：`liveReplayRecorder.ts` 头注释停留"每动作新引擎"→改常驻口径（2.2.21 滞后）；ARCH_MAP `core/rng.ts` 行"建局仍走别处"→2.2.19 已销案的滞后尾巴同批更正。

**行为变化（披露）**：可观察事件流每 DRAW 多一类 RANDOM_OUTCOME（新增而非改语义；UI 消费面全部按具体类型 filter/some、未知类型天然忽略，真机三局验证渲染零干扰）；**抽牌结果序列零变化**——live RNG 逻辑只被旁听未被改动，`ai-battle --games 300 --seed 1` 胜席分布 {1:109,2:191} 与 2.2.19/2.2.20/2.2.21 基线逐字一致（won=300、VIOLATIONS=0）。package.json/lock 2.2.21→2.2.22。

**验证**（定稿红线：全部文件定稿后、提交前跑满五闸）：check 0 错误；305 测试通过（38 文件）；覆盖率棘轮维持 42/34/34/47（实测 stmts 43.79 / branch 35.91 / funcs 35.38 / lines 48.95）；lint 0 错误 30 遗留警告（双路选牌块一度引入 3 条 no-useless-assignment，去死初值后归零——定稿红线把问题拦在提交前）；build 单文件 1,920.95 kB / gzip 564.18 kB；ai-battle 300 局分布逐字一致。浏览器真机 E2E（dev 5199 真实 DOM 点击三局全自动观战局打到终局结算）：抽牌窗口/结算窗渲染如常；手动"保存"按 2.2.10 设计走无窗下载；取证书一局 225 dispatch、活录像文档内 **41 DRAW/41 RANDOM_OUTCOME 一一对应**、stableId 形如 `ro:1:1:1:0`；页内 ReplayPlayer 整档回放 225 步，终态与常驻引擎实况终态 JSON 逐字节全等；initialState.rngState 篡改为 0xDEADBEEF 后回放**仍全等**（回放走结果消费，不是游标重掷）；篡改+剥离全部结果事件后 equal=false（结果通道真实承载回放）；console 0 错误 0 警告。环境注记：本会话 dev 服务器久跑带 HMR，页面图谱内模块 URL 带 `?t=` 后缀，evaluate 里动态 import 必须沿用同一 `?t=` URL 才命中活实例（plain import 会拿到第二个实例、活录像缓冲恒空）。

**Unresolved**：①D-2 仅剩 e) 观察项（ReactionWindow 窗口 id 的 Math.random、DiceRoll.tsx 纯 UI 骰子，§12-16 维持，与 §12-9c 同源）；②RANDOM_OUTCOME 的 purpose 值集当前只有 'DRAW_SELECTION'，未来新随机消费点按同通道扩展（事件流通道与回放注入面已就位）；③常驻容器长生命周期接线（ReactionWindow 入口/网络）随各自需求另立刀次；④CI 远端复验全绿——run 36015382559（CI #56，master@ef34be4）completed successfully，四 job（lint 59s/test(22)/test(24)/build 1m46s）均绿，feat 6ada758+docs ef34be4+标签 v2.2.22 单顶端 run 全覆盖，直连 reset→一次性代理推送成功。

## Qoder 2.2.23：稳定期收尾第一刀——RandomOutcome 回退诊断旁路落地："可自动降级，不可无痕降级"（GPT 外部评审 Q4 契约）

**背景**：用户四点欠账连做计划（v2.2.23 诊断旁路 → v2.2.24 ReplayHeader+护甲裁决 → v2.2.25 ReactionWindow 入口）的第一刀。2.2.22 让回放"记结果不记重掷"，但记录结果未通过严格校验时的自动降级**完全静默**——外部评审 GPT 在其复核回函（Q4）中指出：降级本身合法（旧档兼容设计如此），但"无痕"会让坏档/篡改/未来格式漂移无法被发现，违反"可自动降级，不可无痕降级"契约。本刀只补观测面，不改变降级行为。

**变更**：
- **失败原因精化（`eventProcessors/drawEvents.ts`，315→349 行）**：`materializeSelection` 从"失败返回 null"改为判别联合 `{ok:true,selection}|{ok:false,reason}`，`reason: OverrideFailureReason` 三值——`COUNT_MISMATCH`（记录数与确定性公式 min(requested,pile) 不符）、`UNRESOLVABLE_KEY`（身份键在现牌堆/弃牌堆/将池无法解析）、`MISMATCHED_SLOTS`（`takeOverride` 发现该槽位有记录但 purpose/playerId 与本消费点不合；**缺槽=旧档合法路径，不报**，双读语义不变）。导出类型 `OverrideFailure{stableId, playerId, reason}`。
- **带外诊断通道（事件流逐字节不变）**：`DrawOutcomeFlow` 增惰性 `diagnostics?: OverrideFailure[]`（`pushDiagnostic` 首报才建数组，无诊断时零开销）；`TransitionResult`（TransitionCore 112→116 行）增**必填** `overrideFailures: OverrideFailure[]`——两处拒绝早退恒发 `[]`，接受路径发 `flow.diagnostics ?? []`；`GameEngine`（116→124 行）在 dispatch 两个出口把当步诊断暂存为公开字段 `lastOverrideFailures`（与 outcomeOverrides 同批清/置，杜绝泄漏到下一步）。实况路 overrides 恒空→诊断结构性恒空，**一切事件形态与 2.2.22 完全一致**（randomOutcome 原 8 例与 transitionEquivalence 6 例一字未动全绿即证；禁第二入口/纯转移纪律均不破——诊断只是返回值上的旁路字段）。
- **回放侧聚合上报（`replay/ReplayPlayer.ts`，83→92 行）**：`ReplayPlaybackResult` 增 `overrideFailures: ReplayOverrideFailure[]`（每步 dispatch 后采集 `engine.lastOverrideFailures` 附录像条目 `sequence`）；播放循环结束后若有失败**恰发一次** `console.warn`：`[replay] N recorded outcome(s) failed strict validation (sequences …; REASON×n…) — fell back to the seeded re-roll.`。ReplayPlayer 无 UI 消费方（仅录像工具链+休眠网络层 re-export），warn 就住在播放器本体，不打扰游戏 UI。
- **测试 305→311 / 38 文件**：`core/randomOutcome.test.ts`（233→310 行）新 describe 6 例——①幽灵 generalKeys→回放全等（兜底照旧）且 failures 精确等于 `[{stableId:'ro:2:2:1:0', playerId:1, reason:'UNRESOLVABLE_KEY', sequence:1}]`②篡改 deckTake=99→COUNT_MISMATCH③篡改 playerId=7→MISMATCHED_SLOTS（playerId 报实际槽主 1）④干净注入与旧档（剥离结果）failures 恒空⑤实况 dispatch（接受+拒绝两口径）lastOverrideFailures 恒空⑥console.warn 探针：篡改档恰一次 `[replay]`、干净档零次。

**行为变化（披露）**：**零**。降级行为逐字不变（不符仍自动回退种子重掷），只新增带外诊断与一条 warn；`ai-battle --games 300 --seed 1` 胜席分布 {1:109,2:191} 与 2.2.19~2.2.22 基线逐字一致（won=300、VIOLATIONS=0）。package.json/lock 2.2.22→2.2.23。

**验证**（定稿红线：全部文件定稿后、提交前跑满五闸）：check 0 错误；311 测试通过（38 文件）；覆盖率棘轮维持 42/34/34/47（实测 stmts 43.81 / branch 35.83 / funcs 35.31 / lines 48.92）；lint 0 错误 30 遗留警告（零新增）；build 单文件 1,921.55 kB / gzip 564.35 kB；ai-battle 300 局分布逐字一致。浏览器 E2E（dev 5210，`__TK__` store 直驱人机 2 人房完整回合链产出**真实常驻桥活录像文档**）：15 entry/7 RANDOM_OUTCOME；干净回放 overrideFailures=0 **且回放终态与文档末步 afterState JSON 全等**（真实产档的实况↔回放对账，比测试夹具更强的证据）；把全部记录 deckTake 篡改为 99 后回放→7 条 COUNT_MISMATCH（sequence 1,3,4,5,8,11,14）、页面 console.warn 拦截探针捕获 `[replay]` 恰一次、降级重掷仍完整播完至终态；console 0 错误。E2E 环境注记（新踩坑入记忆）：`createRoom` 在**调用时**读取 playerCount（先 setPlayerCount 再 createRoom）；store 直驱 executeDraw 后必须 confirmDraw 才关窗（否则 drawState 滞留 drawing）；fresh 页面 plain 动态 import '/src/replay/ReplayPlayer.ts' 可用（该页尚无 ?t= 图谱时依赖同实例）。

**Unresolved**：①计划内后续两刀：v2.2.24（D-4：ReplayHeader{schemaVersion,gameVersion}+legacy 护甲兜底三分裁决）、v2.2.25（§12-9c ReactionWindow 业务入口+窗口 id 确定性化，随刀销案 D-2 e) 观察项）；②warn 的消费面目前仅 ReplayPlayer 本体——若未来 UI 引入录像回放视图，其错误提示层可直接读 `ReplayPlaybackResult.overrideFailures`（数据结构已备好）；③CI 远端复验**已回填**：run `36023798270`（CI #58，master@54cdb01）completed successfully，四 job（lint 1m14s / test(22) 311/311 / test(24) 311/311 / build 1m29s）均绿，feat `eed1d94`+docs `54cdb01`+标签 `v2.2.23` 单顶端 run 全覆盖，直连推送成功未借道代理。

## Qoder 2.2.24：稳定期收尾第二刀——D-4 落地：ReplayHeader 进录像文档（schemaVersion:2+gameVersion，旧档永不回填只读双读）+ legacy 护甲兜底三分裁决定案 b 案（去 Date.now 改位置确定性 id，保留前缀台账豁免）

- **背景**：收尾计划三刀之二。D-4 决议原文两件事：①录像文档补 ReplayHeader{schemaVersion,gameVersion}；②裁决 legacy 护甲兜底伪造牌（`legacy_armor_destroyed_${Date.now()}_${i}`，非确定性）的去留。
- **ReplayHeader 实施**：`replay/types.ts` 增 `REPLAY_SCHEMA_VERSION=2` 常量与可选 `header?: ReplayHeader{schemaVersion,gameVersion}`；`ReplayRecorder.start` 写入（gameVersion 取 `import pkg from '../../package.json'` 构建期常量，tsconfig resolveJsonModule 已有）；`version:1` 与全部旧字段一字不动，**旧档永不回填改写**——缺 header 即 schemaVersion 1 只读兼容（诚实双读，同 2.2.22 策略，不采 Adapter 转写）；`deserialize` 三态口径：缺头/1/2 收，超界抛 `Unsupported replay schema version: N`；新增静态 `schemaVersionOf(document)`。`replay/index.ts` 再导出 ReplayHeader/REPLAY_SCHEMA_VERSION。
- **护甲兜底裁决（盘点→b 案）**：a 案前提被证伪——GAIN_ARMOR（2.2.17）给的是点数护甲、无卡实例，普攻链（AttackResolver 经 destroyedArmorCardIds 供真实实例）之外"armorLost>0 且无实例"是**合法生产路径**；技能 DAMAGE（SkillTriggerBridge）不带 armorLost；录像重放的是 action 不是录制事件形态，无历史依赖。定案 b：保留兜底分支，id 改位置确定性 `legacy_armor_destroyed_${弃牌堆起始下标+i}`（起始下标=state.discardPile.length+当步消耗入堆 0/1），**前缀必须保留**（`ai/invariants.ts:35` SYNTHETIC_PREFIX 按前缀把占位牌排除出卡牌台账）；文件现为 `eventProcessors/damageEvents.ts:148-164`（ARCH_MAP 行号漂移同步更正）。
- **披露**：占位牌 id 形态变化（Date.now 串→位置串）属弃牌堆内容可观测差异，但占位牌被台账豁免且不参与任何胜负路径——ai-battle 300 局 seed1 胜席分布 {1:109,2:191} 与基线逐字一致，零行为变化硬证成立。
- **测试**：+7 例至 318/39 文件。新增 `replay/replayHeader.test.ts` 5 例（新档 header 写读往返、旧档缺头只读、区间内接受、超界拒读消息、live 链路 BEGIN_DRAW initial 建档带 header）；`core/EventProcessor.test.ts` +2 例（裸点数护甲两次结算弃牌堆 JSON 逐字相等且 id 恰为 legacy_armor_destroyed_0/1；真实实例销毁进堆且无 legacy 前缀）。
- **验证**：check 0 错；318/39 全绿；覆盖率 44.07/36.24/35.53/49.23 ≥ 地板 42/34/34/47（不动）；lint 0 错 30 遗留警告；build 1,921.88 kB（gzip 564.49）；ai-battle 分布逐字一致。浏览器 E2E（dev 5210，store 直驱全 AI 局）：实况录像文档 header={schemaVersion:2,gameVersion:"2.2.24"} 且 version 仍 1；deserialize 三态页面内验证含拒读消息；ReplayPlayer.play 5/5 步、overrideFailures 空、终态 JSON 等于文档末条 afterState；console 0 错。

## Qoder 2.2.25：稳定期收官刀——ReactionWindow 业务入口落地：容器层确定性窗口 id（不占随机流）、常驻桥三入口、store 动作+GameBoard 最小 HUD，窗口永不进 EngineState/不进录像流（§12-9c 销案、§12-16e 观察项全销，D-2 决议整体收线）
- **背景**：收尾三刀计划之三。`triggers/ReactionWindow.ts` 自 1.x 起实现完整（open/pass/revoke/close + PrioritySystem）却全库零业务调用方——这个"零调用方"事实本身就是 §12-9c 缺口的准确形态。本刀范围钉死为**入口机制**：容器层开窗 → 桥 → store 动作 → 最小 HUD；**不**让任何技能/触发种类自动开窗（询问语义归内容侧，按 D-3 决议继续等立项），规则一字未动。
- **确定性窗口 id（销 §12-16e①）**：`GameEngine.openReactionWindow(event, participants?)` 生成 `rw:<turn>:<round>:<sourceEventKey>:<seq>`——sourceEventKey 取 `event.data.stableId ?? event.type`，seq 是容器私有计数器 `reactionWindowSeq`（常驻容器内单调递增），**刻意不消费 rngState 游标**：窗口身份不是游戏随机，不占随机流。`ReactionWindow.open` 签名增必填第三参 stableId（旧式 `Date.now+Math.random` 作废；全库唯一调用方即本刀新入口，无旧调用方受害，如实披露）。`openedAt` 保留时钟——纯观测字段且窗口不入录像，无碍可复现。
- **分层接线**：桥层新增 `openReactionWindowStore/passReactionStore/resetReactionWindowStore`（adopt 同一 engineState 后进容器，不喂录像器）；store 层 `GameState` 增 `reactionWindow` 字段与 `openReactionWindow/passReaction` 动作（参与名单默认=存活玩家、空名单诚实 null no-op、全通过自动置 null，createRoom/resetGame 清窗保新对局卫生）；UI 层 GameBoard 复用既有原语加一条天蓝 HUD 提示条（窗口 id+逐座"通过"按钮/✓ 打勾），无窗口时 DOM 零变化，未造新组件体系。
- **结构不变量（测试钉死）**：窗口是**容器层时序**——开窗→通过→闭窗全程 `JSON.stringify(engine.snapshot())` 逐字节不变，窗口态永不进 EngineState，故 TransitionCore/录像/四路对账结构上零接触（本刀未碰纯转移路径）；REACTION_WINDOW_OPENED/CLOSED 属容器 EventBus 外发、不在 dispatch 返回流 → 不进 `entry.events`（活档全文 `mentionsReaction:false` 实机实证），"窗口不入录像流"钉为本刀口径。多人兼容：`participants:number[]` 签名+本地双席位开窗→双方通过→自动闭窗全链走通，网络仍 dormant。
- **测试**：+10 例至 328/40 文件，新文件 `triggers/reactionWindowEntry.test.ts`（id 确定性〔两次全新构建产物全等、身份段无时钟〕、sourceEventKey 取 stableId 且 seq 递增、参与名单默认+去重、OPENED→部分通过→CLOSED 恰一次事件序、非参与者与闭后 pass 拒绝、快照逐字节不变、桥全链路含闭窗返回与陌生人拒绝、reset 后孤儿 pass 无效、store 动作存在+空名单 no-op）。
- **披露（环境注记）**：E2E 该局活档 header 显示 gameVersion:"2.2.24"——dev 服务器该模块编译于 `npm version 2.2.25` 之前的 transform 时序；同页新 transform 实证输出 `{schemaVersion:2, gameVersion:"2.2.25"}`，产品权威在 `replayHeader.test.ts`（与运行时 package.json 逐字段比对）。HMR 双实例教训升级：编辑后"新导航页面"裸动态 import 仍可能落 shadow 实例（应用图谱 URL 已带 `?t=` 失效戳），须先从 resource entries 读应用实际 gameStore URL 再驱动。
- **验证**：check 0 错；328/40 全绿；覆盖率 44.71/36.57/36.43/49.94 ≥ 地板 42/34/34/47（不动）；lint 0 错 30 遗留警告；build 1,924.30 kB（gzip 565.02）；ai-battle 300 局 seed1 分布 {1:109,2:191} 与基线逐字一致（won=300、VIOLATIONS=0，本刀不触引擎转移路径的直接证据）。浏览器 E2E（dev 5210 活 store 实例）：无窗口零提示条→开窗提示条+确定性 id→逐座点击通过 ✓→全通过自动闭窗→提示条消失；console 0 错。CI 远端复验：GitHub Actions CI #62（run 36032343406，commit 7790445）Success，四 job 全绿（lint 1m22s / test(22) / test(24) / build 52s，用时 3m19s）；直连推送成功未借道代理。

## 第二轮外部评审（收官体检）：三刀复核无需返工、稳定期正式收官、2.3 路线共识与 D-9 补账（2026-09-25，纯 docs 登记不占版本）

- **背景与通道**：用户指令"和 GPT 一起重新整理任务：列出全部挂起项与迭代路线"。沿用历轮评审长会话（ChatGPT c/6a804893…），按既有转义分块流程注入简报（3035 字，双侧滚动哈希 2908682628 逐字节验证），静态审计口径（GPT 不跑代码，本地五闸/328 测试/300 局基线按我方证据采信）。简报 `G:\THREE_KINGDOMS\GPT_DISCUSSION_2_2_25_BRIEF.md`、回复全文 `GPT_DISCUSSION_2_2_25_REPLY.md`（均仓库外 G 盘）。
- **Q1 收官裁决**：三刀逐项 ✅、**无需返工**，v2.2.25 可作为稳定期收官点正式宣告。v2.2.23 被认定为干净的"功能行为不变+诊断能力增加"旁路契约；v2.2.24 "新档写 header、旧档永不回填"与超界显式拒读被认定诚实；b 案（GAIN_ARMOR 点数护甲证伪 a 案前提）合理，Date.now→位置确定性 id 是"从确定性状态派生占位"的关键改善；ReactionWindow"不进 EngineState/不进 Replay"是**正确的边界划分而非漏录**——但新增钉死契约一句："**窗口可以不录；窗口里的游戏决策不能不录**"（已写入 ARCH_MAP D-3 行）。
- **Q2/Q5 路线共识（挂起清单定序）**：P1 技能规则闭环=下一阶段主线（**需求驱动扩展、架构统一承载**：出现第一张真正需要某 trigger 的技能才扩该 Event，反对十类一次铺；每个新 Trigger 走同一张契约表 Event/Timing/Source/Target/Trigger/Condition/Effect/RNG/Replay/Transition/Reentrancy/Death chain；Effect 不得自带第二套状态修改机制，必须回到 canonical transition machinery——这是"禁第二转移路径"在内容时代的执行形态）→ P4 build 治理（2.3 独立工程刀，非稳定期遗留 bug）→ **P7 存档真实回归矩阵**（正常/旧/损坏/缺失/重复冲突/autosave/Save As/权限异常——涉及用户真实数据完整性，不应继续以"以后再测"悬着）→ P5 随下次 UI 改动顺手清 → P6 产品调优池（死亡率偏高不得直接推导为架构问题）→ P2 dormant 至在线真实立项（"要让两台机器上的玩家联网对战"出现才启动；现在唯一网络前置=维持三接口语义冻结：Action 是外部输入意图/TransitionResult 是执行结果/EngineState 是可保存可重建的游戏事实，网络特有状态不得渗入 EngineState，epoch/GameSession 等"现在加=假复杂度"判断继续成立）；P3 不作独立项、作为 P1 的业务结果派生。
- **Q4**：十类 trigger 按真实规则需求逐步引入；每个新 Event 先问"是不是游戏事实"——是→canonical/可回放；只是 HUD/窗口/动画→容器层。与 Q1 的 ReactionWindow 边界天然统一。
- **补账项（本轮唯一新增决议）**：**四类信息分类契约**入 ARCH_MAP 新行 D-9——A 游戏事实（必进 replay）/B 容器观察（默认不录）/C 诊断（带外）/D legacy 兼容（历史层）；今后一切"录不录"争论先归类再裁决。GPT 评级：架构收敛完成、核心规则层可冻结，项目从"哪里大拆哪里"进入"哪里有真实规则需求扩哪里"阶段；2.3 第一刀=真实技能需求驱动的最小完整 Skill Runtime 闭环（重点链 HEAL/GAIN_ARMOR→skill damage→DEATH→onKill 链→按需 trigger），**不是**继续架构大扫除。
- **升级路径（备查）**：若下一轮要把十类 Trigger"缺事件支撑"从方向判断升级为逐项代码契约审计，证据清单=EventProcessor/TriggerEngine/SkillTriggerBridge/skillCompiler+DataSkillDefinition 当前源码 + 328 测试中 Skill/Trigger/Replay 清单，逐类标 已有 canonical 支撑/有入口不闭环/真缺事件/暂无业务需求。
- **登记形态**：纯 docs（本条 + HUMAN 对应条目 + HANDOFF §12-17/§13 + ARCH_MAP D-3 追加钉死/D-9 新行），零代码改动、五闸不适用、不占版本号；CHANGELOG 不记（无版本变化），本条即权威登记。功能侧是否解冻进入 2.3 实施待用户立项口令。

## Qoder 2.3.0：2.3 内容时代第一刀——编译诚实契约 + onBecomingTarget 首个需求驱动闭环：零新增事件接通 BEFORE_DAMAGE、编译 skip 不再无痕（WeakMap 带外诊断+条目级 warn）、13 类触发改登记为按需池、十二格 Trigger 契约表入 ARCH_MAP F 节（用户五刀连做授权，内容刀基线口径自本版本生效）

- **背景与选题**：稳定期收官（v2.2.25）后用户口令"制定新的主线计划、按你判断的最优顺序执行"=2.3 五刀连做授权（v2.3.0 本刀 → v2.3.1 onTurnEnd+回合结束询问窗 → v2.3.2 P7 存档八格矩阵 → v2.3.3 P4 build 治理 → v2.3.4 P5 表面一致性）。第一刀选题=盘点实证的**唯一"已声明且在用"的无支撑触发**：`ai/matchSetup.ts` PRACTICE_SKILLS「演練・回刺」（onBecomingTarget→反伤 1 点）经 skillCompiler 判 TRIGGER_UNSUPPORTED 后 skipped **静默丢弃**——与 2.2.23 已定契约"可自动降级，不可无痕降级"同病构，编译期 skip 是该契约在装配面的欠账；两者同批治掉。
- **onBecomingTarget 语义定稿（盘点后裁决：零新增事件）**："成为攻击目标之时、结算前"映射到**既有** `BEFORE_DAMAGE`——AttackResolver 将领导向分支（:119）发射且带 `targetPlayerId`，本营分支（:178）不带，故本营攻击天然不匹配不发（正确语义而非漏洞）；EventProcessor default 分支对 BEFORE_DAMAGE 是纯通知不改状态，非技能路径零副作用。匹配条件 `idEq(ownerId, data.targetPlayerId) && (!generalId || idEq(generalId, data.targetId ?? data.target))`，优先级 50。**时序冻结**：派生反伤 DAMAGE 在触发链 BFS 尾排队，于源 DAMAGE+ATTACK_RESOLVED+AFTER_DAMAGE 之后、同一 dispatch 内结算；目标死于源伤害时反伤仍落（事件先生成语义）。曾评估新增 `GENERAL_TARGETED` canonical 事件——盘点证伪其必要性（BEFORE_DAMAGE 发射点即目标指定路径），**未造新事件**，符合"需求驱动、反对预防性铺设"决议。三表同步扩为 7 类（compiler SUPPORTED / dataTypes / bridge TRIGGER_EVENT_MAP）。
- **编译诚实通道（D-9 C 类第二个消费者）**：`syncPlayerSkills` 收集 skipped（含 reason）→ `WeakMap getCompileDiagnostics(engine)`（引擎重建天然隔离）；console.warn 按 **distinct 条目**（`技能名#效果id:原因`）模块级去重，测试缝 `__resetCompileWarnDedup()`。**去重粒度是被测量逼出来的**：初版"每引擎全集聚合"在 battleRunner（每步新建引擎）下 300 局压出 **707 行** warn，条目级去重后 **92 行**、浏览器单窗口恰 **14 行**——"每步可达的带外诊断必须按 distinct 条目去重"登记为通用口径（HANDOFF §12-18）。诊断零触事件流与游戏行为。编辑器/Excel 消费该通道做 UI 提示=登记后续需求，本刀不扩 UI。
- **按需池重登记**：其余 13 类无数据使用者触发从"欠账"改登记为 ARCH_MAP F 节按需池——onTurnEnd 已排期 v2.3.1（自动开窗首个业务方），余 12 类逐类标"暂无业务需求"（modify* 需先设计修正器管线、本营系需先盘事件源、active* 天然对应 A 类 action+反应窗形态）。
- **内容刀基线口径（本版本起生效）**：v2.3.0/v2.3.1 设计上改变行为，验证=同 seed 两轮逐字节自洽 + VIOLATIONS=0 + 分布变化如实披露 + 登记新基线；v2.3.2 起非内容刀恢复对最新基线逐字一致。**B1 锚**：ai-battle 300 seed1 胜席 {1:109,2:191}（与 B0 聚合值**巧合相同**，披露），逐势力魏 登场184/阵亡116、群 登场215/阵亡145/攻击20/击杀4（B0 为 185/115、214/143/17/2）——差值即「演練・回刺」实火的行为学证据。
- **测试（+10 → 338/40 文件）**：`skillCompiler.test` +5（onBecomingTarget 编译映射；诊断上报/实况恒空/条目级去重/WeakMap 隔离）；`skillPipeline.test` +4（装配→匹配→反伤→canonical 结算全链、本营攻击不发、声明 generalId 时按将匹配）；`transitionEquivalence` +1（常驻===重建===回放四路对账下反伤链逐字等价）。
- **验证**：check 0 错；338/40 全绿；覆盖率 45.01/36.99/36.76/50.23 ≥ 地板 42/34/34/47（四值全升）；lint 0 错 30 遗留警告零新增；build 1,925.04 kB（gzip 565.36，较 B0 +0.74/+0.34，内容刀披露）；ai-battle 两轮逐字节自洽、VIOLATIONS=0。浏览器 E2E 双轨：①dev 直驱活 store 实例——attackTarget 真实链路事件序 ACTION_ACCEPTED→BEFORE_DAMAGE→TRIGGERED(onBecomingTarget)→DAMAGE(源)→ATTACK_RESOLVED→AFTER_DAMAGE→DAMAGE(反伤 targetId=e2e_g1)→STATE_CHANGED，g1 hp 3→2、g2 3→2，实况路诊断通道 null，console 0 错；②演练窗真机 20 局（`#ai-battle` 哈希**整文档重载**技巧：弹窗仍被塌缩回同页属 2.2.8 已知环境行为，navigate 带哈希 URL 重载使对战窗在本页跑起，App.tsx 模块加载期一次性读哈希）——20/20、违例 0、console 0 错且恰 14 行聚合 warn（条目级去重在浏览器可见实证）；技能注入控件因 React 受控态未吃到 DOM 赋值按默认 0.35 跑（与 B1 水平一致，如实披露）。CI 远端复验：**全绿**——GitHub Actions CI #65（run 36047384014，commit 40b797b）completed successfully（feat `3263d29`+docs `40b797b`+标签 `v2.3.0` 顶端 run 全覆盖）；直连推送被重置，一次性代理推送成功。

## Qoder 2.3.1：2.3 内容时代第二刀——onTurnEnd + 回合结束询问窗：§4 冻结规则落地、D-3c"窗口可以不录/窗内决策不能不录"首检通过：TURN_END 刻意不入触发映射（禁双火），唯一路径=canonical ACTIVATE_SKILL→五门诚实拒收→SKILL_ACTIVATED+consumedSkills 台账+静态 createSkillEvents 回流；询问窗成为首个真实业务开窗方（store dispatch 前延迟、无候选零行为变化）；soak 顺带修掉 ActionValidator 抽牌窗归属既有隐患；B2 基线 {1:114,2:186} 登记

- **背景与定位**：五刀连做计划第二刀（同一授权内直接开工）。HANDOFF 早写死的规则——"回合结束如存在可发动的将领技能，应进入询问/结算窗口"——本刀兑现；且按计划形态"P3（何种技能自动开窗）从 P1（需求驱动闭环）派生"落地：回合结束询问窗成为 2.2.25 窗口的**首个真实业务开窗方**。
- **核心设计裁决：onTurnEnd 不是事件自动触发**。TRIGGER_EVENT_MAP 维持 7 项、TURN_END **刻意不映射**——若映射，END_TURN 一到技能自动开火，既剥夺玩家决策权又与询问窗构成双火。唯一发动路径=canonical `ACTIVATE_SKILL {skillId, generalId}`（进录像）→ 新增第 12 个 resolver `TurnEndSkillResolver`（80 行）：只**描述事实**——产 `SKILL_ACTIVATED`（A 类）+ 效果事件（经 `SkillTriggerBridge.createSkillEvents` **静态共用**，与事件触发路径同一份代码，Effect 零自带状态修改、禁第二转移路径不破）；状态结算全住 EventProcessor（新纯处理器 `eventProcessors/skillEvents.ts` 26 行：consumedSkills 台账按 stableId 追加、重复键不双记）。合法性**全部从 EngineState 重derive**（`skills/turnEndSkills.ts` 114 行 `listAllTurnEndDefinitions` 不过滤触发注册表）：冷引擎/策略探针上照样工作，且五道拒收门原因诚实（MALFORMED_PAYLOAD→PLAYER_NOT_FOUND→TURN_END_SKILL_NOT_FOUND→GENERAL_NOT_CONTROLLED〔含他人将与 otherTurn 冒名〕→SKILL_ALREADY_ACTIVATED，键 `` `${turn}:${skillId}` ``）。定义 id=`` `${runtimeId}:${skillName}:${effectId}` ``。
- **询问窗形态（D-3c 首检）**：store 层 **dispatch 前延迟**——人类非演练座按"结束回合"且当座有可发动且未消费的 onTurnEnd 技能时，END_TURN **不派发**，改经 2.2.25 桥入口 `openReactionWindowStore` 开窗（确定性 id `rw:<turn>:<round>:turn-end-ask:<turn>:<playerId>:<seq>`）+ store 字段 `turnEndAsk` 挂起后续。归类钉死：`turnEndAsk`/OPEN/CLOSE=B 类容器观察永不进档（快照路径只序列化 engineState，窗态**结构上**进不了存档）；窗内发动（真 ACTIVATE_SKILL dispatch）与最终结束回合=A 类 canonical 必录。多候选逐个询问（发动后 ask 收缩重算 2→1→闭）；**重复按"结束回合"=诚实跳过**；全跳过/结算完→闭窗→补发原 END_TURN 链；**无候选零行为变化**（不开窗直接走现状）。AI 座与演练场不受门控：AI 经 `legalActions` 新枚举的候选出**真实**动作（strategyPolicy 抽牌窗同款闭包记账纪律），司机映射 ACTIVATE_SKILL→`activateTurnEndSkill`——ai-battle 300 局含守夜全链走通、VIOLATIONS=0 即 AI 路线实证。GameBoard 琥珀询问条（⚡逐技能+⏭️跳过并结束回合），与通用窗口 HUD 按 windowId 互斥防双呈现。
- **内容闭环零成本确认**：PRACTICE_SKILLS 加「演練・守夜」（onTurnEnd 摸 1 张）；编辑器下拉/Excel 往返**零代码改动**——`triggerTypeLabels` 早就有"回合结束时"、turn 类目共享、`TriggerEditor` turnSubType 下拉通用，录入→编译→入局→触发→重放闭环由测试与 300 局 soak 覆盖。77 将批量补 runtime 载荷=内容量产，另立需求。
- **本刀揪出的既有隐患（修复+披露）**：`ActionValidator` 抽牌窗归属判定以 `metadata.drawPlayerId` 为权威——与窗体 `state.drawState.playerId` 不一致的时序（守夜改抽牌链暴露）会误判"谁在问"，END_TURN 被错误拦截形成死锁（seed 902 复现）。修复=**窗体为权威、metadata 降兜底**，回归例锁进 resolver 测试。这是 300 局 soak 的真实收益，登记 HANDOFF §12-19②。
- **测试夹具重要教训（通用口径，§12-19③）**：`engineAwareSetter` 对**不带 engineState 自有属性**的每次 `set()`（开窗 `set({turnEndAsk})` 即其一）都走 `storeStateToEngineState` 从展示层重建引擎镜像；生产之所以安全，是因为 gameStore 投影把 `players` 指向 `engineState.players`、`cardDeck` 指向 `engineState.deck`（同数组引用）——**手写 store 测试夹具必须镜像该不变量**，否则自建 fieldGenerals/deck 被镜像重建抹掉（本刀调试曾两度中招：先技能被清空、后牌堆被清空）。适配器保留语义（turn/consumedSkills 跨重建保留、缺 engineState 时按展示层派生兜底）现已有专例钉死。
- **内容刀基线口径执行（B2）**：ai-battle 300 局 seed1 同 seed 两轮输出逐字节自洽（仅耗时行除外）、won=300、VIOLATIONS=0；胜席分布 B1 {1:109,2:191}→**B2 {1:114,2:186}**——两驱动如实披露：守夜进装配数组使装配 RNG 消费序漂移 + ActionValidator 归属修复。逐势力锚（run1）：魏 187/129、蜀 204/130、吴 164/121/攻6/杀1、群 219/142/攻18/杀3、晋 133/87；B1 旧锚归档 §12-19 备查。**v2.3.2 起非内容刀须对 B2 逐字一致**。
- **验证**：check 0 错；**363/43 文件全绿**（+25：turnEndSkills 7 / TurnEndSkillResolver 8 / gameStore.turnEndAsk 10）；覆盖率地板维持 42/34/34/47（实测 46.01/38.22/37.69/51.33 四项全升）；lint 0 错 30 遗留警告零新增；build 1,931.71 kB（gzip 567.13，较 2.3.0 +6.67/+1.77 如实登记）。浏览器 E2E（dev 5199 真实 DOM 点击双场景）：场景一 开窗（回合冻结 5、台账 0）→⚡发动（consumedSkills 1 条+手牌+1+闭窗+通报）→再按结束→回合 6；场景二 开窗→⏭️跳过→回合 6 台账 0；窗 id 实测 `rw:5:3:turn-end-ask:5:1:1`；console 0 错误。E2E 操作注记：setState 后查询 DOM 需**分两次 evaluate**（React 重渲染不落在同一 tick）；5199 端口被早先会话 dev 服务器占用——curl 确认同仓后复用（?t= 缓存戳取活模块实例）。CI 远端复验：**全绿**——GitHub Actions CI #67（run 36056801215，commit 211c061）completed successfully，feat `d33b20b`+docs `211c061`+标签 `v2.3.1` 单次顶端 run 全覆盖；直连推送成功未借道代理。
- **下一步**：按计划钉死条——第一、二刀合并约 GPT 契约形态首检（十二格表两实体/GENERAL_TARGETED 未造事件的裁决/开窗口径/D-9 归类/AI 决策 canonical 真机证据），结论回来再开第三刀 v2.3.2（P7 存档八格矩阵）。

## 第三轮外部评审（一、二刀合并·契约形态首检）：总判定=契约成立、不再开结构性重构；三句冻结契约入档；GENERAL_TARGETED 改按业务信号升级；"决策型触发"正式成为 Trigger 分类（2026-09-25，纯 docs 登记不占版本）

- **背景与通道**：按 2.3 计划预定口径，v2.3.0+v2.3.1 两刀成品合并交沿用历轮的评审长会话（ChatGPT c/6ab53db9…）静态复核。简报=两刀契约形态全文（编译诊断通道/onBecomingTarget 十二格/询问窗 B-A 分界/五闸与 B2 锚证据+Q1–Q7 七问），原文 `G:\THREE_KINGDOMS\GPT_DISCUSSION_2_3_CUTS12_BRIEF.md`（4213 字/哈希 3937452542），回复逐字归档 `GPT_DISCUSSION_2_3_CUTS12_REPLY.md`（7064 字，均在仓库外 G 盘）。**传输形态披露**：本轮发现 Composer 对注入换行会静默丢失（此前残版误发事故根因），改用 ¶ 哨兵（U+00B6）替换全部换行+22 批数字码逐批注入+每批累计哈希对表（终态 4328 字/哈希 2041399342 与预计算逐位相符后才点击发送），消息内附排版变体说明；期间一次末行抄写错码被长度守卫（WRONG_N）拦下、页面零污染。
- **逐问裁决**：Q1 onBecomingTarget 复用 BEFORE_DAMAGE=🟡 **有条件同意**，不为字面精确造 GENERAL_TARGETED；当前契约冻结为"目标已确定且即将进入伤害结算时的目标侧响应"，**升级条件改为四条业务信号**（目标定而无伤害的合法路径/不依赖伤害的目标后置效果/非攻击类 target 触发/独立 target-resolution phase 需求——任一出现才立独立事件）。Q2 十二格表=🟢 **准入门禁成立**（两案例恰覆盖自动事件型与玩家决策型两个方向而表不失灵）；**否决第十三格**（可撤销性/幂等），改加解释纪律：Reentrancy 格须写明重复进入/消费/触发防护，可取消/可中止行为的最终提交点注明在 Transition 或 Replay 栏。Q3 store 层 dispatch 前延迟开窗=🟢 **不构成第二 Transition 路径**——"窗口是时序编排，不是状态转移"，全链无 WindowEngine.transition、无窗口态写 EngineState，ACTIVATE_SKILL→resolver→TransitionCore 形态被点名"恰好守住 Effect 不得自带第二套状态修改机制"。Q4 turnEndAsk 不持久化=🟡 本地成立（B/A 分界符合 D-3c），预钉"Replay 不要求恢复 UI/window 生命周期，只要求从 canonical action 序列恢复相同游戏事实"；联网后窗口若承担跨端同步/超时/并发裁决则升**协议层 ReactionWindow**（windowId/owner/legalActions/deadline/state/revision，或需 epoch）——P2 前瞻登记，不改现口径。Q5 onTurnEnd 不自动映射=🟢 **本轮最重要架构结果**：TURN_END 只提供"可决策机会"而非"自动执行命令"；正式确立 Trigger 两概念族——自动事实触发（Event→Bridge→Effect）vs 决策型触发（game fact→候选→决策→canonical action），未来 active*/onPhaseEnd 类先问"规则自动发生还是玩家获得发动权利"，后者一律走决策族。Q6 编译诊断=🟢 WeakMap 带外通道与 D-9 C 类完全一致；707→92 泛化为可复用原则"**诊断 identity 绑定问题条目而非运行次数**"；唯一提醒：条目级去重作用域=当前运行环境/诊断生命周期而非永久进程历史（现状符合，不返工）。
- **总评与收刀建议**："两刀实际把 2.3 架构分层钉清了"——游戏事实（自动触发/决策触发两族汇入 canonical action→TransitionCore）与窗口/诊断/编译 skipped（留事实之外）的界线与 D-9 四类户口对齐；D-3c"窗内决策必须落成 canonical action"首次被真机证据支持，评为"本轮最大正面结论"。**不建议因这两刀再开结构性重构**；只需三句冻结契约入长期设计档（已入 ARCH_MAP F 节复核小节与 HANDOFF §12-20）。
- **登记形态**：纯 docs（本条 + HUMAN 对应条目 + HANDOFF §12-20/§13 进度段 + ARCH_MAP F 节"GPT 合并复核"小节），零代码改动、五闸不适用、不占版本号、CHANGELOG 不记。**门禁解除：v2.3.2（P7 存档八格矩阵，非内容刀须对 B2 {1:114,2:186} 逐字一致）开闸。**

## Qoder 2.3.2：2.3 第三刀——P7 存档恢复真实回归矩阵（八格 16 例首建专档）：两枚阻断性真缺陷被矩阵当场揪出并修复——深坏档能把校验器自身打崩、存储层抛错能卡死回合提交链；非内容刀硬证=ai-battle 对 B2 逐字一致

- **背景与定位**：五刀连做计划第三刀、第三轮外部评审点名的"不能再拖"项。盘点实证：`gameStoreRecovery`/`localGameSnapshot`/存档恢复链**全库零专属测试**——用户真实数据的完整性此前只靠间接路径覆盖。本刀=非内容刀：新增测试+两处缺陷修复，游戏行为零设计变化，硬证是对 B2 {1:114,2:186} 逐字一致。
- **八格矩阵**（`store/gameStoreRecovery.test.ts`，16 例，每格判据统一为一句话：**恢复态=存档态，或被诚实拒绝+清理，不许无痕吞档**）：格1 正常档（局中快照→回菜单→恢复，游戏事实逐项核对：turn/round/当前座/手牌/hp/牌堆/弃牌/rngState 游标/consumedSkills 台账/房间名/phase）+格1b 空房间号显式抛错；格2 旧形态档缺 roomName/playerCount 走兜底恢复，格2b 版本超界/缺版本=诚实拒收且 store 分毫不动；格3 JSON 坏死档→恢复 false+清掉存储+class-C console.error，格3b 缺 players/deck 骨架同路，**格3c 混入 null 的深坏档——正是这格把校验器当场打崩，暴露缺陷①**；格4 无档读 null、对空串恢复 false（不抛、不误清别的键）；格5 房间号不匹配→拒而**不删**（是否清理由调用方决策），格5b 重复保存后档覆盖前档（latest wins）；格6 autoSave 开=结束回合提交后档已写且回读 turn 与内存一致、关=恰不写；格7 showSaveFilePicker 探针计数恒 0（游戏存档永不触系统弹窗，2.2.10 契约延续）+格7b 恢复态经常驻容器 adopt 后可正常 dispatch（存档真能接着玩）；格8/8b 存储 API 不可用降级（setItem 抛→save 返 false+warn 恰一次+**endTurn 链照常推进不误伤对局**；getItem/removeItem 抛→读空/静默哑火，都不上抛）。
- **阻断缺陷①（校验器被被校验数据击穿）**：`isRestorableEngineState` 里 `const playerIds = players.map(p => p.id)` 排在 `players.every(...)` 验证**之前**无条件执行——players 混入 null 的深坏档直接 TypeError 打崩校验器本身（校验器的职责恰恰是面对坏数据给出"不通过"的答复）。修复=playerIds 仅在 `playersAreValid` 短路成立后派生。回归例=格3c。
- **阻断缺陷②（存储层抛错能卡死回合链）**：`localGameSnapshot` 三助手原本是裸 `localStorage.setItem/getItem/removeItem`——**本产品以单文件离线形态发行，file:// 与隐私模式下 localStorage 访问就是会抛**（不是理论场景），而自动保存挂在 `commitEndTurn` 提交路径上：裸抛=结束回合按钮当场死锁。修复=三助手 try/catch 哑火降级；`saveLocalGameSnapshot` 返 boolean 供调用方诚实消费；`reportStorageFailure(op)` 按操作 Set 去重、每操作恰一次 `console.warn`（D-9 C 类带外诊断，零触游戏事实）；测试缝 `__resetLocalGameSnapshotDiagnostics()`。
- **调用方诚实（本刀第三件小事）**：GameBoard `saveGameSnapshot` 消费 boolean（成功→"对局已保存"，失败→"保存失败，请稍后再试"）；`saveAndExit` 改为**仅在保存成功时才退局**——保存失败绝不悄悄丢档退出。清单侧清档时机分岔维持既有正确形态（MainMenu 继续游戏失败=就地清档+隐藏入口；恢复函数遇房间不匹配=拒而不删）。
- **jsdom 环境教训（通用技巧）**：jsdom 的 localStorage 是 `[LegacyOverrideBuiltIns]` proxy，**既不能 defineProperty 也不能直接赋值覆盖其方法**（trap returned falsish / 静默失败）——正确姿势=压原型链：`vi.spyOn(Storage.prototype, 'setItem').mockImplementation(thrower)`。已写进测试注释与 §12-21⑤。
- **非内容刀验证（B2 硬证）**：五闸全绿——check 0 错；**379/44 文件**（+16 全为本刀矩阵）；覆盖率实测 47.08/39.33/38.65/52.65 ≥ 地板 42/34/34/47（四值全升）；lint 0 错 30 遗留警告零新增；build 1,932.03 kB（gzip 567.22，较 2.3.1 仅 +0.32/+0.09，测试不进包、增量=两处修复代码，如实登记）。`npm run ai-battle -- --games 300 --seed 1` 同 seed 两轮**与 B2 {1:114,2:186} 逐字一致**（胜席/逐势力/账本全等，仅 avg/slowest/墙钟耗时行及 npm Done 行按约定除外）、won=300、VIOLATIONS=0——存档链与校验器修复被证明零触游戏事实。
- **浏览器 E2E（dev 5211 真实 DOM 双场景，与 HANDOFF §9 同一次实测）**：①存→读→玩：建房选 AI 座位→骰子→征召（真实点选 9 名吴将 + 1 名群将「左慈」满足"至少 1 群"约束）→初始抽 2 将领+3 卡盖→进 playing→⏸️菜单"保存对局"→"对局已保存"提示 + 读回 localStorage 快照与 store 内存**逐字段核对一致**（turn/round/currentPlayerId/手牌数/将池/rngState 游标同值）→整文档重载→主菜单"继续游戏"→恢复态逐项相等（turn 1/round 1/当前座 0/牌堆 49/手牌 5/将池 8/房名回显）→真实点"结束回合"→回合推进且 AI 座位完整回合照常跑完；②坏档注入（把 snapshot 键写成 `{broken json!!`）→"继续游戏"被诚实拒绝（console.error `[Recovery] Saved game could not be resumed`）+ 存档清理（复查键已空）+ "继续游戏"按钮消失；console 0 错误，warn 仅既有的 2.3.0 编译诚实通道。E2E 操作注记：⏸️菜单按钮按整串文本 `endsWith('菜单')` 匹配（fixed 定位）；群势力卡片实际落在主势力网格之后，用卡片文本启发式定位而非 `nextElementSibling`。CI 远端复验：**全绿**——GitHub Actions CI #70（run 36088997302，commit e6d76e0）completed successfully，feat `e93a939`+docs `e6d76e0`+标签 `v2.3.2` 单次顶端 run 全覆盖；直连推送 curl 28 连接失败，一次性借道 127.0.0.1:10808 代理推 master+标签成功、未写持久配置。
- **GPT 沟通判断（按预定口径执行）**：本刀两发现均为**缺陷级**（坏数据打崩校验器、存储抛错死锁）而非**契约级**（无存档语义与 D-4 冲突、无 CI 形态改变）——按计划规则不另约评审，结论随五刀收官合并汇报。
- **下一步**：第四刀 v2.3.3=P4 build 治理（决议 D-7：build 去内嵌 npm install、防呆检查、连分发文档一起改、核对 CI workflow 显式 install），非内容刀须对 B2 逐字一致。

## Qoder 2.3.3：2.3 第四刀——P4 build 治理（决议 D-7 收线）：`npm run build` 不再替用户联网装依赖；27 行防呆脚本四态检查显式指路、绝不静默安装；CI 预检确认 workflow 零改动；非内容刀硬证=ai-battle 对 B2 逐字一致（2026-09-25）

- **模型标记**：Qoder（本会话）。范围=决议 D-7 全部原文义务：build 去内嵌 install + node_modules 防呆 + 分发文档同步 + CI workflow 显式 install 预检。非内容刀，游戏事实零变化。
- **改动形态**：`package.json` build 脚本 `npm install --include=optional --ignore-scripts && vite build` → `node scripts/preflight-build.mjs && vite build`（版本 2.3.3）。新文件 `scripts/preflight-build.mjs`（27 行）：仓库根由 `fileURLToPath(import.meta.url)` 上溯派生（对任意 cwd 免疫）；四态拒绝=node_modules 不存在/不可读/为空（只含隐藏目录如 `.package-lock.json` 也算空）/未安装 vite；拒绝时打印完整可复制安装命令（`NPM_FLAGS` 环境变量把旧 `--ignore-scripts` 建议原样镜像进指路文案），**核心纪律=宁可显式报错也绝不静默安装**；依赖在位则零输出放行。新文件 `scripts/preflight-build.test.mjs`（5 例）：tmpdir 沙箱内复制脚本再 spawn——**被测对象必须是沙箱副本**，直接跑仓库副本会解析到真实仓库根使沙箱语义失效（首版即踩此坑后改写）；断言覆盖 静默通过（stderr 全空）/不存在指路/空目录/缺 vite/NPM_FLAGS 拼接。
- **测试发现面**：`vitest.config.ts` include 原只含 `src/**/*.test.{ts,tsx}`，scripts/ 测试不会被发现——扩为加 `scripts/**/*.test.mjs` 并注释登记理由；coverage include 维持 src-only（scripts 测试零贡献）。**本刀顺带钉下一条测量学事实**：src 零改动的前提下，同刀两次覆盖实测仍得 47.08/39.33/38.65/52.65 与 46.9/39.18/38.53/52.44（差 ~0.2pt）——**Node≥24 vmThreads 池下覆盖率采集存在运行间抖动**，历轮把"实测四项逐字相同"当正常性旁证的解读作废，判据收敛为"≥地板且门禁 exit 0"（§12-22④⑤）。
- **CI 预检（D-7 随决议而来的义务，计划点名）**：核对 `.github/workflows/ci.yml`（lint/test22/test24 各 job）与 `deploy.yml` 均已有各自显式 `npm install --include=optional --ignore-scripts` 步骤——build job 的依赖此前也来自自己那一步而非内嵌 install，**workflow 零改动**，风险预案未触发。
- **分发文档同步（与脚本同刀改，D-7 原文义务）**：README 快速开始 build 行注释、AGENTS Verification Commands 英文行、PROJECT_RELEASE_PIPELINE 本地验证门槛条目，三处统一新口径"2.3.3 起 build 不含 install，跑前先装依赖"；README/AGENTS 测试计数锚同步 384/45（2.3.3 时点）。
- **验证（五闸+硬证）**：check 0 错；**384/45 文件**（+5 全为本刀守卫例）；coverage exit 0（定稿复测 46.9/39.18/38.53/52.44 ≥ 地板 42/34/34/47）；lint 0 错 30 遗留警告零新增；build 成功 1,932.03 kB / gzip 567.22 kB——**与 2.3.2 尺寸逐字相同**：版本号 "2.3.2"→"2.3.3" 同位数替换、preflight 脚本不进单文件产物，如实登记。`npm run ai-battle -- --games 300 --seed 1` 同 seed 两轮 diff 仅剩两处注册豁免计时行（npm Done 行 + avg/slowest/wall 行），胜席分布 `{"1":114,"2":186}` 与 **B2 逐字一致**、won=300、VIOLATIONS=0。**E2E 注记**：本刀改动面=CLI 构建路径、无对局内 UI/玩法触点，按计划不占浏览器 E2E；防呆各分路的权威证据=5 例沙箱 spawn 测试。CI 远端复验：**全绿**——GitHub Actions CI #72（run 36091207438，commit 0a7dff9）completed successfully，feat `294cb08`+docs `0a7dff9`+标签 `v2.3.3` 单次顶端 run 全覆盖；直连推送 curl 28 连接失败，一次性借道 127.0.0.1:10808 代理推 master+标签成功、未写持久配置。
- **GPT 沟通判断（按计划口径）**：跳过——D-7 是第二轮收官体检既决定项，本刀无契约级意外（无 CI 形态改变、无新冻结句需求）。
- **下一步**：第五刀 v2.3.4=P5 产品表面一致性（主菜单硬编码 "Qoder V1.28"→构建期 pkg.version 常量、移动模式残留提示语逐条实测清、攻击按钮禁用原因提示），非内容刀须对 B2 逐字一致；五刀收官后统一白话总结+合并向用户汇报。

## Qoder 2.3.4：2.3 第五刀·收官刀——P5 产品表面一致性（§12-0 三项老残留同刀销案）：页脚版本串构建期常量化的同时把"真凶"从"HMR 冻结"更正为"后台页签定时器强制限流"（§12-23）；移动横幅回合边界守卫采用 React 官方渲染期 state 调整形态；五动作按钮禁用原因提示与判定式同源镜像；非内容刀硬证=ai-battle 对 B2 逐字一致；2.3 五刀主线至此全部闭环（2026-09-25）

- **模型标记**：Qoder（本会话）。范围=计划 P5 三件：①MainMenu 硬编码 "Qoder V1.28"→构建期 `import pkg from '../../package.json'` + `Qoder V{pkg.version}`（与 2.2.24 gameVersion 同法）；②移动模式残留提示语（计划口径"实施时按实测定位逐条清"）；③攻击按钮禁用无原因→补 title。全部纯展示层：引擎态、dispatch、事件流零接触，非内容刀。
- **②的实测定位（本刀唯一非显然件）**：残留真身=移动选格横幅 "请选择一个高亮可进入区域" 浮起期间 ⏭️结束回合仍可点击，`movGen/movTgt/moveOptions` 三个组件态跨回合边界漏进下一座位。修复形态三选一经 lint 实测裁决：useEffect 监听 turnKey 清空与 ref 镜像方案均触发 react-hooks/refs 报错，定稿=**React 官方 render-phase state adjustment**——`const turnKey=\`${round}:${cpi}\`` 与 `useState(adjTurnKey)` 比较不等即 set 回并同时清三态，置于 `const cp=players[cpi]...if(!cp) return null` 早退**之前**保证 hooks 无条件；渲染期直调 `setMovGen(null)` 等既有 setter 不经 effect。
- **③的镜像纪律**：检视面板动作判定式已在（canMov/canAtk/canSup/canArm + meleeN/rangeN/supNeedCards/armorInHand/inEnemy），新增 movReason/atkReason/meleeReason/rangeReason/supReason/armReason 六串 if/else 链**只复读既有谓词**、不新造判定；近战/远程按钮 title 取 `canAtk?范围原因:(通用拒绝原因||范围原因)` 双层结构，保证"能攻击但范围内没敌人"与"不能攻击"各得其所。文案对齐 :617-618 整备/文将既有提示样式。
- **测试**：新文件 `src/components/surfaceConsistency.test.tsx` 4 例——页脚渲染与 package.json 版本逐字相等（组件级）；MainMenu **源码级**防回归钉（正则断言不再出现 `V\d+\.\d+` 硬编码且含 pkg.version）；五按钮行各含 `title=`；回合键守卫结构钉（turnKey 派生式+三清空逐字两正则）。**388 例/46 文件**（+4/+1）。
- **验证（五闸+硬证）**：check 0 错；388/46；coverage exit 0（定稿实测 47.02/39.12/39.19/52.81 ≥ 地板 42/34/34/47，数值仅作快照——§12-22④ 口径）；lint 0 错 30 遗留警告零新增；build 1,933.33 kB / gzip 567.74 kB（较 2.3.3 +1.30/+0.52，提示语与守卫字符串体积如实登记）。`npm run ai-battle -- --games 300 --seed 1` 同 seed 两轮、剥离两处注册豁免计时行后 **cmp 逐字节全等**，胜席分布 `{"1":114,"2":186}` 与 **B2 逐字一致**、won=300、VIOLATIONS=0——本刀零行为变化的硬证。
- **E2E（dev 5234 真实 DOM 点击）三处逐一**：①主菜单页脚实显 `Qoder V2.3.4`；③曹仁两个回合的禁用提示逐字读回（近战/远程="攻击消耗1张手牌：当前无手牌"、补给="体力已满，无需补给"、叠甲="手牌中没有军备卡"；另一回合前进="当前没有可移动的位置"——两条不同拒绝路径都可见）；②**正反证**（热座房）：太史慈 营地→前线→战场两段单路径直连后，在战场再点前进→横幅浮起+2 高亮格+结束回合此刻可点→**不选目标直接点结束回合**→换座后横幅消失、高亮清零（守卫真机生效）；随后投降清局。console 0 错误，仅 v2.3.0 诊断通道聚合 warn（据守/激昂/魂姿/奋迅/短兵/刚烈/天义 NO_RUNTIME_PAYLOAD，条目级去重正常）=既有设计行为。
- **环境根因结案（§12-23，本刀最有价值的顺带收获）**：游戏页签处于后台（`document.visibilityState==='hidden'`，用户前台标签在用浏览器）时 Chrome 施以 intensive timer throttling，实测约 **1 次/分钟**。它一次性解释了历轮两枚"假故障"：人机对战 AI 座司机看似"回合冻结"（700ms 轮询被拉到分钟级）、骰子动画看似"转不停"（80ms×20+ 次翻转需约 20 分钟收敛）——并**据此更正** 2.2.20/2.2.21 对同类现象的"测试驱动污染/HMR 双实例"归因（HMR 坑本身仍成立，但那些现象不是它）。React 点击处理器在隐藏页照常同步执行→**对局内 E2E 首选热座房**；纯装饰骰子屏可经 canonical store 动作（`rollDice()`→`setPhase('factionAssign')`→`assignFactions()`，与按钮同一批动作、非旁路引擎）直达并如实披露（本刀已如此执行）。computer-use `activate_window` 试图把页签带到前台被 `browser_url_policy` 安全策略拒绝——保护用户前台浏览，勿再尝试。
- **GPT 沟通判断（按计划口径）**：跳过——纯展示层一致性刀，无契约级意外（计划预设仅存档语义/CI 形态意外才约，未遇）。
- **五刀主线收官**：v2.3.0（编译诚实契约+onBecomingTarget，B1）→ v2.3.1（onTurnEnd+回合结束询问窗，B2 登记）→ GPT 一二刀合并复核（契约成立）→ v2.3.2（P7 存档八格矩阵+两枚阻断缺陷）→ v2.3.3（D-7 build 治理）→ v2.3.4（P5 表面一致性）。剩余路线=13 类触发按需池（需求出现才补）/P6 产品调优池/P2 网络 dormant/内置 77 将 runtime 载荷批量补全（内容量产另立需求）。
- **CI 远端复验（回填）**：**全绿**——GitHub Actions CI #74（run 36097677512，commit 02de32d）completed successfully（feat a4501c8+docs 02de32d+标签 v2.3.4 单次顶端 run 全覆盖）；直连推送 `Failed to connect to github.com:443`（curl 探测却返回 200，探测与推送结论不一致如实登记），一次性借道 127.0.0.1:10808 代理推 master+标签成功、未写持久配置。

## Qoder 2.4.0：2.4 内容量产第一刀——内置将全量分档盘点表（非内容刀，纯 docs+只读脚本佐证）：正式纠偏"77 将"为 95 将/168 条/162 名；168 条逐条四档表入 ARCH_MAP 新节 G（档1=33 含拟载载荷=后两刀施工图）；引擎真实词汇表被钉死为档1 判定唯一依据；非内容刀硬证=ai-battle 对 B2 逐字一致（2026-09-25）

- **模型标记**：Qoder（本会话）。立项背景=2.3 收官登记的剩余路线中唯一"玩家可感知为零"缺口：技能运行时链路自 2.1 起逐刀建完，但内置将技能全部只有名字（`createGeneral` 生成 `skills.map(s => ({name: s}))`，连 description 都没有），实机装配整批 `NO_RUNTIME_PAYLOAD` 诚实跳过。用户口令"和前面一样，按我给你说过的方式定制计划然后执行"=2.4 四刀计划获批准并连做授权（盘点→魏蜀群批→吴晋批→收敛核验）。
- **基数纠偏（本刀第一成果）**：历轮文档口径"内置 77 将"系错误，只读脚本实测 `src/data/generals.ts`=**95 将（魏21/蜀22/吴21/群16/晋15）、168 条技能、162 个去重技能名**。纪律=历史条目中的"77"不回改（历史记录原则），§12-24 为权威更正；今后一切内容基数引用以 §12-24+ARCH_MAP G 节为准。
- **档1 判定唯一依据=引擎实际词汇表（从 skillCompiler/SkillTriggerBridge 源码逐行钉出，非文档印象）**：可编译触发 8 类（onDeploy/onTurnStart/onDamageTaken[可滤 attack|skill]/onBecomingTarget[BEFORE_DAMAGE 纯通知]/onDamageDealt[仅攻击]/onKill/onDeath/onTurnEnd[决策型经询问窗，TURN_END 刻意不入映射]）×效果 4 原语（DRAW_CARD 恒归拥有者/DAMAGE 合成 damageType:'skill' 目标 SELF|ATTACKER|事件 TARGET/HEAL 封顶 maxHp/GAIN_ARMOR 点数）；诚实跳过面=otherTurn、killAlly、choice 未接线、无 runtime 载荷。**"无"清单同样入表头**：任意条件、给他人牌、弃牌、观牌堆、多目标、每局限一次、距离/响应修正——这批缺口就是 2.5 的按需候选。
- **分档结果（五张势力表 34/38/37/29/30 行，脚本交叉佐证行数与档位和逐一闭合）**：**档1=33**（魏3：奸雄/刚烈/屯田；蜀4：狂骨/龙吟/伏枥/烈刃；吴6：苦肉*/英姿/激昂/追忆/奋迅/补益；群2：肉林/猛进；晋18：司敌/帷幄/慧眼/屯田(晋)/英慧/颂威/拓略/破竹/清德/垦荒/奋威/临阵/单骑/奋勇/戮杀/并吞/封赏/死节），每条含拟载载荷与近似/初定义标注；**档2=48**（缺新原语）；**档3=26**（缺按需池触发）；**档4=61**（本游戏无锦囊/牌型/判定/装备区/濒死等对应物，近似彻底失真）。晋 18/30 的高密度如实登记为"自建将无原文包袱、初定义即按词汇表设计"，非盘点偏科。
- **批次再平衡披露（相对计划书"魏蜀/吴群晋"）**：档1 在晋扎堆致 M1=魏+蜀+群 9 条、M2=吴+晋 24 条——刀边界不因均衡诉求重切，两批仍各为内容刀各登记 B3/B4。
- **近似与初定义纪律**：内置技能无原文，语义=本项目首次定义；凡借三国杀印象而词汇表无法忠实表达者逐条标"近似自 X（缺 Y 原语）"或"初定义"，差异可见；实装红线=编译器拒绝当场降级档4并登记原因，绝不硬凑（不发明玩法）。
- **三枚待实证哨兵（随 v2.4.1/2 开工先验）**：①苦肉 onTurnStart→DAMAGE 1 SELF 的自伤合成路径（targetPlayerId=拥有者）是否被引擎接受；②奋威 onDamageDealt→DAMAGE 1 TARGET 链式追加依赖 AFTER_DAMAGE 载荷携带 target 字段；③跨势力重名技能（屯田/凿险/权计/自立/巧变/马术）编译 id 唯一性（id 模板 `<runtimeId>:<skill>:<effect>` 含 ownerKey 理论上不撞，测试钉死）。
- **2.5 新原语候选按档2需求频次排序（登记不实施）**：DISCARD 弃牌（19 条引用）＞发放/指定他人得牌（7）＞onCardLost/onCardGained 触发（6）＝装备区交互（6）＞牌堆顶操作（5）＞自定义条件（4）＝每局限一次（3）。
- **验证（五闸+硬证，全部在文件定稿后）**：check 0 错；**388 例/46 文件零变化**（src 与 package 依赖面零改动，版本 bump 仅 package.json/lock）；coverage exit 0（实测 47.01/39/39.13/52.79 ≥ 地板 42/34/34/47，§12-22④ 快照口径）；lint 0 错 30 遗留警告零新增；build 1,933.33 kB / gzip 567.74 kB **与 2.3.4 逐字节同尺寸**（src 零改动、版本号同 5 字符替换的自洽佐证）。`npm run ai-battle -- --games 300 --seed 1` 同 seed 两轮、剥离注册豁免计时行后 **cmp 逐字节全等**，胜席 `{"1":114,"2":186}` 与 **B2 逐字一致**、won=300、VIOLATIONS=0，逐势力锚（魏 187/129、蜀 204/130、吴 164/121/6/1、群 219/142/18/3、晋 133/87）与 §12-19 登记值全部吻合——本刀零行为变化的硬证。**E2E 注记**：纯 docs 刀无 UI/玩法触点，不占浏览器 E2E。
- **GPT 沟通判断（按计划口径）**：跳过——登记性刀，分档全程未遇契约级意外（两枚哨兵属实装期实证事项非契约问题）；计划预设的约检条件未触发。
- **CI 状态**：**全绿**——GitHub Actions CI #76（run 36101364916，commit f5f2f11）completed successfully（feat 433ea54 + docs f5f2f11 + 标签 v2.4.0 单次顶端 run 全覆盖；本次直连推送 master+标签均成功、未借道代理）。

## Qoder 2.4.1：2.4 内容量产第二刀（批量一·内容刀）——魏+蜀+群 9 条档1 技能 runtime 载荷+描述实装：只配不改引擎、编译器零拒绝零降级；哨兵③（跨势力重名 id 唯一）本批随屯田(魏)实装钉死；内容刀新基线 B3 {"1":115,"2":185} 登记；真机热座双触发实证（猛进+刚烈反伤链）（2026-09-25）

- **模型标记**：Qoder（本会话）。范围=施工图批次一（ARCH_MAP G 节档1 名单中的魏3+蜀4+群2 共 9 条）：奸雄/刚烈/屯田(魏)→曹操/夏侯惇/邓艾；狂骨/龙吟/伏枥/烈刃→魏延/关平/廖化/祝融；肉林/猛进→董卓/庞德。全部按 v2.4.0 拟载载荷逐字实装，`createGeneral` 第三参扩为 `Array<string | Skill>` 内联结构化技能定义（数据形态与编辑器/Excel v2 同一 schema，零引擎代码改动）。
- **实装结果（哨兵与降级）**：编译器对 9 条**零拒绝**（NO_RUNTIME_PAYLOAD 从 168 降至 159、本批条目清零，测试钉死）——无需触发"当场降级档4"红线；哨兵③（跨势力重名编译 id 唯一性）本批随屯田(魏)/后续屯田(晋)同池实装，`builtinContentBatch1.test.ts` 以 id 集合无碰撞断言钉死；哨兵①②（苦肉/奋威）属吴批，顺延至 v2.4.2 开工先验。
- **时序事实（龙吟）**：onBecomingTarget GAIN_ARMOR 的护甲在触发链 BFS 尾部落账（源 DAMAGE→ATTACK_RESOLVED→AFTER_DAMAGE 之后），即"本次伤害不吃本次护甲"，与 v2.3.0 派生反伤同族时序——`transitionEquivalence` 锚 g9（hp2+armor1）钉死；§12-25③ 登记为未来同类配置的时序前提。
- **测试（+9：388→397 例/46→47 文件）**：`src/skills/builtinContentBatch1.test.ts` 7 例（恰 9 条定义/本批零跳过+其余 159 条诚实跳过/描述非空/逐技能载荷表/编译 id 唯一/无重复技能/回合结束候选）；`core/transitionEquivalence.test.ts` 新 describe 2 例——五条攻击链在常驻/桥接/重建/录像回放四路逐事件一致且七项技能真实触发、逐技能可观察后果锚定（g1 hp2、g3 hp2、g9 hp2+armor1、damageCount 8、deck 2、hands 1/1）。`SkillEditor.runtime.test.tsx` 夹具从"点名曹操"改为"按结构谓词选零效果将"（曹操已有 runtime），教训入 §12-25⑤。
- **内容刀基线 B3**：ai-battle 300 局 seed1 同 seed 两轮（定稿后重跑）剥离计时行后 cmp 逐字节自洽、won=300、VIOLATIONS=0；胜席 B2 {1:114,2:186}→**B3 {"1":115,"2":185}** 登记为新基线，逐势力锚（出场/胜/登场/阵亡/攻击/击杀）入 §12-25①；分布内 159 条档外技能 NO_RUNTIME_PAYLOAD warn 全体可见=预期诚实形态。v2.4.2 起非内容刀须对 B3 逐字一致。
- **浏览器 E2E（dev 5173 热座房"白马之战4475"，真实 DOM 点击，免疫后台限流）**：本批武将庞德+夏侯惇实机入局；**两种触发真实发生**——猛进（被瞄准时对攻击者 1 点技能伤害，skillId `qun_010__inst_1:猛进:e1`）与刚烈（庞德远程攻击夏侯惇 4→3 后派生反伤 DAMAGE `wei_003__inst_c:刚烈:e1` value:1 damageType:'skill' triggerDepth:2，庞德 3→2，store 态证实）；新描述文案在真实将面面板可见；活录像 header gameVersion "2.4.1"；全程未触碰保存/下载弹窗。环境注记（营地 zone 按钮/距离规则/码点先行/拆两次调用）入 §12-25④。
- **验证（五闸全部在文件定稿后）**：check 0 错；397 例/47 文件全过；coverage 地板 42/34/34/47 维持（定稿实测 47.12/39.26/39.19/52.89，快照口径 §12-22④）；lint 0 错 30 遗留警告零新增；build 1,935.13 kB / gzip 568.20 kB（较 2.4.0 +1.80/+0.46 kB=runtime 载荷与描述文本，尺寸变化如实登记）。
- **GPT 沟通判断（按计划口径）**：跳过——内容量产形态首检已预钉在 v2.4.3 收敛刀（携 B2→B3→B4 漂移账与逐技能触发频次）；本刀无契约级意外。
- **CI 状态**：**全绿**——GitHub Actions CI #78（run 36107333284，commit 396ba3b）completed successfully（feat f961b26 + docs 396ba3b + 标签 v2.4.1 单次顶端 run 全覆盖；本次直连推送 master+标签均成功、未借道代理）。

## Qoder 2.4.2：2.4 内容量产第三刀（批量二·内容刀）——吴+晋 24 条档1 中 21 条 runtime+描述实装：两枚哨兵（苦肉 SELF 自伤/奋威链式 TARGET）实证通过；3 条 onDeploy 技能因注册序缺口诚实降档（§12-26，活性探针钉死）；编译器账本 168→31 定义/138 诚实跳过；内容刀新基线 B4 {"1":117,"2":183} 登记；热座真机三将入局+帷幄触发 🛡️1（2026-09-25）

- **模型标记**：Qoder（本会话）。范围=施工图批次二（ARCH_MAP G 节档1 吴6+晋18 共 24 条）：吴 6 全落地——苦肉(wu_004)/英姿(wu_005)/激昂(wu_016)/追忆(wu_018)/奋迅(wu_020)/补益(wu_021)；晋 15 落地——司敌(jin_003)/帷幄(jin_004 贾充)/慧眼(jin_005 张春华)/屯田晋(jin_007 邓艾)/颂威(jin_008)/破竹(jin_009)/清德+垦荒(jin_010)/奋威+临阵(jin_011 乐綝)/单骑(jin_012)/戮杀(jin_013 贾南风)/并吞+封赏(jin_014)/死节(jin_015)。写法与批一同法：`generals.ts` 内联 `Skill` 常量（description + effects[{id,trigger,runtime}]），零引擎代码改动。
- **哨兵实证（v2.4.0 登记的三枚中余下两枚，本刀收口）**：①**苦肉 SELF 自伤路径成立**——onTurnStart `DAMAGE 1 SELF` + `DRAW 2 SELF` 一条技能双效果定义（全库首个批内双定义样例，编译器/引擎/四路对账全通过）；②**奋威链式 TARGET 解析成立**——onDamageDealt attackDamage→`DAMAGE 1 TARGET`，AFTER_DAMAGE 载荷 target 字段在派生链内正确解析（真机对局+transitionEquivalence 击杀链双证）。哨兵③（跨势力重名 id）批一已钉，本刀屯田(晋)与屯田(魏)同池再验一次。三枚全过=档1 施工图词汇表经受住内容量产检验。
- **诚实降档 3 条（本刀最重要的盘缺）**：英慧(jin_008)/拓略(jin_009)/奋勇(jin_012) 三条 onDeploy 触发技能——**编译器接受但引擎结构性打不到**：`syncPlayerSkills` 在 dispatch 前从在场将领注册监听器， deploying 将领自己的 onDeploy 监听器在 `GENERAL_DEPLOYED` 发射时尚不存在。按红线不配死载荷，当场降档 4（仅描述），根因登记 §12-26，负例活性探针入 transitionEquivalence（未来接线探针变红=按需求转正重评）；2.5 接线候选两条登记不实施。
- **编译器账本（内容刀记账口径随本刀收口）**：168 条内置技能→**31 个 runtime 定义**（批一 9 + 批二 21 技能贡献 22 定义，苦肉双定义 +1）；NO_RUNTIME_PAYLOAD 诚实跳过 168→159→**138**。档1 两批实收 **30/33**（3 降档），≥25 阈值满足 → v2.4.3 按计划书第一分支（收敛核验）执行。
- **测试（+14：397→411 例/47→48 文件）**：新文件 `src/skills/builtinContentBatch2.test.ts` 7 例（恰 21 条+降档名单 3 条/描述非空/逐技能载荷对账表/全库 31 定义账本/询问窗候选=onTurnEnd 4 条〔英姿/屯田晋/颂威/垦荒〕/138 条诚实跳过全体/批内无重复）；`core/transitionEquivalence.test.ts` 新 describe「内置批量二·真实模板全路径对账」7 例（苦肉自伤四路逐字节全等、奋威击杀链式 TARGET、布防链、死亡技单骑/死节反噬、onDeploy 活性探针负例等）；`builtinContentBatch1.test.ts` 账本断言随批二重定标（≥138 跳过/ids 31）。
- **内容刀基线 B4**：ai-battle 300 局 seed1 同 seed 两轮剥离计时行后 cmp 逐字节全等、won=300、VIOLATIONS=0；胜席 B3 {1:115,2:185}→**B4 {"1":117,"2":183}**（1 席 +2 漂移=21 条进装配的预期行为变化，披露）；逐势力锚入 §12-27①。v2.4.3 起非内容刀须对 B4 逐字一致。
- **浏览器 E2E（dev 5200 热座房，真实 DOM 点击，全程未触碰保存/下载）**：批量二武将 3 名实机入局（贾南风/张春华/贾充）；**帷幄真机触发**——贾充登场后下一回合回合开始其卡面 🛡️1（onTurnStart GAIN_ARMOR 1 SELF 的账号证据，innerText 结构证据；后台页签截图不可得=NATIVE_BROWSER_VIEWPORT_UNAVAILABLE，§12-23 口径）；批量二新描述文案在将领详情弹窗真机可见。两条环境观察挂 §12-27②：营地格上限=2；登场被"营地已满"拒绝后武将卡回**将领池**（乐綝案，弃牌堆/墓地查无）——局部消耗观察，非阻断，v2.4.3 复现再定性。
- **验证（五闸全部在文件定稿后）**：check 0 错；411 例/48 文件全过；coverage 地板 42/34/34/47 维持（定稿实测 47.24/39.09/39.01/52.94，快照口径 §12-22④）；lint 0 错 30 遗留警告零新增；build 1,939.48 kB / gzip 568.92 kB（较 2.4.1 +4.35/+0.72 kB=21 条载荷+描述文本）。
- **GPT 沟通判断（按计划口径）**：跳过——内容量产形态首检预钉 v2.4.3（携 B2→B3→B4 漂移账与逐技能触发频次）；onDeploy 缺口属内容档缺口而非契约级意外（编译器契约与引擎时序均未被破）。
- **CI 状态**：**全绿**——GitHub Actions CI #80（run 36114343544，commit 6224697）completed successfully（feat 1262a4d + docs 6224697 + 标签 v2.4.2 单次顶端 run 全覆盖；直连推送 master+标签均成功、未借道代理）。

## Qoder 2.4.3：2.4 内容量产收官刀（收敛核验·非内容刀）——四刀主线全部闭环：技能触发频次观测工具（默认关零行为变化）+ 真实池 500 局审计（29 名键 14 触发/15 零触发，零触发=攻击链暴露不足非配置错）+ 完整热座 E2E 建房→结算（奸雄×2/狂骨/烈刃三真机触发）+ 录像重建逐字（终态全等+事件流剔三类重生字段后全等）+ 2.5 立项建议书（B4 逐字一致硬证达成；418 例/48 文件）（2026-09-25）

- **模型标记**：Qoder（本会话）。范围=计划书第一分支（档1 实收 30≥25 触发收敛核验形态）：全链收敛核验 + 观测工具 + 2.5 建议书，**不再扩内容也不再动引擎**。
- **观测工具（仅 src/ai，默认关闭）**：`battleRunner.ts` `trackSkillTriggers` 开关逐局采 `skillTriggers`→批汇总 `skillTriggerCounts`（排序稳定）；计数口径=**带 skillId 标记的效果事件**（DRAW/DAMAGE/HEAL/GAIN_ARMOR 四类，双效果技能分计两次）；联结键 `skillTriggerKey` 取 skillId 中段技能名——跨势力重名（屯田魏/晋）自然合并成 29 名键/30 档1 行。`battleReport.ts` `configuredSkillRows`+`formatSkillTriggerStats`；`battleCli.ts` `--skill-stats`。观测是 D-9 C 类带外信息，**默认关闭保证 B4 逐字硬证路径零触碰**（tests 钉死 off-by-default 零采集）。
- **非内容刀硬证**：ai-battle 300 局 seed1 **{"1":117,"2":183} 对 B4 逐字一致**（同 seed 两轮自洽、won=300、VIOLATIONS=0）。
- **真实池 500 局审计**（seed 5000..5499，`--skill 0 --skill-stats`，两轮输出逐字一致，产物 /tmp/realpool500a/b.txt）：胜席 {1:173,2:327}、VIOLATIONS=0；触发 Top=屯田9/苦肉8/垦荒7/帷幄6/英姿5；14 触发/15 零。**判读纪律（本刀最重要的方法论产出）**：零触发名单集中于攻击链技能（onDamageTaken/onDamageDealt/onBecomingTarget 族），根因=随机策略 500 局仅攻击 ~38 次、暴露面先天不足；刚烈/猛进（v2.4.1）与奸雄/狂骨/烈刃（v2.4.3 E2E）均已真机触发过——**不得据随机档频次判配置错误**，攻击链真实频次须策略档重测（列 2.5 前置观测项）。
- **完整热座 E2E（dev 5200「赤壁之战6922」，真实点击建房→部署→行军→攻击→结算，全程未触碰保存/下载）**：曹丕/魏延/曹操/祝融四将入局；三技能真机触发以 canonical 实况录像 `entries[].events` 为证——奸雄×2（`wei_001__inst_6:奸雄:e1`，曹操受击摸牌、P2 手牌 7→10 同步可见）、狂骨（`shu_009__inst_c:狂骨:e1`，**满血封顶仍发 HEAL 事件**，§12-28⑦）、烈刃（`shu_021__inst_j:烈刃:e1`，祝融前线上位远程射曹操 4/4→2/4 摸一）；P1 🏳️ 投降（内联确认=canonical SURRENDER 动作）→结算页判玩家 2 魏胜，终档 29 entries、末条 afterState.phase=gameOver、header gameVersion "2.4.3"。
- **录像重建逐字（内容时代首个全链闭环证据）**：终档整档喂 `ReplayPlayer.play()`——`overrideFailures=0`、**终态 JSON 逐字节全等**（8,590 字符、FNV 同为 `acfdaf18`）；133 条事件流首比有差，定位差异**恰且仅**为三类"每次重建自然重生"字段（事件 id 随机 uuid、timestamp 真实时钟、rootEventId 内嵌壁钟数字——实况触发时刻，非游戏事实，D-9 A/B 分界内），剔除后**逐字节全等**（329,822 字符全同、其中 skillId 4 处原样重放）。诚实口径：逐字=对确定性部分逐字，重生字段清单化披露而非静默豁免。
- **测试（+7：411→418 例/48 文件）**：`battleRunner.test.ts` +4（默认关零采集=观测不进游戏事实；seed712 两轮确定；`skillTriggerKey` 解析含双效果 e2；20 局批量汇总）；`battleReport.test.ts` +3（30 行 29 键屯田双现/零触发标记/名单外技能不计）。
- **2.5 立项建议书**（ARCH_MAP G 节新小节，登记不实施）：①DISCARD 弃牌原语（档2 引用 19 条居首）；②onDeploy 注册序接线（解锁 3 条降档，§12-26 探针为验收哨）；③发放/onCardLost-Gained 触发族；④攻击链频次策略档重测（观测需求非代码需求）；⑤近战按钮"零合法目标"禁用谓词（展示层顺手清，§12-28④）；其后装备区>牌堆顶>自定义条件>每局限一。
- **§12-28 环境观察七项**：抽牌窗分配控件是 SPAN 非按钮；棋子/手牌是 `<p>` 叶子；liveReplay 事件挂 `entries[].events` 且 getter 在 recorder 模块非 store；近战按钮可用但零合法目标（悬挂无消耗，挂起观察）；攻击距离矩阵逐字复核入档；陈旧攻击者陷阱（拒绝后再 targeting 可能挂旧攻击者名，发起前核对详情面板）；狂骨满血仍发事件。E2E 中文码点三踩三钉（§12-25④c 纪律再验证）。
- **验证（五闸全部在文件定稿后）**：check 0 错；418 例/48 文件全过；coverage 地板 42/34/34/47 维持（定稿实测快照 47.82/39.52/39.5/53.51，§12-22④）；lint 0 错 30 遗留警告零新增；build 1,939.79 kB / gzip 569.05 kB（较 2.4.2 +0.31/+0.13 kB=观测工具文本体积）。
- **GPT 沟通判断（按计划口径）**：**执行**内容量产形态首检——v2.4.3 计划预钉，携 B2→B3→B4 漂移账与逐技能触发频次表（分档纪律/近似标注可接受性/2.5 优先级三问）。
- **CI 状态**：**全绿**——GitHub Actions CI #82（run 36121519108，commit a83e499）completed successfully（feat 532ad31 + docs a83e499 + 标签 v2.4.3 单次顶端 run 全覆盖，2m40s；直连推送超时后一次性代理 127.0.0.1:10808 推送 master+标签成功、未写持久配置）。
- **GPT 内容量产形态首检（本刀计划预钉，已执行）**：¶ 哨兵法纯文本注入 1457 字简报（原稿 hash 3390169765→注入版 2628794017，8 批逐批累计 (len,hash) 对账全过；批 5 首次转写漏 2 码被 WRONG_N 守卫拦下、页面零污染重发），发送与末批验证同脚本原子完成；首读 752 字末句截断→按配方重载会话 URL 服务端取回 828 字全文。会话 `6ab64a22-93ac-83ee-ab9c-f388af5d65f9`，全文归档仓库外 `G:\THREE_KINGDOMS\GPT_DISCUSSION_2_4_3_REPLY.md`。**结论：内容量产形态成立、可进 2.5**；五采纳入 ARCH_MAP G 节——①降档 3 条 onDeploy 转正须「重编译+专项 E2E+录像重建+时序契约不回归」四件验收；②档1 加忠实度标签 A/B/C（仅 A/B 入档1，C 降档4）；③2.5 优先级顺序确认、攻击链策略重测须排触发族接线之后；④新增第 7 项=逐技能强制触发可达性专项（随机审计管真实性/强制覆盖管可达性）；⑤基线漂移账分「内容漂移 vs 系统偏置」两行+平衡升格阈值，当前 +2 席=观察信号不判失衡。

## Qoder 2.5.0：2.5 内容时代新原语五刀立项 + 第一刀（内容刀）——DISCARD 第五 Effect 原语全链接线（十二格表先行）+ 首批两技能反馈/断肠（保真度标签首例应用；B5 登记=对 B4 零漂移；431 例/49 文件）（2026-09-25）

- **模型标记**：Qoder（本会话）。立项=用户口令"好的，继续你的下一步"（五刀连做授权，刀间不再待口令）：#118 v2.5.0 DISCARD 原语刀（本刀）→ #119 v2.5.1 onDeploy 接线刀（非内容刀）→ #120 v2.5.2 三条 onDeploy 转正刀（四件验收）→ #121 v2.5.3 发放/onCardLost-Gained 触发族刀 → #122 v2.5.4 收敛核验刀（强制触发可达性专项+策略档重测+GPT 二检）。GPT 首检五采纳在本刀落地两处：①"接线≠转正"直接把 onDeploy 拆成两刀；②忠实度 A/B/C 标签首批应用。
- **十二格表先行（建议书口径"先填表后动刀"执行）**：ARCH_MAP F 节新增 `DISCARD 弃牌原语` 十二格契约表（Event/Timing/Source/Target/Trigger/Condition/Effect/RNG/Replay/Transition/Reentrancy/Death 链/优先级 + 忠实度/三处同步/活例附行）——**首个按十二格格式上表的 Effect 原语**（此前四原语早于契约表形态存在，本刀补纪律）。
- **实装（第五 Effect 原语）**：runtime `{type:'DISCARD', value, target}` → 派生事件 `DISCARD{playerId,count}` → `applyDiscardEvent`（`core/eventProcessors/generalEvents.ts`）。结算口径=**手牌数组头部确定性截取**（`hand.slice(0, take)`，count 0 为全手哨兵），**零新增 RNG 面**、回放逐字节不变；超量诚实钳制；playerId 缺失→无操作；**空手诚实空转**（事件仍入账、弃牌堆不动）；路由随 canonical 消耗路径（资源卡→discardPile、武将卡→持有者 generalPool）。三处同步：`skillCompiler.SUPPORTED_EFFECT_TYPES`、`dataTypes.ts` 联合、`skillExcelFormat.ts` 标签'弃牌'+SETTLEABLE_RUNTIME_TYPES；另加编辑器预览（`弃 N 张手牌`）与 `battleRunner` 效果事件集合。`SkillTriggerBridge` 的 DISCARD **按玩家不按将领实例记账**（sourceId=SELF / sourcePlayerId??attackerPlayerId=ATTACKER / targetPlayerId=TARGET）——断肠场景实证：将领已离场的攻击者仍欠牌。
- **首批两技能**：反馈（司马懿 wei_002，onDamageTaken-allDamage→DISCARD 1 ATTACKER，**保真度 B**——原文"获得伤害来源一张牌"是转移语义，转移原语缺位，诚实近似为"来源弃 1"，转移正解等 v2.5.3 发放族）；断肠（蔡文姬 qun_012，onDeath→DISCARD 0 ATTACKER，**保真度 A**，value=0 弃光哨兵首例）。**三条 DISCARD-射程内技能评估后缓配**（不采）：据守（代价与收益须原子发动，缺口真身=效果组原子性）、贞烈（无代价门槛谓词，无条件弃1回1=白奶血违"不发明玩法"）、制衡（"弃任意摸等量"=玩家自由数量，定量载荷失真判 C）。账本：168 条→**33 runtime 定义/136 诚实跳过**（批一 9+批二 22+批三 2）。
- **内容刀基线 B5**：ai-battle 300 局 seed1 **{"1":117,"2":183}**——**对 B4 数字零漂移**（五采纳⑤"漂移分账"口径：内容刀≠必须漂移；反馈/断肠在随机策略 0 触发=已知暴露面不足 §12-28，逐技能真证欠账入 v2.5.4 强制触发可达性专项）。同 seed 两轮逐字自洽、won=300、VIOLATIONS=0。v2.5.1 起非内容刀须对 B5 逐字一致。
- **测试（+13：418→431 例/48→49 文件）**：`transitionEquivalence.test.ts` +3（真实模板 DISCARD 全路径四路逐字节对账）；`EventProcessor.test.ts` +5（DISCARD 结算 describe：头部顺序/超量钳制/空手空转仍记事件/资源-武将双路由/缺 playerId 无操作）；`skillCompiler.test.ts` +1（DISCARD 编译全链）；新文件 `src/skills/builtinContentBatch3.test.ts` 4 例（批三名单/逐条载荷/33-136 账本/保真度标签登记）。`battleReport.test.ts` 频度行注释随批三重定标（32 行/31 键）。
- **热座 E2E（真实点击，全程未触碰保存/下载）**：断肠**真机全账结算**——P2 手牌 14→0、discardPile 10→16（1 攻击消耗+5 资源）、generalPool 1→9（+8 武将卡回池）、graveyard 0→1，事件流与实况录像一致；反应式 DISCARD 会吃掉本回合攻击已消耗的手牌=**规则交互非缺陷**（消耗先于伤害声明离手，§12-29③）。诚实披露：2 人房势力=晋/蜀，**司马懿（魏）不在征召池→反馈无真机触发证据**（实证链=TE 真实模板+批三账本+装配诊断跳过名单已无反馈；真机补验入 v2.5.4，§12-29⑥）。环境观察入 §12-29④⑤⑥：value=0 哨兵仅数据层可达（Excel/编辑器 min=1 表面缺口，按需求驱动挂起）、征召屏可批量点击（一次一点红线仅 GameBoard）、消耗提示中叶子点击=选卡、前线对前线=远程可达近战禁用（§12-28⑤ 矩阵再证）。
- **验证（五闸全部在文件定稿后）**：check 0 错；431 例/49 文件全过；coverage 地板 42/34/34/47 维持（定稿实测快照 48.04/39.7/39.62/53.7，§12-22④）；lint 0 错 30 遗留警告零新增；build 1,941.21 kB / gzip 569.38 kB（较 2.4.3 +1.42/+0.33 kB=原语接线+两条载荷描述文本）。
- **GPT 沟通判断（计划口径）**：**跳过**——二检按计划预钉 v2.5.4；本刀无契约级意外（十二格表先行落地、五采纳①②按预钉执行）。
- **CI 状态**：**全绿**——GitHub Actions CI #85（run 36131305437，commit 58f3db4）completed successfully（feat 487e024 + docs 58f3db4 + 标签 v2.5.0 单次顶端 run 全覆盖；直连推送连接重置后一次性代理 127.0.0.1:10808 推送 master+标签成功、未写持久配置）。

## Qoder 2.5.1：2.5 第二刀（非内容刀）——onDeploy 注册序缺口接线销案（§12-26）：TransitionCore 补部署后 resyncSkills 钩子+该步 GENERAL_DEPLOYED 重放，活性探针翻正；B5 逐字一致硬证达成（432 例/49 文件）；接线≠转正（2026-09-25）

- **模型标记**：Qoder（本会话）。五刀连做常设授权内直接开工（刀间不待口令）。范围=建议书前置项②"onDeploy 注册序接线"，采候选 a（部署结算后补注册+重放该步事件）；本刀**零内容**——英慧/拓略/奋勇三条维持纯描述，转正归 v2.5.2 四件验收（GPT 采纳①"不得自动转正"）。
- **接线三处**：① `core/TransitionCore.ts`——`TransitionContext` 新增**可选**钩子 `resyncSkills(state)`（presence-gated：无钩子的裸测试上下文保持接线前逐字行为）；`transition()` 在首结算后、死亡回环前插部署接线块：本步存在 `GENERAL_DEPLOYED` 时先 `ctx.resyncSkills(next)` 补注册，再以该步事件重放 `resolveTriggerChain(next, …, deployedEvents)`。重放纪律=与死亡回环同族：echo 按引用过滤（`!deployedEvents.includes`）、`settleable` 排除 DEATH/TRIGGERED 二次进 `processor.process`、其派生 DEATH 汇入 `derived` 交给既有有界回环——**禁第二转移路径不破**（所有效果仍只经 EventProcessor 单点结算）。② `core/GameEngine.ts`——arrow 字段 `resyncSkills` 调 `syncPlayerSkills`（skillCompiler 对 GameEngine 仅 type-import，无运行时循环依赖）；dispatch 以 `this` 作 ctx，四路径（常驻桥/对账重建/battleRunner 每步新引擎/ReplayPlayer）一处供钩全域生效。③ 防双重触发论证入码注释：每条编译定义钉 `sourceGeneralId`、bridge onDeploy 条件比对 `getRuntimeCardId(data.general)`，deploying 将监听器补注册前不存在→重放只命中新监听器；`TriggerEngine.register` Map 键 `skill:owner:skillId`=重注册幂等覆盖。
- **测试（净 +1：431→432 例/49 文件）**：`transitionEquivalence.test.ts` 旧负例探针（pin §12-26"永不触发"）翻为**正例活性哨兵**——合成 `英慧 onDeploy→DRAW 1 SELF` 载荷注入王元姬克隆体，断言恰 1 次、playerId=1、手牌 3→2、牌堆 4→3、随后 END_TURN 不再触发（缺口复发即红）；新增部署链**四路径逐事件一致**例（英慧摸牌+合成"登锋"onDeploy→GAIN_ARMOR，两步部署常驻/桥接/重建/回放逐字节对账）。**顺手钉死引擎事实**：进场血量=消耗牌数（`applyGeneralDeployedEvent: currentHp = consumeCards.length`——1 成本卡进场即 1 血，parity 例首跑即以此纠偏断言）。`generals.ts` 与 `builtinContentBatch2.test.ts` 头注同步"缺口已接通/接线≠转正"口径；三条降级技能的 NO_RUNTIME_PAYLOAD 诚实跳过账本（168→33/136）不动。
- **非内容刀硬证**：ai-battle 300 局 seed1 胜席 **{"1":117,"2":183} 对 B5 逐字一致**——won=300、VIOLATIONS=0、同 seed 两轮剥离计时行（avg/wall/Done in）后 cmp 逐字节全等；逐势力锚（魏 116/56/187/132/10/0、蜀 136/71/204/131/14/2、吴 126/55/161/115/4/0、群 126/68/214/128/15/2、晋 96/50/133/89/5/0）全部吻合 §12-27①。B5 逐字成立的结构性理由（如实登记）：现存 33 条定义无一使用 onDeploy→接线后重放面对空注册表，事件流零增改。
- **E2E 注记**：本刀无玩家可感知 UI/玩法触点（同上零内容理由），不占浏览器 E2E；真机触发证据随 v2.5.2 转正刀（四件验收含专项热座 E2E）。
- **验证（五闸全部在文件定稿后）**：check 0 错；432 例/49 文件全过；coverage 定稿快照 48.44/40.27/39.94/54.14 四项全过地板 42/34/34/47（§12-22④ 快照口径，棘轮维持不上调）；lint 0 错 30 遗留警告零新增；build 1,941.54 kB / gzip 569.47 kB（较 2.5.0 +0.33/+0.09 kB=接线块+钩子文本体积）。package.json/lock=2.5.1。
- **GPT 沟通判断（计划口径）**：**跳过**——二检按计划预钉 v2.5.4；本刀无契约级意外（候选 a 原样落地、防重触发论证兑现、presence-gated 保证无钩子路径零变化）。
- **CI 状态**：**全绿**——GitHub Actions CI #87（run 36134799473，commit 2d32941）completed successfully（feat 8886533 + docs 2d32941 + 标签 v2.5.1 单次顶端 run 全覆盖；直连推送超时（curl 直连 000）后一次性代理 127.0.0.1:10808 推送 master+标签成功、未写持久配置）。

## Qoder 2.5.2：2.5 第三刀（内容刀）——三条 onDeploy 技能转正：英慧/拓略/奋勇补真实描述+runtime 载荷（引擎零改动、编译器零拒绝），GPT 采纳①四件验收全数达成（重编译/专项热座 E2E 真机 3/3/四路径逐事件一致/时序不回归），§12-26 全销；编译器账本 168→36 定义/133 诚实跳过；内容刀新基线 B6 {"1":117,"2":183} 登记（对 B5 聚合零漂移、群/晋逐势力真实分账=「聚合相同≠无变化」教训）；434 例/49 文件（2026-09-25）

- **模型标记**：Qoder（本会话）。五刀连做常设授权内直接开工（刀间不待口令）。范围=计划书第三刀"三条 onDeploy 转正"，载荷语义按 ARCH_MAP G 节档1 拟载逐字施工（英慧 DRAW 2 SELF / 拓略 GAIN_ARMOR 2 SELF / 奋勇 DRAW 1 SELF），引擎零改动——v2.5.1 接线正是为此刀铺路。
- **四件验收（GPT 首检采纳①）逐件兑现**：① **重新编译**=五闸全绿（434 例/49 文件，账本测试重定标）；② **专项热座 E2E**（dev 5175 热座房真实点击，全程未触碰保存/下载）=**三技能真机事件级触发 3/3**——拓略 `jin_009__inst_1:拓略:e1` GAIN_ARMOR 2（卡面 🛡️2 可见）、英慧 `jin_008__inst_2:英慧:e1` DRAW 2、奋勇 seq27 `jin_012__inst_3:奋勇:e1` DRAW 1（事件链 `GENERAL_DEPLOYED→TRIGGERED(depth0)→DRAW→RANDOM_OUTCOME` 从 live 录像文档逐字取证）；③ **录像重建逐字**=`transitionEquivalence` 新增真实模板三技部署链**四路径逐事件一致**例（常驻/桥接/对账重建/录像回放）；④ **时序不回归**=既有全部对账例（含 2.5.1 正例活性哨兵）无改动全绿。**§12-26 至此全销**（缺口本体 v2.5.1 接线、三条技能去向本刀转正闭环）。
- **E2E 两条新环境事实（§12-30③，后续对局内自动化必读）**：① **armed 态 -1 牌动作（前进/登场等消耗类）必须先点一张手牌消耗卡，之后动作才真正结算**——漏点消耗卡时点目标格=静默无操作（不报错/不消耗/store 无变化），本刀三次"前进无响应"假故障根因即此；攻击链"消耗卡先于目标"旧口径（§12-25④ 记忆注17）经实证推广到一切带消耗 armed 动作。② **live 事件流的技能载荷嵌套在 `data` 字段内**（`e.data.skillId/skillName/effectType/targetId/playerId`），按顶层 `e.skillId` 过滤=0 命中——本刀首筛踩坑后改 `e.data.*` 全中。另：登场 4 成本卡须逐卡各一次 evaluate 点击，计数 4/4 后"确认位置"才解锁。
- **测试（+2 净：432→434 例/49 文件）**：`transitionEquivalence.test.ts` +2（王元姬真实载荷部署当步恰摸一次两张例；三技真实模板四路径逐事件一致例）；`builtinContentBatch2.test.ts` 降档钉翻为**转正钉**（DEMOTED2→PROMOTED2、`skip` toBeUndefined+def truthy、账本 33→36 定义/136→133 跳过、载荷表 +3 行）；`builtinContentBatch1.test.ts` 全库 id 数 33→36（无碰撞再钉）；`battleReport.test.ts` 频次表 32→35 行/31→34 名键+3 显示名钉（王元姬·英慧/杜预·拓略/文鸯·奋勇）。
- **内容刀新基线 B6 登记（分账纪律第二实证）**：ai-battle 300 局 seed1 胜席 **{"1":117,"2":183}**——对 B5 **聚合席位数字不变**，但逐势力锚真实漂移：魏 116/56/187/132/10/0、蜀 136/71/204/131/14/2、吴 126/55/161/115/4/0 三列**逐字同 B5**；**群** 126/**70**/**208**/**119**/**14**/2、**晋** 96/**48**/**134**/**95**/**4**/0=三条晋将 onDeploy 入装配的预期内行为变化。教训随刀立：**"聚合数字相同"绝不等于"无行为变化"，内容刀判漂移必须看逐势力锚**（B5=真零漂移、B6=聚合掩盖局内漂移，形态不同）；won=300、VIOLATIONS=0、同 seed 两轮剥离计时行后 cmp 逐字节全等。**v2.5.3 起非内容刀须对 B6 逐字一致**。
- **`--skill-stats` 真测**：奋勇 11/英慧 11/拓略 5——内置 onDeploy 技能**首次在 AI 对战报表中可见触发**（降档→接线→转正三步闭环的正名证据）；反馈/断肠仍 0（随机档攻击链暴露不足既有判读不变，真证归 v2.5.4 可达性专项）。
- **编译器账本**：168 条→**36 runtime 定义/133 诚实跳过**（批四 +3）；`generals.ts` 三常量 JSDoc 改"v2.5.2 PROMOTED after the four-acceptance gate"。
- **验证（五闸全部在文件定稿后）**：check 0 错；434 例/49 文件全过；coverage 定稿快照 48.19/39.83/39.76/53.85 四项全过地板 42/34/34/47（§12-22④ 快照口径，棘轮维持不上调）；lint 0 错 30 遗留警告零新增；build 1,941.91 kB / gzip 569.52 kB（较 2.5.1 +0.37/+0.05 kB=三条载荷+描述文本体积）。package.json/lock=2.5.2。
- **GPT 沟通判断（计划口径）**：**跳过**——二检按计划预钉 v2.5.4（携策略档重测+强制触发可达性专项）；本刀无契约级意外（四件验收即首检采纳①的兑现；热座消耗卡时序属环境操作知识非契约）。
- **CI 状态**：**全绿**——GitHub Actions CI #89（run 36141231801，commit 133134d）completed successfully（feat b154463 + docs 133134d + 标签 v2.5.2 单次顶端 run 全覆盖；**直连推送 master+标签均成功、未借道代理**）。

## Qoder 2.5.3：2.5 第四刀（非内容刀）——GIVE 发放原语 + onCardLost/onCardGained 触发族接线：十二格表先行（ARCH_MAP F 节 GIVE 原语十七行表+触发族表，DISCARD 表"无新增重入面"判语加注仍逐字成立）；`applyGiveEvent` 唯一结算点（手牌整体物理过手 hand→hand、五道诚实空转闸、count=0 全手哨兵、头部选取零 RNG）；CARD_* 派生事件首批**仅**从 GIVE 派生=主动收面（§12-31①）；`TransitionCore` 重入环泛化为 REACTION_EVENT_TYPES 集合闸（§12-31②）；触发族六处同步、条件只键定 playerId；generals.ts 零新载荷、账本 36 定义/133 诚实跳过不动；**B6 {"1":117,"2":183} 逐字一致硬证达成**（442 例/49 文件）（2026-09-25）

- **模型标记**：Qoder（本会话）。五刀连做常设授权内直接开工（刀间不待口令）。范围=建议书频次序第四项（发放 7＞触发族 6 并列段）——**接线刀形态同 v2.5.1：本刀只把词汇表扩到引擎，不配任何内置载荷**，转正归后续内容刀。
- **十二格表先行（动刀前提）**：ARCH_MAP F 节新增两张表——GIVE 发放原语（17 行含 活例=无、synthetic-only 披露）与 onCardLost/onCardGained 触发族（键定/逐批单事件/PRIORITY 50/纯通知事件先例 BEFORE_DAMAGE/重入评估）；顺手修订 DISCARD 表 Reentrancy 格：判语"CARD_LOST/onCardGained 仍在按需池→无新增重入面"更新为"2.5.0 时点如此、**v2.5.3 触发族上表后此判语仍逐字成立**——CARD_* 事件源首批仅 GIVE 派生，DISCARD 结算不派生"。
- **GIVE 原语落点（六文件）**：`core/Event.ts` 新事件类型 `GIVE/CARD_LOST/CARD_GAINED`；`skills/SkillTriggerBridge.createSkillEvents` GIVE 分支——`fromPlayerId`=技能拥有者玩家、`toPlayerId` 按角色键定（SELF=sourceId / ATTACKER=`sourcePlayerId??attackerPlayerId` / TARGET=`targetPlayerId`，解析不出=undefined→结算空转）、`count=Math.max(0,floor(value??1))`；`core/eventProcessors/generalEvents.applyGiveEvent` 唯一结算点——诚实空转五闸（playerId 非数/from===to/受方 absent/受方 `isAlive===false`/发放者空手=GIVE 事件照记零移动），头部确定性截取，**两类卡都整体物理过手**（资源卡与将领卡都直接进受方手牌，不回池不进弃牌堆=与 DISCARD 路由差异表内钉死）；`EventProcessor` case GIVE（单入口纪律保持）；`chainedConsequences` 观察 GIVE 前后双方手牌数差，逐批派生单条 `CARD_LOST/CARD_GAINED{playerId,count,via:'GIVE'}`（BFS 尾部进事件流→随 entry.events 进录像=A 类必录）；RNG 零新增随机面。
- **触发族上表（六处同步）**：`generals.ts` SkillTriggerType 联合 + triggerTypeLabels（失去手牌时/获得手牌时）/SkillRuntimeEffect.type + GIVE；`skillCompiler` SUPPORTED_TRIGGER_MAP + GIVE 入 SUPPORTED_EFFECT_TYPES；`dataTypes` 两联合；bridge TRIGGER_EVENT_MAP（CARD_LOST/CARD_GAINED）+PRIORITY 50+buildCondition **只比对 `data.playerId`**（手牌住玩家身上，DISCARD 教训推广——不做 sourceGeneralId 收窄）；`skillExcelFormat` runtimeEffectTypeLabels GIVE='发放'+SETTLEABLE_RUNTIME_TYPES（Excel 下拉经标签表自动扩，无需改列结构）；`RuntimeEditor` 预览"发放 N 张手牌/全部"。
- **重入泛化（禁第二转移路径不破）**：`TransitionCore` 原死亡回环改 `REACTION_EVENT_TYPES={DEATH,CARD_LOST,CARD_GAINED}` 集合闸，循环变量 pendingDeaths→pendingReactions，超限哨兵 data 键随更名 `TRIGGER_REENTRY_LIMIT{pendingReactions:N}`——哨兵纯诊断标记、现存任何内容打不到=零回放/零台账影响（如实登记 §12-31②）；上限三兄弟（≤8 轮/深度 32/链 256）不动；派生 CARD_* 经重入循环进 `resolveTriggerChain`→其效果（如 onCardGained→DRAW）仍只走 EventProcessor 同一回流。**首个结算派生可触发事件的 Effect**——此前六原语派生皆终局型。
- **非内容刀诚实面**：`generals.ts` 零改动载荷——发放系 7 条（遗计/仁德/好施/恂恂/白眉/制衡…）+触发族 6 条（连营/枭姬/奋激/智愚/忘隙/伤逝）内置技能仍纯名、照常 NO_RUNTIME_PAYLOAD 跳过，账本 **36/133 逐字不动**（批测试钉+全体测试绿=证明）；"发放给任意指定角色"另受玩家决策通道缺口约束=**接线≠可配**（G 节表注）；忘隙真实语义=onHeal 非本族、伤逝=onCardLost+差值条件（⑥自定义条件缺口），触发族近端可配的是智愚类"获得牌"侧。
- **测试（+8 → 442 例/49 文件）**：`EventProcessor.test.ts` +4（GIVE describe=DISCARD 镜像四例：头部选取 hand→hand 且将卡直传不回池/全手哨兵+超量钳制/同玩家·受方缺席·受方阵亡三道空转闸/发放者空手+缺载荷 no-op 事件照记）；`skillCompiler.test.ts` +1（合并例：GIVE 编译含 TARGET 载荷 + onCardLost/onCardGained 编译成定义）；`skillExcelFormat.test.ts` +1（两触发中文往返+下拉含项、"发放"/give 标签解析）；`transitionEquivalence.test.ts` +2（**发放实证四路径逐事件一致**：分发受击 GIVE{from:2,to:1,count:1}→CARD_LOST/CARD_GAINED{via:'GIVE'}→护短/受礼 DRAW 各 1，终态手牌/牌堆/血甲锚+常驻/桥接/对账重建/录像回放全等；**诚实空转三门+断肠 DISCARD 不派生 CARD_*+同配置两跑逐字节一致**：吝啬 SELF 自转/迟付 onDamageDealt→TARGET（AFTER_DAMAGE 无 targetPlayerId=引擎事实钉死 §12-31③）/穷送空手，观察将眼热全程零误触=键定归属闸）。
- **非内容刀硬证达成**：ai-battle 300 局 seed1 胜席 **{"1":117,"2":183} 对 B6 逐字一致**（won=300、VIOLATIONS=0、同 seed 两轮剥离计时行〔avg/slowest/wall/Done in〕后 diff 全等；逐势力锚魏 116/56/187/132/10/0、蜀 136/71/204/131/14/2、吴 126/55/161/115/4/0、群 126/70/208/119/14/2、晋 96/48/134/95/4/0 全部吻合 §12-30①）——**结构性成立**：内置零 GIVE 载荷、现存路径无一派生 CARD_*，重入面对空事件源（v2.5.1 同型论证）。
- **验证（五闸全部在文件定稿后）**：check 0 错；442 例全过；coverage 定稿快照 48.54/40.33/39.95/54.18 四项全过地板 42/34/34/47（§12-22④ 快照口径，棘轮不上调）；lint 0 错 30 遗留警告零新增；build 1,943.63 kB / gzip 569.98 kB（较 2.5.2 +1.72/+0.46 kB=原语分支+触发族+泛化文本体积）。package.json/lock=2.5.3。
- **E2E 注记**：本刀无玩家可感知 UI/玩法触点（内置零 GIVE/CARD_* 载荷，逐字锚已证零变化），不占浏览器 E2E（v2.5.1 先例）；发放/触发族真机触发证据随转正内容刀。
- **GPT 沟通判断（计划口径）**：**跳过**——二检按计划预钉 v2.5.4（携策略档重测+逐技能强制触发可达性专项）；本刀无契约级意外（十二格表先行、派生面主动收口、重入=既有有界机制泛化非新机制）。
- **CI 状态**：**全绿**——GitHub Actions CI #91（run 36147727933，master 推送触发）与 #92（run 36147728546，标签 v2.5.3 推送触发）均在 commit 06994a6 上 completed successfully（feat 7dbb818 + docs 06994a6 + 标签全覆盖；直连推送成功未借代理）。

## Qoder 2.5.4：2.5 第五刀（非内容刀）——收敛核验刀（2.5 主线收官）：`--policy` 策略档接线 + 逐技能强制触发可达性专项 36/36 + 策略档攻击链重测（零触发 15→0 翻案）+ 反馈真机补验欠账清零；B6 逐字硬锚达成；448 例/50 文件（2026-09-25）

- **`--policy` 策略档接线（仅 CLI 侧）**：`src/ai/battleCli.ts` 加 `policyByName` 四档（random/conservative/balanced/aggressive），未知档位显式拒收（报错列可选值），banner 回显 `policy <tier>`；`battleRunner.runBatch` 透传给驱动。默认 random=行为路径逐字不变（B6 硬锚即自证）。测试 +1：`battleRunner.test.ts` "runBatch forwards an opt-in policy tier deterministically"（2 局/pool4/deck36/maxSteps1200 seed 9301 ×两轮，胜席相等、violations 0）。
- **逐技能强制触发可达性专项（GPT 采纳④销案）**：新文件 `src/skills/builtinReachability.test.ts` 5 例——① 36/36 条 runtime 定义逐条喂合法激励事件**必产生真实效果事件**（覆盖 DRAW/DAMAGE/HEAL/GAIN_ARMOR/DISCARD/GIVE 六原语与全部 10 类触发键）；② 账本钉 168→36 定义/133 诚实跳过；③ 触发键恰 10 类；④ onTurnEnd 恰 6 条；⑤ 同配置两跑逐字节一致。口径登记：属**测试期专项非常驻机制**，不改任何生产触发条件；与随机审计双轨互补（真实性 vs 可达性，GPT 采纳④原话）。
- **策略档攻击链重测（2.4.3 洞察③翻案闭环）**：500 局 seed5000 同段仅换 `--policy`：balanced 胜席 {1:217,2:283}、aggressive {1:247,2:253}，两档 won=500、VIOLATIONS=0，且**配置技能 34 名键全触发、零触发 0 条**——随机档 15 条零触发实证为策略暴露面不足而非配置失效（aggressive 攻击暴露 ~7600 次/500 局 vs 随机档 ~38 次）；低频尾部=语义概率（断肠 1 需击杀者持手牌、追忆 2、司敌 5）与 36/36 可达性互证；反馈 balanced 24/aggressive 14。全表入 ARCH_MAP G 节新小节"策略档攻击链重测"。
- **反馈真机补验（v2.5.0 欠账 §12-29①清零）**：dev 5174 热座房「官渡之战2541」（`?e2e=254` 防 HMR 双实例）真实点击——P2 蜀·姜维（前线）🏹远程射魏·司马懿（营地）：选子→🏹→点消耗卡（龙骨材）→红横幅→点目标；canonical 事件链逐字取证 `DAMAGE{src:shu_010__inst_k→wei_002__inst_1,value:1}` → `TRIGGERED{sourceEvent:DAMAGE…}` → `DISCARD{skillId:"wei_002__inst_1:反馈:e1", playerId:2, count:1, triggerDepth:2, effectType:"DISCARD"}`；台账=司马懿 HP 3→2、姜维手牌 31→29（1 攻击消耗+1 反馈弃置）逐张对账；GENERAL_DEPLOYED 载荷内证反馈 runtime（onDamageTaken-allDamage→DISCARD 1 ATTACKER）与描述"受到伤害后，伤害来源弃置一张手牌。"。**至此 2.5 真机欠账全数清零**。
- **E2E 环境新事实（HANDOFF §12-32）**：①攻击 UI 定式=棋子（button 含名+❤️，非 `<p>` 名）→🏹→**必须再点一张手牌作消耗**→红横幅"⚔️远程攻击 - 点击高亮目标"→点目标；漏环节=静默取消回 board 无报错（本刀前两次假失败根因）；②React 渲染对同一次 evaluate_script 不可见——点击与核验必须拆相邻两次调用；点棋子=inspect 弹层 toggle，补点会关掉弹层；③抽牌窗流程=循环点"结算失去体力"→"🎴 抽取 5 张卡牌"→"⚔️ 开始行动"，每窗固定另发 2 张池将；④卡死 renderer 恢复=导航至另一真实 URL（about:blank 被拒），select_page 用 1 基 pageId；⑤策略档直跑命令=`esbuild src/ai/battleCli.ts --bundle --platform=node --format=cjs --outfile=.ai-battle/ai-battle.cjs && node .ai-battle/ai-battle.cjs --games 500 --seed 5000 --skill 0 --policy <tier> --skill-stats`。
- **非内容刀硬锚达成**：ai-battle 300 局 seed1 胜席 **{"1":117,"2":183} 对 B6 逐字一致**（won=300、VIOLATIONS=0、同 seed 两轮剥离计时行后 cmp 逐字节全等；结构性佐证=`--policy` 接线后默认 random 行为路径零改动，策略档仅显式传参可达）。
- **验证（五闸全部在文件定稿后）**：check 0 错；**448 例/50 文件全过**（+6）；coverage 定稿快照 48.48/40.21/39.95/54.07 四项全过地板 42/34/34/47（§12-22④ 快照口径，棘轮不上调）；lint 0 错 30 遗留警告零新增；build **1,943.63 kB / gzip 569.98 kB 与 2.5.3 逐字相同**——本刀 src 改动=CLI 侧（不进 web 产物）+两个测试文件，web bundle 零改动（产物尺寸自证改动面）。package.json/lock=2.5.4。
- **GPT 沟通判断（计划口径）**：**执行**——2.5 二检预钉本刀；简报携可达性 36/36 表、策略档重测翻案、B2→B6 漂移账、2.5 五刀闭环与 2.6 候选路线；结论随回填补记（归档仓库外 `GPT_DISCUSSION_2_5_4_*.md`）。
- **CI 状态**：**全绿**——GitHub Actions CI #94（run 36157325427，master 推送触发）在 commit 64bfdf7 上 completed successfully（feat f5b7761 + docs 64bfdf7 + 标签 v2.5.4 由单顶端 run 全覆盖；推送=直连超时→一次性代理 127.0.0.1:10808 推 master 成功、标签直连重试成功，未写持久配置）。
- **GPT 二检结论（补记 2026-09-26，归档仓库外 `GPT_DISCUSSION_2_5_4_REPLY.md`）**：注入 1515 字/8 批全批累计 (len,hash) 对账通过、末批验证+发送原子完成；首答因 UI 折叠误判 Q5 缺失，补发 78 字 Q5 单条后取得完整五问。**Q1 同意但收窄**：总判定表述限定为"完成一个真实周期验证、量产方法可外推"，不得写成"形态已被长期证明/后续条目一定无需新增原语"（CARD_* 仅 GIVE 事件源、决策通道未完成）。**Q2 修改建议（2.6 主序采纳）**：装备区交互→牌堆顶操作→CARD_* 事件源扩面（连营/枭姬真实需求驱动）→choice 决策通道→自定义条件原语→每局限一*；choice 可提前做最小骨架但严禁借批量转正。**Q3 同意**：GIVE-only 主动收口得当；DISCARD 派生事件源列为 2.6 明确立项项，不做理论完整性提前铺开。**Q4 修改建议**：choice 定义为独立能力层，先"窗口—合法候选—玩家/AI 选择—结果回写—可复现日志"最小闭环，不与某批技能转正绑定（防"接线即完成"误判回潮）。**Q5 同意+监控条件**：平衡专项暂不升格；57%/50%/随机≈61% 只证档位差异，"连续多刀同向扩大"作触发器挂监控，2.6 内容进局后同口径复判；该三数登记为 B6→2.6 平衡基线。收官定调：**2.5 验证闭环成立；2.6 优先补能力缺口；平衡暂观察、不抢跑**。

## Qoder 2.6.0：2.6 第一刀（内容刀）——装备交互原语 EQUIP_STRIP + 强袭/崩坏转正（2.6 主序首项，GPT 二检 Q2）：第七个 Effect 原语、**首个键定"将领"而非 playerId 的原语**；`applyEquipStripEvent` 唯一结算点从 fieldGeneral.armorCards 头部剥离（资源卡→discardPile、将卡回 generalPool、护甲逐点扣至 floor 0、剥空 isArming=false）、四道诚实空转闸、**无 count=0 全剥哨兵**（装备侧刻意不设，§F 表登记差异）；本刀不派生任何 CARD_*（装损→CARD_LOST 归 v2.6.2，Q3 GIVE-only 收口延续）；典韦「强袭」onDamageDealt→EQUIP_STRIP 1 TARGET（保真度 A）、董卓「崩坏」onBecomingTarget→EQUIP_STRIP 1 SELF（保真度 B：牌型谓词广义化 + 落账=伤害结算后不减当次伤害）；账本 168→**38 定义/131 诚实跳过**；三处同步七点；**B7 {"1":117,"2":183} 对 B6 逐字一致（聚合+逐势力五方零漂移）**（453 例/50 文件）（2026-09-26）

- **EQUIP_STRIP 原语接线（第七个 Effect 原语）**：`src/core/Event.ts` 加 `'EQUIP_STRIP'`；`src/core/EventProcessor.ts` dispatch `case 'EQUIP_STRIP': return applyEquipStripEvent(...)`；`src/core/eventProcessors/generalEvents.ts:321` `applyEquipStripEvent` 唯一结算点——从目标在场将领 `armorCards` **头部**剥离至多 `count` 张（头部选取=与 DISCARD/GIVE 同策零 RNG），资源卡路由进 `state.discardPile`、将卡路由回拥有者 `generalPool`（防御性诚实），`currentArmor = max(0, currentArmor − 剥离数)`（点数护甲同货币扣减），剥空附 `isArming:false`。`count = max(1, floor(value))`——**装备侧刻意不设 count=0 全剥哨兵**（与 DISCARD/GIVE 的 0=全手不同，差异记入 §F 十二格表）。四道诚实空转闸：缺 targetPlayerId/targetId、将领不在场（findGeneralRef 失败=已被本次伤害打死，"伤后再剥不能撕尸体"）、armorCards 空、载荷残缺——EQUIP_STRIP 事件仍入链（触发确实发生）。**本刀不派生任何 CARD_***（装备流失→CARD_LOST 明确归 v2.6.2，延续 GPT Q3 的 GIVE-only 收口）。
- **关键结构性差异：首个键定 GENERAL 的原语**。DISCARD/GIVE 都以 playerId 为锚（手牌是玩家的），装备（armorCards）挂在**在场将领**上，故 EQUIP_STRIP 以 `targetId`（将领运行时卡 id）定位、用 `findGeneralRef(state, targetId)` 反查回 victim 的 playerId（AFTER_DAMAGE 载荷不带 targetPlayerId——与 GIVE TARGET 同一教训）。`SkillTriggerBridge.ts:319` EQUIP_STRIP 分支据此回填 `targetPlayerId`。
- **转正两技（首批装备类内容）**：`src/data/generals.ts` 典韦 wei_012（hp4）「强袭」`onDamageDealt`（attackDamage 谓词）→ EQUIP_STRIP 1 TARGET，保真度 A（忠实原技"你弃置其装备区一张牌"）；董卓 qun_004（hp4）「崩坏」`onBecomingTarget` → EQUIP_STRIP 1 SELF，保真度 B（原技"当你成为基本牌目标"的牌型谓词广义化为"成为攻击目标"，落账时序=伤害结算后、不减当次伤害）。两条均补真实 description。
- **三处同步七点**：`generals.ts:140` SkillRuntimeEffect union + `dataTypes.ts:31` DataSkillEffectType + `skillCompiler.ts:73` SUPPORTED_EFFECT_TYPES +"EQUIP_STRIP" + `skillExcelFormat.ts:112` runtimeEffectTypeLabels EQUIP_STRIP:'剥离装备' + :116 SETTLEABLE_RUNTIME_TYPES + `RuntimeEditor.tsx:19` preview（v→'剥离 ${v} 张装备卡'）+ Event/EventProcessor 两处。
- **账本与诊断**：168 条内置技能 → **38 条 runtime 定义 / 131 条诚实跳过**（2.5.4 为 36/133，本刀 +2 定义 −2 跳过）；battleReport 37 行 / 36 去重名键；7 原语 / 10 触发键 / 6 onTurnEnd 定义。
- **内容刀新基线 B7 登记**：ai-battle 300 局 seed1 胜席 **{"1":117,"2":183} 对 B6 逐字一致**——不仅聚合零漂移，**逐势力五方锚点全部逐字吻合**（魏116/56/187/132/10/0、蜀136/71/204/131/14/2、吴126/55/161/115/4/0、群126/70/208/119/14/2、晋96/48/134/95/4/0）；won=300、VIOLATIONS=0、同 seed 两轮剥离计时行后 cmp 逐字节全等。skill-stats 崩坏 3/强袭 0（暴露面偏低，非配置错，§12 口径同历轮）。**v2.6.1 起非内容刀须对 B7 逐字一致**。
- **测试 +5 → 453 例/50 文件**：EventProcessor EQUIP_STRIP describe、skillCompiler/skillExcelFormat 标签与合并例、transitionEquivalence 装备剥离四路径逐事件一致 + 诚实空转闸、builtinContentBatch2 与 builtinReachability 账本重定标（38/131、id 38、reachability 38/38、onTurnEnd 6）。
- **E2E（热座房真实点击，dev 5175，未触碰任何保存/下载入口）**：canonical 事件链逐字取证 `ACTION_ACCEPTED→BEFORE_DAMAGE→TRIGGERED→DAMAGE→ATTACK_RESOLVED→AFTER_DAMAGE→EQUIP_STRIP→STATE_CHANGED`；armorCards 头部剥离与护甲扣减台账对平。环境新事实入 §12-33：① selectDraftGeneral 是 toggle 且有 cap-10 上限（反复点同一卡=入池/出池死循环，为卡死根因）；② live-replay 首个 dispatch 会被丢弃（先 restore 再打第一击的定式）；③ 种子在场将领必须统一 `areaOwnerId:1` 否则近战 TARGET_OUT_OF_RANGE（AttackResolver sameArea 比对 areaOwnerId）；④ `__TK__.restoreEngineState(EngineState)`（isRestorableEngineState 校验 + resetLiveReplay）与 `attackTarget(...)` 是 UI 按钮同款 canonical handler，非第二转移路径。
- **验证（五闸全部在文件定稿后）**：check 0 错；**453 例/50 文件全过**（+5）；coverage 快照 48.75/40.44/40.11/54.3 四项全过地板 42/34/34/47（§12-22④，棘轮不上调）；lint 0 错 30 遗留警告零新增；build **1,945.48 kB / gzip 570.44 kB**（较 2.5.4 +1.85 kB=原语+两条载荷+描述文本进 bundle，内容刀预期）。package.json/lock=2.6.0。
- **GPT 沟通判断（计划口径）**：**跳过**——2.6 三检预钉 v2.6.4 收敛核验刀；本刀为纯装备原语接线 + 两条技能转正，契约表先填、B7 逐字硬证、无契约级意外，不单独约评。
- **CI 状态**：**全绿**——GitHub Actions CI #97（run 36173569557，master 推送触发）在 commit 191c531 上 completed successfully（feat 2a1bf39 + docs 191c531 + 标签 v2.6.0 由单顶端 run 全覆盖；本次直连推送 master+标签均成功、未借道代理）。

## Qoder 2.6.1：2.6 第二刀（能力层非内容刀，用户确认重定性）——牌堆顶操作原语 REVEAL 观顶（第八）+ DECK_PLACE 置牌入堆（第九）：五候选逐条对词汇表核验后无一忠实可配（四技决策面属 v2.6.3 choice、洛神缺牌面对应物），"只接线不配置"，账本 38/131 不动；B7 {"1":117,"2":183} 逐字一致硬证达成（462 例/50 文件）（2026-09-26）

模型：Qoder（Claude）。仓库 `Qoder/2.0`，链上承接 v2.6.0。

- **重定性经过（本刀最重要的裁决，登记 §12-34①）**：计划书原位="内容刀→B8"（建议书 ④ 牌堆顶 5 条：观星/洛神/心战/自书/秘置）。开工逐条对照引擎词汇表：观星（观顶+重排顶序）、心战（亮顶拣选）、自书（置牌后拣选）、秘置（回合外时机+置牌决策）的**决策面全部属 choice 玩家通道**（v2.6.3 才存在，且 GPT 二检 Q4 明令 choice 不与技能转正绑定）；洛神=判定牌，本项目**无花色/判定面对应物**=维持档4。强行配定量近似载荷=违"不发明玩法"红线。经 AskUserQuestion 用户确认改立**能力层非内容刀**：只接两原语、硬锚=对 B7 逐字、五候选转正全部后移（ARCH_MAP §G 五行逐条改注"能力已就位→转正挂 choice 之后"）。这是"接线≠可配"自 2.5.3 起第二次兑现。
- **REVEAL 观顶（第八原语·纯观察）**：`core/Event.ts` 新事件 `REVEAL{ viewerPlayerId, count }`；新文件 `core/eventProcessors/deckEvents.ts` 之 `applyRevealEvent`=**结算恒返回状态原样**（观察不产生游戏事实位移）且**零随机消耗**（rngState 一字不动）——全原语族首个"零位移且零随机"原语；事件照记=触发确实发生（"空转也记录"纪律）。bridge 分支 `viewerPlayerId=Number(ownerId)`、`count=Math.max(0,floor(value??1))`。观察本身不改变任何游戏事实——状态返回原样、被观的牌序不动，"看到了什么"只存在于事件流（录像可回看这一手是谁观的、观几张）。
- **DECK_PLACE 置牌入堆（第九原语·GIVE 的手牌→牌堆镜像）**：新事件 `DECK_PLACE{ playerId, dest, count }`，**`dest:'TOP'|'BOTTOM'` 为 SkillRuntimeEffect 新可选载荷字段**（缺省=BOTTOM）。`applyDeckPlaceEvent`：**手牌头部确定性切片**（零新随机面）；TOP=前插牌堆头/BOTTOM=尾插牌堆底；**两类卡（资源/将领）都物理留在牌堆内**、不分流弃牌堆/将领池（与 GIVE/DISCARD 路由差异表内钉死）；牌堆顶=数组头=与 DRAW 同读侧；`count===0`=全手哨兵（沿 GIVE 手牌侧约定，刻意不同于 EQUIP_STRIP min=1）；空手/未知玩家/缺 playerId 诚实空转、超量 clamp、事件照记。
- **三处同步扩枚**：`generals.ts` SkillRuntimeEffect 联合 +REVEAL/DECK_PLACE +`dest?`；`dataTypes.DataSkillEffectType`；`skillCompiler.SUPPORTED_EFFECT_TYPES`；`skillExcelFormat.runtimeEffectTypeLabels`"观顶"/"置牌入堆"+`SETTLEABLE_RUNTIME_TYPES`；`SkillTriggerBridge` 译表三行+两分支；`RuntimeEditor` 预览（'观看牌堆顶 N 张'/'将 N（0=全部）张手牌移入牌堆'）+**新增"放置位置"下拉**（牌堆底（默认）/牌堆顶，仅 DECK_PLACE 显示）。**表面缺口两处（§12-34⑤）**：Excel v2 六列无 dest 列→导入导出恒 BOTTOM（TOP 仅结构化编辑器可录）；编辑器数值 min=1 不收 0→全手哨兵仅代码入库（§12-29④ 同族）。
- **账本不动（能力刀结构性佐证）**：168 条内置技能 → **38 runtime 定义 / 131 诚实跳过** 与 v2.6.0 逐字相同；观星/洛神/心战/自书/秘置 照常 NO_RUNTIME_PAYLOAD warn 诚实跳过（warn 可见=零行为变化）。Effect 原语现有 **9 种**、触发键恰 10 类不变。
- **非内容刀硬锚达成**：ai-battle 300 局 seed1 胜席 **{"1":117,"2":183} 对 B7 逐字一致**——won=300、VIOLATIONS=0、同 seed **三轮**运行剥离计时行后 diff 仅剩计时噪声；逐势力五方锚（魏116/56/187/132/10/0、蜀136/71/204/131/14/2、吴126/55/161/115/4/0、群126/70/208/119/14/2、晋96/48/134/95/4/0）全部吻合 §12-33①。结构性成立=内置零 REVEAL/DECK_PLACE 载荷、新原语面对空配置。**v2.6.2 内容刀起须登记 B9；v2.6.3 非内容刀须对 B9 逐字**。
- **测试 +9 → 462 例/50 文件**：`EventProcessor.test.ts` +7（REVEAL describe 2 例=合法载荷状态逐字段原样+rngState JSON 比对不动、坏/缺 viewerPlayerId no-op；DECK_PLACE describe 5 例=BOTTOM 默认尾插序、TOP 前插序、count=0 全手哨兵、超量 clamp+structuredClone 两跑含 rng 全等、空手/未知玩家 99/缺载荷三门诚实空转）；`skillCompiler.test.ts` +1（REVEAL/DECK_PLACE 编译+dest 转发：缺省 undefined、TOP 保留）；`transitionEquivalence.test.ts` +1（批量二节内：合成窥看 onDamageDealt→REVEAL 2 SELF 零位移+归堆 onDamageTaken→DECK_PLACE 1 SELF TOP 手牌入堆头 `['dt_hand_1',deck_1..4]`，事件载荷逐字段+常驻/桥接/对账重建/录像回放四路径逐事件一致+同配置两跑逐字节）；`SkillEditor.runtime.test.tsx` +1（DECK_PLACE 显示放置位置下拉、默认牌堆底、切 TOP 保存→store 载荷 `{type:'DECK_PLACE',value:1,target:'TARGET',dest:'TOP'}` 逐字；REVEAL 预览出现且无下拉）；`skillExcelFormat.test.ts` 既有例扩行（观顶/reveal/置牌入堆/deck_place 解析）。
- **浏览器真机冒烟（dev 5173 `?t=v261smoke2`，全程未点保存/下载）**：开发者模式经真实 store 动作 `toggleDeveloperMode(密码)` 激活→卡牌图鉴→🛠️ 将领编辑器→选曹仁→切换为多效果模式→结构化效果=REVEAL：预览"观看牌堆顶"出现、**无**放置位置下拉；改 DECK_PLACE：预览"张手牌移入牌堆"+下拉出现、默认"牌堆底（默认）"；切"牌堆顶"选择保持→**关闭不保存**（不落 skillEdits；保存持久性由 jsdom 组件测试 3/3 承载）。E2E 操作新事实入 §12-34③④：开发者按钮文案=已开启/未开启（"开发者模式"是行标签）；**已开启态再点=免弹窗直接关闭**（误点即灭的本轮实踩）；确认成功自动跳回主菜单；后台限流（§12-23）下链式 sleep 脚本必碎=改小步同步单调用、页签冻结两连击超时=navigate 新 `?t=` 实例复活。
- **验证（五闸全部在文件定稿后）**：check 0 错；**462 例/50 文件全过**（+9）；coverage 快照 48.87/40.62/40.06/54.41 四项全过地板 42/34/34/47（§12-22④，棘轮不上调）；lint 0 错 30 遗留警告零新增；build **1,947.02 kB / gzip 570.83 kB**（较 2.6.0 +1.54/+0.39 kB=两原语结算分支+桥接+编辑器下拉文本进 bundle，能力进引擎层的预期增长，B7 逐字=零行为变化的结构性证明）。package.json/lock=2.6.1。
- **GPT 沟通判断（计划口径）**：**跳过**——2.6 三检预钉 v2.6.4；本刀最关键动作恰是守住红线（五候选够不到"忠实可配"即上报重定性，而非硬凑 B8），无契约级意外。
- **CI 状态**：**全绿**——GitHub Actions CI #99（run 36199581600，master 推送触发）在 commit d8e703c 上 completed successfully（feat 0040147 + docs d8e703c + 标签 v2.6.1 由单顶端 run 全覆盖；直连推送 master+标签均成功、未借道代理）。


## Qoder 2.6.2：2.6 第三刀（内容刀→B9）——CARD_* 事件源扩面 + 连营/枭姬转正：唯一派生点三分支（DISCARD/EQUIP_STRIP 派生标注 CARD_LOST、GIVE 源补 remainingHand）、cardFilter 三谓词控流+双词表桥接、闭面清单表内钉死；账本 38/131→**40 定义/129 跳过**；**B9 {"1":117,"2":183} 对 B7 聚合与逐势力双零漂移**（niche 链暴露如实分账归 v2.6.4）（466 例/50 文件）（2026-09-26）

模型：Qoder（Claude）。仓库 `Qoder/2.0`，链上承接 v2.6.1。

- **纪律先行（§12-31①"先补表再动刀"兑现）**：ARCH_MAP 新节 **"CARD_* 事件源扩面"十七行表**（插于 onCardLost/onCardGained 触发族表与编译诚实契约表之间），含 Source/Condition/Reentrancy/Death chain 全格+**闭面清单**=DECK_PLACE/装备穿入、登场/移动/补给消耗与攻击消耗、阵亡弃牌、获得侧非 GIVE 源（DRAW 等不派 CARD_GAINED）——后续任何新事件源需求须先回这张表补格再动刀。触发族/DISCARD/GIVE/EQUIP_STRIP/REVEAL/DECK_PLACE 六张既有表的 Reentrancy/Event 格同步改注（"2.5.3 时点仅 GIVE 派生→v2.6.2 兑现扩面"，判语权威口径移交事件源表）。
- **派生三分支（唯一派生点=`core/chainedConsequences.ts::enqueueDerivedConsequences`，"从已结算事实派生"）**：DISCARD 结算后→`CARD_LOST{via:'DISCARD', playerId, count, remainingHand(结算后手牌数)}`；EQUIP_STRIP→`CARD_LOST{via:'EQUIP', playerId, count}`（targetId 键定前线将领 armorCards 结算前后差；**刻意不带 remainingHand**——装备说话不了手牌）；GIVE 既有 CARD_LOST 加性补 `remainingHand`。诚实空转不派生（无已结算事实=无事件，与 DISCARD/GIVE 空转闸同族）。重入环成员零新增：REACTION_EVENT_TYPES {DEATH, CARD_LOST, CARD_GAINED} 不变，连营/枭姬效果=DRAW_CARD 不派生任何 CARD_* ⇒ 结构上无囤积闭环；三道既有闸（轮 8/深度 32/链上 256）兜底。
- **双词表坑（本刀最重要语义事实，§12-35③）**：数据/编辑层 `cardSubType` 五值（anyLost/equipmentLost/lastHandLost/handLost/anyGained，Excel+编辑器可见）≠编译载荷 `cardFilter` 三枚（equipment/lastHand/hand）。桥接在 `SkillTriggerBridge`：equipment→`via==='EQUIP'`、lastHand→`remainingHand===0`、hand→非装备 via。**谓词只读事件已记录事实、零二次推导**——EQUIP 源无 remainingHand 字段天然喂不响 lastHand=语义正确非缺口。编译器两枚诚实 skip：lostOnly×onCardGained、anyGained×onCardLost→TRIGGER_SUBTYPE_UNSUPPORTED（走编译诚实契约既有通道，warn 可见）。
- **内容转正两条入 `generals.ts`**：陆逊 wu_007 连营=`onCardLost(lastHandLost)→DRAW_CARD 1 SELF`（A 忠实：失去最后一张手牌摸一张）、孙尚香 wu_008 枭姬=`onCardLost(equipmentLost)→DRAW_CARD 2 SELF`（A 忠实：失去装备牌摸两张）+真实描述。账本 168→**40 runtime 定义/129 诚实跳过**（+2/−2）、battleReport 频次表 39 行/38 名键；Effect 原语 9 种、触发键恰 10 类均不变（零新原语零新触发=本刀纯事件源接线+谓词控流）。伤逝类失牌差值条件仍需⑥自定义条件=**接线≠可用**维持。
- **测试 +4 → 466 例/50 文件**：`transitionEquivalence.test.ts` 27→29（**转正实证**：典韦强袭喂枭姬摸 2 + 陆逊击杀断肠将弃光喂连营摸 1，同一次多步对局常驻/桥接/对账重建/录像回放四路径逐事件一致；**谓词静默反例**：非最后一张手牌的弃牌喂不响连营、DISCARD 源喂不响枭姬〔同玩家在场〕）；`skillCompiler.test.ts` 21→22（cardFilter 谓词编译+两枚 skip）；`builtinReachability.test.ts` 5→6（**40 条全谱**强制触达、账本重定标 40/129、同配置两跑逐字节）；`SkillTriggerBridge` 双词表桥接与 `skillExcelFormat` 五标签往返=既有用例扩行（净零）。
- **内容刀新基线 B9 登记 + 零漂移如实分账（§12-35①）**：ai-battle 300 局 seed1 胜席 **{"1":117,"2":183}**——won=300、VIOLATIONS=0、同 seed 两轮剥离计时行后逐字节全等；对 B7 **聚合与逐势力双零漂移**（魏 116/56/187/132/10/0、蜀 136/71/204/131/14/2、吴 126/55/161/115/4/0、群 126/70/208/119/14/2、晋 96/48/134/95/4/0 全吻合 §12-33①）。分账口径：两条 niche 触发链（失去最后一张手牌/失去装备）随机档暴露面本就窄（与崩坏/强袭/反馈/断肠 §12-29/32/33 判读同族），验收证据=账本增量+四路径一致+真机事件级双链，策略档暴露归 v2.6.4 策略档重测+可达性专项复核，不留悬账。**v2.6.3 起非内容刀须对 B9 逐字一致**。
- **浏览器 E2E（热座房 dev 5173 `?t=b9e2`，事件级双链取证，全程未保存）**：EQUIP 路 `EQUIP_STRIP(强袭)`→`CARD_LOST{via:'EQUIP',count:1,remainingHand:undefined}`→`DRAW(枭姬 count 2)`（armor 卡入弃牌堆、currentArmor 1→0、hp 8→6、p2 手牌+2 逐张对账）；DISCARD 路 致命击杀→`DEATH`→`DISCARD(断肠)`→`CARD_LOST{via:'DISCARD',count:1,remainingHand:0}`→`DRAW(连营 count 1)`；console 0 错误、悲歌/结姻/谦逊 NO_RUNTIME_PAYLOAD warn 照旧（档外技能诚实跳过=正常）。受控场面=canonical `restoreEngineState`（§12-23 授权，随机征召未出陆逊/孙尚香，如实披露）。**E2E 新事实（§12-35④）**：live-replay 复位后**被拒派发也消费文档开档槽**（§12-33④ 精化：取第 N 个真实事件须连发 N+1 次派发，预热可用一次必然被拒的攻击）；页内 `await import('/src/data/generals.ts')` 取真模板对象；`restoreEngineState` 快照带 `phase:'playing'` → store phase 随之切换、棋盘直接渲染免走 lobby；击杀补偿抽后 store phase 翻 `'drawing'`（=UI"击破补偿抽卡"窗口，正常渲染非异常）。清理=setPhase('menu')、删页内临时对象。
- **验证（五闸全部在文件定稿后）**：check 0 错；**466 例/50 文件全过**（+4）；coverage 定稿快照 49.42/41.32/40.57/54.92 四项全过地板 42/34/34/47（§12-22④ 快照口径，棘轮不上调）；lint 0 错 30 遗留警告零新增；build **1,949.75 kB / gzip 571.47 kB**（较 2.6.1 +2.73/+0.64 kB=派生分支+桥接谓词+两技能载荷+描述文本进 bundle）。package.json/lock=2.6.2。
- **GPT 沟通判断（计划口径）**：**跳过**——2.6 三检预钉 v2.6.4；本刀无契约级意外（双词表消化在编译诚实契约既有通道内、闭面清单主动收口=GPT Q3 口径延续、重入环成员零新增）。
- **CI 状态**：**全绿**——GitHub Actions CI #101（run 36204359196，master 推送触发）在 commit 2c8b0a3 上 completed successfully（feat d1acb3e + docs 2c8b0a3 + 标签 v2.6.2 由单顶端 run 全覆盖；**直连超时→一次性代理 127.0.0.1:10808 推 master+标签均成功，未写持久配置**）。


## Qoder 2.6.3：2.6 第四刀（非内容刀，对 B9 逐字）——choice 玩家决策通道最小闭环：五要素全落地（pendingChoice A 类槽/CHOICE_REQUIRED 确定性预译/CHOOSE_OPTION 第 13 动作/CHOICE_RESOLVED 先行清账+延后结算/全 A 类进录像）、冻结世界双拒闸、编译器 effectMode 分组、description 透传；**观星系五候选与遗计/好施一律未借刀转正（GPT Q4 红线执行样本）**（479 例/52 文件）（2026-09-26）

模型：Qoder（Claude）。仓库 `Qoder/2.0`，链上承接 v2.6.2。

- **定位=能力层收口刀**：给技能系统开"玩家择一"独立通道（GPT 二检 Q4 五要素=窗口—合法候选—选择—结果回写—可复现日志）。`generals.ts` 零新载荷、内置 168 条零 `effectMode`、账本 40 定义/129 跳过不动——**B9 逐字的结构性保证**；严禁借刀批量转正（观星/洛神/心战/自书/秘置五候选、遗计/好施"指定任意角色"系）全部维持现状，转正归后续需求驱动内容刀。
- **五要素实装**：窗=`EngineState.pendingChoice` **A 类槽**（随 engineState 进录像/进投影/进对账，非 store 局部态；`storeStateToEngineState` 保留该槽=账单不因重建蒸发）；合法候选=触发时点桥**确定性预译**（`CHOICE_REQUIRED{choiceKey,playerId,options:[{label,effects}]}`，零随机面，label 第一来源=`effect.description ?? skill.description ?? skill.name`）；选择=canonical 第 13 动作 `CHOOSE_OPTION{choiceKey,optionIndex}`；结果回写=`CHOICE_RESOLVED` 先行清账（按 key 键定防串账）+**选中分支 effects 走正常结算链=延后结算（决策时点才落账，开账零落牌）**；可复现日志=全 A 类进录像、`outcomeOverrides` 零扩展。choiceKey=`ch:<turn>:<round>:<skillId>`。
- **冻结世界闸（本刀核心语义，§12-36①）**：`ActionValidator` else-if 链、drawing 之前——pendingChoice 活跃且非 gameOver 时非 CHOOSE_OPTION 一律拒 `CHOICE_PENDING`；CHOOSE_OPTION 非欠债人拒 `NOT_CHOICE_PLAYER`（**欠债人可非当前回合玩家仍放行**=择一不受行序绑架）。`ChooseOptionResolver` 六门含 `CHOICE_OPTION_OUT_OF_RANGE`。UI 语义=欠账期间"结束回合/跳过"=诚实拒绝、**先择后跳**；store `commitEndTurn` 对被拒 END_TURN 投影重建、turn 不动（测试+真机双证）。
- **编译器生产者面**：数据层新开关 `effectMode:'choice'`；同触发签名 ≥2 条带 runtime 效果→编译为**一张 choiceMode 定义**（id=`${ownerKey}:${skill.name}:choice`，**无 effectId**=一技能一决策窗），孤立效果照常独立定义；`listTurnEndSkillCandidates` 按 definition 枚举→choice 定义=单候选。Effect 原语恒 9、触发键恒 10 不变。`SkillEffectData` 透传可选 `description` 的断言涟漪：编译产物 effects 多该字段→`skillExcelFormat` 严格 toEqual 期望更新（合法涟漪）；事件载荷字节不受影响（bridge 显式字段构造）。
- **测试 +13 → 479 例/52 文件**：`ChooseOptionResolver.test.ts` 新文件 7（六门拒因/清账先行/选中分支结算/非当前玩家放行）；`transitionEquivalence.test.ts` +1（择锋闭环四路对账：开账→冻结世界**双拒**→择定落账，两个拒绝步进同一 steps 序列——**被拒动作也进录像**（D-1 SCRIPT 先例延伸），回放 processed=全动作数，拒绝 reason 本身成为四路对账对象）；`gameStore.pendingChoice.test.ts` 新文件 3（询问窗内发动→开账零落牌→endTurn 诚实拒→择定→解冻全真链；手工种账三门守卫〔非欠债人/越界/无账〕；投影不丢账）；`skillCompiler.test.ts` 净+2（分组/孤立/label 三例，旧 CHOICE 1→3）。
- **非内容刀硬锚达成**：ai-battle 300 局 seed1 胜席 **{"1":117,"2":183} 对 B9 逐字一致**——won=300、VIOLATIONS=0、同 seed 两轮剥离计时行后 cmp 逐字节全等；逐势力锚（魏116/56/187/132/10/0、蜀136/71/204/131/14/2、吴126/55/161/115/4/0、群126/70/208/119/14/2、晋96/48/134/95/4/0）全部吻合 §12-33①。**v2.6.4 起接力锚沿用 B9（本刀非内容零漂移）**。
- **浏览器真机 E2E（热座房 dev 5173 单实例，用完即杀含残留子进程 netstat 复查，全程未保存/下载）**：canonical store 动作直驱建房→征召→抽牌至 playing（人类座无 AI 司机=天然免疫 §12-23 后台限流）→`setState` 替换 engineState 引用种 pendingChoice（常驻桥 adopt-clone 天然消费）→**HUD 真实按钮 `◈ 选项1：A:draw2 / ◈ 选项2：B:draw1` 逐一渲染**→点⏭️结束回合 **turn 冻结 1**（账在手、无 ask 窗）→点选项2 账清 hand 5→6、HUD 消失→再点结束回合 **turn 2 解冻**。截图不可用（`NATIVE_BROWSER_VIEWPORT_UNAVAILABLE`=页签 hidden）→改 button innerText DOM 结构证据为真机证据（§12-36⑤）。多槽撞账单缺口如实登记 §12-36④（单槽串行化，未来需求先补 ARCH_MAP 表注再动刀）。
- **验证（五闸全部在文件定稿后）**：check 0 错；**479 例/52 文件全过**（+13）；coverage 定稿快照 **50.1/42.22/41.12/55.61** 四项全过地板 42/34/34/47（§12-22④ 快照口径，四项皆较 2.6.2 上移、棘轮不上调）；lint 0 错 30 遗留警告零新增；build **1,956.38 kB / gzip 573.16 kB**（较 2.6.2 +6.63/+1.69 kB=choice 事件族+校验/解析分支+编译器分组+HUD 文本进 bundle）。package.json/lock=2.6.3。
- **GPT 沟通判断（计划口径）**：**跳过**——2.6 三检预钉 v2.6.4（携策略档重测+可达性扩面+2.7 建议书）；本刀无契约级意外（五要素按 Q4 口径原样走通、冻结世界=既有 validator 链加闸非第二转移路径、被拒步进录像为 D-1 既有纪律延伸）。
- **CI 状态**：**全绿**——GitHub Actions CI #103（run 36220592167，master 推送触发）在 commit 5737ade 上 completed successfully（feat d2f926f + docs 5737ade + 标签 v2.6.3 由单顶端 run 全覆盖；本次直连推送 master+标签均成功、未借道代理）。

## Qoder 2.6.4：2.6 第五刀·收官刀（收敛核验·非内容刀，src/ 运行时零改动）——choice 面可达全谱（十触发键逐键开账可择定，491 例/53 文件）+ 策略档 500×2 重测（六欠账四清零、连营/枭姬窄交集判读）+ 热座完整局 E2E 录像逐字（11 entries/47 事件、overrideFailures=0）+ ARCH_MAP §G 2.7 建议书九项 + GPT 三检五问五答回填；B9 逐字硬锚达成（build 与 2.6.3 逐字节同体积=结构性佐证）；engineState 镜像重建观察项登记 §12-37② 经 Q4 升格 2.7 治理项（2026-09-26）

模型：Qoder（Claude）。仓库 `Qoder/2.0`，链上承接 v2.6.3。本刀=2.6 主线五刀收官。

- **定位与结构性事实**：收敛核验刀（计划书第五刀全数兑现），**src/ 运行时零改动**——全部产出为测试/核验/docs。五条一以贯之：①choice 面可达全谱 ②策略档重测 ③热座完整局+录像逐字 ④2.7 建议书 ⑤GPT 三检。**build 产物与 2.6.3 逐字节同体积（1,956.38 kB / gzip 573.16 kB）=B9 逐字锚的结构性佐证**（零运行时改动连 bundle 都不许变，比"数字相同"更强的断言）。
- **①可达性扩面（#128）**：新文件 `src/skills/choiceReachability.test.ts` 12 例——**十个触发键逐键**合成"择一"技能（摸二/得甲两分支，全部合成模板、内置零载荷），强制触发场景克隆自 builtinReachability 同族形态；断言链固定=触发开账（恰一张要约、双选项、延后零落账）→冻结探针（非择定动作被拒）→欠债人择定（RESOLVED 先行+选中分支落账+未选分支永不发生）→账清；另两枚反例钉=孤效果 choice 照常独立定义零要约、同配置两跑逐字节。回答 v2.6.3 装好决策通道后的收敛核验问题：**每个触发键都能承载 effectMode:'choice' 开出可择定的 CHOICE_REQUIRED 账**。测试 479→**491 例/53 文件**。
- **②策略档重测（#129）**：`--policy balanced/aggressive` 500 局×两档，v2.6 三刀累积六条暴露欠账（崩坏/强袭/反馈/断肠/连营/枭姬）**四清零**；连营/枭姬仍 0/0=**窄交集**（lastHand 流失/装备流失条件×随机策略交集过窄）而非断链——可达性专项才是配置正确性判据，随机/策略档只是频次证据（GPT Q3 接受该判读）。
- **③热座完整局 E2E（#130）**：真实 store 动作链打到 **gameOver**（live 11 entries/47 事件）→ ReplayPlayer 重建 processed=11、**overrideFailures=0** → normalize 口径终态+事件流**逐字全等**（口径=键序递归排序 stringify、剔 `metadata`/`rootEventId`、事件层剔 `id`+`timestamp`、`timelinePhase` MAIN→ACTION 折叠，§12-37③）→ 询问窗四口径全过。全程热座房无 AI 座=天然免疫 §12-23 后台限流；dev server 单实例、用完即杀含 netstat 残留复查。
- **§12-37② 观察项全文（本刀唯一新发现，Q4 升格 2.7 治理项）**：`engineAwareSetter.ts` 镜像语义——store **呈现层-only set()**（补丁不含 engineState 键）触发 `storeStateToEngineState` adapter 重建 → live 内嵌 STATE_CHANGED 快照带**呈现词表**（timelinePhase 'MAIN' vs canonical 'ACTION'、metadata 重建 `{source:'zustand-compatibility-adapter'}`、roomId 丢）。**游戏事实字段逐字全等**、后续真实转移重写后自动恢复 canonical、纯引擎重建（ReplayPlayer）永不出现=实况↔录像逐字对账成立的前提。非 2.6 返工、不阻断收官；2.7 治理刀范围=边界固定（呈现字段 vs 事实字段）+回归锚（镜像重建不得新增/污染事实事件）。
- **④2.7 建议书与 2.6 总结（#131）**：ARCH_MAP §G 追加 2.6 收官总结；候选序按三检 Q2/Q3/Q4/Q5 校准为**九项**（1 报表键定小刀→2 事件/状态事实契约治理小刀〔=本项观察项〕→3 choice 生产者扩面〔前置"只接线不带内容"最小验证刀，Q5〕→4 自定义条件原语→5 每局限一次→6 多槽 pendingChoice→7 装备销毁/受损 CARD_LOST 语义裁决〔Q3 待决策〕→8 积木语法表〔纸面可并行〕→9 平衡监控〔不升格〕）；承接池两案（积木自由拼接语法表、同势力同名=内容层允许+装配层唯一+报表键定前置）已转录。
- **⑤GPT 三检（#132，计划预钉随本刀执行）**：五问五答全文归档仓库外 `G:\THREE_KINGDOMS\GPT_DISCUSSION_2_6_4_REPLY.md`。Q1 收官句定稿（"2.6 完成一个真实能力周期的验证，方法可外推"+禁写句="2.6 已证明内容量产能力完整，后续技能可直接批量转正"不得写）；Q2 九项序成立、①②间插治理小刀；Q3 窄交集接受；Q4 观察项升 2.7 治理项；Q5 choice 扩面前先打最小验证刀。总评=**三检不阻断 v2.6.4 收官**。注入战果与四条新坑（§12-37⑤）：1921 字简报 10 批码点注入、全量哈希 879251900 逐批对账全对（批 4 漏 1 空格码被 WRONG_N 守卫当场拦下、窄读定位一次通过）；新坑 A=reload 把已发消息回填成 composer 草稿（补发前全选删除+复查 innerText 归 0）、B=漏码定位用批文件窄读禁页内穷举、C=NO_SEND_BTN 瞬时态重试一次、D=渲染滞后走服务端重载 URL 取全文；UI 折叠超长消息致 Q5 落折叠区未被答→外科补发 114 码短消息、绝不重放全稿。
- **顺手修复（本刀自引入）**：check 首跑 TS6133——choiceReachability.test.ts:21 未用导入 `listTurnEndSkillCandidates`（新文件复制模板残留），grep 确认唯一出现后删行，复检 0 错。
- **非内容刀硬锚达成**：ai-battle 300 局 seed1 胜席 **{"1":117,"2":183} 对 B9 逐字一致**——won=300、VIOLATIONS=0、同 seed 两轮剥离计时行后 cmp 逐字节全等（RUNS_IDENTICAL_EXCEPT_TIMING）；逐势力锚（魏116/56/187/132/10/0、蜀136/71/204/131/14/2、吴126/55/161/115/4/0、群126/70/208/119/14/2、晋96/48/134/95/4/0）全部吻合 §12-33①。
- **验证（五闸全部在文件定稿后）**：check 0 错；**491 例/53 文件全过**（+12）；coverage 定稿快照 **50.1/42.28/41.12/55.63** 四项全过地板 42/34/34/47（快照口径 §12-22④，较 2.6.3 微升、棘轮不上调）；lint 0 错 30 遗留警告零新增；build **1,956.38 kB / gzip 573.16 kB**（与 2.6.3 逐字节同）。package.json/lock=**2.6.4**。
- **GPT 沟通判断**：三检=本刀计划内动作（预钉），已完成并回填 ARCH_MAP §G 与 HANDOFF。
- **CI 状态**：**全绿**——GitHub Actions CI #105（run 36224245104，master 推送触发）在 commit 3d5ec30 上 completed successfully（feat f6bee82 + docs 3d5ec30 + 标签 v2.6.4 由单顶端 run 全覆盖；本次直连推送 master+标签均成功、未借道代理）。

## Qoder 2.7.0：2.7 第一刀（纯工具面·非内容刀，对 B9 逐字）——技能触发报表键定：计数键由裸技能名段改为 `将领模板id:技能名`，累积别名表解三种装配期持有者形态；期望行同改键定⇒唯一键 38→39（屯田拆两条独立账线=同势力同名裁决的观察前置）；491 例/53 文件净零新增（改形刀）（2026-09-26）

- **模型/会话**：Qoder（本轮 2.7 立项口令"进行2.7"=五刀连做授权，刀间不再待口令）。
- **本刀定位**：2.7 建议书第 1 项=报表键定小刀。**纯工具面**：只改 `src/ai/` 观测与报表路径，`src/` 玩法运行时零改动，`trackSkillTriggers` 默认关⇒B9 逐字是结构性必然（仍按纪律实测两轮）。
- **旧键定的真实缺陷（先取证再动手）**：v2.4.3 起计数键取 compiled skillId 的**技能名段**，期望行 `configuredSkillRows()` 取裸技能名。60 局 seed5000 `--skill-stats` 实测**命中 0 条配置行**——不是没触发，是键根本对不上。
- **持有者段三种形态（本刀新事实，§12-38①）**：技能 id=`${ownerKey}:${skill.name}:${effectId}`，`ownerKey = runtimeGeneralId ?? general.id`（skillCompiler.ts:152），`syncPlayerSkills` 取 `getRuntimeCardId(general) || general.id`（runtimeIdentity.ts:12-15=instanceId 优先）。于是 ai-battle 里同时存在 `ai<seed>_c<n>`（matchSetup.ts:115  stamped instanceId）与 `<模板id>_p<座位>`（matchSetup.ts:138 copy.id），UI 路径是 `<模板id>__inst_<x>`——三者都不跨批次稳定。
- **治法=累积别名表**：`collectTemplateAliases(state, acc)` 同时扫 `p.generalPool` 与 `p.fieldGenerals`（`entry.instanceId ?? general.instanceId` 与 copy id 双键入表），值=`templateOfCopyId(id)=id.replace(/_p\d+$/,'')`；**累积**而非每步快照（技能登记可长寿于名册条目：阵亡链效果在持有者离场后仍触发，单点快照必漏）；开局建一次+每步派发前并集。不可解析持有者**保留原始段**=离册行如实披露，绝不静默丢弃。旧 `snapshotFieldTemplates` 删除。
- **报表面同步键定**：`configuredSkillRows()`→`{ key: `${g.id}:${s.name}`, label: `${g.name}·${s.name}(${g.id})` }`；`formatSkillTriggerStats` 逻辑不变；`battleCli.ts` 表头文案改"键=将领模板id:技能名，双效果技能分计两次"。
- **唯一键 38→39（行数仍 39）**：屯田（魏邓艾 / 晋邓艾 `jin_007`）此前被并计，现拆成两条独立账线=用户"同势力同名：内容层允许存在、装配层强制唯一"裁决的**观察前置**（先能分开计数，才谈得上策略落地）。
- **实测（60 局 seed5000 `--skill-stats`）**：配置技能 39 条 · 触发过 **10** 条 · 零触发 29 条——贾充·帷幄(jin_004) 3 / 杜预·拓略(jin_009) 2 / 羊祜·垦荒(jin_010) 2 / 司马炎·封赏(jin_014) 2 / 黄盖·苦肉(wu_004) 2 / 邓艾·屯田(jin_007) 1 / 王元姬·英慧(jin_008) 1 / 文鸯·奋勇(jin_012) 1 / 周瑜·英姿(wu_005) 1 / 吴国太·补益(wu_021) 1；`演練` 合成技能行正确判为离册（不并入内置账线）。
- **测试改形（491 例/53 文件，净零新增）**：`skillTriggerKey` 单测重写为别名表口径（无表→原始段 `wei_001__inst_a:奸雄`；有表→`ai712_c3→wei_003:猛进`、`jin_004_p2→jin_004:帷幄`；无冒号回退）；runMatch on 例三条**负向钉**（`not.toContain('__inst')` / `not.toMatch(/^ai\d+_c\d+$/)` / `not.toMatch(/_p\d+$/)`）；**正向形状钉移入 20 局 runBatch 汇总**——单局 seed712 小池档实测 `KEYS []`，即"一次 runMatch 可以合法零技能触发"，形状断言空转即假失败（§12-38②）；battleReport 例加 `idOf()` 查模板 id（不硬编码可漂移字面量）、离册行样例改 `ai712_c3:演練・守夜`。
- **过程坑**：首版别名表只扫 `fieldGenerals` 且值取 copy id⇒报表全零命中；补 `_p\d+` 剥离+双键+累积后 CLI 复核命中。临时探针 `src/ai/__probe.test.ts` 两次使用后 `rm -f`，提交前 suite 回到 53 文件。探针期 API 误用纠正：合法动作枚举是 `engine.legalActions(playerId)` 非 `getLegalActions`。
- **非内容刀硬锚达成**：ai-battle 300 局 seed1 胜席 **{"1":117,"2":183} 对 B9 逐字一致**——won=300、VIOLATIONS=0、改设计后复跑两轮剥离计时行后 cmp 逐字节全等；逐势力锚（魏116/56/187/132/10/0、蜀136/71/204/131/14/2、吴126/55/161/115/4/0、群126/70/208/119/14/2、晋96/48/134/95/4/0）全部吻合 §12-33①。
- **验证（五闸全部在文件定稿后）**：check 0 错；**491 例/53 文件全过**；coverage 定稿快照 **50.25/42.34/41.19/55.77** 四项全过地板 42/34/34/47（快照口径 §12-22④，棘轮不上调）；lint 0 错 30 遗留警告零新增；build **1,956.81 kB / gzip 573.35 kB**（较 2.6.4 +0.43/+0.19 kB=别名表+标签文本）。package.json/lock=**2.7.0**。
- **浏览器 E2E 判断**：本刀**不占**——`src/` 运行时零改动、无玩法/交互面变更，工具面证据由 CLI 实测+单测承载（如实声明，不以单测冒充真机）。
- **GPT 沟通判断**：跳过——2.6 三检已把第四检预钉在 v2.7.4 收敛刀，本刀无契约级意外（键定属观测面，未新增语义）。
- **下一刀**=v2.7.1 事件/状态事实契约治理刀（§12-37② engineAwareSetter 镜像重建观察项收编：呈现字段 vs 事实字段边界固定+回归锚；非内容刀，对 B9 逐字）。
- **CI 状态**：**全绿**——GitHub Actions CI #107（run 36227547332，master 推送触发）在 commit 8007d5f 上 completed successfully（feat cfd69bb + docs 8007d5f + 标签 v2.7.0 由单顶端 run 全覆盖；本次直连推送 master+标签均成功、未借道代理）。**回填提交 c0a56c3 自身 CI 会话内核验**=CI #108（run 36227899205）completed successfully；该提交**直连超时→一次性借道代理 `127.0.0.1:10808` 推送成功**，未写入任何仓库级/全局持久 git 代理配置（§12 降级链按序执行）。

## Qoder 2.7.1：2.7 第二刀（事件/状态事实契约治理·非内容刀，对 B9 逐字）——zustand 兼容镜像不再把呈现词表写进事实字段：`timelinePhase` 改走**逆折叠表**（塌缩桶 `'start'` 靠 canonical 血统区分）、`metadata` 由整包替换改为 canonical 键存活+adapter 自记账层叠；D-9 呈现面推论入 ARCH_MAP C-4；§12-37③ 对账口径中的 "MAIN→ACTION 折叠" 自本刀退役（新文件 `engineFactContract.test.ts` 5 例 ⇒ 496 例/54 文件）（2026-09-26）

- **模型/会话**：Qoder（2.7 五刀连做授权内第二刀，刀间不待口令）。
- **收口对象（§12-37② 观察项=§G 建议书第 2 项）**：`storeStateToEngineState` 是 store→engine 的兼容镜像，修复前做两件错事——`timelinePhase: String(store.turnPhase).toUpperCase()` 产出引擎从不使用的方言 `'MAIN'/'START'/'END'`；`metadata` 直接**整包替换**成 `{source, drawPlayerId/Reason/TotalCards}`，任何已存在的 canonical metadata 键全丢。
- **触发面比预想大（本刀第一手事实）**：`createEngineAwareSetter`（`store/engineAwareSetter.ts:26`）对**任何 patch 不含 `engineState` 键的 set()** 都跑一次镜像重建——改标题、清 `defeatEvent`、任意纯 UI 补丁都会重写引擎态。旧文档里"呈现层不动引擎"的直觉在本库不成立，凡排查 live 快照/录像必须把这条路径算进模型。镜像产物又常被驻桥 `toEngineState`（`engineExecutionBridge.ts:75-80`）采纳进下一次派发，于是方言词表与丢字段进入 live 内嵌 STATE_CHANGED 快照以及 `liveReplayRecorder` 读取的 `afterState.metadata?.roomId`。
- **修复形态=逆折叠表，不是大写**：canonical→display 折叠在 `applyEngineStateToStore`（MENU/TURN_START→`start`、DRAW→`draw`、ACTION→`main`、GAME_OVER→`end`），故镜像必须**逆这张表**还原（`DISPLAY_TO_CANONICAL_TIMELINE` 只收 draw/main/end）。`'start'` 是**塌缩桶**、单看 display 值不可逆推，靠上一份 canonical 血统区分（`previous.timelinePhase === 'TURN_START' ? 'TURN_START' : 'MENU'`）；无显示信号时**原样带走** `previous.timelinePhase` 而非猜。
- **metadata 键存活**：`rebuildMetadata` = canonical 在下、adapter 自记账（`source` + draw 观察三键）在上层叠；draw 三键每次 `?? null` 显式重置，防呈现观察跨镜残留。
- **契约定位（D-9 呈现面推论，已入 ARCH_MAP C-4）**：`turn / consumedSkills / pendingChoice / rngState / metadata / timelinePhase`=A 类游戏事实；`turnPhase / phase / roomName` 等 display 字段=B 类呈现。镜像只允许把 B **还原**成 A 的词汇，不得新造方言；镜像本身**零事件外发** ⇒ 绝不构成第二转移路径（禁第二转移路径红线自查通过）。
- **行为变化如实披露**：store 初态 `engineState.timelinePhase` `'START'→'MENU'`、playing 期 `'MAIN'→'ACTION'`。全库唯一读 timelinePhase 做合法性判定的是 `rules/ActionValidator.ts:44`（条件 `!== 'ACTION' && phase !== 'playing'`，playing 期不拦）⇒ 对局结果零变化，B9 逐字为证。
- **回归锚（新文件 `src/store/engineFactContract.test.ts` 5 例）**：反向词表四态；`start` 塌缩桶 + 无信号带走 + 旧形态 undefined；canonical metadata 存活与陈旧 draw 键重置；`turn/rngState/consumedSkills/pendingChoice` 逐字过镜；**全链集成例** `engineAwareSetter → dispatchStoreAction → liveReplayRecorder`（呈现层 set() 零事件零记账、下一次派发快照仍 canonical、录像建档读到真 roomId）。**方法论**：镜像契约类改动必须走全链测试——纯函数测不出"呈现层 set() 不往录像里记东西"，而后者才是本刀口径本体。测试 491→**496 例/54 文件**。
- **测试期两处真机语义纠偏（不是断言笔误）**：① END_TURN 是真的转移，`engineState.turn` 从镜像带来的 5 前进到 **6**（防回卷断言按 6 钉并注明意图）；② `recordLiveDispatch` 语义=**reset 后首次派发负责建档且不落条目**，故"entries +1"要第二次派发才成立、roomId 也在**开档那一刻**读取——据此把③块改为"开档即读到真 roomId 且 entries 0 → 再派发 entries 1"。
- **热座 E2E（本刀动 store 实况路⇒占用真机；dev 单实例、用完即杀、netstat 复查无 LISTENING、全程未触碰保存/下载）**：主菜单→本地游戏→创建房间"定军山之战5610"→骰子（后台限流补丁）→两席各 10/10 真实征召（含群 1 名）→两轮初始抽卡进 ACTION。三件核心证据：① ACTION 期真点呈现层动作 `clearDefeatEvent()` 后 `engineState.timelinePhase` 仍 `'ACTION'`（修复前此步写 `'MAIN'`）且录像 entries **4→4 零记账**；② 随后真点 ⏭️结束回合 → `turn 1→2`、canonical `'DRAW'`、entries 4→5（镜像未腐蚀下一次派发）；③ 取 live 文档（5 entries、header `gameVersion:'2.7.1'`）经 ReplayPlayer 重建 **processed=5、overrideFailures=[]**，剔 metadata 后终态 JSON 与 live **逐字节全等（9848 字符）**、两侧 timelinePhase 同 `'DRAW'` ⇒ **§12-37③ 的 "MAIN→ACTION 折叠" 补偿自本刀退役**（旧对账脚本别再抄）。
- **E2E 新发现（挂 §12-39⑦，刻意不扩本刀范围）**：真实 store 建房路径下 live 录像 `roomId` **恒 `'local'`**——房间名只住呈现字段 `store.roomName`，全库唯一把 roomId 写进 `EngineState.metadata` 的是 `ai/matchSetup.ts:188`（AI 对战工具线）。故 §12-37② 原文"roomId 丢"的准确表述=镜像会丢掉任何**已存在**的 canonical metadata 键（本刀已治），而 store 建房链**本就没有**这个事实可丢；操作日志头"房间：local"由此而来。修法（createRoom 把房间名登记为 metadata 事实）=新增游戏事实，按"不发明玩法"纪律待需求首现，列 2.8 候选。
- **非内容刀硬锚达成**：ai-battle 300 局 seed1 胜席 **{"1":117,"2":183} 对 B9 逐字一致**——won=300、VIOLATIONS=0、同 seed 两轮除两行计时外 cmp 逐字节全等；逐势力锚（魏116/56/187/132/10/0、蜀136/71/204/131/14/2、吴126/55/161/115/4/0、群126/70/208/119/14/2、晋96/48/134/95/4/0）全部吻合 §12-33①。工具线不经 store 镜像，故此锚同时是本刀"零玩法变化"的结构性佐证。
- **验证（五闸全部在文件定稿后）**：check 0 错；**496 例/54 文件全过**；coverage 定稿快照 **50.13/42.12/41.08/55.63** 四项全过地板 42/34/34/47（§12-22④ 快照口径，棘轮不上调）；lint 0 错 30 遗留警告零新增；build **1,957.31 kB / gzip 573.46 kB**（较 2.7.0 +0.50/+0.11 kB=折叠表与 metadata 层叠代码面）。package.json/lock=**2.7.1**。
- **GPT 沟通判断**：跳过——四检按计划预钉 v2.7.4 收官刀；本刀是把三检 Q4 已裁决的口径落地，无契约级意外。
- **下一刀**=v2.7.2 choice 生产者最小验证刀（三检 Q5：目标选择器+卡牌选择器候选构造器"只接线不带内容"、内置零转正；非内容刀，对 B9 逐字）。
- **CI 状态**：**全绿**——GitHub Actions CI #110（run 36229798799，master 推送触发）在 commit 81e5b38 上 completed successfully（feat 26b328d + docs 81e5b38 + 标签 v2.7.1 由单顶端 run 全覆盖；master 与标签**直连均失败**→按降级链一次性借道代理 `127.0.0.1:10808` 推送成功、未写任何持久 git 代理配置）。**回填提交 66ffc43 自身 CI 亦会话内核验全绿**=CI #111（run 36230098589）在 commit 66ffc43 上 completed successfully，该回填提交**直连推送成功、未借道代理**。另：上轮遗留未验的回填提交 7be5b64 本轮会话内核验=CI #109（run 36228193136）completed successfully，欠账清零。

## Qoder 2.7.2：2.7 第三刀（choice 生产者最小验证·非内容刀，对 B9 逐字）——给"弹出选项等你选"那台机器装上两枚候选生成器（挑目标/挑手牌），只接线不带内容：编译模型新字段 `choiceSource?/choiceTargetScope?` 唯一入口=registerPlayerSkills（第四次"接线≠可配"预防针）、生产者型定义=恰一张模板效果、**空候选不发要约**（冻结闸死锁预防）、手牌摘取单点化 `selectHandCards(hand,count,cardKeys?)` 三路共用且无 cardKeys 形态逐字不变；`PendingChoiceOption{label,events}` 形状一字未动⇒四消费方零改动（新文件 `choiceCandidates.ts`+`handSelection.ts`+`choiceProducers.test.ts` 13 例 ⇒ 509 例/55 文件）（2026-09-26）

- **模型/会话**：Qoder（2.7 五刀连做授权内第三刀，刀间不待口令）。
- **口径来源（GPT 三检 Q5）**：问"生产者能否合法产生标准 choice 请求"，答=装候选枚举器而非配技能内容。零新事件/零新原语（恒 9）/零新触发键（恒 10）/零新 canonical 动作（恒 13）；`generals.ts` 零新载荷、内置 168 条零 `choiceSource`（B9 逐字的结构性保证）。
- **两枚纯候选枚举器（新文件 `src/skills/choiceCandidates.ts`）**：`enumerateTargetCandidates`——场上将领=players 数组序×fieldGenerals 数组序，`isAlive===false` 玩家整域出局，作用域三档 `ENEMY_FIELD`（排他座）/`ALL_FIELD`/`SELF_FIELD`（只本座），`targetId=getRuntimeCardId(general)||String(general.id)`、label=将领名；`enumerateHandCardCandidates`——欠债人自己手牌数组序，形状 `{label,cardKeys:[id]}`。两者零随机，数组序即录像可复现序。
- **编译模型新字段与桥内分派**：`dataTypes.DataSkillDefinition` 加 `choiceSource?:'TARGET'|'HAND_CARD'` 与 `choiceTargetScope?`；`SkillTriggerBridge.buildChoiceOptions` 按此分派枚举器。缺省=undefined=v2.6.3 逐效果行为逐字不变。**生产者型定义只认恰好一张模板效果**（`template = choiceSource && effects.length===1 ? effects[0] : undefined`），多条带 choiceSource 退回逐效果分支（负例钉）。**候选集为空⇒桥侧根本不发要约**（`options.length===0` 返回空事件）——冻结世界闸下开空账=死锁，故空账不开。
- **"接线≠可配"第四次预防针**：两字段只住在编译模型层，唯一入口=`engine.registerPlayerSkills`；数据层 Skill 类型/SkillEditor/Excel v2 六列均无录入面——真机可达须待内容刀按需求立录入面，本刀刻意不铺。
- **手牌摘取单点化（新文件 `src/core/eventProcessors/handSelection.ts`）**：`selectHandCards(hand,count,cardKeys?)` 由 DISCARD/GIVE/DECK_PLACE 三路结算器共用；无 cardKeys=头部切片、count=0 全手哨兵**逐字不变**（v2.6.1 语义）；cardKeys 命中=按 getRuntimeCardId 摘取保持相对序、未知 id 忽略、count 不参与、空数组=等同缺省。事件载荷新增可选 `cardKeys?:string[]`（additive 非破坏）。后续一切"玩家拣选手牌"的原语走此 helper，不再各自写切片。
- **测试（+13 → 509 例/55 文件，新文件 `src/skills/choiceProducers.test.ts`）**：TARGET 5 例（END_TURN→链推 TURN_START 开账、choiceKey `/^ch:\d+:\d+:/`+labels+每选项预译 DAMAGE 载荷逐字、延后零落账；冻结双拒+择 index1 只被选者 6→5+RESOLVED{label}先行+账清；空候选零事件不锁桌；choiceSource+两效果=退回逐效果；同配置两跑 normalize 后 stream+final 逐字节）；HAND_CARD 4 例（labels ['乐','选','留']+逐选项 cardKeys、择 index1 后 hand=['乐','留'] 非头部切片实证+弃牌堆含'选'、空手零要约、GIVE/DECK_PLACE 载荷 cardKeys 逐字）；纯函数 4 例（三档作用域含阵亡出局、枚举器形状、selectHandCards 六断言、三路结算器直调回归钉含牌堆序逐字）。**定稿教训**：编译模型 `SkillEffectData` 无 `id` 字段（id 属数据层 SkillEffect）——测试对象写 id 直接 TS2353×5。
- **`__TK__` dev 注入面扩为 `{useGameStore, liveReplay, choiceCandidates}`**（main.tsx dev-only 分支），供真机枚举器对账探针。
- **真机生产者入口缺失的结构性定性（§12-40①）**：常驻容器每 dispatch `syncPlayerSkills` 全量重导出技能，页内手工注册的合成生产者下一次派发即被抹——零内容刀下真机全链"技能自动开要约"不可达，属设计后果非缺陷；桥内全链由 vitest 真实 GameEngine（非 mock）13 例实证。真机合法形态=canonical `restoreEngineState` 种账+真点 HUD。
- **热座 E2E（dev 5173 单实例、用完即杀、netstat 复查无 LISTENING、全程未触碰保存/下载）三件承诺兑现**：① 真实枚举器对 live 热座态跑账（周泰/夏侯渊/手牌五张与场面逐一对上、三档作用域正确）；② canonical `restoreEngineState` 两次种账（受控场面+CHOICE_REQUIRED 要约）；③ **真点 HUD「◈ 选项2：夏侯渊」**→只被选者 4→3、账清、录像建档基准态与择定后现态逐字（initialState 含 currentHp:3）。两处如实披露：装饰段（骰子→征召→抽牌）因后台页签定时器限流（§12-23）按记忆第 15 条口径经**与按钮同批 canonical store 动作**直达，真点击只留给验证目标本身；录像 entries=0 非丢录=**restore 后首 dispatch 只建档不落条目**的既有语义（§12-40②，判据=initialState 与择定后现态逐字）。HUD 按钮"点击后新出现须拆下一条 evaluate"（记忆第 15 条另证）。
- **非内容刀硬锚达成**：ai-battle 300 局 seed1 胜席 **{"1":117,"2":183} 对 B9 逐字一致**——won=300、VIOLATIONS=0、同 seed 两轮除计时行 cmp 逐字节全等；逐势力锚（魏116/56/187/132/10/0、蜀136/71/204/131/14/2、吴126/55/161/115/4/0、群126/70/208/119/14/2、晋96/48/134/95/4/0）全部吻合 §12-33①。
- **验证（五闸全部在文件定稿后）**：check 0 错；**509 例/55 文件全过**；coverage 定稿快照 **50.66/42.73/41.56/56.2** 四项全过地板 42/34/34/47（§12-22④ 快照口径，棘轮不上调）；lint 0 错 30 遗留警告零新增；build **1,958.64 kB / gzip 573.86 kB**（较 2.7.1 +1.33/+0.40 kB=两枚举器+helper+桥分派代码面）。package.json/lock=**2.7.2**。
- **GPT 沟通判断**：跳过——四检按计划预钉 v2.7.4 收官刀；本刀是三检 Q5 口径原样落地（枚举器形状零破坏），无契约级意外。
- **下一刀**=v2.7.3 自定义条件原语刀（建议书第 4 项，十二格表先行；非内容刀，对 B9 逐字）。
- **CI 状态**：**全绿**——GitHub Actions CI #113（run 36232695206，master 推送触发）在 commit 98d7cda 上 completed successfully（feat c23a04d + docs 98d7cda + 标签 v2.7.2 由单顶端 run 全覆盖；本次直连推送 master+标签均成功、未借道代理）。


