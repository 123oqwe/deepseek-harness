# Agent Note：`dsh plugin add` 校验本地 tarball 旁的来源声明

Status: implemented

[English](2026-09-26-dsh-plugin-add-verifies-a-tarball-provenance-claim.md) | 中文

## 问题

P1-02 的 A 笔（BLOCKED-269）。`@deepseek-ai/dsh-plugin-provenance` 能判定签名声明与包是否一致，但出厂路径上没有任何地方调用它：`dsh plugin add` 装上被篡改的 tarball、仓库或构建者被替换的声明、未受信任的钥匙签的声明，全部以 0 退出（lane A 的 A-436，run 36205584263），plugin lock 也不记任何结论。用户对第 10 题的答复（C22）定了声明的载体：放在本地 tarball 旁边，连同 SBOM；没有声明的包照样安装（G2）。

## 决定

- **约定**（delegate，2026-09-26）：声明文件是 `<tarball>.provenance.json`，内容为 `{ claim, sbom }`，离线签名以 base64 编码；信任锚是目标 profile 的 `package.json` 的 `dsh.trustAnchors`；结论记为锁条目的可选字段 `provenance`，即一条 `ProvenanceAuditRecord`。
- **时机。**pnpm 成功之后、任何迁移导入包代码之前，校验每个 spec 新增或变更的依赖，以及本地 tarball 与锁里记录的摘要不再一致的依赖。观测事实取自已安装包自己的 manifest：`repository.url`、`dsh.provenance.sourceCommit`（没有时取 `gitHead`）与 `dsh.provenance.builderIdentity`；缺少任一项，比对即不通过。
- **两条安装路径都覆盖。**条款的主语是插件，而 `dsh plugin add` 装进来的插件，要么成为 bundle 层，要么成为由用户补丁加载的普通依赖。校验以依赖为单位，不看 `dsh.bundle`，所以两条路都在范围内，lane A 以普通依赖安装的探针仍然有效。
- **被拒即撤销安装。**把 pnpm 开始前的 manifest 与 lockfile 放回，再离线重装；命令以 1 退出，写明包名与理由。原本没有 lockfile 的 profile，撤销之后也没有。
- **锚只有一个来源。**`readProfileTrustAnchors` 为 `dsh plugin` 与 profile 启动读取同一个字段，启动时的信任内核现在持有同样的锚（must[2]）。列表格式有误时，安装与启动都在执行任何操作之前失败。
- **锁只记它被告知的结论。**未变更的包在已安装版本不变时保留原有结论；否则记为 `unverified`。

## 考虑过的替代方案

- **在 pnpm 运行之前校验。**这样无需撤销安装，但要观测的仓库与构建者在归档内部的 `package.json` 里，而这里没有能读 tarball 的依赖。
- **只校验 bundle 层。**会让普通依赖这条路不受检查，而用户补丁同样会把它当作插件加载。
- **把锚放在 `$DSH_HOME/trust-anchors.json`。**delegate 选了 profile 自己的 manifest，让每个 profile 自己说明信任哪些钥匙。

## 后果

- pnpm ≥10 不运行依赖的生命周期脚本，除非 `allowBuilds` 列出了它，而 profile 模板一个也没列，所以被拒的包的安装脚本不会先于结论运行（读码结论，未量测）。
- 不涵盖：`verifyPluginProvenance` 仍不比对 `claim.sbomDigest` 与所附 SBOM（A0）；启动时不再校验已锁定的包（B 笔）；从 registry 安装的包没有声明，记为 `unverified`。
- 添加锚是 profile manifest 唯一需要手工编辑的地方，发布教程写明了这一点。
- 验证：lane A 在真实 `runPlugin` 上的 A-436 用例（挑入为 `d372dd6006`），除对照外在本改动之前的树上都是红的。
