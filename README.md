# 三国杀卡牌（Three Kingdoms Card Game）— Qoder 2.0

React + TypeScript 单页卡牌游戏。本仓库为主线开发仓库，与 `Qoder/1.29`（备份/发布线）相互独立、不共享提交历史。

## 快速开始

```bash
npm install --include=optional --ignore-scripts   # 安装依赖
npm run dev                                       # 本地开发服务器
npm run check                                     # TypeScript 类型检查
npm run test                                      # Vitest 单元测试（801 例 / 78 文件，2.8.15 时点；2.8.7 加 Excel 导入三态判别与候选保留 +7 例、2.8.8 加两把锁（写闸门＋录入面） +25 例、2.8.9 加仓库固定 DIY 样本与 poolSource 进料口 +12 例、2.8.10 加「留空身份可后续编辑」回归钉 +1 例、2.8.11 加「选择其一」两级门槛与置灰闭环 +19 例、复算后补整组门槛导出侧 +4 例，并撤销 2 例旧「整组拒录」断言、2.8.12 加导入「无变化跳过」与数值 0 往返保真 +19 例，其中含"权限优先于跳过"那条由第③闸查出的补钉、2.8.13 加数值 0 按类型收口与「全部」别名 +9 例、整只手勾选框按类型出现 +15 例、导入总结（纯函数 12＋组件接线 9）+21 例、2.8.14 把技能触发报表的名单改为"由桥接层载荷自证＋随实际池派生" +3 例、2.8.15 加词汇表 Excel 投影的四条守卫（表名合规／md 逐格落表＋零 markdown 残留／两次渲染字节全等／入库 xlsx＝当前 md 的投影）+4 例，这是第一组住在 `scripts/` 的文档工具测试）
npm run test:coverage                             # 测试 + 覆盖率（含棘轮阈值门禁）
npm run lint                                      # ESLint 检查
npm run build                                     # 生产构建 -> dist/index.html（2.3.3 起不再内嵌 npm install；依赖缺失时显式报错指路）
npm run ai-battle                                 # AI 随机对局跑器（命令行，见 2.2.4+；2.8.9 起可加 `--diy-fixture` 换用仓库固定 DIY 样本池＝锚 B11，默认仍是官方池＝锚 B10）
npm run glossary-xlsx                             # 从 PLAYER_GLOSSARY.md 重新生成 `词汇表.xlsx`（2.8.15 起；md 是唯一事实源，改过 md 必须重跑，否则 scripts/make-glossary-xlsx.test.mjs 那条"入库 Excel＝当前 md 的投影"守卫会让 npm test 变红）
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
- `PLAYER_GLOSSARY.md` — 玩家侧词汇表（术语｜大白话翻译｜留给你填；2.8.13 起。§七＝界面里其实没有的词，§八＝十条界面措辞与规则/引擎对不上的地方，逐条附代码出处；2.8.14 裁决并修好第 1 条＝补偿抽归阵亡方，余九条仍只报不修。**2.8.15 起这份表是唯一事实源，它的 Excel 版 `词汇表.xlsx` 由 `npm run glossary-xlsx` 生成**）
- `词汇表.xlsx` — 上面那份词汇表的 **Excel 投影**（2.8.15 起，文件名照用户原话「词汇表」）：9 张表＝`说明`＋八节各一张、共 **157 条词条**，表头冻结、第三列「你的理解」留给您填。**它由 `npm run glossary-xlsx` 从 `PLAYER_GLOSSARY.md` 生成，md 才是唯一事实源**：别在 Excel 里改前两列，您填在第三列的答案请抄回 md（重跑会覆盖 Excel）；测试里有一条守卫专门核对"入库的 Excel 是否等于当前 md 的投影"，改了 md 忘了重跑，`npm test` 就会红。
- `AGENTS.md` — AI 协作指令（技术栈、验证命令、模块地图）
- `CHANGELOG.md` — 版本年表
