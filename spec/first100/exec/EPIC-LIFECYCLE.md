# First-100 · 一条 epic 从开工到验收的唯一流程(入口文件)

**这份文件不含任何新规则。** 它把散在各处的规则按一条 epic 的生命周期排成顺序,每步一句话 + 权威出处。**与出处冲突时以出处为准,并把冲突当本文件的 bug 报 BLOCKED-QUEUE。** 执行者每开一条 epic 从这里进;delegate 每加一条裁决同步改这里的指针(只改指针,不写内容)。

维护:guanjieqiao-92(delegate)。建立:2026-09-06 14:40 EDT。

## 0. 文件地图与优先级

| 层 | 文件 | 回答什么 | 谁改 |
|---|---|---|---|
| ① 做什么 | `tests/first100/registry.json`(+ `registry-extension.json` P9) | must / acceptance / validation / files;**唯一验收依据** | 只经 delegate 裁决(C11),带 `clauseProvenance` |
| ② 怎么裁 | `plan-rectification-2026-09-06.md` | 为什么这么裁(按日期追加的裁决日志,§0–§9;文首有阅读指南与已取代裁决表) | delegate,只追加 |
| ③ 这条 epic 具体怎么做 | `make-vs-use-plan.md`(110 张执行卡,派生) | 用什么 / 怎么接 / 自己写什么 / 标准归谁 / 禁令 / 缺口 / 裁决叠加 / 状态快照 | 由 `make-vs-use-ledger.json` + 生成器 overlay 重生成;不手改 |
| ④ 数据 | `make-vs-use-ledger.json` | 造用账本(artifact 2e874903 完整镜像) | 只在账本被事实超越时改,并在 ② 记一行 |
| ⑤ 委托与批复 | `decisions-approved.md` | 用户批了什么(A–C、C6–C13) | 用户 / delegate 记录 |
| ⑥ 阻塞与常设规则 | `BLOCKED-QUEUE.md`(`## Open` 等决定;`## Standing` 已定仍有约束力;`## Answered`) | 每条 BLOCKED 的问题与答复;**多条 "standing rule" 在此** | 执行者记,delegate 答 |
| ⑦ 状态 | `ledger.json` / `EXEC-STATE.json` / `command-freeze.json` / `acceptance-coverage.json` / `clause-subject-audit.json` / `delegate-signoff.json` / `p9-verification.json` | 机器状态,全部由脚本生成或校验 | 脚本(`scripts/first100/*`) |

**优先级**:① > ② > ③ > ④。⑤⑥ 是 ② 的输入。⑦ 是结果不是规则。

## 1. 开工前(preFlight)——写第一行代码之前全部完成,并经 delegate 确认

| 步 | 动作 | 出处 |
|---|---|---|
| 1.1 | 读 epic **标题**,把标题里的名词逐个对到子句;读 must / acceptance / validation / files 全文 | BLOCKED-101(标题→子句);registry |
| 1.2 | **三问**:主体在不在执行路径上 / 冻结挂哪个 stage / 每条子句的主体是什么(文件:行) | BLOCKED-101;记 `clause-subject-audit.json` → `preFlight[epic]` |
| 1.3 | **第四问**:读执行卡整张(主+副判定 / adapt 每条的 note / 标准 / risk / residual / 社区缺口 / 裁决叠加) | 整改令 §4.1;卡 = `make-vs-use-plan.md#### <id>` |
| 1.4 | 若卡上有 adapt 级库 → 走 **§8 九步 SOP**(供应链核 → **本树复验** → 接法定形 runtime/oracle/optional/vendored → 落座三角色 → 三类冻结用例) | 整改令 §8;oracle 形态 §7.8;模板 P1-02 / P2-03 |
| 1.5 | **标准词汇**:卡上每个标准,查自己是不是形状所有者——是则定形状并冻结 schema 用例;不是则 import 所有者的定义,不再声明一份;所有者 wave 晚于自己时用内部名、由所有者日后映射 | **执行卡 §1 表(唯一所有权表)**;规则 R3 + §7.11;卡上"标准"行已按 wave 标出 |
| 1.6 | **缺口核对**:卡上每条社区「缺口:」逐项对到子句;对不上写"超出本 epic(归 X)"或报子句缺口 → BLOCKED | 整改令 §9.2;自 P2-04 起 |
| 1.7 | 若是 seam 类 epic(P6-01 / P8-06 / P2-05 / P3-11 / P1-10 / P7-07 / P1-02·04·06):冻结"现有形态插件不改代码可作 provider"用例 + 一条负用例 | 整改令 §9.2 表 |
| 1.8 | 若 epic 在共用引擎的消费者列表里(Cedar / sandbox-srt / OTel / attestation envelope):**引擎 slice 必须已落地**,消费者不重验引擎 | 整改令 §3.1–3.4 |
| 1.9 | 若 epic 是 REUSE_UPSTREAM:先核上游有没有该原语;有 → 只接缺口;经核实没有 → 写,并把核实记进 preFlight | 整改令 §4.1(14:15 修订行);先例 P5-11 §7.10 |
| 1.10 | 写 `preFlight.makeVsUse`(**唯一字段规范在 `make-vs-use-plan.md` §0**),`recordedBeforeFirstLine: true` | 卡 §0 |
| 1.11 | 把 preFlight 发 delegate,**确认后才动文件**;A 类 registry 改动(移/拆/重述子句)是 delegate 裁决,执行者执行 | C11(decisions-approved);用户规则「这些你来给我选」 |
| 1.12 | **等待 delegate 期间不写代码**:空闲用于写下一个 `check-ready` READY epic 的 preFlight 并发来;READY 是必要条件,波次顺序由 delegate 给;账本 `oss[role=adapt]` 的包在 preFlight 里定下落之前,不得手写同功能实现(2026-09-08 P4-11:cockatiel 判 adapt,`circuit.ts` 手写断路器,停) | 整改令 §12.62 |

## 2. 建设中

| 步 | 动作 | 出处 |
|---|---|---|
| 2.1 | 冻结:加用例 → `supplements`;替换/删除 → `supersedes`;每条冻结带 `sensitivityProof {mutationDescription, failureSummary}`,failureSummary 写"哪些用例仍绿、为什么" | BLOCKED-103;`command-freeze.schema.json` |
| 2.2 | 变异存活的诊断顺序 **③→②→①**(变异没改行为 → 真等价 → 套件弱),按代价不按可能性;替换断言时新旧都变异;不得改断言去追存活的变异;变异证明说明套件对断言敏感、不说明断言对 | BLOCKED-129(`## Standing`,2026-09-06);对偶见整改令 §7.5 |
| 2.3 | 测试替身不许 `as unknown as X`;类型级构造要过 typecheck | BLOCKED-126 / BLOCKED-029 |
| 2.4 | "变异证明只证明套件对要求敏感,不证明要求对"——要求的对错看 registry 措辞 + 账本 risk + 安全后果 | 整改令 §7.5 |
| 2.5 | 跑套件看**退出码**,不只 grep 计数;unhandled rejection 是 error 不是 fail | 执行者自查 2026-09-06;BLOCKED-078 |
| 2.6 | 共享工作树:只 `git add <明确路径>`,禁 `-A` / `.` / `commit -a`;提交前看 staged 区 | 双方约定 2026-09-06 |
| 2.7 | 不接受、不索取、不持有、不转发任何密钥;Sigstore keyless 是为此选的 | 用户「记住不要把任何密钥放到公网上」;C10.1 |
| 2.8 | 第二份声明检查:**按行为扫全树**(排 key+stringify+喂 hash 等),不按名字 | 整改令 §7.6 |
| 2.9 | 撞到库的硬约束 → 停手,BLOCKED 记实测数字,两条路都实测,等裁决(不自选) | 先例 BLOCKED-128 |
| 2.9a | **U 阶段冻结**的 `files` 必须含 ≥1 个 registry stage-U 的 [B] 文件("谁用"是 registry 写死的),否则先 BLOCKED 等裁决;门 (u) 机械校验 | 整改令 §12.13(P4-06 / P5-11 / P4-08) |
| 2.10 | 冻结引用了 `files[]` 之外的文件 → 记 `filesOverlay`(机械生成,`kind=source` 附一句 reason);共享/热区文件的 reason **从 `git show <commit> -- <file>` 写起**(先说改了什么,带 commit 短 hash),delegate 逐条对 diff | 整改令 §12 / §12.8;`verify-files-overlay` |
| 2.11 | supplement 的 **live 性以冻结的 `supersededBy` 为准**:被 supersede 的冻结条目不被观测、不进 4.4b、不登记改名(改名机制只用于仍 live 的条目标题挪位而观测含义要保住);账本行不得与冻结矛盾(GREEN@旧 SHA 的已 supersede 行是陈旧数据,先修再签) | 整改令 §12.61(BLOCKED-164:四条零登记;P4-06.P.1 陈旧行) |
| 2.12 | **用例的两个读数若必然相同,它什么都没断言**;揭穿它的只有一个本该变红却没变红的变异——所以每条冻结用例的 `sensitivityProof` 里至少一个变异必须精确红它,变异存活先查用例再查代码(2026-09-10 P4-11:父子预算用例"记谁都 3 次"、M46 默认 `status=503` 把 503 测两遍,两次都是变异不红才暴露) | 整改令 §12.76;执行者冻结 note;**变异存活第三因**:测的根本不是被变异的代码(子路径无 paths 别名 → vitest 量的是 `lib/`),从外面看与"等价变异"一模一样,只有探针能分——所以探针先于推敲断言(2026-09-10 P1-10.P 三个变异全绿) |

## 3. 观测

| 步 | 动作 | 出处 |
|---|---|---|
| 3.1 | 推送 → `first100-exact-sha.yml` 在该 SHA 上跑:registry gate set(含 frozen-titles-in-tree、verify-make-vs-use)、全量单测、scoped lint、snapshots;作废的 run 取消 | `.github/workflows/first100-exact-sha.yml`;BLOCKED-014 |
| 3.2 | 格子只能由 `generate-ledger.mjs` 从 vitest JSON 产物写;**不手写格子**(24 格手写事故) | 整改令附带记录;`verify-cells-recomputable.mjs` |
| 3.3 | 已验收行的格子可被重算:VERIFIED / MISMATCHED / UNAVAILABLE(UNAVAILABLE 不通过) | `verify-cells-recomputable.mjs` |

## 4. 验收

| 步 | 动作 | 出处 |
|---|---|---|
| 4.1 | 四谓词:(i) coverage 闭合 (ii) candidate 链 (iii) 观测互异且冻结标题在观测里全绿 (iv) delegate 签字 | `generate-ledger.mjs --accept`;BLOCKED-068 / 018 |
| 4.2 | `accept-blocked:` 锁与 `openFindings` 为空 | BLOCKED-QUEUE `## ACCEPTANCE LOCKS` |
| 4.3 | F 阶段填 `preFlight.makeVsUse.realized`(给 delegate 4.4 时读的证据;**无门读取它**——`verify-make-vs-use.mjs:171` 的 REQUIRED 不含此字段,lane B 2026-09-10 实测,§12.85 OQ6;F 不得报"门确认了 realized");`verify-make-vs-use` 对本 epic VERIFIED(含 (e):账本每条 adapt / 每个标准都有下落——adopted 或 deviations 三类理由之一) | 整改令 §9.1 |
| 4.4 | delegate 跑四谓词 → `--record-signoff` → 提交只含 `delegate-signoff.json` → 执行者 `--accept` | BLOCKED-036 / 068 |
| 4.4a | 签字前 delegate **重做 1.2 第一问并量化**:子句名词的构造函数在生产路径上的调用者数(grep,排除 tests),为零不签;事件名 / 文件名与子句名词同名不算 | 整改令 §12.11(BLOCKED-143,P2-03 #22 撤回);同族 BLOCKED-091 / 136 |
| 4.4b | 签字前 delegate 核每个格子与 supplement 的 `candidateSha`/run **是重建后的观测**;`--accept` 只报 (iv) 是必要条件不是签字依据(2026-09-08 P4-07 误签:cells 仍是重建前观测,已撤) | 整改令 §12.52 |
| 4.4c | **关一条 finding 必须逐名词给量**:finding 记几个名词就答几个,消息里带表;一个名词的证据不关整条(2026-09-08 P4-09 must[3]:三名词只答"有调用者",capability token / trace 零出现,重开)。`--accept` 与绿格路径口径一致:任一 open finding 存在即拒 | 整改令 §12.61 |
| 4.5 | 用户级确认门:P0-02 / P0-07 / P2-01 的最终 ACCEPT;钱 / 钥匙 / 不可逆触点 | BLOCKED-022 / 024;C7 |

## 5. 跨 epic 的固定顺序(现行)

**提速令(整改令 §10,2026-09-06 15:25 EDT)**:三条 Writer lane 同时开——**L1** P2-03 签 → P2-04 → P2-05;**L2** §3.5 SLICE-fiber-A + 内核密钥材料 → P2-02 验收(同时解锁 P2-05 内核执行点);**L3** P4-06 → P4-05 → P4-09;Cedar slice 在 L1 等观测时插入;P1-03 在 BLOCKED-094 裁决(§10.3)后任一空档。之后:W5–W7 → §3.2 sandbox-srt(W7 前)→ §3.4 envelope(P4-04 W9 前)→ §3.3 OTel(W11 前)。标准形状所有者以执行卡 §1 为准。CI 按 push 批处理;delegate SLA 30 分钟。

### 5.1 双执行会话并行协议(用户批准,2026-09-10 15:30 EDT;整改令 §12.80)

**为什么**:单条线是"一个执行者 → delegate 门③ → 推 → CI ≈25 分钟 → 签",所有 epic 串着排队;09-10 实测一个 epic 的 C→U 约 3 小时,其中模型生成不到半小时,其余是机器争用、返工、等观测。两条执行会话各自一个 git worktree、做文件集不相交的 epic,delegate 同时监两条、批量推一次观测两条,吞吐接近 2 倍;门③、签字、4.4d 仍是 delegate 一人一条标准,质量不变。

| # | 规则 | 依据 |
| --- | --- | --- |
| 5.1.1 | **两条 lane**:**A(收口线)** 在 `dsh-first100-clean`(分支 `land-base-align-v2`),负责账本已有绿格 / 已建未到达的收口(P4-11 挂载、P1-10.F、记忆 slice P6-01/02、P2-05.F、P6-07.U)以及此后 reliability / data 线的 READY epic;**B(前沿线)** 在 `dsh-first100-lane-b`(分支 `lane-b`),从 `check-ready` 的 READY 集取 wave 最小者(首个 P4-02 → 之后按 READY),以及 policy / run-plan 线。**分配由 delegate 指定**,每次只指定下一项;执行者不自选。 | 09-10 实测;§10 三 Writer lane 先例 |
| 5.1.2 | **不相交**:分配前 delegate 跑 `checkParallelLaneDisjointness`(`scripts/first100/generate-specs.ts:975`)——两 lane 在建 epic 的 [N]/[P] 文件两两不相交;共享 [B] 配置文件(`tsconfig.host.json`、`bundle/base/cordis.patch.yml`、根 `package.json`、`pnpm-lock.yaml`)允许双方各自追加,合并时"两行都留"(BLOCKED-014 addendum 1)。 | F6 |
| 5.1.3 | **单一事实源 = `fork/first100-exec`**。两条 lane 报 SHA 前必须 `git fetch fork && git rebase fork/first100-exec`(只重写本地未推提交;不 force、不动远端),报的 SHA 必须以 fork head 为祖先、其上线性。谁先绿谁先推;后者再 rebase 一次(append-only 冲突:`command-freeze.json` entries / overlay / BLOCKED-QUEUE 段 / tsconfig 行,一律"两边都留",然后 `generate-ledger.mjs --check` 与 `verify-freeze-in-candidate-tree` 必过)。**不产生 merge commit。** | C14;B4b |
| 5.1.4 | **程序状态文件**(`ledger.json` / `ledger.md` / `EXEC-STATE.json` / `command-freeze.json` / `clause-subject-audit.json` / `files-overlay*.json` / `BLOCKED-QUEUE.md`)两 lane 都可追加,但**只经工具**(`generate-ledger.mjs`、`--write` 生成器),不手改;绿格只对被观测的 SHA 做,rebase 后的 SHA 若未被观测则不绿。`delegate-signoff.json` / `registry.json` / `frozen-title-renames.json` 仍只归 delegate。 | 3.2;BLOCKED-036 |
| 5.1.5 | **门③与推送(2026-09-11 修订,§12.85 补记 7)**:门③ **在 GitHub 上跑**——delegate 把候选 SHA 以显式 SHA 推到 fork 临时分支 `gate/<sha>`(`git push fork <full-sha>:refs/heads/gate/<sha>`,不碰 `first100-exec`、永不 force),`gh workflow run first100-exact-sha.yml -R 123oqwe/deepseek-harness --ref gate/<sha> -f sha=<full-sha>`,云上跑门集 + 全套件 + 快照(≈35 分钟,可并行多个候选);绿则把同一 SHA(叠 docs overlay)推 `first100-exec`,on-push run 为正式观测,按 §12.6-B 逐条准入,红在谁的文件谁返工。本机不再跑门集/固定集(2026-09-10 前的做法作废:共用机器上 30–40 分钟且压住两 lane)。两 lane 都 rebase 好时推较新的那个(它包含另一个),一次观测两条 lane 的冻结。**派发前置(2026-09-11,补记 23/61/77/82)**:报候选 SHA 的 lane 须在按该 SHA checkout 的 detached 树(完整 `pnpm install --frozen-lockfile`)跑 ① `run-registry-gates.mjs` 全套 + `verify-cordis-api`;② 云 Lint 步的原命令(类型感知,先 build,范围 = 自基线改过的全部文件);③ **全语料重放**(session/sdk/acp 三车道 + `DSH_EXAMPLE_MODE=lib` 下 `apps/web/tests/**/*.snapshot.ts`)——三项各报 exit,delegate 不派未报者;刷新 spawned-profile 车道(sdk/acp/headless bin)前须 build 或断言 `lib/` 新于 `src/`;**delegate 叠 overlay 后**(尤其含撤签/accept 等改 ledger 行状态的写入)须在叠好的 tip 上跑 `verify-adapt-dispositions` + `verify-make-vs-use` + `verify-ledger-digests`(= `generate-ledger.mjs --check`,非独立脚本)(补记 89:只跑 `--check` 漏掉了读行状态的门)。 | A4 工作流头注;§12.6-B;§12.85 补记 7/23/61/77/82 |
| 5.1.6 | **机器**:每 lane 测试 `--maxWorkers=2`;(门③已上云,本机不再有固定集;)load > 20 时 lane 暂停测试只写码;不用 `sleep;tail` 轮询。第三条 lane 仅当机器有余量且 delegate 能逐行审时开。 | 09-10 三次卡死 |
| 5.1.7 | **会话健康**:执行会话对话记录 > 150 MB 或出现 `Prompt is too long` 即在下一个干净断点换新会话;状态全在文件(每 lane 自己的 `.claude/goal.md` NOW 段、EXEC-STATE、BLOCKED、evidence、preFlight),交接由 delegate 发。 | 09-10 前任 193 MB 死亡 |
| 5.1.8 | **报告格式**(两 lane 同):SHA、`pnpm install --frozen-lockfile` / typecheck / 触及包 vitest / `slice-gate(-cordis)` 的 exit(pairing 按 BLOCKED-179/124 held)、变异各红各自那条 + 控制项、"下一步等什么"、**已 rebase 到 fork head 的证明**(`git merge-base --is-ancestor fork/first100-exec HEAD`)。 | 2.10–2.12 |
| 5.1.9 | **到完成的路线**:每次 `--accept` 后 delegate 重跑 `check-ready`,把新 READY 的 epic 按 5.1.1/5.1.2 分给先空出来的 lane;等观测期间 lane 按 1.12 写下一项 preFlight。以 09-10 的节奏(每 lane 约 4–6 小时一个 epic 的 C→F,观测批处理),82 项未验收 ≈ 350–500 lane 小时,两条 lane 24×7 约 2–3 周,加返工与机器损耗按 3–4 周计;第三 lane 视机器与审查余量再定。 | 估算,非承诺 |
| 5.1.10 | **delegate 不进 lane 的工作树**:规划文档、签字、registry/adjudication 更正一律在推送时于 `gate-wt2` 叠到被推的 SHA 之上再推,lane rebase 即得;registry 对 vendored sources 逐字节钉住,A 类路径更正只走 `adjudication.json` 的 `deliverablePathPatches`,且 `declaredPaths` = files[] ∪ stages,先查再改。 | §12.81 |
| 5.1.11 | **BLOCKED 号只由 delegate 分配**:lane 开条目前先向 delegate 报一句取号,不自取;号水位记在交班单。(此条被交班单引为 §5.1.11 但此前未写入,2026-09-10 补) | 交班单;§12.83 |
| 5.1.12 | **第 3 / 4 条线的开启条件(用户决定,2026-09-10:现阶段保持 2 条,不开;条件满足时 delegate 只提议,用户点头才开)。每条条件带测量命令,不带的不算条件。** **第 3 条 = 使能建设线(Opus)**,四条全满足才提:① 活——`node scripts/first100/check-ready.mjs` 的 READY 集减去 A/B 在建后 ≥ 2 项,且经 `checkParallelLaneDisjointness`(`generate-specs.ts:975`)与 A/B 在建 epic 的 [N]/[P] 文件集两两不相交;或未分配整改 slice ≥ 2(如 P4-01.U2、P6-07.U);② 机器——`vm_stat` 的 free+inactive 页 ×16384 ≥ 2 GiB 连续 30 分钟(每 5 分钟一采,6 采全过),`uptime` 1 分钟 load < 10,`pgrep -f "Codex"` 为空;或有第二台机器承担门③;③ CTO 容量——近 2 小时 delegate 对 lane 报告的中位响应 < 15 分钟(测量:两 lane transcript 里每条发往 delegate 的 SendMessage 时间戳 → delegate 下一条回复时间戳,取中位;**仪器待补**,~20 行脚本,验证线若开为其首件);④ 管线——门③排队 ≤ 1 个 SHA。**关停**:load > 30 连续 30 分钟,或中位响应 > 30 分钟 → 第 3 条先停套件只写码,再不降则停线。**取项**:按 registry `predecessors` 图算"验收后可解锁的后继数"(含传递)排序取最高者,当前候选 P3-01(卡 P3 整章 + P4-03)、P7-01(卡 P7)、P5-05/06、P8-02;文件集须与 A/B 不相交。**第 4 条 = 验证线(Sonnet,不写产品代码)**,机器前提同 ②,以下任一满足即提:① delegate 机械核验占比过高——4 小时内门③ ≥ 3 个 SHA,或 §5.2.5 回扫被推迟 > 6 小时;② 出现第二台机器 / 云 runner → 立刻提,门③先挪过去;③ 一天内 ≥ 2 次 CI 红属"机械核验可抓"类(未重放的变异、出厂未挂的 provider、未声明的 import)。**职责**:原样重跑冻结 argv;逐条重放 `sensitivityProof`(各红其所称,build/typecheck exit 0 才算变异生效);4.4d 到达 grep(先服务可达性后方法名;仪器不站在被测物里);在第二个 gate 工作树跑门③;§5.2.5 回扫的机械部分。**产出** PASS/FAIL + 证据行的表;**裁决与签字仍归 delegate 一人,不设第二 CTO**。 | 用户 2026-09-10;gq-92 拟稿、guanjieqiao-04 核名定稿(§12.83) |
| 5.1.13 | **lane 永不空转(用户令,2026-09-10)**:每条 lane 永远持有 delegate 派的任务;做完即向 delegate 报告(做了什么+证据 / 提交 SHA 或未提交原因 / 打算的下一项);delegate 审查后派下一项;等门③ / CI / 推送 / 观测期间做队列里的下一项(preFlight、属它的小缺陷、WIP 的下一步;单文件可跑,套件不跑)。delegate 的每条"等"指令必须同时给这段时间的活;lane 手上没活直接向 delegate 要;lane 空转的账算 delegate 的(watch-v11 无工具调用阈值 15 分钟)。 | 用户 2026-09-10(lane A 22:16–22:39 空转);§12.84 |

### 5.2 delegate 换班协议(用户批准,2026-09-10 21:10 EDT;整改令 §12.82)

**为什么**:delegate 会话同样会因对话记录过大而 `Prompt is too long`(执行者 09-10 18:49Z 已死过一次);把"CTO"做成可换班的岗位,而不是一个人。

| # | 规则 | 依据 |
| --- | --- | --- |
| 5.2.1 | **裁决先进文件再发消息**:任何裁决必须先写进 `BLOCKED-QUEUE.md`(Answered / Standing)或 `plan-rectification` 日志,消息只是通知;没进文件的裁决不算数(09-10 "九行"事故:写在消息里、换人后找不到)。 | §12.81 |
| 5.2.2 | **交班单** `spec/first100/exec/DELEGATE-CHECKPOINT.md`:每次推送、签字、撤签由 delegate 在 gate-wt2 叠加更新(5.1.10),内容 = 远端头、在飞 SHA 与门③/CI 状态、ACCEPTED 与待撤/待复核、每条 lane 的地址/worktree/队列、BLOCKED 号水位、待用户决定、工具位置、机器约束。 | 本节 |
| 5.2.3 | **主动换班**:delegate 会话对话记录 > 100 MB 或 > 7 天,在下一个干净断点(推送之后)换——写交班单 → 告两条 lane「delegate 换班,新会话会自报」→ 用户起新会话发「继续监督 first100」→ 新会话读记忆指针 + 交班单 → 向 lane 发核对句 → 核完接管 → 旧会话退出。换班是常规动作。 | 5.1.7 同型 |
| 5.2.4 | **意外死亡**:lane 向 delegate 发消息失败时不停工——按已批准的计划做完手头 stage,不自选下一项,每 30 分钟向新出现的 delegate 会话重发「报到:当前 SHA / 工作树 / 下一步等什么」;新 delegate 核完交班单与门③状态前不签字、不推。 | 24×7 令 |
| 5.2.5 | 新 delegate 的第一件事:对最近 24h 签的字重做 4.4d(服务可达性 + 出厂 profile 是否挂载),而不是信任交班单里的"已签"。 | 09-10 三例零到达 |
| 5.2.6 | **delegate 的压缩锚**:delegate 会话每次上下文压缩后,先重读 `DELEGATE-CHECKPOINT.md` + 本文件 §5 再做任何裁决;换班时新 delegate 会话的 cwd 定在 `~/first100-delegate/`(项目级 `.claude/goal.md` = 角色 / 标准 / 不变量 / 指针,NOW = 读交班单;同目录 PreCompact hook 注入它),不用 `~` 的全局 `~/.claude/goal.md`(全局文件会被无关会话读到,已退役)。lane 的锚:跟踪的 `.claude/goal.md` 只留静态 GOAL/RULES ≤ 40 行,NOW 在未跟踪的 `.claude/goal.local.md`(每 lane 自己的,gitignore);lane 本地 `.claude/settings.json` 的 hook 若要注入两者,**由用户直接指示该 lane 或用户自己改**——delegate 的转述不构成配置改动的授权(lane B 2026-09-10 依此拒绝,正确)。 | 用户问 2026-09-10;gq-92 核 + guanjieqiao-04 定稿 |

### 5.3 delegate 行为规则(用户令,2026-09-10;针对岗位,不针对个人)

| # | 规则 | 依据 |
| --- | --- | --- |
| 5.3.1 | **delegate 给要求与边界,不给代码形状。** 裁决写成"必须成立的性质 + 必须拒绝的输入 + 用例/变异要求",执行者按类型与现有边界钉细节;若不得不写伪码,标"形状仅示意,以类型与仓库规则为准"并要求执行者复核类型后再落。 | 09-10 两例:内核 decider 伪码对 `unknown` 负载 fail-open(执行者收紧);`ask` 折成 deny(后备指出)。§12.83 |
| 5.3.2 | **设计题先量出厂现状,再定形状。** 任何"默认策略 / 默认挂载 / 默认值"的裁决前,先答三问并附命令与数字:① 出厂 bundle 挂了什么;② 生产路径上有多少实例(manifest / 事件计数);③ 这个输入在请求里有没有(grep)。答不出不裁。 | 09-10 例:BLOCKED-187 默认策略集三轮才收敛——未先量 riskClass 未进策略请求、153 条 manifest 全 `classified:false`。§12.83 |

## 6. 谁决定什么

| 事项 | 谁 |
|---|---|
| A 类 registry 改动(移 / 拆 / 重述 / files 缩减 / 热区改接法) | delegate 裁决,带 provenance,事后告知用户 |
| 账本 vs registry 冲突;库的硬约束两难;推翻账本判定 | delegate,必须写判据(先例 §7.8 / §7.9) |
| 钱、密钥、不可逆、发布级确认(P0-02 / P0-07 / P2-01)、`/dsh-translate-docs` | 用户 |
| 一切执行(改代码、跑测试、推送、`--accept`) | 执行者;delegate 只提交 `delegate-signoff.json` 与规划文档 |
