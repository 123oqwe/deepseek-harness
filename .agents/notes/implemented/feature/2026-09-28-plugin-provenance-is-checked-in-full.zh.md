# Agent Note：插件来源校验补齐

Status: implemented

[English](2026-09-28-plugin-provenance-is-checked-in-full.md) | 中文

## 问题

P1-02 签字要的，有几处是它的 A 笔（B-572）没做的；delegate 在 B-685 之后（2026-09-28）裁定每一处都挡签字。must[1] 写的是「验证 package digest、source commit、builder identity 和依赖 SBOM。」安装路径核了 SBOM 的覆盖，没有核它的完整性：`verifyPluginProvenance` 从不比较 `claim.sbomDigest` 与所附的 SBOM，所以签名之后被换掉的 SBOM，只要它的运行依赖与已装的一致，就能通过（A0）。acceptance[1] 写的是「同一锁定包在离线模式可验证。」，acceptance[2] 写的是「Inventory 和审计事件记录验证结果而不记录密钥。」：没有哪次启动再验已锁定的包，inventory 也把每个包都记成 `unverified`，安装时验为 `trusted` 的也一样（B 笔），也没有哪个校验结果进过 kernel 的审计链。must[4] 写的是「允许 `unsigned-dev` 仅在显式开发 profile，且 UI/日志持续显示不可信状态。」，而 `admitUnsignedDevMode` 在它的包外没有调用方，所以没有哪次启动显示过不可信状态。

## 决定

- **声明点名的 SBOM，才是被核的 SBOM。** 签名通过之后，`verifyPluginProvenance` 先比 `computeSbomDigest(input.sbom)` 与 `claim.sbomDigest`，不等就以 `sbom-digest-mismatch` 拒绝，之后才核覆盖。签名覆盖 `sbomDigest`，声明里的摘要是真的，这一比就把所附的 SBOM 绑到它上面。这个摘要按 UTF-16 码元给条目排序，不按 locale，因为它现在决定结论，不能随校验机器的 `LANG` 变。
- **启动时离线再验安装时的声明，被拒就不启动。** 在任何插件代码运行之前，`runProfile` 把每个从本地 tarball 安装、且 tarball 旁边有声明文件的依赖交给 `verifyLockedPackageOffline`，读声明与已装包的方式与安装路径相同。被拒时，任何模式都不启动，显式开发 profile 也一样，并逐个写明包与原因：声明验不过的包不是未签名的包。每个结论经 `buildPluginPermissionStates` 的 `provenanceRecords` 进入 inventory，`trusted` 带上它的锚。安装时验过的包要守住那次验证，锁里的 `trusted` 从不沿用：之后 tarball 或声明文件不见了，或者 tarball 的摘要与锁里记的不同，都拒启动，并写明缺哪个文件或哪里不符；spec 没变而声明文件不见了的安装也拒。从没验过的包记为 `unverified`，原因是 `no-provenance-claim`。
- **显式开发 profile 每次启动都显示不可信状态。** 启动器发布「这次是不是开发 profile」之后，`warnUnsignedDevPlugins` 立即向 `admitUnsignedDevMode` 请求准入，策略在这个值表示开发 profile 时只放行当前 profile；准入后把它的横幅写到 stderr，逐个写出启动记录为 `unverified` 的插件名。再加上 inventory 里的 `unverified` 记录，就是 must[4] 要的持续显示。其它 profile 什么都不写。
- **每个结论都进 kernel 的审计链。** `appendProvenanceAudit` 每个结论追加一条不含密钥的条目：站得住的依赖记它的记录；由校验或锁里摘要判定的拒绝，记那条 rejected 记录；其它拒绝只记原因的代码，从不记声明文件解析出错时的报错，因为那段话可能引到文件内容。启动追加到它钉住的 kernel，拒绝也记，记完才拒启动；`dsh plugin` 没有宿主，追加到它用来校验的 kernel。

## 已考虑的替代方案

- **在安装路径里比，不在库里比。** 重放同一校验的 `verifyLockedPackageOffline` 以及以后的调用方都会漏掉；must[1] 在库里判定。
- **启动时直接报锁里的结论，不再验。** 锁记的是安装时成立的事，不是启动时磁盘上的样子，而 acceptance[1] 要的是验证。
- **只在 production 拒，或者只记下拒绝。** 载入声明验不过的包的启动不是 fail closed；delegate 两种都没取。
- **像 insecure 的开发启动那样告诉模型。** must[4] 写的是 UI 与日志，所以状态写进日志，不进模型请求。

## 后果

- 夹具声明带占位 `sbomDigest` 的 P1-02 冻结用例（`tests/provenance.spec.ts`、`tests/package-digest.spec.ts`），原来期望 `trusted` 或 `sbom-coverage-mismatch` 的，现在被拒。照 delegate 的裁定，由 lane A 改夹具，冻结走取代。
- profile 有 `plugins.lock.json` 时，每次启动都读它，锁写坏了启动就失败，与 `dsh plugin` 已有的做法一样。有声明要验的启动，即使是 insecure 的开发启动，也会读 profile 的信任锚，所以写坏的 `dsh.trustAnchors` 同样让它失败。
- `profile-boot.ts` 与 `install-provenance.ts` 互相引用；两边都只在函数体内用对方的导出，不会读到未初始化的绑定。
- 不涵盖：摘要取自 tarball 的字节，所以安装之后在 `node_modules` 里被改的文件查不出来；`plugin-manifest-enforcement` 这个 feature gate 为 `off` 的启动不建 inventory 的状态；没有哪个出厂 profile 配了审计 sink，所以在 P6-08 之前审计链留不下这些条目（BLOCKED-191），insecure 的开发启动也没有 kernel 可追加。
- 本 note 部分取代 [`dsh plugin add` 校验本地 tarball 旁的来源声明](2026-09-26-dsh-plugin-add-verifies-a-tarball-provenance-claim.zh.md)：它「不涵盖」里的 A0 与 B 笔已不成立。
