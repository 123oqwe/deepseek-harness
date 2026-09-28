# Agent Note：插件来源校验补齐

Status: implemented

[English](2026-09-28-plugin-provenance-is-checked-in-full.md) | 中文

## 问题

P1-02 签字要的，有几处是它的 A 笔（B-572）没做的；delegate 在 B-685 之后（2026-09-28）裁定每一处都挡签字。must[1] 写的是「验证 package digest、source commit、builder identity 和依赖 SBOM。」安装路径核了 SBOM 的覆盖，没有核它的完整性：`verifyPluginProvenance` 从不比较 `claim.sbomDigest` 与所附的 SBOM，所以签名之后被换掉的 SBOM，只要它的运行依赖与已装的一致，就能通过（A0）。

## 决定

- **声明点名的 SBOM，才是被核的 SBOM。** 签名通过之后，`verifyPluginProvenance` 先比 `computeSbomDigest(input.sbom)` 与 `claim.sbomDigest`，不等就以 `sbom-digest-mismatch` 拒绝，之后才核覆盖。签名覆盖 `sbomDigest`，声明里的摘要是真的，这一比就把所附的 SBOM 绑到它上面。

## 已考虑的替代方案

- **在安装路径里比，不在库里比。** 重放同一校验的 `verifyLockedPackageOffline` 以及以后的调用方都会漏掉；must[1] 在库里判定。

## 后果

- 夹具声明带占位 `sbomDigest` 的 P1-02 冻结用例（`tests/provenance.spec.ts`、`tests/package-digest.spec.ts`），原来期望 `trusted` 或 `sbom-coverage-mismatch` 的，现在被拒。照 delegate 的裁定，由 lane A 改夹具，冻结走取代。
- 本 note 部分取代 [`dsh plugin add` 校验本地 tarball 旁的来源声明](2026-09-26-dsh-plugin-add-verifies-a-tarball-provenance-claim.zh.md)：它「不涵盖」里的 A0 已不成立。
