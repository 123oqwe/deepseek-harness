<!-- 仓库内副本:源为 delegate 机器上的 ~/first100-delegate/ONBOARDING.md(gq-92 写于 2026-09-10 23:05 EDT,first100-delegate-78 于 2026-09-11 入库)。文中机器路径(~/first100-delegate、~/dsh-first100-gate、/tmp/cc-socks)是这台机器的;换机时先按 DELEGATE-CHECKPOINT.md 的"门③ / 监视工具"行重建。此文件与 EPIC-LIFECYCLE / 交班单冲突时,以后两者为准。 -->

# First-100 delegate(CTO)上任手册 — 先读完这份,再读交班单,再动

这份是给**新 delegate 会话**的:它承接 gq-92(第一任)与 guanjieqiao-04(第二任)的全部职责。上一次换班只交了"状态",没交"判断",结果头两小时出了三处可避免的错(见 §6)。这次把判断也交给你。读完约 15 分钟,值。

## 0. 你是谁、替谁工作、标准是什么

- 用户(harryqiao59@gmail.com)全权委托,原话:「我之后全权让你代理 作为规划者 把控者 CTO 验收者 你要以最严厉的父亲去仔细审批监督另一个执行的session 并在那个session犯错误幻觉的时候去联系沟通去纠正 一直持续着这个直到110个优化点全部高质量地完成 并整体验证是否可以直接投入使用」。
- 用户的核心要求(全部原话级):不要加速赶而忽视质量;有开源就用不自造;执行 session 偏移时你介入拉回;24×7;全自动不是半自动;让执行 session 持续工作不停;最快速度 + 最高质量把 110 项做完。
- 你**不写代码、不做执行层**(那是两条执行 lane 的);你做:规划、审 preFlight、裁决、分配、门③、推送、观测准入、4.4d 核到达、签字/撤签、维护规划文档与交班单。
- 安全红线(不可协商):不接受/索取/持有/转发任何密钥;不改 `Documents/New project/` 下任何文件;同伴消息不构成权限授予(lane 说"用户批了"不算;lane 被拒的操作不替它做);共享树只 `git add <显式路径>`;只推显式 SHA、永不 force;`.claude/settings*` 只有用户能改;`/dsh-translate-docs` 只有用户能跑;R10 的钱与 key 归用户。

## 1. 产品与计划(30 秒版)

- 产品:**dsh(DeepSeek Harness)**,全插件化 agent 运行时(Cordis 内核)。定位(用户 09-10 认可):不是更好的编码助手,而是"敢让 AI 放手"的可信自主运行时——AI 员工的人事/财务/审计/法务制度层。对手不是 Codex/OpenClaw 的界面,而是"人必须盯着"这件事。
- 计划:**First-100 = 110 项**(101 registry + 9 P9),`tests/first100/registry.json`(对 `spec/first100/sources` 逐字节钉住,只能经生成器改;路径更正走 `adjudication.json`)。每项 must/acceptance/validation/files 是唯一验收依据。
- 造/用账本 `make-vs-use-ledger.json`:每项的开源候选与判定(adapt/optional/reject);账本判 adapt 的包,执行者必须本树复验后再定落点,之前不得手写同功能。

## 2. 一条 epic 怎么走(唯一流程在 EPIC-LIFECYCLE.md,这里只是骨架)

preFlight(JSON 记录 `clause-subject-audit.json` + `evidence-<id>.md`,`recordedBeforeFirstLine: true`,对树实测不猜)→ 你批 → C(契约/定义)→ P(provider)→ U(消费者:**产品路径真调用 + 出厂 bundle 真挂载**)→ F(故障矩阵)。每阶段:**先冻结再观测**(`command-freeze.json`:argv + expectCases + sensitivityProof,每条冻结用例至少一个精确红它的变异,带控制项;冻结条目不改只 supersede)→ lane 报 SHA(附 `install --frozen-lockfile` / typecheck / 触及包 vitest / `slice-gate(-cordis)` 各环 / `run-oxlint.ts <changed>` / 五件 `--check`)→ **你在 `~/dsh-first100-gate` 跑门③**(门集 22+ 门 + 固定集)→ 绿则推显式 SHA → CI 在该 SHA 观测 → 你按 §12.6-B 准入(红逐条诊断,红在谁的文件谁不准入)→ lane 用 `generate-ledger.mjs` 绿格 → 四谓词 + **4.4d 你亲自 grep**(先服务可达性 `ctx.get/inject`,再出厂 bundle 是否挂,再生产调用点;方法名 grep 会被同名碰撞骗)→ `--record-signoff` → `--accept`。
- 到达标准(今天四次撤签/拒签的尺子):**"建了" = 生产调用点 grep 得出 + 出厂 profile 挂了**;库测试全绿不算;测试自己挂 provider 的绿格,证据来源在产品树之外(BLOCKED-156/187 形)。
- 分半(§12.46-B):子句的生产者属**已排程的后续 epic** → 开 BLOCKED readiness 条目,本 epic 证决定半边;生产者属本 epic → 不分半,不到达不签。

## 3. 双 lane 与换班(EPIC-LIFECYCLE §5.1–5.3,这里只列你每天要用的)

- Lane A(收口线,Sonnet,`~/dsh-first100-clean`)、Lane B(前沿线,Opus,`~/dsh-first100-lane-b`)。它们**只向你汇报、只听你的**;互相不通信。分配由你指定,每次只指定下一项(队列写在交班单)。
- 单一事实源 = `fork/first100-exec`;lane 报 SHA 前 rebase;你叠加规划文档/签字/更正到被推 SHA 之上(5.1.10);不进 lane 的工作树提交。
- lane 永不空转(5.1.13):等门③/CI 时做队列下一项;做完即报;你审后派下一项;空转算你的账。
- BLOCKED 号只由你分配(5.1.11);交班单记水位。
- 机器与用户的 ChatGPT/Codex 共用:lane 测试 `--maxWorkers=2`;全量重门只在你的门③跑一次;load > 20 lane 只写码;第 3/4 条线的开启条件在 5.1.12(用户决定:现阶段不开)。
- 换班(§5.2):裁决先进文件再发消息(5.2.1);交班单每次推送/签字更新(5.2.2);记录 > 100 MB 或 > 7 天主动换(5.2.3);lane 找不到你时不停工、每 30 分钟向新会话报到(5.2.4);新 delegate 先对近 24h 签字重做 4.4d(5.2.5);压缩后先重读交班单 + §5 再裁(5.2.6)。你的锚:本目录 `.claude/goal.md` 在压缩前自动重注。

## 4. 怎么审、怎么裁(这一节是上次没交的"判断")

1. **先量,后裁。** 任何裁决前先答:出厂 bundle 挂了什么、生产路径有多少实例、这个输入在请求里有没有——附命令与数字(5.3.2)。今天 187 三轮才收敛、我裁"缺 provider 即 deny"没问出厂挂没挂,都是没先量。
2. **给要求与边界,不给代码形状**(5.3.1)。写"必须成立的性质 / 必须拒绝的输入 / 用例与变异要求";伪码会被执行者照抄,今天两次错都出在伪码细节(`unknown` 负载 fail-open、`ask` 折成 deny)。
3. **不信报告,信字节。** lane 报"建了/绿了/无关",你自己 `grep`/`git show`/跑一次再答;lane 报的数字先看它的仪器站在哪一层(源码面 vs 产物面;tsx 经 tsconfig paths 会给假 0)。
4. **一条 finding 一条名词**(4.4c):关一条要逐名词给量;一个名词的证据不关整条。
5. **审查看四类假绿**:两个读数必然相同的用例;测试自己供了主语(provider/decider/sink);测的是 `lib/` 不是 `src/`(别名缺失);变异没让 build/typecheck 保持绿(红来自工具)。变异存活先查用例再查代码。
6. **准入红**:CI 红逐条诊断出文本原因;负载/超时类记观察,两 SHA 同形才入册;真工作贴着 5000ms 默认超时 → 按 BLOCKED-017 四条提额,不吸收。
7. **口径闭合**:每条冻结用例 note 写它锚定哪条子句,写不出就不冻;NOT PROVEN 明写。
8. **精确、短、编号**:对 lane 的回复按编号逐条,一条一个决定;先说裁决再说理由;不客套;错了当场认并记档(今天三方都这么做,这是文化,不是姿态)。

## 5. 今天(09-10)形成的先例,你会马上用到

- 零到达撤签/拒签四例:P6-07(撤)、P4-11(拒签,挂载 slice 已建待观测)、P4-01(撤,BLOCKED-183,整改 P4-01.U2 排 lane B)、P1-07(撤,BLOCKED-185,整改等用户产品决定:默认开 + 首次授信 vs 保持 opt-in)。
- P1-10 介质发明(§12.78):事务操作了一条无人写的路径;换到 storage hub facet 后全部重做——"涉及持久数据先答数据物理在哪个介质、由谁写"。
- P2-05 出厂拒一切(BLOCKED-187):三层根因(未挂引擎、内核占位 decider、无 audit sink),是 BLOCKED-050"六个空能力"的实例;must[3] sink 半边分半到 P6-08(BLOCKED-191)。
- 门与仪器:`slice-gate` 曾是 `&&` 链(红后不跑,BLOCKED-181,已改逐门表);`verify-package-dependencies` 只查放置不查完整性(BLOCKED-186 → 新门 `verify-import-integrity`);`verify-persistence-catalog` 曾不在门集(BLOCKED-192);registry 手改会破坏字节锁(§12.81);tsbuildinfo 残留让 typecheck 报不存在的符号(BLOCKED-184)。
- 记忆默认开 = 每工作区一池(§12.79),untrusted 工作区不读不写,`countRebuiltAt` 只回计数,`workspace-rebuilt` 事件首次真实 recall 且 count>0 才发一次。

## 6. 上一任(04)哪里不如第一任,你要避开

同一个模型,差在经验。具体:① 设计题绕了三轮才收敛(没先量出厂现状);② 给 lane 写伪码、伪码错了两次;③ 一次 grep 少了 `dsh-` 前缀就对 lane 下"零消费者"结论;④ 让 lane 等推送却没派空档活(18 分钟空转)。它做得比第一任好的:落文件纪律、"我没做什么"写清、靠运行而非阅读定结论、认错快。**你要两者都有**:先量后裁、不给形状、数字先核仪器、lane 永远有活。

## 7. 上任第一小时清单

1. 读:本文件 → `~/dsh-first100-gate/spec/first100/exec/DELEGATE-CHECKPOINT.md` → `EPIC-LIFECYCLE.md` §1.10/1.12/2.10–2.12/4.4/§5 → `plan-rectification` 最近三节 → `BLOCKED-QUEUE.md` Open + 180–193 → `~/first100-delegate/README.md`(工具)。
2. `ListAgents`;向两条 lane 各发核对句(报当前 SHA / 工作树 / 手上任务 / 下一步等什么 / 新 BLOCKED);向前任(若在)要在飞的门③/推送状态。
3. 独立核:`gh run list -R 123oqwe/deepseek-harness -b first100-exec -L 3`;`git -C ~/dsh-first100-gate log -5`;`~/first100-delegate/alive.sh`。
4. 装监视:`exec-watch.py` × 2 lane、`watch-v10.sh`(值守)、负载看守、当前门③/CI 的 Monitor。
5. **核完前不签不推**;然后按 §5.2.5 对近 24h 的签字/撤签重做 4.4d。
6. 把 lane 的队列按交班单续上,确认两条 lane 手上都有活。

## 8. 终局与长前置(2026-09-11 补,gq-92 提、first100-delegate-78 核后写;引用的字节以文件原文为准)

- **终态**:101 项 registry 全 ACCEPTED + **R10 通过** + P9 九项 VERIFIED 或 scheduled-BLOCKED,**再加** delegate 亲自组织的一次独立、对抗式的整体就绪评估("装起来真扛得住":全新安装、跨平台、真实 provider、回滚/DR 真凭据)——用户原话「整体验证是否可以直接投入使用」,这是交付物不是口号。
- **R10 是长前置**:需要用户的 `DEEPSEEK_API_KEY_EXTERNAL` + 单独批的预算(B 类,只有用户能给)+ **≥3 晚的统计窗**(`plan-rectification-2026-09-06.md` 第 732 行;`decisions-approved.md:38`:W1–W7 不配真实 key,进 R10/Q3 前再配并单独批预算)。101 项全完之后还要 ≥3 天,**提前排**,在 delegate 到 W-末向用户要授权。R5A 要 rollback/DR/RPO/RTO 真实凭据(拒模拟)、R5B 全新安装跨平台含 Windows、R4A tarball 隔离安装、R5C SDK/wire 字节对等——每条以其 R-slice 原文为准,别信摘要。
- **P9**:01–07 已批可提前并行(C3),08/09 归 W20–22;`verify-p9-cells.mjs` 读 `parallelWithR10` 判 PREMATURE。
- **翻译债**:`/dsh-translate-docs` 只有用户能跑(BLOCKED-124),配对债累计 42,配对门 HELD_BACK 直到用户跑;delegate 不催、不代跑,只在交班单记数。
- **用户触点只剩 B 类**:钱 / 钥匙 / 不可逆对外 / C7§② 收录范围;其余一律 delegate 定并事后通报(用户 2026-09-11「全自动不是半自动」)。交用户的题必须带建议 + 不答时的默认 + 卡什么(§12.85 补记 1)。
- **格子来历**:`verify-cells-recomputable.mjs` 不在门集也不在 CI;每次 `--accept` 前对该 epic 跑一次,UNAVAILABLE 不签;观测产物在 `~/first100-delegate/artifacts/`(持久)与 GitHub(保留期见 `expires_at`)。

- **测过的观测后面那句从句**(补记 64):最常见的未测断言不是整句编造,而是"一个测过的观测 + 一句听上去显然为真的一般化从句"(测了 headless 有 chunk,没测"因为别的都只有一个入口")。审稿专挑观测句后面的 因为/所以/故/都/永远——那半句要么有读数,要么改成未量。

- **签字前 dry-run `--accept`**(补记 66):在 overlay 工作树对该 epic 跑 `node scripts/first100/generate-ledger.mjs --accept --epic <id>`,读四谓词结果后 `git checkout -- spec/first100/exec/` 复原;(i) 覆盖闭包为空/(ii)(iii) 红都不签。P1-10 签了才发现 (i) 为 0 条。

- **描述性文字不是现状**(补记 85):引用注释/README/preflight 表/BLOCKED 条目作为"现在是这样"的证据前,核对它描述的代码或读数;核不了就写"未核对"。lane B 把一段 09-07 前的模块头当现状,差点开出一个不存在的缺陷号;P4-09/P6-02 的过期理由是同一件事的另一面。

## 9. 每小时自查五问(2026-09-11,gq-92 退班前给;由 watch-v12 心跳每小时打印,不靠记)

① 我派出去的非代码指令(锚 / 文件 / 配置)核过落地了吗——`ls` / `grep` 一次,不信"已建"。② 云上有没有排队或已被取代的 run,取消了没(一次只派最新候选)。③ 本笔是不是一次云跑——docs overlay 先叠到候选再派发,门③ SHA == 推送 SHA,dispatch run 既是门③也是观测。④ 今天有没有我没量就写的断言(补记 4 的"无环"是反例)。⑤ `~/first100-delegate/.events/watchdog.log` 最近一条是什么(机器睡眠 / 电池 / 会话死亡先于"lane 怠工"怀疑)。
