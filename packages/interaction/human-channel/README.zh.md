---
description: "Epic P2-12 的人类交互通道词汇:五个控制动词、只有显式 resume 才能解除的持久 stop 记录、答案唯一可被路由的 waiting point,以及问题的答案无法产出的 approval grant。"
kind: "package"
---

# @deepseek-ai/dsh-human-channel

[English](README.md) | 中文

`dsh-human-channel` 为长任务需要、而本 harness 此前没有词汇的两件事定下说法:停掉一切新动作,以及挂起去问人一个**不是**权限请求的问题。它不含 service、answerer 与存储——通道实现是 P2-12 的 Provider 阶段,把已经存在的 answerer 接上去是它的 Usage 阶段。写控制面时读它,或者在决定「回答一个问题可以授权什么」时读它。

## 目录

- [为什么 stop 是一条记录而不是一个标志](#why-a-stop-is-a-record-and-not-a-flag)
- [答案是输入,永远不是授权](#an-answer-is-input-never-a-grant)
- [waiting point 是唯一的路由键](#the-waiting-point-is-the-only-routing-key)
- [`kill-execution-world` 只被规定,没有实现](#kill-execution-world-is-specified-and-not-implemented)
- [Model Experience](#model-experience)
- [已知限制与延后事项](#known-limitations-and-deferred-work)

-----

<a id="why-a-stop-is-a-record-and-not-a-flag"></a>
## 为什么 stop 是一条记录而不是一个标志

acceptance[2] 说 stop 要跨重启存活、并且必须被**显式**解除。布尔值承载不了这件事:从磁盘恢复出来的布尔与默认值无法区分,而「必须被显式解除」不可能是一个值的属性,除非解除它本身是这个值上的一次转移。于是 `StopRecord` 带上请求者、原因与被允许的解除方式,`ControlState` 就是这条记录的有无,而 `resume` 是唯一会解除的动词——`cancel-run` 结束工作但让 stop 继续成立,因为结束一次 run 并不等于宣布新工作可以开始。

`release` 今天只有一个取值,但它是一个**字段**而不是一条隐含规则,这样以后若出现自动解除(一个截止时间、一次策略重估),那会是这里的一个新取值,而不是另一条恰好清掉这条记录的代码路径。

<a id="an-answer-is-input-never-a-grant"></a>
## 答案是输入,永远不是授权

must[3] 把问题与 approval 分开,而这个分离是靠**缺少什么**来强制的。`HumanAnswer` 只有两个字段——waiting point 与文本——不含任何 approval 路径能消费的东西:没有 decision、没有布尔、没有裁决。权限由 `ApprovalGrant` 承载,它用一个模块私有的 `unique symbol` 打标,所以没有答案能被放宽成它,也没有从 JSON 强转出来的值能住进这个类型。一个共享的 `approved` 字段会把这个分离变成「关于谁来读它」的规则,而那种规则会一直成立,直到有人换个读法。

<a id="the-waiting-point-is-the-only-routing-key"></a>
## waiting point 是唯一的路由键

`WaitingPointId` 不透明,并且在问题与答案两侧都是必填。用任何更粗的键路由答案——提问的子 agent、session、agent——都会去满足那个更粗的键恰好命中的那个问题,而在两个问题同时在途时那就是错的那一个。BLOCKED-215 正是同一条缝以「目的地可选」建起来的记录:投递回调是一个生产调用点省略掉的可选第三参数,唯一会指定目的地的入口在生产里零调用者,于是检查目的地的那道 guard 永远不会触发。这里目的地是问题的必填参数,`AnswerDelivery` 是必填字段,两种缺席都通不过类型检查。

<a id="kill-execution-world-is-specified-and-not-implemented"></a>
## `kill-execution-world` 只被规定,没有实现

must[0] 列了五个动词,本包把五个都命名了,但 world 的引用是一个不透明的 `WorldRef`,而不是 P3-01 的 `WorldHandle`。P3-01 拥有「什么是 execution world」这件事;在这里 import 它会让这套词汇等那一项,在这里重述它又会造出第二份定义。这个动词被以 `verb-unimplemented` 拒绝,调用方读得到——一个静默的 no-op 会把 world 报成已经被杀。

## Model Experience

无,因为本包只导出类型,不注册任何 tool、prompt 文本或 session 事件。

#### KV Cache effect

此处没有任何东西进入模型请求。问题只通过提问那个工具自己的结果到达模型,而拒绝携带的是一个封闭的原因码,不是记录或 principal。

## 已知限制与延后事项

- **这是 Contract 阶段:什么都停不了,也问不出去。**本包里没有 service、没有 kernel 广播、没有持久存储、也没有 answerer,所以这里没有任何用例能证明一个 stop 到达了 worker。must[1] 的广播加持久化是 Provider 阶段,must[2] 的 lease 闸门是 Usage。
- **今天只有一个 surface 能回答问题,本包也不新增。**在 P2-12 自己的两个 hook 上量过:approval 有两个 answerer(ACP 与 Web),question 只有一个(Web)。按本 epic 第二个开放问题的裁决,P2-12 把已经存在的 answerer 接上去,不创建 CLI 或 ACP 的 question answerer,所以 ACP 的 `elicitation_create` 标准对 question 而言仍然只是名义上被采用。没有 answerer 的 surface fail closed,这正是两个现有 service 已经在做的事。
- **`ApprovalGrant` 在这里声明,在任何地方都不被铸造。**标记让它无法伪造;铸造它的是 approval 那条缝,而本包不包含它。在那部分落地之前,这个类型记录的是分离本身,而不是承载一个真实的授权。
- 不发布 runtime invariant companion:本包不持有状态、也不观测任何东西,因此不存在两个观测者可能产生分歧的自有关系。
