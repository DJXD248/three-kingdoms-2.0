# 三国杀卡牌（Three Kingdoms Card Game）— Qoder 2.0

React + TypeScript 单页卡牌游戏。本仓库为主线开发仓库，与 `Qoder/1.29`（备份/发布线）相互独立、不共享提交历史。

## 快速开始

```bash
npm install --include=optional --ignore-scripts   # 安装依赖
npm run dev                                       # 本地开发服务器
npm run check                                     # TypeScript 类型检查
npm run test                                      # Vitest 单元测试（442 例 / 49 文件，2.5.3 时点）
npm run test:coverage                             # 测试 + 覆盖率（含棘轮阈值门禁）
npm run lint                                      # ESLint 检查
npm run build                                     # 生产构建 -> dist/index.html（2.3.3 起不再内嵌 npm install；依赖缺失时显式报错指路）
npm run ai-battle                                 # AI 随机对局跑器（命令行，见 2.2.4+）
npm run ai-arena                                  # 三档策略互胜率擂台（见 2.2.7）
```

## Git 远程与推送

本仓库使用 GitHub **私有**远程（非公开，仅账号所有者可见）：

```
origin -> https://github.com/DJXD248/three-kingdoms-2.0
```

### 网络与代理（推送连不上 GitHub 时看这里）

本开发机到 GitHub 的链路会波动：有时直连可用，有时只有经本机代理 `127.0.0.1:10808`（系统代理，浏览器访问 GitHub 同走此口）才通。**不要**把代理写死进 Git 配置（代理软件关闭时反而推不动），按下面顺序处理：

```bash
# 1) 先直接推
git push origin master

# 2) 若报 "Failed to connect to github.com:443"，改走代理推（一次性，不留配置）
git -c http.proxy=http://127.0.0.1:10808 push origin master

# 快速自检哪条路通（200 即可用）：
curl -sI --max-time 10 https://github.com -o /dev/null -w "direct: %{http_code}\n"
curl -sI --max-time 10 -x http://127.0.0.1:10808 https://github.com -o /dev/null -w "proxy: %{http_code}\n"
```

- 用 gh CLI（如查看 CI）同理，代理不通时不带变量、代理可用时加 `HTTPS_PROXY=http://127.0.0.1:10808`。
- gh 登录采用设备码流程：`gh auth login --hostname github.com --git-protocol https --web`，按提示在 `https://github.com/login/device` 输入验证码；推送 `.github/workflows/` 文件需要 token 具备 `workflow` 权限（`gh auth refresh --hostname github.com --scopes workflow`）。

### 日常迭代流程

1. 本地验证：`npm run check` / `test` / `lint` / `build` 全通过。
2. 提交并按登记规则更新：核心三份 `PROJECT_HANDOFF.md`、`PROJECT_HISTORY_AI.md`、`PROJECT_HISTORY_HUMAN.md`；同时核对周边三份 `README.md`、`AGENTS.md`、`CHANGELOG.md` 的数字与模块清单是否过时（2.2.11 起纪律，见 `PROJECT_RELEASE_PIPELINE.md`）。
3. `git push origin master && git push origin --tags`。
4. GitHub Actions 自动运行 CI（lint+audit / Node 22 与 24 测试矩阵 / build），绿灯即远端验证通过。
5. Pages 网页公开部署默认关闭，仅手动触发（Actions 页面运行 "Deploy to GitHub Pages"，且需先在仓库 Settings -> Pages -> Source 选择 "GitHub Actions"）。

## 项目文档

- `PROJECT_HANDOFF.md` — 当前状态快照（规则、架构、版本、验证状态）
- `PROJECT_HISTORY_AI.md` / `PROJECT_HISTORY_HUMAN.md` — 历史迭代记录（AI 版 / 人读版）
- `PROJECT_ARCH_MAP.md` — 全项目地图：模块职责、权威边界、生命周期、确定性、验证级别（2.2.11 建，v2.2.10 基线）
- `PROJECT_RELEASE_PIPELINE.md` — 版本收尾登记流水线（权威版）
- `AGENTS.md` — AI 协作指令（技术栈、验证命令、模块地图）
- `CHANGELOG.md` — 版本年表
