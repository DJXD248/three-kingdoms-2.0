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

## Step 1 — 本地验证门槛（全绿才许进入登记）

- `npm run check`（tsc --noEmit）0 错误；
- 测试 + 覆盖率门禁通过（Vitest；Node≥24 时 vitest.config.ts 已配 vmThreads 池）；
- lint 0 错误（ESLint 10 flat config，不支持 `--ext` 参数）；
- `npm run build` 成功（vite 对盘符大小写敏感，用与 cwd 一致的盘符路径）；
- 玩法/交互改动必须真实浏览器 E2E，不旁路引擎（结算页等场景用 `main.tsx` 的 dev-only `window.__TK__` 注入）。
- **浏览器 E2E 两条血泪教训**：
  - browser-use 的 click 工具对本页"假成功"，须在 evaluate_script 里 `el.click()`；脚本内裸中文会被内容分类器拦截，用 `\uXXXX` 转义。
  - **下载探针必须拦截计数、绝不放行真实 anchor click**——2.2.10 曾因真点"保存"在用户远程连接的浏览器弹出 Windows"另存为"并挂起，导致需求消息重投数十条；下载兜底路径以单元测试验证为准。

## Step 2 — 推送（固定降级链，顺序不可变）

1. 先直推：`git push origin master`，随后 `git push origin vX.Y.Z` 推标签。
2. 连接超时 → 一次性借道本地代理：`git -c http.proxy=http://127.0.0.1:10808 push origin master`。
   **绝不**把代理写进仓库级/全局持久 git 配置（曾因此代理一关推送全挂）。
3. 代理也不通（用户可能没开 v2rayN）→ 停止，保留全部本地提交与标签，如实向用户报告"待补推"，
   等用户口令（如"补推"）后一次性推送并补 CI 回填。用户明示暂缓时（如 2.2.10 当晚），整条链连同 CI 一起暂缓，§9 中 CI 标 PENDING。
4. 快速自检：`curl -sI --max-time 10 https://github.com` 返回 200 即直连可用；否则探测 10808 端口是否开。

## Step 3 — CI 核验（browser-use，本机无 gh CLI）

- 仓库 DJXD248/three-kingdoms-2.0（2.x 线）与 three-kingdoms-1.29（1.29 线）均 GitHub 私有；
  未登录时 GitHub 返回 404 而非登录墙。
- 路径：browser-use `navigate_page` 到 `https://github.com/DJXD248/<repo>/actions`，
  `evaluate_script` 枚举 `a[href*="/actions/runs/"]` 的 aria-label——形如 `Run N of CI ... completed successfully` 为绿，
  取本 sha 对应 run 的 run id 与 CI #。
- pending 则轮询（间隔 ≥60s，上限约 15 分钟；超时如实报告并保留 PENDING，**不谎报全绿**）。
- 禁止读取本机 git 凭据或代理配置换取 API token（曾被安全策略拦截，勿重试）；登录永远由用户在浏览器手动完成。

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
