# Agent Note：等待之后，工具运行之前再查一次停止与租约

Status: implemented

[English](2026-09-26-a-wait-is-followed-by-a-second-stop-and-lease-check.md) | 中文

## 问题

BLOCKED-334；P4-07 acceptance[0]，以及 P2-12 acceptance[0] 与 must[2]。原生与 code-mode 两条派发路径只在风险门之前问一次 `refuseNewAction`。风险门询问操作员时，等待可能长达数分钟；在此期间发出的紧急停止，或另一主机接管了该 run，只会在生命周期回不到 `running` 时记一条日志，随后被批准的调用照样运行。lane A 的 A-387 量过：两条路径上，接管与停止两种变体都运行了被批准的工具（8 红 2 绿）。另有两处也是先问后做：工具运行时的 pre-execute 询问（今天潜伏），以及工具体内被批准的沙箱升级；lane A 的 A-489 显示，停止之后被批准的工作区外写入照样发生。

## 决定

- **每个工具体之前再查一次。** `ToolRuntime` 在 pre-execute waterfall 与任何询问之后、即将派发之前，再问一次 `refuseNewAction`，被拒绝的调用以 `refusedDispatchResult` 在风险门之前给出的同一结果结算。原生循环、code mode 与公开接缝都经过这一点，因此它覆盖了两条路径上风险门的询问（站点 1 与 2）以及 pre-execute 询问（站点 3）。这次检查是同步的，本身不增加任何等待。
- **沙箱升级获批之后再问一次。** `approveEscalation` 接收一个必填的 `refusalAfterApproval(agent)`，在 `allowed-once` 之后、更宽的沙箱运行之前，抛出它返回的文字（站点 4）。bash、pwsh 与 fs 工具用 `@deepseek-ai/dsh-tools` 的 `refusalToAct` 作答，它用 `refusedDispatchResult` 的措辞报告 `refuseNewAction` 的拒绝。`@deepseek-ai/dsh-sandbox` 仍不导入任何 agent 包，答案由工具层提供。

## 考虑过的替代方案

- **风险门回到 `running` 被拒绝时就拒绝调用。** 这只覆盖两条派发路径，并把拒绝绑在只有持有租约时才存在的生命周期写入上；没有租约时的停止仍会放行。
- **在每个工具体里检查。** 每个工具都得有这项检查，漏了的工具就会运行。
- **可选的升级钩子。** 漏传的工具会在停止之后照样升级；该字段必填，每个调用方都必须作答。

## 后果

- 在操作员作决定期间被停止或被接管的 run，其被批准的调用不会运行，结果会说明是停止还是接管。
- 每次派发在工具体之前多读一次时钟。
- 验证：lane A 的 A-387（原生与 code mode，接管与停止）与 A-489（站点 4，一次 fs 写入）、`packages/core/tools/tests/dispatch-recheck.spec.ts`，以及 `@deepseek-ai/dsh-sandbox` 的升级 spec。次序变异把重查移到工具体之后（站点 1 到 3），并把升级的检查移到人类答复之前（站点 4）。
