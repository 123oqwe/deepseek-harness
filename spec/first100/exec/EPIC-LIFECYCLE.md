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

## 2. 建设中

| 步 | 动作 | 出处 |
|---|---|---|
| 2.1 | 冻结:加用例 → `supplements`;替换/删除 → `supersedes`;每条冻结带 `sensitivityProof {mutationDescription, failureSummary}`,failureSummary 写"哪些用例仍绿、为什么" | BLOCKED-103;`command-freeze.schema.json` |
| 2.2 | 变异存活的诊断顺序 **③→②→①**(变异没改行为 → 真等价 → 套件弱),按代价不按可能性;替换断言时新旧都变异 | **尚未成文**(执行者 2026-09-05 提出、gq-92 采纳,只在会话消息里)→ 执行者记入 BLOCKED `## Standing` 并编号后,此处补号。在此之前本行是唯一记录,这违反本文件"不含新规则"的原则,故标出 |
| 2.3 | 测试替身不许 `as unknown as X`;类型级构造要过 typecheck | BLOCKED-126 / BLOCKED-029 |
| 2.4 | "变异证明只证明套件对要求敏感,不证明要求对"——要求的对错看 registry 措辞 + 账本 risk + 安全后果 | 整改令 §7.5 |
| 2.5 | 跑套件看**退出码**,不只 grep 计数;unhandled rejection 是 error 不是 fail | 执行者自查 2026-09-06;BLOCKED-078 |
| 2.6 | 共享工作树:只 `git add <明确路径>`,禁 `-A` / `.` / `commit -a`;提交前看 staged 区 | 双方约定 2026-09-06 |
| 2.7 | 不接受、不索取、不持有、不转发任何密钥;Sigstore keyless 是为此选的 | 用户「记住不要把任何密钥放到公网上」;C10 |
| 2.8 | 第二份声明检查:**按行为扫全树**(排 key+stringify+喂 hash 等),不按名字 | 整改令 §7.6 |
| 2.9 | 撞到库的硬约束 → 停手,BLOCKED 记实测数字,两条路都实测,等裁决(不自选) | 先例 BLOCKED-128 |

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
| 4.3 | F 阶段填 `preFlight.makeVsUse.realized`;`verify-make-vs-use` 对本 epic VERIFIED | 整改令 §9.1 |
| 4.4 | delegate 跑四谓词 → `--record-signoff` → 提交只含 `delegate-signoff.json` → 执行者 `--accept` | BLOCKED-036 / 068 |
| 4.5 | 用户级确认门:P0-02 / P0-07 / P2-01 的最终 ACCEPT;钱 / 钥匙 / 不可逆触点 | BLOCKED-022 / 024;C7 |

## 5. 跨 epic 的固定顺序(现行)

见整改令 §4 的 **14:15 EDT 增补块**:②′ P2-03 → ②″ verify-make-vs-use 门 → ③ Cedar slice → ④ W5–W7 → ⑤ sandbox-srt(W7 前)→ ⑤′ attestation envelope(P4-04 W9 前)→ ⑥ OTel(**W11 前**,§7.11 修订)。标准形状所有者以执行卡 §1 表为准。

## 6. 谁决定什么

| 事项 | 谁 |
|---|---|
| A 类 registry 改动(移 / 拆 / 重述 / files 缩减 / 热区改接法) | delegate 裁决,带 provenance,事后告知用户 |
| 账本 vs registry 冲突;库的硬约束两难;推翻账本判定 | delegate,必须写判据(先例 §7.8 / §7.9) |
| 钱、密钥、不可逆、发布级确认(P0-02 / P0-07 / P2-01)、`/dsh-translate-docs` | 用户 |
| 一切执行(改代码、跑测试、推送、`--accept`) | 执行者;delegate 只提交 `delegate-signoff.json` 与规划文档 |
