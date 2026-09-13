# P3-02 preFlight — 把 Sandbox Policy 扩成全维度安全词汇

测于 `f24573ddfe`(lane A,2026-09-13)。**只量不改码。** 每条读数附命令或文件位置。

## 重锚中性:是

10 个声明文件,**零个**落在 BASE-ALIGN 冲突集,**零个**触及 `session/` 或 `snapshots/`。
子句不键在会话事件上——七个策略类型是**结构类型**,不是被记录的事件。所以本项可在重锚前后任一时点实现,互不影响。

## 出厂现状:七个类型一个都不存在

```
FileSystemPolicy 0 · NetworkPolicy 0 · ProcessPolicy 0 · IpcPolicy 0
DevicePolicy 0 · SecretPolicy 0 · ResourcePolicy 0 · supportedPolicyFeatures 0
```
(`grep -rl <type> --include='*.ts' packages`,去 `lib/`)

**must[0] 的主语在树上是空集。** 这不是"部分实现待补齐",是**全新词汇**。因此本项的 C 阶段不是"对齐既有类型",而是**从零定义七个类型 + 一个能力申报字段**,preFlight 的主要风险随之落在"定义得对不对"而非"改得动不动"。

## 前置 P3-01 的状态,以及一条要先裁的依赖

P3-01(一等公民 ExecutionWorld Capability Seam)**ACCEPTED,C/P/U/F 全 GREEN**。

**更正(2026-09-13,lane B 指出、lane A 实测确认)**:上面这段引 BLOCKED-178 称 producer 半边「未开始」是**错的——那条 BLOCKED 的措辞已过时,而我引用了它当作现状**。

树上实测:`bundle/base/cordis.patch.yml:260-264` 挂了 `execution-world/plugin` 与 `/local`;`core/tools/src/external-effect.ts:284` 的 `readExecutionWorldFact` 读 `ctx.get('executionWorlds')`、调 `bindingFor(agent)`、首次绑定时 append `action/world-bound`;两条派发路径都调它(`tool-calls.ts:258` 与 `:505`、`ptc.ts:710`)。**而且它在出厂 profile 上真的绑上了**:`action/world-bound` 出现在 **17 份录制会话**中(含 `web/minimal-preset`、`sdk/subagent-spawn-in-process`),而该事件只在 `binding !== undefined` 时才写入——这是真实 boot 的绑定证据,不是源码 grep。

**所以 `ExecutionWorld` 的 provider 今天存在且可用,本项不因它受阻。** 开口项因此更窄:**各 provider 对本项所需维度的支持程度**,而不是「有没有 provider」。

对 P3-02 的意义:must[3] 要求 **provider 申报 `supportedPolicyFeatures`,solver 不许弱语义冒充强语义**。provider 这一侧**今天有实例**(local world provider),所以 must[3] 有可申报的对象。真正要量的是**该 provider 申报得出哪些维度**——见下节 acceptance[0]/[1]。


## 世界接缝存在,但它拒绝的正是本项需要的那一维(lane B 实测,lane A 复核)

`execution-world/src/local-provider.ts:93` 的 `localUnsatisfiableDimensions` 逐维列出 local provider **必须拒绝**的请求,源码原文核过:

| 维度 | 拒绝条件 | 源码理由(原注释) |
|---|---|---|
| `network` | `posture !== 'unrestricted'` | 沙箱管文件效果、不管出网,**`allowlist` 即使为空也拒**——空 allowlist 意为「零出网」,是这里最强的主张 |
| `secrets` | `posture !== 'inherited'` | local world 共享宿主进程环境;`broker-only` 是「世界**收到**什么」的承诺,**只有独立地址空间才守得住** |
| `resources` | `cpuMillicores` / `memoryBytes` / `diskBytes` 任一有值 | — |
| `process` | `!spawn` 或 `maxProcesses !== undefined` | local world 是宿主进程自身的约束,**拦不住 fork,也不计子孙数** |
| `lifetime` | `detached` | 但**墙钟上限可交付——本 provider 会武装它**(第 119 行注释原文) |

而 `plugin.ts:255` 在 `selection.outcome === 'refused'` 时 `return undefined`,于是 `readExecutionWorldFact` 得到 `absent`。**即:请求这些维度时 local world 不会「弱化后绑定」,而是干脆不绑。** 这是好的设计(不冒充),但对本项意味着:

**绑定路径与 world id 可以照用,硬约束本身不能靠 local provider 兑现。** 要么有一个能满足该维度的 provider(独立地址空间/容器),要么把执行点放在 world 接缝**之外**。

acceptance[0](禁网)**正落在 `network` 这一维**:local provider 对任何非 `unrestricted` 的 posture 一律拒绝,连空 allowlist 也拒。所以 acceptance[0] 今天**没有任何 provider 能满足**。

## 三条 acceptance 的可观测性

| 子句 | 主语今天在哪 | preFlight 判断 |
|---|---|---|
| acceptance[0] 禁网时 DNS/IPv4/IPv6/localhost/Unix socket/代理均不可用 | 需要一个真能断网的 world provider | **要真 provider**。用 mock 断网只证明 mock 会拒绝,是 BLOCKED-156 的形状。landlock/沙箱后端是否提供该维度,C 阶段前须实测 |
| acceptance[1] 不可见其他进程时 `/proc`、ps、debug attach 受限 | 同上,且**平台相关** | 须先声明在哪个平台上可观测;macOS 与 Linux 的进程隔离原语不同,`/proc` 在 macOS 不存在 |
| acceptance[2] 策略序列化与审计不丢字段 | 可在纯数据层观测 | **最容易先做**:序列化往返 + 字段全集断言,不依赖任何 provider |

建议实现顺序据此倒过来:acceptance[2] 先(纯数据、无依赖)→ must[0]/[1]/[2] 的类型与闭合性 → must[3] 与 acceptance[0]/[1] 等 provider 与平台决定。

## 未量(不当作已覆盖)

- 各沙箱后端实际支持哪些维度(须逐后端实测,决定 `supportedPolicyFeatures` 的真实取值域);
- acceptance[0]/[1] 在 CI 可用的平台上能否观测;
- 与 P2-05 既有 Cedar 策略词汇的重叠面——两者都叫"policy",是否同一层须先厘清。

---

# 开工前补测(2026-09-13,`4204b92fed`,写在第一行代码之前)

## A. 热区在 P,不在 C —— C 可并行

registry 自己的 stage 划分:**C** = `sandbox/src/{policy,network,process}.ts` + `sandbox/tests/policy.spec.ts`(四个全新)+ `permission-presets/src/types.ts`(既有);**P** = `sandbox-local/src/{index,profiles}.ts` ← 热区;U = `sandbox/src/{index,roots,escalation}.ts`;F = `policy.spec.ts`。

**C 的五个文件全部不在 BASE-ALIGN 冲突集**,`sandbox-local` 整个属于 P。`permission-presets/src/types.ts` 今天只导出 `PresetOption` 与 `PermissionSelect`(UI 投影),上游 A..U 未动它;**除非确需,C 不动它**——声明里有它不等于必须改它(BLOCKED-195 对 P2-04 的同形)。

## B. 七维 ⊂ 九维:复用而非并铸(delegate 裁定,补记 373)

```
P3-01 九维:filesystem network process ipc devices secrets resources lifetime tenant
P3-02 七维:FileSystem Network Process Ipc Device Secret Resource
```
**七 ⊂ 九,一字不差**;P3-01 已为每维定义 `World*Spec`(`execution-world/src/types.ts:61-113`)。照字面实现 must[0],树上会同时有 `WorldNetworkSpec` 与 `NetworkPolicy`。

**裁定采读法 2**:`*Policy` 是**允许/强制层**,`*Spec` 是**请求层**,不同层、非同义。`*Policy` **引用** P3-01 的维度字段类型、**不重铸字段结构**,只加 allow/deny 语义;must[3] 的 solver 正是检「请求的 `World*Spec` 是否满足 `*Policy`」。must[0] 的字面与 no-duplicate 由此同时满足。若实现中发现两者实在无法区分,退回 adjudication(BLOCKED-195 形)。

## C. 与 SandboxPolicy / SandboxMode:同一维的三层,不是三套平行词汇

| 层 | 类型 | 取值 | 覆盖 |
|---|---|---|---|
| 宿主强制 | `SandboxMode` | `read-only \| workspace-write \| danger-full-access` | **仅文件效果** |
| 世界请求 | `WorldFilesystemSpec.effect` | `none \| read-only \| workspace-write \| full-access` | 九维之一 |
| 策略规则 | `FileSystemPolicy`(待建) | — | 七维之一 |

**`SandboxMode` 不是七维的粗粒度版本,而是其中一维的完整处理。** `sandbox/src/index.ts:26-27` 自陈:*"Network and process visibility are **outside this vocabulary**."*

实测佐证:`sandbox/src/index.ts` 中 `ipc`/`device`/`secret`/`resource` **各 0 命中**;`network` 1 处与 `process` 5 处**全是散文或无关字段**(包描述、`RunnerFailureRule` 的退出码注释),无一为维度覆盖。

**结论:不存在三套不相关词汇。** 有的是文件系统一维的三层(`WorldFilesystemSpec.effect` = `SandboxMode` 三值 **+ `none`**),加另外六维的两层——那六维在 sandbox 里没有任何对应物。**C 必须把这条写进 module JSDoc 与一条词汇用例**,否则下一个读者仍会把两者当同义词。

## D. C 的范围

**做**(provider 无关):七个 `*Policy` 类型;must[1] 闭合 allowlist;must[2] 未知 capability 默认 deny;must[3] 的 `supportedPolicyFeatures` **申报契约**与「弱语义不得冒充强语义」;acceptance[2] 序列化/审计不丢字段。

**不做**:**acceptance[0]/[1]** —— 两者都要真能断网、真能隔离进程的 provider,而 local provider 对任何非 `unrestricted` 的 `network` 一律拒(`local-provider.ts:93`),且 acceptance[1] 平台相关(`/proc` 在 macOS 不存在);用 mock 断网只证明 mock 会拒绝(BLOCKED-156 形状)。**srt schema 词汇**亦不做,shape-gated,随独立地址空间决定一起定。
