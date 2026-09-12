---
description: "Epic P4-02 的通用编译任务画像:指回用户目标的引用而非它的副本、每条各自带来源与置信度的约束、一套借自 P2-04、无从把未知副作用称作无害的副作用分类,以及作为数据而非猜测被携带的 question。"
kind: "package-library"
---

# @deepseek-ai/dsh-task-profile

[English](README.md) | 中文

## 概述

`dsh-task-profile` 持有 Epic P4-02 的 must[0] 所钉死的那套词汇——目标引用、objective、hard 与 soft 约束、一个副作用分类,以及一次编译产出的、用来代替猜测的 question——连同这套词汇在持久化边界上所需的校验,以及 Run 事件日志用以命名一个画像的内容寻址引用。

`src/types.ts` 承载类型与画像本体所栖身的 `run/task-profile` 会话事件;`src/validate.ts` 承载 schema、形状无法表达的那两条 clause 规则,以及 `taskProfileRef`;`src/index.ts` 承载 `compileTaskProfile`,唯一的运行时导出——一个没有时钟、没有 I/O、也没有 policy 的纯全函数。`tests/profile.spec.ts` 覆盖它们。`spec/task-profile.schema.json` 是同一套要求在 P0-06 的 JSON Schema 2020-12 家族里的写法,供 TypeScript 之外的读者使用。

## 目录

- [本包引入而非声明的东西](#what-this-package-imports-rather-than-declares)
- [刻意缺席的东西](#what-is-deliberately-absent)
- [编译器读什么,又拒绝读什么](#what-the-compiler-reads-and-what-it-refuses-to)
- [一个画像住在哪里](#where-a-profile-lives)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)

<a id="what-this-package-imports-rather-than-declares"></a>
## 本包引入而非声明的东西

本契约的五个决定里有四个是关于**不**去铸造某样东西。

`TaskSideEffect` 携带 P2-04 的 `RiskClass` 与 `RiskGroundKind`。正是这次引入让 acceptance[2]——未知副作用绝不会被标为 `none`——按构造为真:`RiskClass` 有八个成员,没有一个是 `none`,所以一个未知副作用根本没有东西可以被标成;而 `RiskGroundKind` 的 `unknown-default` 已经把「一条规则决定的类」与「什么都没决定的类」区分开了。在本地声明一个带 `none` 成员的副作用枚举,会把该 clause 点名的那个洞原样重新打开。

`TaskGoalRef` 是一个 `SessionId` 加一个 `MessageId`,两者都已归别处所有,指向画像所由编译的那条 `user/message` 事件。must[1] 要求画像保留原始目标的**引用**;一份目标文本的副本会是一个持久事实的第二份记录,而且无从察觉两者何时不一致。

`TaskGoalRef.goalRound` 为延续一个已进入目标的消息携带 goal 域自己的 `GoalId`,这也是本包对 `@deepseek-ai/dsh-goal` 取一个仅类型依赖的原因——`MessageSourceMap` 的 `goal` 成员是在那里声明合并的,程序里没有那个文件,`taskOriginOf` 根本无法为它设一个 case。这份身份放在目标**引用**上而不是每条 `InferenceProvenance` 上,因此它触及每一次推断,同时只存在一次。

`taskProfileRef` 经 P2-03 的 `canonicalizeArguments`(RFC 8785 JCS)规范化。本仓库已经决定了它的规范 JSON 形式是什么,第二套会让同一个画像因为被哪个模块哈希而携带两个不同的引用。

本包确实铸造的唯一一样东西是 `TaskProfileRef`,而且它铸在这里而不是 `@deepseek-ai/dsh-run`——与那个包的五个 `*Ref` brand 相反,那五个当初不得不在本地声明,因为它们的归属方都还不存在。依赖边只有一个方向:`dsh-run` 读这个类型,而本包不读 `dsh-run` 的任何东西。

<a id="what-is-deliberately-absent"></a>
## 刻意缺席的东西

**没有任务种类字段。** validation[0] 要求覆盖四类任务的 fixture——代码、研究、外部动作、个人计划——而那四类是测试输入,不是契约的成员。类型上的一个封闭四成员联合会把一套任务分类学烤进一个其全部主题就是「通用」的画像里,而第五种通用任务形状将无处可去。

**question 是数据,不是一次调用。** must[2] 说歧义或高风险的缺失字段产生一个 question 而不是一个被猜出来的授权。`ctx.userQuestions` 这个 seam 会阻塞等待回答方,而 acceptance[0] 要求同一输入产出同一画像,所以一个在编译步骤内部询问人类的编译器会因为谁坐在键盘前而返回不同的画像。`TaskQuestion` 被携带在画像里,由一个被允许等待的消费方去问。

**这里没有模型。** `compileTaskProfile` 不做任何自然语言推断:一条没人陈述过的约束不会因为目标文本暗示了它就成为约束。模型辅助抽取属于后续 epic 里某个 provider 的背后,因为它落进这个函数的那一刻,acceptance[0] 的「同一输入、同一输出」就不再成立。

<a id="what-the-compiler-reads-and-what-it-refuses-to"></a>
## 编译器读什么,又拒绝读什么

`compileTaskProfile` 是本包唯一的运行时导出,取一个封闭的 `TaskProfileInput`:目标消息的引用、它的文本、它是哪种消息、组合所陈述的预算、工作区信任状态、是否附着了一个行动身份,以及该消息中文本未包含的那些部分的计数。封闭输入正是让 acceptance[0] 可校验的东西——一个能够到达时钟、文件系统或模型的函数,不会有两次「同一输入」。

它是纯的、全的。它从不 await,并且返回一个拒绝而不是抛出:对每一条不是直接人类目标的消息(其中大多数是注入的插件上下文)返回 `not-a-task`,对完全没有文本的目标返回 `empty-goal`。

它**不**接受 `RiskPolicy`。分类是持有 policy 的消费方的事,在这里接受一个 policy 会让画像成为组织而不仅仅是目标的函数。因此它报告的每个副作用都是 P2-04 的 unknown default、置信度 0,并伴随 must[2] 所欠的那个 question——而一个 `untrusted` 的工作区只收窄 rationale,不替它决定类别。

objective 承载不了的内容会被问出来而不是丢掉。一条文本只是其一部分的目标消息——比如图片主导的提示词——从在场的文本编译,而未读 block 的计数成为又一个 question,点名它们的种类与数量。转而拒绝这样的消息,曾意味着唯一一种真实任务形状没有画像,而那正是某条 fixture 为之而写的形状。

<a id="where-a-profile-lives"></a>
## 一个画像住在哪里

一个画像的本体是一条 `run/task-profile` 会话事件;Run 事件日志只携带指向它的 `TaskProfileRef`。这个切分与 P4-01 的 Run 事件引用的其他每一种实体一致——一条事件命名一个审批或一件制品,而它们的本体与其归属方同住——而一个 TaskProfile 的归属方是会话,因为它由该会话日志里的一条消息编译而来,在其之外没有意义。

于是持久化与修订(validation[2])是同一套机制。会话日志是只追加的,因此一次修订后的画像是一条携带修订本体的新事件,以及一条引用它的新 Run 事件日志条目。没有任何东西被就地编辑,因此修订链可以通过按顺序读事件恢复出来,而那些记录也无从对「哪个画像是当前的」产生分歧。

会话事件携带本体、不携带 digest。一个 `TaskProfileRef` 是画像规范形式的 sha256,而画像的 `goalRef` 命名了它所由编译的会话与消息——那是每次 run 都新铸的 id——所以一个被存下的 digest 就是持久日志里的一个随 run 变化的值,同一个录制场景永远回放不出同样的字节。id 本身会规范化;一个在规范化之前对它们取的 digest 不会。`taskProfileRef` 在任何需要 digest 的地方从本体派生它,包括引用它的那条 Run 事件日志条目。

**运行时不变式:** 不发布运行时不变式伴生插件:唯一的运行时导出是 `compileTaskProfile`,一个作用于调用方自行组装的输入之上的纯函数,因此不存在任何归本包所有、可供检查器观察其关系的注册表、日志或 `Context` 值。

<a id="model-experience"></a>
## 模型体验

None, as this package registers no prompt, schema, or tool, and the profile it compiles reaches no model request: `@deepseek-ai/dsh-run` appends the body to the session log and names its digest in the Run, and the reader that would put one into a request is P4-03's.

#### KV Cache 影响

无;这里没有任何东西组装或贡献于一次 provider 请求,因此没有前缀移动、也没有已缓存前缀被失效。一条 `run/task-profile` 事件是仅持久的——它不带 surface 元数据,所以请求赖以构建的派生模型历史里并不包含它。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延期工作

- **只有一个调用方,而且它是唯一的。** `@deepseek-ai/dsh-run` 的 `RunPlugin` 在一个 agent 的第一次 `agent/pre-step` 调用编译器,把画像作为一条 `run/task-profile` 会话事件追加,并在该 Run 的 `accepted → planning` 迁移里命名它的 digest。还没有任何东西把那些事件读回来:把画像放进模型请求是 P4-03 的事,而 `validateTaskProfile` 先于那个读者而存在。
- **一个画像每个 agent 只编译一次,且永不修补。** 编译发生在第一次模型步骤,那时目标、身份与预算都在手上;用户三轮之后加的一条约束到不了任何画像。重新编译才是修订抵达的方式,而今天唯一的重新编译来自被恢复的会话——画像未变时它什么也不写。
- **同一种类的两个未读 block 彼此无从区分。** 计数携带的是种类与数量、不是那些 block,所以 question 说的是「2 个 image block」,说不出哪个是哪个。这是刻意的:携带内容会把目标消息的第二份副本放进画像,而这正是 `TaskGoalRef` 要避免的。
- **`validateTaskProfile` 检查画像,不检查它所指的那个目标。** 一个命名了不存在的会话事件的 `TaskGoalRef` 在这里结构上是合法的;解析它是读者的事,而本包刻意不为此在运行时取任何会话依赖。

### 开发备注

<details>
<summary>面向维护者的工作上下文——点击展开</summary>

本开发备注是面向维护者的工作上下文:开放问题与尚未决定的方向。它明确是非权威的——已交付的行为与限制在上面各节以及包代码里。

开放问题是:一个确定性 parser 可以诚实地抽取什么。今天的答案是「只抽取已经以结构化形式抵达的东西」——`AgentOptions` 里陈述的预算、工作区信任状态、目标消息自己的 id——其余一切都成为 question。这让编译器保持纯净、让 acceptance[0] 可校验,也意味着最初的那些画像大部分是 question。模型辅助推断究竟会不会进入本包,还是留在后续 epic 的某个 provider 背后,尚未决定;若它落到这里,本契约所依赖的纯净性也就一并没了。

第二个开放问题是 `TaskProfileRef` 的 digest 输入。它今天覆盖整个画像,所以一条被后来的编译器改写了措辞的 rationale 会为一个未变的决定产出新的 ref 与新的修订。把 digest 收窄到承载决定的那些字段会让修订更有意义,但也会让两个解释不同的画像无从区分。两者都不是显然正确的。

</details>
