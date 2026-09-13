# BASE-ALIGN-v3 preFlight 规格(DRAFT — 未完成,数据段待两 lane 测量,执行前对用户确认整条)

> 状态:**DRAFT**。这是重锚到上游 v3 的 preFlight 规格骨架(补记 320-322)。数据段(§3-§6)由两 lane 的测量填入;落点决定由 delegate 做;整条在执行前 preflight 对用户确认。**执行时机**:候选 11(P2-10.F)/12(recompute)/P4-12 落地后、开任何新 P6/P7 epic 之前。执行时先跑一次实时 merge-tree(上游每天 ~50 提交,SHA 级冲突以执行日为准)。

## §0 目标与最高原则
- **目标 SHA**:`c291e7961a`(fork/master = 上游 master)。基线 A=`4e84901e64`、当前 W=fork/first100-exec。
- **铁律(补记 321,用户令)**:**改落点、功能不能少**。registry 每条 must/acceptance 子句重锚前后**逐字不变**;重锚只改落点(文件/接缝/事件名/挂载行),**不删、不弱化、不改写为"上游已提供"**。每处改动写"**原落点 → 新落点 → 为什么**"。
- **沿用 v2 纪律**:只删上游确实提供的、绝不丢真需求、绝不扩。路径更正走 `adjudication.json`,registry 字节锁不动。

## §1 沟通协议(补记 322)
1. 先写文件再发人:本规格进仓后才派重锚活。
2. 分工写死、禁两 lane 各自 rebase:**B(Opus)= rebase + 冲突判断**;**A = 快照/目录/投影重生成 + 15 ACCEPTED grep 重验**。重锚期间新 epic 停在旧基线外。
3. 每条 lane 指令含:角色、规格路径@SHA、目标基线、**属它文件的落点决定(非"你看着办")**、报告格式(每冲突"原→新→为什么"+§5.1.8 exit)、禁止项(不因"上游有了"先删——消费上游的冻结用例过了才拆重复;不自造事件名只查 §4 映射表;不 --record 只按规格重生成;路径只走 adjudication)。
4. 回执制:lane 开工前回"读了规格@SHA、我的文件是哪些、问题几条";无回执不算开工。

## §2 冲突面总览(gq-92 干跑,执行时重取)
- merge-tree 干跑 = 259 冲突文件:138 快照(session ~93/sdk ~31/web ~14,§5)、99 源/配/文、**11 modify/delete**(§3)、**34 epic 声明冲突其中 15 ACCEPTED**(§6)。
- 上游主变化:会话日志 v0→v3(事件改名、`core/session/types.ts` 重写、session-persistence 换 handle+storage-contract、`core/agent/inbox.ts` 搬家、上游无删除/保留 API)、子进程托管(`SubprocessHandle.pid` 删)、http-proxy、附件内容寻址、`DshBundleManifest`/`DshProfileManifest` 从 app-boot 抽到 packages/util/package-manifest。

## §3 11 处 modify/delete 的新落点 — 【lane B 测量 base-align-preflight-B.md §2;delegate 落点决定】
- `core/agent/src/inbox.ts` **搬家**（R089 → `core/agent-loop/src/inbox.ts`，上游 1101422362）。我们 4 改（P4-06.U dedup / P5-10 priority / P5-11 delegated child / BLOCKED-088 revert）re-apply 新址。**落点决定**：`P4-06.U.3`、`P5-10.U.1` 冻结 re-point 到新路径，走 adjudication.json 记继任（原 core/agent/src/inbox.ts → 新 core/agent-loop/src/inbox.ts → 上游 R089 搬家）。
- `session-persistence/src/write-behind.ts`(+spec) **删除**（上游 bec6805d6a handle-based seam：`SessionHandle.append(events[])` 连续批、`flush()` 持久，handle.ts:86-97；另有 per-event `enqueueLive`）。我们的 `enqueueAll`（P4-06.P：事件+outbox 记录一次持久批）语义由上游 handle 提供。**落点决定**：**`P4-06.P`（13 例，argv+被测文件全没）supersede 到 handle API**（子句逐字不变、argv/被测改为 SessionHandle.append 的连续批 + flush 持久；原 write-behind.enqueueAll → 新 SessionHandle.append+flush → 上游删 write-behind 换 handle seam）。**P4-06 是最糟一条：两声明文件全没。**
- 8 个 `session.jsonl` 语料 **删/滚到 v2**（上游 f693946509）。U 上为 `session.v2.jsonl`+`session.v3.jsonl`；我们 delta 是上游没有的事件（run/task-profile、identity/attached、信任 grant、detached run）。**落点决定**：**在新基线重录**（与 §5 步①同一件事），不文本合并。

## §4 事件改名映射表(单一来源)— 【lane B base-align-preflight-B.md §1,穷尽】
| 原(A/B) | 新(U=c291e7961a) | 上游提交 |
|---|---|---|
| `assistant/chunk` | `assistant/attempt` | removed ee956c720d / intro f99b06eaed |
| `tool/code-dispatch` | `tool/ptc-dispatch` | removed 657e68186a / intro bad4254d71 |
| `tool/code-dispatch-start` | `tool/ptc-dispatch-start` | bad4254d71 |
| subCallId `<p>:code:<n>` | `<p>:ptc:<n>` | bad4254d71（ptc.ts:613→469） |

**穷尽**（其余 10 个 base-only 事件是我们的、非改名；upstream-only 事件是上游新增）。**关键决定**：**0 个 live 冻结标题含改名 token → 标题逐字不变（铁律 321）**；但 **17 个 live-冻结文件在断言/被测码用旧名 → 重锚后重观测这些格**（如 P2-06.F 断言值 `'call-1:code:1'`→`:ptc:`；core/tools/src/ptc.ts 被 10 条冻结引用）。§4 = 标题不动 + 17 文件按新词汇重观测值。28 个我们改的文件同理，111 个上游文件由上游自己的改名处理。

## §5 快照重生成判据 — 【lane A base-align-preflight-A.md §1】
**数目更正:144 快照文件 + 1 文档**（session 93 / sdk 31 / web 14 / acp 6 / AGENTS.md 1）。**{纯可重生成 vs 需重观测} 二分今天为空——真 blocker 是迁移器**：`session-format-v2-to-v3/payload.ts:42` 对未分类事件抛，我们 fork 后新增 6 事件（`run/task-profile` 141/148、`identity/attached` 106、`action/manifest-appended` 101、`action/risk-gated` 96、`action/world-bound` 17、`job/abandoned` 1）上游没分类 → **任何录制迁不了**。**有序三步**：**步①=在重锚后树给这 6 类补 v2→v3 disposition**（我们的事件不删、给它们 v3 词汇里的落点=iron rule "改落点"）；步②之后 refresh/record 划分才可测（docs/testing.md:13 判据；上游改持久化词汇非 transcript,预期偏 refresh,待步①后实测）；步③ `snapshots/{sdk,acp}` 跑 lib 先 build（BLOCKED-245）。**仅 1 个快照承载冻结观测**：`snapshots/session/headless.snapshot.ts`（P9-06.P,harness TS 非录制=普通代码冲突）；P2-01.U.1 的三个 jsonl 不在冲突清单、不需重观测；其余 144 不被任何冻结引用。

## §6 19 PARTIAL 消费映射 + 15 ACCEPTED 4.4d 重验 — 【lane B/A base-align-preflight-*.md §2-§3】
- **19 PARTIAL**（消费上游实现的冻结用例过了才拆重复、验不过补齐不删=iron rule）：re-homing 只 3 个真失踪（全 P4-06/P5-10，见 §3），其余缺失冻结文件是我们的、随 rebase 走。**11 个无 live 冻结的 PARTIAL**（P1-04/P3-04/05/12/P4-14/P5-05/P6-09/P7-07/08/P8-05/10）→ 子句对上游实现**冻结鲜活**。已对上游码跑的：P0-06.U/.F、P1-10.U 存储部分、P5-10.U/.F。**co-location（非语义重复）**：app-boot(P1-01/P8-10)、storage backend.ts(P1-10)、workspace paths.ts(P3-12)、subagent(P4-05/P5-05/P5-10)、agent-loop(P4-06)。
- **15 ACCEPTED**（lane A/B 各独立算 15，**名单待 delegate 核**：lane A 法[registry 声明 ∩ 冲突]得 P3-01 在/P2-03 不在,与我的差两处；delegate 核 P2-03 是否经 overlay 触冲突后定终名单）：每条 {上游动了哪到达面 | 重验哪几条 4.4a-d}——**断了整改到再到达,不撤签**。**失踪路径三条(P4-05/P4-06/P5-11)先走 adjudication 记继任路径**（否则 4.4a 无可解析）。P2-01 的快照证据与其 `identity/attached` disposition 同一件事。**P1-03.U2 并入此批**（补记 320:落最坏冲突面,重锚后新 manifest 位置重做接线 + per-bundle 值）。lane A §2.2 / lane B §3 有逐 epic 到达面清单,两 lane 补全中。

## §7 slice 验收判据
新基线门集全绿 + CI 全绿 + 账本摘要重生成 + 受影响格重观测 + `frozenBaseline` 由 A=4e84901e64 改写为新基线；每处改动的"原→新→为什么"齐；19 PARTIAL 的续验冻结用例过、15 ACCEPTED 的 4.4a-d 重验过(不撤签);registry 子句逐字未变(diff 证)。

## §8 执行顺序
①本规格进仓+对用户确认 → ②lane 回执 → ③B rebase 到 c291e7961a、按 §3/§4 解冲突 → ④A 重生成 §5 快照/目录/投影 → ⑤两 lane 按 §6 续验 PARTIAL + 重验 15 ACCEPTED → ⑥门集/CI 全绿 → ⑦账本/frozenBaseline 重生成 → ⑧候选派发 → 绿 → 推。期间验收数不动,写进交班单与日报。

## §9 决定点与例外(preflight 完成后汇总;两 lane 测量 base-align-preflight-{A,B}.md)
- **step ① 收窄**:改名旧名是上游迁移链保留的历史词汇(我们录制是 v2 期日志),迁移链自带改名;**step ① 只是 6 个未分类事件的 v2→v3 disposition**,不扫录制。发射端改新名=源码工作(§3)。
- **§4 唯一例外 = P0-06.F**:3 条 live 冻结标题点名 fixture 路径(session.jsonl,U 上滚成 v2/v3),需 supersede 新标题点名滚后文件。其余标题逐字不变、17 文件重观测值。
- **失踪路径两性质**:`inbox.ts` 有继任(→agent-loop/src/inbox.ts,adjudication 记路径+改名,机械可解);**`write-behind.ts` 整层被上游删、无继任**(SessionWriteBehind 上游 0 命中)。
- **P4-06.P = 非机械、无上游锚、需重写重证**:relocate 到 `SessionHandle.append(events[])+flush()`,但上游无测试断言"事件+outbox 一次原子"(P4-06.P 子句),13 例须重写重证;**亲验 handle 真给原子则子句 relocate 成立,真缺则产品决定报用户**(iron rule:功能真缺才上报,不因删就撤子句)。
- **P1-01 manifestVersion 语义冲突 = 决定点(入用户丁级队列)**:上游 `manifestVersion?: 1` vs P1-01.C 冻"拒非 2";**iron rule:我们子句必须存活→合并类型须接受 2**,reconciliation(类型变 `1|2` vs 保留校验)执行时定、子句不弱化。
- **15 ACCEPTED 名单 = declared-file 冲突集,≠ 17 rename-affected 集**(一个文件可 rename-affected 但仍 auto-merge);终名单待 delegate 核 P2-03/P3-01 归属(两 lane 各得 15、差 P3-01/P2-03 两处)。
- **A/B 组冻结标题是否含旧事件名**:lane B token 扫得 0(除 P0-06.F 的 fixture-path);delegate 交叉复核后定是否需 frozen-title-renames 条目。
- **无上游锚的 PARTIAL(P1-01/03/04/08、P7-07)**:子句对上游实现鲜活冻结、验不过补齐不删。

## §9-更正(2026-09-13,lane A 契约核实推翻 §9 的 P4-06 relocate)
- **P4-06 更正**:§9 早前记"P4-06.P relocate 到 handle"**错**(基于 shape 检查非契约读)。lane A 读 `c291e7961a:handle.ts` 契约:append=best-effort accept/order/visible,**持久只在 flush、read 契约的 torn-tail 截断可在事件与 outbox 行间产生孤儿**——**契约明确不承诺 must[0] 要的"一次 append 内崩溃原子"**。且 P4-06 must[0] **实现整块干净**(message-bus kind N、packages/run 上游不存在、bus-store.ts:3 自证 SQLite 单事务),relocate 反而挪离实现处。**更正裁定**:P4-06 会话日志腿 = **真功能缺口 → 用户产品决定**(入丁级队列),**不记 relocate-to-append/flush 等价**;选项 ①上游 handle 补"每 append 原子"明文 ②该腿落我们自己提供该保证的包装。iron rule 321:功能真缺→上报,不撤子句、不假 relocate。lane A base-align-preflight-A.md §2.7 全文。

## §6-更正(2026-09-13,lane A §2.8:重验范围扩为冻结引用法)
- **名单更正:16 非 15**(lane A 工具漏读根级字典声明,修正后 P2-03 在——根级声明 `ptc.ts` 在冲突;P3-01 经 runtime-context.ts 也在)。
- **重验范围 = A ∪ B = 30 文件 / 24 epic**（不止 15/16 ACCEPTED）：
  - **A** = ACCEPTED ∩ (根级∪阶段级)声明冲突 = 16；
  - **B** = 任意状态 ∩ **live 冻结引用**冲突 = 24。**B 更要紧**：答"哪些已冻结观测在重锚后可能不再成立"= iron rule 核心（功能不失=每条冻结观测在新基线仍成立）；一条冻结引用的文件被上游改→该观测须重判是否仍描述同一棵树。
- **`ptc.ts` = 风险最集中**：10 格 8 epic(P2-03.U.1-4/P2-04.U/P2-05.U+U.1/P2-06.F/P3-01.U/P4-12.U.1),`:code:→:ptc:` 使这 10 格重观测值；**gap 文档指 index.ts 为错、真凶是 ptc.ts**。
- **B-not-A 14 条纳入**:P0-06/P1-09/P2-04/P2-05/P2-06/P4-01/P4-08(ACCEPTED)、P1-07、P4-12/P5-10、**P9-03/05/06/07**(P9 系进入范围:冻结引用冲突文件=观测可能失效=必重验,ledger 状态不豁免;P9-07 占 6 文件、P9-06 占 4)。A-not-B 6 条(P0-01/02/03/P4-05/11/P5-11:声明冲突但无 live 冻结引用该文件)。两集都要:A 定"重验哪些到达面"、B 定"哪些冻结观测可能失效"。

## §6/§3-精度更正(2026-09-13,lane A:ptc.ts 重观测的真因是断言值非标题)
- **ptc.ts 措辞更正**:早前"改名使这 10 格重观测值"**理由错**(0/81 冻结标题含改名 token,lane B/lane A 两次扫一致)。**准确**:ptc.ts 被上游 4 行重命名(子调用 id `:code:→:ptc:`、两事件名 `tool/code-dispatch[-start]→ptc-dispatch[-start]`、plugin source `tools-code-mode→tools-ptc`),**这些是运行期断言比较的值**;引用该文件的 10 格中,**只有 `core/tools/tests/ptc.spec.ts`(三 token 全中)与 `approval-code-mode.spec.ts`(`:code:`)的断言直接依赖这些值,须在新基线重观测**;没有一格因标题含改名 token 而需重观测。上游侧仅 +4/-4(合并小)、要改的是我们这两 spec 的期望值 + 重观测。
- **13 条 `code-mode` 标题**(P2-03.U.1×3/U.3/P4-12.U.1×3/P2-06.F×6)含的是**产品词汇非事件名**;上游 preset 也改(migration.ts:18 'code'→'ptc'),**若重锚后我们跟改测试标题**则这 13 条进 `frozen-title-renames`——**是词汇决定的后果、非合并强加**,别记成合并必然。
- **§3 发射端+断言端全仓范围(非 lib)**:`:code:` 14 文件、`tool/code-dispatch` 23 文件、`tools-code-mode` 2 文件——源码要一起改的面(比 10 格大),§3 记这三数。

## §6-P9(2026-09-13,lane B base-align-preflight-P9.md:P9 静默失效缺口 + 4 HIGH)
- **关键缺口:重锚后 P9 记录静默失效**。P9 不在 registry/ledger(决定 C3),记在 `p9-verification.json`(一次观测:run 34019035439 @00815e8acc)。registry 门集跑 `verify-p9-cells --check`=只重读不重导;P9 非 ledger cell→`verify-freeze-in-candidate-tree` 也不查;匹配是裸 `passing.has(title)`(无改名解析、无歧义拒绝)。**故重锚后记录仍 VERIFIED @00815e8acc、无门报错**。**裁(必入 §8 执行步)**:重锚后**显式重跑** `verify-p9-cells --report <签名报告> --ci-run-url <run> --candidate-sha <rebased>` 并提交记录,不靠 --check。**另裁(工具硬化,与 recompute 同族、非阻塞)**:`verify-p9-cells --check` 应比对 recorded candidateSha 与当前基线、陈旧则报(同"verifier-green≠product-fresh")。
- **冲突面**:P9-03.P(headless.spec.ts)、P9-05.P(token-meter/src/index.ts spec ±)、P9-06.C/P/F(headless package.json/spec/snapshot)、P9-07.P/U/F(agent.ts +179/-105、runtime-types、loop.spec +387、agent-loop/index +206、resume.spec +650)。P9-03/06/07 曾 VERIFIED、P9-05 VERIFIED_OR_BLOCKED(BLOCKED-107)。
- **4 HIGH(iron rule:子句存活、可能需重实现非只重观测)**:**P9-05.P**(token-meter 重写 BlockAssembler→assembleAssistantStream 等,重实现我们 +54)、**P9-06.U**(headless 流改自 agent/assistant-stream + SDK 语料滚 v2/v3,生产者与 fixture 双变)、**P9-07.P/F**(loop/resume 为 Session V3 重写,我们的 budget/exceeded 事件须过迁移+restore)。MEDIUM:P9-03.P/P9-06.P.F/P9-07.U;LOW:P9-06.C/P9-07.C。文件与事件改名表重叠。caveat:风险是 diff/commit 主题对冻结标题的读,非 rebased 树上跑。

## §6/§8-补(2026-09-13,lane A 可执行 checklist base-align-reverify-checklist.md:3 新发现)
- **失踪路径 = 3 不是 2**:第 3 个 = `session-persistence/tests/write-behind.spec.ts`(+0/−275,P4-06.P 引用),与 write-behind 本体同命运、随 P4-06 用户决定处置。
- **两个近乎重写压在冻结格上(HIGH,可能需重实现非只重观测)**:`subagent/subagent/src/continuation.ts` **+218/−1299**(≈重写,牵 P2-02.U/P4-06.U.3/U.4——须先读残存再判是否仍描述同段码;配套 continuation.spec.ts +760/−186 也近重写);`session-persistence-jsonl/tests/jsonl.spec.ts` **+1895/−966**(被引用文件里改动最大,牵 P0-06.F/U;而 P0-06 正是上游**独立造了同件事**[会话格式版本化]的 epic,须先比对再重观测、可能不止重跑)。
- **§8 执行顺序补:生成物先合脚本后重生成**:`tool-cordis/src/api-catalog.ts`(上游 +538/−202、我们 +1411/−33)、`docs/persistence-catalog.md` 是**生成物,重生成不手工合并**;`scripts/gen-cordis-catalog.ts` **先合再生成**(顺序反了白做一轮)。
- **分级:9 HIGH / 11 MEDIUM / 8 LOW**(HIGH=A组 profile-boot 4格+app-boot/profile 2格[DshManifestSection 上游无家]、B组 ptc.ts[10格最高扇出]/continuation/agent.ts/runtime-context[双方改动量相当须真语义合并]、C组 3失踪路径)。
- **可执行 checklist = `scratchpad/base-align-reverify-checklist.md`**(30 文件/24 epic,按 A→B→C→P9→D 排,逐行 {文件→冻结格+epic→上游改了什么→重锚后做什么→风险})=重锚 lane 逐条照做的单子。**Carried forward 4 决定**:P4-06 原子性(用户)、P1-03 per-bundle 值(用户,重锚后 manifest 形状上声明)、6 disposition(所有快照步前置)、是否跟改词汇(:code: 14/tool/code-dispatch 23/tools-code-mode 2;跟改则 13 条 code-mode 标题进 frozen-title-renames,合并不强加)。

## §6-补(2026-09-13,lane A 读残存判定:continuation.ts HIGH 降级)
**结论:continuation.ts 不是重写、是拆分——降级。** 行数真相 baseline 1631 → 我们 1907 → 上游 **550**:上游新建 4 文件(catalog.ts / continuation-activation.ts / continuation-messages.ts / inbox.ts)把 ~1300 行搬出。结算机制去向(settle/epoch/Settlement 逐文件命中,baseline→我们→上游):settle 45→79→**2**、epoch 10→27→**1**、Settlement 7→20→**0**;落点 = `continuation-activation.ts`(27/6/11)+ 少量 `continuation-messages.ts`。**inbox.ts 命中 0,不是落点,勿被文件名误导。** 机制仍在、被搬家——与 write-behind(整层删、0 命中、无落点)**性质不同**。
逐格判定(原 continuation.ts 三格全待判 → 现):
- **P2-02.U = 重观测够**:其 argv 四个 capability-token*.spec 上游全无(皆我们的),continuation.ts 只在 files[]、不在断言路径。文本合并后重跑。
- **P4-06.U.4 = 重观测够**:argv 只跑 settlement-outbox.spec.ts,而 settlement-outbox.ts/.spec.ts + message-bus/plugin.ts baseline 与上游皆无(纯我们新建),无可冲突。
- **P4-06.U.3 = 三条重观测、一条重接线**:4 用例中 3 条在 `core/agent/tests/arrival-dedup.spec.ts`(上游无此文件,安全);第 4 条 "carries child run's LEASE EPOCH" 在**共享的** continuation.spec.ts(上游 +760/−186),其主语(manager 构造、携 Store 发给子 Run 的 epoch 结算通知)**已搬到 continuation-activation.ts**——需把我们「通知携带 epoch」的 +292 行**重接**到搬家后的宿主段。**重接线 ≠ 重实现机制**;工作量按「一集成点 + 一用例重观测」估,非重写整包。
**影响**:continuation.ts HIGH 降为「两格重观测 + 一格重接线」;配套 continuation.spec.ts 只承载 U.3 那一条(非三条);**§9 的 P4-06 用户决定不因此扩大**(仍只关于 write-behind 的 enqueueAll)。

## §6-补·自纠(2026-09-13,lane A 判 P0-06:我先前的 premise 记错了)
**撤回**上文 §6/§8 补里"P0-06 正是上游独立造了同件事[会话格式版本化]的 epic"这句——**错。经 lane A grep 证:两者是不同两件事。**
- 上游造的 = **会话格式代次版本化**(SESSION_FORMAT_VERSION、v0→v1→v2→v3 迁移链、版本命名的代次文件),管整份日志格式。
- P0-06 造的 = **逐负载 schemaVersion 主版本兼容协商**(握手行/会话事件行/settings 段各自声明 schemaVersion,主版本不符则拒,缺省取本 build 注册版本)。
- 读数:jsonl.spec.ts 里 schemaVersion 我们 7 / 上游 **0**;negotiat 我们 6 / 上游 **0**;全仓 $schemaVersion 文件我们 2 / 上游 0。上游全仓 schemaVersion 仅 9 文件、全在 experimental/inspector 与 tool-cordis/api-catalog(Cordis inspector 快照 schema,与会话协商无关)。
- **结论:不重叠、不冲突、无需去重。** jsonl.spec.ts 的 +1895/−966 是上游格式链测试,与我们 +197 行加在同文件不同关注点——**文本冲突,非语义撞车**。
逐格:
- **P0-06.U = 重观测够**:13 用例横跨 sdk/server、jsonl、settings;前后两 spec 上游未动;jsonl 部分断言的 schemaVersion/协商上游 0 命中。
- **P0-06.F = 重观测够、但 gated**:3 用例回放三份真实录制(snapshots/web/fresh-round-trip、snapshots/sdk/text-turn、snapshots/session/skill-load),**三份全在冲突清单(session.v2.jsonl 改名形式)**——F 在六条 disposition + 这三份迁移完成前**无法判**。
- **§6 隐患(P0-06.F 特有,记为 gated 条件非结论)**:这 3 用例措辞"replays a real **pre-schema-registry** session fixture … with no negotiation";迁移后三份变 v3 录制,是否还算"pre-schema-registry fixture"须迁移后**重读用例**才能答——若迁移给它们加了 schema/格式标记,用例主语就变,那时才判"重观测 vs 改用例"。现在判不了、不该判。
**分级变动**:continuation.ts HIGH→**MEDIUM**(两格重观测 + 一格重接线);jsonl.spec.ts 维持 MEDIUM(去掉"可能与上游重叠"这个不成立的疑虑)。→ HIGH 计数 9→**8**。checklist 三行(continuation.ts / continuation.spec.ts / jsonl.spec.ts)已从"待判"落成结论,含 continuation.spec.ts 那条"重接线后强制重观测、文本合并通过不构成验收"。

## §6-补(2026-09-13,lane A 读残存收官:5 个 HIGH 全判完 → HIGH 8→3)
逐格(上游动作 / 判定):
- **ptc.ts**(原引 10 格):原地改名、宿主分毫未动(上游 678 行 9 声明,与 baseline 逐字同数,4 行改动全原地改值;我们 +258 含 appendCodeModeManifest 挂在没动的码上)→ **重观测,且扇出 10→4**:只 P2-03.U.1 / P2-03.U.3 / P4-12.U.1(经 tests/ptc.spec.ts)+ P2-06.F(经 approval-code-mode.spec.ts)真跑期望值;另六格(P2-03.U.2/U.4、P2-04.U、P2-05.U/U.1、P3-01.U)只在 files[] 引用、不改期望。**本轮最大工作量下修。**
- **profile-boot.ts**(4 格):只增不删(新增 initializeProfileFromDefault)→ 重观测。
- **app-boot/src/profile.ts**(2 格):4 类型搬去新包、其一改名 → 重观测。
- **agent-loop/src/agent.ts**(P9-07.P):抽取助手函数、零导出删、545→619 行反变长 → 重观测。
- **agent-loop/src/runtime-context.ts**(P2-01.F/U):双方各自在 76 行小文件加料、零删 → 重观测。
三条要点:
1. **DshManifestSection 自纠**:上一版误判"上游无家、需定去向"——**错**;它被**改名为 DshManifest**(package-manifest/src/types.ts:28),bundle?/profile? 两成员 JSDoc 与我们逐字同,另加 `manifestVersion?` 与 `client?`——改名+超集,同另三类型属搬家。**A 组不存在"无落点"类型。** → **`manifestVersion?` 直接落到用户决策队列 P1-01 manifestVersion 上:上游 manifest 形状已带此字段,P1-01 重锚后按此形状声明 per-bundle 值。**
2. **五文件上游删除的顶层导出总数 = 0**(逐个 comm baseline vs 上游导出名单):profile-boot 删0增1、agent.ts 删0(抽取非搬空)、runtime-context 删0、ptc.ts 删0、app-boot/profile 删4但四者全在新包有对应。"近乎重写/撞车"画面五文件皆不成立。
3. **限定(记进行内)**:以上判**声明层存活**(导出名单+行数+搬家落点),**非语义等价**——某函数体被上游改写而名字不变此法看不出,故判定写"重观测"(本就要跑出来、非纸面过)。
**估算影响**:HIGH 8→**3**——只剩 C 组三条失踪路径(inbox.ts 有继任、write-behind 本体+其 spec 待用户决定)。**A/B 组现无 HIGH**,全落"文本合并+重观测";其中仅 agent.ts / runtime-context.ts 两处是双方改过同区的真合并,余为单侧改动。checklist 八行已带 ADJUDICATED 落列。§9 用户决定**不扩大**(无 write-behind 式真删无落点)。

## §6-补(2026-09-13,lane A 交叉核 P9 硬化 × recompute × BASE-ALIGN)
**候选 12 组装第 4 项:已核。** lane B 的 P9 硬化动 5 文件(verify-p9-cells.{mjs,d.mts,spec.ts}、p9-verification.json、BLOCKED-QUEUE.md 只追加 BLOCKED-248):5 个全不在 BASE-ALIGN 冲突清单、与 recompute 分支(2ff333e393)文件交集空。→ 第 4 项可与第 2 项 recompute 并列排、互不依赖。唯一跨项风险 = BLOCKED-QUEUE.md 与 spec/first100/exec/* 上我的 fold,**append-only 解**。
**祖先关系(lane A 验)**:lane B 底座 7cc115a495 是 11″(124332d286)的**祖先**;7cc→11″ 的 delta = 3 垃圾删 + EXEC-STATE/ledger.json/ledger.md,**无一是 lane B 动的文件**。故 lane B 的 P9 工作 rebase 到推后 first100-exec 是干净重放。**硬要求:lane B 必须 rebase 到推后的 first100-exec、不得从 7cc 做 merge**(merge 会把三垃圾删除变成需判定的合并;rebase 则直接消失)。其 p9-verification.json 记 run 34746371931 对 7cc 的观测,7cc 留在历史 → **合法的祖先观测**,非对不存在树的观测。
**P9 组 STALE-by-design(lane B 指出、lane A 补进 checklist)**:新的 verify-p9-cells --check 在「P9 冻结条目命名的任何文件(files+argv)在记录候选与 HEAD 间有差异」时报红;**checklist P9 组每个文件都属此类** → BASE-ALIGN 一落地,**四条 P9 epic 会全部按设计报 STALE**。**不是回归、不得补绿**;正解 = **从重锚后树的一次观测重录 P9**(工具 recording form,同裁定 323 的 provenance 要求)。**顺序钉死:排在 A–C 组之后**——对尚未稳定的树重录会把错误观测钉死。此为原表(只写"逐 epic --report")漏掉的一层,已补为强制步骤。

## §8-补(2026-09-13,lane A 交付执行 DAG = 用户确认工件)
lane A 把散落 §6 各处的顺序约束提成 base-align-reverify-checklist.md 顶部「Execution DAG」:13 步,每步带 {前置、产出、验收},该节单独可跑。要点:S0a/S0b/S0c = **三条用户决定提成显式节点**(S0a P4-06 会话日志原子性,验收钉"不得记成 relocate 到 append/flush 等价";S0b P1-03 per-bundle 值,附 warn-and-proceed 全给会让 must[2] 接上但空转;S0c 是否跟改词汇,合并不强加、跟改才需 13 条 frozen-title-renames);S2(inbox 改名进 adjudication.json)必先于任何 4.4;S4 硬序(先合 gen-cordis-catalog.ts 再重生成 api-catalog.ts/persistence-catalog.md,永不手工合并);S8 六条 disposition 与 S5–S7 并行、迁移链本会处理改名;S10 P9 重录永不早于 S9。**三处 OBSERVE「合并通过≠验收」**:S6 LEASE EPOCH 用例(重接后须真观测到通知携带 epoch)、S9/S10 P9 STALE(意为"重录我"非补绿)、S11 P0-06.F 用例措辞(迁移后须重读"pre-schema-registry fixture"是否仍成立)。→ **此 DAG + S0a/b/c 即向用户提请确认整份 BASE-ALIGN spec 的工件**;执行前 preflight 再对用户确认(补记 321)。

## §9-补(2026-09-13,lane A 交付用户确认包 + delegate 补 D6 framing + 提请时机)
**用户确认包**(base-align-v3-user-confirmation.md,lane A)接受:六节(铁律→一段结论→待拍决定 D1–D6→风险台账 9→3 对照→验收与归属→未量清单),顶部 Provenance note 分辨"lane A 实测 vs 转述队列",D1–D3 默认皆不替用户定值,D6 未测不虚构推荐(请 delegate 补 framing),D5(P1-07 姿态)只默认不推荐(产品决定),验收把"重跑 4.4a–d 不以撤签了事"与三处 OBSERVE 列为显式条款。judgment 到位。
**delegate 补 D6(P2-10 scope,据 BLOCKED 6238/6244)**:P2-10 U 观测到 **settings 命名空间写入是截断写(非原子),影响每个 settings 命名空间**(不止 policy;owner settings/settings),现于 docs/policy/language.md:65 按 limb 记为已知限制。scope 决定二选一:(a) P2-10 U **按 limb 声明此限制并冻结当前行为**,把"settings 全局原子写"归独立 owner(settings/settings)后续 epic;(b) P2-10 U scope **扩到修好 settings 全局原子写**。**推荐 (a)**——P2-10 是 policy-language epic,跨命名空间原子性超其边界,归错 owner 使其无限膨胀;但这是产品/scope 判断,列推荐不列结论。**默认(不答)= 维持现状**(已按 limb 记为已知限制、不重签)。
**提请时机(delegate 裁)**:BASE-ALIGN 执行 gated 在候选 11″/12/P4-12 之后(数天),用户异步作业——**现在不打断**;完整包备好,待用户回来或执行临近时一次性提请(重锚执行前 preflight 本就要再对用户确认整条规格,补记 321)。

## §9-补(2026-09-13,用户确认包自洽核查拦下两处会误导用户的错)
lane A 通读用户确认包,自查拦下两错并改(均在到达用户前):① Provenance note 指错节(声称"§1–4=lane A 实测、D4/D5/D6 非",节号与归属都错——一份声称能分辨来源的文件其来源地图错=比不写更糟)→ 改为按决定编号归属(D1–D3=lane A 实测,D4/D5/D6=delegate 项,§1/§5=delegate 流程裁定,§2/§4/§6=lane A 实测);② §2 概述段把失踪路径成败数写反("两条有继任、一条无"→ 实为 inbox.ts **一条**有继任、write-behind.ts + 其 spec **两条**无),此错恰把 D1 严重性说小、且在用户最可能只读的概述段 → 改为逐路径点名。另:去掉"15/16 ACCEPTED"的假不确定(实为 16、P2-03 在内)、厘清 16 与 24 是两套推导(交集 10、并集 30)免用户混读。自洽核过:六节齐、六决定各带推荐+默认(awk 验)、HIGH=3 与台账一致、D1 作唯一真缺口三处措辞一致。**信号:面向用户的工件的自洽核查,重点在"概述段/来源图"这类用户最先读、最易被误导的位置——两错皆属此。** 包 ready、按定时机不现推。

## §6-补(2026-09-13,lane A 预推两处真合并:7 重叠全 clean compose)
S6(B 组)仅有的两处"双方改同区=真合并"预推完,结论**七处重叠全可 clean compose、零语义冲突**:
- **runtime-context.ts(P2-01.F/U)**:仅一处重叠 = import 块;我们 98 行加在上游改动范围外。**排除一真风险**:上游把 SessionSeq 改 type-only、基线:39 有 `SessionSeq(index)` 值调用——但该行在**我们没碰、上游自己重写**的段内,且我们新增码从不提它。
- **agent.ts(P9-07.P)**:七处重叠(imports×3、类字段×2、构造器、新方法),每处两边加不同东西、取并集即可。
- **一处 OBSERVE**:构造器(我们加 identity 解析 + `session.append('identity/attached',…)`,上游重排 scope/inbox 构造)——我们语句只读 session/options.identity、不碰 this.ctx/this.scope,与上游重排无序依赖;**但这是 P2-01 证据,合并后必须真跑确认构造时恰发一次**,不靠看。→ 写进 checklist S6 行。

## §8-补(2026-09-13,候选 12 组装模型裁定 + 文档落点)
lane A rebase 其半 = **2436b89c19**(base 124332d286:recompute 83a1955860[= 2ff333e393 纯重放,range-diff 单 `=`、文件集逐字同] + .gitignore 补 `.merge_file_*` 那笔[按补记 324 放候选 12]);本机门:typecheck-host exit0/TS0、files-overlay 388、freeze-in-candidate-tree 191 GREEN、verify-cells-recomputable **145 GREEN(107 RECOMPUTED/0 MISMATCHED/38 DRIFT/0 UNAVAILABLE)**、spec 19/19、树干净。144→145/106→107 因 P2-10.F 落地新增一格且**立即可从产物重算**=recompute 功能在新底座被真实使用。
**组装模型裁定("overlay 最后叠",答 lane A 问 1)**:
- **lane A 提交自己写的规格文档进 spec/first100/exec/**(候选分支内、其自身工作树,非 delegate 代提):`base-align-reverify-checklist.md`(含 DAG/S8b,重锚可执行计划,属 in-tree)+ `base-align-v3-user-confirmation.md`(与 checklist 互相引用,一并 in-tree);`candidate-12-assembly.md` 留 scratchpad(纯工作辅助,不 ship)。
- **lane A 整合 lane B rebased 两笔**(P9 硬化 ccab518d33+a875f628d8、记录修 d06f80c535)成合并候选 tip,交我 SHA。
- **delegate 用 overlay 叠**:`base-align-v3-preflight.md`(已在 overlay spec/)+ 补记 295–329 + BLOCKED-QUEUE 更新;plan-rectification/BLOCKED-QUEUE 与 lane B 记录修同文件处**append-only 合并**、我叠时解。
- 最终 tip = lane A 合并候选 + overlay 叠 → 我核门 → 派③。

## §6-补(2026-09-13,lane A MEDIUM 预分析:profile-boot.ts 签名级真冲突 + 量具 v3 校正)
**profile-boot.ts 真语义冲突(非"改同区")**:`composeProfile` baseline 两参 `(name, patchFiles)`;**我们**(:207-211,调用 :474)加第三参 `production: boolean`(P1-03 接线 pluginEnforcement),**上游**加第三参 `fromDefaultProfile?: string`——**同一位置参数、两义两型,且函数体两边都改**,3-way 合不了(合并签名须同容两者=四参或 options 对象)。同文件 import 行第二处冲突=**良性并集**(baseline `writeFileSync`;我们 +existsSync,readFileSync;上游 +existsSync,mkdirSync,rmSync;正解并集 `existsSync,mkdirSync,readFileSync,rmSync,writeFileSync`,取任一侧丢符号)。
**量化印证补记 320(P1-03.U2 推迟到重锚之后)**:P1-03.U2 已从候选拆出、**不在 first100-exec**,故此签名冲突当前不在重锚面上;若重锚前落 P1-03.U2,重锚就要在最坏文件上解签名级语义冲突;推迟后 P1-03.U2 直接在上游已三参化的 composeProfile 上做、决定第四参 vs options 一次成型。checklist 该行原"host intact, re-observe"**仍成立(上游未删顶层声明)但不完整**——声明层存活 ≠ 调用面不冲突;两处写进该行。
**量具 v3 校正(lane A 自纠,记为方法论)**:重叠判据 v1(git diff 默认 3 行上下文)→ 30 文件全报真合并(上下文串扰);v2(-U0)→ 纯插入误算占锚点、过报;**v3(现用)= 只交"双方删除或修改的 baseline 行号集",两侧改同一既有行才算冲突、纯插入不计**。v3 与三次手工深读吻合(agent.ts 可组合[我们改 7 行零交集]、runtime-context.ts 可组合[改 0 行纯追加]、ptc.ts 可组合[改 0 行]、continuation.ts 冲突[13 共享行])——手工与机器两独立路径同答=v3 可信。**全 30 文件:12 改同行 / 18 可组合**;两大头 persistence-catalog.md(15 共享行)、tool-cordis/api-catalog.ts(2)**皆生成物 → "重生成不手工合并"自动消解**=该顺序约束价值首次被量化。逐文件判定 lane A 连 checklist 落列发来。

## §6-补(2026-09-13,lane A 完成 12 真冲突文件逐个判定 + 409fdf7dca 处置)
**12 真冲突文件(v3 判据:交集两侧删/改的 baseline 行号)判定——只 3 个要人定,9 个有规则**:
| 文件 | 共享行 | 判定 |
|---|---|---|
| profile-boot.ts | 2 | L14 fs import 并集;**L210 composeProfile 签名真冲突(已报,P1-03.U2 面)**。OBSERVE |
| continuation.ts | 13 | 已判 2 重观测 + 1 重接线。OBSERVE |
| core/agent/inbox.ts | 8 | 上游删文件、我们每行撞删除 → **由 S2 adjudication(inbox 改名)解,非合并决定** |
| docs/persistence-catalog.md | **15** | **生成物→重生成,冲突归零**(全集最大一处直接消解) |
| tool-cordis/api-catalog.ts | 2 | **生成物→重生成** |
| subagent/src/index.ts | 1 | 上游 queueSubagentPrompt→deliverSubagentPrompt 改名、我们改同 return 块 → **小但真:调用跟改名**,后重跑 P4-06.U.4/P5-10.F/U |
| headless.spec.ts | 1 | import **并集减 Inbox**(只取我侧会重 import 上游已删符号) |
| jsonl.spec.ts | 2 | import **并集**(再证两侧做不相干事) |
| write-behind.ts | 1 | 上游删整层 → **D1/S0a 用户决定,非合并** |
| headless/README.zh.md | 1 | **L64 散文真取舍**(我们=模型路由解析、上游=agentDefaultModel 链接)→ 要作者不要合并规则;英文对在 BLOCKED-124 hold |
| headless/README.i18n.yaml | 2 | 配对 blob 哈希 → **机械重录**(等散文定) |
| agent-loop/README.i18n.yaml | 2 | 同上 **机械重录** |
**3 个要人定** = profile-boot L210(签名,P1-03.U2 面/延后)、README.zh L64(散文取舍,**作者决定非用户;BLOCKED-124 hold 下**,记入重锚决定表非 S0a 用户级)、write-behind(=D1/S0a 用户决定,已在确认包)。
**量具 v3(lane A 自纠,重申)**:v1 默认 diff 3 行上下文→30/30 全报;v2 -U0→27(纯插入误算);**v3 只交两侧删/改 baseline 行号**,与三次手工深读逐条吻合(agent.ts 可组合、runtime-context.ts 改 0 行、continuation.ts 13 共享)。**任何"文件×冲突"下游分析必须用 v3,否则从 27/30 出发误当冲突**。
**409fdf7dca 处置(裁)**:此分类落进 checklist 新节(commit 409fdf7dca,87b248 之上),是 e0a28769be(=候选 12,已派 run 34751675619)的**兄弟分叉、不在该 run 内**。**候选 12 保持 e0a28769be 不动**(纯文档、不动代码门,不值得取消半程 run 重派);409fdf7dca 等候选 12 推后 rebase 到新 first100-exec、并入下一候选(P4-12 或 docs sync)。

## §7-补(2026-09-13,lane B 定精确 4.4d 重跑集=17;merge集与4.4d集正交)
**接受 lane B 的 17 个 4.4d 重跑集**(rebase-4.4d-rerun-set.md,每 epic 带依据,merge-tree 124332d286 vs c291e7961a 实测),三层:
- **T1(生产文件被上游删,最高险,可能要重做非只重验)**:P4-05(inbox.ts/agent.ts/runtime-types)、P4-06(inbox.ts+write-behind.ts 皆删、continuation.ts+subagent/index.ts 冲突)、P5-11(唯一生产文件 inbox.ts 被删)。
- **T2(dispatch/boot 生产路径内容冲突)**:ptc 组 P2-03(声明,上游 +4/−4)/P2-04(冻结U)/P2-05(冻结U/U.1)/P2-06(冻结F)/P3-01(runtime-context+冻结U 的 ptc);P4-11(agent.ts,上游 +179/−105);P2-01(runtime-context/app-boot-index);P2-02(runtime-context/continuation);boot 组 P0-02/P0-05/P1-01/P1-08(profile-boot/app-boot-profile)。
- **T3(挂载面)**:P1-03、P4-01(bundle/base/package.json)。**base/package.json 两侧无同 key 冲突(仅文本相邻),真险=合并须保住我们加的 18 个插件依赖(cordis.patch.yml 挂载靠它们解析)**。
**修正我 ~19 初判 → 17**:同意补入 P2-04/05/06/P3-01/P4-01;**P0-01/03/07 移出 4.4d**——P0-01 冲突只在 docs/testing+根 package.json+lockfile,不需 4.4d 但**必须重 baseline**(上游 workspaces native/landlock-run→native/system + lockfile 变=baseline 指纹输入,旧 baseline 必 verify 失败);P0-07 合并后重观测;P0-03 agent.ts 是 seam 检查器**扫描对象**非调用路径(冻结用例="resolves a real multi-family Consumer import"),重观测即可(borderline,重锚 preflight 若重观测暴露 consumer 结构变则升级)。runtime-types.ts 仅 8 类型导出 0 运行时,不独立入集。
**关键结构洞见:merge 冲突集 ⊥ 4.4d 重验集**:lane A 的 12(v3 同行冲突)=**须人工合并解决**的文件;lane B 的 17=**生产可达性可能变**的 epic。agent.ts/runtime-context.ts/ptc.ts 对 merge"可组合"(无同行冲突),但上游大改其生产码 → **仍须 4.4d 重验**。**"可组合"≠"无需重验"**——两者正交、都要:12 → DAG S5/S6 合并解决;17 → DAG re-verify(S9 段)。
**命中冲突但不入 4.4d(重观测/重生成/重 baseline 即可)**:P0-04/08(package.json 依赖)、P0-06(jsonl.spec 测试)、P1-09(api-catalog 生成物+gen-cordis+README 翻译对)、P4-08(workflow-worker-thread/package.json provider 依赖,合并保住我们 7 个 peerDependencies)、P0-01(重 baseline)、P0-07。
**非 ACCEPTED 波及(记,重锚时处理)**:inbox.ts 删亦波及 P5-10(BLOCKED)/P2-12/P8-03;**write-behind.ts 删波及 P4-12 registry + P6-08 → P4-12 重锚后 re-sign 时 4.4d 读数须在重锚树重量**(与当前 pre-re-anchor 的 P4-12 候选 4.4d 分开);headless/package.json 仅 P9-06 冻结引用 → 归重锚后 P9 重录。

## §6/S9-S10-补(2026-09-13,headless.snapshot.ts 三重身份=派 S9/S10 必须点名的消歧程序)
lane A 指出 `snapshots/session/headless.snapshot.ts` 同时是:**(a)** 一个偶发红的宿主(候选 12 首跑两红之一、但那树 diff 零 packages/apps/snapshots)、**(b)** P9-06.P 的 live 冻结引用(harness 驱动非录制)、**(c)** BASE-ALIGN 冲突文件之一。三重身份 → 重锚期间它任何一次红有**三种解释、三种补救**:
1. **偶发(intermittent)** → 补救 = 重跑取第二次读数(重锚前就偶发,非重锚造成);
2. **重锚破坏(merge/重接线弄坏了 harness 路径)** → 补救 = 修合并/接线(真 bug);
3. **冻结观测过期(P9-06.P 的主语随重锚搬家,STALE-by-design)** → 补救 = 按 S8b/S10 重录(不是修树)。
**派 S9/S10 时 delegate 必须对执行 lane 显式点名此三义 + 消歧顺序**:先重跑排 (1);仍红则看快照 diff 是"harness 路径断"(→2 修)还是"主语搬家的合法新输出"(→3 重录);**别在现场才发现有三种可能**、更别按单一假设派人去修一棵没坏的树。lane A 已把 (1) 的提醒写进 checklist P9 组(tip 7f324ceaea);(2)(3) 的消歧由 delegate 派 S9/S10 时口头点名 + 此节为据。
**两条 watch 项(承补记 335,不随候选 12 绿翻篇)**:① agent-team/persistence.spec.ts 与 headless.snapshot.ts 这次红——别的 SHA 同形红才入册;② headless.snapshot.ts 三重身份本身=重锚执行期的高误判点。
