# Agent Note：进程内子会话加入拥有它的 agent 的 Run

Status: implemented

[English](2026-09-24-a-child-session-joins-its-owners-run.md) | 中文

## 问题

P4-01 acceptance[2] 说一个 Run 可以跨多个会话；用户在 2026-09-24 决定按字面实现，不收窄。`RunService.attachSession` 早已存在，会落盘，也有测试，但没有任何生产路径调用它：`RunPlugin` 为每个会话开一个 Run，并把这一个会话交给 `openForSession`，所以每个 Run 的 `sessionIds` 都只有一个 id（BLOCKED-309）。这是有意延后的（BLOCKED-196）。租约的工作项是会话而不是 Run（§12.35-2），而 `attachSession` 不出示任何租约。于是，两个会话都写的 Run 可能有两个权威：两个宿主各自合法地持有其中一个会话的租约。

## 决定

- **子会话以成员身份加入。** `RunPlugin` 打开一个会话时，查找注册表记为该会话 owner 的那个活着的 agent（`AgentRegistry.isOwnedBy`）。owner 有 Run 时，`attachSession` 把子会话加进那个 Run 的 `sessionIds`。子会话保留自己的 Run、租约、生命周期、心跳和终态写入，这些一概不变。
- **owner 的租约是 owner 那个 Run 唯一的权威。** 能让一个 agent 的 `runId === R` 的只有两条路：铸出 R，以及重启时领走它。`adoptable` 现在只把会话自己开的 Run（`sessionIds[0]`）交给它，从不交它加入的 Run，所以 R 的每个写入者持有的都是开 R 的那个会话的租约。加入本身只在 owner 的租约仍允许写入（`mayWrite`）时才写，所以失去了 owner 租约的宿主不能再添加成员。
- **两个关闭条件是改写的，而不是用 Run 级工作项满足的。** BLOCKED-196 要的是「the shape of a Run-level work item」，BLOCKED-309 路线 1 要的是「one authority (a Run-level work item)」。两处现在都写作「one authority: the lease of the session that opened the Run; joiners are members」。这是 delegate 在 `approved/P4-01.md`（「裁法甲」）里的裁定。这两个关闭条件都是 delegate 自己的裁定，改写它们不算收窄 registry 条款。

## 考虑过的其他做法

- **子会话共用 owner 的 Run（`child.runId = owner.runId`）。** 未采用：心跳、`awaitingFirstStep` 和失败台账都按 Run 记，要改成按 agent 记；`finish` 要改成不结束共享的 Run；而且子会话会凭自己的租约写 R，这恰恰就是两个权威的情形。
- **按持久谱系（`header.parentSession`）判定成员。** 未采用：网关 fork 与 detached workflow 的会话也带父会话，而这两者按设计都是新的 run。按运行时 owner 判定就把它们排除在外。
- **Run 级工作项，替换或组合会话工作项。** 未采用：替换会推翻 §12.35-2，那是用户的决定；组合需要一个同时持有两份租约的持有者，而这样的持有者不存在。

## 后果

- 被拥有的子会话同时在两个 Run 里：它自己的，以及作为成员的 owner 的 Run。owner 的 Run 日志不为加入、也不为子会话做的任何事增加事件；成员关系从 `sessionIds` 读取。
- 孙会话加入的是它直接 owner 的 Run，不是根会话的，所以多层委派会形成一串 Run。
- detached workflow 会话、网关 fork、所有根会话，以及进程外的 subagent，都不加入任何 Run。
- 加入是在子会话打开时对照 owner 的租约检查的，不是像 `advance` 核对 fence 那样在 Run 的串行化轮次里检查。在这次检查与写入之间失去的租约，仍可能放过一次加入。
- 加入的写入失败时，和其他被跟踪的写入一样经 `run/store-write-failed` 宣告，不会重试。生产上目前还没有任何代码消费这个事件（BLOCKED-295）。
- 两条已冻结的「缺席」用例（`restart.spec.ts` 与 `plugin.spec.ts`）仍然通过，因为它们只建根会话，但它们的标题已经不再描述产品。
