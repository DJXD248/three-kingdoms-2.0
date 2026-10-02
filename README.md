# 三国杀卡牌（Three Kingdoms Card Game）— Qoder 2.0

React + TypeScript 单页卡牌游戏。本仓库为主线开发仓库，与 `Qoder/1.29`（备份/发布线）相互独立、不共享提交历史。

## 快速开始

```bash
npm install --include=optional --ignore-scripts   # 安装依赖
npm run dev                                       # 本地开发服务器
npm run check                                     # TypeScript 类型检查
npm run test                                      # Vitest 单元测试（1008 例 / 86 文件，2.8.26 时点；2.8.26 数值修正器管线 ＝ 例数 946→1008（＋62 例＝三个新文件 43 例〔`core/statModifiers.test.ts` 19＋`skills/passiveModifiers.test.ts` 9＋`skills/statModifierPipeline.test.ts` 15〕＋既有文件扩例 19 例＝Excel 三格词表与严格往返、编辑器三格、四路对账、编译器四条点名跳过），文件数 83→86＝新增那三个；两锚 B13/B14 各两轮逐字节不变⇒**不换锚**，判据见 HANDOFF §12-91）；2.8.25 强制发动执法刀 ＝ 例数 939→946（新增 7 例＝`skills/reactionChain.test.ts` 新 describe 5 例〔两条路注册对账（含首枚 id 字节兼容）／事件表单一来源（含 `onTurnEnd` 不在表＝空）／探针⇄候选一致／纯 forced＝探针真·候选空·不开窗／forced 与非 forced 同节点〕＋`core/transitionEquivalence.test.ts` 新 2 例〔同一模板挂上开关⇒决斗两层都自动响完、四路逐事件一致／摘掉开关⇒两层都改为问人＝`forced` 是唯一判别位〕），文件数 83 未增。上一枚时点戳 2.8.24＝939 例（决斗刀 2 新增 1 例＝开局问讯延后专路：只立 opening 一声、答复回复计入起点、续跑两笔收官；另改写 2 例）；再往前 2.8.21＝900 例 / 81 文件，2.8.22 #71 执法刀把例数推到 938、文件推到 83 时本行曾漏更，已按现场读数更正并如实登记。历史逐版明细：2.8.7 加 Excel 导入三态判别与候选保留 +7 例、2.8.8 加两把锁（写闸门＋录入面） +25 例、2.8.9 加仓库固定 DIY 样本与 poolSource 进料口 +12 例、2.8.10 加「留空身份可后续编辑」回归钉 +1 例、2.8.11 加「选择其一」两级门槛与置灰闭环 +19 例、复算后补整组门槛导出侧 +4 例，并撤销 2 例旧「整组拒录」断言、2.8.12 加导入「无变化跳过」与数值 0 往返保真 +19 例，其中含"权限优先于跳过"那条由第③闸查出的补钉、2.8.13 加数值 0 按类型收口与「全部」别名 +9 例、整只手勾选框按类型出现 +15 例、导入总结（纯函数 12＋组件接线 9）+21 例、2.8.14 把技能触发报表的名单改为"由桥接层载荷自证＋随实际池派生" +3 例、2.8.15 加词汇表 Excel 投影的四条守卫（表名合规／md 逐格落表＋零 markdown 残留／两次渲染字节全等／入库 xlsx＝当前 md 的投影）+4 例，这是第一组住在 `scripts/` 的文档工具测试、2.8.16 把"演练技能注入默认关闭"钉住 +3 例（默认值＝0／四个种子各验将池零注入／显式调高仍每将一张）、2.8.17 加技能提示两档与「都不发动」唯一出口 +12 例（回合结束条目状态 5＋store 两档行为 7，其中一条钉的是**单一来源**＝合法集必须等于展示集按 activatable 过滤的结果）、2.8.18 加"旧词只进不出"与叠甲日志行 +3 例、2.8.19 徽章刀 1 +42 例＝徽章唯一读写口径 `src/domain/skillTags.test.ts` 23 例（含反向钉：锁定技的解释里不许出现"自动发动"）＋新 `SkillEditor.badges.test.tsx` 10 例（含**导出→再原样导入⇒徽章一枚不丢也不算改动**，导出侧 `file-saver` 拦截计数）＋`skillExcelParsers.test.ts` 33→42 例（多枚徽章、旧单值 `tag` 仍算无改动、尖括号三种写法、拼错点名）、2.8.20 决斗原语 +11 例（连续结算块的顺序与截断 4＋四路对账 2＋录入面"数值行整行缺席"3＋编译器与 Excel 读数各 1）、2.8.21 监听扩面刀 +28 例＝新 `skills/listenerScope.test.ts` 12 例（编译映射 6＋桥接消费走真实对局 6：默认只听自己／听己方同席位／听场上跨席位、来源三档、以及"打本营那条路今日仍然不响"的诚实钉）＋`skillExcelFormat.test.ts` +9 例（「我听谁」列的读写与不认识/挂不上时的三种点名）＋`skillExcelParsers.test.ts` +7 例（技能级与效果级两栏接线、旧 12 列文件逐字照旧、重导自己的导出＝零改动）；文件数 80→81（2.8.21），2.8.22 起到 83）
npm run test:coverage                             # 测试 + 覆盖率（含棘轮阈值门禁）
npm run lint                                      # ESLint 检查
npm run build                                     # 生产构建 -> dist/index.html（2.3.3 起不再内嵌 npm install；依赖缺失时显式报错指路）
npm run ai-battle                                 # AI 随机对局跑器（命令行，见 2.2.4+；2.8.9 起可加 `--diy-fixture` 换用仓库固定 DIY 样本池，默认官方池。锚名只记「命令＋池」，不记数值，换名账本见 PROJECT_ARCH_MAP.md §H10：2.8.16 起演练技能注入默认关闭⇒旧锚 B10 止于 v2.8.15；2026-10-01 审计更正轮起现行锚＝官方池 **B13**、样本池 **B14**（#71 响应链执法＝玩法变化，B12/B11 转历史，止于 v2.8.21））
npm run glossary-xlsx                             # 从 PLAYER_GLOSSARY.md 重新生成 `词汇表.xlsx`（2.8.15 起；md 是唯一事实源，改过 md 必须重跑，否则 scripts/make-glossary-xlsx.test.mjs 那条"入库 Excel＝当前 md 的投影"守卫会让 npm test 变红）
npm run ai-arena                                  # 三档策略互胜率擂台（见 2.2.7）
```

## Git 远程与推送

本仓库的 GitHub 远程**自 v2.8.7 起为公开**（此前是私有；转公开是为了清掉私有仓库 Actions 的额度阻塞），`1.29` 那条线仍是私有：

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

1. 本地验证（五闸）：`npm run check` / `test:coverage`（**已含全量测试＋覆盖率棘轮门禁，不再另跑 `npm test`**）/ `lint` / `build` 全通过；对局基线按影响面分级跑（改了结算或其输入＝双轮逐字，只改内容/文档/UI＝单轮读数，见 `PROJECT_RELEASE_PIPELINE.md` Step 1）。
2. 提交并按登记规则更新（2026-09-30 证据分层版）：**每个事实只有一个落点**——`PROJECT_HANDOFF.md` §3 一行提交索引、§9 是全仓库唯一的 CI 读数、`PROJECT_HISTORY_AI.md` 存完整证据（唯一详抄处）、`PROJECT_HISTORY_HUMAN.md` 8–12 行结论、`CHANGELOG.md` 3–6 行＋指针；周边 `README.md`/`AGENTS.md` 的易变数字带"as of 版本"戳；界面措辞变动同步 `PLAYER_GLOSSARY.md` 并重跑 `npm run glossary-xlsx`。长叙事的"周期收尾章"只在一条能力主线的几刀做完后写一次。
3. `git push origin master && git push origin --tags`。
4. GitHub Actions 自动运行 CI（lint+audit / Node 22 与 24 测试矩阵 / build），绿灯即远端验证通过。
5. Pages 网页公开部署默认关闭，仅手动触发（Actions 页面运行 "Deploy to GitHub Pages"，且需先在仓库 Settings -> Pages -> Source 选择 "GitHub Actions"）。

## 项目文档

- `PROJECT_HANDOFF.md` — 当前状态快照（规则、架构、版本、验证状态）
- `PROJECT_HISTORY_AI.md` / `PROJECT_HISTORY_HUMAN.md` — 历史迭代记录（AI 版 / 人读版）
- `PROJECT_ARCH_MAP.md` — 全项目地图：模块职责、权威边界、生命周期、确定性、验证级别（2.2.11 建，v2.2.10 基线）
- `PROJECT_RELEASE_PIPELINE.md` — 版本收尾登记流水线（权威版）
- `PLAYER_GLOSSARY.md` — 玩家侧词汇表（术语｜大白话翻译｜留给你填；2.8.13 起。§七＝界面里其实没有的词，§八＝十条界面措辞与规则/引擎对不上的地方，逐条附代码出处；2.8.14 裁决并修好第 1 条＝补偿抽归阵亡方，2.8.18 落地其余七条（含用户裁决第 3、4 句＝护甲 2 挡 1 写明白、"装备"改叫"军备"），第 9 条自 2.8.19 起为**半落地**＝徽章语义在词汇／录入／显示／核对四处已对齐，**结算那半处都不读 `tags`/`forced`**。**2.8.15 起这份表是唯一事实源，它的 Excel 版 `词汇表.xlsx` 由 `npm run glossary-xlsx` 生成**）
- `词汇表.xlsx` — 上面那份词汇表的 **Excel 投影**（2.8.15 起，文件名照用户原话「词汇表」）：9 张表＝`说明`＋八节各一张、共 **160 条词条**（2.8.17 起：§二 补上「🚫 都不发动」与完整档的灰条、§六 补上「技能提示＝智能／完整」；2.8.19 起：§四 按用户的徽章更正逐行改写并新增「徽章可以同时挂几枚」一行 ⇒ §四 25→26），表头冻结、第三列「你的理解」留给您填。**它由 `npm run glossary-xlsx` 从 `PLAYER_GLOSSARY.md` 生成，md 才是唯一事实源**：别在 Excel 里改前两列，您填在第三列的答案请抄回 md（重跑会覆盖 Excel）；测试里有一条守卫专门核对"入库的 Excel 是否等于当前 md 的投影"，改了 md 忘了重跑，`npm test` 就会红。
- `AGENTS.md` — AI 协作指令（技术栈、验证命令、模块地图）
- `CHANGELOG.md` — 版本年表
