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
9. **引用描述性文字前,先核对它描述的代码;核不了就标"未核对"。**(2026-09-11,lane B 自纠后立规,是第 3 条"不信报告,信字节"的兄弟——那条防的是别人的报告,这条防的是**仓库自己的散文**。)注释、模块头、preflight 表、note 都会比它们描述的状态活得更久,而且写得越有说服力越危险。当日实例:lane B 引 `capability-token/src/index.ts` 的模块头"签名是固定四字节、`signatureRoots` 为空、签名证明不了来源",据此报 P2-02 的 acceptance 建立在空前提上——而真 Ed25519 签名已于 `1ac2dfe4d1`(09-07)落地四天,队列的 P2-02 锁行早标了 LIFTED。同日同形还有三处:P4-09 acc[2] 的理由("no child runs",已被 U.2/U.5 推翻)、P6-02 的 OQ19 九字段表(所述工作已落地)、P0-06 的"平凡为真"(没人写下来)。**判据:一段散文若断言当前状态,引用它等同于自己作出该断言**——要么跑一条命令核实,要么在引用处写"未核对"。

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


- **叠 overlay 后再跑三个轻门**(补记 89):撤签/accept 改了 ledger 行状态,`verify-adapt-dispositions` 会按新状态重判 deviation 理由;`--check` 只核摘要。叠好 tip 后跑账本状态门全组(`--check`、registry-extraction、specs、files-overlay、persistence-catalog、freeze-in-candidate-tree、adapt-dispositions、make-vs-use;皆秒级)再派发(补记 96)。

- **accept 后再跑两门再复原**(补记 120):`--accept` dry-run 通过后,先在 accept 后的树上跑 `verify-make-vs-use` 与 `verify-adapt-dispositions`——两门对 ACCEPTED 行与 PENDING 行判定不同(P2-05 accept 后 AuthZEN 所有权立刻要求 live 冻结用例点名),再 `git checkout -- spec/first100/exec/` 复原。

- **否定结果先证明工具真的问了**(补记 124):今日三次"探针失败把自己报成读数"——zsh 未加引号变量不分词(有序祖先链被报成 UNORDERED)、`$SHA:path` 的 `:t` 修饰符吃掉路径(存在的 fixture 报 ABSENT)、`grep -v "x/src"` 子串误排 `ui-x/src`(答复者计数 1 报成 0);加上 206 的 `require.resolve('ajv')`、218 的被吞 stderr。判据:拿到"否/缺席/0"时,先看报错里有没有被截断的路径片段、命令是否真的对着目标跑过,再把它当读数。第四例(补记 129):snapshot 语料不在 vitest include globs 内,`vitest run snapshots/… -t x` exit 1、2–4s、无 summary = 零次执行,须 `--config vitest.snapshot.config.ts`;`pnpm run test:snapshot -- -t` 的 `--` 让过滤失效——**exit 非 0 但无 summary 且耗时异常短 = 工具没答**。
- **肯定结果的探针同样要证工具答了**(补记 143/144):`cmd | tail; echo $?` 取的是 tail 的退出码(78 一例);`printf "%s" "$(basename x)" "$?"` 里的 `$?` 取到的是前一个 `$(…)` 子命令的状态而非目标命令(lane A 一例,三门全报 0 实际两红);`vitest list --json <path>` exit 0 写 0 字节(`--json` 吃掉路径,须 `vitest list <path> --json`);非空但 JSON 不可解析的 chunk 在"非空即成功"的分支溜走——收集产物须可解析且非空才算过,任一缺失即拒绝报数。
- **`pnpm install --lockfile-only` 装过的新包只在组合回放里红,且报成不相干的错**(补记 153):它写 lockfile 不建 workspace 符号链接;新包能过 typecheck/lint/自套件/`dsh --profile` 直接启动,`plugin-package-inventory-deepseek` 真实解析时才 `cannot resolve active package`,到 SDK 片变成 `cannot create effect on inactive context`。新增包后必须真 `pnpm install`;组合回放红而错误点着 cordis fiber 时先查 `node_modules/@deepseek-ai/<pkg>` 链接。
- **长跑日志两端记 HEAD 与时刻**(补记 216):一次回放/门集跑在 rebase 之上或落进宿主内存崩塌窗口(free 470 → 85 MB)时,结果既不能算红也不能算绿——lane B 一次横跨 rebase 的 lib 六片、一次 39 红全为超时的 source 门都因此作废;开跑与结束各记 `git rev-parse HEAD` 与时间,超时类失败按环境不按内容,内容类失败先解两侧文本再判同源。
- **冻结条目的 `expectCases` 两种拼法工具皆收**(补记 236/238 更正):`frozen-titles-in-tree` 与观测工具 `parseVitestJsonReport` 都同时收裸 `it` 标题与全名(`' > '` 换空格);全仓 225 条 live 里 123 条持裸标题、无日期分界。新条目**建议**取 `vitest list --json` 全名以免同名歧义,但裸标题不是缺陷;delegate 预检脚本若只按全名匹配会误报 0 命中(78 一例)。
- **本文件归 delegate 写**(补记 221):lane 发现的规则经消息提给 delegate,由 delegate 写进这里(与 §12.85 补记同步);lane 自己改 `DELEGATE-ONBOARDING.md` 会造成同一规则两个家(lane A 一例已丢弃)。
- **cordis patch 的 `config:` 是替换不是合并**(补记 226):给某 bundle 行加一个键时必须把该行的必填键(如 `task`)整份重给,否则启动即 `$.task missing required value`。
- **三条流程陷阱**(补记 219):① 用 Python 改仓库 JSON 时 `json.dumps(..., ensure_ascii=False)`——默认会把字面非 ASCII 全改成 `\uXXXX`(772 行一例);② 包级 `tsconfig.json` 多只 include `src`,`tsc -p … --noEmit` 不看 `tests/`——改了 spec 报 tip 前跑宿主编译(`tsc -b tsconfig.host.json`)或给该 spec 建临时 tsconfig;③ `verify-files-overlay.mjs --write` 才有 CLI,`files-overlay.mjs` 是纯库、直接跑静默退出 0。
- **证明脚本自己也要过反向控制**(补记 208):逐文件"0 差异"的检查脚本,报 OK 前先塞一个必须报 BAD 的样本(原始摘要、坏 token)确认它真会红——lane B 一次改写脚本时把关键断言连同崩溃一起删掉,13 个 OK 里藏着未 token 化的摘要;同时记住 fixture 有两条归一化管线(`redactSessionSnapshotIds` 与 legacy `normalize.ts` 身份路径),规则要两边都加。
- **控制与变异都要先证明它改变了被测条件**(补记 165/188/190):篡改后 `tamper applied: false`、改错了 replay 不读的那份配置、预放文件在运行前被 harness 清掉——三例都"绿"了但什么都没测;第四例 `void x ?? y`——`void` 求值为 `undefined` 使 `??` 照样调用右侧,突变是 no-op(补记 195);每条控制/变异附一个"条件确已改变"的读数再报。
- **顺序断言不证明值何时被读**(补记 225):"绑定事件落在 asked 与 decided 之间"对"提问时绑"与"答复后绑"同样成立;要证提问时刻捕获,让答复者在决策进行中改掉元组、断言记录仍是原值——lane B 一版 12 条全绿的用例被"决策后绑定"突变揭穿。
- **一个 no-op 也能满足的性质不是对该函数的测试**(补记 154):`f(out) === out`(幂等)、"不抛"、"返回同类型"这类断言被什么都不做的实现同样满足,会把故障形态编码成预期;冻结用例须至少一条"函数做了事"的断言(输入含目标 → 输出已变),并且回放/归一化若两边同处理,expected 里的坏值会在比较那一刻被刷掉——"绿"须先问"比较时两边各被做了什么"。
- **三组只在全套里活的门,报 tip 前必跑**(补记 157):`scripts/doc-standard.spec.ts`(README 骨架:概述/目录/Dev Note,中英各一份)、`scripts/session-fixture-layout.spec.ts`(session JSONL 须 canonical packed 布局,重刷后跑 `migrate:packed-session-fixtures`)、`packages/typert/generator/tests/cordis-catalog.spec.ts`(service 方法签名引用的每个类型须在 `linkedTypePages` 并有文档页,产物逐字节重生成)。新包/新导出类型/重刷 fixture 三种改动必触其一;本机全套跑不完时它们是全套的代理。候选 3′′ 为此红过一次(4 条,全确定性)。**生成物门同列**(补记 198):`verify-persistence-catalog`(源文件行号一动即 stale,候选 4 十门为此红一次)、`verify-cordis-catalog`、`verify-module-graph`——报 tip 前一并跑,红了就重生成提交,不要留给 delegate 的十门去发现。共同点(lane A,补记 199):这三门因一个自己只"引用"的文件变化而失效(行号 / 类型与事件域 / 包依赖),恰落在"本 lane 没改、别 lane 改了"的缝里;所以清单是六项:三组全套门 + 三生成物门。**第七项(补记 205)**:新包或新挂载后本机跑 `pnpm run hygiene`(15 门,含 `verify-runtime-closure`——挂进出厂 bundle 的包必须进 `python/sdk-runtime` 的 dependencies,BLOCKED-208)与 `scripts/project-doc-site.spec.ts`(新 subsystem 页须在 `docs/subsystems/README.md` 两侧各有一行);候选 4 为这两条红过一次。**第九项**(补记 230):报 tip 前 `node scripts/first100/run-registry-gates.mjs` 全组**逐门落盘**跑(`verify-frozen-titles-resolvable` 本机 OOM 时跳过并明写"云上步 11 补"),其余 25 门几分钟即完——候选 5 因 `verify-usage-stage-subject` 红在云上,而它本机可复现。**第八项**(补记 220):冻结 C 时一并在 `clause-subject-audit.json` 写该 epic 的 makeVsUse 处置(卡片点名的每个 adapt 包 adopted/form 或 deviated/reason,每个标准 owned 或 imported)——`verify-adapt-dispositions` 在首个 GREEN 格记入后即要求它,候选 5 为此在 delegate 十门红过一次;且 `verify-make-vs-use` 对 `standardsOwned.evidenceTitleSubstring` 校验**活冻结用例标题**——只写处置不冻结也红,所以处置与 C 冻结必须同一笔(补记 223)。
- **文档/fixture 布局/产物类修补的缩减验证**(补记 157):在刚跑过全门集的 tip 之上、不动产品源码的修补,可只跑各自 spec + 相关文档门 + 受影响回放片 + 变更文件 lint,由 delegate 逐次裁定并写明条件;动了产品源码则全门集重跑。
- **快照比较侧对持久化 flush 边界不敏感**(补记 165):`normalizeSessionSnapshots` 末尾的 `repackSessionSnapshot`(`normalize.ts:488`)对 expected/actual 两侧重打包 chunk 行;语料侧 `canonicalSessionFixture`(`migrate:packed-session-fixtures`)同基 `packChunkRuns`。别从 `expect(actual).toBe(expected)` 整串相等 + "归一化只清 time0/dt"推出"逐行比"——先读管线到最后一步(224 为此错开一号)。
- **`test:snapshot:refresh -- -t <name>` 的 `-t` 只过滤用例执行,不限制 fixture 改写**(补记 180):refresh 会对它跑到的每个 fixture 写盘(含布局投影),内存紧张的机器上还可能半途被杀留下一批改写;单个 fixture 的机械修正走手工一行 + 回放绿 + 提交信息说明,不跑 refresh;跑了先 `git status snapshots/` 看范围。补记 202 的更细读数:`test:snapshot:refresh -- -t <scenario>` 后面跟的 `migrate-packed-session-fixtures` 会把 refresh 写坏的其他 fixture 布局改回,于是净效果只改一个场景(1/176)——直调 `vitest` 绕过 migrator 就没有这层保护;所以永远走 `test:snapshot:refresh` 脚本,不直调。**切分支之后 lib 就旧了**(补记 211):`git checkout` 重写两分支间不同的 src 文件、mtime 顶到 lib 之后,refresh 的 lib 新鲜度守卫会拒绝——重录前重新 build,守卫拒绝时不要绕。
- **读常量必读使用点**(补记 182):一组路径前缀常量可能是排除名单而非枚举名单(`session-fixture-layout.ts:134` 的 `return []` 才是语义);一个编码函数(`encodeSeqRanges`)存在不等于某条投影用了它——先找调用链再下结论。fixture layout canonical:`sourceEventSeqs` 展开列表、chunk run 打包、覆盖全仓 `*.jsonl` 减两个物理编码前缀。
- **`git rebase --onto <new> <base>` 的 `<base>` 本身被排除**(补记 186):要重放包含某笔的区间,`<base>` 必须是那笔的父(并确认父已在目标里);重放完先跑受影响的回放片——lane A 一次把 214 第二半整笔静默丢掉,是 headless 72 红(Expected 有 approval 对、实际无)抓住的,不是 diff。
- **共享机器上只杀自己的 PID**(补记 142):两 lane 同机,`pkill -f vitest|tsc|node` 按模式杀会把另一 lane 正在跑的门集/普查一起杀掉(lane A 05:27Z 一例);lane 须记下自己启动的 PID 再杀,delegate 见到 FLAG "process kill" 带模式匹配时立即通知另一 lane 核对。

## 9. 每小时自查五问(2026-09-11,gq-92 退班前给;由 watch-v12 心跳每小时打印,不靠记)

① 我派出去的非代码指令(锚 / 文件 / 配置)核过落地了吗——`ls` / `grep` 一次,不信"已建"。② 云上有没有排队或已被取代的 run,取消了没(一次只派最新候选)。③ 本笔是不是一次云跑——docs overlay 先叠到候选再派发,门③ SHA == 推送 SHA,dispatch run 既是门③也是观测。④ 今天有没有我没量就写的断言(补记 4 的"无环"是反例)。⑤ `~/first100-delegate/.events/watchdog.log` 最近一条是什么(机器睡眠 / 电池 / 会话死亡先于"lane 怠工"怀疑)。
