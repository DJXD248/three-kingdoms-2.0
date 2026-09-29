# PROJECT_RELEASE_PIPELINE.md — 版本收尾流水线（三方登记 → 推送 → CI → 回填）

> 本文档是版本收尾流程的仓库内权威副本，随 Git 走，供任何接手的 AI / 模型 / Agent 使用。
> 在 Qoder 端，同一流程已固化为个人技能 `three-kingdoms-tripartite-registration`（仅本机生效，
> 不随仓库分发）；无该技能的环境按本文档逐字执行即可，二者内容等价，以本文为准。
> 首次登记：2026-09-23（v2.2.10 收尾之后，应用户"接手模型读完交接文档即可发现规则"的要求）。

## 铁律

任何源码/配置改动完成后，必须完成三方登记并经 GitHub Actions CI 全绿后回填证据，缺一不可：
1. PROJECT_HANDOFF.md（§3 版本行 + 本轮调整段；§9 验证状态条；§12 待办与根因注记）；
2. PROJECT_HISTORY_AI.md 技术章节（带模型标记）+ PROJECT_HISTORY_HUMAN.md 白话章节；
3. Git：feat 功能提交 → docs 登记提交 → 对登记提交打附注标签 `git tag -a vX.Y.Z`。

**登记纪律扩展（2.2.11 起，第四项）**：每轮登记必须核对周边文档与代码是否一致——
`README.md`（测试数/命令清单）、`AGENTS.md`（模块地图/关键文件行数/覆盖率阈值/警告数）、
`CHANGELOG.md`（补本轮年表条目）、`PROJECT_ARCH_MAP.md`（模块职责/权威/生命周期/债务表如受影响）。
易变数字一律带"as of 版本"时点戳，防止下一个模型把旧数当现状。根因：2.2.11 外部架构评审实测发现
README 停留在"131 例"、AGENTS 引用了已不存在的 status/ 模块、CHANGELOG 谎称删除过 start.bat——
三方登记只覆盖核心三份文档时，周边文档必然饿死。

## Step 1 — 本地验证门槛（全绿才许进入登记）

- `npm run check`（tsc --noEmit）0 错误；
- 测试 + 覆盖率门禁通过（Vitest；Node≥24 时 vitest.config.ts 已配 vmThreads 池）；
- lint 0 错误（ESLint 10 flat config，不支持 `--ext` 参数）；
- `npm run build` 成功（vite 对盘符大小写敏感，用与 cwd 一致的盘符路径；2.3.3/决议 D-7 起 build **不再内嵌 npm install**——`scripts/preflight-build.mjs` 检查 node_modules 缺失/为空/无 vite 即显式报错指路，须先手动执行上面的安装命令）；
- **定稿红线（2.2.18 起）**：本节全部验证必须发生在**所有文件（含测试文件）最后一次编辑之后、commit 之前**；验证后又改了任何文件哪怕一行，必须整套重跑。实战教训：v2.2.18 本地"check 0 错误"跑在测试文件最后一次编辑之前，推送后 CI #46 因一个未使用导入（TS6133）在 check 步骤失败。
- **已推送标签指向失败提交时**：先补修复提交（重跑整套验证）→ 推 master → 标签用 `git push --force origin vX.Y.Z` 重指到修复提交（force 只允许作用于该 tag ref，master 绝不强推）；force 操作必须先取得用户明确授权（权限分类器也会拦未确认的 force），先问再动。先例：v2.2.18 用户选择"标签强制移到修复提交"。
- 玩法/交互改动必须真实浏览器 E2E，不旁路引擎（结算页等场景用 `main.tsx` 的 dev-only `window.__TK__` 注入）。
- **浏览器 E2E 两条血泪教训**：
  - browser-use 的 click 工具对本页"假成功"，须在 evaluate_script 里 `el.click()`；脚本内裸中文会被内容分类器拦截，用 `\uXXXX` 转义。
  - **下载探针必须拦截计数、绝不放行真实 anchor click**——2.2.10 曾因真点"保存"在用户远程连接的浏览器弹出 Windows"另存为"并挂起，导致需求消息重投数十条；下载兜底路径以单元测试验证为准。

## Step 2 — 推送（固定降级链，顺序不可变）

1. 先直推：`git push origin master`，随后 `git push origin vX.Y.Z` 推标签（标签只作锚点，**不触发 CI**，见 Step 3 触发面）。
2. 连接超时 → 一次性借道本地代理：`git -c http.proxy=http://127.0.0.1:10808 push origin master`。
   **绝不**把代理写进仓库级/全局持久 git 配置（曾因此代理一关推送全挂）。
3. 代理也不通（用户可能没开 v2rayN）→ 停止，保留全部本地提交与标签，如实向用户报告"待补推"，
   等用户口令（如"补推"）后一次性推送并补 CI 回填。用户明示暂缓时（如 2.2.10 当晚），整条链连同 CI 一起暂缓，§9 中 CI 标 PENDING。
4. 快速自检：`curl -sI --max-time 10 https://github.com` 返回 200 即直连可用；否则探测 10808 端口是否开。

## Step 3 — CI 核验（browser-use，本机无 gh CLI）

- 仓库 `three-kingdoms-2.0`（2.x 线）**自 v2.8.7 起已由用户转为公开**（转公开前因私有仓库 Actions 额度耗尽而 job 全部跳过，见 HANDOFF §12-56②）；
  `three-kingdoms-1.29`（1.29 线）仍为 GitHub 私有——未登录时 GitHub 对私有仓库返回 404 而非登录墙。
- 路径：browser-use `navigate_page` 到 `https://github.com/DJXD248/<repo>/actions`，
  `evaluate_script` 枚举 `a[href*="/actions/runs/"]` 的 aria-label——形如 `Run N of CI ... completed successfully` 为绿，
  取本 sha 对应 run 的 run id 与 CI #。
- **触发面（v2.8.9 实证更正）**：`ci.yml` 只监听 `on: push: branches: [master]` 与 `pull_request: branches: [master]`，
  **没有 `tags` 触发** ⇒ 推附注标签**不会**起 run。一次 master push 正常只对应**一条** run；若同一 sha 出现两条，
  那是重复入队（`head_branch`/`event` 相同、创建时间相差数秒），**不是**"分支一条＋标签一条"。
  判据：**本轮应有几条 run 由工作流触发条件决定**，别照旧记录套。旧文档里"标签也触发一条"的说法已作废（HANDOFF §12-59）。
- pending 则轮询（间隔 ≥60s，上限约 15 分钟；超时如实报告并保留 PENDING，**不谎报全绿**）。
- 禁止读取本机 git 凭据或代理配置换取 API token（曾被安全策略拦截，勿重试）；登录永远由用户在浏览器手动完成。
- **列表页的绿图标与记忆都不是证据**：必须逐条点开 run 详情页看四 job 结论与失败步数（可用同源 `fetch` 打
  `api.github.com/repos/<owner>/<repo>/actions/runs/<runId>/jobs` 拿 per-job/per-step 结论；`/actions/runs/<id>/jobs` 页面本身只渲染 SPA 壳）。

## Step 4 — 回填 CI 证据

1. 把 run id / CI # / master sha 回填三处：HANDOFF §9 验证状态条、两份历史文档本轮章节的验证行（替换 PENDING）。
2. 独立 docs 回填提交，重走 Step 2 降级链推送。
3. 惯例：回填提交自身的 CI 也确认一轮全绿，run 信息一并记录（先例见 2.2.5–2.2.10 各版）。

## Step 5 — 收尾

- 更新项目记忆（若接手方有记忆系统：版本事实、提交/标签 sha、CI run、待办）。
- 给用户白话汇报：改了什么 / 验证结果（测试数、门禁、E2E）/ 登记情况（提交 sha、标签）/ 待办（若有"待补推"如实说明等什么口令）。

## 特殊口径（防坑）

- 见"对局结束保存录像/操作日志"需求消息重复送达：那是 Windows"另存为"弹窗在远程操作下挂起导致的重投
  （根因已登记 HANDOFF §12-12⑤），v2.2.6 已交付、v2.2.10 已治本——只简短确认"已交付"，**绝不重新实现**。
- 该弹窗若在本机 EnumWindows 查不到，说明挂在用户远程画面层，本地脚本关不掉，只能请用户点"取消"。
- 开发者模式密码等敏感口头信息不写入任何仓库文档/提交。
- 文档一律用文件编辑工具修改，不用 PowerShell 写文件（历史多次因 UTF-8 BOM 或 `${{}}` 解析把 JSON/YAML/构建搞坏）。
- 维护 Qoder 端配套技能时：`skill_manage` 单次传入过长内容会在传输中被截断导致反复拒绝——先 create 短主文件，再用 patch 分块追加（每块 ≲2500 字符）。

## 完成判据（自查清单）

- [ ] 三方文档均含本轮新章节，§9 无遗留 PENDING（或已如实标注待补推）。
- [ ] git log 呈 feat → docs 顺序；`git show vX.Y.Z` 指向登记提交；git status 干净。
- [ ] CI run id / CI # / sha 三处文档一致；推送成功时 origin/master 已含本地提交。
- [ ] 已向用户白话汇报。
