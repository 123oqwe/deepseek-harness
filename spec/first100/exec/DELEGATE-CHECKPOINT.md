# First-100 · delegate 交班单(每次推送 / 签字 / 撤签更新;新 delegate 会话从这里接管)

**维护**:现任 delegate 在每次推送时于 gate-wt2 叠加更新(EPIC-LIFECYCLE §5.1.10 / §5.2)。**这份文件是状态快照,不是规则**;规则在 EPIC-LIFECYCLE.md,裁决在 plan-rectification-2026-09-06.md 与 BLOCKED-QUEUE.md。

## 接管步骤(新 delegate 会话,第一条消息「继续监督 first100」)

1. 读本文件 + `EPIC-LIFECYCLE.md`(§1.10 / 1.12 / 2.10–2.12 / 4.4a–d / **§5.1 双 lane / §5.2 换班**)+ `plan-rectification-2026-09-06.md` 最近三节 + `BLOCKED-QUEUE.md` 的 `## Open` 与最近 10 条。
2. 向两条 lane 各发一句:「delegate 换班,新会话在此;报当前 SHA、工作树是否干净、下一步等什么」。lane 的地址在下表;若 socket 已失效,lane 会每 30 分钟向新会话重发报到。
3. 核对下表的"在飞 SHA / 门③ / CI"与真实状态(`gh run list -R 123oqwe/deepseek-harness -b first100-exec -L 3`;`git -C <gate-wt2> log -3`)。
4. **核完之前不签任何字、不推任何 SHA。** 之后按 §5.1 继续:分配 → 门③ → 推 → 观测 → 4.4d grep → 签。

## 当前状态(2026-09-10 21:15 EDT,delegate gq-92,会话 62bc2b9b,55 MB / 10 天 → 本次推送后按 §5.2 换班)

| 项 | 值 |
| --- | --- |
| 远端单一事实源 | `fork/first100-exec` = `b811725fc2` |
| 最近观测 | CI 34540140360 @ `b811725fc2` **红**:Lint 步(P1-10.F 两个测试文件 type-aware lint)+ Recorded-session snapshots(`dsh-retry/usage` 未声明 `@deepseek-ai/schemastery`,出厂 profile 产物面起不来);单测步绿 → P2-05 C/P/U 按 §12.6-B 准入(lane A 绿格中);P4-11.U、P1-10.U/F 不准入,修后重观测 |
| ACCEPTED | 28(P4-09 今日签);**待撤签**:P4-01(BLOCKED-183,Run 状态机零到达,lane B 复核 + 我 grep 复核);**待复核**:P1-07(BLOCKED-185,信任 provider 出厂不挂,消费者 fail open——产品决定归用户) |
| Lane A | `dsh-first100-clean-93`,`uds:/tmp/cc-socks/12312.sock`,transcript `~/.claude/projects/-Users-guanjieqiao-dsh-first100-clean/3503e65b-c998-420f-8f07-74738632401b.jsonl`,worktree `/Users/guanjieqiao/dsh-first100-clean`(`land-base-align-v2`),**Sonnet**(勤、快、会漏生成器与 lint 口径——每次报 SHA 核四项 exit 与 run-oxlint);在修 CI 两处 + BLOCKED-186(把 `verify-package-dependencies` 纳入门集);队列:P4-11 重观测签 → P1-10.F 观测签 → 记忆 slice(§12.79,已裁:workspace 作用域、0700/0600、countRebuiltAt、provenance/confidence、格式版本 bump)→ P2-05.F → P6-07.U |
| Lane B | `dsh-first100-lane-b-39`,`uds:/tmp/cc-socks/27505.sock`,transcript `~/.claude/projects/-Users-guanjieqiao-dsh-first100-lane-b/0b5fd123-e049-4f23-831e-0eed5c61dbd7.jsonl`,worktree `/Users/guanjieqiao/dsh-first100-lane-b`(`lane-b`),**Opus**(慢而准,常在写码前抓到零到达;它问的问题都是真问题,别催、要答);P4-02.C 五笔已 rebase 到 `b811725fc2`,C 冻结待我批;队列:P4-02 P(挂 RunPlugin 首个 `agent/pre-step`,自己做 `accepted → planning` 带 TaskProfileRef,本体进 session 事件)→ U → F → **P4-01.U2**(整改 BLOCKED-183)→ 下一 READY |
| BLOCKED 号分配 | 已用到 **186**;下一个 **187**;号只由 delegate 分配(§5.1.11) |
| 待用户决定 | P1-07 默认打开 + 首次授信交互(BLOCKED-185);(已决)记忆默认开=每工作区一池(§12.79) |
| 门③ / 监视工具 | **稳定路径** `~/first100-delegate/`(README 说明每个脚本怎么用:`exec-watch.py` 监视 lane、`watch-v10.sh` 值守、`gate3.sh` 门③模板、`drift-*.py` 偏离检测)+ 门③ worktree `~/dsh-first100-gate`(detached,只从这里推显式 SHA) |
| 机器 | 与用户的 ChatGPT/Codex 共用,内存常年 <100 MB 空闲;全量固定集易被 OOM 杀——docs-only 推送只跑门集;fixed set 靠 CI 兜底时在推送记录里写明判据 |
