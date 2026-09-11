---
description: "policy 分组导览：一个策略问题携带什么、一个封闭答案是什么、声明提问者权限的可衰减令牌、为所提请求评级的风险词汇，以及决定成为强制执行的那唯一一点，供使用者与维护者在分组内导航。"
kind: "package-group"
---

# packages/policy

[English](README.md) | 中文

## 概述

policy 分组回答一个问题——**这个动作可以发生吗？**——并把它拆成四个可独立决定的部分：问题**携带**什么（身份、调用方的权限、动作的 manifest、它将在其中运行的世界）、一个封闭**答案**长什么样以及插件可以如何影响它、权限在被委派时如何**签发与收窄**，以及在这一切之前动作如何被**评级**风险。强制执行被刻意排除在这四者之外，不作为并列的第五项：一个决定只在唯一一点上成为约束——经由被钉住的 Trust Kernel——本分组其余的一切都只是在为它生产输入。

把这个分组维系在一起的规则是**单调收窄**。插件只能收窄一个决定、绝不能放宽；一个衰减后的令牌是其父级的子集、绝不是超集；未知的风险归入更高一级、而非更低。这里每一处 seam 都朝拒绝方向失败，因此一个缺席的、配置错误的或沉默的组件，不可能变成一次授予。

## 目录

- [包](#packages)
- [决定在哪里成为强制执行](#where-a-decision-becomes-enforcement)
- [尚未抵达的部分](#what-is-not-arrived-yet)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

| 包 | 角色 | ctx 键 |
|---|---|---|
| [`policy-engine`](policy-engine/README.zh.md) | 词汇：一个策略问题是什么、一个封闭答案携带什么、会抵达模型的那些封闭 reason code，以及只可收窄的组合规则。它不持有策略、不挂载服务、不引入引擎 | —（类型与 `composeDecision`） |
| [`policy-engine-cedar`](policy-engine-cedar/README.zh.md) | Cedar provider：把 harness 请求翻译成 Cedar 的实体与上下文形态，把答案读回封闭决定，在 LOAD 时校验策略集，并在每个决定上记录其摘要。仅宿主侧——wasm 产物 13 MB 且位于一个 CommonJS 入口之后 | `ctx.policy` |
| [`policy-enforcement`](policy-enforcement/README.zh.md) | 策略执行点：读取决定、施加每一条已注册的插件约束，并请求被钉住的 Trust Kernel 绑定并记录结果 | —（挂载约束；`enforceManifestedAction`） |
| `capability-token` | 可衰减能力令牌的类型面与决策函数：签发、验证、只可收窄的衰减、级联撤销、存在性门，以及适合入日志的脱敏 | —（一个库） |
| `capability-token-file` | 文件版令牌 provider：签发每个会话的根令牌、武装工具调用要求，并在 profile 的 home 下原子地持久化令牌、撤销与脱敏审计记录 | `ctx.capabilityTokens` |
| `risk-taxonomy` | 八类风险词汇（`read` … `safety-critical`）与纯分类器，含每次比较所用的升序次序，以及"未知归入更高一级"的默认 | —（一个库；一个纯函数） |

`capability-token`、`capability-token-file` 与 `risk-taxonomy` 目前只有英文版，这也是上面那三个名字没有做成链接的原因：否则本页就会声称存在并不存在的中文对应页。

本分组横跨三个 epic 而非一个，各 seam 也显出这一点：令牌那一对回答**谁在提问、带着什么权限**，风险分类器回答**所请求之事有多危险**，而引擎/provider/执行点这一组回答**那么它可以发生吗**。它们只在执行点相遇。

-----

<a id="where-a-decision-becomes-enforcement"></a>
## 决定在哪里成为强制执行

本分组中没有任何东西会自行拒绝一个动作。`policy-engine` 陈述答案是什么；`policy-engine-cedar` 计算出一个；`risk-taxonomy` 报告一个类别以及它是否被硬拒；`capability-token` 验证一个令牌。这些每一项都是**报告**。产生约束的那一步，是 `policy-enforcement` 把组合后的结果交给被钉住的 Trust Kernel——它是本 harness 中唯一的非插件例外，也是答案成为义务的唯一地点。

这对阅读本分组其余部分很重要：一个读了 `riskClass` 却忽略 `hardDenied` 的调用方，在这里不会被任何东西拦住；而一个已挂载的 `ctx.policy` 也不是"任何动作已被检查"的证据。检查就是那个执行点，它由某条 dispatch 路径在追加其 `ActionManifest` 之后立即到达。

-----

<a id="what-is-not-arrived-yet"></a>
## 尚未抵达的部分

记在这里，是因为本分组的各 README 所描述的契约只被生产代码部分触及，也因为其中若干缺口是**安全可见的**——假定并非如此的读者会过度信任这个系统。

- **令牌签名是一个固定标记，不是密码学。** 签发与衰减用常量字节签名，验证也接受它们，因此签名没有把任何东西绑定到令牌内容上；`trustRoot` 参数是"谁可以调用"的编译期门，不是运行时检查。这一项等待 Trust Kernel 边界文档中记录的那个 vendored Cordis `Fiber` 修复。
- **被决定的是两条 dispatch 路径，不是五条。** 原生工具路径与 code 模式子分发到达执行点；进程外 SDK 分发与插件自身的 RPC 尚无 manifest 生产方，因此根本没有被决定。
- **策略看不到令牌的 verbs 或 resources。** 跨越边界的是脱敏后的六字段投影，因此策略可以拒绝一个其权限点名了错误 capability 的动作，却无法拒绝一个其权限在某个具体资源上缺少某个具体动词的动作。
- **`ExecutionWorld` 是一个只有一个取值的已声明槽位。** 在拥有世界模型的那个 epic 落地之前它始终缺席，因此还没有任何策略能就"动作将从何处运行"做出决定。
- **没有任何部署把领域标签映射到风险类别。** 每个已发布工具都声明了领域标签，而没有 profile 映射其中任何一个，因此每个真实动作仍按未知默认分类——标签已就位，缺的是映射这一半。dispatch 路径上也还没有任何东西调用 `classify`。
- **上下文事实默认朝关闭方向，且不从已挂载服务读取。** 在某条 dispatch 路径传入真实值之前，工作区信任默认为不受信任、权限姿态默认为 default——这正是方向取关闭而非取方便的原因。
- **没有加载 Cedar schema，也没有实体层级。** 策略只被校验解析错误，而不对照已声明的动作词汇校验，因此一条把动作名拼错的策略能解析通过、只是永不匹配；`in` 关系无法表达。
- **审计记录写向一个需由部署配置的 sink。** 没有接线的组合会做决定、会强制执行，但什么也不记录。

-----

<a id="related-documentation"></a>
## 相关文档

- [Policy 子系统](../../docs/subsystems/policy.zh.md) —— 一个策略问题、一个封闭答案，以及插件可以为其贡献什么的权威契约。
- [Trust Kernel 边界](../../docs/architecture/trust-kernel-boundary.zh.md) —— 为什么强制执行不是插件，以及令牌签名所等待的那个 vendored `Fiber` 残留。
- [权限预设子系统](../../docs/subsystems/permission-presets.zh.md) —— 风险分类被绑定到审批答案的地方。

-----

<a id="dev-note"></a>
## 开发备注

<details>
<summary>面向维护者的工作上下文——点击展开</summary>

本开发备注是面向维护者的工作上下文：开放问题与尚未定下的方向。它明确不具权威性——已发布的行为与边界位于上面各节以及每个包自己的 README 中。

分组层面的开放问题是**三个 epic 份量的 seam 是否应当留在同一个分组里**。权限（令牌那一对）、评级（风险分类）与决定（引擎三件套）只在执行点相遇，除此之外没有共享词汇——`risk-taxonomy` 不从 `policy-engine` 引入任何东西，而两者都不知道令牌的存在。支持合为一组的理由是：一个部署是把**策略**作为整体启用或谢绝的；反对的理由是：分组 README 必须先介绍三套互不相关的词汇，读者才能在其中导航——本页正是如此。

第二个问题是**当发起会话已经结束时，一个 detached run 的权限是什么**。文件版 provider 在会话被销毁时丢弃其令牌，因此一个被重新挂接的 detached run 找不到可供派生的父级。各种读法记录在所属 epic 的 preflight 中，这里不假定任何一种；它是安全可见的，因此需要一个决定，而不是一个按实现顺序自行到来的默认值。

</details>
