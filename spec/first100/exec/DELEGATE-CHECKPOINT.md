# First-100 · delegate 交班单(每次推送 / 签字 / 撤签更新;新 delegate 会话从这里接管)

**维护**:现任 delegate 在每次推送时于 gate-wt2 叠加更新(EPIC-LIFECYCLE §5.1.10 / §5.2)。**这份文件是状态快照,不是规则**;规则在 EPIC-LIFECYCLE.md,裁决在 plan-rectification-2026-09-06.md 与 BLOCKED-QUEUE.md。

## 接管步骤(新 delegate 会话,第一条消息「继续监督 first100」)

1. 读本文件 + `EPIC-LIFECYCLE.md`(§1.10 / 1.12 / 2.10–2.12 / 4.4a–d / **§5.1 双 lane / §5.2 换班**)+ `plan-rectification-2026-09-06.md` 最近三节 + `BLOCKED-QUEUE.md` 的 `## Open` 与最近 10 条。
2. 向两条 lane 各发一句:「delegate 换班,新会话在此;报当前 SHA、工作树是否干净、下一步等什么」。lane 的地址在下表;若 socket 已失效,lane 会每 30 分钟向新会话重发报到。
3. 核对下表的"在飞 SHA / 门③ / CI"与真实状态(`gh run list -R 123oqwe/deepseek-harness -b first100-exec -L 3`;`git -C <gate-wt2> log -3`)。
4. **核完之前不签任何字、不推任何 SHA。** 之后按 §5.1 继续:分配 → 门③ → 推 → 观测 → 4.4d grep → 签。

## 当前状态(2026-09-10 22:52 EDT,delegate guanjieqiao-04,会话 452b8147,接任于 21:14 EDT)

| 项 | 值 |
| --- | --- |
| 远端单一事实源 | `fork/first100-exec` = `0d29b20645 + 本笔 overlay` |
| 最近观测 | CI 34550613755 @ `0db7525001`(docs-only)**红**,§12.6-B 逐条:Lint 步 = P1-10.F type-aware lint(lane A 已修未推)、Recorded-session snapshots = 插件树加载失败于 `@deepseek-ai/schemastery`(BLOCKED-186,lane A `f6cb077d7d` 已修未推),无新红,未准入任何格;`a4f7ad21a1`(lane B,P4-02.C + 188/189 + digest 修复 + task-profile README doc-standard 修)门③ 门集 22/22+2 held @a4f7ad21a1;固定集 6501 过/1 负载超时;0d29b20645 补 session+schema-registry 套件 → 本笔推送,观测 P4-02.C 格 |
| ACCEPTED | 28 → **26**(本笔撤签 P4-01 BLOCKED-183、P1-07 BLOCKED-185,4.4d 由本会话亲量,见 §12.83) |
| 5.2.5 回扫 | 近 24h 签字 P2-02 / P2-04 / P4-08 / P4-09 重做 4.4d 全部成立(§12.83) |
| Lane A | `dsh-first100-clean-93`,`uds:/tmp/cc-socks/12312.sock`,transcript `~/.claude/projects/-Users-guanjieqiao-dsh-first100-clean/3503e65b-c998-420f-8f07-74738632401b.jsonl`,worktree `/Users/guanjieqiao/dsh-first100-clean`(`land-base-align-v2`),**Sonnet**;**BLOCKED-187 修完未推**(`655d13bb80` 挂 Cedar + 默认集 permit/空 forbid;工作区待提交:`profile-boot.ts` 配 `policyDecider = endorseComposedDecision`(提到 `dsh-policy-enforcement` 导出,permit|ask→allow 其余 deny)、policy-enforcement src+spec(四断言,M79 红一条)、`apps/cli/package.json`、187 三节 + 050 addendum + 191、evidence-P2-05):快照 78→0 无 `--record`、两半载荷各红 1 且 build exit 0、trust-kernel+apps/cli 173/173;**已提交 `5c005aaa1d`** = 4 条 import 声明(dsh-brand ×3、capability-token);在做记忆 slice ⑤(provenance/confidence/格式版本、`countRebuiltAt`、消费者侧填 workspace);推后 rebase 分笔报 SHA;队列 记忆 slice → P2-05.F → P6-07.U(P4-11 重观测、P1-10.F 为随推送观测后 delegate 签)|
| Lane B | `dsh-first100-lane-b-39`,`uds:/tmp/cc-socks/27505.sock`,transcript `~/.claude/projects/-Users-guanjieqiao-dsh-first100-lane-b/0b5fd123-e049-4f23-831e-0eed5c61dbd7.jsonl`,worktree `/Users/guanjieqiao/dsh-first100-lane-b`(`lane-b`),**Opus**;P4-02.C 冻结 `4dfed7de71` 本会话重核 10/10 批;`a4f7ad21a1`(= `7ebffdad99` + `5f2378d6e1` 188/189/HELD_BACK 属主 + `368bdbf2ab` 自修 registryDigest + README doc-standard 修)本笔推;`PACKAGE_LIBRARIES` 是否收 task-profile:P 冻结时定(index.ts 今为 type-only 脚手架);新门 `verify-import-integrity` HELD_BACK 落(12 条,retry 那条即 BLOCKED-186);队列 P4-02 P → U → F → P4-01.U2 |
| BLOCKED 号分配 | 已用到 **191**(187/190/191 lane A;188/189 lane B);下一个 **192**;只由 delegate 分配 |
| 已决(gq-92 转述用户,2026-09-10 晚) | **现阶段保持 2 条执行线,不开第 3/4 条**;重议条件须同时满足:① P2-05 或 P4-02 验收后 `check-ready` READY 集变大且存在与 A/B 文件集不相交项;② 机器空闲内存 > 2 GB。届时 delegate 提议、用户点头才开。设计建议(非决定):第 3 条=使能线(Opus,按解锁后继数取项:P3-01/P7-01/P5-05/06/P8-02 类);第 4 条=验证线(Sonnet,只做机械核验:重跑冻结 argv、重放变异、4.4d grep、第二 gate 工作树门③,产 PASS/FAIL 表;裁决签字仍归 delegate 一人);若有第二台机器/云 runner,先挪门③与验证线 |
| 待用户决定 | ① C7 委托字面更名「委托转移至 guanjieqiao-04」(两 lane 会话各一句);② BLOCKED-185 P1-07 出厂默认开 + 首次授信交互;③ BLOCKED-187 出厂默认策略姿态(与 BLOCKED-162 交互)。工程不等 ②③ |
| 换班当晚规则 | 前任"只在消息里"的批复一律按未落盘处理,重核再批(gq-92 亲证:P4-02.C 冻结批复、P1-10.F 九行、记忆 slice 五条、P2-05.U token 输入、P4-01 撤签均无字节);`--accept` 谓词 (iv) 不校验会话名,签字以 `--delegate-session guanjieqiao-04` 记 |
| 叠加后验证 | 账本/签字写入不算 docs-only:门集 + `pnpm exec vitest run tests/first100 scripts/first100 --maxWorkers=2` 绿后才推(gq-92 C2) |
| 门③ / 监视工具 | `~/first100-delegate/`(`gate3-<sha>.sh` 现为单脚本 prep→门集→固定集;固定集含 `packages/run/task-profile`);门③ worktree `~/dsh-first100-gate`(真目录,gitdir 在 `~/deepseek-harness/.git/worktrees/`) |
| 产物 | First-100 账本 artifact(110 条可筛表)https://claude.ai/code/artifact/0e7b1173-b99c-4059-a647-d6c9f732d96f |
| 机器 | 与用户 ChatGPT/Codex 共用;load 9–13;docs-only 推送只跑门集 |
