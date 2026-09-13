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

但 **BLOCKED-178** 记着:`ExecutionWorld` 是"declared value nothing produces"的一员——§12.46-B 分半,**P2-05 落了规则半边,P3-01 拥有 producer 半边且未开始**。BLOCKED-QUEUE 把它与 `ask`(无生产者)、四个 `ProjectContentKind` 成员并列。

对 P3-02 的意义:must[3] 要求 **provider 申报 `supportedPolicyFeatures`,solver 不许弱语义冒充强语义**。若 `ExecutionWorld` 至今无生产者,那么"provider"这一侧**今天没有实例**,must[3] 的 solver 将没有可申报的对象。

**要 delegate 先裁**:P3-02 的 must[3] 是否需要 P3-01 的 producer 半边先落?若需要,本项应等;若不需要(即 must[3] 只定义申报**契约**、由后续 provider 兑现),那要明写为分半,免得 U 阶段又出现"测试自己供 provider"的空证据形态(BLOCKED-156 族)。**lane A 不替你裁,这是排序决定。**

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
