# dsh 策略语言

[English](language.md) | 中文

一条 dsh 策略就是一条 [Cedar](https://www.cedarpolicy.com/) 策略。本页是"这句话的另一半":一条策略可以指名的词汇、指名了别的东西会怎样,以及一个策略集的版本 pin 是对什么取的。

没有第二门语法。Epic P2-10 的「有限声明式语言」就是被下面这份词汇约束住的 Cedar 语言——dsh 自造一门编译到 Cedar 的语法会是第二个信任根,并且会重验 `@deepseek-ai/dsh-policy-engine-cedar` 已经拥有的授权语义。

## 词汇

每个策略请求携带三个实体与一条 context 记录。一条策略可以指名这些,不能指名别的。

| 位置 | 实体类型 | 它的 id 是什么 |
| --- | --- | --- |
| principal | `Dsh::Principal` | 行动身份的 id |
| action | `Dsh::Action` | ActionManifest 指名的 **capability**,绝不是工具名——两个工具调用同一种能力是同一个授权问题 |
| resource | `Dsh::Resource` | 带 kind 限定的动作目标,因此文本相同的文件路径与进程命令是不同的资源 |

context 记录恰好有十个键:

| 键 | 它携带什么 |
| --- | --- |
| `sideEffectClass` | manifest 声明的副作用类别 |
| `classified` | 该类别是由能力声明的,还是经不可分类默认到达的 |
| `workspaceTrust` | 工作区的信任状态 |
| `permissionPosture` | 会话的权限姿态 |
| `riskClass` | 部署的风险策略把这个动作归入的类别 |
| `world` | 执行世界的**种类**——`absent` 或 `bound`——绝不是世界本身 |
| `tokenPresented` | 是否出示了任何授权 |
| `tokenCapability` | 所出示 token 的 capability 声明;未出示时为 `''` |
| `tokenDelegationDepth` | 所出示 token 的委派深度;未出示时为 `-1` |
| `tokenTenant` | 所出示 token 的租户声明;未出示时为 `''` |

每个键存在,是因为请求确实携带它:这份清单是对 `toCedarRequest` **所发送内容**的声明,不是愿望清单。`@deepseek-ai/dsh-policy-language` 的 Contract 阶段漂移用例拿这份词汇与那个 mapper 真正构造出来的请求相比,并且**两个方向都会红**——声明了却从不发送的键,以及发送了却从未声明的键。**本页的键表本身也在这条机器校验之内**:它是裁定 (b) 下的「schema」权威,改代码不改本页(或反之)都会红。

## 一个策略集因何被拒

策略集在加载时被读取,早于任何强制执行;三种拒绝被分开,因为它们把部署指向不同的地方。

| 拒绝 | 它的意思 |
| --- | --- |
| `empty` | 集合里没有策略。Cedar 在没有 `permit` 匹配时拒绝,所以空集**禁止一切**——那是一种合法姿态,但几乎从不是本意,因此必须被明说,而不是由遗漏达成 |
| `unparsable` | 至少一条策略不是合法 Cedar。拒绝会点名策略 id,因为 Cedar 自己的源码偏移指向它拿到的那段文本,跨集合时毫无用处 |
| `unknown-context-key` | 某条策略读了一个没有任何请求携带的 context 键。集合里**每一个**这样的键都会被报出,而不是第一个 |

**第三种拒绝为什么必须存在**,对 Cedar 4.12.0 实测:这样一条策略解析干净、加载干净,随后在它参与的每次决策上以「无匹配理由」拒绝。它并不静默——审计每次都带着 `record does not have the attribute …`——但它迟到、重复,而且只有去读决策期诊断的人才看得见,那时已经有动作被一条本来就匹配不到的规则拒绝过了。在加载期拒绝,把这件事变成一次失败:发生在任何动作被裁决之前,发生在部署被配置的地方而不是它运行的地方。

词汇检查是 dsh 自己的,而不是 Cedar 的 schema 校验器,原因是所钉引擎的一个性质:cedar-wasm 4.12.0 的 schema 入口只接受单个无名 namespace,因此一份声明 `Dsh::Principal` 的 schema 根本无法表达。手写的只有一件窄事——对 context 属性名的成员检查;所有授权语义仍然是 Cedar 的。

## 版本 pin

编译后的策略集携带一个 pin,重放以它为键。pin 对三个输入取,因为同一份策略文本可以意味着不同的东西:

1. **规范化后的策略文本**——重排版不是一次修订,所以文本在被摘要之前先规范化;
2. **词汇**——一个 context 键变了的集合,是穿着同一批策略的另一个求值器;
3. **引擎版本**——规范形式由引擎产出,所以一次改变了它的发布,否则会让每个 pin 无声漂移。

**升级 `@cedar-policy/cedar-wasm` 会让每个策略集重新 pin。** 这是目的而不是代价:升级由此成为一次有意的、可见的重 pin,而不是「pin 的含义悄悄变了」。
