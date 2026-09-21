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

当前最新 Qoder 版本：`2.0.1`（独立仓库 `Qoder/2.0`，附注标签 `v2.0.1`；里程碑标签 `v2.0` -> 提交 `95b3540`）
本轮调整（2.0.1）：修复 xlsx(SheetJS) 高危漏洞。npm 注册表的 xlsx 永久停在含漏洞的 0.18.5（GHSA-4r6h-8v6p-xvw6 原型污染 + GHSA-5pgg-2g8v-p4x9 ReDoS），官方修复版只发布在 SheetJS CDN；依赖已切换为 `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`，无需改动业务源码（唯一消费方 SkillEditor 仅用 XLSX.read / sheet_to_json 只读 API，版本兼容）。`npm audit` 由 3 项（含 1 high）降至 2 moderate（exceljs 传递依赖 uuid，维持延期）；check/test/lint/build 全量通过。
上一轮（2.0）：基于 1.29.2 源码生成 2.0.0；引入 Vitest（128 测试，覆盖全部 action resolvers + EventProcessor）与覆盖率阈值棘轮；引入 ESLint flat config 0-errors 门禁；配置 GitHub Actions lint / Node 18,20,22 测试矩阵 / build / Pages 部署工作流；新增 `npm run test` / `test:coverage` / `lint` / `lint:fix` 验证命令。CI 因未配置远程仓库属"已配置未验证"。
更早（1.29.2）：修复依赖安全漏洞，升级 uuid 与 vite，exceljs 有意调整为 `^3.4.0`（锁文件解析至 3.10.0）；验证 npm run check/build 通过；xlsx 漏洞因无可用修复版本仍存在。

版本号不能单独用于判断跨模型分支的先后关系。

### Git 管理状态
从 Qoder 1.29 开始，当前版本目录已作为独立 Git 仓库管理。旧的 `Qoder/1.0`～`Qoder/1.29` 文件夹暂时保留为备份，不再通过复制文件夹创建新版本。

`Qoder/2.0` 是与 `Qoder/1.29` 相互独立的另一个 Git 仓库，两者不共享提交历史：1.29 仓库最新为 `2cfcbbf`（附注标签 `v1.29.2`），2.0 仓库里程碑为 `95b3540`（附注标签 `v2.0`，代码里程碑 `530fecf`）。两个仓库目前均未配置远程（remote），GitHub Actions 工作流在推送到 GitHub 之前不会实际运行。

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
- 回合结束如存在可发动的将领技能，应进入对应技能询问/结算窗口，确认不发动后再完成回合结束结算。
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
- 当前审查发现的高优先级 legacy 候选包括：`src/skills/SkillEngine.ts`、`src/skills/EffectResolver.ts`、`src/card/*`、`src/actions/*`、`src/status/*`、`src/timeline/TurnManager.ts` / `PhaseManager.ts`；这些目前不应被当作 canonical 规则入口。删除前仍需再次做调用图确认。
- 当前唯一明确的技能执行目标为 `TriggerEngine + SkillTriggerBridge`；但 1.26 源码中尚未发现 `registerPlayerSkills` 的实际业务调用，因此技能系统目前应标记为“架构骨架已存在、正式玩法运行时尚未闭环”，不得宣称技能系统已经完成。

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
- 2.0：GitHub Actions（lint / Node 18,20,22 矩阵 test / build / Pages 部署）已配置但从未运行——仓库无远程；推送到 GitHub 后需在仓库 Settings -> Pages -> Source 选择 "GitHub Actions"。
- 2.0.1：xlsx(SheetJS) 高危漏洞经 SheetJS CDN 0.20.3 修复（会话内独立验证：check=0 / 128 pass / lint 0 err / build ok / audit 剩 2 moderate）。技能编辑器 Excel 导入的真实文件回归待用户验证（PENDING）。
- 剩余依赖风险：exceljs 传递依赖 uuid 的 2 项 moderate 维持延期；且 1.29 线 exceljs 为 `^3.4.0` 而 2.0 线为 `^4.4.0`，两仓库不一致，待后续统一决策。

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
1. 5.35.26.4 跨势力 / 群势力外框最终视觉。
2. 将领池随机长期样本。
3. 非棋盘页面响应式 / 移动端体验。
4. Skill Runtime 最终唯一化与旧系统清理。
5. 真正在线 WebSocket / Session / DB / 生产服务。
6. Qoder 分支如需合并，必须基于实际源码独立审查，不能仅凭日志判断。
7. Qoder 1.29 `package-lock.json` 已与 `package.json` 版本号保持一致，并明确记录 Rollup Linux 可选依赖；Git 已通过 `.gitignore` 排除 `node_modules/`、`dist/`、`.env` 和 `*.log`。
8. 本机存档恢复和坏档清理仍需实际用户回归验证。
9. 技能系统仍存在多套数据/运行时结构；canonical 路径尚未被实际业务调用闭环。
10. GPT 审计指出的 1.29 归档边界问题已纳入迁移规则：正式提交不得包含 `node_modules/`、`dist/` 或空的依赖目录。

## 13. 当前默认路线

1. 技能系统唯一化。
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
