# Agent Note: 插件 manifest 强制执行是一个默认 enforce 的 feature gate

Status: implemented

[English](2026-09-27-plugin-manifest-enforcement-is-a-feature-gate.md) | 中文

## 问题

P1-01 must[3] 要求生产 profile 默认拒绝缺失或旧版的插件声明，但准入与启动后的 quarantine 只在一个默认关闭、需要显式设置 `DSH_PLUGIN_MANIFEST_ENFORCEMENT=enforce` 的开关下运行。P0-05 的 feature gate 机制已接入每一次启动，却没有声明任何 gate，也没有任何代码对 gate 求值（BLOCKED-322）。用户决定 G1 把插件 manifest 强制执行定为第一个声明的 gate，并默认开启；G1b 要求给运维一个显式关闭的写法，每次启动都打告警。

## 决策

- `apps/cli/src/profile-boot.ts` 声明 `plugin-manifest-enforcement`（`PLUGIN_MANIFEST_ENFORCEMENT_GATE`）：owner 为 `@deepseek-ai/dsh-plugin-manifest`，自 0.1.5-rc.2 引入，每个 profile 都是 `enforce`，移除版本 0.2.0。`scripts/release/feature-gate-expiry.ts` 为发布到期检查声明同一个 gate。`DSH_PLUGIN_MANIFEST_ENFORCEMENT` 已删除，由这个 gate 的 `DSH_FEATURE_GATE_PLUGIN_MANIFEST_ENFORCEMENT` 取代。
- `runProfile` 在组合 profile 之前解析一次 gate，并把同一份解析结果提供在 `ctx.get('featureGates')` 上。
- 启动环境这一层可以把 gate 的 `enforce` 底线降下来：设置它的人启动这个进程，本来就能修改 profile 的 `package.json` 与补丁文件。settings 层可以被运行中的进程改变，仍照 P0-05 拒绝。`--dump-config` 用同样的方式解析，所以它显示的就是启动时的行为。
- 启动前的准入与启动后的 quarantine 都经过 `evaluateFeatureGate`。`off` 组合每一层、不处置任何插件；`enforce` 拒绝并 quarantine；`shadow` 照 `off` 行事，并把每项决定与 `enforce` 的比较去除敏感参数后追加到 `$DSH_HOME/feature-gates/shadow-decisions.jsonl`，每项决定一行，带上它所在的启动阶段。此前 `$DSH_HOME` 下没有任何记录启动决定的文件，所以这份日志是新建的。一条记录只保留层名与包名、拒绝原因、不一致的能力名称，以及通配字段的路径。
- `off` 在每次启动时往 stderr 写一行告警；`shadow` 不写。

## 已考虑的替代方案

- **继续拒绝一切对 `enforce` 底线的覆盖。** 这样 G1b 的运维开关与出厂启动上的 shadow 观测（BLOCKED-322 条件 3）都无从存在。
- **自建 profile 默认 `shadow`，出厂模板默认 `enforce`。** 它削弱了 must[3] 在最可能装第三方插件的那些 profile 上的效力。
- **把 shadow 决定写到 stderr，或写进 Trust Kernel 的 `auditAppend`。** 写 stderr 会改变用户在 `shadow` 下看到的内容（P0-05 acceptance[0]）。`auditAppend` 在出厂 CLI 上没有接 sink，写进去的记录会被丢掉。

## 后果

- 强制执行的启动会丢掉缺少 Manifest v2 或声明了通配目的地的组合包层。出厂的 `dsh-base` 与 `dsh-sdk-minimal` 声明了通配目的地；强制执行的启动怎样对待它们，是用户的第 27 题。
- `off` 与 `shadow` 只差那一行 stderr 告警；用户看到的其余内容相同。
- 本 note 部分取代 [在任何真实 gate 存在之前先接线 feature-gate 机制](../architecture/2026-09-01-feature-gate-mechanism-wiring-before-any-real-gate.zh.md)（已声明一个真实 gate，启动环境可以降低 `enforce`）、[Plugin Manifest v2 real enforcement at profile boot](2026-09-02-plugin-manifest-real-enforcement-at-profile-boot.zh.md)（强制执行是一个默认 `enforce` 的 gate），以及 [出厂 bundle 声明 Manifest v2，manifest 按包比对](2026-09-27-shipped-bundles-declare-manifest-v2-compared-per-package.zh.md)（强制执行不再保持关闭）。
