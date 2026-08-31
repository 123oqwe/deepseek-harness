# Agent Note: First-100 spec-repair checker (R0-3 / M0.C)

Status: implemented

[English](2026-08-25-first100-spec-repair-checker.md) | 中文

## 问题

First-100 恢复程序需要一道 CI 可执行的守护，证明规范注册表及其生成的 spec 投影仍满足 implementation-wave-map.md M0.C 的归属/DAG 契约。没有它，对 `tests/first100/registry.json` 的静默改动——伪造的 layer、占位 owner、未记录的同波写入者、丢失的前驱、或超限的 slice——都会通过评审并污染波次计划。R0-slice-contracts.md R0-3 正要求这一检查器，并钉死了它的位置与 vitest 发现方式。

## 决策

检查器位于 `spec/` 下，由契约命名的模块加一层薄薄的 vitest 适配器组成，两者都读取**已提交**的工件（绝不重新渲染）：

- `spec/first100-spec-repair-tests.ts` — 检查器本体：`checkRegistry`、`checkArtifacts`、`readRegistry`、`readJson`、`deepCopy`、钉死的 L0–L6 分布，以及已记录的同一波冲突集合。它是 R0-slice-contracts.md 中 R0-3 的工件名，并可被 R0-4 的 runner 复用。
- `spec/first100-spec-repair-tests.spec.ts` — vitest spec，由新增的 `spec/**/*.spec.ts` testIncludes 条目发现；它运行该模块（对已提交的 R0-1+R0-2 状态有 2 条绿色断言，另有 9 条负向控制）。
- `vitest.config.ts` — 在 `testIncludes` 中加入 `'spec/**/*.spec.ts'`，使本检查器与 R0-4 未来的 `first100.spec.ts` 在 `pnpm run test` 下运行。
- `.oxlintrc.json` — 在现有 tests override 中加入 `spec/**/*.spec.{ts,tsx}`，与 `scripts/**/*.spec.ts` 对齐，使 spec 文件按仓库的测试适用规则被 lint。

检查器针对已提交状态证明：精确的 100-ID 集合与唯一 id；分组计数等于注册表自身的 `groupCounts`；每个 `primaryLayer` 都是 `layerEnum` 成员**并且**匹配钉死的 L0–L6 分布（L0:1 L1:17 L2:62 L3:5 L4:0 L5:6 L6:9），而非仅枚举成员；每个前驱都存在并落在严格更早的波次（无同波、无反向边、无自依赖）；每个同波多写 N/P 文件都是 4 个已记录的待裁决冲突之一；C/P/U/F 各阶段均存在且形状符合 schema，每 slice 至多 5 个文件（一个阶段就是一个微 PR slice）；1–19 波全部非空；证据 schema 有 13 个键且无重复；每个 epic 都有 `verifyCommand`；spec owner 是真实的 `{epic}.{stage}` 引用且对应 epic 存在；阈值保持记录为 `PROPOSED_PENDING_MAINTAINER`（没有任何自批准）。随后 `checkArtifacts` 交叉核对 owner-map / dependency-graph / command-registry / evidence-schema，确保每个生成工件都恰好投影出 100 个注册表 epic。

负向控制对真实注册表的深拷贝做变更，并断言检查器拒绝每一种失败模式：工件缺失（通过抛错 fail-closed）、伪造的 layer 值、占位 `epic-owner/*` owner、未记录的同波重复 owner、缺失前驱、反向边、空波次、缺失阶段、以及超过 5 个文件的 slice。

基础注册表保持诚实：`canonicalOwner` 为 `UNASSIGNED_UNTIL_APPROVAL` 或自持的 spec epic（提取待裁决状态），而有效的 100-owner 投影在 owner-map 工件上被验证。对检查器原始输出的签名属于 R0-4 的 fail-closed runner 与分离式 attestation；R0-3 只断言结构与一致性。

## 曾考虑的替代方案

**只写一个自包含的 `.spec.ts` 文件。** 拒绝，因为 R0-slice-contracts 将 `spec/first100-spec-repair-tests.ts` 命名为 R0-3 工件，且 R0-4 的 runner 需要同一套归属/DAG 检查。把检查器留在契约命名的模块里、把薄适配器留在可被发现的 spec 中，可同时满足命名工件与 `spec/**/*.spec.ts` 发现契约。

**把 `spec/**/*.{ts,tsx}` 加进共享的严格 oxlint override。** 拒绝：`spec/` 不在任何 tsconfig 程序内，oxlint 的类型感知解析会产生垃圾结果（`JSON` 被标为 `error` 类型、`!` 被标为不必要）。要得到真实的类型感知 lint 需要新建编译器 face，超出本 slice 范围；只有 `.spec.ts` 文件在 tests override 下被 lint。模块的行为由运行它的 spec 钉死。

**为 `spec/` 新建 `tsconfig.json` 编译器 face。** 本 slice 拒绝：这会是 R0-3 工件之外的第三处配置改动，并影响 `tsc --build` 与 tsx 的路径解析，而契约没有要求。

**把有效 overlay 当作基础注册表来校验。** 拒绝：基础注册表刻意保持提取待裁决；overlay 承载已授予的 A/B/C 批准。检查器分别校验基础注册表的诚实性与工件 100-owner 投影，使任何一侧都无法冒充另一侧。

## 后果

`pnpm run test` 现在会发现 `spec/**/*.spec.ts`，因此检查器在 CI 与全仓套件中运行。`spec/` 获得了仅限测试的 lint override；它不是一个 TypeScript 程序，所以 `pnpm run typecheck` 不覆盖它，oxlint 也不对其应用类型感知规则——行为由 spec 本身验证。R0 退出门现在对归属/DAG 契约有了真正的守护；R0-4 将复用该模块做 runner 并在同一 include 下增加自己的 `first100.spec.ts`。已提交工件缺失会让绿色断言失败，保持门 fail-closed。
