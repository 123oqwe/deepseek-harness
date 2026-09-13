# P3-06 preFlight — Secrets Broker:短期、最小范围、不可回显凭证

测于 `f24573ddfe`(lane A,2026-09-13)。**只量不改码。**

## 重锚中性:是(但有一条限定)

9 个声明文件,**零个**落在 BASE-ALIGN 冲突集,**零个**是 `session/` 或 `snapshots/` 下的文件。

限定:**acceptance[1] 的文字里点名了 session log**(「secret 不出现在 session log、stdout/stderr、crash dump、evidence package」)。所以子句**语义上**触及会话日志,尽管**声明文件里一个会话侧文件都没有**。这两件事不一致,见下一节——那是本项最该在开工前解决的问题,而不是重锚问题:重锚改的是会话日志的**格式**,不改"日志里有没有 secret"这件事。

## 最大的发现:acceptance[1] 在声明文件上没有主语

三步实测:

1. **P3-06 的声明文件里没有任何会话日志写入方**。九个文件是 credentials(3)、`llm/src/api-key.ts`、`settings/src/redact.ts`,加四个新建的 secrets-broker 文件。
2. **耐久会话日志(`session.jsonl`)的写入路径今天完全没有脱敏接缝**:
   ```
   grep -rn "redact\|secret" packages/session/session-persistence-jsonl/src packages/session/session-persistence/src
   → 零命中
   ```
3. **全仓唯一的会话侧脱敏接缝在 `session-telemetry`,而它 (a) 不覆盖耐久日志、(b) 自己就是空的**:
   - `session-telemetry/src/coordinator.ts:181` 的 `captureEvent` 注释写 *"Project, redact, and hand one event to the backend"* —— 它脱敏的是**送往遥测后端的记录**,不是落盘的会话日志;
   - `session-telemetry/src/index.ts:27` 自己写着该 waterfall 是脱敏扩展点,**"It ships NO rules"**。

**结论:acceptance[1] 关于 session log 的那一半,今天既没有可改的接缝,也不在本项的声明文件里。** 这是 BLOCKED-053 族(「只用声明文件能不能真的行使这条子句」)与 BLOCKED-050 族(空能力)叠在一起。

**两条出路,须 delegate 裁,lane A 不替你选**:
- **(a) 补声明路径**:把会话日志写入侧(或一个新的脱敏接缝)纳入 P3-06 的 `files`,经 `adjudication.json` 的 `deliverablePathPatches`;
- **(b) 分半(§12.46-B)**:P3-06 证"broker 侧不泄漏"(它自己的四个新文件 + credentials + api-key + settings/redact 足够),会话日志脱敏开 BLOCKED 归属会话侧 owner,acceptance[1] 按 limb 声明为开口项。

**不该做的**:在 U 阶段让测试自己挂一个脱敏器然后断言"secret 没出现"——那证明的是测试装置,不是产品(BLOCKED-156 形态,本纲领已因此撤签过)。

## 其余子句的现状

| 子句 | 现状 |
|---|---|
| must[0] CredentialRef → 短期 SecretLease,绑 principal/ActionManifest/world/purpose/expiry | 四个绑定对象里 **`world` 即 `ExecutionWorld`,BLOCKED-178 记它至今无生产者**。与 P3-02 的 must[3] 撞同一个空槽,建议两项一起裁 |
| must[1] 经 brokered request/FD/socket 注入,避免全局 env | 今天凭据经 env/.env provider(`packages/credentials/*`),即 must[1] 要取代的正是现状。需先量:现有 provider 的消费点有多少、是否都能改走 broker |
| must[2] 用后自动撤销 | 无既有 lease 概念;随 must[0] 新建 |
| must[3] 日志/错误/artifact/模型上下文统一 taint/redaction | 见上——**四个面里至少"日志"面无接缝**;另三面未量 |
| acceptance[0] 子 Agent/插件只得到明确委托的 secret | 委托链有现成对象(P2-02 的 capability token 有 `delegatedChildResources` 先例),可借鉴 |
| acceptance[2] 过期 lease 无法重放 | 纯数据层可观测,**最容易先做** |

## 未量

- must[1] 现有 env 注入点的数量与可迁移性;
- must[3] 的错误/artifact/模型上下文三面是否已有接缝;
- 与 P2-02 capability token 的委托模型能否共用一套(两者都在做"最小范围委托",重复实现会是账本 adapt/reject 的问题)。
