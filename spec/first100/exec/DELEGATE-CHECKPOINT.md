# First-100 · delegate 交班单(每次推送 / 签字 / 撤签更新;新 delegate 会话从这里接管)

**维护**:现任 delegate 在每次推送时于 gate-wt2 叠加更新(EPIC-LIFECYCLE §5.1.10 / §5.2)。**这份文件是状态快照,不是规则**;规则在 EPIC-LIFECYCLE.md,裁决在 plan-rectification-2026-09-06.md 与 BLOCKED-QUEUE.md。

## 接管步骤(新 delegate 会话,第一条消息「继续监督 first100」)

1. 读本文件 + `EPIC-LIFECYCLE.md`(§1.10 / 1.12 / 2.10–2.12 / 4.4a–d / **§5.1 双 lane / §5.2 换班**)+ `plan-rectification-2026-09-06.md` 最近三节 + `BLOCKED-QUEUE.md` 的 `## Open` 与最近 10 条。
2. 向两条 lane 各发一句:「delegate 换班,新会话在此;报当前 SHA、工作树是否干净、下一步等什么」。lane 的地址在下表;若 socket 已失效,lane 会每 30 分钟向新会话重发报到。
3. 核对下表的"在飞 SHA / 门③ / CI"与真实状态(`gh run list -R 123oqwe/deepseek-harness -b first100-exec -L 3`;`git -C <gate-wt2> log -3`)。
4. **核完之前不签任何字、不推任何 SHA。** 之后按 §5.1 继续:分配 → 门③ → 推 → 观测 → 4.4d grep → 签。

## 当前状态(2026-09-11 12:50 EDT,delegate first100-delegate-78,会话 d3a94c8b,接任于 2026-09-10 23:55 EDT(04 终端确认)/ 2026-09-11 00:09 EDT(用户在两 lane 终端各打「委托转移至 first100-delegate-78」))

| 项 | 值 |
| --- | --- |
| delegate 地址 | `first100-delegate-78`,`uds:/tmp/cc-socks/25776.sock`,cwd `/Users/guanjieqiao/first100-delegate`,transcript `~/.claude/projects/-Users-guanjieqiao-first100-delegate/d3a94c8b-056a-44b5-9397-315997b4088a.jsonl`;规划文档/签字 overlay 在本地分支 `delegate-overlay-78`,**工作树 `~/dsh-first100-overlay`**(gate 工作树 `~/dsh-first100-gate` 只作 detached 只读核验,不在其上 checkout 分支) |
| 远端单一事实源 | `fork/first100-exec` = **`93d5220733`**(78 第二推 2026-09-11 22:44Z;= `ec317644b5` + lane A 24 笔 + 82 docs);dispatch run 34652643903 @ `gate/93d5220733` **全绿**,on-push run 34655353335 已取消;上一推 `e74593c50a`(run 34573807027 绿) |
| 最近观测 | **在飞:run 34652643903 @ `gate/93d5220733`(= 候选 1′ `08698d70cd` + 82 docs),22:08Z 派发**;上一次 34646431812 @ `gate/125a4c8ec7` 红(四因,补记 89–94 全闭);上一次 34573807027 绿格:P2-05 C16/P13/U12/F6、P6-01 P31/U21(supersede 后重观测)、P1-10 F15、P4-02 P14;recompute 125/125(artifact 落 `~/first100-delegate/artifacts/`,`FIRST100_ARTIFACT_DIR`) |
| 在飞候选 | **候选 1′ = lane A `08698d70cd`(候选 1 `be06d537e0` 云跑 34646431812 红后 + 8 笔:P2-01 理由重量、memory-context tenant、fixture 投影、207 两笔、P5-11 等待语料、218 守卫、218/219 条目)**(= lane B 最终 tip `ec317644b5` + lane A 20 笔:P2-05 (a)/201、P1-10 记录更正、P2-01.U2 + 语料两条冻结、backfill、adapt-dispositions 门(补记 47)、P1-07.U 五次重冻、键纪律、`delegatedAt` 归零、tokenizer 修、127 守卫窄化、cherry-pick lane B 211 修 `ecfe9751ca`/lint 修 `1deda037ba`/213 豁免 `ce4084db32`/doc-budget `9823bab4e7`、语料刷新(web 12/21 + SDK 34 条恢复));lane A 报:27/27 门 0、全语料重放 0、类型感知 Lint 缩小范围(其改动文件);overlay 叠其上(补记 48–85 + 本文件)→ 推 `gate/<overlay tip>` → `gh workflow run first100-exact-sha.yml` 一次云跑 → 绿即推同 SHA 到 `first100-exec`、取消 on-push 重复 run。候选 2 = lane B 分支(`ec317644b5` + 24 笔:206–213、P4-01/P4-02/P4-11 覆盖、P4-02.U.1、P4-11.P.1、P5-11.U.3、P0-06 限定、模块头更正)rebase 到推送 SHA 后 + 207 测量 + 212 + lane A 刷新守卫 |
| ACCEPTED | **24**(P2-01 BLOCKED-200、P5-10 BLOCKED-215 撤签已推);**P1-10 PASS 已签**(`062ba7bb84`,overlay)→ 推后 lane A `--accept P1-10`(先核 4.3 两门绿);P2-01 WITHDRAWN(BLOCKED-200);P4-01 WITHDRAWN 重签中(coverage 重做 `bcbfaddc47` 在 lane B 分支,U.1/U.2 观测绿后一次 REPLACE);P2-05 / P4-02 待本次观测后签 |
| 5.2.5 回扫 | 78 亲量于 `d69d6e5b3e`:P2-02 / P2-04 / P4-08 / P4-09 四条成立(§12.85 有 file:line);gq-92 三条签核 note 的 (i)"对照真 schema"为未执行断言,已追加更正(补记 51) |
| Lane A | `dsh-first100-clean-93`,`uds:/tmp/cc-socks/12312.sock`,transcript `~/.claude/projects/-Users-guanjieqiao-dsh-first100-clean/`(最新 jsonl),worktree `/Users/guanjieqiao/dsh-first100-clean`(`land-base-align-v2`),**Sonnet**;tip `434350688a`,在做上行"在飞候选"末段;推后队列:`--accept P1-10` → P2-05 签核材料((a)/201 supplement 格观测绿 + 4.4a–d)→ 下一 epic 由 78 派 |
| Lane B | `dsh-first100-lane-b-39`,`uds:/tmp/cc-socks/27505.sock`,transcript `~/.claude/projects/-Users-guanjieqiao-dsh-first100-lane-b/`(最新 jsonl),worktree `/Users/guanjieqiao/dsh-first100-lane-b`(`lane-b`),**Opus**;tip `ecfe9751ca` = `ec317644b5` + 8 笔(P4-01 coverage `bcbfaddc47`、206 `a6aecdb282`、README companion `2da7b508e2`、207 `1b2020a9e7`/`ede83e60ce`/`5fbcd300af`/`3ea5dc60b9`、208 `1029566945`、211 `ecfe9751ca`),**不进本次候选**,静默持机;推后:rebase 到推送 SHA → 207 packed-install 量 → 209 → 210 → detached 门集(含 `pnpm run hygiene` 15/15)→ 报 SHA = 下一候选 |
| BLOCKED 号分配 | 已用到 **219**;**220 未分配**;只由 delegate 分配。今日分配:194–196(昨夜)、197 干净卸载=paused、198 mkdir、199 两持久事实、200 P2-01 撤签、201 真策略事实、202 spill fixture(B)、203 姿态(A,原 202 改号)、204 web e2e 无观测、205 审计括号、206 coverage schema 无执行、207 headless files[] 缺 chunk、208 runtime-closure 18 包、209 七空 install、210 hygiene 不在 workflow、211 task-profile ref 不稳定、212 `./src/*` publishConfig 剥离、213 P4-11 registry 消费者点错(豁免)、214 P1-07 provider 出厂 disabled(待 lane A 量后定)、215 P5-10 acceptance[1] 生产无接线、216 P0-03 removalDate 无到期检查、217 trust-kernel 五处散文描述已关闭残留(已修)、218 verifier import 期 exit 打掉 vitest list、219 pre-step listener 抛异常静默空 turn(吞 prompt) |
| 已决(用户) | OQ4 = (b);BLOCKED-185 = (A);BLOCKED-187 保持姿态;「继续做吧 明天我看结果」= 自主推进,OQ28 默认(host user id 独立文件 + tenant `local`)生效;**2026-09-11 17:03Z(gq-92 终端)**:`./src/*` 按 78 推荐(pnpm `publishConfig.exports` pack 时剥离 = BLOCKED-212);**第三条执行线不开**,不再问 |
| 待用户决定 | 非阻塞两件(默认不动):① 文档预算 5/8 文件余量 ≤6 词,任何增写即触发门——要不要留余量带(补记 74);② `packages/README.md` 清单表随 group 数长,要不要按文件豁免清单表(不改全局规则)。FYI:210 已给 `first100-exact-sha.yml` 加 `pnpm run hygiene` 一步(Build 后,fail-fast,本机 25s–137s),随候选 2 上云 |
| 换班当晚规则 | 前任"只在消息里"的批复一律按未落盘处理,78 重核后落盘于 §12.85;裁决先进 `delegate-overlay-78` 再发消息(§5.2.1) |
| 叠加后验证 | **门③ = GitHub**(5.1.5):任何候选派发前 lane 须在按该 SHA checkout 的 detached 树(完整 `pnpm install --frozen-lockfile`,不 symlink node_modules)跑 `run-registry-gates.mjs` 全套 + `verify-cordis-api` 报各 exit;78 叠 overlay 后在 gate 树 detached 跑 `generate-ledger.mjs --check`;不再本地跑门③/固定集;签字前必跑 `verify-make-vs-use` + `verify-adapt-dispositions`;supersede 已绿格 = 同笔撤绿 |
| 监视工具 | `~/first100-delegate/`:`watch-v13.sh`(15 分钟一行心跳,含两 lane 实况与每小时五问;状态目录 `.v12`)、`exec-watch.py` × 2(v1:USER/FLAG + 每小时 DIGEST——补记 97:v2 的 IDLE/COMMIT/REPORT 太吵已弃)、云跑用 10 分钟轮询的 Monitor 只报红步/结论、hook feed `.events/lanes.log`、OS watchdog、`artifacts/`(rescue 的 vitest 报告)、`dispatch-candidate.sh`(推 overlay tip 到 gate/ 并派发)、`ONBOARDING.md`(+§8 终局与长前置、§9 五问) |
| 产物 | First-100 账本 artifact(110 条可筛表)https://claude.ai/code/artifact/0e7b1173-b99c-4059-a647-d6c9f732d96f |
| 机器 | 与用户 ChatGPT/Codex 共用;今日 OOM 杀 lane A 后台任务 4 次(load 峰 14.6);规则:`uptime`>20 不起套件,重套件两 lane 不同时跑;05:30–10:25 EDT 断网 5h(补记 40) |
