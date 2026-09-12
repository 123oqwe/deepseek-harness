---
description: "Epic P2-12 的控制面判断:哪个控制动词会改变 stop 状态、worker 在 stop 之下能否取新工作,以及一个人类答案该去哪里——包括它**不该**到达的那些 waiting point。"
kind: "package"
---

# @deepseek-ai/dsh-control-plane

[English](README.md) | 中文

`dsh-control-plane` 把 P2-12 的判断做成调用方提供状态的纯函数:一个控制动词对 stop 做了什么、新工作能否开始、一个答案去哪里。这里没有任何东西读存储、广播或落定什么——持久记录与 kernel 广播是 Provider 阶段,lease 闸门与 answerer 接线是 Usage。让这些判断可分离,正是 validation[1]「在工具启动前/中/后注入 stop」能够直接驱动它们的原因。

## 目录

- [这些判断返回什么,以及为什么](#what-the-decisions-return-and-why)
- [检查顺序承重](#check-order-is-load-bearing)
- [一次落定要说出它**没有**落定什么](#a-settlement-names-what-it-did-not-settle)
- [Model Experience](#model-experience)
- [已知限制与延后事项](#known-limitations-and-deferred-work)

-----

<a id="what-the-decisions-return-and-why"></a>
## 这些判断返回什么,以及为什么

`decideControl` 把 `unchanged/already-stopped` 与 `unchanged/not-stopped` 分开,因为审计读的是**转移**而不是结果值:对一个已经停住的 run 再停一次,与停一个正在跑的 run,留下同样的状态,却不是同一件事。`resume` 是唯一会产出 `released` 的动词,这就是把 acceptance[2] 的「必须被显式解除」写成返回类型,而不是写成一条约定。

`mayStartNewWork` 是 must[2] 的一个谓词,而且它取的是控制**状态**,不是调用方缓存下来的标志。must[2] 要关的窗口正是「worker 判断自己可以继续、然后 stop 才到」那一段,所以一道查询早先读到的值的闸门,是一道针对过去的闸门。

<a id="check-order-is-load-bearing"></a>
## 检查顺序承重

`decideAsk` 先查 stop,**后**查目的地。问题本身是一个新动作,所以一个停住的 run 必须被告知 `stopped`,而不是被告知它的 waiting point 未知——后一个答案会把调用方打发去修一个并不是问题所在的注册。在目的地这一侧,「从未存在过」与「已经消失」是两条不同的拒绝:前者是 asker 与 router 对「存在什么」有分歧,后者是提问者已经离开了。

<a id="a-settlement-names-what-it-did-not-settle"></a>
## 一次落定要说出它**没有**落定什么

acceptance[1] 是「答案只到达那个提问的 waiting point」,这是一个关于它**没有**到达哪些点的断言。所以 `decideSettlement` 返回 `stillOpen`,于是一条有两个在途问题的用例可以去检查那个没有被处理的点;只返回成功的判断会让这条属性从它自己的结果里无法观测。

对一个已消失的点的落定是一条**带类型的拒绝**,绝不是 no-op。no-op 在调用点上与成功无法区分,而那正是「一个谁也没收到的答案」读起来像「一个已投递的答案」的方式——也是 BLOCKED-215 在同一条缝的上一版实现里发现的一半。

## Model Experience

无,因为本包只导出纯判断,不注册任何 tool、prompt 文本或 session 事件。

#### KV Cache effect

此处没有任何东西进入模型请求。拒绝只通过它的执行点到达模型,而那里报的是一个封闭的原因码,不是 stop 记录或 principal。

## 已知限制与延后事项

- **这是 Contract 阶段,所以这些判断没有调用者。**本仓里还没有任何地方调用 `decideControl`、`mayStartNewWork`、`decideAsk` 或 `decideSettlement`:lease 路径(`packages/run/lease/src/plugin.ts`)不读任何 stop 状态,而这正是 must[2] 落在哪里的那条测量。读者不能把这里的用例当成「stop 已经到达 worker」的证据。
- **`kill-execution-world` 返回的是拒绝,而不是杀掉什么。**这个动词在 must[0] 里,而「什么是 world」归 P3-01;本包规定这个动词并以未实现拒绝它,好让这个缺口可读而不是静默。
- **`cancel-run` 在这里不改变任何控制状态。**终止在途工作、或把它标记成 reconciliation-required,是 acceptance[1] 的另一半,属于已经存在的 P4-06 settlement outbox;本模块若判断得比「stop 不受影响」更多,就是在重复它。
- **waiting point 登记表是一个参数,不是一个存储。**`WaitingPointRegistry` 是调用方提供的两个只读集合,所以这里没有任何东西能判断它拿到的集合是否与真实存在的相符。那个登记表归 Provider 阶段所有,而 asker 与 router 之间的分歧正是 `unknown-waiting-point` 要报的东西。
- 不发布 runtime invariant companion:本包不持有状态、也不观测任何东西,因此不存在两个观测者可能产生分歧的自有关系。
