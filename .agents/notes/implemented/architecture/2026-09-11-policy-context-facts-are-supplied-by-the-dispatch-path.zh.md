# Agent Note：策略上下文事实由派发路径提供

Status: implemented

[English](2026-09-11-policy-context-facts-are-supplied-by-the-dispatch-path.md) | 中文

## 问题

`PolicyRequest.facts` 声明了策略可以读取的上下文事实，而 `enforceManifestedAction` 以 `facts?: Partial<PolicyRequest['facts']>` 接收它们，并就地用 `'untrusted'` 与 `'default'` 补齐缺口。对它两个调用点的普查——`agent-loop/src/tool-calls.ts` 与 `core/tools/src/ptc.ts`——发现**两个都没有传这个参数**。于是任何组合曾经问过的每一个策略问题，携带的都是那两个常量，与该会话的工作区或 preset 实际是什么无关；而 `riskClass` 根本不在请求里。

没有任何东西失败。带默认值的 `Partial` 能从空输入产出一个合法请求，而默认值是取严的，所以这个遗漏表现为一条永不匹配的规则——与一条本就不该适用的规则无从区分。上一层的散文说的却是相反的话：*"The facts are read from what the composition actually mounts."* 对函数为真，对系统为假。

可见的代价落在 `packages/bundle/base/cordis.patch.yml`：Cedar 那一行挂着一整段解释，说明为什么内核硬拒band 无法用策略 forbid——`safety-critical` 不在 Cedar 收到的任何字段的值域里。

## 决定

**由派发路径读取并传入事实，并且让类型把这件事说出来。** `EnforcementInput.facts` 改为必填。兜底逻辑外移到唯一的读取者 `@deepseek-ai/dsh-tools/external-effect` 的 `readPolicyContextFacts`，在那里"服务未挂载"是一个只有一处归属的决定，而不是散落在各个使用点的 `??`。它落在 `dsh-tools`，理由与 external-effect 的预留落在那里相同：这是两条派发路径都能到达的包，因此只有一份实现，而不是两份可以各自漂移的实现。

**把分类前移到 manifest 之前，而不是把 gate 后移。** 在两条路径上 `enforceManifestedAction` 都跑在 `gateActionRisk` 之前，而这个顺序是刻意的、有记载的——对一个部署不会放行的效果去占一个预留，会为一件从未发生的事留下 `sent` 行。所以改为先跑 `classifyActionRisk`，再把它的 `ActionRiskClassification` 作为参数交给 `gateActionRisk`。一个动作被分类两次就是两个可以彼此不一致的答案，而策略决策与风险 gate 对"这个动作**是什么**"意见不一致，是所有漂移组合里最糟的一种。

**base bundle 把它此前只在解释的那条规则写了出来。** `forbid(principal, action, resource) when { context.riskClass == "safety-critical" };`。这是对 `gateActionRisk` 同样会拒绝的那个 band 的第二次拒绝——而先前的注释正是以"这是对一条活规则的第二次声明，二者可以互相不一致"为由拒绝写它。现在它们不可能不一致：两者读的是这次派发算出的同一个分类；而策略层自己也有一票，正是这一票让审计记录把这个 band 记成一次**策略决策**，而不仅仅是一个碰巧先跑的 gate。

## 考虑过的替代方案

**保持 `facts` 可选，只是开始传它。** 接线能work，而类型仍然允许下一条派发路径无声地省略它——而这正是本缺陷能在引入它的那个 epic 里活下来的原因。

**让 `gateActionRisk` 做分类并把结果交给策略。** 那意味着把风险 gate 移到策略决策之前。这个顺序是一个真实约束，不是巧合，为了少一个参数去反转它是错误的取舍。

**在 `enforceManifestedAction` 内部读取事实。** 很诱人，而且不需要改调用点。但那会把 `workspaceTrust` 与 `permissionPresets` 的依赖放进位于两者之下的策略层，并且会让执行点变成异步的。

**把 `PolicyContextFacts` 改成开放记录。** 因类型本身已陈述的理由而拒绝：自由形态的事实包会让"新增一个事实"变成一次无声的策略变更。

## 后果

- `gateActionRisk` 多了一个可选的第五参数。不传的调用方仍然自己分类，因此只到达 gate 的组合行为与此前完全一致。所有存活的 P2-04 冻结用例改前改后**按名**对照：60 条全部仍然通过。
- 无密钥快照套件不变（115 passed、1 skipped）。没有任何出货工具声明会分类到 `safety-critical` 的 tag，因此这条新的 `forbid` 在 fixture 之外是"已声明但未被触发"——与 `gateActionRisk` 的 `hardDenied` 分支一直以来的处境相同。
- **权限姿态仍是一个常量，而且没有任何东西可供它读取。** `PermissionPostureFact` 枚举 `default | plan | accept-edits | bypass`，而全树搜索只在声明本身及其生成回显里找到这四个名字。出货的 preset 表是 `read-only`、`workspace-write`、`danger-full-access`，并且 preset 名字属于部署配置，因此没有任何真实姿态能用那套词汇拼写出来。记录为 BLOCKED-202；`readPolicyContextFacts` 返回字面量并在注释里点名它，另有两条 CHARACTERIZATION 用例从正反两面把它钉住，好让关闭 202 的那次裁定必然把它们变红。
