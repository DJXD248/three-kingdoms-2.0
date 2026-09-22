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
