# 三国杀卡牌（Three Kingdoms Card Game）— Qoder 2.0

React + TypeScript 单页卡牌游戏。本仓库为主线开发仓库，与 `Qoder/1.29`（备份/发布线）相互独立、不共享提交历史。

## 快速开始

```bash
npm install --include=optional --ignore-scripts   # 安装依赖
npm run dev                                       # 本地开发服务器
npm run check                                     # TypeScript 类型检查
npm run test                                      # Vitest 单元测试（131 例）
npm run test:coverage                             # 测试 + 覆盖率（含棘轮阈值门禁）
npm run lint                                      # ESLint 检查
npm run build                                     # 生产构建 -> dist/index.html
```

## Git 远程与推送

本仓库使用 GitHub **私有**远程（非公开，仅账号所有者可见）：

```
origin -> https://github.com/DJXD248/three-kingdoms-2.0
```

### 本机代理配置（重要）

本开发机直连 `github.com:443` 会超时，需要通过本机代理 `127.0.0.1:10808`（系统代理，浏览器访问 GitHub 同走此口）。已为本仓库写入 Git 配置：

```bash
git config http.proxy http://127.0.0.1:10808
git config https.proxy http://127.0.0.1:10808
```

- 查看：`git config --get http.proxy`
- 临时不走代理（代理软件未开启且直连可用时）：`git -c http.proxy= -c https.proxy= push origin master`
- 用 gh CLI（如查看 CI）时需带环境变量：`HTTPS_PROXY=http://127.0.0.1:10808 gh run list`
- gh 登录采用设备码流程：`gh auth login --hostname github.com --git-protocol https --web`，按提示在 `https://github.com/login/device` 输入验证码；推送 `.github/workflows/` 文件需要 token 具备 `workflow` 权限（`gh auth refresh --hostname github.com --scopes workflow`）。

### 日常迭代流程

1. 本地验证：`npm run check` / `test` / `lint` / `build` 全通过。
2. 提交并按三方登记规则更新 `PROJECT_HANDOFF.md`、`PROJECT_HISTORY_AI.md`、`PROJECT_HISTORY_HUMAN.md`。
3. `git push origin master && git push origin --tags`。
4. GitHub Actions 自动运行 CI（lint+audit / Node 22 与 24 测试矩阵 / build），绿灯即远端验证通过。
5. Pages 网页公开部署默认关闭，仅手动触发（Actions 页面运行 "Deploy to GitHub Pages"，且需先在仓库 Settings -> Pages -> Source 选择 "GitHub Actions"）。

## 项目文档

- `PROJECT_HANDOFF.md` — 当前状态快照（规则、架构、版本、验证状态）
- `PROJECT_HISTORY_AI.md` / `PROJECT_HISTORY_HUMAN.md` — 历史迭代记录（AI 版 / 人读版）
- `AGENTS.md` — AI 协作指令（技术栈、验证命令、模块地图）
