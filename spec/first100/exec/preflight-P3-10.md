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

## 与 P3-02 / P3-06 共用的那个空槽

must[0] 要 per **action/run/tenant** 三个粒度。must[1] 要 **world provider enforce**。

`ExecutionWorld` 的 producer 半边至今未落(**BLOCKED-178**,§12.46-B 分半,P3-01 拥有且未开始)。所以:
- must[1] 的 "world provider enforce" **今天没有可 enforce 的 provider 实例**;
- 与 P3-02 must[3]、P3-06 must[0] 的 `world` 绑定撞的是**同一个空槽**。

**三项共用一个未落地的前置。** 建议 delegate 把 BLOCKED-178 的 producer 半边作为 P3 族 wave-8 的**共同前置**统一排期,而不是让三项各自在 U 阶段发现没有 provider、各自开分半——那会得到三份互不相干的 limb 声明。**这是排期决定,lane A 不裁。**

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
