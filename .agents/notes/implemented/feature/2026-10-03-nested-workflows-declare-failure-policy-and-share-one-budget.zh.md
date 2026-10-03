# Agent Note：嵌套 workflow 的失败策略由父声明，每棵运行树由一个计数限住

Status: implemented

[English](2026-10-03-nested-workflows-declare-failure-policy-and-share-one-budget.md) | 中文

## 问题

BLOCKED-312 条件 [2] 与 [3]，P4-09 acceptance[2] 与 [3]。每次嵌套启动都返回写死的 `fail-parent`，请求里也没有能带策略的字段，所以父没法要求在子失败之后继续。嵌套 run 的预算从父的预算派生，却从不回写，兄弟们各拿同样的额度；`agent()` 起子只对照它自己 worker 的单 run 上限；没有任何代码读 token 用量，所以 `maxNestedTokens` 只是一个配置值。

## 决定

- 父在调用上声明策略：`workflow({ name, digest, onFailure }, args)`，`onFailure` 取 `fail-parent` 或 `continue-parent`。其它取值 worker 在问宿主之前就拒，值穿过线程边界后宿主再核一次；没声明的，引擎在一个函数里解析成 `fail-parent`。
- 根 run 用它的 `maxTotalAgents` 与部署的 `maxNestedTokens` 开一个树计数，它嵌套出的每个 run 都持同一个对象。引擎把嵌套 run 记到树上，并在准入规则之前用树的余量限住父自己的预算，准入规则本身不变。宿主把每个 `agent()` 子记到树上；树用完了就拒，原因是 `agent-budget-exhausted` 或 `token-budget-exhausted`。
- 进程内的子结算之后，宿主把它用掉的 token 从树里扣掉，读的是 token-meter 的 `tokenUsage` 投影：未缓存输入、输出、缓存读、缓存写。没挂 token-meter 的组合计不了量；一棵树里第一个结算的子会记一条日志，说这棵树的 token 上限没有生效。
- `maxNestedTokens: 0` 表示不设 token 上限。provider 把子跑在别的进程里时，宿主读不到它的用量，所以有 token 上限的树会在 provider 起了它之后拒它，并在它的结果到达脚本之前 dispose。

## 考虑过的替代方案

- **把策略写进子的定义。** 策略决定的是父怎么对待这次失败，所以属于父的调用；定义里设的话，就替每个嵌套它的父做了决定。
- **只数嵌套 run，或只数 `agent()` 子。** delegate 裁定两者一起，每棵树一个计数，对照根 run 的 `maxTotalAgents`。
- **把没挂 token-meter 的组合当成远程子，一律拒起子。** 那样引擎每个测试组合都要挂 token-meter；delegate 裁定不扣、只告警，出厂 base 挂了 token-meter。
- **在任何树里都拒远程子。** 原来每棵树都有 token 上限，远程 provider 就完全不能跑 workflow 子；`maxNestedTokens: 0` 给用远程 provider 的部署一条路：关掉 token 上限来跑。
- **在 subagent 接缝上标出远程 provider，让拒绝发生在起子之前。** 那要改每个 provider；起子之后再拒是更小的改动，代价写在 README 里。

## 后果

- 树的 token 在子结算时才扣，所以同时在跑的几个子可以一起超出上限；并发下不超预算是 P4-10 的 acceptance[0]。
- 树的计数只在内存里；恢复的运行从日志记下的预算重新开一棵树。
- 测试替身 provider 返回的子没有本地 agent 的那些引擎 spec，都设了 `maxNestedTokens: 0`。
- `@deepseek-ai/dsh-workflow-worker-thread` 把 `@deepseek-ai/dsh-token-meter` 与 `@deepseek-ai/dsh-session-projection` 列为 peer 依赖。
