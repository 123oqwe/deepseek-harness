# Agent Note：基线指纹指出最小的漂移，且不再取决于采集时的工具链

Status: implemented

[English](2026-09-26-the-baseline-fingerprint-names-the-smallest-drift.md) | 中文

## 问题

BLOCKED-305 条件 [0] 与 [1]，P0-01 acceptance[0] 与 [1]。`scripts/release/baseline-fingerprint.mjs` 记录采集基线那台机器的 Node 与 pnpm 版本，verify 又逐字比对它们，所以同一个干净 checkout 在两套工具链下会采出两份基线，并且 verify 不过。lane A 的 A-448 量了三种这样的情形。指纹对 bundle 行只看 id，对包只看名字。改了行的名字、config 或 `disabled`，改了包的版本、dependencies 或 scripts，改了根 `package.json`，改了 `spec/*.schema.json`，verify 都照样通过。加一行或给包改名时，报出来的是整组 id 或整组名字，改名还记在另一个文件名下。A-449 量到 11 条红。

## 决定

- **格式 2。** 格式不同的基线只报格式这一处差异。
- **checkout 声明的工具链。** `toolchain` 记根 `package.json` 的 `engines.node` 与 `packageManager` 钉住的 pnpm 版本，没声明的记 `null`；verify 不比它，因为声明变了就是那个 manifest 变了。执行采集的 Node 与 pnpm 写进审计文档，所以 must[0] 照样记录了它们。
- **按字段记包 manifest。** `packageManifests` 把每个 manifest（根 manifest 也在内）映射到它每个顶层字段规范值的 sha256。漂移会写出 manifest 与字段。
- **按内容记 bundle 行。** `bundleRows` 按文档顺序记下各行，以及每行内容的哈希，行里嵌套的行换成它们的 id。加行或删行只报一次，记为 `defaultBundleRowIds`，只列出变动的 id。某行内容变了记为 `row <id>`；两边都有的行之间顺序变了，记为 `row order`。
- **关键 schema。** `protocolSchemaHashes` 也覆盖 `spec/*.schema.json`。
- **包的成员。** `workspacePackages` 的漂移只列出变动的包名。

## 考虑过的替代方案

- **每个 manifest 只存一个哈希，verify 时经 git 从基线那个提交读出旧内容再逐字段比。** 基线可以保持在 35 KB 左右，不必涨到约 400 KB，但 verify 就得读到基线那个提交，而 CI 的浅克隆或装好的包里未必有它；采集时的树也必须干净。delegate 在 2026-09-26 选了逐字段哈希。
- **把工具链归一到主版本号。** 不同主版本采出的基线仍然不同，而 acceptance[0] 不允许这样；声明的工具链属于 checkout，不属于机器。

## 后果

- 已提交的 `.dsh/baseline.json` 在重采之前仍是格式 1；冻结的 C 段用例拿采集结果的键集与它比，在那之前会红。照 delegate 的裁定，重采取自下一个观测班 CI 的 evidence package，连同审计文档在之后的记录班里提交；本机不跑 capture。
- 对本仓库，基线会涨到约 400 KB。
- `verify-evidence.mjs` 的离线复核只需要采集时检出的 HEAD，不再需要当时的工具链。
- 验证：A-448（`tests/release/baseline-fingerprint-normalized.spec.ts`）、A-449（`tests/release/baseline-fingerprint-classes.spec.ts`），以及冻结的 C 段 `tests/release/baseline-fingerprint.spec.ts`。
