# BASE-ALIGN-v2 new-gap epic matrix (SHA-pinned, Tier-S panel reviewed 2026-09-03)

> Vendored, structured source for registry epics whose provenance is
> `BASE-ALIGN-v2 new-gap` (BLOCKED-037) — never derivable from the 3
> canonical pinned docs (`first100-requirements-matrix.md` /
> `implementation-wave-map.md` / `r0-decision-package.md`), because they
> describe capability gaps upstream itself introduced after those docs were
> written, not gaps in the original 100-epic plan. Same per-epic section
> format as `first100-requirements-matrix.md` (`### P#-## — Title`, then
> `- **Label：**value` fields, `；` clause separator) so the extractor can
> reuse the same parser. One file holds every new-gap epic present or
> future (P3-13 now, any P9-class additions later) — adding one means
> editing this file plus `extract-registry.mjs`'s hardcoded
> `NEWGAP_MATRIX_SHA`, both real reviewed code/content changes, never a
> registry.json edit alone.
>
> **Status of this specific entry**: STRUCTURALLY grounded (every file path
> below independently verified to exist in the merged tree; the described
> risk is the delegate's own independently-verified finding, quoted in
> `upstream-status-COMPLETE.md` §三). `predecessors`/`wave`/`primaryLayer`
> are delegate-confirmed (2026-09-02, rationale inline below), not this
> Supervisor's own inference. MUST/Acceptance clause wording passed Tier-S
> panel review (2026-09-03): 2 required fixes applied (MUST#2's enumeration
> reframed as illustrative negative-test-vectors rather than the boundary
> itself, per-provider scope corrected with `experimental/code-runtime-python`
> explicitly excluded and reasoned), 1 strengthening applied (a new
> `supportedPolicyFeatures` MUST binds P3-13 to P3-02's own solver-honesty
> mechanism, turning MUST#1's "must not be bypassed" from an unenumerable
> negative into a structural fact), 1 Acceptance clause tightened (#3's
> "equivalent" now means the solver's own per-dimension judgment records
> compare identically, not "similar behavior"). SHA-pinned below.
>
> **Companion file**: this doc supplies matrix-format fields only
> (files/must/acceptance/nonGoals/validation/etc., matching
> `first100-requirements-matrix.md`). Per-stage (C/P/U/F) file breakdown,
> gate, and rollback — required by every epic, supplied for the canonical
> 100 by `implementation-wave-map.md` — comes from the sibling
> `new-gap-wavemap.md`, mirroring that doc's own table format
> (delegate decision, 2026-09-02: a second matched-format source, not a
> new notation, so a new-gap epic is assembled through the exact same code
> path as a canonical one).

### P3-13 — Code-Runtime ExecutionWorld Policy Binding

- **Priority / Wave / 依赖：** P1 / W9 / `P3-01`、`P3-02`。（delegate 裁定，2026-09-02：P3-13 的职责是把 code-runtime 通道接进 ExecutionWorld 缝，依赖的是缝（P3-01，W7，L1_CONTRACT）与策略词汇（P3-02，W8，L2_PROVIDER）本身，不依赖任何具体 provider——一旦接进缝，每一个既有 provider 自动获得，P3-08 的容器级后端在 W10 落地时无需回头改。P3-08 故意不列为硬前置：把"能用容器"写成"必须先有容器"是架构错误。W9 = max(P3-01, P3-02) + 1，满足抽取器"前置必须在严格更早 wave"的 DAG 校验。元素(b)"审批覆盖程序体自身副作用"所需的 P2-04/P2-05 已由 P3-01 自身的前置链传递覆盖，不必显式再列。）
- **PrimaryLayer：** L2_PROVIDER
- **问题 → 目标：** 上游 414 commit 把 CPython code-runtime / PTC `run_code` 从骨架建成了完整的任意代码执行引擎（约 180 commit），`ptc` preset 出货为一等模式；其真实出货后端 `packages/code-runtime/code-runtime-worker-thread` 的 README 原话自认 "not a security boundary, model code has bash-equivalent trust"，`src/bootstrap.ts`/`src/worker.ts` 只做 `child_process`/`worker_threads` 级别的资源限额（heap cap、busy-time/wall-clock 预算），无 Network/FileSystem/Process/Secret policy、无出口代理、无 unshare/sandbox；程序体可直接 `import`/`require` 触网触盘。P3-01…12 全程未提及 code-runtime（100-epic registry 对 `code-runtime`/`run_code` 零命中），只覆盖 `packages/sandbox` + shell。P0-05 只能整体开关它（kill switch，非硬化），P2 系列只 gate 其 nested tool 调用，程序体自身的语言级 I/O 不经任何策略门。 → 把 code-runtime seam 纳入 P3-01/P3-02 已建立的同一套 ExecutionWorld 策略词汇：`run_code` 程序体必须在策略约束的 world 内执行（Network/FS/Process/Secret/Resource policy，非仅 rlimit），approval 策略化（非全有全无），worker-thread 变体对 Node 模块/IO 的直接访问锁死。
- **Files：** target `packages/code-runtime/code-runtime/src/index.ts` [B]；`packages/code-runtime/code-runtime/src/types.ts` [B]；`packages/code-runtime/code-runtime-worker-thread/src/index.ts` [B]；`packages/code-runtime/code-runtime-worker-thread/src/bootstrap.ts` [B]；`packages/code-runtime/code-runtime-worker-thread/src/worker.ts` [B]；`packages/code-runtime/code-runtime-worker-thread/src/protocol.ts` [B]；`packages/execution/execution-world/src/index.ts` [B]（P3-01 产物，若该 epic 此时已交付）；`packages/execution/execution-world/src/types.ts` [B]（同上）；`packages/sandbox/sandbox/src/policy.ts` [B]（P3-02 产物，若已交付）；new `packages/code-runtime/code-runtime-worker-thread/src/policy.ts` [N]；`packages/code-runtime/code-runtime-worker-thread/tests/policy.spec.ts` [N]；`docs/subsystems/code-runtime.md` [N]（若不存在）。
- **MUST：** `run_code` 的 world 执行必须经过与 shell/sandbox 相同的 ExecutionWorld policy 求解，不得绕开、不得使用独立的并行策略机制。；code-runtime 的每个 provider 必须向 solver 声明自己的 `supportedPolicyFeatures`，solver 必须拒绝任何声明支持某维度、实际不能强制执行的 provider（同 P3-02 已定机制）——"没有绕开"由此是结构性事实（未声明的 provider 即不可用），不依赖穷举绕道验证。；每个 code-runtime provider 的宿主模块访问一律默认拒绝，仅策略显式 allowlist 的放行（同 P3-02 已定的策略闭合、未知 capability 默认 deny 原则）；`node:fs`/`node:net`/`node:child_process`/`node:worker_threads` 仅作负向测试向量举例，不构成边界；worker-thread provider 是本 epic 必须实证的对象；`packages/experimental/code-runtime-python` 明确排除——其位于 `experimental/` 目录，已被发布家族 glob 排除，不在本 epic 范围内。；approval 决策必须是策略化的（按 world 请求的具体 capability 集合判定），不得是"整体开/关"的二元 kill switch。；worker 进程/子进程被 terminate 后，任何其自行 spawn 的 OS 子进程也必须终止或至少被记录为已知残留（关闭"spawned-process-survives-terminate"缺陷，需先直接复现该缺陷存在再修）。
- **不变量 / 失败语义：** 下列 Acceptance 全为 required；typed deny/拒绝/不兼容/不确定状态按本项文字 fail closed；未满足为 FAIL，未执行为 NOT_RUN，缺依赖/证据为 BLOCKED。
- **明确 non-goal：** 本项不改变 code-runtime 的语言支持范围（仍是 TypeScript/Python 既有两个 provider）；不引入与本项无关的垂直业务逻辑；不扩权、不跨项偷做 P3-08 的容器级隔离范围。
- **Acceptance：** 一个尝试绕过策略直接触网/触盘/起子进程的恶意程序体，在 worker-thread provider 下被 fail closed 拒绝，而非静默放行或仅记录。；worker/子进程被 terminate 后，独立复现验证不存在存活的孤儿 OS 进程（或该残留被显式记录为已知限制，附复现证据，不得未经验证就声称已关闭）。；同一段程序体对 local shell world 与 code-runtime world，solver 的判定记录（网络/文件系统/进程三维）逐项比对相同，而非仅行为相似。
- **Validation：** 构造一个尝试读取策略禁止路径/发起策略禁止网络连接/spawn 未 allowlist 子进程的真实恶意测试程序体，验证三者均被拒绝。；运行 P3-02 的 policy conformance suite，确认 code-runtime provider 与 shell/sandbox provider 通过同一组 negative tests。；对 worker terminate 路径做真实的进程树检查（非假设），确认无残留或残留被如实记录。
- **验证命令：** 来源没有项级可执行命令；实施前必须在 manifest 注册 focused command、fixture 路径与预期 exit code（不得猜），再跑 G/适用 R。
- **真实任务证据：** 场景对应 P3-01/P3-02 已注册的 E3/S13/S14 同类；必须走本项 Validation 所述真实产品路径/可观测外部边界，并保存原始 receipts、before/after、独立验证与 evidence pack。
- **规格缺口 / Task 化：** Epic 声明的文件数量按后续实际拆分核实是否超 5；实施前必须拆成 1–5 文件的 contract/provider/consumer/migration/assurance 子任务。来源为本文件（`BASE-ALIGN-v2 new-gap`），非 v1.0 YAML；provenance 记录见 registry 本条目自身的 `provenance` 字段。缺项级可执行验证命令。
