# P3-10 preFlight — CPU/Memory/Disk/Time/Process/Network 资源配额

测于 `f24573ddfe`(lane A,2026-09-13)。**只量不改码。**

## 重锚中性:是

8 个声明文件,**零个**落在 BASE-ALIGN 冲突集,**零个**触及 `session/` 或 `snapshots/`。子句不键在会话事件上——预算是计量原语,不是被记录的事件类型。

## 出厂现状:核心词汇不存在,邻近机制存在但不是它

```
BudgetSpec 0 文件 · networkBytes 0 文件
wallTime 8 文件 · toolCalls 6 文件 · quota 16 文件
```
后三个的命中**基本不是本项的东西**:`quota` 的 16 个文件里 7 个在 `llm/llm-deepseek`、2 个在 `llm-mock-server`、2 个在 `llm/llm`、2 个在 `client/store` —— 那是**模型 API 的配额/限流**,与 ExecutionWorld 的资源硬限额是两件事。**别把它们读成"已有部分实现"**;这正是"名字像"骗过"定义说"的形状,本纲领已因此栽过数次(`.resume(` 22 个同名命中)。

`wallTime` / `toolCalls` 需逐个核实是否与 `guard/timeout-policy`(本项声明的 [B] 文件之一)同源;**未逐个核,故不下结论**。

## must[3] 与 must[4] 把边界划得很清,值得照做

- **must[3]**:本项**只定义 ExecutionWorld 的资源计量/硬限额原语**;
- **must[4]**:P4-10 的调度公平性在其**上层**消费。

这是一条难得写明的分层。preFlight 建议:C 阶段就把这条边界固化成类型边界(预算原语不认识"公平性"),否则 P4-10 开工时极易把公平性逻辑倒灌回来,变成 P3-10 的 scope 无限膨胀——与 P2-10 的 settings 原子写(D6)同形。

## 与 P3-02 / P3-06 共用的那个 provider

must[0] 要 per **action/run/tenant** 三个粒度。must[1] 要 **world provider enforce**。

**更正(2026-09-13,lane B 指出、lane A 实测确认)**:上面这段引 BLOCKED-178 称 producer 半边「未开始」是**错的——那条 BLOCKED 的措辞已过时,而我引用了它当作现状**。

树上实测:`bundle/base/cordis.patch.yml:260-264` 挂了 `execution-world/plugin` 与 `/local`;`core/tools/src/external-effect.ts:284` 的 `readExecutionWorldFact` 读 `ctx.get('executionWorlds')`、调 `bindingFor(agent)`、首次绑定时 append `action/world-bound`;两条派发路径都调它(`tool-calls.ts:258` 与 `:505`、`ptc.ts:710`)。**而且它在出厂 profile 上真的绑上了**:`action/world-bound` 出现在 **17 份录制会话**中(含 `web/minimal-preset`、`sdk/subagent-spawn-in-process`),而该事件只在 `binding !== undefined` 时才写入——这是真实 boot 的绑定证据,不是源码 grep。

**所以 `ExecutionWorld` 的 provider 今天存在且可用,本项不因它受阻。** 开口项因此更窄:**各 provider 对本项所需维度的支持程度**,而不是「有没有 provider」。

所以 must[1] 的 "world provider enforce" **有可 enforce 的 provider 实例**。要量的不再是"有没有",而是 **local provider 今天能 enforce 哪些维度**(见下节 acceptance[0]),以及 `BLOCKED-178` 那条**措辞需要更新**——它现在会误导任何引用它的人,我就被它误导过。


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

must[0] 的八个预算维度里,**只有墙钟(`maxWallClockMs`)是 local provider 今天能武装的**(第 119 行注释原文);`cpuMillicores`/`memoryBytes`/`diskBytes` 与 `process.maxProcesses` **一律被拒**。所以 must[1]「world provider enforce」今天只对时间那一维成立,其余七维需要新 provider 或 world 之外的执行点。

## acceptance 的可观测性

| 子句 | preFlight 判断 |
|---|---|
| acceptance[0] fork bomb / disk fill / memory balloon / network flood 均被限制 | **需真沙箱后端**,且四种攻击的可观测性与平台强相关。`sandbox-local` 是声明的 [B] 文件,须先实测它今天能限住哪几种 |
| acceptance[1] 累计预算不能被子 Agent 拆分绕过 | **可在数据层先做**:预算聚合按 run/tenant 而非按 agent 实例,拆分绕过是聚合键选错的后果。此条不必等 provider |
| acceptance[2] 计量误差在声明范围内且可审计 | 要求**先声明误差范围**再测。注意:一个没有声明上界的"误差可接受"断言是不可证伪的,C 阶段须把范围写成数字 |

## 未量

- `wallTime` / `toolCalls` 的 8 / 6 个命中与 `guard/timeout-policy` 的关系(是否已有可复用的计量)。
- `sandbox-local` 今天实际能限住哪些维度;
- 造/用账本对资源计量是否已有 adapt 判定(开工前必查,否则可能手写一个账本判 adapt 的东西)。
