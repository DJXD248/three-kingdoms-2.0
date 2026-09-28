# PROJECT_HISTORY_HUMAN.md — 人类可读历史记录

> 本文件只负责**历史记录**。
> 当前规则、当前状态、当前架构和维护规范统一见 `PROJECT_HANDOFF.md`。
> 不在本文件重复维护当前规则；这里保留历史演化、原因、修复和验证。

---

## Qoder 1.29：修复构建时缺少 Rollup 依赖

**模型标记：** `[MODEL:COPILOT-SDK-VSCODE]`

### 本轮目标
只修复 GPT 提到的构建环境问题，不改变游戏玩法和代码结构。

### 实际改动
- 明确登记 Linux 版本的 Rollup 构建依赖，避免只在某一种电脑上安装成功。
- 构建前会自动补齐可选依赖，解决已有依赖文件夹不完整时 Vite 无法启动的问题。
- 同步更新依赖锁定文件和版本号，当前版本为 `Qoder V1.29`。
- 本轮没有改动游戏功能、存档功能或页面布局。

### 当前状态
在本机完成了干净安装、类型检查和正式构建，均通过。构建完成后已清理生成的依赖和输出文件夹，1.29 保持为干净源码版本。

### 待验证项
请让 GPT 或其他 Linux 环境使用 [Qoder 1.29](D:/THREE_KINGDOMS/Qoder/1.29) 重新执行 `npm ci` 和 `npm run build`，确认不再出现缺少 `@rollup/rollup-linux-x64-gnu` 的错误。

### 下一步建议
先确认 Linux 构建通过，再决定是否继续处理依赖安全警告；本轮暂不扩大修改范围。

---

## Qoder 1.29：把版本管理改成 Git

**模型标记：** `[MODEL:COPILOT-SDK-VSCODE]`

### 本轮目标
参考 GPT 对 1.29 干净归档的检查意见，把项目从“每次复制一个文件夹”改成由 Git 保存每次版本。

### 实际改动
- 在 [Qoder 1.29](D:/THREE_KINGDOMS/Qoder/1.29) 内建立独立 Git 仓库，避免受到上级目录仓库影响。
- 新增 `.gitignore`，不保存依赖文件夹、构建输出、环境变量文件和日志文件。
- 当前源码作为第一个基线提交，提交说明按要求写为 `v1.16 baseline`。
- 为当前代码打上 `v1.29` 标签。
- 旧的 `Qoder/1.0`～`Qoder/1.29` 文件夹全部保留，暂时作为备份。
- 交接文档补充了查看历史、查看标签、切换版本和提交新迭代的常用命令。

### 当前状态
以后新版本不再通过复制文件夹产生，而是在 1.29 这个 Git 仓库里继续提交和打标签。GPT 审计发现的 Rollup 依赖记录已保留，本轮没有新增游戏功能。

### 待验证项
请确认 1.29 目录中能看到 `.gitignore`，并在需要时运行 `git status` 查看状态、`git tag` 查看版本标签。

### 下一步建议
下一轮直接在 1.29 仓库内修改代码；完成后按文档中的 `git add`、`git commit`、`git tag` 顺序保存，不再创建 1.30 文件夹。

---

## Qoder 1.27：修正保存恢复时的房间身份漂移

**模型标记：** `[MODEL:COPILOT-SDK-VSCODE]`

### 本轮目标
修正一个容易被忽略但会放大问题的地方：恢复存档后，房间名和人数不再和实际对局一致，后续保存会出现“房间身份漂移”。

### 实际改动
- 本机快照保存时一并记录房间名称和玩家人数。
- 恢复存档时同步写回当前房间信息，不再让界面继续停留在旧菜单数据。
- 恢复失败会自动清理坏档，避免继续游戏反复报错。
- 主菜单继续游戏入口在恢复失败时也会及时清掉存档。
- 版本号更新为 `Qoder V1.27`。

### 当前状态
这是一轮稳态修正，重点是让“保存 → 退出 → 继续游戏”这条链路更稳，不改动已有玩法规则。

### 待验证项
请进行一次真实操作：保存当前对局、返回主菜单、点击继续游戏，确认房间名和人数仍与刚才那局一致；如果恢复失败，存档应自动消失。

---

## Qoder 1.28：坏档清理后不再继续显示“继续游戏”

**模型标记：** `[MODEL:COPILOT-SDK-VSCODE]`

### 本轮目标
让主菜单的“继续游戏”按钮和实际存档保持同步。之前如果存档损坏，虽然存档会被清理，但按钮可能还会停留在页面上。

### 实际改动
- 主菜单现在会实时记住是否有可用存档。
- 点击继续游戏时发现存档已不存在，会马上隐藏按钮。
- 存档恢复失败并清理后，也会马上隐藏按钮。
- 使用统一的存档清理方式，不再在页面里写死存档名称。
- 版本号更新为 `Qoder V1.28`。
- 新版本文件夹不再带入生成出来的依赖和构建文件夹。

### 当前状态
代码检查和正式构建都已通过。本轮没有改变游戏规则，只修正了保存相关的界面表现。

### 待验证项
请分别测试：正常保存后继续游戏；删除浏览器存档后回到主菜单；准备一个无效存档后点击继续游戏。第三种情况下按钮应立即消失。

---

## Qoder 1.23：把保存和读取放到正确的位置

**模型标记：** `[MODEL:COPILOT-SDK-VSCODE]`

### 本轮目标
根据用户反馈，让保存发生在实际对局中，让读取发生在主菜单的“继续游戏”入口。

### 实际改动
- 设置页面移除保存和读取按钮。
- 对局页面顶部增加“菜单”按钮。
- 对局菜单中增加“保存当前对局”和“返回对局”。
- 主菜单在“开始游戏”和“卡牌图鉴”之间增加“继续游戏”。
- 没有保存记录时，“继续游戏”会保持不可用，避免点进去后没有内容。
- 主菜单版本号更新为 `Qoder V1.23`。

### 当前状态
类型检查和正式构建已通过；需要用户实际进入一局游戏，打开菜单保存，然后回到主菜单点击“继续游戏”验证。

### 验证与延期事项
- `verification_actor=[MODEL:COPILOT-SDK-VSCODE]`
- `verification_status=MODEL_REPORTED`
- 保存内容仍只保存在当前浏览器；联网保存和跨设备读取继续 `DEFERRED`。

### 下一步建议
请重点检查：游戏中是否能打开菜单、保存后能否回到主菜单、再次点击“继续游戏”后是否回到保存时的对局。

---

## Qoder 1.24：让对局菜单固定可见

**模型标记：** `[MODEL:COPILOT-SDK-VSCODE]`

### 本轮目标
解决对局页面顶部看不到“菜单”的问题。

### 实际改动
- 不再把菜单按钮放在顶部一排容易被挤开的按钮里。
- 将“⏸️ 菜单”固定放在对局页面右上角。
- 提高显示层级，确保不会被棋盘内容遮住。
- 主菜单版本号更新为 `Qoder V1.24`。

### 当前状态
代码已完成，类型检查和正式构建通过，主菜单版本号已显示为 Qoder V1.24。由于当前页面停留在主菜单，对局内右上角按钮需要你使用 1.24 实际进入对局确认。

### 待验证项
请确认启动的是 `Qoder\\1.24\\start.bat`，然后进入测试场或正式对局，查看右上角是否能看到“⏸️ 菜单”。

---

## Qoder 1.25：扩展对局菜单

**模型标记：** `[MODEL:COPILOT-SDK-VSCODE]`

### 本轮目标
在已经可以保存和继续游戏的基础上，让对局菜单更完整、更容易打开。

### 实际改动
- 菜单按钮移动到画面左侧中间位置。
- 在对局中按 ESC 可以打开或关闭菜单。
- 菜单增加“保存对局并退出”。
- 菜单增加“放弃对局并退出”，点击后必须再次确认。
- 菜单增加“重开对局”。
- 菜单增加“游戏规则”，查看后可返回当前对局。
- 菜单增加“游戏设置”，保留显示和音频设置，去除开发者模式。
- 主菜单版本号更新为 `Qoder V1.25`。

### 当前状态
代码已完成，类型检查和正式构建通过，主菜单页面已显示 Qoder V1.25；实际对局验证待完成。

### 待验证项
请检查 ESC 是否能打开菜单；规则和设置返回后是否仍在原对局；放弃退出是否会二次确认；保存并退出后“继续游戏”是否还能恢复。

---

## Qoder 1.26：完善对局保存和重开流程

**模型标记：** `[MODEL:COPILOT-SDK-VSCODE]`

### 本轮目标
根据实际测试结果，让保存、读取、重开和页面返回行为更符合正常使用习惯。

### 实际改动
- 在规则页面和游戏设置页面按 ESC 可以返回对局。
- “重开对局”不再回主菜单，而是按当前游戏人数直接回到创建房间后的等待界面。
- 游戏设置增加“自动保存”开关，打开后每次回合结束自动保存。
- 对局完整结束后自动删除存档。
- 放弃对局并退出、重开对局时自动删除旧存档。
- 没有存档时，主菜单不再显示“继续游戏”。
- 版本号更新为 `Qoder V1.26`。

### 当前状态
代码已完成，类型检查和正式构建通过；已确认无存档时主菜单隐藏“继续游戏”，设置页显示自动保存；实际对局流程验证待完成。

### 待验证项
请检查自动保存开关、规则/设置页面 ESC 返回、重开是否直接进入当前人数等待界面，以及对局结束或放弃后“继续游戏”是否消失。

# 2. 原始版本 → Phase 5 主线历史

## ArenaCN 初始版本 / 5.34 现实基线

### 起点

项目最初由 ArenaCN 代理模式生成。早期重点是让游戏可运行、可展示、可在 Simulator 中操作。

### 后续发现的主要架构问题

最大的问题是 `src/store/gameStore.ts` 承担了过多职责：

- 游戏状态
- 玩家管理
- 回合
- 抽卡
- 战斗
- 移动
- 技能
- 测试场
- 开发者工具
- 编辑器/数据修改
- 持久化

因此确定长期方向：

> React UI → Controller → Action → GameEngine → Event → EngineState

Zustand 最终退居 UI 投影/兼容层。

---

## Phase 5.8 — Skill Data Migration
**模型标记：** `[MODEL:OPENAI-GPT-5.6-LUNA]`


**目标：**把技能数据从大量硬编码逻辑中抽离。

**完成：**
- `DataSkillDefinition`
- `SkillDataRegistry`
- 示例技能数据定义。

**意义：**为后续数据驱动技能、DIY 武将做准备。

**未解决/后续：**技能效果执行仍未完全从状态层迁出。

---

## Phase 5.9 — Effect Resolver Migration
**模型标记：** `[MODEL:OPENAI-GPT-5.6-LUNA]`


**目标：**让技能数据通过 Resolver 产生 Engine Event，而不是直接修改状态。

**完成：**
- `EffectResolver`
- 数据技能效果转换层。
- 技能数据可以产出引擎事件。

**意义：**技能逐步进入 Action/Resolver/Event 架构。

**未解决：**完整技能监听/优先级/运行时执行仍属于后续阶段。

---

## Phase 5.10 — Content Data Migration
**模型标记：** `[MODEL:OPENAI-GPT-5.6-LUNA]`


**目标：**统一武将、卡牌、技能的数据层。

**完成：**
- `GeneralData`
- `CardData`
- 技能引用
- `GeneralRegistry`
- `CardRegistry`

**长期目标：**JSON 导入导出、DIY 武将/卡牌、Workshop/Mod、在线内容库。

---

## Phase 5.11 — Import / Export System
**模型标记：** `[MODEL:OPENAI-GPT-5.6-LUNA]`


**完成：**
- 导入包格式基础
- 武将导入
- 技能导入
- 包验证层。

**长期目标：**DIY 内容、扩展包、Workshop、版本迁移、内容签名、在线分享。

---

## Phase 5.12 — Network Ready Architecture
**模型标记：** `[MODEL:OPENAI-GPT-5.6-LUNA]`


**完成方向：**
- Action transport
- 状态快照序列化
- Replay recording 基础。

**意义：**开始为真正的服务端权威/多人联机准备。

---

## Phase 5.13 — Room / Match System
**模型标记：** `[MODEL:OPENAI-GPT-5.6-LUNA]`


**完成方向：**
- 房间创建
- 玩家 Session
- 等待房间
- Match 生命周期
- WebSocket 房间同步骨架
- Matchmaking
- Reconnect 基础
- AI 补位

---

## Phase 5.14 — Server Authority Architecture
**模型标记：** `[MODEL:OPENAI-GPT-5.6-LUNA]`


**目标：**明确“服务器是唯一 GameEngine 权威”，而不是每客户端各自运行一套最终状态。

核心方向：

Client → WebSocket → Game Server → GameEngine → State Broadcast

---

## Phase 5.15 — WebSocket Real-time Communication Layer
**模型标记：** `[MODEL:OPENAI-GPT-5.6-LUNA]`


**完成方向：**
- Action 实时传输
- 房间同步
- 状态广播
- 为重连准备。

---

## Phase 5.16 — Reconnect + Session System
**模型标记：** `[MODEL:OPENAI-GPT-5.6-LUNA]`


**完成方向：**
- 断线跟踪
- 重连认证
- 玩家身份保持
- 手机/网络中断恢复。

---

## Phase 5.17 — Snapshot Restore + Replay System
**模型标记：** `[MODEL:OPENAI-GPT-5.6-LUNA]`


**完成方向：**
- `SnapshotManager`
- `ReplayManager`
- `GameHistory`
- 重连恢复基础
- 观战/回放/历史记录骨架。

---

## Phase 5.18 — Player Agent + AI Architecture
**模型标记：** `[MODEL:OPENAI-GPT-5.6-LUNA]`


统一定义：

- HUMAN：真人输入
- LOCAL：热座
- AI：机器人

**意义：**三种模式最终都应生成同一种 Action。

---

## Phase 5.19 — AI Strategy + Bot Framework
**模型标记：** `[MODEL:OPENAI-GPT-5.6-LUNA]`


**方向：**
- 简单 Bot
- 规则型 AI
- 后续高级策略
- 单机测试。

---

## Phase 5.20 — Rule Engine + Action Validation
**模型标记：** `[MODEL:OPENAI-GPT-5.6-LUNA]`


**目标：**服务器/引擎层验证非法 Action，并把规则从 UI/网络层隔离。

---

## Phase 5.21 — Card Engine + Deck System
**模型标记：** `[MODEL:OPENAI-GPT-5.6-LUNA]`


**完成方向：**
- 卡牌数据模型
- Deck
- Hand
- 卡牌执行入口
- 抽牌/弃牌堆
- 装备/锦囊等数据驱动基础。

---

## Phase 5.22 — Equipment + Status Effect System
**模型标记：** `[MODEL:OPENAI-GPT-5.6-LUNA]`


**新增方向：**
- Status Effect 基础
- Equipment 基础
- 装备槽/装备管理

**后续重新收敛：**后来发现通用 Equipment 抽象并不符合本游戏真实的“军备卡/护甲”模型，因此在 5.35.12 被替换/删除。

---

## Phase 5.23 — Turn / Phase Timeline System
**模型标记：** `[MODEL:OPENAI-GPT-5.6-LUNA]`


**完成方向：**
- Round 生命周期
- Turn 生命周期
- Action / Response window
- 优先级/pass
- Phase transition event。

---

## Phase 5.24 — Trigger / Reaction Window System
**模型标记：** `[MODEL:OPENAI-GPT-5.6-LUNA]`


**完成方向：**
- Trigger flow
- Reaction flow
- 安全边界。

---

## Phase 5.25 — Skill Trigger Migration
**模型标记：** `[MODEL:OPENAI-GPT-5.6-LUNA]`


**完成方向：**
- Runtime skill ownerId/skillId
- enabled 状态
- trigger priority
- 数据触发器：onDeploy、onTurnStart、onDamageTaken、onDamageDealt、onKill、onDeath。

**未完成：**复杂技能执行仍需要依赖后续 Core Engine 收敛。

---

## Phase 5.26 — 记录缺口
**模型标记：** `[MODEL:OPENAI-GPT-5.6-LUNA]`


当前保存的历史记录中没有一份明确的 Phase 5.26 独立说明，因此这里不虚构内容。

---

## Phase 5.27 — Domain Model Correction
**模型标记：** `[MODEL:OPENAI-GPT-5.6-LUNA]`


这是后续长期规则模型的重要基准。

**关键修正：**
- General Card 与 Resource Card 区分。
- 将领登场后成为 battlefield entity。
- 战士/武将 2 melee / 1 ranged；文将 1 melee / 2 ranged。
- 补给/材料卡是消耗品，不自带固有效果。
- Armament 可附着到将领作为护甲。
- 每名玩家独立 General Pool；共享一个 Card Pool。
- 五势力：魏、蜀、吴、群、晋；群不可作为主势力。
- 多势力/可变势力武将规范化为群。
- Camp/Frontline 三格；Battlefield 容量与最大玩家数相关。
- Base 6 HP，无普通 max HP，是 target 不是 character，单次入伤害 cap=1。
- 初始/回合开始抽牌可能从 General Pool 与共享 Card Pool 中同时获得。

---

## Phase 5.28 — Match Setup & Initialization
**模型标记：** `[MODEL:OPENAI-GPT-5.6-LUNA]`


**完成：**
Lobby → Dice Order → Faction Assignment → General Draft → Initial Draw → Ready。

**核心：**把 setup state 和正常 turn state 分开。

---

## Phase 5.29 — General Draft System
**模型标记：** `[MODEL:OPENAI-GPT-5.6-LUNA]`


**规则：**
- 主势力候选池。
- 群势力候选池。
- 玩家最终选择 10 名将领。
- 群雄数量限制 1～3。
- 将领池独立于共享卡牌池。

当时还没有迁移战斗/技能/网络。

---

## Phase 5.30 — Initial Draw + Turn Engine
**模型标记：** `[MODEL:OPENAI-GPT-5.6-LUNA]`


**完成方向：**
- Turn phase state
- Turn manager skeleton
- Initial draw system interface

当时明确的规则方向后来经过真实测试进一步细化为当前“全员初始5、第一轮0/1、第二轮+5”的最终规则。

---

## Phase 5.31 — Action System Integration
**模型标记：** `[MODEL:OPENAI-GPT-5.6-LUNA]`


建立：

Player operation → Action → Validation → Resolver → Mutation → Event

Action 类型：

- DRAW
- DEPLOY_GENERAL
- MOVE_GENERAL
- ATTACK
- SUPPLY
- EQUIP_ARMOR
- END_TURN

当时主要还是接口/验证骨架，具体 Resolver 与状态修改属于后续。

---

## Phase 5.32 — Action Resolver System
**模型标记：** `[MODEL:OPENAI-GPT-5.6-LUNA]`


加入 Resolver / Registry，以及：

- DeployGeneralResolver
- MoveGeneralResolver
- AttackResolver
- SupplyResolver
- ArmorResolver

为后续 State Mutation 与 Event 驱动做准备。

---

## Phase 5.33 — State Mutation Integration
**模型标记：** `[MODEL:OPENAI-GPT-5.6-LUNA]`


建立：

Action → Mutation → State

当时开始为实体更新、资源移动、伤害等真实状态变化搭桥。

---

## Phase 5.34 — Event Driven State Update
**模型标记：** `[MODEL:OPENAI-GPT-5.6-LUNA]`


建立：

- Event definition
- Event queue
- Event dispatcher
- Mutation/Event bridge
- 技能 trigger 基础
- Damage resolution
- Turn events
- Replay records
- Network synchronization 基础

当时技能监听/优先级/完整技能执行仍未完成。

---

# 3. Phase 5.35 重大收敛阶段

## Phase 5.35.1 — Core Action / Resolver / Event / Mutation / Turn Convergence
**模型标记：** `[MODEL:OPENAI-GPT-5.6-LUNA]`


**目标：**开始把 Store 中已经存在的规则执行路径收敛到 Core Engine。

**意义：**形成“Action → Resolver → Event → Mutation → EngineState”主链。

**验证限制：**当时容器依赖不完整，主要做源代码级检查；ArenaCN 仍是权威运行环境。

---

## Phase 5.35.2 — Controller + Store Execution Path Convergence
**模型标记：** `[MODEL:OPENAI-GPT-5.6-LUNA]`


**目标：**让 Controller/Store 行为逐步经过统一 Action/Engine 路径，同时保持旧 UI API 兼容。

**未解决：**Draw/Turn/Deploy 等仍需后续迁移。

---

## Phase 5.35.3 — Turn / Draw Execution Convergence
**模型标记：** `[MODEL:OPENAI-GPT-5.6-LUNA]`


**目标：**把 DRAW/Turn-start Draw 的实际执行从 Store 迁入 Core Engine。

**结果：**
- `executeDraw()` 改为派发规范 DRAW Action。
- 共享卡池在需要时支持从弃牌堆重洗。
- 保留原 UI `confirmDraw()` 兼容层。

**未解决：**抽卡确认/显示状态继续在后续 5.35.4/5.35.5 收敛。

---

## Phase 5.35.4 — Draw Confirmation + Turn State Convergence
**模型标记：** `[MODEL:OPENAI-GPT-5.6-LUNA]`


**完成：**
- CONFIRM_DRAW Action
- ConfirmDrawResolver
- DRAW_CONFIRMED event
- EngineState.drawState
- TURN_START → draw state
- Store confirmDraw() 改为 Action
- Store UI drawContext 与 EngineState 镜像
- TurnResolver 计算 nextRound。

---

## Phase 5.35.5 — Initial / Turn Draw Orchestration Convergence
**模型标记：** `[MODEL:OPENAI-GPT-5.6-LUNA]`


**完成：**
- BEGIN_DRAW
- BeginDrawResolver
- DRAW_REQUIRED
- EventProcessor 创建 pending draw
- TurnResolver 在 TURN_START 后产生 DRAW_REQUIRED
- 初始征召完成后通过 BEGIN_DRAW 开始初始抽牌。

**未解决：**补偿抽卡/失败路径仍有历史遗留。

---

## Phase 5.35.6 — GameState Authority Convergence
**模型标记：** `[MODEL:OPENAI-GPT-5.6-LUNA]`


**核心：**EngineState 成为已经迁移的 turn/draw flow 的权威状态，Zustand 仅做兼容/投影。

已迁移：
- BEGIN_DRAW
- DRAW
- CONFIRM_DRAW
- END_TURN

当时明确未迁移：
- deployGeneral
- moveGeneral
- attackTarget
- dealSkillDamage
- supplyGeneral
- armGeneral
- defeat/surrender
- developer/test arena。

---

## Phase 5.35.7 — Deploy General Execution Convergence
**模型标记：** `[MODEL:OPENAI-GPT-5.6-LUNA]`


**完成：**
- GENERAL_DEPLOYED event
- DeployGeneralResolver
- EventProcessor 修改 EngineState
- deployGeneral() → Core Engine dispatch。

**保留规则：**手牌来源、1～maxHP 消耗、自身不可作成本、营地空格、资源/将领卡回流/弃置、justDeployed。

---

## Phase 5.35.8 — Move General Execution Convergence
**模型标记：** `[MODEL:OPENAI-GPT-5.6-LUNA]`


**完成：**
- GENERAL_MOVED event
- MoveGeneralResolver 完整验证
- EventProcessor 负责移动 mutation/hasMoved/消耗牌
- Store moveGeneral() 变兼容入口。

**规则覆盖：**
- 每回合一次移动
- 营地→前线
- 自方前线→战场
- 敌方前线→相应敌方营地
- 战场→合法对手前线
- 战士/文将移动成本
- 消耗卡去向。

**后续：**真正的交互层移动目标选择在 5.35.20.x 又针对用户体验做过专项修正。

---

## Phase 5.35.9 — Attack Execution Convergence
**模型标记：** `[MODEL:OPENAI-GPT-5.6-LUNA]`


**完成：**
- ATTACK Action
- AttackResolver
- 攻击者/目标/远近战/消耗卡
- 护甲规则
- 伤害/死亡 mutation
- 资源卡弃置、将领卡回 General Pool
- 护甲损毁弃置
- Store attackTarget() → Core Engine。

**当时明确未迁移：**技能 modifyAttack/modifyDefense、onDamageTaken/onDamageDealt、击杀奖励、补偿抽卡等。

---

## Phase 5.35.10 — Damage / Death / Defeat Convergence
**模型标记：** `[MODEL:OPENAI-GPT-5.6-LUNA]`


**完成：**
- DAMAGE → DEATH / PLAYER_DEFEATED → compensation draw / GAME_OVER。
- 本营归零产生 PLAYER_DEFEATED。
- 玩家被淘汰时清空手牌/场上将领。
- 存活者只剩 1 人时 GAME_OVER 并记录赢家。
- 将领死亡产生 1 个补偿抽卡窗口。
- ATTACK_RESOLVED 作为稳定完成事件。

---

## Phase 5.35.11 — Supply Execution Convergence
**模型标记：** `[MODEL:OPENAI-GPT-5.6-LUNA]`


**完成：**
- SUPPLY Resolver / EventProcessor。
- 回复 HP、hasSupplied、消耗卡、将领卡回池、资源卡进弃牌堆。
- 敌方领地额外消耗 1 张。
- 回复不超过缺失 HP，超额卡不消耗。

**后续：**Turn reset/Skill remain in later stages.

---

## Phase 5.35.11.1 — Initial Draw Black-Screen Hotfix
**模型标记：** `[MODEL:OPENAI-GPT-5.6-LUNA]`


这是第一次大规模暴露初始抽牌黑屏。

**发现：**
1. `EventProcessor.ts` 有两个 DRAW_REQUIRED case，第二个永远不可达。
2. `UnifiedDraw.tsx` 的 hook 位于条件 early return 之后，draw transition 时存在不安全条件 hook 路径。
3. `confirmDraft()` 在 BEGIN_DRAW 失败时仍可能强制把 Store 切到 drawing，造成没有 drawState 的黑屏。

**修复：**
- 保留唯一 DRAW_REQUIRED 处理器。
- 记录 drawPlayerId/drawReason/drawTotalCards。
- 修正 UnifiedDraw hook 顺序和未知 reason fallback。
- BEGIN_DRAW 失败时禁止切到 drawing。

---

## Phase 5.35.11.3 — Initial Draw Flow Hotfix
**模型标记：** `[MODEL:OPENAI-GPT-5.6-LUNA]`


**修复：**
- ConfirmDrawResolver 直接产生 DRAW_CONFIRMED + DRAW_REQUIRED，下一玩家 drawState 由唯一处理器建立。
- DRAW 被拒绝时 UI 不再假装“已抽牌”。
- initialDrawPlayerIndex 根据 completed 正确推进。

---

## Phase 5.35.12 — Armor / Equip Execution Convergence
**模型标记：** `[MODEL:OPENAI-GPT-5.6-LUNA]`


**完成：**
- ARMOR_EQUIPPED
- ArmorResolver
- EventProcessor 移除精确军备卡实例并附加到 fieldGeneral.armorCards
- 每张军备 +1 armor
- EQUIP 后进入 isArming
- AttackResolver 记录 exact destroyedArmorCardIds
- 删除不再使用的通用 `src/equipment/` 抽象/EngineState.equipment wrapper。

**规则保留：**护甲容量受最大 HP、arming 阻塞移动/攻击、2 armor 吸收 1 damage。

---

## Phase 5.35.13 — Secondary Draw & Turn Rule Convergence
**模型标记：** `[MODEL:OPENAI-GPT-5.6-LUNA]`


**完成：**
- 补偿抽卡恢复精确的之前 phase/player。
- DrawResolver 校验 pending draw owner 与 exact total。
- EngineState 保存 resume metadata。
- 将领池为空时在回合开始标记 baseLossPending=true。
- malformed draw payload 防护。

---

## Phase 5.35.14 — Per-Turn State Reset Convergence
**模型标记：** `[MODEL:OPENAI-GPT-5.6-LUNA]`


**完成：**
- TURN_ACTIONS_RESET event。
- TurnResolver 为进入新回合的玩家重置：hasMoved/hasAttacked/hasSupplied/justDeployed/isArming。
- Store endTurn 不再自己重置这些 flag。

正式流程收敛为：

END_TURN → TURN_END → TURN_START → TURN_ACTIONS_RESET → DRAW_REQUIRED

---

## Phase 5.35.15 — Legacy Store Rule Purge
**模型标记：** `[MODEL:OPENAI-GPT-5.6-LUNA]`


**完成：**
- battlefield movement/targeting helpers 移到 `src/rules/battlefieldRules.ts`。
- GameBoard/TestArena 使用 rules layer。
- 删除 Store 中 legacy skill-damage implementation。
- base-loss resolution 走 RESOLVE_BASE_LOSS → BASE_DAMAGE → PLAYER_DEFEATED/GAME_OVER。
- SURRENDER → PLAYER_DEFEATED。
- 开发者/测试工具保持开发语义，不当正式规则路径。

---

## Phase 5.35.15.1 — Regression Fix
**模型标记：** `[MODEL:OPENAI-GPT-5.6-LUNA]`


实际对局发现 3 个问题：

1. **击破补偿抽卡后错误显示“势力击破”并卡死**
   - 原因：普通 DEATH 被当成 PLAYER_DEFEATED；`clearDefeatEvent` 缺失。
   - 修复：只有 PLAYER_DEFEATED 才设置 defeatEvent；补 clearDefeatEvent。

2. **投降后的返回主菜单无响应**
   - 原因：GameOverScreen 调用 resetGame，但 Store 只有声明无实现。
   - 修复：补 resetGame。

3. **敌方营地内近战不能攻击敌方本营**
   - 原因：UI 与 AttackResolver 只允许敌方前线来源。
   - 修复：敌方前线 + 敌方营地都可近战攻击本营。

未处理：favicon 404、analysis.chatglm.cn 的浏览器外部资源阻断。

---

## Phase 5.35.15.2 — Type Integrity Cleanup
**模型标记：** `[MODEL:OPENAI-GPT-5.6-LUNA]`


**目标：** `npm run check` 成为质量门禁。

**完成：**
- 清理 Action/Resolver/Rule/Server/Skill 无用变量/参数。
- 统一网络类型。
- 修复 RoomManager API。
- 消除 SkillEffectType 重复导出。
- 收窄 EventProcessor consumeCards 类型。
- 恢复 Store 中误删的设置/开发者/编辑器/技能激活/测试控制接口。
- 修复 Zustand set wrapper 类型。
- 加入 `npm run check` = `tsc --noEmit`。

此阶段以后本地 `npm run check=0` 成为重要基线。

---

## Phase 5.35.16 — First-Round Draw / Responsive Board / Surrender Convergence
**模型标记：** `[MODEL:OPENAI-GPT-5.6-LUNA]`


**修复：**
- 第一轮抽卡：玩家1=0，其他=1；第二轮+=5。
- 0 张自动确认。
- 将领池为空的回合开始本营损失先结算。
- GameBoard 动态缩放，解决 3～4 人上下营地被遮挡。
- 登场提示移到棋盘中央，避免遮挡营地。
- 投降/败北：base HP=0，清空 hand/field，当前玩家淘汰后立即切换下一名存活玩家。

---

## Phase 5.35.17 — Draw / Surrender / Movement Convergence
**模型标记：** `[MODEL:OPENAI-GPT-5.6-LUNA]`


**修复：**
- ConfirmDrawResolver / EventProcessor 的初始轮次上下文。
- 第一轮最后玩家结束后 nextRound 正确用于下一玩家，从而第二轮玩家1也能抽5。
- 投降后不再要求 UI 再点结束回合。
- 当前玩家索引失效时 GameBoard 以存活玩家回退。
- 战场单一路径也必须显式选格并可取消。

---

## Phase 5.35.17.1 — Draw Rule and Type Fix
**模型标记：** `[MODEL:OPENAI-GPT-5.6-LUNA]`


**重要规则澄清并修复：**
- 游戏开始：所有玩家各 5 张。
- 第一轮：玩家1=0，其他=1。
- 第二轮+：全部5。
- 修复 5.35.17 把“初始全员5张”误改成“玩家1=5、其他=1”的错误。
- 修复 Store 中 drawState 可空引用 TS18049。

**验证：**用户已确认该版本 `npm run check=0`、build 成功，且实际对局抽卡规则无异常。

---

## Phase 5.35.18 — Legacy Store Purge Round 2
**模型标记：** `[MODEL:OPENAI-GPT-5.6-LUNA]`


**完成：**
- editor/localStorage persistence → `src/store/editorPersistence.ts`
- Test Arena actions → `src/store/testArenaActions.ts`
- 保持 useGameStore 公共 API。
- 正式规则继续通过 Core Engine。

不改正常 match 的 draw/turn/combat/supply/armor/surrender/defeat。

---

## Phase 5.35.19 — Legacy Store Purge Round 3
**模型标记：** `[MODEL:OPENAI-GPT-5.6-LUNA]`


**完成：**
- room init
- dice ordering
- faction assignment
- general candidate generation
- shuffle / room name / player initialization

移到 `src/setup/runtimeSetup.ts`。

后来实际 `npm run check` 发现唯一问题：

- `getGeneralsByFaction` 未使用（TS6133）。

该问题作为 5.35.19.1 处理。

---

## Phase 5.35.19.1 — Type Cleanup
**模型标记：** `[MODEL:OPENAI-GPT-5.6-LUNA]`


**修复：**
- 删除 gameStore 未使用的 `getGeneralsByFaction` import。

用户后续进入测试场并发现更多问题，进入 5.35.20 系列。

---

## Phase 5.35.20 — Test Arena Convergence
**模型标记：** `[MODEL:OPENAI-GPT-5.6-LUNA]`


**完成：**
- Test Arena 允许正常游戏 Action，但不放宽普通局规则。
- 测试场 end turn 走 canonical turn → base loss → draw → confirm 流程，但保持 TestArena 页面不卸载。
- 测试场投降立即走同一套 Engine 流程并留在测试场。
- 登场失败时不假装成功，不清空选择。
- 增加持续的投降控制。
- 当时版本要求“单目标移动显式选择”。

---

## Phase 5.35.20.1 — Movement Interaction Correction
**模型标记：** `[MODEL:OPENAI-GPT-5.6-LUNA]`


用户指出：之前“所有单路径移动都强制选择”过度修改，并导致前线→战场无法真正完成。

**修复：**
- 营地/前线只有一个合法去向时恢复原行为：直接进入后续流程。
- **只有战场区域**强制显式选择目标。
- 战场单目标仍可取消。
- 前线→战场空格可点击。
- GameBoard/TestArena 同步。

---

## Phase 5.35.20.3 — Test Arena Deploy Slot Correction
**模型标记：** `[MODEL:OPENAI-GPT-5.6-LUNA]`


用户发现测试场登场时营地空格明明空了仍提示失败。

**根因：**`DeployGeneralResolver` 全局检查相同 slot，没有按 `areaOwnerId` 限定到当前玩家营地。

**修复：**
- `CAMP_SLOT_OCCUPIED` 必须同时匹配当前 `action.playerId`。

验证后用户确认测试场登场无问题。

---

## Phase 5.35.21 — Test Arena HP Tools & Combat Animation Correction
**模型标记：** `[MODEL:OPENAI-GPT-5.6-LUNA]`


用户发现：攻击本营/将领后受击动画会一直残留并随任何操作重复；测试场可添加超过4人；本营 HP 工具缺失。

**修复：**
- 动画定时器独立于普通 player-state 更新。
- 测试场 2～4 人硬限制，UI + action guard 双层限制。
- 恢复本营 HP 调整：+1、满、置1、伤害、回复、伤害类型 attack/skill/lose。

用户后续确认动画问题已修复。

---

## Phase 5.35.22 — Test Arena Runtime Identity & Compensation Draw Correction
**模型标记：** `[MODEL:OPENAI-GPT-5.6-LUNA]`


用户发现测试场同名将领的选择/消耗/登场混为一张，击破补偿抽卡又回到 5 张并黑屏。

**修复：**
- 重复同名 general 注入时使用 runtime instance identity。
- 测试场消耗/登场删除精确实体。
- 补偿抽卡 = 1 张。
- 测试场补偿抽卡在 sandbox 内完成，不切 UnifiedDraw。

---

## Phase 5.35.22.1 — Runtime Identity Convergence
**模型标记：** `[MODEL:OPENAI-GPT-5.6-LUNA]`


用户进一步验证发现：两个同名曹操中移动一个会让另一个消失；攻击/工具操作错对象；选择一张同名卡时多张一起被消耗；受击动画互相污染。

**根因：**虽然有 instanceId，但没有贯穿所有 Action → Resolver → EventProcessor → UI。

**修复：**
- Move/Attack/Supply/Armor/Test reset 使用 runtime instance identity。
- Battlefield attack target 使用 instanceId。
- EventProcessor 精确更新指定 field general。
- Hand card selection 消耗按实体 instance identity。
- 受击动画按 instanceId 跟踪。

用户已完成该专项测试并确认继续主线。

---

## Phase 5.35.23 — Controller Convergence
**模型标记：** `[MODEL:OPENAI-GPT-5.6-LUNA]`


**完成：**
- 删除未使用的 `src/player/` duplicate controller hierarchy。
- Controller 统一在 `src/controllers/`。
- 保留 Local/Hotseat/Human/AI controller contract。
- Controller 只是输入/传输适配边界；GameEngine 仍是唯一规则权威。

用户简单开始对局验证，无异常。

---

## Phase 5.35.24 — Network Boundary Convergence
**模型标记：** `[MODEL:OPENAI-GPT-5.6-LUNA]`


目标：为网络层与 Core Engine 建立统一边界。

统一：
- Network action → GameAction
- Network snapshot → EngineState
- Replay → GameAction/GameEvent/EngineState
- 增加 protocol version

随后 5.35.24 的 `network/index.ts` 出现 `NetworkMessage` barrel export 冲突。

### Phase 5.35.24.1 — Network Export Type Cleanup

**修复：**
- `src/network/index.ts` 显式导出，消除 TS2308。
- 不改运行时逻辑。

用户验证无问题。

---

## Phase 5.35.25 — Replay / Snapshot Convergence
**模型标记：** `[MODEL:OPENAI-GPT-5.6-LUNA]`


**完成：**
- canonical replay types
- ReplayRecorder 记录 initial state + ordered action/event/before/after state
- ReplayPlayer 用同一个 GameEngine 重放
- SnapshotManager 管理按 room 的有序快照时间线
- ReplayManager
- StateSerializer 严格接受 EngineState 快照
- GameEngine 自动记录每个 dispatch（accepted/rejected）并生成 snapshot
- 旧 network ReplayRecorder 保留兼容 re-export

**未做：**真正的 WebSocket 服务、数据库、回放 UI、玩法改变。

用户本地环境构建/验证无问题。

---

## Phase 5.35.25.1 — Turn-start Base-loss Defeat Continuation
**模型标记：** `[MODEL:OPENAI-GPT-5.6-LUNA]`


用户发现：玩家仅剩1 HP时，因为将领池为空导致回合开始掉1 HP并淘汰，点击结算后卡住。

**修复：**
- turn-start base-loss 也必须进入统一 PLAYER_DEFEATED → 下一存活玩家回合迁移。
- 有剩余存活者：TURN_END → TURN_START → TURN_ACTIONS_RESET → DRAW_REQUIRED。

---

## Phase 5.35.25.2 — Draw Session Convergence
**模型标记：** `[MODEL:OPENAI-GPT-5.6-LUNA]`


用户进一步发现 4人局中3/4人投降、1/2人将领池耗空、本营掉血、玩家1攻击玩家2本营后，玩家2会卡在回合开始抽卡；控制台显示 `[Phase 5.35.11.3] DRAW failed`。

**修复：**
- drawState 作为权威 draw session。
- DRAW 请求按 engine-owned total/player/reason 规范化。
- pending base-loss 未完成时不能绕过。
- rejection log 增加 concrete payload + pendingDraw。
- TurnResolver 跳过 eliminated seats。

**规则不变：**初始全员5；第一轮0/1；第二轮+5；补偿1。

用户后来确认 5.35.25.2 环境构建和对局验证无异常。

---

## Phase 5.35.26 — UI / Presentation Convergence
**模型标记：** `[MODEL:OPENAI-GPT-5.6-LUNA]`


用户新增两个长期需求：

1. 不同“玩家主势力 / 将领有效势力”的将领卡，要做上下双色**边框**。
2. 不仅棋盘，其他界面也要逐步做响应式，未来考虑手机竖屏/横屏。

这一版第一次实现双色边框，但用户实际截图确认：**错误地把双色效果做到卡面内部**，而且场上将领仍是单色。

同时用户提出将领池疑似优先抽原势力，需要区分“池组成概率”与“顺序偏差”。

---

## Phase 5.35.26.1 — General Card Border Correction
**模型标记：** `[MODEL:OPENAI-GPT-5.6-LUNA]`


用户明确纠正视觉目标：

- 不改变卡面内部颜色。
- 卡面主体保持普通单色将领卡样式。
- 只有外围边框上下双色：上半=玩家主势力，下半=将领有效势力。

**当时实现：** `generalCardVisual.ts` 使用 border layer 双色方案。

---

## Phase 5.35.26.2 — Card Border + General Pool Randomness Correction
**模型标记：** `[MODEL:OPENAI-GPT-5.6-LUNA]`


### 卡牌视觉

- 手卡和场上将领都尝试统一为“只改边框、不改卡面”。

### 将领池随机

确认旧逻辑存在真实顺序偏差：

- `generalPool.slice(0,n)` 会直接取池头。
- 征召界面的选择顺序可能影响池内顺序。
- 因而即使池组成不变，也会产生“主势力更容易先被抽出”的额外偏差。

**修复：**抽卡时对玩家 General Pool 做 Fisher-Yates 随机化，同时保持原有 7～9 主势力 + 1～3 群雄组成规则。

**当前状态：**随机算法修复已生成；应通过多局样本观察确认不再有明显顺序偏差。

用户在 `npm run check` 时发现：

`TestArena.tsx` 的 `null` 参数类型错误。

---

## Phase 5.35.26.4 — Runtime General Identity + Draw Removal + Cross-Faction Border Fix
**模型标记：** `[MODEL:OPENAI-GPT-5.6-LUNA]`

本阶段修复了两个真实运行问题：跨势力/群势力将领的边框显示异常，以及随机抽到的将领没有从原始将领池中准确移除而导致同一将领定义重复出现。

核心修复包括：
- 将跨势力边框改为明确的卡面 padding-box + 外框 border-box 方案；卡面内部继续保持单色。
- 抽取将领时使用实际选中的 runtime instance 对应池成员进行移除，避免“随机副本抽到 A、原池却删除 B”的错位。
- 将领草稿/测试场实体补充独立 `instanceId`，部署检查改为运行时实体身份。
- 部署被引擎拒绝时不强制清空 UI 选择。

**状态：** 代码已修改；用户尚未完成该版本的最终视觉与重复将领完整回归测试。

## Phase 5.35.26.3 — Card Border Finalization + Project Documentation
**模型标记：** `[MODEL:OPENAI-GPT-5.6-LUNA]`


**目标：**
- 修复 TestArena 类型错误。
- 最终化双色边框：只改边框，不改卡面。
- 建立长期项目历史文档。

当前历史上该阶段已生成，但**用户尚未在本轮记录中反馈其最终视觉验证结果**，因此这里标记为“待验证”，不要写成“已通过”。

本阶段开始建立长期日志体系；随后用户又要求日志拆为“AI版 + 人类版”，本文件即为人类版，AI版见 `PROJECT_HISTORY_AI.md`。

---

---

## 文档职责说明

- 当前规则 / 当前状态：`PROJECT_HANDOFF.md`
- AI 历史：`PROJECT_HISTORY_AI.md`
- 人类历史：本文件
- 不再创建新的 `PHASE_*.md` / `*_NOTES.md`
---

## Qoder 1.22：增加本机保存和读取对局

**模型标记：** `[MODEL:COPILOT-SDK-VSCODE]`

### 本轮目标
把已经存在的对局快照功能接到普通玩家能使用的设置页面，方便暂时离开游戏后继续。

### 实际改动
- 在“游戏设置”中增加“保存当前对局”按钮。
- 增加“读取本机对局”按钮。
- 保存内容放在当前浏览器的本地空间，不上传到服务器。
- 读取时继续使用原有的状态检查，避免把损坏或不完整的内容直接放进游戏。
- 主菜单版本号更新为 `Qoder V1.22`。

### 当前状态
代码已完成，类型检查、构建和浏览器内实际保存/读取均已通过。

### 验证与延期事项
- `verification_actor=[MODEL:COPILOT-SDK-VSCODE]`
- `verification_status=INDEPENDENTLY_VERIFIED`
- 依赖安全问题继续 `DEFERRED`，本轮没有升级依赖。

### 下一步建议
先完成检查和构建，再开始一局游戏：保存一次，返回菜单或刷新页面，然后读取保存内容，确认手牌、场上将领、当前回合和当前玩家没有变化。

---

## Qoder 1.23：调整游戏内存档入口与继续游戏
**模型标记：** `[MODEL:COPILOT-SDK-VSCODE]`

- 保存入口从设置页移到游戏内菜单。
- 主菜单增加“继续游戏”。
- 抽取 `localGameSnapshot` 作为本机快照存储工具。
- 保留 EngineState 快照作为恢复权威，不新增第二套恢复规则。
- 本轮实际游戏内菜单流程仍需要用户验证。

## Qoder 1.24：固定游戏内菜单入口
**模型标记：** `[MODEL:COPILOT-SDK-VSCODE]`

- 游戏内菜单改为固定在 GameBoard 的高层级位置，避免入口不可见。
- 正式规则未改变。
- 类型检查 / 构建据 Qoder 记录通过；用户需要实际打开对局确认入口长期可见。

## Qoder 1.25：扩展对局菜单
**模型标记：** `[MODEL:COPILOT-SDK-VSCODE]`

- 增加保存、保存并退出、放弃并退出、重开、规则、设置等对局菜单操作。
- ESC 可唤起菜单；对局内规则/设置以覆盖层打开。
- 测试区继续保持其独立挂载语义。
- 本轮关键对局流程待用户回归验证。

## Qoder 1.26：存档清理、自动保存与重开流程
**模型标记：** `[MODEL:COPILOT-SDK-VSCODE]`

- Rules / Settings 覆盖层支持 ESC 返回。
- 重开对局先清理旧存档，再按当前玩家人数重新建立 lobby。
- Settings 增加自动保存开关；正常回合结束时自动保存。
- GAME_OVER、放弃和重开会清理本机旧存档；无存档时主菜单隐藏“继续游戏”。
- 当前行为方向是合理的 UI/本机恢复收敛，不涉及核心游戏规则。

### GPT-5.6 Luna 对 Qoder 1.26 的独立审查
**模型标记：** `[MODEL:OPENAI-GPT-5.6-LUNA]`

源码级审查确认：

1. 1.26 的主要迭代方向没有发现需要立即回滚的玩法规则变更。
2. `src/network/ReplayRecorder.ts` 是 canonical `src/replay/ReplayRecorder.ts` 的兼容导出，不应误删。
3. 源码归档不应携带 `node_modules` / `dist`；本次用户提供的 1.26 压缩包包含 `node_modules`，因此归档边界需要修正。
4. `package.json` 为 1.26.0，但 `package-lock.json` 根版本仍为 1.21.0，属于文件元数据不一致，建议在独立维护项中修复。
5. 本机恢复后 `roomName` 与快照 `roomId` 存在潜在身份漂移，暂列 PENDING，不在本次审查中直接改源码。
6. 当前技能目录仍存在多套历史技能结构。静态检查显示 `GameEngine` 持有 `TriggerEngine + SkillTriggerBridge`，但没有找到 `registerPlayerSkills()` 的实际业务调用，因此技能系统目前是“运行时骨架已存在，但正式玩法闭环尚未完成”，不能写成技能系统已经完成。
7. `src/card/*`、`src/actions/*`、`src/status/*`、`src/timeline/TurnManager.ts` / `PhaseManager.ts` 是明显的 legacy 候选，但删除前必须做调用图复核。
8. 旧 `src/card/Deck.ts` 的 `sort(() => Math.random() - 0.5)` 具有随机打乱实现风险；虽然当前看起来未接入主流程，但不得把它重新用作 canonical shuffle。
9. 独立 TypeScript 检查通过；Vite 构建无法在归档附带的依赖环境中复现，因为缺少 Rollup Linux optional dependency，因此 Qoder 的 build 结果保持“模型自报”，不能写成 GPT 独立验证。

本轮不修改 Qoder 1.26 业务源码，只更新三份项目文档与归档边界；后续真正修改源码前，需先明确是否进入 Skill Runtime 唯一化阶段。

---

## Qoder 2.0 开发记录（2026-09，作者：Qoder 编码代理）

这一轮没有改动玩法规则，而是给项目补齐了工程体系，分六步：

1. **审计与生成版本**：从 1.29.2 源码生成干净的 2.0.0，初始化独立 Git 仓库，并编写 AGENTS.md 作为 AI 协作入口。
2. **单元测试**：引入 Vitest，分批覆盖核心事件处理器与全部行动解析器，最终 128 个测试。期间踩过坑：PowerShell 写文件带的 UTF-8 BOM 导致构建失败，已修复并总结为经验。
3. **CI/CD**：配置 GitHub Actions——lint、Node 18/20/22 矩阵测试、构建、Pages 自动部署。仓库尚未连接远程，这些工作流一次都没跑过，"配置完成"不等于"已在服务"。
4. **质量门禁**：ESLint 10 落地为 0 错误硬门禁；覆盖率报告 + "棘轮阈值"（允许上调、禁止下调）。32 条 react-hooks 遗留警告如实记录为技术债，其中 GameBoard"提前 return 在 hooks 之前"是真实隐患，留待专门重构。
5. **潜伏问题清零**：首次把类型检查跑遍包括测试文件在内的全仓库，暴露并修复了 3 个早期测试文件里潜伏的 18 个类型错误。
6. **里程碑锁定**：为当前版本创建附注标签 v2.0；同时补齐 1.29 仓库一直未提交的依赖安全修复轮（提交 2cfcbbf + 标签 v1.29.2，其中 exceljs 调整为 3.x 经核实是有意变更）。

验证状态：类型检查、128 测试、覆盖率阈值、lint、构建全部在本地会话内通过；游戏内玩法表现仍需用户回归验证。

---

## Qoder 2.0.1 开发记录（2026-09，作者：Qoder 编码代理）

xlsx 安全漏洞登记已久，此前结论是"没有修复版本"。本轮找到了官方出路：SheetJS 已经不在 npm 上更新（永久停在有高危漏洞的 0.18.5），修复版只发布在其官方 CDN。我们把依赖直接指向 CDN 的 0.20.3，两个高危漏洞（原型污染、ReDoS）即告修复，且业务代码一行没改——技能编辑器只用到两个读取接口，新版完全兼容。

验证结果：类型检查、128 个测试、lint、构建全部通过；npm audit 从 3 项（含 1 高危）降到 2 项中危。剩余两项中危来自 exceljs 的传递依赖 uuid，继续延期；1.29 与 2.0 两仓库 exceljs 版本不一致的问题也一并登记为待办。技能编辑器的 Excel 导入仍需用户拿真实文件回归确认。版本升至 2.0.1 并打标签 v2.0.1。

---

## Qoder 2.0.2 开发记录（2026-09，作者：Qoder 编码代理）

xlsx 漏洞修复的收尾一轮。上一轮把依赖换到了官方 CDN 修复版，这一轮证明"真的能干活"：仓库里落了一个真实的 .xlsx 夹具文件（含中文和空白单元格），测试用与生产打包完全相同的浏览器构建去解析它，技能编辑器导入路径用到的两个接口逐项断言通过；CI 加了"出现高危漏洞直接标红"的审计门禁；构建产物用新版重新生成；1.29 仓库也同步完成切换并发行 v1.29.3。中途两个坑也记档：jsdom 里 exceljs 走浏览器构建导致现场生成字节失败，改为读取真实夹具更贴近实际；Vite 转换使 import.meta.url 不再是文件 URL，测试收集崩溃，改用项目根相对路径定位。

1.0~1.28 备份文件夹按项目规则不做修改。至此 xlsx 问题判定完全修复：依赖、产物、锁文件三个层面都没有漏洞版本，且有自动回归和 CI 门禁防止问题回退。测试总数升到 131。

---

## Qoder 2.0.3 开发记录（2026-09，作者：Qoder 编码代理）

把安全账上最后两项遗留一次清掉。做法是"强制替换"：在项目账本上写一条命令，规定不管哪个零件自己内置什么版本的 uuid，一律换成修好的 11.1.1——动手前核对过，exceljs 全局只用这个零件做一件事（导出时打随机流水号），新旧版本接口一样，属于平替。同时把 1.29 仓库的 exceljs 从老款升上来，两个仓库从此同款同版，"两个厨房两种配方"的问题也终结了。

结果：`npm audit` 历史上第一次报"0 个漏洞"；用一个带条件格式的 Excel 做了导出→读回冒烟测试，数据逐值一致；类型检查、131 个测试、lint、构建全部通过。1.29 仓库同步发布 v1.29.4。留了一条维护提醒（写在 AGENTS.md 和交接文档里）：以后升级 exceljs 时要复查这条强制替换是否仍然合适。至此依赖安全无遗留项，下一步回到技能系统主线。

---

## Qoder 2.0.4 开发记录（2026-09，作者：Qoder 编码代理）

代码第一次真正住进了 GitHub。按用户"资料不能被别人看到"的要求，两个仓库都建成了**私有**：只有本人账号能访问，外人搜不到也打不开。推送过程本身也上了一课：GitHub 规定改动"自动化流水线文件"需要单独授权一次（防止任何工具随意改你的流水线），补授权后两个仓库的 master 分支和历史版本标签全部推上去了。

CI 第一次真实运行就抓出三个只有真跑才会暴露的问题：测试矩阵里的 Node 18 太老，测试工具新版根本不支持；Node 20 也不行，一个网页模拟组件用到了只有更新运行时才有的能力（本地能跑是因为版本细节不同）；网页公开部署失败属于预期——我们本来就还没打开公开开关。处理方式：测试矩阵换成目前仍在维护期的 22 和 24 两代，部署改成"想发布时手动点一下才跑"。修完复跑，**CI 全绿**（2 分 31 秒跑完检查、测试、覆盖率门禁、构建）。"已配置未验证"这个状态正式销案，代码从此有了异地备份和自动质检两道保险。

补充：推送中途曾遇到连不上 GitHub 的情况，这台电脑访问 GitHub 的链路会波动——有时直连就通，有时必须经过本机代理（127.0.0.1:10808，浏览器走的就是它）。我们试过把代理写进仓库配置，结果代理软件一关反而全推不动，于是改回"先直推、不通再临时借道"的用法，两种命令都写进了新建的 README.md（连同"怎么跑、怎么推、CI 看哪里"），以后换台机器照着 README 就能上手。

---

## Qoder 2.1.0 开发记录（2026-09，作者：Qoder 编码代理）

技能系统主线收敛一轮——解决的是"两套发动机并存，但哪台都没接上方向盘"的历史问题。

打个比方：游戏里其实早就造好了一条完整的技能流水线（登记技能 → 监听战场事件 → 判断条件 → 产生效果 → 扣牌结算），引擎、传送带、闸门都齐了，但车间里同时还摆着三四台旧机器（早期的技能执行器、卡牌引擎、状态管理器、回合阶段管理器等），而且新流水线从没被任何业务真正调用过。这轮做了三件事：

一、**把新流水线接通**。每次玩家做一个动作，系统现在都会自动看清场上每个武将带了哪些"可执行"的技能并登记进引擎——之前是引擎每动一次就整个重造、登记全丢。同时修好了一个接线错误（"武将登场"信号此前接在杂事件频道上，现在接在正确的登场上）。

二、**让效果真正落地**。技能"摸一张牌"现在会真实地从公共牌堆拿牌进手牌（牌堆不够就洗弃牌堆顶替），而且多个技能连锁摸牌绝不会把同一张牌摸出两份；技能造成的伤害和普通攻击走完全相同的护甲规则（两点护甲挡一点伤）。为守住"不发明玩法"的底线：现有内置武将的技能依然只是一段描述文字，没有设计师填过结构化数值就不会触发——这一步铺的是轨道，不是擅自开车。

三、**拆掉旧机器**。十一组过时的并行实现，每一种都经过两轮"全项目搜索确认无人引用"才删除，删完系统照常运转。测试从 131 个增加到 152 个——新增的 21 个全是技能链路的实弹演习，包括"奸雄式受伤摸牌""反伤结算""谁的技能只对谁的事起作用"等场景；覆盖率门槛也顺势上调，防止将来偷偷退化。类型检查、测试、代码规范、打包构建四道全绿，删除项没有引入任何新的警告。

如实交代的未竟事项（都写进了交接文档）：技能编辑器还没有录入效果数值的入口（所以 DIY 技能暂时"看得见、跑不动"）；治疗、加护甲等更多效果类型和十几种触发时机还没接；"回合结束前询问是否发动技能"这条冻结规则的实现仍按计划暂缓。技能系统从"骨架已存在、未闭环"升级为"核心链已闭环、有测试兜底"，但离全功能还有明确清单。版本号升为 2.1.0。

## Qoder 2.2.0 开发记录（2026-09，作者：Qoder 编码代理）

接上一轮：流水线和机器都接好了，但"配料单录入台"还是空的——编辑器里写的技能只是给人看的文字，机器读不懂，所以谁也没法真的让一个 DIY 技能在局内生效。这轮专门补这个入口。

一、**给编辑器加了"可执行效果"录入框**。每个技能效果下面多了一块绿色的"⚡ 结构化效果"：选类型（摸牌 / 伤害）、填数值、选目标（对自己 / 对伤害来源 / 对被作用的人），旁边有大白话预览（"摸牌 ×2 → 自身"）。不选类型就还是纯描述文字，一切照旧。治疗、加护甲这两类先只做"能记下来、但明说暂时不会生效"，不假装能跑。

二、**Excel 台账同步升级**。以前每个效果占 3 栏（标注/触发/描述），现在占 6 栏（多了类型/数值/目标），导出文件直接带下拉菜单可填。旧文件照样能导入——系统自己看一眼表头就知道是新格式还是旧格式，不用改任何东西。

三、**把算账规则从表格页里搬进独立的"翻译规则手册"**。之前单元格文字↔游戏配置的互相翻译全塞在编辑器页面里，想测都没法测；这次单独成册，21 个新测试全部对着手册做实弹检验，其中还包括"机器自动化操作编辑器：点按钮→选摸牌→保存→仓库里确实出现可执行数据"的完整流程演练。

结果：类型检查 0 错误；测试从 152 涨到 **173 个全过**；覆盖率门槛整体上调一档（以后想倒退就难了）；代码规范 0 错误、警告还少了 2 条；打包成功。小插曲如实记录：写测试时想当然猜了一个下拉选项的内容，跑红后修正；改版本号时一次性替换误伤过依赖清单里的别的包，当场回滚重来、逐行核对无误后才提交。

实话实说的部分：这次验证到"录进去的数据能被机器读懂并登记在册"为止，**真人亲手在编辑器里配一个技能、开一局看它按预期发威**，还差这一步用户回归。治疗/护甲不会生效、回合结束不询问是否发动技能、技能伤害打死人不触发"击杀类"技能——这些老欠条原样记在账上。版本号升为 2.2.0。

## Qoder 2.2.1 开发记录（2026-09，作者：Qoder 编码代理）

这轮不是新功能，而是"真机验收"：用鼠标在浏览器里把整条游戏流程从头到尾点了一遍——开局、掷骰子、分势力、征召武将、初始抽卡、把武将登场到营地、普通攻击扣护甲、武将被击杀、打到本营分出胜负，最后一步最关键：在技能编辑器里给武将配一个"回合开始时摸一张牌"的自制技能，再开一局看它到底生不生效。

前六步都顺利。第七步抓出了一个真 bug：编辑器里技能保存得好好的，武将列表里也能看到新技能，可一进对局就永远不触发。原因是游戏里有两条路——"给人看的那条"早就合并了编辑器改动，"给机器用的那条"在征召武将时抄的还是出厂原始数据。之前版本说明里写的"数据会自然流进对局"其实不成立，这次被实操打穿了。修复只改了一行（征召时改抄"合并后的数据"），并补了 3 个自动化测试把这个坑焊死：以后谁再把编辑器的技能改动弄丢，测试会直接报红。

修好后重新开了一局验证：把配了新技能的文鸯召唤上场，轮到他的回合开始时，手牌从 6 张变成 12 张——5 张是正常回合抽牌，多出的第 6 张正是新技能"援军"摸的，牌堆也分毫不差地少了 6 张。自制技能第一次在真实对局里被看见"活了"。

例行结果：类型检查 0 错误；测试从 173 涨到 176 个全过；代码规范 0 错误；打包成功。几句实话：这次是一局定样本，玩得顺不顺、平不平衡还要您日常玩来反馈；另外"保存的对局"记录的是征召那一刻的数据，之后在编辑器里的新改动只对新建的房间生效——这是设计使然，但界面上没有提示，算一个待改进的小体验。版本号升为 2.2.1。

## Qoder 2.2.2 开发记录（2026-09，作者：Qoder 编码代理）

上一轮是"用人手在浏览器里点一遍验收"，这一轮把同样的核心流程做成了一套自动化测试——相当于给游戏规则引擎装上一台"体检机"：以后任何人改动代码，不用手动点开游戏，测试就会自动检查开局抽牌、部署将领、行军、攻击、结束回合、胜负判定这六件大事是否还完好。按您定的规矩，所有测试都必须走"正门"——每个动作都以正式的玩法请求提交给游戏引擎去审批和执行，绝不允许抄近道直接改游戏内部数据，这样测出来的才是真规则，而不是测试自己编出来的规则。

14 个测试除了走通正常流程，还专门盯着"违规场景"：别人回合里想动手、把武将登场到敌方营地、该耗牌移动却不耗牌、一回合攻击两次……每一种想钻空子的做法都要过两道检查——既确认被规则拦下，又确认拦下之后游戏状态分毫未动（被拒绝的动作不允许留下任何痕迹）。最后压轴是一场"完整一局"演练：从开局抽卡一路打到攻破本营分出胜负，中途还对总账——全场卡牌总数一张不多一张不少，牌不会凭空消失、也不会凭空冒出来。

过程如实交代：写测试时我自己有三个想当然被真实规则纠正了——以为两点护甲能挡两点伤害（实际规则是每两点护甲只挡一点，剩下的照样掉血）、忘了对手也要过一次回合、算总账时把同一批牌数了两遍。这些错恰恰说明测试有价值：把"我以为"和"实际是"当面核对清楚。另外发现并记录了一个引擎的隐藏脾气：有些连锁结果（比如战败、游戏结束）不会出现在动作的答复里，只反映在最终状态上，断言要看状态而不是只看答复——这条已经写进测试文件的说明注释，后来人不再踩坑。

例行结果：类型检查 0 错误；测试从 176 涨到 **190 个全过**；覆盖率门槛再上调一档；代码规范 0 错误；打包成功。一句实话：自动测试守的是"规则对不对"，"好不好玩、平不平衡"依然需要您日常玩来反馈——两条腿走路，缺一不可。版本号升为 2.2.2。

## Qoder 2.2.3 开发记录（2026-09，作者：Qoder 编码代理）

这是您规划的"AI 自动对局"大工程的第一块地基。目标是让 AI 能对战、能陪练，而 AI 下每一步的前提是它能先回答一个问题："**此时此刻，规则允许我做哪些事？**"以前这个知识散落在界面按钮的"能不能点"里，机器想要就得去翻界面代码——这次把它做成引擎的正式能力：告诉它现在轮到谁，它列出一份完整的合法动作清单。

设计上有条铁律沿用至今：**规则只写一份**。清单模块自己不判断任何对错，它只负责"把所有可能的招法摆上桌"（每个营地空位、每个可去的区域、每个打得着的敌人和本营……），每一招合法与否，统统交给引擎里那套和真人出牌完全相同的裁判当庭裁决。这样界面上、AI 上、测试里用的是同一部"法典"，永远不会出现"AI 以为可以、引擎说不行"的两套标准。

5 个新测试把地基焊死，其中最有分量的是"对账"：清单上列出的**每一个**动作，都真的拿到引擎上过一遍，必须全部被接受；还有"翻遍清单也找不出违规招"（没消耗牌就不许出现在攻击清单里等反向检查）；最后一项已经算提前彩排——两个纯随机 AI 只靠这份清单互殴，54 毫秒就打完整一局分到胜负，说明"有清单就能下棋"成立，您的阶段二（本地 AI 大战测 bug）已经站在可用的门槛上。

过程如实交代：写测试时我有一条"想当然"被打脸——我以为站在战斗区的武将远程也射不到敌方本营，结果引擎裁判说可以，查证后确认是我记错了射程规则，以引擎为准改了断言（地基的裁判是引擎，不是我）。例行结果：类型检查 0 错误；测试从 190 涨到 **195 个全过**；覆盖率门槛再上调一档；代码规范 0 错误；打包成功。版本号升为 2.2.3。下一站按规划进入阶段二：本地一键连跑千百局的"AI VS AI"零消耗测试脚本。

## Qoder 2.2.4 开发记录（2026-09，作者：Qoder 编码代理）

上一轮给游戏装上了"能列出此刻所有合法操作"的地基，这一轮正式开工您规划的第一步：**让 AI 自己跟自己打，用来找 bug**。现在您在项目文件夹里敲一句 `npm run ai-battle`，就能让电脑自己打起来——想打多少局说多少局（比如 `npm run ai-battle -- --games 1000`），还能选 2～4 个 AI 混战。这套东西做完就全在本地跑，**一分钱额度都不再花**，这正是您当初划的重点。

它不是简单地"乱按按钮"。每一手棋都配了一位"质检员"盯着对账：全场每张牌（牌堆、弃牌堆、各家手牌、将池、阵亡堆、在场武将身上挂的装备）都记了号，**不许凭空多出一张、也不许无声少一张**（只有玩家输光离场时允许合理清走）；此外还盯着"死人不能留牌、血量不能倒挂、两个将不能站同一个格子、分出胜负必须亮出胜者"这类基本盘。任何一手棋被当场抓到问题，这一局的完整"录像"会自动存进 ai-battle-failures 文件夹，之后用 `--replay 文件名` 就能原样重演到出错的那一步——排查 bug 就像放监控录像，不用再碰运气。实际体检结果：**本地连打 1900 局（含三人、四人混战和长局），一局都没有违反上面任何一条铁律**，平均每局只用 9 毫秒到 55 毫秒，跑得比翻一页书还快。

也如实交代：写这套工具时我自己栽了两个跟头，都被自己的测试当场抓住——一次是"录像带"错位了一格（重放时把开局动作当成了第一步），一次是记账员漏记了"武将身上挂的装备牌"。修好之后测试全绿，还加了一项硬指标：**同一个种子号码，重跑一万遍也是同一局**——结果、步数、每手牌分毫不差。顺带说一句：现在这批 AI 是纯随机出牌，所以"后手的赢得多"属于正常现象，不代表游戏不平衡——真正会动脑的三档难度 AI 是下一阶段的事。

例行结果：类型检查 0 错误；测试从 195 涨到 **199 个全过**；覆盖率门槛再上调一档；代码规范 0 错误；打包成功。一句实话：随机 AI 是"探雷器"，炸的是规则层的雷；它玩得糙，探不出"好不好玩"——那仍然要靠您日常来玩、来反馈。版本号升为 2.2.4。

## Qoder 2.2.5 开发记录（2026-09，作者：Qoder 编码代理）

这次把上次做好的"AI 自动对战找 bug"工具，装进了游戏里，让它在**开发者模式**下随手可用。

怎么用：在游戏设置里输入开发者密码开启开发者模式后，主菜单会多出一个"🤖 AI 对战演练"按钮。点开可以选：几个 AI 混战（2/3/4 个）、打多少局（最多 5000）、从哪个种子开始（同一个种子结果完全一样）、以及进阶的将池大小、牌堆大小等。点"开始对战"后，会**另开一个小窗口**在后台自动对局——游戏主窗口完全不受影响，可以照常操作。小窗口里能看到每一局的实时进度；就算浏览器把新窗口拦住了，弹窗里也会出现一个"点这里手动打开"的链接，不会卡死。

打完后有两处产出：一是小窗口本身有"操作日志 / 录像 / 保存到文件夹 / 下载"按钮；二是主窗口**右下角会弹出结束简报**——打了多少局、多少局分出胜负、多少局步数用完还没打完、出现了多少错误（违例），并直接提供导出按钮。操作日志里，任何出错的步骤都会用 ❌ 标在对应那一行开头，一眼能找到；一局都没出错的会写明"全程未触发任何违例"。

一个小限制说清楚：浏览器出于安全考虑，网页不能直接"打开电脑上的文件夹窗口"，所以这个按钮做成了"选择文件夹后把日志和录像写进去"（Chrome/Edge 支持），不支持的浏览器会自动改成下载文件，效果等价。

例行结果：类型检查 0 错误；测试从 199 涨到 **205 个全过**（新日志格式 6 项专测）；lint 0 错误；打包成功。另外本机 Node 升级到 24 后测试工具会全线罢工，已在配置里自动适配（不影响云端 CI）。还在真实浏览器里点了一遍完整流程验证：开后台窗口真跑 2 局全部正常打完、零错误，右下角简报内容显示正确。云端 CI 验证已完成（第 16 次运行全绿）。

## 2.2.6：对局结束后可保存录像，操作日志自动留档

因为网页出于安全不能直接"打开电脑上的文件夹"，这次按新方案做了：每局打完后，结算画面下方会出现"是否保存本局录像"——左边可以直接改录像名，右边点保存。设置页新增"录像与日志"一栏：可以选一个电脑文件夹作为保存路径（浏览器只允许"选文件夹"这种形式，效果等同于填路径），并有"每局自动保存录像"开关；操作日志存在同目录下的"操作日志"子文件夹里，默认每局自动保存，录像存在"录像"子文件夹。文件默认名字是"房间名-自己的势力-日期时刻"，比如 桃园结义-蜀-20260923-14。日志里凡是系统拒绝执行的操作都会用 ❌ 标出原因，方便复盘。没设置路径或浏览器忘了授权时，会自动改成浏览器下载，不会丢文件。重启浏览器后第一次保存可能需要再点一次允许，界面有提示。

例行结果：类型检查 0 错误；测试从 205 涨到 **219 个全过**（录像记录/命名/日志/保存降级 14 项专测）；lint 0 错误；打包成功。真实浏览器验证：设置页新选项齐全、开关会记住，结算画面默认名正确、自动保存和手动保存都走通。云端 CI 验证已完成（第 18 次运行全绿）。


## 2.2.7：AI 学会了"看局势"——三档策略上阵，擂台验证强弱

以前 AI 只会"闭眼瞎抓牌"（随机乱选），这次给它装上了"看一眼再动手"的脑子：每走一步前，把当前所有合法动作在后台各试演一遍，哪个对局面最有利就选哪个。按性格调了三种档位——**保守**（重守本营、爱惜将领）、**均衡**（攻守各半）、**激进**（猛打猛冲、抢占地盘）。抽牌也会看情况：场上没将时优先抽将，手里资源够了就少抽补给。

怎么证明档位真的分出高下？做了个"擂台"（一条命令 `npm run ai-arena`）：让四种 AI 两两互搏，**每对打 500 局，两边座位轮流换**（防止先手占便宜），再加 200 局四人混战、200 局激进对激进——总共 **3400 局，规则违例 0 起**。结果强弱顺序和预期完全一致：激进对均衡约六成半胜率，均衡和保守互胜率为 100%，三档对随机全是 100%；混战里激进赢下 54.5% 的局。游戏里的"AI 对战演练"小窗口也升级了：开打前可以给每个座位单独挑策略，方便您摆"激进打保守"这种局围观。

顺手逮到一条**只有聪明 AI 才能暴露的规则漏洞**：敌将打进我方营地占了格子后，我方再往同一格登场将领居然被允许（系统查占用时只查了自己名下，没看见"入侵者"的记录），两个将领会叠在同一格。上场"随机 AI"从不这样走所以从没踩到；这次擂台刚开打就报了出来。已修复（登场前全战场查占位），并补了专项测试；原来出错的两局录像回放修复后正常打完。另有两处 AI 自己的"傻行为"也被纠正：只会反复抽牌不确认、为囤资源永不登场——都已修好。

例行结果：类型检查 0 错误；测试从 219 涨到 **235 个全过**（新增策略与擂台 16 项专测）；覆盖率门槛上调一档后通过；lint 0 错误；打包成功。浏览器实测：带三档策略的后台窗口真跑 3 局全部正常打完、零错误，配置行正确显示"座位1=激进·座位2=均衡·座位3=保守"。云端 CI 验证已完成（第 20 次运行全绿）。


## 2.2.8：AI 对战能"点兵点将"了，打完还给你一份势力平衡成绩单

这次加了两样东西，都围着"调势力平衡"服务。

第一样是**结束简报里的势力平衡表**。以前打完一批只知道谁赢了几局，现在每个势力一行，列出三个比率：**胜率**（这个势力坐过的座位里赢了多少）、**死亡率**（登场的将领里阵亡了多少）、**击杀率**（发动的攻击里造成对方损失的比例）。不管是命令行跑 2000 局、还是游戏里的后台对战窗口、右下角的简报弹窗、导出的操作日志，都会带上这份成绩单。顺手用新装配方式重跑了 2000 局大盘：五个势力胜率都在 48%–51% 之间，相当均衡；死亡率 65%–72%、击杀率 5%–14%——这两个数以后就是调参的基准线。（死亡率偏高主要是因为"随机 AI"爱乱送将领，等做人机难度时会用聪明档位重测。）

第二样是**自选势力和将领**。开打前，每个 AI 座位可以单独指定势力（魏蜀吴群晋或随机），还可以从该势力的武将名单里点具体将领——**允许重复**：三个座位都选吴国、或者一个座位塞两份曹操都可以。阵容一旦选定，这一整批（比如 500 局）从头到尾不会变。另外有个顺带的改变：现在**默认每个座位的将池也从单一势力里抽**（以前是各势力混着抽），这样上面那张平衡表里"魏的死亡率""蜀的击杀率"才有意义——不然一个座位混着三个势力没法归账。

真实浏览器里验证过一遍：解锁开发者模式后，在弹窗里给座位1 选魏+曹操两份、座位2 选蜀，开打 20 局——后台窗口显示"阵容：座位1=魏（自选：曹操、曹操） · 座位2=蜀（整池随机抽）（整批锁定不变）"，结束后平衡表两行如实打出。也专门用自选阵容又跑了 350 局压测，0 违例。小提醒：那 20 局里"魏 100% 胜、蜀全灭"只是阵容太强+样本太小，不是势力不平衡的结论。

例行结果：类型检查 0 错误；测试从 235 涨到 **250 个全过**（新增装配 7 项、座位统计 1 项、报表与哈希 5 项、简报表格组件 3 项）；覆盖率门槛上调一档后通过；lint 0 错误；打包成功。云端 CI 验证已完成（第 22 次运行全绿）。

## 2.2.9：游戏里可以跟 AI 对战了——还能全自动观战

这次把前面几轮攒下的"会看局势的 AI"正式请进了游戏里。开房间时多了一块"席位安排"：每个座位都能选让**人类**坐还是让 **AI** 坐，AI 还能挑档位——随机（闭眼乱抓牌的入门陪练）、保守（重守本营、爱惜将领）、均衡（攻守各半）、激进（猛打猛冲、抢占地盘）。想自己玩就留人类，想省事就让 AI 代坐。

两种玩法都通了：

**人机对战**——比如你坐座位1、AI 坐座位2。轮到 AI 时它会自己选人、自己抽牌、自己出招，你屏幕上会看到"AI 出手中…""正在决定抽卡…"这类提示，大约每 0.7 秒动一下，看得清它每一步在干什么；轮到你就正常停下等你操作，它绝不插手你的界面。

**全 AI 观战**——把所有座位都设成 AI，点开始后就是一盘"自走棋"：从掷骰子定座次到征召、抽牌、对打，全程自动直到分出胜负，你就当观众。想研究 AI 怎么打，这很方便。

有一点要说明白：AI 出的每一步牌，走的都是**和你点按钮完全一样的官方通道**——该被规则拦的下不了手，录像和操作日志也照常记录。这不是外挂脚本式的假 AI，所以前面为 AI-vs-AI 测试补的规则修复、录像体系，人机对战全部自动受益。

老规矩的实话：①档位的"强弱"是擂台几千局测出来的，套到"人类觉得好不好玩、难不难"上还需要您亲自摸——0.7 秒一步的手感也一样，嫌慢嫌快都可以提；②现在的"热座"规则没变，AI 回合时棋盘上它的手牌您仍然看得见（跟朋友代打一个道理），要不要隐藏是下一个需求；③AI 选人用的是固定套路（本势力 7 名 + 群 3 名），不是"聪明选人"。

验证情况：类型检查 0 错误；测试从 250 涨到 **258 个全过**（新增 8 个用例里包含"两个 AI 纯靠这个司机自动打完一整局"）；覆盖率门槛再上调一档；代码规范 0 错误；打包成功。云端 CI 验证已完成（第 24 次运行全绿）。浏览器里真刀真枪跑了两局：全 AI 那局从建房一路自动打到第 8 回合分出胜负（结算页照常弹出、录像默认名都对），人机那局 AI 该自动的自动、该等您的等您，最后您方投降判负也正常。两局控制台零报错。版本号升为 2.2.9。下一站按计划是阶段五收线（约 2.3.0）。

（另：关于"对局结束保存录像/操作日志"的那条长需求，在 2.2.6 已全部交付完毕，本次不再重复实现——本轮的 AI 对战同样自动享受那套保存体系。）

## 2.2.10：自动保存不再弹"另存为"窗口了——治本完成

您找到的病根这次从根上解决了：以前每局结束，"自动保存"会走浏览器的下载通道，而您的浏览器设置了"下载前先问存到哪"，于是 Windows 弹出保存窗口——您远程时没人点它，窗口就一直挂着，才把那条老需求消息反复重投回来。

现在的规矩很简单：**没人操作的自动保存，绝不允许弹任何窗口**。具体是：

- 如果您在设置页预先授权过保存目录：照旧静默写入该目录的"录像/操作日志"子文件夹，无感、无弹窗。
- 如果还没授权：这一局的录像和日志会先**暂存在浏览器内存**里（结算页会写明"已暂存，不弹保存窗口"），等您哪天点了"选择文件夹"授权，或下次保存成功时，**自动把暂存的都补存进去**，一份不丢（暂存最多留最近 12 份，防止越积越多）。
- 只有您**亲自点**结算页的"保存"按钮时，才可能走下载、弹保存窗——这是有人在场、该弹的。设置页选完目录的瞬间也会立刻提示补存了几份。

验证情况：类型检查 0 错误；测试从 258 涨到 **264 个全过**（新增 6 个用例专门锁"自动保存绝不下载、绝不申请权限"）；覆盖率门禁通过；代码规范 0 错误；打包成功。浏览器里实测两件事：自动保存时下载动作**零次**触发（探针计数确认，也就是不可能再弹窗）；手动点"保存"仍正常走下载兜底。控制台零报错。

实话两处：①暂存在内存里的东西刷新页面就没了——但那种情况本来就没授权目录、写不进硬盘，先授权才是正解；②您手动点保存时弹不弹"另存为"，仍取决于浏览器的"下载前询问"设置，本轮管住的是自动路径。版本号升为 2.2.10。云端 CI 验证已完成（第 26 次运行全绿，264 个测试全过），全部提交和标签都已推送到远端。另坦白：您截图看到的那次弹窗是我做测试时点"手动保存"触发的（自动保存零弹窗已被探针证实），这个操作教训已记入文档，以后测试不会再在您浏览器上点真下载。

## Qoder 2.2.10 之后补一笔：把"每次改完怎么收尾"写成了仓库里的正式规程

您提的需求落地了。以前"改完代码之后要做哪一整套收尾动作"（登记三处文档、记两份历史、提交打标签、推送、等云端检查全绿、把检查结果回填）只存在 Qoder 本机的记忆里——换一个模型接手就得重新教。

现在这套流程以《PROJECT_RELEASE_PIPELINE.md》的形式正式放进了项目文件夹，跟仓库一起走：接手任何一方读完交接文档第 1 节的读取顺序，第 6 条就会把它领到这份规程；第 10 节"修改后"的第 9 条也指向它。规程里连踩过的坑都写明了（比如浏览器测试绝不能在您的真实浏览器上点真下载、推送不通时先直推再借道代理且绝不写死配置、看到"保存录像"老需求反复重投只确认不重做）。

Qoder 本机同时装了一个内容一致的技能作为快捷入口，但那只是加速器——**权威版本以仓库文档为准**，您换任何工具接手都不受影响。本次纯文档改动，未动任何源码。

后续（同日）：这份规程已推送到远端仓库。差一件小事没闭环——云端检查（CI）这次没查成（当时可用的浏览器连不上 GitHub），运行编号等下次收尾时顺带补记进文档即可，不影响规程本身生效。此事已登记在交接文档第 12 节第 14 条待办。（后续补记：2.2.11 收尾时已用您登录好的浏览器查到那三次云端检查全部通过，编号已回填，该待办销案。）

## 2.2.11：请"老作者"做了一次体检，然后停下来把说明书补齐

您担心"换了助手后方向跑偏"，我们把最新版源码包交给网页版 GPT（当年写 1.x 的那个模型）做了一次独立评审。它的全盘结论值得高兴：**玩法方向没有偏离**，引擎、技能、AI 的路线都是它认可的自然演进。但它也毫不客气地指出一个真问题：新功能跑得太快，**说明文档掉队了**——README 里还写着"131 个测试"（实际 264）、有的文档地图里列着早就不存在的模块、版本年表甚至声称删掉了一个其实还在的文件。这些我们都逐条对过代码，全属实。

它也解释了自己的疑虑从何而来——不是代码写得不好，而是"项目负责人开始解释不了这个系统为什么这样工作"。这正对应您说的"有点跟不上它做了什么"。

所以这一版（2.2.11）**一行游戏玩法代码都没改**，专门做三件事：

1. **把三份掉队的文档全部修准**（README、AGENTS、CHANGELOG），并把版本年表从 2.0.1 一路补到 2.2.10，以后任何人打开仓库就能看懂每一步；
2. **新建了一份《全项目地图》**（PROJECT_ARCH_MAP.md）：每个模块负责什么、谁说了算、能活多久、碰不碰随机数、验证到什么程度、还欠什么账，一张表说清——这是给以后所有接手的模型（包括我们俩）看的"总平面图"；
3. **和 GPT 敲定了八项技术决议**存档备用：比如游戏引擎以后怎么升级成"常驻制"才不会两套规则打架、录像以后怎么做到永不走样的重放、旧的录像文件绝不涂改（它是历史证据）等。还定了一条纪律：以后每次改动登记时，这五份文档必须一起核对，不许再饿着。

验证照旧全绿：类型检查零错误、264 个测试全过、代码规范零错误、打包成功。因为没动玩法，这轮不需要浏览器实测。云端检查也已核验：推送后 GitHub 云上一遍通过（双测试矩阵各 264/264，编号 35894015044），证据已回填进交接文档；顺带把上次挂着的"规程文档 CI 编号待补记"小待办也一并销了案。

下一步按双方共识进入"稳定期"：先熟悉地图（您也可以翻翻，写得都是白话能懂的结构），再小步整理两个最肥的文件，然后才是给技能系统补完剩下的收尾功能。阶段五不再单独收线，并进了这条路线。您随时可以喊停或调整顺序。

## 2.2.12：把最大的"总开关柜"拆开了一角——东西没动，只是理了线

这次是"稳定期"定下的第一件整理活：游戏的中枢文件（gameStore，管着界面和流程的那个"总开关柜"）之前有 956 行、什么都往里塞。我们按和 GPT 商定的顺序下了第一刀，把三类不相干的东西挪进独立的小文件：

1. **图纸页**（类型定义）——所有数据长什么样，单独成册；
2. **编辑器抽屉**（开发者模式、技能/武将编辑那九个功能）——挪进自己的柜子；
3. **存档恢复抽屉**（快照保存/读取）——也独立出去；
4. 另外把"演练场"专用的两个小工具并进了演练场自己的文件里。

中枢瘦身到 622 行，玩法、规则、引擎逻辑**一个字都没改**。为了证明"只是理线、没动电器"：264 项自动测试原封不动全过、云端检查照跑，又在浏览器里把搬迁涉及的每条线都实际通了一遍电（建房、编辑技能存取删、存档读取、开演练场、重置游戏），零报错。

这属于您批准过的"稳定期小步整理"，下一刀按计划轮到"事件结算器"（EventProcessor）。您随时可以喊停。（收尾补记：推送后云端检查一次通过——编号 35935393466，测试双矩阵/代码规范/打包四项全绿。）

## 2.2.13：给"引擎心脏"做了第一次开壳理线——零件一颗没换

游戏里每一次出牌、攻击、摸牌，最后都要经过一个叫"事件结算器"（EventProcessor）的总闸——它决定"事情发生之后，局面变成什么样"。这个总闸从项目诞生起就没拆过，攒到了 852 行，是全项目最老最重的一块铁。

这次我们照上一轮拆"总开关柜"的同样规矩，给它做了**开壳理线**：总闸本身只留 93 行（一个进线口+一个分发盘），里面的线按用途分成六束，各自搬进独立的小盒子——伤害一束、摸牌一束、武将行动一束、玩家出局一束、回合流转一束，还有一束专门管"连锁反应"（比如主帅阵亡自动触发败局）。**每一根线都是原样平移，接法、粗细、通电顺序一个字都没改**；并且在盒子上贴了封条写明：从此只许这一个进线口，谁也不许私拉第二路电。

这属于您批准过的"稳定期小步整理"的第二刀。为了证明没动电器：264 项自动测试原封不动全过、云端检查照跑，又在浏览器里让四个演练场玩家连过四轮回合，看回合、摸牌、阶段切换这些线一束束实际通电，局面推进分毫不差；存档读取、守卫拒收坏数据也都逐一验过。下一刀按计划轮到界面文件整理，动手前照例先问您。

（收尾补记：推送后云端检查一次通过——编号 35940699193，测试双矩阵/代码规范/打包四项全绿，本次直推网络顺畅未借道代理。）

## 2.2.14：把"将领编辑器"这台大修台拆成了三个独立工位——工具一件没扔

编辑器是给将领改技能的大修台，也是全项目最"胖"的界面文件（1253 行）：左边挤着三样东西——读 Excel 表格的解析器、选"触发时机"的小面板、填"结构化效果"的小面板，全焊在同一块板上。

这次按前两刀同样的规矩做了**分工位**：读表解析器搬进独立文件（下次导入 Excel 走的就是它），触发时机面板、结构化效果面板各自搬进独立小间。**每根线、每个按钮的接法一字未动**——搬完还在浏览器里真机走了一遍：选关羽、给"武圣"挑"受到伤害后→攻击伤害"存进去再删干净；切多效果模式填"造成 3 点技能伤害给被作用者"看预览；造了一份真 Excel 文件从导入按钮塞进去，确认解析、入库、提示全部正常；点导出也顺利出文件。264 项自动测试原封不动全过，云端检查、打包照常。

这属于您批准过的"稳定期小步整理"第三刀（界面序列第一件）。剩下的大件是棋盘和对战演练场两块，动手前照例先问您。

（收尾补记：推送后云端检查一次通过——编号 35944672735，测试双矩阵/代码规范/打包四项全绿，本次直推网络顺畅未借道代理。）

## 2.2.15：把棋盘上的五件"纯摆设"搬进了独立抽屉——打牌实测一遍，颗颗照常

这一版是给"游戏棋盘"这个大文件做的整理。棋盘上除了地图和卡牌，还有一批只负责"长得清楚"的小零件：详情页里显示体力护甲的那排统计小卡、弹窗顶部红蓝绿的小计数胶囊、屏幕下方那条带确认/取消按钮的操作横条、通用弹窗外壳。这五个小零件这次原封不动地搬进了自己的文件（新建了一个"棋盘零件抽屉"，一共二十来行），棋盘本体从 704 行瘦到 689 行——是的，这一刀很轻，因为棋盘本身比之前修的编辑器小得多，真正跟战局状态纠缠在一起的格子渲染和按钮逻辑，我们照旧**故意没动**（动了就是边开车边换轮子，不是这个阶段该干的事），这一点和上次编辑器留着"导入/导出"按钮是同一个道理。搬之前还确认过：这五个零件全项目只有棋盘自己在用，不会牵连别人。

老规矩：所有自动检查全绿、打包正常。这次最有看头的是**真打了一局**：按正式流程建房、掷骰、定势力、每人征召十名将领、开局抽牌，然后全程鼠标真点——把"廖化"这张武将牌从手牌里点详情页、按登场流程选消耗牌（按钮从灰的变绿的整个过程都盯着）、点营地格子真实放子上场，再点它"前进"走到前线；期间把将领池弹窗（武将9、文将1、魏7、群3 的小胶囊数字逐一核对）、抽牌堆弹窗（42 张牌一一对上）、弃牌堆、墓地、暂停菜单存档全部点了一遍，没有任何一处出错。

这属于您批准过的"稳定期小步整理"第四刀（界面序列第二件）。最后一块大件是对战演练场，动手前照例先问您。

（收尾补记：推送后云端检查一次通过——编号 35948875546，整条流水线全绿；本次直连遇到网络波动，按老办法临时借道本地代理一次成功，没有在系统里留下任何代理设置。）

## 2.2.16：把演练场最后三件"小摆设"搬进抽屉——界面大扫除到此收工

这一版收尾了界面三件套的最后一件：对战演练场。跟上次棋盘一模一样的手法，把它尾部三个纯显示小零件——详情页的统计小卡、屏幕下方那条操作横条、横条上的确认/取消按钮——原封不动搬进了一个新文件（只有十行），演练场本体从 485 行到 483 行。刀口这么小是实话实说：演练场里其余的东西（格子、三块调试面板、所有按钮逻辑）全都跟状态死死缠着，硬拆就不是"搬家"而是"动手术"了，照旧故意没动。有个值得记一笔的细节：这三个零件跟棋盘上那五个**名字一样、尺寸不一样**（演练场整体更紧凑），我们**故意没把它们合并**——合并就得改样子，改样子就有出问题的风险，这次是零改动承诺，所以一人一个家，将来真要统一再单独立项、对着截图逐像素核对。

自动检查照例全绿、打包正常。浏览器里全程真点了一遍演练场：从右侧调试面板搜"廖化"塞进手牌→点开详情页（四张统计小卡数字逐一核对）→登场（操作条从"消耗0/4"按钮灰着，选满4张牌按钮变绿，确认，提示条换成"点击营地空格"，点绿框格子真实放子）→点场上的廖化"前进"走到前线→用调试面板给它扣1点血→再点它开补给条（已选0张时确认是灰的，选1张粮草变绿，点确认，血量回到4/4）→详情页的"本回合：移动1次/补给1次"计数器也对上了→切玩家、结束回合、退出演练场回主菜单。全程控制台一条报错都没有。

至此，您批准的稳定期"界面大扫除"（技能编辑器→棋盘→演练场）三刀全部落地。下一站按计划是技能规则补漏（治疗/披甲这类效果还没走完整条技能链），动手前照例先问您。

（收尾补记：推送后云端检查一次通过——编号 35952936795，整条流水线全绿；这次直连推送即成功，没有借用代理。）

## 2.2.17：技能引擎补上两块规则盲区——"治疗/披甲"能结算了，"技能击杀"也会宣告死亡了

这一版是您批准稳定期路线里的"技能规则补漏"第一刀（阶段 C），也是这轮稳定期第一次真正**改动游戏行为**的版本——前两站（文档、拆文件）都是零行为变化，这次动的部分有全套测试和实机验证兜底。补了两块盲区：

**一、"治疗"和"获得护甲"两种技能效果从此真正生效。** 之前您在编辑器里给武将配"疗愈（回合开始回血）""固甲（回合开始+2甲）"这类技能，数据能存、界面能显示，但引擎根本不结算——编译器遇到这两种效果就直接跳过。现在它们有了自己的结算规则：治疗不会溢出上限（血量封顶在本将最大体力；人不在场上就老实什么都不做），护甲按"点数"累加（就是编辑器预览写的"获得 N 点护甲"，跟装备护甲卡是两码事），并沿用已有的"每 2 点甲吸收 1 点伤害、剩 1 点甲原地留着"规则。编辑器里"暂未接入结算"的灰色标注也随之自动消失了。

**二、用技能打死人，现在会正常"宣告死亡"。** 之前有个隐蔽的规则断层：普通攻击击杀武将会正常触发死亡流程（进墓地、对方吃一张补偿牌、相关技能响应），但**技能伤害**打死人时，武将会被"静悄悄地移出场外"——墓地不收、补偿牌不发、"击杀时"和"死亡时"技能全都不响。修法的难点在于：技能是否致命，只有等结算真正落地那一刻才知道。方案是给结算管线加了一道"事后核对"——对比打击前后场面，发现有人因技能伤害离场，就正式补发一条死亡事件，让整条死亡链（墓地→死亡技能摸牌→击杀技能摸牌→击破补偿抽）照常展开；同时设了保险丝防止死亡链无限套娃（最多 8 轮，超限会留明确警报标记）。普通攻击的击杀链路上游本来就发死亡事件，我们用伤害类型做了门卫，保证同一次阵亡绝不会收到两条死亡通知——测试里专门盯了这一点。顺带钉死一个有意思的次序事实：死亡者的"临别摸牌"排在击杀者的"收割摸牌"之前（死亡技能优先级更高），两家的牌堆次序由此而定，写进了测试注释。

**验证**：自动检查五项全绿（类型检查 0 错、268 个测试通过、覆盖率门槛上调一档、打包正常、300 局 AI 对战零违例）。浏览器实机走的是"仓库认可的数据直驱"口径（本轮自动化点击被环境拒绝，如实记录）：正式流程建房到开局后，把带技能的黄盖和许褚按正规数据结构放上场，然后**真的按下结束回合、真的发动攻击**——黄盖回合开始从 2 血回到 4 血封顶、护甲条涨到 2；一刀普攻接烈攻技能把满血许褚打死，许褚进墓地、双方技能各摸一牌、"玩家2 击破补偿抽卡"弹窗如期出现、点完抽牌回合权正确回到黄盖方；页面上黄盖卡面实时显示"🛡️2 ❤️4/4"，控制台零报错。

**还没做的（按计划顺延）**："回合结束询问是否发动技能"的交互窗口，以及十种没有底层事件支撑的触发时机（改伤害/改防御/被动/主动/持续类），仍挂账待办；下一站按路线是随机数体系改造（阶段 D），动手前照例先问您。另记一笔您的决定：界面大扫除后剩余的"拆状态纠缠"改造**不做了**，除非将来有明确好处。

（收尾补记：推送后云端检查一次通过——编号 35965467286，整条流水线全绿（两套 Node 版本各 268 个测试、代码检查、打包四项均成功）；这次直连推送即成功，没有借用代理。）

## 2.2.18：把"掷骰子"装进对局的口袋——抽牌随机数正式住进游戏状态里

这一版是稳定期路线里的"随机数体系改造"第一刀（阶段 D）。用大白话讲清改了什么：以前游戏想知道"下一张抽到什么"，靠的是全程序共用的一只公共骰子（Math.random）——谁都能摇，摇出什么不记录、不复现，两个一模一样的对局存档各自重放一次，抽到的牌可能对不上。现在给每局对局发了**一只私有骰子**，就装在对局自己的状态包里：每个会用到随机的动作（洗牌抽将、补牌、弃牌堆重洗）都只摇自己这局那只，摇完把"骰子拨到第几格"也记回状态里。这样一来：同一个存档从头重建，抽到的牌**逐张一致**；旧存档没有这只骰子也不要紧，系统会自动配一只并记下初始位置，照样能加载——所有存档、录像的"格式版本号"一个都没动，老文件全部照常打开。

顺带修了一个老大难姿势问题：以前"抽哪张牌"是在一个只该负责"审核请求"的环节里偷偷完成的，等于裁判自己下场发牌。这版把它彻底搬到了正规的结算环节，裁判只管核对"你要抽几张、合不合法"；测试里还专门做了一道探针——谁胆敢再偷用公共骰子，测试立刻爆炸。另外以前的弃牌堆重洗手法（sort 随机比较）其实洗得**不均匀**（数学上有偏），这次一并换成了正规洗牌法。

需要坦白的一点：换了私有骰子和正规洗法之后，**抽牌结果的分布跟以前不一样了**（同一局以前抽 ABC，现在可能抽 ACB）——这是这次改造的题中之义，旧的对局结果不做承诺，新的对局从此可复现。300 局 AI 压测同一粒种子跑两遍，输赢分布一个数字都不差，就是"可复现"的实证。

**验证**：自动检查五项全绿（类型检查 0 错、**287 个测试**通过（比上版多 19 个，全是围着新骰子写的：同种子同流、旧档兜底、生产抽牌流程重放一致等）、覆盖率门槛四项全部达标且实测微升、打包正常、300 局 AI 对战零违例且两轮结果完全一致）。**这一版的页面实机验证没能做**：本轮自动化环境把所有"打开网页"的通道都拦了（权限策略拒绝，如实报告），所以改用等价的代码级端到端（在测试里把正式建房→开局→抽牌整条真实链路走了三遍：同状态重放抽牌一致、换种子抽牌改变）；页面上的真机抽牌回归记入待办，下个版本条件允许优先补。

**还没做的（按计划挂账）**：录像"直接记结果、不再重摇"的完全形态、开局建牌堆等外围随机也住进私有骰子、AI 对战那层旧的全局骰子补丁彻底退休等后续刀，已逐项登记在交接文档 §12-16；下一站按路线是"引擎常驻化"（阶段 E），动手前照例先问您。

（收尾补记：云上的第一遍检查**没有通过**——新的测试文件里留了一行没用到的导入，云端的类型检查把它逮住了。这事值得记一笔：本地当时报的"全绿"是在这个文件最后定稿**之前**跑的，等于体检报告出来后病人又动了手术——以后一律所有东西定稿后再做全套验证，然后才提交。删掉那行多余导入（对玩法零影响）、本地五项检查重跑全绿后补交了一次修复，经您同意把版本标记挪到了修复后的位置。云端第二遍检查四个岗位全部通过（编号 35975699142）。这次推送直连又没接上，照老规矩临时借了一次本机代理，没留任何持久配置。）

## 2.2.19：开房间的那套"掷骰子"也搬进了对局口袋——旧的全局骰子补丁正式退休

这一版是随机数改造的第二刀，把上一版留在口袋外面的三样东西一次收编：

**① 开局建局也吃私有骰子。** 上版只管了"对局进行中"的抽牌，这一版把**建房那一刻**的随机——洗武将池、掷先手骰、分势力、发征召候选、铺初始牌堆——也全部接进了每局的私有骰子。效果是：同一粒种子从"点创建房间"那一刻起，整条开局流水（谁先手、谁分到哪个势力、征召名单里有什么、第一叠牌堆怎么排）都能一模一样地重放；换粒种子则整个开局都换一副面孔。界面上那些纯装饰的小随机（房名、测试工具里的演练骰子）刻意不动。

**② 牌的"身份证号"不再掺时间戳和随机数。** 以前每张牌实例、每条操作记录的编号是"时间+随机数"混出来的，同一局重放两遍编号就对不上，得靠测试打分时"睁一只眼闭一只眼"。现在改成简单的流水号（第 1 号、第 2 号……），重放时编号也逐字一致——那道"豁免"从此取消，测试更严格了。

**③ AI 对战那层"临时把全程序骰子换掉"的补丁彻底删除。** 上版遗留的旧机制靠运行时偷换公共骰子来保证可复现，现在 AI 演练房内部三条随机数线（对局抽牌、开局装配、AI 决策）各自明确持有自己的私有骰子，补丁功成身退、文件删除。顺带清理了一个历史遗留写法：回放录像时不再"假装问一遍 AI 决策"，直接用录像里记的动作。

**要坦白的一点**：因为装配随机数从"大锅饭"拆成了专线，**AI 演练房的种子→输赢分布变了**（同样 300 局同一粒种子，先手胜场从 112 变 109）——规则本身一个字没改，纯属随机数流重新分线；平衡观测台以前的统计数据要按新基线重跑一遍才作数。

**实机点击测试补上了**（上版欠的账）：在本地页面用真实点击走完一局人机对战——建房→掷骰（9 比 8）→分势力→征召 10 名武将→开局抽牌（2 张将+3 张牌）→确认进入对局，页面全程零报错。测试环境的小限制如实说明：这次的内置浏览器窗口是隐藏的，鼠标级指令发不出去，所以点击是用脚本向页面元素派发**真实的浏览器点击事件**完成的（React 组件走的是货真价实的事件处理）；另外后台页面的计时器会被浏览器限速，测试里按既有口径做了同步处理——这些都是测试环境形态，不是产品的变化。

**验证**：定稿后全套五项检查一次通过——类型检查 0 错、**291 个测试**（比上版多 4 个：开局可复现性 3 例 + "AI 全局局完全不许碰公共骰子"探针 1 例）、覆盖率门槛达标（函数一项门槛 33→34 上调）、lint 零新增、打包正常、300 局 AI 压测两遍输出逐字一致。

**还没做的（按计划挂账）**：D-2 系列只剩最后一刀——录像"直接记随机结果、不再重摇"的完全形态（现在做到的是"重摇也保证一模一样"），已和您商定单独一刀；下一站按路线仍是"引擎常驻化"（阶段 E），动手前照例先问您。

（收尾补记：推送后云端检查一次通过——编号 35984979124（第 50 次），四岗位全绿（两套 Node 版本各 291 个测试、代码检查、打包均成功）。这次直连又没接上，照老规矩临时借了一次本机代理推送，没留任何持久配置。）


## 2.2.20：游戏的"一步棋怎么落下"搬进了单间——三种跑法当面对账，结果逐字相同

这一版是稳定期阶段 E 的第一刀，动的是引擎的"心脏手术"，但目标恰恰是**什么都不改**：

**① 把"落子逻辑"从"杂务"里分出来。** 以前引擎每处理一个操作，"判断合法性→执行→触发技能连锁→结算"这套正经业务，和"往广播里喊话、给录像机递带子、拍状态快照"这些周边杂务全挤在同一个函数里。这一版把正经业务原封不动搬进一个新单间（TransitionCore），老函数只留下杂务——先办事、再播报。搬的是逐字搬家，不是重写。

**② 三种跑法当面对账。** 引擎一直有个特点：界面上每走一步其实都是"新造一台引擎跑一步就扔"（重建式），而演练和回放又需要"一台引擎连续用"（常驻式）。决议最怕的就是两条路各跑各的、慢慢长歪。这一版加了专门的对账测试：**同一套剧本（含一次技能连锁击杀、一次移动、一次被拒的操作），常驻引擎、每步重建、再把第一路录下的录像完整重播——三种跑法每一步吐出的事件序列、最后盘面状态，全部逐字比对必须相等**。三把锁一次钉死，以后谁想改歪都会当场红灯。

**③ 顺手修了一个录像回放的旧毛病（本轮唯一实质变化）**：回放录像时，中途才登场的武将以前"不记得学技能"——因为技能注册只在开局做一次。现在改成和实况一样，每一步播放前都重新核对一遍该会技能。这个回放器目前没有游戏界面在用，属于工具链内部的一致性修复。

**要坦白的边界**：界面底层"每步新建引擎"的习惯这一版**没动**（把引擎变成常驻户口是下一刀，按您的口径顺延）；除回放器修复外，所有玩法行为零变化——300 局 AI 压测的输赢分布和上一版**一字不差**，这就是"没改行为"的实锤。

**实机点击测试**：在本地页面真实点击走了一局人机对战——登场庞德→推进前线→结束回合→AI 自己抽卡、登场邓艾、推进、交还回合（全部走的是搬进单间后的新链路）→我方第二轮抽卡确认→给庞德配消耗卡发起远程攻击、目标高亮出现，页面全程零报错。中间有过一段"点营地登场没反应"的小插曲，用直驱探针查清了：不是引擎的锅，是测试脚本一次点太多个地方把界面自己的选择状态点脏了——重新一次只点一下就正常，教训已记进测试手册。

**验证**：定稿后五项检查一次通过——类型检查 0 错、**294 个测试**（比上版多 3 个：就是上面那套三路对账）、覆盖率四项全部小幅上涨（门槛不动）、lint 零新增、打包正常、AI 压测分布与基线逐字一致。

**还没做的（按计划挂账）**：store 常驻迁移（让界面也改成"一台引擎长期用"）是下一刀；录像"直接记随机结果、不再重摇"那一刀仍单独排着——都已按规矩登记在交接文档里。

（收尾补记：推送后云端检查一次通过——编号 35995323024（第 52 次），四岗位全绿（两套 Node 版本各 294 个测试、代码检查、打包均成功）。这次直连又没接上，照老规矩临时借了一次本机代理推送，没留任何持久配置。）


## 2.2.21：界面底下的引擎终于"落了户"——从"每步现造现扔"到"一台常驻"，四条跑法当面对账，行为一字未变

这一版是阶段 E 的第二刀，也是决议 D-1 的收线之刀。上一版把"一步棋怎么落下"的正经业务搬进了单间（TransitionCore），但界面底层"每走一步就新造一台引擎、走完就扔"的老习惯还在——这一版就是给它安家落户。

**① 落户途中的一次方案纠偏（先想明白再动手）**。原计划用"认脸"的方式决定引擎能不能复用：进来的状态要是上次那台引擎产出的，就直接复用，否则重建。动手前仔细核对了界面的记账方式，发现界面和引擎快照之间很多数据是**共用同一个对象**的（改快照就是改界面，反之也一样），"认脸"根本看不出这种就地修改——弄不好会出现两台引擎各记一本账的暗雷。于是改成更笨但更稳的办法：**常驻引擎每一步都无条件把界面递来的状态克隆一份"认领"为自己的状态**，用完把结果交回去。这样它吃的输入和老办法"每步新造"完全同源同料，行为上恒等于老路，但户口是固定的——将来要接"回合结束询问窗口"、网络对战这些需要长期活着的东西，容器已经就位。而且因为每步都重读界面状态，读档、重开、演练场装配这些"外人改状态"的场合自动被尊重，连原计划准备的"失效开关"都省了。

**② 技能表每步"先销户再上户口"**。新造引擎的好处是技能注册永远反映当前场上活人；常驻后如果不处理，上一步阵亡的武将的技能会一直赖在注册表里继续触发。现在每步先把上一批人的注册注销、再按最新场面全量重注册——和"新建引擎跑这一步"的注册表一字不差。

**③ 老办法降级为"查账先生"**。"每步新造引擎"的跑法没删，改成一个对账专用函数：它故意不往录像机里递带子，所以新常驻路和对账路可以同时跑、逐字比对而不会把录像记双份。

**④ 四把锁**。对账测试从三把锁加到四把：**同一套剧本，直接常驻引擎、查账先生的重建路、界面真实的常驻桥、录像回放器——四条路每一步的事件序列和最终盘面必须逐字全等**。另加三个针对"户口"本身的专测：连续操作确实复用同一台引擎；阵亡武将的技能会被下一步的销户流程清掉；界面就地改了数据（共用对象那种改法），桥也照样吃到。

**要坦白的边界**：这一刀的目标就是"什么都不改"，而且做到了——300 局 AI 压测的输赢分布和上一版**一字不差**（这不是"变了之后重新锚定"，是压根没变）。界面层的八个调用点一行没动，只是桥的内部换了心脏。

**实机点击测试**：新开本地页面真点了一局人机对战全程：掷骰子→确认座次→AI 自动征召→我方真点击选满 10 将（7 晋+3 群，正好卡着"群 1-3 名"规则）→确认→双方初始抽卡→开始行动→登场司马懿（这里还学到了一个规则细节：登场至少要烧一张手牌，选了张锡矿后"确认位置"才亮起）→点营地格落子→结束回合→AI 自己打完整回合→第二轮抽 5 张确认→让司马懿"前进"从营地上到前线。全程引擎探针显示**同一台常驻引擎的计步器从 10 一路涨到 20、从没换过人**，页面零报错零警告。

**验证**：定稿后五项检查一次通过——类型检查 0 错、**297 个测试**（+3 个户口专测，四路对账也含在内）、覆盖率四项全部稳过门槛（门槛不动）、lint 零新增、打包正常、AI 压测分布与基线逐字一致。

**还没做的（按计划挂账）**：两刀连做的第二刀——录像"直接记随机结果、不再重摇"（RandomOutcome 事件流），紧接着做；更早登记的回合结束询问窗口、网络对战等长生命周期业务接线，容器已备好、随各自需求另立刀次。

（后续补记：当晚推送时本机代理软件忘了开，直连和代理都不通；您开启 v2rayN 后一次补推成功，云端检查第 54 次运行全绿，编号 36007805969，证据已回填进交接文档与更新日志。）

## 2.2.22：录像终于学会"记结果"而不是"每次重新摇"——抽到什么就记什么，回放照着账本复原，十年前的旧账也照样能查

这一版把两刀连做的第二刀交付了。上一刀把"发动机"落了户（常驻引擎），这一刀动的是"对账方式"：以前录像只记"每一步动作+开局时的随机种子"，回放时要从种子起**把整个随机数流重新摇一遍**，摇到哪算哪——能复现，但那是"赌重新摇一定摇得一样"。现在改成：每次抽牌**实际抽到了什么，当场白纸黑字记进事件流**（抽了哪几张将、牌堆顶拿了几张、弃牌堆重洗捞回了哪几张、摇完后随机数游标停在几），回放时照单复原，根本不再摇。

**① 记的是"结果"，不是"手感"**。新事件叫 RANDOM_OUTCOME，每条带一个稳定编号（第几回合第几轮哪个玩家第几条，形如 ro:1:1:1:0），内容全是身份键和计数——不塞对象、不塞引用，所以录像文件照常是纯 JSON，**录像格式一个版本号都没动**。

**② 回放先验票，验不过就老办法兜底**。回放照着记录复原前会严格对票：记录的张数必须和当前场面的确定性公式对得上、每张牌的编号必须在将池/牌堆/弃牌堆里真实找得着——全对才照单执行；有任何对不上（比如这是 2.2.22 之前录的老录像，压根没有结果事件），自动退回"可复现重掷"的老路。老录像不迁移、不作废、照样能放，这是当初定下的旧档策略的又一次兑现。

**③ 三把实验锁**。为了证明回放真的在"照账本复原"而不是"偷偷重新摇了一遍"，做了三组对照：把开局随机种子故意改成一串假数字再回放——结果和实况**一字不差**（说明它确实没在用种子重摇）；再把录像里的结果事件整批撕掉、种子还是假的——立刻面目全非（说明之前的一致确实靠结果通道扛着）；只撕结果、种子留真——回放仍然全等（老路兜底活着）。三组都过，逻辑闭环。

**④ 真机三局+一局 225 步大账**。在本地页面上真点了三局全程自动对战直到结算，抽牌窗口、结算窗口、"保存录像走无弹窗下载"全部如常；其中一局 225 个动作的完整录像里，41 次抽牌动作和 41 条结果事件一一对应，把整档录像交给回放器跑完，终点局面和实况引擎的当前局面**逐字节相同**。控制台 0 错误 0 警告。

**要坦白的边界**：事件流里从此每抽一次牌多冒一类新事件，这算"可观察变化"——所有界面消费方本来就只认自己认识的事件类型，真机验证无任何渲染影响；但任何未来要"数事件类型"的功能得知道这一类存在。抽牌的**结果序列**完全没变：300 局 AI 压测的输赢分布和上三版逐字一致。建局那次洗牌没有并入结果事件（它发生在对局事件流之外，且录像本来就存了建局后的完整场面，不存在"建局重摇"问题）——这是口径内决定，不是漏网。

**验证**：定稿后五闸一次通过——类型检查 0 错、**305 个测试**（+8 个新锁，38 个文件）、覆盖率地板 42/34/34/47 维持（实测四项 43.79/35.91/35.38/48.95 全部远高于线）、lint 0 错 30 条老警告（中途新添的 3 条已在定稿前清除）、单文件构建 1,920.95 kB；300 局压测分布逐字一致。云端 CI 验证已完成（第 56 次运行全绿，四个检查项——规范、双版本矩阵测试、构建——全部通过，标签 v2.2.22 已上远端）。

**还没做的（按计划挂账）**：D-2 只剩一个观察项（结算窗口 id 与 UI 骰子这两处非引擎路径的 Math.random，刻意不动）；回合结束询问窗口（更早登记）继续等需求；两刀连做计划至此**全部闭环**。

## 2.2.23：降级照旧自动，但从此"留案底"——回放对不上账时不再默默兜底，会报出是哪一步、对不上什么

这次是四点欠账三刀计划的第一刀，动的正是上次外部评审唯一标红的一处：2.2.22 给录像装了"记结果不记重掷"的本事，回放时对不上票会自动退回老办法重掷——这个兜底本身是对的（老录像就靠它才能放），**错的是它一声不吭**。万一哪天录像文件被改坏、或者格式演进后新旧对不上，游戏会照常运行、谁也不会知道账本已经不可信了。评审给的契约八个字：**可自动降级，不可无痕降级**。

**① 从"点头/摇头"到"写明拒签原因"**。以前校验失败只说"不行"，现在精确到三种案底：`COUNT_MISMATCH`（记录的张数和场面的确定性公式对不上——比如记录说从牌堆顶拿 99 张，堆里明明只有 2 张）、`UNRESOLVABLE_KEY`（记录里的牌在当前将池/牌堆/弃牌堆里根本找不着）、`MISMATCHED_SLOTS`（这条记录挂错了人/挂错了环节；**缺记录不算案底**——老录像天生没有结果事件，那是合法身份）。

**② 案底走"带外通道"，账本本身一字不改**。诊断信息不塞进事件流（不然回放一致性、录像文件形态全变了，等于行为变化），而是搭了一趟顺风车：抽牌处理器把失败原因放进本次转移的随身口袋→转移函数的返回值多一个必填字段→引擎容器暂存一步→回放器逐条收集并注明"第几步出的事"。实况对局永远没有注入记录，所以这个口袋**结构上恒空**——原有 14 个随机结果测试和 6 个四路对账测试一字未动全部通过，就是"事件流零变化"的证明。

**③ 每次故障回放只敲一次铃**。回放跑完若有案底，控制台发**恰好一条**汇总警告：几条、都是录像的哪些步骤、各色原因各占几何——不刷屏、不弹窗、不打扰玩家，但查日志的人一眼能看到"这档影像是降级放完的"。

**④ 实验锁+真产档对账**。新增 6 个测试把三种案底逐一钉死（改错什么就报什么、改得漂漂亮亮就零案底、打老录像也零案底）；浏览器里用真实对局引擎链路跑出一盘真人机录像（15 步、7 条结果事件），干净回放不但零案底、**终点局面和实况逐字节相同**；再把 7 条记录的抽牌数全改成 99——回放照样放完（兜底照旧），但案底 7 条、步骤编号一个不落、警告恰好响一次。控制台 0 错误。

**要坦白的边界**：这一刀**零行为变化**——降级逻辑、抽牌结果、事件流形态全部原样，300 局 AI 压测输赢分布与前四版逐字一致；新增的只有"看得见"。另外警告目前住在回放器本体（影像是工具链，没有游戏内消费方）；将来若做游戏内回放界面，案底数据已随回放结果一起返回，界面层想怎么提示都有料。

**验证**：定稿后五闸一次通过——类型检查 0 错、**311 个测试**（+6，38 个文件）、覆盖率地板 42/34/34/47 维持（实测 43.81/35.83/35.31/48.92）、lint 0 错 30 条老警告（零新增）、单文件构建 1,921.55 kB；300 局压测分布逐字一致。云端 CI 验证已完成（第 58 次运行全绿，四个检查项——规范、双版本矩阵测试 311/311、构建——全部通过，标签 v2.2.23 已上远端，本次直连推送一次成功）。

**还没做的（按计划挂账）**：三刀计划之后两刀——v2.2.24 给录像加"身份证头"（ReplayHeader）并裁决老护甲兜底的去留；v2.2.25 给回合结束询问窗口接上业务入口、顺手把观察项全部销案。

## 2.2.24：录像本终于有了"版本页"，护甲"假牌"也不再带时间戳——老录像照读不误，新录像自报家门；引擎又干净了一分

这一刀把稳定期清单上的 D-4 两件事一起办了。第一件：录像文件从此在开头多了一页"版本信息"（schema 版本 + 当时的游戏版本号），就像书籍的版权页。关键是老录像一个字节都不改——没有版本页的旧文件一律按第一版口径只读兼容，读到超出认知的版本号则明确拒绝并告诉你为什么，绝不装懂硬读。第二件：之前将领会掉落一种"已损毁护甲"的占位牌进弃牌堆，它的编号里带着生成时刻的时间戳，导致同一局牌重放两次，弃牌堆里这几张牌的编号居然不一样——虽然不影响任何胜负，但它是引擎里最后一处"不可复现"的污点。我们先把所有产生这种牌的路径盘点了一遍（技能加的护甲本来就没有实体卡，这类占位是合法存在的，不能删），然后把编号改成按位置 deterministic 生成：同一步、同一个牌堆，编号永远算得出来。老规矩验证一切照旧：三百场 AI 对战胜负分布和基线逐字一致，三百一十八个测试全绿，浏览器里真人快放一整局存档，新录像的版本页、旧录像的兼容读、损坏录像的拒绝读，全部当面试验通过。

## 2.2.25：那扇一直"有锁没把手"的回合结束询问窗，终于装上了把手——开窗报得上号、过一人划一人、全过自动关门；它进得了屏幕，进不了存档

收尾三刀的最后一刀。引擎里其实早就有一间完整的"反应室"：谁能参与、谁通过了、按什么顺序表态，账目清清楚楚，可就是没有一扇门能走进去——全库没有一个业务能打开它、也没有一块界面能看见它，这就是交接清单上挂了很久的那条缺口。这一刀把门装上了，而且刻意只装门：从引擎容器递出一根确定性的"窗口编号"（形如 rw:回合:轮次:来源事件:流水号，用的是容器自己的计数器，绝不占牌堆随机数的道），经桥、进 store、到屏幕上变成一条天蓝色的提示带——上面写着"反应窗口开启 · 等待通过"，每个参与的座位一个按钮，点过就打勾，最后一个人通过，窗口自动关闭、提示带随之消失。纪律守得很死：这间屋子的事永远只记在"房间"（容器）和"屏幕"（store 投影）两处，对局状态本体一个字节都不动（测试当场按下快门，开窗到关窗前后快照逐字节相同），所以录像、回放、四路对账这些精密仪器根本没感觉到有人来过；窗口事件也不进录像文件，浏览器里打开活录像逐字检查，一个 reaction 字样都没有。哪些技能该触发这间屋子？那是玩法内容问题，按既定决议继续等立项，稳定期不偷跑。三百场 AI 对战胜负分布照旧与基线逐字一致，三百二十八个测试全绿。观察清单上最后四项也随这一刀全部结案：窗口编号已确定性化销案，UI 装饰骰、房间名默认参数、休眠脚手架三项按证据登记豁免维持。至此收尾三刀全部闭环。

## 评审回合：请"外面那位老搭档"把挂起账本重新盘了一遍——它说：可以收刀了，稳定期正式收官；往后的次序是先把规则书立起来，再按需求长技能，网络继续睡觉（2026-09-25）

三刀收官之后，这次没有让它审代码，而是把整本"还没做的事"清单摊在桌上，请网页版 GPT（1.x 时代的老原作者模型，历轮架构体检的常驻评审）一起重新排兵布阵。流程照旧：三千字的简报逐字转义注入、发送前双侧哈希核对，全程纯文字。它的回信很长，核心是五句话。第一句：**三刀不用返工**——诊断旁路、录像版本页、护甲假牌改正这三件事它都逐项点了头，并且明确说"回合结束询问窗不进存档"不是漏洞而是正确的边界划分，v2.2.25 可以正式宣告稳定期收官。第二句：但它要在契约上再钉一颗钉子——"**窗口可以不录，窗口里的玩家决策不能不录**"：将来谁在窗口里打出了改变战局的牌，那个动作必须走正门进录像，就像开会记录可以不记几点开的门，但决议必须记。第三句：往后干活的次序是——技能规则闭环打头（但**要等第一个真实技能需求出现再补对应的事件**，绝不为凑数一口气造十个空壳；每加一个触发器先填一张十二格的契约表：什么时候响、谁响、响完改什么、进不进录像，全填清楚才算数），然后是构建脚本去网络依赖、**玩家存档恢复的真实回归**（这项它点名"不能再拖"：好档旧档坏档缺档、自动保存、另存为，全套走一遍），UI 小毛病顺手清，平衡手感归产品调优，联网——继续睡，直到真有一天要让两台机器上的玩家对局再开工；现在提前铺的那些"会话、纪元"概念全是假复杂度。第四句：它建议把项目里已有的四种数据正式立个户口：**游戏事实**（攻击/伤害/阵亡——必进录像）、**容器观察**（窗口开关、HUD——不进）、**诊断信息**（只解释为什么走了退路——带外报一声）、**历史兼容**（老占位牌、旧版录像——是文物不是规则）。以后所有"这个要不要记"的争论，先查户口再吵架。第五句，也是它给的总评：这个项目已经从"哪里大拆哪里"毕业了，进入"哪里有真实需求往哪里长"的下一阶段——架构收敛完成，规则层可以冻结，下一刀该切一个由真实技能驱动、可回放、可验证的最小技能闭环，而不是再搞架构大扫除。这一轮只动了文档（交接清单、两份历史、架构地图钉了那颗新契约、立了 D-9 户口表），一行代码没碰，不占版本号；要不要按这个路线开工 2.3，等用户口令。

## 2.3.0：新纪元第一刀——那招写在数据里却从来没生效过的"回刺"，这回真的扎出去了；而且从此"技能没编进去"不再是一声不吭，会报出是谁、为什么

稳定期收官之后，用户授权了 2.3 的五刀连做计划，这是第一刀。选题不是拍脑袋，是盘点盘出来的：全仓库有一个技能**声明了引擎不支持的触发时机、却真实装配在每一场 AI 对战里**——演练技能「演練・回刺」（受到攻击指定时，反弹 1 点伤害给攻击者）。它每次都被编译器悄悄扔掉，扔了也不说，这正是外面评审老朋友定的契约"可以自动降级，不可无痕降级"在装配面的最后一处违例。这一刀双管齐下。第一管：把"成为目标之时"接到引擎**已有**的伤害前通知上——注意是零新增事件，之前担心的"要不要造新事件"经盘点证明不必要：攻击指定目标的路径本来就在发通知，只是没人听。反伤的时序也钉死：先挨打、后反刺，都在同一步动作里结算完，哪怕目标已经死在源伤害下，那一刺也照样落（事件先生成的语义）。第二管：从此编译时任何被跳过的技能效果，都会带外记一笔"某某技能的某某效果，因为某某原因没进引擎"，并只在控制台各喊一次——这个"各喊一次"是被数据教出来的：AI 批量对战每走一步都新建引擎，初版按引擎聚合，三百场下来刷出七百多行；改成按条目去重后只剩九十二行，浏览器里单窗口恰好十四行，一行不多一行不少。另外十二种确实没人用的触发时机，正式从"欠账"改登记为"按需池"——需求来了一个，按十二格契约表填齐了长一个，绝不为凑数造空壳；架构地图上从此有了这张表的专节。因为是设计上就会改变玩法的"内容刀"，胜负基线换了记法：三百场同种子跑两遍逐字节自洽、账本零违例就算过关，胜负总席数这次碰巧和旧基线一样（109:191），但逐势力细账动了（魏的登场阵亡、群的登场阵亡攻击击杀都有个位数变化）——变的这几笔，恰恰就是"回刺"真的在打架的铁证，全部如实登记为新基线。三百三十八个测试全绿，浏览器里两条真机路径都走过：手动驱动一局看全了事件顺序，演练窗真机二十场零违例、零报错。下一刀是这份计划的正文：回合结束询问窗——让"轮到你的技能该不该开"第一次真的有门自动打开。

## 2.3.1：那句写在规则书里很久的话——"回合结束前，你可以先问一问将领有没有话说"——终于真的会问了；而且问归问，账本只记你做了什么，不记那扇门

这是五刀计划的第二刀，也是"内容时代"成色最足的一刀。上一刀修的是"技能没编进去会吱一声"，这一刀让一条冻结在产品规则里很久的话第一次落地：轮到你结束回合时，如果场上有你还没用过的"回合结束时"技能，游戏会先停下来问你一句，而不是替你决定，也不是假装没这回事。设计上有个看起来很别扭、实际上很讲究的决定：**"回合结束"这个事件故意没有接进自动触发的线路**。为什么？因为一旦接上，技能就会在回合结束时自己蹦出来——你的决策权被程序偷走了，而且和询问窗还会重复开火。所以这条路反着修：技能发动是一个堂堂正正的"玩家动作"，跟出牌、攻击同级，走同一扇正门（唯一的转移函数）进录像；引擎收到这个动作后只做一件事——把"发生了什么"描述成事实事件，至于记账（这个技能这回合用过了，不许再用第二遍）全部由结算中心统一落笔，谁也没有第二套改状态的暗渠。拒收的理由也一板一眼：假参数、查无此人、场上没这个技能、不是你管的将、这回合已经用过——五种拒绝各说各话，绝不含混。那扇"询问的门"本身呢？它是 2.2.25 装好的那间"反应室"第一次真的有业务走进去：你按"结束回合"，如果手里有可发动的回合结束技，回合会冻住，屏幕上弹出一条琥珀色的横幅，每个候选技能一个⚡按钮，外加一个"⏭️跳过并结束回合"。按⚡，技能走正门结算；按跳过或干脆再按一次结束回合，视为诚实放弃；多几个技能就一轮一轮问。门开了几次、几点开的，全都不进录像——但你在门里做的每个决定都进。这正是上次评审老朋友钉的那句话第一次实地受检："窗口可以不录；窗口里的游戏决策不能不录"。浏览器里真机点了两遍全程：开窗时回合纹丝不动、发动后台账多一条、手牌多一张、门自动关上、再按结束回合才真的推进；第二遍走跳过路线，账本干干净净。顺带说一句便宜：技能编辑器和 Excel 表格对"回合结束时"这个类型**一行代码都没改**就支持了——下拉菜单里那四个字早就躺在那儿，这次只是把引擎侧的锁配上了钥匙。这刀还有个意外收获：三百场 AI 对战的泡测把一个潜伏的老 bug 泡出来了——抽牌窗口"该问谁"的判断信了二手登记簿而不是窗口本身，特定顺序下会把结束回合卡死；已按"窗体本身才是权威"修掉并上了锁。因为是内容刀，胜负基线换档如实报备：三百场同种子两遍逐字节自洽、零违例，胜席从 109:191 挪到 114:186——挪动的两股力量（新演练技能进装配数组挤歪了随机流、外加那个抽牌窗修复）都写进了账。三百六十三个测试全绿，五大验证门全过，下一件事是按约定把这两刀的成品形态拿去给外面那位老搭档过目——契约表填得正不正、门记账法对不对，它点头之后再开第三刀（存档回归体检）。

## 评审回合：前两刀拿去给"老搭档"过目了——它说：契约立住了，不用再返工，放心开第三刀（2026-09-25，纯 docs 登记不占版本）

这一轮把它当"外部审计"用了一次：把 2.3 前两刀的落地形态写成一份四千字简报（第一刀"技能编译不再一声不吭+回刺真扎了"、第二刀"回合结束会先问一问了"），七个问题请它逐条裁决。它这次给的结果很干脆：**总判定成立，不建议为了这两刀再动结构**。七问里五问直接点头，两问是"有条件同意"：一，"成为目标"这个技能时机暂时借道"受击前"事件没问题，但把话说明白——它现在的真实含义是"目标已定、马上进伤害结算时的目标侧响应"，将来什么时候必须给它单独立一个事件，不看优雅看业务信号（比如出现"只被指定、不受伤也要触发"的需求再说）；二，询问窗不进存档本地完全成立，但要提前钉一句给未来：录像负责恢复"游戏事实和你做过的动作"，不负责恢复"屏幕上曾经出现过那扇门"——等真联网那天，窗口升级成网络协议里的正式角色，也不改这条口径。它还正式采纳了第二刀里最有意思的发现，建议写进分类学：触发器从此分两族——"规则自动发生"的和"玩家获得一次发动权利"的，以后新技能先问这句"该问人还是该自动"；十二格契约表不用加第十三格，幂等和可撤销用"重复防护+最终提交点"两栏说明就够。对第一刀的降噪战绩（三百局从七百多行警告降到九十多行、每条只代表一个真问题）它给了个通用总结：诊断的身份要绑"问题条目"，不是绑"跑了几次"。最后它说这两刀表面是内容刀，实际把项目的分层又钉实了一层：游戏事实走正门，窗口、警告、编译跳过全都留在事实之外——正是上次立的四类户口第一次在真实功能上兑现。这一轮同样只动文档（交接清单记了一条新账、两份历史、架构地图上把三句长期契约钉进契约表一节），一行代码没碰，不占版本号；第三刀（玩家存档恢复的全家体检）按约定开闸，接下来就去做它上次点名"不能再拖"的那件事。

## 2.3.2：给"玩家存档"这件事第一次做全套体检——结果当场揪出两个真毛病：一张烂到骨子里的存档能把安检员自己撞倒；浏览器不让存盘时，"保存并退出"会悄悄吞掉你这局棋

五刀计划的第三刀，也是上次评审老朋友点名"不能再拖"的那件：玩家存档的恢复。盘点的结果先让人心里一沉——这条链路上**一个专属测试都没有**，也就是说你辛苦打了一半的对局，关掉浏览器再点开"继续游戏"，中间那一大串"读档→验货→还原→接着玩"的工序，从来没有人系统地检查过。这一刀补上了八格体检卷（十六道题），每道题的判据就一句话：**要么恢复出来的和存进去的一模一样，要么明明白白告诉你不行并把坏档清掉——最不许的，是一声不吭地把你的档吞了**。

体检卷刚写完，第一只耗子就现了形。验档的"安检员"有个工作顺序上的失误：它在完整检查玩家列表**之前**，就先去逐个登记玩家名册——正常存档没事，可如果有人手滑存坏、或者文件被改得千疮百孔（比如玩家列表里混进一个"空"），安检员自己会先摔一跤。这已经不是"没拦住坏档"，是"坏档能把闸门砸卡住"。修法是改一行顺序：名册必须等查验合格后再登记。第二只耗子更贴近真实生活：这游戏是**一个离线文件**，很多人就是双击 html 直接玩的——而某些浏览器环境（无痕模式是典型）压根不允许网页存东西，一碰存盘键就抛异常。原先的代码是"裸奔"的：结束回合时自动存档如果撞上这种环境，异常会顺着提交链条一路炸上去，**回合结束直接卡死**。这刀给它套上三层护套：存、读、清三个动作各自吞好异常，存失败就老实返回" false"，控制台上每个动作只提醒一声（不刷屏、也不装死）。配套还有人情的两处：暂停菜单里点"保存并退出"，**现在保存失败就绝不退局**——不然点了退出、档又没存上，那局棋就真的没了；界面文案也跟着说真话，"对局已保存"和"保存失败，请稍后再试"从此是两回事。体检卷的最后一格压了个总闸门：整个存档恢复流程从头到尾，系统"另存为"弹窗的调用计数恒为零（这是 2.2.10 那次弹窗挂起事故后立的死规矩，如今有了专门的哨兵）。

因为这一刀号称"不改游戏行为"，验收就用最硬的办法：三百场同种子 AI 对战跑两遍，胜负、每势力细账、账本违例，和上一刀登记的标准答案**逐字节一致**——说明修的全是坏路径，好路径一根汗毛没动。浏览器里也真机走了两遍：一局打到一半保存、刷新、"继续游戏"，回合数手牌分毫不差、接着能打；再故意灌一份烂档进去，菜单老老实实拒绝、把坏档清掉、连"继续游戏"按钮都收了起来，控制台零报错。三百七十九个测试全绿。按约定的判断口径：这次揪出的两个都是"缺陷级"问题而非"契约级"意外，不必再劳驾外面那位老搭档单独过目，五刀收官时合并汇报。下一刀轮到工程杂务：把构建命令里偷偷内嵌的"自动装依赖"拆掉，让"打包"和"装货"各干各的。

## 2.3.3：把"打包"和"装货"拆开——构建命令从此不再背着你偷偷联网装依赖；缺什么，它会明说缺什么（2026-09-25）

五刀计划的第四刀，是全计划里最"小"的一刀，干的却是外部评审早就记在账上的一件事：过去每次敲"构建"，命令都会先自作主张地跑一遍"安装依赖"——联网、可能耗时、还把"装货"和"打包"两件事搅在一起。这刀把它们彻底拆开：构建命令从此只打包；装依赖是使用者自己的明确步骤。

但直接拆开会带来新麻烦：忘了装依赖的人敲构建，会撞上一堆看不懂的报错。所以配了一个二十四行的小哨兵，构建前先把仓库看一眼：依赖目录在不在、是不是空的、打包工具装没装。都不缺就一声不吭放行；缺了就把话说明白——**直接把完整的安装命令打印出来让你复制**，但绝不替你执行。这个"宁可明说、绝不代劳"的脾气，还专门写了五道考题：在一个临时搭的小沙盒里反复扮演"缺这缺那"的仓库来考哨兵，连"空目录里只留了个隐藏记账文件也算空目录"这种边角情况都钉住了（顺带还修了一个测试自身的坑：哨兵认路是看自己站在哪里，考题必须考沙盒里的那份副本，考仓库里的真身会指错门）。

拆完还要确认没有别人依赖这个"偷偷装货"——查了云端流水线的四个岗位，每个岗位本来就自己装依赖，没有一个靠构建命令捎带，所以流水线一行没改，这正好是动手前立的风险预案希望看到的结果。三份"说明书"（README、Agent 须知、发布流水线文档）里提到构建的地方，同一天全部改成新口径，免得下一个人照旧文档踩空。验收照旧用最硬的办法：三百场同种子对战跑两遍，和上一刀的标准答案逐字节一致；构建产物大小和上一刀分毫不差（版本号换了三位数字、哨兵又不会塞进单文件产物，理应如此）。按约定判断：这刀没有任何"契约级"意外（拆装的方案本来就是上次评审定的），不惊动老搭档，五刀收官一起汇报。最后一刀回到用户天天看得见摸得着的地方，做"表面一致性"。

## 2.3.4：收官小扫除——页脚版本号从此出厂即正确；"选格子"的横幅不会再赖到下一位玩家；每个点不动的按钮都会告诉你为什么点不动；还顺手破了一桩历轮的"冤案"（2026-09-25）

五刀计划的最后一刀，把三件挂着很久的"小难看"一次清掉。第一件：主菜单页脚那行 "Qoder V1.28" 从 2.2.1 起就写着"装饰性文案，未修"——版本都跑到 2.3.x 了它还是 1.28。现在它不再手写，改成构建时直接从身份证（package.json）上抄，永远和真实版本一致；而且立了一道"防回归钉"：以后谁再敢在源码里手写版本号，测试当场报红。

第二件是这刀唯一要动点脑筋的：下棋时点"前进"，棋盘会浮出"请选择一个高亮可进入区域"的横幅并把可去的格子点亮——但如果这时候不按套路直接点"结束回合"，这个横幅和高亮会**赖到下一位玩家的屏幕上**。修法是React官方推荐的一种"在动笔渲染前先把上回合的遗留收拾干净"的写法：程序每渲染一次棋盘就看一眼"现在是谁的第几回合"，这个暗号一变，立刻清掉选格状态。挑这种写法还有一段弯路：先试的两种常规写法都被代码检查员（lint）以"钩子规则"为由拒收，最后这个反而是官方正解。

第三件：检视武将的五个动作按钮（前进/近战/远程/补给/叠甲），以前点不动就是灰着，问为什么没答案。现在每个都配了悬浮说明，而且说明是**从判定本身嘴里念出来的**——"整备中不能动""本回合已经移动过""攻击要打一手牌可你手里没牌""体力满着不用补给"……一条都不另编，保证说明和规则永远不打架。

验收照旧走最硬的账：三百场同种子对战跑两遍、互相逐字节比对，和上一刀的标准答案分毫不差——这刀确实一点没碰游戏本身。浏览器里也三处逐一实测：页脚真的显示 V2.3.4；把武将一路走到战场、让"选格子"横幅浮起来、故意不选直接结束回合——换人之后横幅和高亮干干净净消失；禁用的按钮逐个悬停，提示语一字不差弹出来。

顺带破的"冤案"值得单记一笔：前几轮做浏览器自动回归时，多次遇到"AI 玩家像冻住了""骰子转个没完"，当时归因给开发工具的模块热替换。这轮查明了真凶：测试用的那个页签一直被压在用户正在看的网页后面，**浏览器对看不见的页面会把定时器踩到约一分钟才走一格**——游戏没病，是"观众席关灯了，演员动作再快你也看不见"。搞清这一点后回归策略立刻改了：人盯人的自动测试优先开"热座房"（两个座位都是真人点击，不依赖定时器），纯装饰的掷骰子页面则用与按钮完全同源的内部动作直接跳过并如实报备。按约定判断：这刀是纯"表面"功夫，没有任何契约级意外，不惊动老搭档。至此 2.3 五刀全部收官：从"技能说了要做"，到"回合结束真的会问"，到"存档不许吞"，到"构建不代劳"，再到今天"界面不骗人"。（后续补记：云端 CI 已核验第 74 次运行全绿，feat+docs+标签 v2.3.4 顶端一次覆盖。）

## 2.4.0：新纪元第一刀是"大普查"——把 168 条内置技能逐条点名，顺带纠正了一个写错很久的数目字："77 将"实为 95 将；四档分类后 33 条本季就能上场（2026-09-25）

新主线定为"内容量产"：技能这条流水线从 2.1 起一刀一刀建完（编译、触发、结算、回放、询问窗样样都有），可武将技能至今全是光有名字没内容的空壳——真上场时编译器会诚实报告"此技能无实际内容，跳过"。所以量产前，先把家底盘清楚。

这一刀**一行游戏代码都没改**，做的是什么？把 168 条技能逐条过堂，按四条标准分档：**档1（33 条）**——引擎现有词汇就能忠实表达：无非"摸牌/伤害/回血/加护甲"四种动作，挂在引擎认得的八个时机上；每条都写好了施工图（挂在什么时机、执行什么动作、数值多少）。**档2（48 条）**——缺新"动词"（比如弃牌、把牌发给别人）。**档3（26 条）**——缺新的触发时机。**档4（61 条）**——维持纯描述：这个游戏里没有锦囊、判定、装备区、濒死救援这些概念，硬凑只会四不像，诚实不做比假做强。普查同时把"哪些技能是近似、哪些是本项目第一次定义"逐条标注在案——近似就要写明和印象中的原版差在哪，绝不含糊过关。

普查还揪出一笔旧账：历轮文档一直写"内置 77 将"，脚本实测是**95 将**（魏21/蜀22/吴21/群16/晋15）、168 条技能、162 个不重名技能。数目字错在文档里不要紧，要紧的是拿错的基数去做计划——所以正式立更正告示入档，历史记录（写"77"的那些条目）按"历史不回改"原则原样保留。

有个好玩的发现：**晋势力的档1 密度高得离谱（18/30）**，魏蜀吴群加起来才 15 条。道理不神秘——晋将是本项目自创的，没有"三国杀原文"的包袱，定义时直接照着引擎词汇表设计，天然就好实现；反倒是老势力的成名技（吕布"无双"、诸葛亮"空城"这类）依赖本游戏不存在的牌型、判定、距离系统，写不出来才是诚实的。这份"偏科"如实登记在统计表里。

原计划书说第二批按"吴+群+晋"切，普查结果一出就改成"吴+晋"（9 条/24 条两批）——因为档1 扎堆在晋，刀边界跟着内容走，不为凑数重切。顺手还把 2.5 的立项候选按需求热度排好了队：第一位是"弃牌"这个动词（48 条里有 19 条等它）。另外留了三枚"开工先验"哨兵（自己打自己会不会被引擎拒绝、追击技能能不能找对目标、两个势力重名技能会不会打架），下一刀实装时先验证、验证不过就诚实降级，绝不硬凑。

验收走最朴素的账：五道闸门全绿、构建产物与上一版**逐字节同尺寸**（代码零改动的最好自证）、三百场同种子对战跑两遍分毫不差、和上一刀的标准答案（B2 基线）逐项吻合——这刀确实没碰游戏本身。下一刀就开始给第一批 9 条技能"填肉"，它们将第一次真的走上赛场。（后续补记：云端 CI 已核验第 76 次运行全绿，feat+docs+标签 v2.4.0 顶端一次覆盖，且本次直连推送成功、没借道代理。）

## 2.4.1：第一批 9 条技能"填肉"完工——曹操挨打能摸牌了，夏侯惇敢还手了，庞德被盯上会迎头痛击；玩家视角第一次见到"内置武将带着真技能上场"（2026-09-25）

上一刀画好了施工图，这一刀照着图把第一批 9 条技能真正造了出来：魏国 3 条（曹操"奸雄"——受到伤害后摸一张牌；夏侯惇"刚烈"——挨了打对伤害来源还 1 点；邓艾"屯田"——回合结束时可摸两张）、蜀国 4 条（魏延"狂骨"、关平"龙吟"、廖化"伏枥"、祝融"烈刃"）、群 2 条（董卓"肉林"、庞德"猛进"——被瞄准时给攻击者一下迎头痛击）。每条还配了玩家看得懂的一句中文说明，第一次在将面面板上显示出来。

值得一提的纪律：这刀**只往数据文件里填内容，一行引擎代码都没动**——9 条全部被编译器验收通过、零拒绝，说明确实是在现有"词汇表"内老实造句，没有硬凑。剩下 159 条没内容的技能依旧被诚实跳过并在日志里点名——跳过是正常形态，不是遮掩。

给玩家交底两件事。一是**标准答案换版了**：技能上了场，三百场同种子大战的胜负分布从"114 胜/186 胜"轻微漂移到"115 胜/185 胜"，这是内容进局的应有代价，漂移已逐项记账（新基线记作 B3，以后不改行为的版本必须和它对上）。二是**真机演示过关**：在浏览器里手点完整热座对局，庞德和夏侯惇真的带着新技能上场，"猛进"和"刚烈"两记反击都真实打出（录像里逐事件可查），存下的录像版本号也如实写着 2.4.1。

一个细节留了档：关平"龙吟"这种"被盯上时加护甲"的技能，护甲是在这一次伤害结算完之后才挂上的——也就是说它挡不住"触发它的那一下"打，只防后面。这不是 bug，是本游戏触发链的既定时序，像夏侯惇的还手同样在伤害落地后才回敬；已用测试把这个时序钉死，防止将来有人不知情地改坏。

验收照旧全绿：检查零错误、测试从 388 涨到 397 例全过、覆盖率与 lint 稳、构建成功（体积只涨了 1.8 KB，正是这些技能文本的分量）。（CI 状态：待云端核验后补记。补记：云端 CI 已核验第 78 次运行全绿，feat+docs+标签 v2.4.1 顶端一次覆盖，直连推送成功、没借道代理。）

## 2.4.2：第二批 21 条技能"填肉"完工——东吴和晋国的大将们带着真技能上场了；三员"上场瞬间发光"的将领被诚实退回，因为游戏有个"到场才发请柬"的时序死角（2026-09-25）

照着施工图把第二批 24 条造完：**吴国 6 条全部落地**（黄盖"苦肉"——自己打自己一下再摸两张牌，整局游戏第一张"双效果"技能卡；周瑜"英姿"、孙策"激昂"、步练师"追忆"、丁奉"奋迅"、吴国太"补益"），**晋国 15 条落地**（贾充"帷幄"、张春华"慧眼"、邓艾晋版"屯田"、贾南风"戮杀"、乐綝"奋威"等等）。开工前留的两道考题也当场交卷了："苦肉"的自伤路径、"奋威"的连锁反击，编译器和引擎都爽快认账——说明当初画施工图时对游戏词汇表的判断是准的。

这刀最见纪律的地方是**退回了 3 条**：英慧、拓略、奋勇这三条技能写的是"登场那一刻"发动，可游戏的技能注册是"回合开始前、从已在场的将领里点名"——新登场这位的"请柬"还没送到，登场那一刻就已经过去了。这不是技能语义错，是现行时序的死角。按"不发明玩法、不配死载荷"的红线，三条**诚实退回纯描述**，根因写进交接文档，还埋了一根"探针"测试钉死现状：将来谁把时序接好了，这根探针会立刻变红提醒补配。

给玩家交底：标准答案又换版了。三场 300 局同种子大战的胜负分布从"115/185"漂到"**117/183**"（新基线记作 B4，二十一条新技能上场的应有代价，逐项记了账）。真机演示也过关：浏览器里手点热座对局，贾南风、张春华、贾充三位带着新技能真的上了场，下一回合开始贾充卡面亮出 🛡️1——"帷幄"当着你的面发动了；新技能的中文说明在将领头像点开后可见。顺手记下两个小观察：每个营地只能停两员将；登场被"营地已满"挡回去时，武将卡会回到将池而不是丢进弃牌堆——都记进文档待后续核实。

至此 168 条内置技能里 **31 条带上了真引擎**（两批共 30 条技能、含一条双效果），其余 138 条依旧诚实跳过、日志里点名可见。验收照旧全绿：检查零错误、测试 397→**411 例**全过、覆盖率与 lint 稳、构建成功（体积 +4.4 KB，正是这批技能文本的分量）。下一刀是收官核验：让真武将池大规模开战、统计每条技能实际发动了多少次、再完整打一局带三个技能触发的热座局，并顺手给下一阶段（要新"动词"才能做的技能）立个项目建议书。（CI 状态：待云端核验后补记。补记：云端 CI 已核验第 80 次运行全绿，feat+docs+标签 v2.4.2 顶端一次覆盖，直连推送成功、没借道代理。）

## 2.4.3：收官大验收——真武将池 500 局实测"谁的技能真的在干活"，一局完整热座对局从建房打到结算、三条技能当着录像簿发动，录像推倒重放逐字不差；四刀主线就此闭环（2026-09-25）

这一刀不造新东西，专门"验货"。给统计系统装了个小插件（只在明确命令时才开启，平时对胜负数据零影响），然后让**真实武将池**（不再是训练假人）连开 500 局：29 条已配置的技能里 **14 条发动过**——屯田 9 次居首，苦肉 8、垦荒 7、帷幄 6、英姿 5 紧跟；另外 15 条一次没动。查下来不是配错了：没动的基本全是"挨打/打人时才触发"的技能，而电脑随机打法 500 局里统共才出手攻击约 38 次，它们根本没上场的机会——这条判读纪律写进了文档，也写进了给下一阶段的建议书：**要看攻击系技能的真实成色，得换成认真打的策略档位重测**。

真机验收也一次过关：浏览器里手点一局热座对局，四位将领登场行军交锋，曹操挨了打立刻"奸雄"摸牌（两次）、魏延伤人后"狂骨"自愈、祝融远程射穿曹操最后一格血时"烈刃"抽牌——三条技能全部在官方录像的事件簿里留了名，输赢按正规投降流程走到结算页。最后把整份录像喂回播放器从头重放：**终局盘面与实况一字不差**，133 条事件除了"每次重放都会重新生成的时间戳流水号"外逐字相同，重放零降级零告警。这就是"内容时代首个可玩里程碑"的完整证据链：配置→上场→发动→录像→重建，环环对得上账。

给下一阶段的建议书也一并交了卷（排在前面的：先给游戏加"弃牌"这个新动词——48 条二档技能里 19 条在等它；再把"登场瞬间"的时序死角接通，放回归档的 3 条技能；攻击系技能用策略档重测频次；外加一个小瑕疵挂账：近战按钮有时亮着但点了没目标，属展示层问题，下次改界面顺手清）。验收照旧全绿：检查零错误、测试 411→**418 例**全过、覆盖率与 lint 稳、构建成功。至此 **2.4 内容量产四刀全部闭环**（普查分档→第一批 9 条→第二批 21 条→收官核验），168 条内置技能中 31 条带真引擎、138 条诚实待补。下一步是否立 2.5 项目，等玩家口令。（CI 状态：已核验全绿——第 82 次运行在文档提交顶端 2 分 40 秒跑完，功能+文档+标签一次覆盖；直连推送超时，一次性代理成功后没有留下任何持久代理配置。）

收官后还把这套"内容量产"的打法拿去给外部 GPT 评审过了一遍首检（1457 字的简报分 8 批逐字注入、每批对指纹，一条不少；回复 828 字全文取回，归档在仓库外的讨论记录里）。判词是：**形态成立、可以进 2.5**，另附五条加固建议——降档的 3 条"登场"技能将来接线修好后不能自动转正，须过四件验收（重新编译、专项实测、录像重建、确认不扰动老技能时序）；给一档技能加"忠实度"评级（甲=灵魂没动、乙=删了判定但留了意图、丙=只剩皮毛），丙级一律不许进一档；下一阶段的活儿顺序获认可，但"攻击系技能重测频次"要排在触发链路接通之后，否则测了也白测；新增一道"每个技能至少手动点亮一次"的可达性专项——随机实战管"真不真"，强制点亮管"通不通"，两本账不能互相顶替；最后，胜率漂移要分两本账记（内容上新引起的 vs 老系统偏置），眼下 +2 席只是观察信号，不用紧张。

## 2.5.0：新阶段开工第一刀——给游戏添了个新动词"弃牌"，司马懿"反馈"与蔡文姬"断肠"两条技能就此上场；按评审建议给技能标了"忠实度"，胜负基线罕见地一格没漂（2026-09-25）

玩家口令一声"继续"，2.5 阶段五刀正式开工。第一刀干的是上一份建议书里排头号的事：**给游戏加"弃牌"这个新动词**（48 条等着它的技能里最急的 19 条就此解渴）。按评审定下的新规矩，动刀前先把这个动词的"十二格契约表"填进架构地图——什么时候触发、谁弃谁的牌、牌去哪、要不要掷骰子、录像怎么重放，一格一格写清楚再写代码。这规矩是头一回用在效果原语上（老的四个动词是先有代码后立的表）。

新动词的脾气值得说道两句。**弃哪张牌不抽签**——永远从手牌最前面按顺序拿，电脑不掷骰子，回放就能逐字节重演；**手上没牌也不装死**——"弃牌"这件事照样记进事件簿（触发是真的发生了），只是没牌可弃，诚实空转；**弃掉的武将卡回将池、资源卡进弃牌堆**，跟搬家、补给走同一条路。还有一条细账：这个"弃"是记在**玩家**头上而不是某个武将身上——蔡文姬的"断肠"就是靠这个才成立：她自己都战死了，害死她的那位照样得把牌弃光。

两条新技能上场。**司马懿"反馈"**：谁打他谁弃一张牌。这条按评审给的"忠实度"评级标了**乙级**——原技是"拿过来"（还得有牌的转移动词，排在后面几刀），现在诚实做成"你弃掉"，意图留住了，灵魂差一手，表上写明白。**蔡文姬"断肠"**：击杀她的攻击者弃光手牌，标**甲级**（本游戏没有手牌上限概念，原文的判定条件天然免除）。有意思的是**三条明明"够得着"的技能被评完退回去了**：魏国曹仁"据守"要"弃牌和摸牌绑成一次发动"（现在的引擎两件事是两封信）、晋国王异"贞烈"要"先弃后给的门槛判定"（做成无条件弃一还一等于白送血，违反不发明玩法红线）、吴国孙权"制衡"要"弃几张摸几张玩家自己定"（固定数字会把玩法做歪）。宁缺毋滥，账都记在案。

给玩家交底两件事。一是**标准答案这次几乎没动**：三百场同种子大战还是 117 胜/183 胜——和上一版**一格都没漂**。别误会成没干活：两条新技能是"挨打/打死"才触发的，电脑随机打法本来就很少出手（上一刀已经查过这笔账），所以没漂是已知原因、如实记账；真正的成色检验排在收官刀（每条技能强制点亮一次+换认真打的策略档重测）。二是**真机演示半过关、半交底**：浏览器里手点热座对局，蔡文姬死后"断肠"当着录像簿把对手 14 张手牌弃到 0 张、弃牌堆和将池的账一笔不差；但司马懿是魏国将，两人房抽签没抽到魏——**"反馈"这刀没能在真人面前点亮**，它的证据目前只有自动化对账那一层，真机补验写进了收官刀的任务单，不含糊。

验收照旧全绿：检查零错误、测试 418→**431 例**全过、覆盖率与 lint 稳、构建成功（体积 +1.4 KB，就是新动词这点钢材的分量）。168 条内置技能里现在 **33 条带真引擎**、136 条诚实待补。下一刀去啃"登场瞬间"那个时序死角——按评审的规矩，那刀只接线、不转正，修没修好要用老局重跑来证明（新基线记作 B5，不改行为的版本必须和它对上）。（CI 状态：已核验全绿——第 85 次运行覆盖 feat+文档+标签 v2.5.0 顶端一次跑完；直连推送遇连接重置，一次性代理成功、没留任何持久代理配置。）

## 2.5.1：补上了"到场才发请柬"的时序死角——登场类技能从此真能响了；这一刀只接线、不转正，老战局一格没变就是铁证（2026-09-25）

上一刀末尾留的账，这一刀来还。此前有个死角：武将在"登场"那一刻，引擎先把登场这件事记进了事件簿，**之后**才给这位新到的将领登记技能——好比宴会请柬在他落座之后才发到手里，"登场瞬间"该响的技能永远听不到自己到场的那声锣。三条晋国技能（英慧、拓略、奋勇）因此上一批被诚实退回，只留名字不带引擎。

这一刀把请柬的次序改了：**登场结算完立刻补登记技能，并把"他到场"这条消息重新递一遍**——新将领的监听器从此赶得上自己的登场。改动很克制，三处接线：引擎开了一扇"补登记"的小门（没这扇门的老调用方行为一字不变）、开局引擎把这扇门的把手接上自家的登记器、登场那一步结算后多走一遍触发链。还有个细节值得说：怕的是"同一句登场词被响两遍"，但每个技能都钉死了"只认自己这位将领"，老监听器本来就没到场过，重放只可能命中刚登记的新那一位——天生响不重复。顺带在测试里钉下一条老牌规：**武将进场的血量=他消耗的牌数**（一张成本牌进场的将领就是 1 血），这是这次做对账测试时才当面确认的引擎事实，如实记档。

**接线不等于转正**——这是评审定的规矩，本刀守得很严：三条技能依旧留在纯描述名单里，账本上 33 条带引擎/136 条待补**一个数都没动**。为什么能这么肯定？因为三百场同种子老战局重跑，胜负还是 117/183、逐势力账、事件流水**逐字节和上一版对得上**——这不是运气，是证明：既然没有任何在用的技能依赖"登场瞬间"，接线这刀就不该改变任何一局的走向；真变了反而说明碰坏了别的东西。转正（把那三条技能真配上引擎）排在下一刀，还要过四件验收：重编译、真机热座点亮、录像重建逐字、时序不回归。

测试上有一处翻正的讲究：上一批留的"活性探针"本来是**负例**（证明登场技能打不响），这刀把它换成了**正例**（证明恰好响一次、且下一回合不会双响），再加一条四路径逐字节对账的新例——测试总数 431→**432 例**（净 +1，两换一）。其余照旧全绿：检查零错误、覆盖率与 lint 稳、构建成功。真机演示这一刀**没有**：玩家能感知的玩法触点为零（没有一条在用的技能走这条路），逐字节铁证已经替它说话，真机点亮随下一刀转正一起做，账目不装花。下一刀就是把英慧、拓略、奋勇三条转正的内容刀（新基线记作 B6）。（CI 状态：已核验全绿——第 87 次运行覆盖 feat+文档+标签 v2.5.1 顶端一次跑完；直连推送超时，一次性代理成功、没留任何持久代理配置。）

## 2.5.2：那三位"上场瞬间该发光"的晋国将领正式归队——英慧、拓略、奋勇带回了真技能，并且当着录像簿的面三位都亮了灯；老战局胜负席位一格没挪，但账细看确实变了样（2026-09-25）

上一刀把"到场才发请柬"的时序死角补上之后，这一刀就该兑现承诺了：把当初因那个死角被诚实退回的三条技能请回来——王元姬的**英慧**（登场摸两张牌）、杜预的**拓略**（登场获得 2 点护甲）、文鸯的**奋勇**（登场摸一张牌）。三条技能按当初施工图上的原样配装，引擎一行没改，编译器三条全收、零拒绝。至此那份"降级欠条"（§12-26）连本带利全部还清。

转正不是嘴上说说，评审定过四件验收，这次一件件当面点清：**其一**，全量重新体检，434 项测试全绿；**其二**，真机点亮——在热座房间里真人真点，把三位将领挨个登场，录像簿里清清楚楚记下三次"登场瞬间"的技能事件：杜预落地护甲值变 2（卡面上 🛡️2 肉眼可见）、王元姬落地手牌多 2、文鸯落地手牌多 1，一条不缺；**其三**，把这条登场链路按四种引擎走法各跑一遍，事件流水逐字节相同（意味着录像推倒重放必然一模一样）；**其四**，所有旧技能的时序对账测试原封不动全绿——没有因为新人进门碰坏旧家具。

顺带在真机操作里挖出两条宝贵的"操作手册级"经验，记进交接文档供以后自动化使用：一是**凡是"要花钱"的动作（前进、登场这类消耗牌的操作），必须先从手牌里点一张付账，之后的点击才真正生效**——这一刀开头连续三次点"前进"没反应，查到底就是这个原因，不是游戏坏了，是账没付；二是**录像里技能事件的明细藏在 `data` 小袋子里**，按顶层字段去筛会一条都筛不到，白白虚惊一场。

胜负基线这本账有个耐人寻味的地方：三百场重跑，双方总席位仍是 117/183，**跟上一版一格没差**——但翻开逐势力明细，群和晋两列实实在在变了（晋将登场次数、阵亡数、胜负都有小幅移动），魏蜀吴三列则一字不差。总账没动、细账变了，说明新技能真在局里干活、只是暂时没改变大盘倾向。这条"总数相同绝不等于什么都没变"的教训专门立了档——以后看内容刀的漂移，必须看逐势力明细，不能只瞄一眼总席位就下结论。技能触发统计也第一次让这三条名字出现在报表里（奋勇 11 次、英慧 11 次、拓略 5 次），从"降档欠条"到"记账可见"，三步闭环。

其余数字：全库 168 条技能里带引擎的到 **36 条**、纯描述的还剩 133 条；测试 432→**434 例**；构建产物体积微涨（就是三段新文案的重量）。下一刀去做"发牌给别人""牌被拿走时触发"这类新触发族（依然是先填契约表、后动刀），之后就是 2.5 收官核验加 GPT 二次评审。（CI 状态：已核验全绿——第 89 次运行覆盖 feat+文档+标签 v2.5.2 顶端一次跑完；这次直连推送就成功了、没借代理。）

## 2.5.3：字典里新添了一个动词"发放"，还开了一对耳朵"失去/获得手牌时"——这一刀只铺管道不放水，老战局一格没变就是铁证（2026-09-25）

这一刀是给引擎的词汇表扩充的：新动词**发放（GIVE）**——把自己的手牌整张交到另一个玩家手里（牌就是牌，武将会卡牌也照样直接进对方手牌，不搞回池特殊化）；一对新耳朵 **onCardLost / onCardGained**（"失去手牌时/获得手牌时"）——牌一过户，双方玩家都会听到对应的一声响，谁的技能挂着这两条触发就能应声而动。老规矩：十二格契约表先填完才动代码（这次填了两张：发放原语一张、新触发族一张，表格进架构地图）。

几个讲究点。**其一**，"响一声"这件事是刻意收紧的：目前只有"发放"会派生这两条提示事件——弃牌、登场、消耗虽然也会让手牌变动，但都**故意不响**。这不是漏了，是怕一口气放开派生面把老战局搅动；等哪天真要把连营、枭姬这类"丢牌触发"的技能转正，再单独给每个事件源填表立项。**其二**，牌进的是"玩家"的手而不是"将领"的手，所以这对耳朵听的是玩家的动静，不追问是哪张将令传来的——上次弃牌原语学的教训直接用上了。**其三**，发放同样带五道"诚实空转"闸门：给自己发、发给不存在的人、发给已阵亡的人、自己手里没牌、载荷残缺——统统不报错、账本如实记"发生了但没动"。

因为是纯接线不放内容，老战局必须一格不变：300 局重放对 B6 基线**逐字一致**（胜负席位 117:183、五个势力的明细账全部吻合、同种子跑两遍除计时行外逐字节相同）——这次连"逐势力分账"的余地都没有，因为内置 168 条技能一条新载荷都没配，账本还是 36 条带引擎/133 条纯描述。测试 434→**442 例**（新增 8 例：单元四门闸、编译两条、Excel 标签一条、全链路对账两条——含"发放→摸牌回应"四路径逐事件一致和"弃牌不派生新事件"的反面钉）。真机点击本轮如实不占：没有玩家能碰到的新触点，等发放类技能转正的内容刀再上真机。下一刀就是 2.5 收官核验刀：逐技能强制触发可达性专项（把反馈的真机欠账一并补上）+ 策略档攻击链重测 + GPT 二次评审。（CI 状态：全绿——#91/#92 两个 run 均在登记提交 06994a6 上completed successfully，直连推送成功未借代理）

## 2.5.4：收官大验收——给每条款过的技能都"强行递了扳机"确认没有哑弹，换上聪明的 AI 重测 500 局证明上次 15 条"零触发"是冤枉的，还在真人牌桌上把司马懿的"反馈"当场抓了个现行；老战局依旧一格没变，2.5 五刀就此全部闭环（2026-09-25）

这一刀不添新东西，专门做体检，三件事加一场补考。**第一件：可达性专项**。之前 500 局审计里有 15 条技能一次没响过，虽然分析说"不是坏了，是随机 AI 太笨不打人"，但口说无凭——这次换了个粗暴办法：给全部 36 条款技能的技能逐一"强行递扳机"（人为造出它该听的场面），看它是不是真会应声。**结果 36/36 全响，一发哑弹都没有**。这套检查以后常驻在测试里，谁再配技能配出个"永远打不到"的，测试当场报警。

**第二件：聪明 AI 重测**。给对战命令行接上了策略档位开关（`--policy 均衡/激进`），拿和上次完全相同的 500 局种子重跑。这回 AI 真的会打架了：上次数出来的 15 条"零触发"**全部开到了工**——34 条出场技能无一例外都触发过，最少的"断肠"也响了 1 次（它条件本来就刁钻：得自己战死、而且凶手手里还得有牌）。上次的判读"暴露不足、非配置错"就此**平反昭雪**，白纸黑字记进架构地图。顺手说一句：激进档下两边胜负更接近对半（247:253），说明 AI 会打架之后座位劣势变小，这是健康信号。

**第三件：反馈补考**。2.5.0 那会儿司马懿的"反馈"因为随机建房抽不到魏国将，真机验证欠了一账。这次专门开了张热座牌桌，真人一步步点出"姜维远程射司马懿"——司马懿中箭后"反馈"应声发动，反手弃掉姜维一张手牌，账本上伤害、触发、弃牌三条事件一字排列，手牌数逐张对平。**至此 2.5 期间所有欠的真机账全部结清**。

老规矩：这刀不碰游戏内容，所以 300 局老战局必须原样重演——对 B6 基线**逐字一致**，铁证达成。测试 442→**448 例**（新增 6 例：可达性专项 5 例+策略档透传 1 例），五道门禁全绿，构建产物体积和上一版**逐字节相同**（因为这刀改的都是"看戏工具"，没碰戏本身）。（CI 状态：全绿——CI #94，run 36157325427，master@64bfdf7 completed successfully，功能+登记提交与标签由同一次顶端运行全覆盖；推送为直连超时后一次性代理推主分支、标签直连重试成功）

**GPT 二次评审（补记 2026-09-26）**：三份体检报告按老流程（¶ 哨兵+数字码分批注入、逐批对账）递给 GPT 复判，1515 字一次注入完整通过；小插曲是对方界面把长消息折叠、头一回没答 Q5，单独补发一记 Q5 后拿回完整五问。结论白话版：**Q1 体检合格但别吹太**——只能说"量产这套方法验证过、能外推"，不能写"往后所有技能都不用添新零件"；**Q2 给了 2.6 的顺序**——先做装备区、再牌堆顶、然后补卡牌事件源、再开玩家决策通道、花活的（自定义条件、每局限一）往后放；**Q3 点名表扬了"够用就收手"**——发牌类只接现在真需要的，弃牌类等连营枭姬这样的真实内容来拉动，不为了理论好看提前铺；**Q4 决策通道要单独立一层**——先把"弹窗→列出合法选择→玩家或 AI 选→结果回账本→日志可复现"这条最小闭环走通，别跟某批技能转正绑在一起；**Q5 平衡问题先不立案**——目前三个胜率数字只说明"档位之间有差"，先把 57%/50%/≈61% 记在案头当基线，等 2.6 内容真进去后同口径再看，连着多刀同向恶化才升格专项。一句话收官定调：**2.5 验证闭环成立；2.6 优先补能力缺口；平衡暂观察、不抢跑**。

## 2.6.0：2.6 开工第一刀——给引擎添了个新动词"扒装备"，顺手把两个靠它吃饭的技能（典韦「强袭」、董卓「崩坏」）正式装上了（2026-09-26）

上一轮请 GPT 帮忙排了 2.6 的动手顺序，头一件事就是"装备区"。这个回合就把它做了。装备在这个游戏里其实就是挂在武将身上的"护甲牌"（没有单独的装备栏），所以新动词**扒装备（EQUIP_STRIP）**干的事很直白：从某个上场武将身上的护甲牌里，按老规矩从**最上面**揪走几张——是资源牌（材料、补给）的扔进弃牌堆，是武将牌的回手到池子里，每揪走一张护甲值就实打实掉一点（掉到零为止、不会掉成负数），护甲牌被扒空了这名将就不再算"披甲"状态。

**一个讲究点**：以前的动词（弃牌、发放）都盯着"某个玩家的手牌"，这次是头一回盯着"某个上场武将"——因为牌挂在人身上不在手里。要是这名将恰好被这一击打死了、已经下场，那就"人死不能扒甲"，老实什么也不做，但账本上照样记一笔"这个触发动过了"（诚实空转）。另一处刻意收紧：这次**不设置"一键全扒光"的特殊口令**（弃牌那边是有"0=全弃"的），差别的道理先记在架构地图里，等以后有真需要再补。还有个"忍手"：本来装备被扒可以顺带喊一嗓子"有牌没了"（让别的技能响应），这一刀**故意不喊**——那是下一刀（补卡牌事件源）的活，按 GPT 说的"等真内容拉动再做，不为理论好看提前铺"。

装上两个技能：**典韦·强袭**——你打人后顺手扒对方一件装备，这条几乎照原意搬（保真度高）；**董卓·崩坏**——别人拿牌指你时你自己掉一件装备，原文有个"只认基本牌"的挑拣条件，这次放宽成"只要成为攻击目标就应"、而且扒装备发生在伤害之后、不抵消这次伤害（保真度中等，差异都写进了表格）。内置技能总数不变（还是 168 条），但从这次起带真引擎的从 36 条涨到 **38 条**、纯挂着名字的剩 131 条。

老规矩验收：添了新玩法内容，所以 300 局老战局**允许**变——但这一版把 B7 基线钉死成和上一版 B6 **一模一样**（117:183，连魏蜀吴群晋五个势力的细账都一分不差），因为典韦董卓是低频将、随机 AI 又打得保守，这俩技能在老战局里几乎没出手（崩坏响 3 次、强袭 0 次，属于"露脸少"不是"配错了"，跟以前一个口径）。测试从 448 涨到 **453 例**，五道门禁全绿，构建产物比上一版大了约 1.85 kB（新动词加两条技能的文字进包里，内容刀的正常涨幅）。真机也在热座牌桌上点了一遍：完整的"出牌→伤害→扒装备"事件链一条条排出来、护甲扣减和牌的去向逐张对平。**下一刀做 2.6 顺序里的第二项——牌堆顶操作**。（CI 状态：全绿——GitHub Actions CI #97，run 36173569557，master@191c531 completed successfully；功能提交 2a1bf39 + 登记提交 191c531 + 标签 v2.6.0 由同一次顶端运行全覆盖；本次直连推送主分支与标签均成功、未借代理）

## 2.6.1：本来说好要给"牌堆顶"添内容的，验完货发现五张牌全都不够格——于是这一刀只装了两台"新机器"，一张牌都没配（2026-09-26）

按 2.6 的排队，第二刀该做"牌堆顶操作"，候选是五个技能：诸葛亮的观星、甄姬的洛神、马谡的心战、马良的自书、张春华的秘置。开工前照老规矩逐条对着引擎的"词汇表"验了一遍能不能忠实配上——结果**五个全不行**：观星、心战、自书、秘置四个都要玩家当场做"看一眼、挑一挑、排一排"的决定，而这种"弹出选项等玩家选"的通道要到第四刀（choice 决策通道）才存在；洛神要掷判定牌看花色，可咱们这个游戏压根没有花色/判定这一面。硬凑个近似数值配上去，就是给游戏发明新玩法——红线。把这个发现摆给用户看，用户点头改口径：**这一刀只接机器、不上货**。

装上的两台"机器"就是两个新动词。**观顶（REVEAL）**：偷看牌堆最上面 N 张——有意思的是它是全部九个动词里头一个"看了白看"的：看完牌堆纹丝不动、连随机数的游标都不拨一下，但账本上照样记一笔"某某看了几张"（录像里能回看这一手）。**置牌入堆（DECK_PLACE）**：把手里的牌塞回牌堆，可以指定放**堆顶**还是**堆底**（默认堆底）——从手上按最上面拿、放回去也不分什么材料牌武将牌，全都物理留在牌堆里，跟"抽牌"从同一头读，账目干净。编辑器里也加了配套的"放置位置"下拉；两处小口子如实登记：Excel 表格那套六列没有"放哪"这一列（导来导去默认堆底）、编辑器数字框最小填 1（"把手牌全塞回去"这种 0 口令暂时只能从代码里配）。

因为是"只接机器不上货"，五个技能继续挂着纯名字（老样子在日志里诚实报"没配引擎"），内置账本 38 条带引擎 / 131 条纯名字**一格没动**。验收的铁证也按非内容刀的规矩来：300 局老战局跑三轮，胜席 **117:183 和 B7 基线逐字一致**，五个势力的细账全分不差——新动词装在引擎里，但没有一张牌用它们，所以什么都不会变，这正是要证明的。测试从 453 涨到 **462 例**，五道门禁全绿；真机把编辑器点了一遍：选观顶冒出"观看牌堆顶"预览、换置牌入堆"放置位置"下拉出现、默认"牌堆底"、切"牌堆顶"能挂住——看完关掉不保存（保存的持久性由自动化测试负责）。那五个技能的去向也写进了架构地图：机器已就位，等第四刀 choice 通道落地后再谈转正（洛神维持纯描述）。**下一刀补"卡牌事件源"，并把陆逊「连营」、孙尚香「枭姬」两条真正够格的转正进来**。（CI 状态：全绿——GitHub Actions 第 99 次运行，run 36199581600，在登记提交 d8e703c 上 completed successfully；功能提交 0040147 + 登记提交 d8e703c + 标签 v2.6.1 由同一次顶端运行全覆盖；本次直连推送主分支与标签均成功、未借代理）

## 2.6.2：装好的"耳朵"终于开始听声了——谁丢了牌现在会喊一嗓子，陆逊「连营」和孙尚香「枭姬」两条真技能据此归队（2026-09-26）

去年冬天（2.5.3）给引擎装了一对耳朵，专门听"有玩家失去/获得手牌"，但当时只接了一个声源：只有"发放"这个动作会让牌丢了算丢。耳朵装着却没声，叫"接线≠可用"。这一刀把声源补齐：**弃牌**丢了要喊（还顺带报"喊完之后手里剩几张"）、**装备被扒**也要喊（这条特意不报手牌数——装备不是手牌，装不知道就别装知道），而"从牌堆抽牌""把牌塞回牌堆""武将阵亡弃光"等等场景依旧**刻意不喊**，哪些不喊清单钉死在架构地图的表格里，以后谁想加必须先补表再动手，防止哪天稀里糊涂响出一片。

耳朵接上后，两条早就验过够格的技能正式归队：**陆逊·连营**——手里最后一张牌一旦丢掉就摸一张（原档就这么写的，一字不差照配，保真度最高档）；**孙尚香·枭姬**——自己的装备牌被人弄丢一张就摸两张（同样高保真）。内置账本从 38 条带引擎涨到 **40 条**、纯挂名的少两条剩 129 条。中间还踩出一个语义细节值得记：编辑器里"失去最后一张手牌"这种勾选和引擎内部用来筛事件的三个过滤词是**两套词汇**，桥接口径写死成"只查事件账本上已经记下的事实、绝不做二次推断"——正因为枭姬那条装备丢失的喊话里故意没写手牌数，"失去最后一张手牌"的耳朵天然不会被装备声误撩，这不是漏洞恰恰是语义正确。

老战局 300 局照跑，新基线 **B9 钉死为 117:183——和 B7 连五个势力的细账都一格没动**。这个"零漂移"不藏着掖着：连营枭姬走的都是"丢到最后一张/装备被扒"的窄路，随机 AI 的老战局里本来就撞不上几回，跟之前崩坏/强袭一个判读——露脸少不是配错了，真正的暴露度检查押给最后一刀的策略档重测。这一刀的硬证据在别处：自动化里让四个武将同台大戏，强袭扒装备当场喂枭姬摸两张、击杀断肠将当场喂连营摸一张，常驻引擎/桥接/重建对账/录像回放四条路每一步事件逐字一样，外加一对"该沉默时必须沉默"的反例；真机牌桌上也把这两条链逐事件抓了现行（受控摆场面走的是官方授权的重置入口，全程没点保存）。测试 462→**466 例**，五道门禁全绿，包大了约 2.7 kB（新线路和两条技能的文字进包，内容刀正常涨幅）。**下一刀做 choice 玩家决策通道最小闭环**——那台"弹出选项等玩家选"的机器，落地之后观星那几个候选才有资格回来谈转正。（CI 状态：全绿——GitHub Actions 第 101 次运行，run 36204359196，在登记提交 2c8b0a3 上 completed successfully；功能提交 d1acb3e + 登记提交 2c8b0a3 + 标签 v2.6.2 由同一次顶端运行全覆盖；本次直连超时、经一次性本地代理推送主分支与标签均成功、未写持久配置）

## 2.6.3：把"弹出选项等你选"这台机器装好了——账没清之前整个牌桌都不许动，选完才继续（2026-09-26）

这一刀做的正是上一刀预告的那台机器：**玩家决策通道**。以前技能要么闷头自动结算、要么干脆配不了（"选一个角色""挑一张牌"这类要人拿主意的玩法全卡在这）。现在引擎有了完整的一条路：**开一个账（窗口）→ 把合法的选项列出来 → 等欠账的那个人选 → 选完的结果记回账本 → 录像里每一步都能复现**。这条五步路是请 GPT 二次评审时定下的验收口径，这次原样走通。

最有意思的设计是"**冻结世界**"：只要有一笔"等你选"的账挂着，牌桌上**别的什么都不许发生**——谁按结束回合都被老实拒绝（"先选完再走"），连回合都不推进；但只有**欠账的那个人**能响应这个窗口，哪怕现在根本不是他的回合（择一这件事不该被出牌顺序绑架）。选定了，被挑中那一支才照常结算——也就是说"摸两张还是拿护甲"这种账，**在你点下去之前一张牌都不会动**。这些窗口账本全部走的是引擎正门（和 UI 按钮同一套动作），录像里一条不少、也一条不多。

按红线办得很干脆：**这一刀一张牌都没配**。观星、心战、自书、秘置这几个等着这台机器的技能，还有"把牌发给任意一个人"那类，这次**一个都没顺手转正**——GPT 点名禁止"借批量转正"，机器归机器、货归货，转正要逐条对着原档验忠实度，留给后面的内容刀。内置账本 40 条带引擎/129 条纯名字一格没动；也正因为内置没人用新机器，300 局老战局**逐字验货通过**：胜席 **117:183 和 B9 基线一桌一笔全分不差**（两轮跑出来除了计时行完全相同），这正是要证明的"零行为变化"。

机器装了自然要真机转一圈：在热座牌桌上用官方动作链建好房间打到开局，挂上一笔"二选一"的账——屏幕上真长出"◈ 选项1 / ◈ 选项2"两颗按钮；先点⏭️结束回合，**回合数纹丝不动**（冻结世界生效）；点选项2，账清、手牌落账、按钮消失；再点结束回合，牌桌恢复流转。测试 466→**479 例**（新增三份专门考这台机器的卷子：解析器七例、store 层三例、四路对账一例——对账那例把"两次被拒绝的操作"也排进了剧本，因为**被拒绝的动作同样进录像**，这是本轮挖出的又一个引擎事实）；五道门禁全绿，包大了约 6.6 kB（事件族+校验/解析分支+选项文案进包）。有个诚实注脚：账本目前是**一个槽**，同一瞬间两笔"等你选"会撞车——好在"冻结世界"天然把它们排成了队，将来若真出现"一次性选多件事"的需求，得先改架构地图的表格再动刀。**下一刀是 2.6 收官刀**：可达性专项+策略档重测（把连营/枭姬/崩坏/强袭这些"露脸少"的账一次查清）+完整热座局+录像逐字，并按约定请 GPT 做三次评审、出 2.7 建议书。（CI 状态：全绿——GitHub Actions 第 103 次运行，run 36220592167，在登记提交 5737ade 上 completed successfully；功能提交 d2f926f + 登记提交 5737ade + 标签 v2.6.3 由同一次顶端运行全覆盖；本次直连推送主分支与标签均成功、未借代理）

## 2.6.4：2.6 收官大验收——给"弹出选项"这台机器把十个开关全按了一遍确认每个都灵，换上聪明 AI 重跑 500 局清欠账，真牌桌从开局打到终局、录像推倒重放逐字不差，并请老搭档做了三次评审；它说：可以收官，2.7 的九件事都排好了（2026-09-26）

这一刀是 2.6 的收尾验收，**一行引擎代码都没改**——最硬的证据是：打包产物和上一版**逐字节一样大**。改动全在三件事上：加考卷、跑实测、写建议书。

第一件，**新机器全开关体检**。上一刀装好的"弹出选项等你选"，这次给它的十个触发开关**挨个按了一遍**：每个开关都合成一条"二选一"技能丢进去，验它能不能开出一张真账、账挂着时牌桌是不是真冻结、欠账的人选完是不是只落选中那一支。十二例新考卷全过，测试 479→**491 例**。第二件，**欠账清零**。之前 500 局里"露脸太少没法验"的六条技能，换上两档聪明 AI 各跑 500 局重测，四条抓到现行；剩下连营/枭姬还是零次——结论是这两条的触发条件跟随机打法**交集太窄**，不是装坏了（可达性体检证明机器本身是灵的），老搭档也认了这个判读。第三件，**真牌桌全程+录像逐字**：一局完整热座对局从建房一路打到终局，录像簿 11 笔动作 47 条事件，推倒重放后与实况**每个字都对得上**、零降级告警。

过程中挖出一个**观察项**记进账本：商店（界面层）偶尔会让实况快照带上"界面方言"（比如把阶段名写成 MAIN 而引擎正字是 ACTION）——但**游戏事实一个字段都没变**，重放路径也永远不受影响，所以实况↔录像的逐字对账依然成立。请老搭档裁了，它的结论：不算 2.6 的返工，升格成 2.7 的治理项（把"哪些字段是事实、哪些是界面"的边界钉死并加回归锚）。

第四、五件是纸面收口：**2.7 建议书九项**写进架构地图（报表键定、事实契约治理、choice 生产者扩面〔先打"只接线不带内容"的最小验证刀〕、自定义条件、每局限一次、多槽账本、装备流失语义裁决、积木语法表、平衡监控），用户此前点名的两案——技能积木自由拼接的语法表、同势力同名将领"内容层允许+装配层唯一"——都转录在案；**GPT 三检**五问五答全文归档，总评一句："三检不阻断 v2.6.4 收官"。它还给收官句划了红线：只能说"2.6 完成了一个真实能力周期的验证、方法可外推"，**不许写**"后续技能可直接批量转正"。

老战局照例逐字验货：300 局胜席 **117:183 与 B9 基线一桌一笔全分不差**（两轮除计时行完全相同），五道门禁全绿。**至此 2.6 五刀（扒装备→牌堆顶机器→装耳朵→选项机器→收官验收）全部闭环**。下一步就是等你口令立 2.7，按九项序开工。（CI 状态：全绿——GitHub Actions 第 105 次运行，run 36224245104，在登记提交 3d5ec30 上 completed successfully；功能提交 f6bee82 + 登记提交 3d5ec30 + 标签 v2.6.4 由同一次顶端运行全覆盖；本次直连推送主分支与标签均成功、未借代理）

## 2.7.0：2.7 开工第一刀——把技能成绩单的"学号"从只写名字改成写"学号+名字"，从此同名不同人不再混账；改之前先取证：老办法在 60 局里一条都对不上（2026-09-26）

你说"进行 2.7"，九项建议书就正式开工了。第一刀是最小的一件：**报表键定**。

先说清楚这是在修什么。跑一批 AI 对战后有一张"逐技能触发频次"成绩单：哪些技能在这场里被用过、用了几次。以前这张成绩单**只按技能名字记账**，而游戏内部给每个技能挂的编号里，前缀是"这一张牌的临时身份"——那个身份每次洗牌发牌都会变（同一批跑测里能看到三种写法：按座位改名的、按随机种子编号的、界面编辑器生成的）。名字对不上号，成绩单上的"配置了哪些技能"那一栏就永远查不到人。

我先用 60 局实测把这件事钉死再动手：**老办法命中 0 条**。不是技能没触发，是**钥匙拿错了**。

改完的办法：记账前先看一眼当前的花名册，把那些临时身份**翻译回将领的正牌编号**，于是成绩单上的键变成 **`将领编号:技能名`**。有两个细节值得说：
- 花名册是**边打边攒**的，不是每步重拍快照——因为有的技能在主人已经下场之后还会触发（阵亡连锁），只 lookup 当下在场的人会漏。
- 翻译不出来的，**照原样写上去**，让它在成绩单上变成一条"查无此人"的显眼行，绝不悄悄抹掉。

顺手拿到一个你要的裁决的前置证据：**同势力同名将领**。魏国的邓艾和晋国的邓艾都有"屯田"，以前两人合并成一条账。现在拆开了——配置行数没变（还是 39 行），但**唯一键从 38 变成 39**。也就是说，"内容层允许存在、装配层强制唯一"这条规矩，从今天起**有观测手段可以检验它有没有被破坏**。

改完之后的 60 局成绩单：配置 39 条里 **10 条真触发过**（贾充·帷幄 3 次最多，另有杜预·拓略、羊祜·垦荒、司马炎·封赏、黄盖·苦肉各 2 次，邓艾·屯田〔晋〕、王元姬·英慧、文鸯·奋勇、周瑜·英姿、吴国太·补益各 1 次），29 条零触发。

测试还是 **491 例/53 文件**——这一刀**一条新测试都没加**，只是把老测试的期望换了形状。过程中踩到一个新坑，也记进账本：**单独跑一局，完全可能一次技能都没触发**，所以"键的形状对不对"这种正向检查必须放在批量跑（20 局）的结果里，放单局会假失败。

这一刀没碰任何玩法：开关默认关着，游戏路径一行没改。老战局照例逐字验货——300 局胜席 **117:183 与 B9 一桌一笔全分不差**（改完重跑两轮，除了计时行完全相同），五道门禁全绿，打包产物只大了 0.43 kB（就是那张翻译表加几行说明文字）。真浏览器没去点：**这一刀没有界面可点**，如实写明，证据由命令行实测+单元测承载，不拿单测冒充真机。要不要再约老搭档评审？不用——它已经被我们预先约在 2.7 收官那一刀，这一刀也没发明任何新语义。

下一刀是建议书第 2 项：**事件/状态事实契约治理**——把上一刀发现的那个"界面方言混进实况快照"的观察项正式收编，把"哪些字段是游戏事实、哪些只是界面说法"的边界钉死并加回归锚。（CI 状态：全绿——GitHub Actions 第 107 次运行，run 36227547332，在登记提交 8007d5f 上 completed successfully；功能提交 cfd69bb + 登记提交 8007d5f + 标签 v2.7.0 由同一次顶端运行全覆盖；本次直连推送主分支与标签均成功、未借代理）

## 2.7.1：2.7 第二刀——给"界面"和"事实"划一条硬线：那面翻译镜以前会把界面的口头禅当成正史写进档案，现在它只做还原、不做发明（非内容刀，对 B9 逐字）（2026-09-26）

第二刀是建议书第 2 项，收的是上一轮收官时挂下的那条观察项。

**问题出在一面"镜子"上**。游戏内部有一份正式状态档案（谁在第几回合、哪些技能已发动、欠着谁一次选择、随机数走到哪一步……），界面上另有一份为显示准备的状态（当前页面、阶段口头语、房间名……）。两者之间有一块翻译代码，负责把界面那份"投影"回档案格式，好让引擎随时能接着算。

坑在这里：**只要你在界面上改一点只显示用的东西**（换个标题、清掉一条战败提示），这块翻译代码就会被顺带叫起来重做一份档案。而它做出来的档案有两处假：

- 阶段字段写的是界面的口头禅。界面说 "main"，它就大写一下写成 `MAIN` 塞进档案——可引擎用的词是 `ACTION`，`MAIN` 这个词全游戏没人认识。`START`、`END` 同理。
- 档案里那格"元信息"被**整包换掉**，只留下翻译器自己要记的三笔流水，原来登记在案的事实（比如房间号）说没就没。

于是这份带方言的档案，会被下一步真正的派发动作**原样接手**，混进实况录像和实时快照里。上一轮收官时我们用一条"把 MAIN 折叠回 ACTION"的对账口径把它糊过去了——那是在给 bug 打补丁，不是在给契约立规矩。

**这一刀的修法是一句话：镜子只能做还原，不能做发明。**

- 引擎→界面的折叠是有表可查的（`DRAW/ACTION/GAME_OVER` 变 `draw/main/end`，`MENU` 和 `TURN_START` 塌成同一个 `start`）。那就**逆着这张表**还原，而不是把单词大写。
- 那个塌成 `start` 的格子**从显示值本身推不回去**（两个词共用一个显示词），只能看上一份正档写的是哪个，跟着血统走；连显示信号都没有时，**原样带走上一份的值**，绝不猜。
- 元信息改成"原来的键都活着，翻译器自己要记的几笔叠在最上面"，而且那几笔流水每次显式清空重置，不让上一次的观察结果跨镜残留。

顺带把话说进契约里（写进了架构地图的 D-9 那一节）：**回合数、已消耗技能台账、欠着的玩家选择、随机数游标、元信息、阶段 = 游戏事实；界面阶段口头语、页面、房间名 = 显示**。显示可以还原成事实的用词，但不许发明方言；而且镜子**不往外发任何事件**，所以它绝不会变成第二条结算路径——这条是我们每次都自查的红线。

**行为有变化，说清楚**：档案初值从方言 `START` 变成正规 `MENU`，玩牌阶段从 `MAIN` 变成 `ACTION`。全项目只有一处代码拿这个字段判合法性，而且是"玩牌阶段不拦"，所以对局结果零影响——这一点有硬锚兜底：**300 局 AI 对战胜席 117:183，与 B9 一桌一笔全分不差**，重跑两轮除计时行完全相同。

**新加的 5 条测试是这一刀的锚**（测试数 491→**496 例/54 文件**）。其中一条特意走**全链**：从界面动一次只显示的 set()，再看引擎派发后接到的是什么、录像里记了什么。只测翻译函数本身是不够的——"界面操作不该往录像里记东西"这条口径，只有全链才测得出来。写测试时还被真实语义教育了两次：结束回合是真的推进（回合数 5→6，不是回卷成显示值 3）；录像的**第一次**派发的职责是"建档"、不产生条目，所以房间号必须在建档那一刻就被读到。

**真浏览器也去点了一遍**（这一刀动的是实况那套路，占真机验收）。本地房→创建"定军山之战5610"→骰子→两边各选满 10 张→抽牌进主阶段。三件证据：① 在主阶段点了一个纯界面动作（清战败提示）后，档案里的阶段**仍然是正规的 `ACTION`**（老代码在这里会写成 `MAIN`），录像条目 4 条→还是 4 条，一点没记；② 真点"结束回合"→回合 1→2、档案 `DRAW`、录像 4→5，说明镜子没腐蚀下一步真派发；③ 把这局实况文档丢给回放器重放，处理 5 步、零降级告警，终态与实况**逐字节相同（9848 个字符）**，两边阶段词都是 `DRAW`——**从这一刀起，那条 "MAIN→ACTION 折叠" 的对账补丁正式退役**。dev 服务器单实例、用完即杀，全程没点任何保存/下载。

**顺带挖出一条新事实**（已记账，本刀刻意不修）：真正从界面建房的这条路上，录像文件名里的房间号**一直是 `local`**。原因是房间名只存在显示层那一格里，从来没进过档案；全项目只有 AI 对战那条工具线会写房间号。所以上一轮说"镜子把 roomId 弄丢了"，更准确的说法是：**镜子会弄丢档案里已经存在的事实**（这刀治好了），而界面建房这条路上**本来就没有这个事实可丢**。要修它等于新增一条游戏事实——按"不发明玩法"的规矩，等真实需求出现再单独立刀，已列进 2.8 候选。

五道门禁全绿（类型 0 错、496 例全过、覆盖率四项过地板、lint 0 错 30 条遗留警告零新增、打包 1,957.31 kB 只大 0.50 kB=那张还原表）。版本 2.7.1。老搭档评审不用约——它已经预钉在 2.7 收官那一刀，这一刀只是把它上次裁过的口径落成代码，没发明新语义。

下一刀=建议书第 3 项的前置小刀：**给"弹出选项让玩家选"那台机器再装两个候选生成器**（挑目标、挑手牌），**只接线、不带任何技能内容**，老战局照旧逐字验货。（CI 状态：全绿——GitHub Actions 第 110 次运行，run 36229798799，在登记提交 81e5b38 上 completed successfully；功能提交 26b328d + 登记提交 81e5b38 + 标签 v2.7.1 由同一次顶端运行全覆盖；这次直连推送连不上（连接被重置/443 超时），按老规矩一次性借道本地代理推成功后没有留下任何持久配置。顺带把上次漏验的那条运行也确认了：第 109 次运行同样全绿）

## 2.7.2：2.7 第三刀——给"弹出选项等你选"那台机器装上两个"备选项生成器"：一个负责点名场上的将、一个负责点名手里的牌，但这次只装机器、不放任何技能进去（只接线不带内容，非内容刀，对 B9 逐字）（2026-09-26）

第三刀是建议书第 3 项的前置小刀，也是老搭档评审点名的那道工序：在把"玩家做选择"扩到真实技能之前，先回答一个问题——**生产者能不能合法地产生一张标准的"请你选"条子**？回答方式是装两台机器，而不是配任何技能。

**装了什么**。上一轮（2.6.3）已经建好了"选单项"这条通道：技能触发→弹出选项→世界暂停→玩家点一个→只结算被选那支→账清。但那条通道的选项当时只能"一个效果一个选项"地硬列。这一刀补上两个**候选生成器**：

- **点名场上的将**：按固定顺序把场上活着的将列成选项（还能限定"只列敌方的/全列/只列自己的"三档）；
- **点名手里的牌**：把欠这条账的那名玩家的手牌逐张列成选项。

选谁/选哪张，就只结算针对谁/哪张的那一支效果。为此手牌的"弃一张、给一张、放牌堆"三条既有路数统一改走一个**新的取牌小阀门**：不传点名清单时行为和以前逐字一样（从牌头拿），传了清单就按清单摘取、保持原有顺序。

**刻意没做什么（这刀的看点）**：

- 一个技能都没配。内置 168 条将技没有任何一条拿到"生成器"开关——老战局 300 局重放，胜负分布和上一版**一字不差**，这就是"没动玩法"的铁证。
- 录入界面也没开。这两个开关目前只存在于程序内部的数据结构上，编辑器、Excel 表格都看不见它——按咱们立过四次的规矩，**"线路接好了"不等于"现在就能配"**，真要给某个技能用，得等那技能自己排上内容刀、把录入面立起来。
- 一条防御细节：如果生成器列出来是**空的**（比如敌方场上没人），机器就干脆不发这条"请你选"——因为通道一开整个桌面暂停，空选项会让游戏卡死。

**真机验收（老规矩，真浏览器真点击）**：热座房里让真实的生成器对着真实牌桌报候选（点名点到的将、手牌张数和场面全部对上），然后用官方恢复通道摆好一张"请你选"条子，**真人鼠标点掉屏幕上那个「◈ 选项2：夏侯渊」按钮**——只有被点中的那个将掉了 1 点血、账清、桌面解冻，实况档案里存的基准画面和点完之后的现场一字不差。有一处如实交代：进房到开桌那段纯装饰流程（掷骰子、征召、发牌）因为浏览器后台省电机制会卡死计时器，是按既往许可用与按钮完全同一批的官方动作直达的，**真正用鼠标的只有被验收的那颗按钮**。

**验证全绿**：类型检查 0 错；测试 509 例/55 文件全过（新增 13 例专打这两台生成器，包括"多条效果时不许用生成器"“空候选不发条"这类反面钉子）；覆盖率四项全过地板；lint 0 错；构建产物只大了 1.33 kB。老搭档评审这刀不用约——第四检照旧预钉在收官刀，这刀只是把它上次点名的工序原样落地，没发明新语义。

下一刀=建议书第 4 项：**"什么条件下才触发"的自定义条件原语**（老规矩：先把十二格契约表填完再动代码），老战局照旧逐字验货。（CI 状态：全绿——GitHub Actions 第 113 次运行，run 36232695206，在登记提交 98d7cda 上 completed successfully；功能提交 c23a04d + 登记提交 98d7cda + 标签 v2.7.2 由同一次顶端运行全覆盖；这次直连推送 master 与标签均一次成功，没有借道代理；连"把 CI 证据抄回文档"的那次登记提交本身，也在第 114 次运行（run 36233126388）上验到全绿）

## 2.7.3：2.7 第四刀——给技能装上"够格才响"的那道闸：手里牌不够多、自己血不够低，技能就干脆不该触发，以前这种话只能写在看板上、引擎听不懂，现在它有了一套正式的问法（十二格契约表先填完才动代码，非内容刀，对 B9 逐字）（2026-09-26）

这一刀兑现的是建议书第 4 项，也是玩家最直觉的那类技能措辞——"**若你手牌不多于 X 张**则如何如何"、"**受伤的目标血量低于攻击者**才如何如何"。以前这类条件只能写在技能描述里当摆设，运行时一概不听；这一刀之后，引擎有了一个正式的问法。

**规矩先说死（老流程：契约表先落地）**。条件是一次性的"看一眼够不够格"，不是一个新动作：它**不产生任何事件、不改动任何状态、不碰任何随机数**，而且必须排在"这算不算该我的时机"这道身份判断**之后**——先认人，再看条件。能问的东西固定六样：手里几张牌、某个将几点血、某个将几点甲、场上几个将、牌堆还剩几张、这次事件涉及的数值；比较符五个：小于、小于等于、等于、大于等于、大于（写作 <、≤、=、≥、>）；问的是谁也可以指定：自己（不写就是自己）、被打的那个、动手的那个。条件之间是"且"，全过才算过。**最要紧的一条是态度**：只要有一样问不出答案（比如场上根本没有那个将），整条就算**不成立**、技能就不响——宁可不响，也不能凭一个查不到的前提假装响应，那等于凭空发明玩法。

**装了以后有三个地方在听这道闸，而且是同一套代码在判**（这点刻意钉死，绝不允许三份近似实现）：
- 技能自动触发的十类时机，每一类都在身份判断后加这道闸；
- 回合结束"你要不要用技能"的候选名单——于是屏幕上问不问你、合法动作里列不列它、电脑玩家会不会考虑它，三处口径完全一致；
- 真要发动的那一刻再判一次，不合格就明明白白回一句"条件没满足"（宁可拒得清楚，也不要闷声不响地空转一条技能）。

**刻意没做什么（这刀的看点）**：一条技能都没给它配。内置 168 条将技没有任何一条带条件，编辑器和 Excel 表格里也看不见这个开关——按咱们立过五次的规矩，**"线路接好了"不等于"现在就能配"**。这里还顺带查出一件实情：编译程序是把技能字段一个一个手挑着装车的、从不整包照搬，所以只要没人往那张清单里添这一项，条件就永远不可能从数据里溜进运行时。因此"技能带着条件自动开闸"这条在当前版本**真机上到不了**，我们用的是测试里的假编译在关键路口投喂——**如实写进文档，绝不拿单测冒充真机**。

**没动玩法的铁证**：老战局 300 局重放，胜负分布和上一版**一字不差**（117 胜对 183 胜、零违规、同种子跑两遍除计时行外逐字节相同、五股势力的小账也全部吻合）。因为条件缺省就是"没有闸"，不装就等于没写。

**真机验收（老规矩，真浏览器真点击）**：在真实开好的热座牌桌上，让这道闸对**当下真实局面**逐项报数——手里 5 张、牌堆 46 张、场上先 0 个将（用真动作登场一个 1 血的将后变 1 个），问不出的那几样（没有事件时问"被打的是谁"）老老实实报"不成立"；整场验完，现场存档的状态**一个字符都没变**，而且里面搜不到"条件"这个字样、也搜不到任何度量词（证明它真的只是路过看一眼）；接着**真人鼠标点两次「⏭️ 结束回合」**，回合交接、抽牌窗开合全部正常，说明加了闸的触发链没被碰坏；实况录像 8 条 24 万多字符零"条件"、版本号已显示 2.7.3；页面自身控制台 0 报错（只有一条我们本来就有的"某些技能还没运行时载荷、不会触发"的诚实提示）。验完立刻关掉本地服务并复查端口无残留。

**验证全绿**：类型检查 0 错；测试 531 例/56 文件全过（新增 22 例：纯算账 10、真实引擎触发路 6、决策路 6，包括"闸绝不能偷改事实""不满足时连弹窗都不该开""拒因不许盖住更靠前的原因"这些反面钉子）；覆盖率四项全过地板；lint 0 错；构建产物大了 2.37 kB。远端流水线（CI 第 116 次运行）也已核验全绿：两个 Node 版本各 56 文件 531 例全过、lint 与构建四格皆绿，跑在登记提交 `b9f7d0d` 上；master 与标签 `v2.7.3` 直连推送一次到位、没借道代理。老搭档评审这刀不用约——第四检照旧预钉在收官刀，这刀是把上次定好的十二格表原样落地。

下一刀=2.7 收官刀（v2.7.4 收敛核验）：裁定"装备被拆算不算丢牌"这条挂账语义、把积木自由拼接的语法先在纸上排一遍、请老搭档做第四次评审、并出 2.8 建议书。（CI 状态：远端已核验全绿=CI 第 116 次运行，回填另见 docs 提交；细节在本节上段）


## 2.7.4：2.7 收官刀——这一刀几乎不写代码，干的是"把话说清楚"：装备消失到底算不算"丢牌"、咱们想要的"积木自由拼接"现在这套机器拼得出几句话、下一段路先干哪件（非内容刀，对 B9 逐字）（2026-09-26）

2.7 的最后一刀是验收刀。前四刀分别把成绩单的学号改成"学号+名字"、把"界面口头禅"和"正史事实"划清、给"弹选项"机器装上两个备选项生成器、给技能装上"够格才响"的闸门。这一刀不再添新机器，它回答三个悬着的问题，然后把 2.7 收口。

**第一件：装备没了，算不算"丢牌"？**有讲究，因为游戏里装备离场其实有三条路：技能把它**剥下来**（典韦强袭、董卓崩坏那类）、装备**替主人挡刀时被销毁**、以及主人**阵亡时装备跟着一起下场**。当初为了"失去牌就摸牌"那类技能接线时，只有第一条路会往外广播一条"丢牌了"的消息，另外两条一直沉默、也没个正式说法。这刀钉成裁决：**只有"被技能剥下来"算丢牌，另外两条不算。**理由不是嫌麻烦：① 现在没有任何技能需要那两条路的事实（有需求才补，不预先铺）；② 多广播一类事件会改变所有依赖它的技能行为，那属于"往游戏里加东西"，得走内容刀的规矩、重立基线；③ 广播只允许有一个出处，多一处就多一处会漏、会重、会打架的地方。光写在文档里守不住，所以补了一条测试当门栓：真跑那两条沉默路，要求"零丢牌消息"，而且站在场上的孙尚香**不许有任何反应**——将来谁想扩面，这条立刻报红。顺手把判据的措辞纠正了（第四次评审提醒的）：一条事件该不该发，看的是"**游戏规则需不需要知道这个因果关系**"，不是"**东西是不是物理上消失了**"。以后谁再拿"消失就该发消息"这种整齐感提要求，文档里那段就是反驳点。

**第二件：积木能拼成什么样的句子，先在纸上写明白。**咱们想要"技能像积木一样自由拼接"，所以动手前先数清楚这套机器有几个插槽、哪些已能用、哪些是空的。结论：一句技能话术的骨架 = **什么时候响 × 再筛一道 ×（还要同时满足的条件）× 对谁做 ×〔最多一次"由玩家挑一个"〕做什么 × 做多少**。九个槽里**七个已有机器承接**，剩两个是**真缺**：一个是"**这局还能用几次**"，一个是"**先这样、如果那样就再那样**"（链式条件）。这两个不是"忘了做"，是**结构上还没有位置**——前者要把"这局用没用过"变成一条游戏事实记进存档（一记进存档，录像、回放、对账全要重锚，基线就得换），后者要改的是"怎么把一张技能表拆成机器零件"这条规则本身。这刀把改造成本排了序：**先做门槛的录入面**（引擎侧上一刀已就绪，剩编辑器和表格的活儿）→ **再扩"能挑哪些东西"**（仍属能力层）→ **然后碰链式结构** → **最后才是次数/冷却**（唯一要动游戏事实契约的一处）。另外记了一句要紧的话：核对编译规则时发现"细分"这一槽**界面上能选的**比**编译真正认账的**多——比如"登场时机"的分法在编译阶段根本没被读进去。以后估工时要记住：**界面上有个下拉，不等于引擎有这个能力。**

**第三件：请老搭档做了第四次评审**（四问四答，结论已回填进文档，不是只贴在聊天记录里）。它认可收官表述，但提醒别让"瓶颈=补录入面"被读简单（障碍其实有三类：缺录入面、缺真正的规则能力、语法模型压根表达不了）；认可九槽表，并把"代价/消耗"这槽的读法说透——**语法上要占一个位置，实现上不必硬造一个新零件**，可一旦把它藏进参数里，表上仍要写清"什么时候付、付不起怎么办、在挑选项之前还是之后、要不要发消息、付完还能不能反悔"，否则这个缺口会换个形态长回来；认可装备裁决，同时要求按上面那句改判据措辞；对 2.8 的顺序提了个调整，我们采纳：**链式结构（语法层）排到次数/冷却（游戏事实层）之前**——上游句子结构没定就先堆事实，容易在错的模型上继续加东西。三件明确先不上桌（每局限一次、装备销毁扩面、平衡监控）。评审全文在仓库外的归档文件里，字数与校验和都记在案，其中一处单字抄错已当场定位修好并如实披露。

**这刀"没写代码"的硬证**：整个源码目录只动了一个测试文件；构建产物体积和上一版**逐字节相同**；老战局 300 局重放，胜负分布与 B9 **一字不差**（117 对 183、零违规、同种子跑两遍除计时行外全等、五股势力小账全部吻合）。另外如实说一句：**这一刀没做浏览器真机验收**——玩法零改动、机器一颗螺丝没加，我们不愿拿单测冒充真机对局，所以干脆不占。

**验证全绿**：类型检查 0 错；测试 532 例/56 文件全过（净增 1 例=上面那条门栓）；覆盖率四项全过地板；lint 0 错（30 条遗留警告零新增）；构建单文件成功。**至此 2.7 五刀全部闭环，没有待办**；是否立 2.8 等一句口令，顺序就按采纳后的那张单子走：门槛录入面 → 候选域扩面 → 链式结构契约 → 次数/冷却 → 多槽选择窗 → 剩余内容量产。（CI 状态：远端也已核验全绿——第 119 次运行跑在登记提交上，总时长 2 分 50 秒，两个 Node 版本各 56 文件 532 例全过、lint 与构建皆绿，注解只有咱们本来就有的 14 条历史遗留警告；master 与标签直连推送一次到位、没借道代理。另外如实补一句：覆盖率在版本号改完之后又复跑了一遍，读数是 51/43.25/41.94/56.5，和本节正文记的定稿快照 51.19/43.61/42.11/56.73 略有差别——这类数值一直是"抖动快照"不是硬锚，两组读数都在地板线以上，门禁都是过；证据回填之后又在这份最终稿上复跑了一遍类型检查与 lint，也都是零错）。补证据那笔提交推送时赶上网络波动——直连先连不上，按老规矩临时借了一次代理才推上去（代理没写进任何长期配置），它自己的远端流水线（第 120 次运行）也已当场核验全绿：3 分 8 秒，两个 Node 版本各 56 文件 532 例全过）





## 2.8.0：2.8 首刀——给将领上了"户口本"：同名就是同人，发出去就占名额，选了别人也不能反悔领回来（内容刀，战绩基准从 B9 换成 B10）（2026-09-27）

这一刀开始走 2.8 路线，第一件正事是给游戏立一条新规矩：**名字相同、势力相同的将领，在游戏眼里就是同一个人**。以前的规矩只管"同一张卡不能发两份"，新规矩管到"同一个'人'不能出现两份"。打个比方：以前牌店按身份证号限购，一张身份证买一份；现在按名字限购——店里摆着两个"曹操"，你只要拿到过其中一个（哪怕没选它、它已经"沉"进弃置堆），另一个也跟你无缘了。

**新规矩的全貌（六句话）**：① 同名即同人，"身份×势力"就是那个"户口本条目"；② **发出去就占名额**——卡发到你面前就算你没选，这个"人"对整个房间也作废了（这是明面规则，不是漏洞）；③ 自己给自己找别扭不行：你的主力堆和群英堆里不能有两个同名（哪怕分属两个势力），群英堆里的同名全场只许一份；但两个不同玩家各自拿到"魏曹操""晋曹操"完全合法；④ **规矩从这一版开始，不翻旧账**：以前存档里已经并存的同名卡照样能玩，只是选卡界面给它们标红字提示、不让重影卡生效；新开的房间若装配时撞上锁，整批直接拒绝并告诉你原因，绝不偷偷换人；⑤ 自己DIY的将、或者故意留空身份的，不受此限——"留空=不锁"是逃生门；⑥ 同一位玩家面前的一排候选卡里也不会出现两个同名。

**配套的三样东西**：一是编辑器里新增了"身份管理"面板，像一本户口本——可以新建身份、改名自动跟到所有用它的将领、还有身份在用的条目删不掉（会告诉你都在谁名下）。官方将领不填这个字段也自动按本名记账，所以**老存档一个字节都不用迁移**； Excel 表格也没加新列，一切照旧。二是AI对战的自动配将同样遵守新规矩（这是拍板过的：宁可换基准也不给AI开后门）。三是"演练窗"（做实验的小工具）留了一排旁路开关，可以按关一关某条规则来做对照实验——但这些开关**只在演练批次里生效，绝不进正式对局、不进录像**。

**换战绩基准（B9→B10）**：因为AI配将也上了锁，以前钉死的"300局标准战绩"作废，换新基准。新基准同样是同种子跑两遍逐字一致（胜场 112 对 188、零违规），五股势力的小账本全部登记在案。要如实说一件重要的事：**新规矩对现有官方武将有很大一部分是"空转"的**——官方 95 个将里本来就没有"同势力同名"的情况（同名只有司马懿、张春华、邓艾、钟会四人，全是魏/晋跨势力），所以"同势力不许同名"这条目前没有真实触发对象；真正马上生效的是跨势力互斥和群英堆全局唯一。数值上也得到了印证：换基准后五股势力的出场数、各自胜数和老基准**完全一样**，总胜场的小幅漂移纯粹是代码路径变化引起的洗牌顺序位移，不是玩法变了。这条"空转"如实登记，不许拿规则覆盖面冒充已验证。

**真机验收（这一刀是新玩法规矩，不豁免）**：在浏览器里真点了一遍全流程——编辑器建身份、删不掉、给太史慈挂上"孙策"身份、保存、刷新后全都还在；开真局验证"发出去就占名额"：第一位玩家面前有带"孙策"身份的太史慈但没有孙策本人（一人一坑，占上了），故意不选它之后，下一位玩家面前果然连孙策本人都被这个"沉没的坑"挡掉了；还做了单变量对照实验（把身份编辑删掉重跑，一切恢复旧样），证明行为差异全部由新规矩驱动。旧档红字提示、演练窗拒批与放行也都真机走了一遍。**验收还当场抓出一个真缺陷**：演练窗碰到整批拒绝时会不作声地卡住——修好了，现在会把拒绝原因亮成红字并干净收尾，修完五道检查全部重跑通过。

**验证全绿**：类型检查 0 错；测试从 532 例增到 **567 例全过**（净增 35 条，专门盯新规矩的各种边角）；覆盖率地板全过；lint 0 错；构建产物 1,975 KB（新基线数，比上一版大 14 KB 就是这套户口本领的工本费）。**远端流水线也已核验全绿**：第 122 次运行跑在登记提交上、总时长 3 分 34 秒，两个 Node 版本各 60 文件 567 例全过，lint 与构建皆绿，注解只有咱们本来就有的 14 条历史遗留警告。推送照老规矩走了一次降级：直连先连不上，临时借道本机代理把 master 和标签一起推上去（代理没写进任何长期配置，推完复查干净）。（补证据那笔提交自己的远端流水线也已当场核验：第 123 次运行跑在补证据提交上、2 分 40 秒全绿，这次直连就推上去了、没借道代理。登记到这一层收线。）

## 2.8.1：2.8 第二刀——把钥匙换成锁眼里的暗号：设置页不再写着口令，顺手堵了一扇没人用却能推开的侧门（非内容刀，战绩基准 B10 逐字不动）（2026-09-27）

这一刀起因是您补的一句话：**既然将领有了"身份"，开发者模式最大的用处就是区分"这处改动是官方改的还是玩家 DIY 的"，那它的口令就不能让任何人看得到**。这话站得住，我们照它办了。

**先说查出来的三件事**（都是实测，不是猜）：一是旧口令以**普通文字**写在两个源码文件里，而且**被打进了交付的那个单文件网页**——任何人拿到这个文件、右键"查看源代码"，一眼就能看到口令；二是仓库里还留着一个"不用口令就能直接开启开发者模式"的开关，全项目**没有任何地方在用它**，但懂行的人可以在浏览器控制台里直接喊它——有口令等于没口令；三是**版本历史里从头一笔起就带着那串明文**。

**我们做的裁决，也讲清楚代价**：**不重写历史**。重写等于把 193 次提交、所有里程碑标签、远端仓库和流水线全推翻，风险远大于收益。因此换来的规矩是：**旧口令从此永久作废**——只要能读到这个仓库的人，理论上还能从历史里翻出那串旧字。这不是"已经消除的风险"，是**明码标价留下的账**。也正因此，**换一把新口令**才是有意义的（新口令由您直接给定，它**只以"摘要"的形态存在**，任何文档、提交、测试、记忆里都查不到它）。

**改动本身**（一个新增、三处改写、删掉一扇侧门）：新增一个"唯一出入口"文件，里面**只有那串 64 位摘要**，绝没明文；开启开发者模式时要给摘要，**逐字对上才开**；关闭**不需要任何东西**（您的口径：进入要口令、退出不要——退出只是把能力收回去，没有风险）；设置页改成就地算摘要再交给判断，算不出摘要的环境（比如某些非浏览器场景）**直接拒绝并提示"请用浏览器打开"**，绝不"那先用明文比一下"（一旦留第二条路，第一条就白修）；错误提示不回显您输入的任何内容。那个没人用的免口令开关**删了**——这一刀是**少**了一条路径，不是多了一条。

**过程中被测试逮住的两件事，都记进账本**：一是浏览器测试环境根本没有"算摘要"的能力（WebCrypto 缺位），相关用例改放 Node 环境跑；二是**一个真 bug**——"大小写归一"和"格式校验"的次序写反了，导致**大写摘要会被误拒**。之前填的是占位用的全零串，那条分支永远走不到，一填真摘要就露出来了，已改正并补了一条用例钉住。教训一句话：**占位假数据会让"先后次序"这类错误完全隐形**。

**验收到什么程度**：构建产物里对口令片段 **0 命中**、摘要恰好 1 处；源码里也是 0 命中。真机点两遍——开发服务器和**构建后的单文件网页**（这次特别确认：单文件直接双击打开那种场景，算摘要的能力是**可用的**，所以离线形态没被破坏）。错口令→弹「密码错误」、那行还写着"未开启"；正确口令→开得了、该出现的入口出现；退出→**不催口令**；**刷新页面→回到未开启**（顺手纠正了交接文档里"刷新也保留"那句旧话，它已经过期）。全程没点保存和下载。

**随这一刀一并立好的"纸面规矩"**（不写代码，只把话说明白）：以前想过的"若……则……"连招（先做一件事，做完再根据结果决定下一件）现在**只有一张契约表**，十二个格子逐格填了"这件事怎么算"，还附了三列补充（前一步空转时后面要不要继续、连招里暂时不许插"等你选"、目前**没有任何一个真实例子能触发它**）。特别写死一句：**这张表是纸面判定、未验证**，谁也不许说成"连招语义已经具备"；一旦它真的进了编译形态，战绩基准必然要换，那一刀**不能声称对现基准逐字**。另外两处旧说法按事实改写：门槛录入面**不是**"纯界面工程"（数据层压根没这个字段，要动四处）；"这是官方改的还是 DIY 改的"**目前还没有判据**（全库只有一处 DIY 痕迹，靠名字猜），所以它被列为简化编辑器的**前置条件**——顺带一条约束：**改动是谁做的必须落进存储里做标记**，因为编辑器内容会保存、开发者模式一刷新就没了，没有标记就管不住"官方"这两个字。

**账面随动**：测试从 567 例增到 **579 例全过**（62 个文件）、构建产物 1,975.78 KB（gzip 579.57 KB，成为新基线数）、版本号 2.8.0→**2.8.1**。**战绩基准没动**——同种子 300 局跑两遍仍是胜席 **112 对 188**、零违例，逐势力小账与上一版逐项吻合，这正是"这一刀没碰玩法"的证人。**远端流水线**：推送一次直连就成功了（这次没借道代理），第 **127** 次运行跑在登记提交上、总时长 4 分 22 秒，两个 Node 版本各 **62 个文件 / 579 例全过**，lint 与构建也都绿，注解只有咱们本来就有的那些历史遗留警告。证据（运行编号）已回填进交接文档与两份历史。

**另有一个"不复用同一颗脑子"的复核**：按新写进规矩的三道闸，第三道必须由**另一个独立会话**在最终代码上自己重跑一遍，不能只信施工那位的汇报。这一刀真办了——那边自己跑完类型检查、测试、覆盖率、lint、构建，读数与这边同形（**579 例 / 62 文件**、构建 1,975.78 KB）；标准战绩同种子跑两遍仍是 **112 对 188**、零违例、五个势力的小账**逐项对上**；还随机抽了三处代码事实核（那个免口令开关确实只剩"测试里断言它不存在"、摘要判定的大小写次序确实修对了、开发者模式确实不写进本地存储）。复核顺带解开一个旧疑团：覆盖率报告那个文件夹本来就被 Git 忽略，所以它从没进过仓库。**补证据那笔提交自己的远端流水线也当场核验了**：第 **128** 次运行跑在补证据提交上、3 分 54 秒全绿，仍是直连推送、没借道代理。登记到这一层收线。

**还剩什么风险，说白**：口令不再写在锁眼上，但**这扇门是木头门**——它挡得住"路过瞄一眼"和"手滑改错"，挡不住铁了心改本地文件的人（这类离线单机应用天生如此，谁也做不到）。另外旧口令还在历史里躺着，这是我们不洗历史的**代价**，已经明码记在账上。

## 2.8.2：2.8 第三刀——把老房子里没用的预制件搬走：顺手把"以后联机怎么办"这件事写进了账本（非内容刀，战绩基准 B10 逐字不动）（2026-09-27）

这一刀是**由一个提问带出来的**。您问："那 95 个将领是记在总账里，玩家自己改的存浏览器本地，那以后官方新加将领是不是也改总账？玩家自制的将领只存在自己机器上，将来远程联机怎么办？"为了回答这个问题，我把整个项目里"谁引用了谁"这张网重新查了一遍——**这一查就查出了上一代做法留下的几件空家具**。您听完说："确认完全不用，那就开始清除。"于是有了这一刀。

**先回答那个提问本身（这也是清除的理由）**：官方的东西**确实就是改总账**——一个将领写一行，加上他的势力、体力、技能、称号；技能要真能在对局里生效，还得再写一份具体规则。所以每加一次官方内容，都要跑全套检查、要在另一台机器上再跑一遍、有时还要重立战绩基准。而玩家自己改的东西，是贴在总账之上的"**贴纸**"：读的时候临时合上去，**总账本身从不被改写**——好处是官方内容永远干净、老存档永远能开、不需要搬家。您查到的那套旧家具，走的完全是另一条路：一张卡一个记录文件，再由一个"搬运工"把它们搬进"登记处"。这条路项目早就放弃了，可那几件空家具一直立在原地，谁也不用它们，看着却像还在用。

**搬走了什么**（九个文件）：三个"搬运工"（一个是搬将领的、一个是搬技能的、一个是搬整包内容的）、两个"登记处"（一个记将领、一个记卡牌）、一份示例曹操卡、一份示例技能卡，最后还有一个连带件——那份"记录格式说明书"。这个说明书要说清楚：**它不是直接没人用，而是它唯一的用户就是那两个登记处**；搬走登记处之后它就变成没人认领的孤儿。所以清家具不能只看眼前这一件，得顺带看一眼"它撑着的还有谁"，一趟清干净。清完之后，`data` 这个柜子里就只剩下那两本总账：将领账、卡牌账。

**有一件"看着也该搬"的东西，我们故意留下了**，这里把尺子说明白，因为以后还会反复用到：**"没人引用"不是搬走的充分条件，还得问一句"它是不是已经点头要做的东西的地基"**。那套为联机预留的管道（发指令、传局面、管房间）确实一处都没接上，传消息那个函数现在就是原地把东西返回给你——但**方向是您这次刚拍板要做的**，搬走再买回来纯属折腾。所以：老做法的残件搬走，已核准需求的地基留下。

**顺带修掉两处"文档说得比代码做的多"**：一是文档里写着有个"安全读卡器"模块，实际上**那个文件从来没有过**，只有一个用这个名字命名的检验脚本，建档时把脚本名当成了模块名；二是文档说 Excel 导入走"搬运工"那条路，实际上 Excel 的真实入口一直在技能编辑器里，那条路从来没有接过。⇒ 立了条新规矩：**凡文档说"某功能住在某模块"，引用之前先查那个模块是不是真的有人在用。**

**关于联机与自制将互通，这次把话记牢了**（写进路线图，不动代码）。您的判断我照记：**"谁开房间谁当家"这个方向好，但只有它还不够——两个人各自有自制将领，谁开房都会少一批人能用的将。** 所以两件事都立了项：① **房主当家**——牌由开房的人算，别人只报"我要干什么"、收"现在局面如何"，这样自制将只需存在于房主机器上；② **内容包**——把自制将打包成一个可核对的文件，互相安装。

**其中第②件，当天您又更正了我一次，这里原样记下来**：我登记时顺手加了一条"两边的包对不上就拒绝进房"，您的口径是**这条不要，而且这件事根本不该和房间绑在一起，它就是一个独立功能，可以先做**。我认这个纠正：那扇闸门是我替您补的"顺手也该有"，不是您说过的话，而它带来的实际害处是**让一件本来随时能独立开工的事，被挂到了还没影的联机线上**。改后的说法：打包、装包、装的时候核对并明着告诉您成没成（**绝不悄悄装一半**）——这三件事自包含，**开不开房、跟谁打都跟它无关**；换设备、备份、分享作品本来就靠它。它唯一的前置还是那句老话：**得先分得清一张将是官方的还是玩家做的**，否则不知道包里该装什么。

**查的过程中还挖出一个好听的意外**：原本我以为"局面快照"里只带编号和数字，卡的名字、说明得另外发给对面。实测**不对**——现在那份快照里其实**整张卡的信息都顺带捎着**了。这是好事，但也**只是个巧合**：负责装东西的那个口袋在设计上故意"什么都可能装"，没有任何一条检查在守着"必须装得全"。⇒ 记进待办的原话是：**将来那刀的任务是"把搭便车升级成白纸黑字的承诺"（补一条检查：对方机器上一张卡都没有，也能把画面完整显示出来），而不是再新修一条送货通道。** 另外顺手把一句过期话改了：文档说联机管道启用前要先完成两件工程，而那两件早就做完了。

**验收是怎么过关的，讲三个证人**：① 删完之后再跑一次全面语法检查，**一句错都没有**——这就证明那九个文件真的没有任何地方在等它们；② **最终交付的那个单文件网页，大小和上一版一模一样（1,975.78 KB）**——因为"只有被人用到的代码才会被装进交付包"，那九个从来没被用过，所以搬走它们对交付包的贡献是**零字节**。这个证人比"测试全过"更硬：测试全过只说明没人报错，大小不变说明**根本没有一条路线被碰到**；③ 战绩基准同种子连跑三轮仍是 **112 对 188**、零违例，五个势力的小账**一格一格对上**。

**账面随动**：测试 **579 例 / 62 个文件，一条没增也没减**（搬走的都是没有测试的死码）；覆盖率数字看着略微好看了一点，**这里要说清楚原因**——分母里少了九个从来没被覆盖过的文件，所以分数自然抬起来，**这不是质量变好**，所以那道"最低门槛"我们一格都没往上调；lint 仍是 0 错、30 条老话遗留警告零新增；版本号 2.8.1→**2.8.2**。

**远端流水线**：推送**一次直连就成功了**，没借道代理。第 **130** 次运行跑在登记提交上、总时长 **3 分 54 秒**全绿，两个 Node 版本各报 **62 个文件 / 579 例全过**（取自流水线的测试报告页，是实际采集不是推测），lint 与构建也都通过，注解里只有咱们本来就有的那些历史遗留警告。证据（运行编号）已回填进交接文档、变更日志与两份历史。**补证据那笔提交自己的远端流水线也当场核验了**：第 **131** 次运行跑在补证据提交上、2 分 39 秒全绿，仍是直连推送、没借道代理。登记到这一层收线。

**两件按规矩说明白的事**：这一刀**没做真机点击验收**，因为只搬东西、不碰界面也不碰玩法，交付文件连字节都没变，**没有可点的东西**——这不是偷懒豁免，是如实登记"无对象可验"；外部独立复核那一闸也不触发，因为它管的是玩法改动，这一刀的替代证人就是上面那三个。**该留的警惕照样留**：不写"联机能力已具备"（管道还是骨架），不写"内容量产能力完整"。

**下一刀**照旧等您口令：**门槛录入面那四处**（让"手里牌不够多就不该响"这类话能从编辑器和表格里输进去）；以及联机双轨——它排在"能分辨一张卡是官方还是玩家做的"之后，那件是先决条件。

## 2.8.3：2.8 第四刀——"手里牌不够多就别响"这类话，现在能从表格里写进去了（非内容刀，战绩基准 B10 逐字不动）（2026-09-28）

**这一刀补的是什么**：上一轮（2.7.3）机器其实已经**看得懂**门槛了——"手牌不超过 2 张才发动"这种话它能算。缺的是**没人能把它写进去**：编辑器里没地方填，Excel 里没这一列，官方将的档案里也没这个字段。这一刀就是把这三段管子接上，机器那一头一个字没改。现在您在技能编辑里每看到一个效果，就多一张「🚪 发动门槛」的小卡片；Excel 的每个效果也从 6 列变 7 列，多出来的那一列就是门槛，**用大白话写**，几个条件用顿号或逗号隔开就行。

**您拍的三件事，照您说的办了**：
- 表格里只填**基础数值**，"基础＋技能加成"之后的面板数值由机器自己算——这一条先把规矩立住，等以后做"数值变化＋持续生效"那一刀时再落地。
- 一格里的多条"若……则……"分支，**您自己换行分隔**，机器按行拆。
- "**己方玩家手牌数量**"指的是**您这个玩家座位**的手牌数，不是哪个将领的手牌。您那句"我的游戏里只有玩家可以拥有手牌，将领不会拥有手牌"已经写进**冻结规则**，以后所有刀都要遵守。

**这一刀最要紧的一条设计：宁可说"我没看懂"，也绝不装懂。** 门槛是决定技能**发不发生**的闸门，读漏一条就等于您以为有保护、其实是裸奔。所以：
- 看不懂的那半句，会**逐条点名**告诉您——哪个将领、哪个技能、第几个效果、您原话写的是什么，一条都不丢；导入之后编辑器顶上挂一条**常驻**提示「有 N 处没看懂，这些内容没有被记下来（技能会照『没写』那样发动）」，必须您亲手点「知道了」才收掉。
- 您在框里打字时**当场回显**："看懂了：手牌≤2 且 牌堆≥5"，或者把看不懂的片段用红字原样挂着，并写明"这条条件不会生效"。让您在录入的那一刻就知道机器理解成了什么，而不是事后猜。
- 只写了门槛、没写是哪个效果的整组，**不凭空给您造一个效果出来**，照样点名报告。
- 带门槛的"选择其一"这一类，现在的结构表达不了（一张选择卡只有一个门槛槽），所以**整组都不发动并如实报告**，绝不解禁其中"看起来没条件"的那几条——宁可不发，也不替您发明玩法。

**按新写的规矩走的三道闸，第三道闸这一刀真抓到了东西**：
- 第一道闸是开工前用大白话把需求复述给您、把三个岔口摆给您拍板（就是上面那三条）。
- 第三道闸是**换一个全新的会话**在定稿代码上自己重跑、自己写攻击性的测试去戳我们的解析器。它自己造了两万组句子做解析对账、三千多组做来回翻译，都没戳出"把意思读反"或"把条件弄丢"；还在仓库外另开了一台真引擎验证"门槛不满足就真的摸不到牌、满足就摸得到"。但**它抓到一条我们把技能放宽的 bug**：以前"受到伤害后→攻击"这种只写了一半的时机，机器会**只认前面那半句、把后面的"攻击"悄悄扔掉**——结果您本意是"只有攻击伤害才算"，被放宽成"所有伤害都算"。这就是"读不懂却装懂"最坏的样子。修法是把这一栏改成**严格读法**：写进去的话必须能被一字不差地反写回来，否则一个字都不填、把原句报给您、并列出所有能认的写法。
- 它另外提的三条也照办了（放宽几个无害的口语尾巴、"牌堆／本次伤害"这种全局事实不该记对象、"本次伤害"挂在没有伤害的时机上永远不成立——这条加了黄字提示），还有一条我们**没照办并写了理由**：它建议把没看懂的原句也存进档案好让下次导出不丢，但那会让档案里多一个谁也读不懂、却参与渲染的假字段，而且您自己那份 `.xlsx` 源文件里原句本来就在，跑不了。

**这一刀最贵的一条教训，是给流程立的规矩**：那个复核会话中途转述给我的清单里有两条**指向根本不存在的代码**，我先自己写探针复现，发现复现不出来，就没照着改。要是照着"评审清单"一条条修，代码会被假问题改坏，而那个真 bug 反倒会埋在一堆伪修复里。**规矩=复核的每一条结论，先自己证伪再动手。**

**还有两件"我们故意没做"的事要说清楚**（不是藏，是登记）：一、如果某个效果本来就只是文字说明（没接真结算），在它身上写门槛是**没有东西可闸**的，机器照旧会诚实跳过那个效果，编辑器不再为它多喊一句（同一件事说两遍是噪音）。二、没看懂的门槛原句**只活在导入那一次**，不会存进档案，所以再导出那一格会是「无」。

**验收怎么做到的，讲四个证人**：① 全面语法检查 0 错；② 测试从 579 例增到 **617 例全过**（64 个文件），新增里有专门"故意把话写歪"的解析测试、有真点开编辑器的组件测试、还有一条**不造假引擎**的完整闭环（同一条技能，手牌 1 张时真的摸了牌、手牌 2 张时真的没摸）；③ 覆盖率、lint、构建都过，产物 **1,989.10 KB（gzip 583.20 KB）**，比上一版多 13 KB 就是这次这几块新代码的分量；④ **战绩基准一格没动**：300 局同一颗骰子，胜席还是那两组数字，魏蜀吴群晋的小账逐格对得上——因为官方技能今天没有一条带门槛，理论上这刀就该纹丝不动，实测兑现，而且复核会话自己跑的 300 局读数和我们一模一样。

**真机点击（不是拿单元测试冒充）**：本地开网页，门槛框打字看回显、故意写半句看红块、切"选择其一"看红字、严格读法两种写法各试一遍、**真点保存**再从系统里取回数据核对；最有分量的是最后一步——我们**现场按新格式生成了一份真的 Excel**（每行两个效果、每个效果七列，里面故意埋了三处坑），走页面上真正的"选择文件"上传按钮导进去：提示栏**恰好点名三处**（半截的时机、只写门槛没写是哪个效果、完全看不懂的那句），而写得清楚的那条门槛**两个条件全部落进档案**并带着真会执行的摸牌效果。全程没有弹出任何保存/下载对话框。两件如实交底：这一轮开开发者模式是用**只在开发版存在的调试开关**开的（口令按上一轮的设计我根本不知道、也不会出现在任何文件里，它改的是和设置页同一个开关位，不碰玩法）；用完之后把测试期间产生的本地记录删干净、页面刷新、临时文件删掉、开发服务器关掉并复查端口确实空了。

**账面随动**：版本号 2.8.2→**2.8.3**，测试数与表格列数的说法在说明书和 AI 规则文件里一并改正；顺手把几处"文档写着不能、其实代码已经能"的旧话改写成现状，并立了一条新规矩——**落地或删除一项能力时，必须把关于它的旧"不可能"说法一起改掉**，免得下一轮会话照旧话重新发明一遍或者误判欠账。

**远端流水线**：**全绿**。第 **135** 次运行跑在登记提交上、总时长 **4 分 25 秒**，两个 Node 版本各报 **64 个文件 / 617 例全过**，lint 1 分 20 秒、build 53 秒，注解只有历来那 14 条老警告（Node 20 弃用两条、React Hook 十二条），没有新增。推送时**直连又失败了**（同一时刻用另一种方式探 GitHub 是通的，说明是本机老毛病：探测工具走系统代理、git 不走），于是按老规矩**临时借道一次代理**把主干和 `v2.8.3` 标签各推一次成功，**没有把代理写进任何持久配置**。链条=功能提交 `b56956c` → 登记提交 `1715a1a` → 标签指向登记提交。**回填那一笔自己跑的那一轮也确认全绿**（第 **136** 次运行、**3 分 56 秒**，两个 Node 版本同样各报 64 个文件 / 617 例），按老规矩登记到这一层就收线，不再往下追第四轮。

**接下来等什么**：等您口令的候选都记在账本上了，一件没动——支付代价栏、后续效果栏、数值变化＋持续生效（就是把"面板值由引擎算"这件事真正做出来的那一刀）、本次伤害能不能改、任选目标、区域目标＋不可空发、决斗流程、回合限 1 次记账、"选择其一"的门槛，以及把几个术语换成您惯用的说法（**这一条紧随其后的 2.8.4 已经办完了**）。

## 2.8.4：2.8 第五刀——把机器黑话改成您平时说的话：拆掉装备、看牌堆顶、放回牌堆、目标（非内容刀，战绩基准 B10 逐字不动）（2026-09-28）

**这一刀改了什么**：您点名的那四个我们自造的词，从今往后在**您看得见的所有地方**都不是那四个词了——"剥离装备"改成**拆掉装备**、"观顶"改成**看牌堆顶**、"置牌入堆"改成**放回牌堆**、"被作用者"改成**目标**。管到的面：Excel 里"效果几类型／效果几目标"那两栏**写出来的字**、Excel 下拉菜单里的选项、编辑器里那两个下拉、选完之后那句预览话术（现在是"拆掉 1 张装备卡"、"把 2 张手牌放回牌堆"）、门槛框里"对象"的说法和底下那行提示，另外还有一张将的**卡面说明**——典韦的"强袭"原来写"剥离伤害目标的一张装备卡"，现在写"拆掉目标的一张装备卡（放进弃牌堆，他的护甲值相应减少）"。

**这一刀的活儿其实不在改名，在"您手上的旧表格不能作废"**。您自己维护的那些 `.xlsx` 里，早先导出的版本写的就是那四个旧词。如果只是把名字换掉，最坏的结果不是报错，而是**悄悄失灵**：导入时那栏被读成"没选类型"，技能照样进编辑器、照样看得见，**就是不结算了**——这种坑比 crash 难发现一百倍。所以我们做了一扇**单向门**：读的时候新旧两种都认（旧词还在小格子里活着），**写的时候只写新词**。您用旧表导入，读得懂；您再导出，出来的是新词；界面上从此不会再出现那四个黑话。

**只改您点名的四个，没有顺手批量改**。同一张表里其实还有"发放""获得护甲""场上将领""本次伤害""纯描述"这些说法，我们没动——改词是您的产品判断，不是我们能替您决定的技术活。要是哪天您想再换几个词，照这一刀的规矩办就行：改两处词表、旧词进别名、加"只进不出"的钉子。

**怎么防止以后有人把旧词又改回来**：加了两条测试钉。一条钉住"**凡是写出来的地方，四个旧词一个都不许出现**"，顺带钉住"下拉里的每个选项都必须被我们自己的解析器认得"（这是上一轮严格读法那条纪律的复用）；另一条钉住"您用旧写法（包括'受击者'这种我们没写进界面的变体）打出来的门槛，理解结果和新写法一模一样，而且回显出来一定是'目标……'"。

**验收的四个证人**：① 全面语法检查 0 错，测试从 617 例增到 **619 例全过**（64 个文件）；② **战绩基准一字未动**——300 局同一颗种子跑下来胜席还是 `1 号位 112 / 2 号位 188`、零违例、五个势力各自的小账和账本上逐格吻合，连跑两轮除了计时行全都相同，这就把"这一刀没有碰玩法"变成了数字而不是口头保证；③ 打包体积只涨了 **0.10 kB**（gzip 涨 0.05 kB），跟"两张别名表＋两条测试"的分量正好相称；④ **真机浏览器走了一遍**：我们按旧写法现场做了一份真 Excel（三个魏将，类型分别写"剥离装备／观顶／置牌入堆"，目标分别写"被作用者／自身／目标"），从页面上那个真实的"选择文件"按钮上传进去，结果**一条"没看懂"都没报**，三条技能分别落成了正确的类型与目标；再打开编辑器看，下拉里是新词、刚导入那条选的正是"拆掉装备"和"目标"；最后在手打的门槛框里用旧词写"被作用者体力=1，目标手牌>自身手牌"，回显出来是"看懂了：**目标**体力=1 且 **目标**手牌>手牌"。全程没有点过任何保存或下载，用完的临时文件、临时脚本、浏览器里临时写的东西都清干净了，开发服务器关掉并复查端口已释放。

**流程上如实交代两件事**：一、这一刀不是玩法改动，所以"开工前用大白话跟您复述规则"那道闸不适用；"换个会话独立复算"那道闸按文案改动的口径，用上面三件可复核的证人替代（旧词表真机导入零警告＝**演示**了兼容、不是声称；战绩基准逐字＝没碰玩法；下拉每选项可解析＝自家选项不会被自家解析器挡掉）。外部模型评审这一刀没申请，也没有可裁决的两头：四个词是您点的，旧词必须留是您文件定的，不批量换是"不替您发明玩法"的直接推论。二、我们在文档里给您留了一句提醒：往期的架构表小标题里还会看到"观顶""置牌入堆"这类旧简写，那是**同一件事的旧称呼**，从现在起一律按新词理解，别以为界面上还有这些词。

**远端流水线**：**全绿**。第 **138** 次运行跑在这轮的登记提交上、总时长 **4 分 7 秒**，两个 Node 版本各报 **64 个文件 / 619 例全过**，lint 1 分 10 秒、build 46 秒，注解只有历来那 14 条老警告（Node 20 弃用两条、React Hooks 十二条），零新增。推送这次又走了代理：直连 GitHub 超时，但同一时间浏览器口径的连通性检查是通的（`curl` 认系统代理、`git` 不认），所以 master 和标签 `v2.8.4` 都是**一次性**借道本机代理推出去的，没有把代理写进任何持久的 git 配置（写死了反而在您关掉代理软件后推不动）。

**接下来等什么**：账上还剩九件待您口令的事，一件没动——"选择其一"的门槛、官方将与自制将怎么分（这是"把您自制的将打包发给别人"的硬前置）、数值变化＋持续生效（就是把"面板值由引擎自己算"真正做出来的那一刀）、本次伤害能不能增减、支付代价栏＋后续效果栏、任选目标＋区域目标与不可空发、回合限 1 次记账、决斗流程（今天游戏里根本没有"决斗"这种结算，得您给完整规则）。这九件里除了"选择其一"的门槛，其余每一件都卡在"规则还没定"上——**我们不动手写，先问您**。

## 2.8.4 之后·把"该先定的事"定下来了（纯记账，一行代码没改）——您这次把新增将领和技能体系的前提全部裁完，编号问题有了答案，技能规则第一次能照着开工（2026-09-28）

这一段登记的是**您这次给的裁决**，不是新做出来的功能。代码一行没动，所也没有"战绩基准"的变化——它的价值是把以前"说不清就没法做"的几件事变成了白纸黑字的规矩，以后任何一次改动都要照它来。

**先说最让您头疼的那件：DIY 将领的编号怎么办。** 您的要求是"编号不能由玩家定，可玩家都在自己电脑上做将，我没法给他们统一发号"。答案是**干脆不靠"顺序号"**：每张将创建那一刻由系统自动生成一个永不重复、永不改动的档案号，另外还有一个专门管"这张将到底是不是那张将"的身份号，再加上一个来源标记（官方 / DIY）。官好用一套号、DIY 用另一套号，两边永远撞不上——所以玩家在自己电脑上做将，**不需要谁给他批号**，也不会和官方撞号。而且这三个号一旦生成就锁死：改名字、改血量、导出再导入，它们都不动；想从"DIY 变成官方"也不能靠改个字段实现，那属于身份迁移，得走流程。名字从此不再等于身份——**两张都叫"关羽"的将可以是两张完全不同的将**，是不是同一张只看身份号。顺带这也修掉了我给您报过的一个隐患：现在导入表格时是**按名字找将**的，而魏和晋有四个同名的人（司马懿、邓艾、钟会、张春华），表格里的势力一栏空着或写错，改动就会**悄悄挂到另一个势力的同名那个人身上**，一句警告都没有。这条以后要改成"按号找人，找不到就整行报错告诉您是第几行"。

**再说您选定的那一句：开发者模式做的新将，先算"官方做的本地草稿"。** 只有当这份内容被真正合进项目的源文件之后，它才算整个项目的正式官方内容，才算进自动核对的那套账（B10）。这样您那句"开发者模式下新增属于官方"和另一条您定的常设规矩——**凡是要进自动化验证的内容，必须能由仓库里的固定文件完整重建**——就不打架了：一个说的是"谁做的"，一个说的是"仓库认不认"。您这条常设规矩已经写进项目的永久规则里。也正因为这样，玩家在本地改的东西不会污染自动核对的数字；以后 DIY 内容想要自动化验证，只能走"仓库里放一份固定样本"的路子，另开一条账，B10 继续只代表官方将。

**还有一条您这次点了、我以前没查出来的洞**：现在"非开发者不能改官方将"这件事，**只挡在界面上**——界面上的入口没开就看不见，可绕过界面直接改数据是没人拦的。这次把它写成硬要求：拦截要分三层（录入的地方拦、改数据的地方拦、真正上阵前最后兜底），三层用**同一套**判断标准，不许各写一套；以前已经存在的对官方将的改动**不删、也不悄悄回滚**，只是停用并明确标出"这里和官方冲突"。

**然后是技能这边：您把七组规则讲清楚了，我先把我可能读错的三条写死在这里。**
1. **"数值变化"和"持续生效"是两回事**，可以任意组合。数值变化还分两种：改完能直接看见的（面板上的血量、攻击力）和看不见只在结算时提示一下的（比如伤害减免）。"持续生效"就是给效果配一个**有效期**，到点就没了。两边合起来的意思就是：在有效期内一直参与计算。重复发动**叠加**；**做这个效果的将一旦离场，有效期立刻结束，回来也不续**（护甲不算在这套里，它只用来挡伤）。好几个人同时改同一个数字时，**按发动的先后顺序一层层加**——您给的例子我复算过：D 攻击力 2，依次发动"全场受到伤害+1""令 E 受到伤害−2""令 D 攻击力+1"，E 实际受到 2 点，对得上。
2. **"受到伤害的增减"是在护甲抵挡之前算的**，因为护甲本质上就是一层额外的体力、只是优先扣。另外您当场更正了自己前一句话：**只掉护甲、一点血没掉，也算"受到了伤害"**（"0 及以下不算造成了伤害"仍然成立）。这条很重要，因为像"奸雄"这类"受到伤害后"才响的技能，以后就是照这个判响不响。
3. **决斗是一整套独立流程**：一轮一轮按近战攻击算出来的是**效果伤害**；就算算出 0 或负数也照样换对方打；**只要有人受伤后死亡就当场终止**，死人不再换、也不会再算它打对方；**两边各打完三轮就结束**，不再有第四轮。决斗里的"打"**不算攻击**（所以不会触发"受到攻击伤害后"那一类技能）；**不消耗任何行动次数，也不受行动次数限制**；从开始到结束**一口气算完，中间不插任何东西，也不会跨回合**；"本回合受到伤害−1"这类有效期效果**在决斗每一轮都算**；**不能拿自己当决斗目标**；**决斗本身不能被打断，但发起决斗的那个技能可以被打断或改变实际效果**。

**这次还有一件必须写下来的事，否则以后一定会被搞错**：您说过仓库里现在的技能定义**只是临时空壳，最终要以参考文件为准**。所以我不会拿仓库里现有的"奸雄=受到伤害后摸一张牌"来反驳您说的"奸雄的减免分支要弃手牌当代价"——以后遇到这种不一致，**一律以参考文件为准**，不自行判断谁写错了。

**只剩一个问题还等您回答**：您提到伤害增减的"来源最好做个区分，以后会有技能用到"，但**具体分成哪几类还没定**（比如算自身技能、装备、别的将的技能、还是决斗这类效果伤害）。这个我不替您定，等您给一份清单，"伤害增减"那一刀才开工。

您这次的裁决已经全部记进三份账（架构地图 §H 契约表、交接文档 §12-48 需求原文、两份历史）。按您"能直接做的先做"的口径，接下来先动**不需要您再裁玩法**的那七件地基（编号与身份锁死、来源与两层归属、录入面拒改、改数据处拦截、上阵前兜底、历史冲突标记、导入改成报错），技能那边等各刀规则齐了再逐刀开工。

**同日稍后：您把最后两个问题也答完了，需求这边已经没有 blanks**（记入架构地图 §H8、交接文档 §12-50）：

- **同名怎么认**：按您选的"名字+势力只有一张就自动认，多张就弹出来让您点"。您补的那句"先跳过分叉项、能导的先导完、最后集中让您点"我照抄成了设计规矩——**导入全程不会一行弹一次窗**，需要您选的那几张会攒到最后列成一张清单，每张都留着原行内容和"为什么要您选"的原因，您不选就挂着，**绝不替您挑第一张、也绝不悄悄丢掉**。
- **顺带查出一件值得先说清的事**：官方那 4 对同名（司马懿、邓艾、钟会、张春华）**势力各不相同**，所以用"名字+势力"去认，官方卡**全都唯一**、自动命中；"弹候选"这一路只有您自己做出**同势力、同名、但身份不同**的两张时才会真的出现。所以测试这一路必须自己造两张卡来验，不能拿官方卡当证据——不然会得出"功能通了"的假结论。
- **锁定修改开关**：按您的口径落成四件——非开发者眼里官方将自带一把**金色、解不开**的锁（那只是"系统本来就不许改"的可见显示，跟您手动加的锁各算各的）；非官方的卡您想锁就锁、想解就解。开发者眼里**所有卡默认都不锁**（包括官方，因为他本来就能改），只能手动锁/解，并且会加**批量自选锁定/解锁**。界面上**金色=官方锁、白色=手动锁**。锁只存在**您这台机器的本地**：不进源文件、不进对局、不进录像，也不参与自动化验证 ⇒ **这一刀不需要换基线锚**。而且锁是**每个玩家各算各的**，不存在"甲把乙的卡锁住"或"开发者替玩家上锁"。
- **一句自我更正**：您把"歧义就当场弹"改成"延后集中处理"，说明我在设计录入交互时默认了"打断不算成本"——以后凡是"每一行都可能弹一次"的方案，我会先问能不能延后合并成一次。

接下来开工顺序不变，且**四把地基刀（编号来源锁死、三层禁改、导入双入口、编辑器保护锁）都不碰玩法**，收线时都要逐字复现现在的对局基线 `{"1":112,"2":188}`。

**同日第四轮：您那句"身份应该允许修改"把我登记错的一条前提改了回来**

- 我原先按评审会话给的模型，把"编号、身份、来源"三样都定成**创建时定死、以后不许改**。您一句"创建时不小心把身份选错了或者忘记加身份了怎么办"点破了：**身份必须能事后纠正**，否则一张卡的"身份+势力"锁键被永久定错，只能删卡重建。⇒ 现在**永久不许改的只剩两样：编号 `id` 和来源 `source`（官方／玩家自制）**；身份和其他内容字段（名字、势力、血量、攻击、护甲、技能）一样可以改。
- **更该记下来的是我为什么会错**：这条"身份不可改"我登记之前**没有去查代码**，而**编辑器今天就在改身份**（保存时往这张卡的差异里写一条身份），v2.8.0 那次的真机验收还专门验过这个动作。也就是说，如果我照着旧文开工，**第一刀就会把您已经在用的功能砸掉**。⇒ 已把纪律升级成一句硬规矩：**以后凡是登记"某样东西不可变／做不到"这类断言，必须先去看写它的那一处代码**，外部评审给的是候选模型，不是现状事实。
- **身份可改之后配了三条护栏**（可改不等于随便改）：① 保存时跑一遍冲突检查，改完会和别的卡撞"身份+势力"的，**当场按"某某·势力"报给您看**，不会悄悄放行；② 所有历史修改都按**编号**挂着，所以改名、改身份都**不会让您以前的编辑脱靶**；③ 导出再导入仍沿用同一编号与来源，不会重新发号。
- **顺着这条查出的一件隐患**：现在"没填身份"的卡，系统会**拿它的名字当身份**⇒ 于是**给一张没填身份的卡改名，等于悄悄改了它的身份锁键**。处理方式定为：**新建卡时就把身份明确写进数据**（写的值可以就是当时的名字，锁键不变⇒**对对局零影响、不动基线**），以后改名就不再牵动身份；官方那 95 张保持现状不动（否则 95 条全要重写、还会搅动自动化对局的输入）。编辑器在您给"没填身份"的卡改名时会**黄字提示这会同时改变它的身份锁键**。


