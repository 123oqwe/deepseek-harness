# First-100 Maintainer 批复记录

- **批复人：** 用户本人（maintainer，GitHub: 123oqwe）
- **批复时间：** 2026-08-31 10:50 EDT
- **批复原文（逐字）：** 「按推荐全批」
- **批复对象：** `deepseek-first100-sdd-audit/maintainer-decision-queue-2026-08-30.md`
  - sha256: `afdf3df8be583c9abc5170bf1f7226fa1d9066c027eb065a2534ae6f2512421d`
  - byteLength: `16904`
- **效力：** 队列中 A1–A5、B1–B7、C0–C5 全部条目按各自"推荐"值生效。C0 的选线结果：采用 claude 线执行；codex 规划会话已由用户停止（文件活动截至 2026-08-31 00:24，经核实 10+ 小时无写入）；v7/lean 归档为设计参考。
- **修订通道：** 任何条目的后续更改需用户新的显式批复，追加到本文件末尾（append-only），不得改写本记录。
- 下方为批复时点的队列全文逐字副本（自包含存档；如与上方 sha256 对应的源文件冲突，以源文件字节为准）。

---

# Maintainer 决策队列（2026-08-30，planner 汇总；同日晚经 18-agent 可执行性审计修订）

> 性质：待用户（=maintainer）一次性批复的全部悬置决策。每条给出推荐默认值；回复"按推荐全批"即可全部生效，也可逐条改。批复原文应粘贴进执行分支 `spec/first100/exec/decisions-approved.md`（或 codex 侧对应 approved 记录），此后各规划文件里的对应 BLOCKED 项解除。
> 本文件不是执行合同，不授权任何产品写入。与 `v7/lean/PROGRAM-DECISIONS.candidate.json` 的 D0–D3 是同一批实质问题的可读版；批复一次即可同时供两个规划线（codex / claude）消费。
> **修订说明：** 2026-08-30 晚以 6 个真实 Sonnet 冷启动探针 + 5 轴红队 + 合成判决（GO_WITH_FIXES）对本队列做了可执行性压力测试；以下条目中标注 ⟦审计修订⟧ 的内容来自该审计的 BEFORE_W1 修复清单，证据见审计工作流记录。

## A. 基线与仓库（阻塞 W0/BASE-ALIGN）

**A1. 实施基线。** 现基线 `b150a551` 落后上游 1,313 commits（6,808 文件，实测 2026-08-30）且带 3 个确定性红测试；上游为 push-mirror（issues/PR 关闭，永无法上提 PR），fork-only 是常态。审计实测基线已**三方歧义**：registry 冻结 `b150a551`、本队列候选 `cd5ef814`、上游实时 tip 已到 `0a53fb55`（git ls-remote 2026-08-30 晚）。
推荐：批准以执行启动当日的上游 master 最新 SHA 为新实施基线（启动时刷新一次并冻结）；`b150a551` 降级为审计出处。
⟦审计修订⟧ BASE-ALIGN 必须**同一提交内物化**，缺一即 BLOCKED：① 从新基线切 `first100-exec` 分支；② 更新 `tests/first100/registry.json` 的 `frozenBaseline` 并重新生成 `spec/first100-generated-digests.json`；③ 删除或同步仓库内**旧版分叉副本** `spec/first100/sources/implementation-wave-map.md`（实测其 W1 准入语义与 audit 目录权威版矛盾——无上下文的 subagent 会先找到错的那份），全树只留一个版本；④ 提交一条签名的 R0 gate 关闭/覆盖记录，显式取代 `docs/audit/baseline-b150a551.md` 里已入库的"W1 remains BLOCKED"判定（现 R0 gate = 2 OPEN + 2 ABSENT；没有该记录任何 W1 slice 不得开始）。

**A2. 基线红测试处置。** 3 个 terminal/pwsh 测试在基线上确定性失败（fork CI 33068803755 / 33256815163 已 2/2 复现）。审计补充实测：**本机未装 pwsh，这 3 个失败在本地整体 skip、不可见**——本地全绿永远不能当证据。
推荐：BASE-ALIGN 后在新基线复测；若仍红，作为 W0 修复项真实修掉（其一是真实 scrollback 缺陷）；禁止 allowlist/skip/retry-to-green。全量结果一律以 fork Linux CI 的**失败集合对照**（相对已记录的 3-失败基线）判定，不用裸 exit code。

**A3. Fork 卫生。** 实测：fork 上 95 个 PR 全部 OPEN（0 关 0 合）、94 条 `feat/p*` 分支冻结于 08-22、master 落后上游 2,167、最近 15 次 CI 运行 0 绿、每次 PR 事件另有 4 条必红噪音 workflow（Release dsh / Release vendor / Issue policy / Issue lifecycle）。
推荐：① 批量 close 全部 95 个 PR（留言"superseded by first100-exec 重启"，分支暂留作取证，不删）；② fork master 硬同步到上游 master；③ PR 事件屏蔽 4 条噪音 workflow（改 trigger 条件，不删文件）。

**A4. 任意 SHA CI 通道。** 实测：现有 `ci.yml` 的 workflow_dispatch 只能跑 benchmark，测试 job 只在 pull_request 触发；两条 R0-5 workflow 硬 pin `b150a551` 单分支。全 fork 不存在"对指定 SHA 跑全量测试"的通道。
推荐：批准新增一条 `first100-exact-sha.yml`：`workflow_dispatch(inputs.sha)` + `push: branches: [first100-exec]`，checkout 精确 SHA、`persist-credentials: false`、跑 install/typecheck/test（Linux 必选）。这是唯一新增的 CI 文件。
⟦审计修订⟧ 红队实锤两条可作弊路径，一并封死：① 现有 attestation **签名私钥放在本机**（`~/.config/dsh-first100/first100-signing.key`）且每个 subagent 可读、而 verify 从不重跑被冻结命令——Writer 可凭签名伪造 GREEN。改为：签名密钥只存 GitHub secret，由该 workflow 内的 job（issue-runner + verify）签发；本机旧私钥轮换作废。② 立规：**ledger 格只能由该 workflow 在 candidate SHA 上产出的 observation artifact 点绿；本地签名 observation 一律只是 advisory**。

**A5. Secrets 与基础设施工作流。** 实测 fork secrets/variables 均为 0。
推荐：W1–W7 不配真实 API key（用不到，安全）；进入 R10/Q3 前再配 `DEEPSEEK_API_KEY_EXTERNAL` 等并单独批预算。
⟦审计修订⟧ 红队计数：约 7 个 epic 的 F 阶段**本机物理不可验**（P1-06 microVM、P3-01/05/07/08/09 容器/隔离/跨平台、P6-08 KMS/residency）。现在就开基础设施工作流、赶在 **W8 之前**落地：GitHub Actions matrix 加 windows runner + ubuntu `/dev/kvm`（microVM smoke）+ rootless 容器运行时 + 测试专用 KMS 凭证。未就绪期间这些 F slice 按铁律 5 记 **scheduled-BLOCKED（写明缺项）**，不阻塞所在 wave 关账；P9-02/P9-08 的 live lane 同理单列。

## B. 规格冻结（阻塞 91 条验收命令与 17 阈值）

**B1. 17 项阈值提案**（`spec/first100-thresholds.yaml`，含 P1-06 RPC p95≤10ms、P8-10 RPO=0/RTO≤5min、Q3 Wilson 下界规则等）。
推荐：按提案原文全批。数值均有工程依据，且改小改大都有明确再批通道。

**B2. 33 个 layer 裁决 + 100-ID layer mapping**（registry 当前 67 AGENT_A_PROPOSED / 33 PENDING）。
推荐：按 registry 现值全批（L0:1 / L1:17 / L2:62 / L3:5 / L5:6 / L6:9），`layerSourceGap=1` 的那项按 L2_PROVIDER 定。

**B3. Owner map**（91 项 UNASSIGNED_UNTIL_APPROVAL）+ manifest v1.1 签署 + 156 条注入 boundary 条款。
推荐：canonical owner 直接取每项 primaryLayer 对应包的路径 owner（registry files[] 已定），manifest v1.1 按现文件内容签署生效；clause-coverage 报告（epics 100/100、channels 300/300、unmatched 0）中 156 条 `inventedDocumentedDefaultBoundaryClauses`（78 个无源 non-goal 的注入默认边界句）随签署一并批准为规范文本。

**B4. 91 条缺失验收命令的物化规则。** 源文"不得猜"针对的是**事后**补命令冒充验收；正确通道是**事前冻结**。
推荐（⟦审计修订⟧ 全文替换原推荐）：
(a) `spec/first100/exec/command-freeze.json` 是**唯一**生产 command 真相源，显式标记取代旧 `spec/first100-command-registry.json`（审计实锤旧表已腐烂：引用不存在的 `first100:issue` npm script、flag 语法与 issue-runner 实际 positional CLI 矛盾）；verifier 的 expectedCommandResolver 只准读 freeze 文件；
(b) `(epic, stage)` 唯一键，先冻先得，重复条目作废整条；
(c) `expectCases` 从纯计数改为**具名 case 标题清单，与该项 acceptance[] 条目 1:1 映射**；argv 冻结 verbose reporter，verifier 在哈希过的原始日志里逐标题 grep——封死"1 个恒真用例点亮全格"的作弊面；
(d) 冻结前必须**dry-run**：argv 在未改动树上、指定 vitest config 下能发现 ≥1 个测试（审计实锤 P6-06 探针冻的 argv 因 e2e 需要 `vitest.e2e.config.ts` 而发现 0 测试）；
(e) registry 的 `fixtures{}` 模板路径（`tests/first100/fixtures/…`，全部不存在）宣告**作废占位**；被冻测试文件必须落在该项 `files[]` 内（append-only overlay 补充）；
(f) 全新 [N] 包的脚手架文件（package.json/tsconfig.json/README.md/src/invariant.ts，仓库规范强制）自动并入该项 C slice、**不占 1–5 文件上限**（经 v1.1 manifest patch 补记）；前置 epic 拥有的 contract 类型尚不存在时一律 BLOCKED，**禁止跨项造 stub**。
配套：`spec/first100/exec/command-freeze.schema.json` 进 A4 workflow 做 schema + append-only diff 机检。

**B5. RED 语义与"W1 前全绿"矛盾。**
推荐（⟦审计修订⟧ 强化原推荐）：RED 观察在 attempt 分支完成、不进 wave 关账树（原案保留）；且 RED 必须是**parent SHA 上的签名 observation artifact**（expectExit≠0、failed≥1），其原始日志必须显示与后续 GREEN 相同 case 标题的**断言失败**；仅含 `Cannot find module / is not defined / SyntaxError` 的红无效（审计实锤"假 RED"路径）。全新 [N] 包先落无行为 stub 脚手架，再采集 behavioral RED（否则 RED 只能是模块收集错误）。

**B6. A/B/C/D 图例。** 已于 2026-08-30 在 `100-row-program-ledger.md` §4 顶部定死（A/B/C/D = C/P/U/F 四阶段）。
推荐：确认即可。

**B7. 证据格与 U 阶段强化（⟦审计修订⟧ 新增；因 `implementation-wave-map.md` 被 codex charter 按 SHA 钉住，本条与 ledger §4 为该修正的权威落点）。**
推荐：① **两个 ledger 格不得引用同一份 observation 文件**；每格的冻结 case-标题集必须 stage 专属（审计实锤 P0-02 的 C 与 F 是同一条 vitest 命令，单文件可合法点亮多格）；② D（=F-stage）格必须覆盖该项每条 acceptance[] 与 validation[] 动作，或逐项记 BLOCKED；③ U（=composition）fixture 必须经启动后的 keyless profile 走**一次端到端行为往返**（经公共 service 调用、断言可观测效果 + provider 侧回执/审计事件）；"真注册 + no-op provider"列入 merge blocker。

## C. 执行形态（阻塞"谁来跑"）

**C0. 先选线并停另一条（2026-08-30 深夜补充；实测最紧急）。** 事实：codex root session（343MB，自 8/24 连跑）此刻仍在重写 v7/lean——validate-plan.mjs 已 1.68MB，最近 80MB 会话里 118 次 coreReady 全为 false（最新 22:45 仍红）；你 18:40–18:55 四次改 goal（含"不要过度写、最少 token"）**没有让它收敛**——它的完成门（default 验证器全绿 + 两次 fresh review）被它自己的对抗子代理持续加码，结构性后退；且它的 planning subject 是冻结文件清单，**看不见本队列与 claude 线的任何文件**，goal 文本也缩不掉已经存在的 1.68MB 验证器。它会一直跑到你手动停止为止。
推荐：**立即二选一**——(a) 采用 claude 线（本队列 C1–C5）：手动终止 codex 会话（Ctrl-C 或把其 goal 改为"seal 当前状态并停止，不再修改任何文件"），v7/lean 归档为设计参考；(b) 采用 codex 线：本队列 C1/C2/C4/C5 作废，但 A（基线/CI）与 B（规格冻结）仍需批复且对两线通用，并需为 codex 线解决其 B04 adapter 死锁。**禁止两线同时进入执行**（它们的 spec/first100/ 写入路径互斥：codex R0-F1 要 vendor 它批准的字节，claude W0 要建 exec/ 子目录）。不选线，每小时都在烧 token 且未来必然相撞。

**C1. 执行角色形态。** 推荐：Claude Code 原生三角色——主会话只读 Supervisor + 每 slice 新 Writer subagent + 每 candidate 新 Reviewer subagent；写码全在 `first100-exec` 分支；五条反假规则（命令事前冻结 / writer≠reviewer / 禁手写状态 / exact-SHA 真 CI / 不确定即 BLOCKED 禁猜）。不建 adapter、不建 charter promotion、不建 bootstrap controller。
⟦审计修订⟧ ① ledger 生成器定名 `scripts/first100/generate-ledger.mjs`：输入 = vitest `--reporter=json` 输出 + CI run URL，输出头部带 generated-by + 输入 digest（手改可检出）；W0 建成。② **Reviewer 分级矩阵（强制）**：primaryLayer 为 L0/L1、回滚代码 K/D、或 acceptance 含崩溃/并发/exactly-once/单调安全语义的 epic（至少 P0-02、P2-05、P4-06、P4-08、P6-07）——Reviewer 用 Opus 级模型，或两个持不相交对抗清单的 Sonnet Reviewer；并做**播种突变检**（reviewer 植入一个 bug，冻结测试套件必须杀死它，否则 review 不完整）。同族模型互审的共享盲区只有突变检能转化为证伪。③ Writer 只拿 **slice 信封**：该 stage 的 ≤5 files[] + 冻结 argv + 相关 must/acceptance 摘录，**永不给整 epic 上下文**（29 个 epic ≥10 文件，整 epic 上下文是实测的 scope 漂移源）。④ Supervisor 不得在无 maintainer 记录的情况下推翻 subagent 的 BLOCKED（6 个探针中 Sonnet 的 canStart=false 全部正确——残余风险是后续会话把正确的 BLOCKED"修"成继续干）。
**与 codex 线的关系由用户裁决：** 若继续让 codex 完成 v7/lean 控制面，则此条作废、以 codex 产物为准；若采用本条，codex 线转为只读顾问。两线不得同时对同一分支写码。

**C2. Compact 防漂移。** 推荐：repo 内 `.claude/goal.md` 三行锚（GOAL/NOW/RULES）+ 每次 compact/新会话后强制先读 goal.md → EXEC-STATE.json → ledger 当前行 → registry 当前项，会话记忆一律不作数。
⟦审计修订⟧ 红队实锤此设计"仅在纸上"，W0 必须接线：① PreCompact hook **当前未注册**于任何 settings 文件——注册之；hook 脚本用 `git rev-parse --show-toplevel` 解析 goal 文件（现按 `$(pwd)`，且 `~/.claude/goal.md` 里躺着**别的项目的旧 goal**——一旦接线会把错误目标以最高优先级注入，比没有更糟）；② `EXEC-STATE.json` 正式定义：路径 `spec/first100/exec/EXEC-STATE.json`（first100-exec 分支内），**只由 Supervisor 在 slice 边界写**，schema 存 `first100-exec-state.schema.json`（currentWave、currentSlice{epic,stage}、frozenBaselineSha、activeWorktree、activeBranch、ledger/registry digests）；EXEC-STATE、ledger、command-freeze 三者任何不一致 = BLOCKED；③ 每个会话第一动作校验 `git rev-parse --show-toplevel` == activeWorktree（实测本机现有 **4 个并行 worktree**、其中 2 个带过期"launch-ready"控制器状态文件：`ACTIVE-SLICE.json`/`CURRENT_HANDOFF.json` 盖 SUPERSEDED_DO_NOT_LAUNCH 戳、未选中的 worktree 清理）；④ goal.md 的 RULES 行加自检：hook 未注册 ⇒ BLOCKED。

**C3. Gap epics（第 101–109 项，P9-01…09）。** 见 `first100-requirements-matrix-extension-101plus.md`（已按矩阵原格式写全 9 项，全部锚定代码级实证；判断依据见 `capability-gap-analysis-2026-08-30.md`）。
推荐：批准进入 W20–W22 排序；并单独批准"P9-01…07 与 R10 无依赖，可提前并行（不计入 100/100 门）"。
⟦审计修订⟧ 前置条件（Stage-0 registry extension）：任何 P9 slice（含提前并行）开始前，先把扩展矩阵 vendored 进 `spec/first100/sources/`（SHA 钉住）、解除 `extract-registry.mjs` 的硬锁（恰好 100 节、wave 1..19）、按同 schema 生成 P9-01…09 的 registry 行（files[]/acceptance/W20–W22；或平行的 `registry-extension.json`）+ wave-map W20–W22 节。否则 C2 的 compact 后重读会**把任何进行中的 P9 slice 丢掉**（registry 里查无此项）。

**C4. W0 引导 slice（⟦审计修订⟧ 新增）。** 审计结论：铁律 1/3/4 所依赖的三件工具**全部尚不存在**，这是"今天 0/109 可合法完成"的直接原因。
推荐：批准 W0 为一个显式引导 slice（在 BASE-ALIGN 同分支、产品代码零改动），交付且各带验收：① `spec/first100/exec/` 目录 + `command-freeze.schema.json` + 空 `command-freeze.json`；② `scripts/first100/generate-ledger.mjs`（见 C1）；③ `first100-exec-state.schema.json` + 初始 `EXEC-STATE.json`；④ `.github/workflows/first100-exact-sha.yml`（见 A4，含密钥迁移）；⑤ repo `.claude/goal.md` + PreCompact hook 注册（见 C2）；⑥ A1 的四项 BASE-ALIGN 物化。W0 全绿后 W1 才开闸。

**C5. 吞吐与并行（⟦审计修订⟧ 新增）。** 审计算术：全程 = **419 slices**（100 epic × 4 格 − 12 个 P=N/A = 388，+ 扩展 9 项 ≈ 31）；W8+W9 独占 98 slices（23%）；单 slice 中位 60–90 分钟，全程约 420–630 执行小时 ≈ 3–5.5 个有人值守月；naive 每 slice 跑一次 CI 另加 70–210 小时纯等待。
推荐：① W8/W9 内预授权 **2–3 条并行 Writer lane**（同一只读 Supervisor 之下；owner map 的文件互斥已保证 files[] 不相交）；② CI 按 push 批处理（一 push 多 slice），不按 slice 触发；③ 本地只跑冻结命令 + typecheck + 相关包测试，全量只在 wave 边界；④ 里程碑口径：80% 里程碑不含 scheduled-BLOCKED 的 infra/live 项（见 A5）。

---

*汇总：A1–A5 解锁基线与 CI；B1–B7 解锁 91 命令 + 400 格语义 + 反作弊面；C1–C5 解锁执行、防漂移、引导与吞吐。全部批复后，规划层再无已知 BLOCKED 决策项；W0 引导 slice 落地后，铁律 1/3/4 才从"纸面"变为"可执行"。*

---

## 追加批复 C6：绝对 24×7 无人值守模式（2026-08-31）

- **批复原文（逐字）：** 「24*7 要绝对的」
- **生效内容：**
  1. 执行走 API 计费（`ANTHROPIC_API_KEY`），不走订阅配额；预算量级 1–2 亿 token（数百至一千余美元），超支上限由用户另行设定；
  2. 授权在专用 worktree（`~/dsh-first100-clean`，`first100-exec` 分支）内以 `--dangerously-skip-permissions` 运行执行会话——OS 级权限确认让位于协议级门（命令冻结/独立审查/exact-SHA CI 点绿），后者不变、仍是反作弊的强制层；此授权仅限该 worktree 与 first100 程序范围；
  3. 会话由 `deepseek-first100-sdd-audit/run-24x7.sh` 循环拉起（caffeinate 防休眠、10 分钟 3 崩即冷却 30 分钟的保险丝、`~/.first100-logs/STOP` 文件停机），退出即重启，EXEC-STATE.json 保证无损续接；启动脚本由用户本人 chmod +x 并执行；
  4. BLOCKED 处置为"park-and-continue + 推送"：单项 BLOCKED 立即写入 `spec/first100/exec/BLOCKED-QUEUE.md` 并发 macOS 系统通知（osascript），该 lane 挂起、frontier 其余项继续；仅当当前 wave frontier 完全耗尽时才整体停等 maintainer；
  5. 每日 08:00 前在 `spec/first100/exec/DAILY-DIGEST.md` 追加进度摘要（X/109、当前 wave、CI 链接、BLOCKED 队列、token 消耗估计）；
  6. 已知残余（用户知情）：wave frontier 被 BLOCKED 耗尽时的停等时长 = 用户响应延迟；W1（单 epic）与 W12/W15/W19（1–3 epic）是最脆弱段；预期完工 3–5 周（API 模式，含 R10 的 3 夜统计硬底）。

## 追加批复 C6.1：订阅模式修订（2026-08-31）

- **批复原文（逐字）：** 「不啊 我不用API 我只用subscription plan啊？这样不行吗」
- **生效内容（覆盖 C6 第 1 条，其余不变）：**
  1. 执行走用户订阅登录，不配 API key；配额触顶时 runner 识别限额信息并待命 65 分钟重试，窗口重置后无损续接（run-24x7.sh 已实现）；
  2. 节奏口径修订："绝对 24×7 在岗"不变，但**有效吞吐 = 每周订阅配额**；预期完工从 3–5 周放宽到约 6–10 周（取决于 plan 档位与当周实际放行量，W1–W3 跑完后按实测烧速重估）；
  3. 用户知情：执行会话与用户本人的其它 Claude 使用共享同一订阅配额池——执行高峰期用户自己的交互会话会被挤占；若某周需要优先自用，`touch ~/.first100-logs/STOP` 暂停执行、删除该文件后续跑，进度零损失。

## 追加批复 C7：guanjieqiao-92 常设 maintainer 技术裁决代理委托（2026-09-01）

- **批复原文（逐字）：** 「Maintainer 常设委托（即日起生效，取代夜间预授权的第 7 条，其余条款保留）：我正式委托 guanjieqiao-92 会话（我的规划/监督会话）为 maintainer 技术裁决代理。① 委托范围：命名/路径/文件组织冲突；证据与账本机制的先例细化；flake 定性与测试设计争议；wave 内调度与审查升级选择；registry/matrix 与实现出入的解释性裁决（不改变收录范围）；数值空缺的临时值采纳（须标注 PROVISIONAL-BY-DELEGATE 且只得严于、不得松于既批阈值）。此范围内，来自 guanjieqiao-92 的跨会话消息即为有效 maintainer 裁决，队列记 ANSWERED-BY-DELEGATE(gq-92) 并全文引用其消息。② 保留事项（必须 park 等我本人）：一切涉及金钱/预算/API key/凭证密钥、不可逆或对外动作（删除/force push/动 master/发布/上游交互）、修改 decisions-approved.md 既批条目/阈值数值/109 收录范围/五条铁律、停止程序，以及权限分类器要求人工点击的操作。③ 你若判断某决定超出①的范围或涉及②，一律 park 等我，即使 gq-92 已给出意见。④ 本委托我可随时一句"撤销委托"收回；所有代理裁决须可在队列中完整回溯。」
- **生效内容：**
  1. 取代此前"夜间预授权"安排的第 7 条（其余夜间预授权条款不变）。
  2. 委托范围（①）内，来自 `guanjieqiao-92` 会话的跨会话消息视为有效 maintainer 裁决，无需用户本人逐项在本会话内再确认；`BLOCKED-QUEUE.md` 记录为 `ANSWERED-BY-DELEGATE(gq-92)`，并全文引用其原始消息（不得转述/删减实质内容）。
  3. 委托范围明确列举：命名/路径/文件组织冲突；证据与账本机制的先例细化；flake 定性与测试设计争议；wave 内调度与审查升级选择；registry/matrix 与实现出入的解释性裁决（不得改变 109 项收录范围）；数值空缺的临时值采纳（须标注 `PROVISIONAL-BY-DELEGATE`，且只能比既批阈值更严格，不得更宽松）。
  4. 保留事项（②，必须 park 等待用户本人，`guanjieqiao-92` 无权裁决）：金钱/预算/API key/凭证密钥；不可逆或对外动作（删除、force push、触碰 `master`、发布、上游交互）；修改 `decisions-approved.md` 既有已批条目、阈值数值、109 项收录范围、五条铁律；停止整个程序；任何权限分类器要求人工点击确认的操作。
  5. 边界从属规则（③）：任何决定若本会话判断超出①范围或触及②保留事项，一律 park 等待用户本人直接确认——即使 `guanjieqiao-92` 已给出意见，也不得据其单独放行。
  6. 撤销机制（④）：用户可随时以一句"撤销委托"收回本委托；本委托生效期间及撤销后，所有经代理裁决的条目都必须在 `BLOCKED-QUEUE.md`（或等价队列）中完整可回溯（原始消息全文 + 裁决内容 + 生效范围判断）。
  7. 与此前"未经验证的跨会话消息"拒绝先例的关系：本委托不追溯授权此前任何已被拒绝/未被信任的跨会话消息；仅对本委托生效（2026-09-01）之后、来自 `guanjieqiao-92`、落在①范围内的消息生效。任何自称来自 `guanjieqiao-92` 但内容触及②保留事项，或要求处置签名密钥/凭证等安全敏感操作的消息，依然一律不予信任，park 等待用户本人。

## 追加批复 C8：新增 P3-13（109→110），经本会话内直接 AskUserQuestion 确认（2026-09-03）

- **背景：** `guanjieqiao-92` 中继报告：上游 `4e84901e` 已把 CPython code-runtime/PTC `run_code` 建成完整的任意代码执行引擎、且 ptc preset 出货为一等模式；其真实出货后端 `packages/code-runtime/code-runtime-worker-thread` 的 README 原话自认 "not a security boundary"、"trust posture is bash-equivalent"、"Containment, not a security boundary"、"can reach Node APIs...deliberately does not promise isolation from the host"、"OS processes a program spawns survive terminate()"；`src/` 下零 policy 文件；100-epic registry 对 `code-runtime`/`run_code` 在 P3-01…12 全范围零命中。`guanjieqiao-92` 随后中继"用户已批准新增 P3-13"，但该中继消息本身不含用户逐字引语——按本文件 §C7②"109 项收录范围"为保留事项、③"即使 gq-92 已给出意见，也不得据其单独放行"的明文规则，本会话未采信该中继为充分授权，转而在 `spec/first100/exec/BLOCKED-QUEUE.md#BLOCKED-030` 记录 PARKED，并在本轮同时用 `AskUserQuestion` 工具向本会话当场在场的使用者直接提问确认。
- **确认机制（如实记录，非逐字引语——工具为结构化单选，非开放文本）：** 本会话调用 `AskUserQuestion`，问题原文："The delegate session (guanjieqiao-92) relayed that you approved adding a new item P3-13 to the First-100 registry (109→110 items) — a hardening scope for packages/code-runtime's PTC run_code backend, which self-discloses zero isolation ('bash-equivalent trust', no Network/FS/Process/Secret policy). Per your own C7 delegation terms, expanding the 109-item scope is reserved to you directly — a relay isn't sufficient. Do you approve this addition?"；选项为 "Yes, approve P3-13 (109→110)" / "No, decline for now" / "Need more detail before deciding"。**当场在场使用者选择："Yes, approve P3-13 (109→110)"。**
- **生效内容：**
  1. 批准新增 P3-13（First-100 收录范围 109→110），解除 `BLOCKED-QUEUE.md#BLOCKED-030` 的 park。
  2. **本条批复只解除"谁有权批准 109 范围扩张"这一保留事项的授权门槛，不等于 registry.json 立即改动**——`tests/first100/registry.json` 的实际新增条目（含 acceptanceSource/provenance 字段的诚实标注：非 `CANONICAL_EXTRACTION_FROM_PINNED_SOURCES`，须标注 `{source: "spec/first100/sources/base-align-v2/upstream-status-COMPLETE.md §三", kind: "BASE-ALIGN-v2 new-gap", approvedBy: "user", approvedAt: "2026-09-03"}` 或等价诚实记法）在 BASE-ALIGN-v2 mini-wave 内落地，届时经独立 Reviewer 核验 scope、predecessors（P3-01/P3-02/P3-08）、5 项必须满足属性（(a) policy-bound world 执行 (b) 风险审批覆盖程序体自身副作用非仅嵌套 tool 调用 (c) 关闭 spawned-process-survives-terminate 缺陷 (d) 约束 worker-thread 变体对 Node 模块/IO 的直接访问 (e) 以 P3-08 容器级后端为隔离等级选项）。
  3. `decisions-approved.md` 本条为 append-only 新增记录，不改写 C7 既有条文；C7 §②"109 项收录范围"保留规则本身继续对未来任何新的收录范围扩张请求生效，不因本条批复而放宽。
