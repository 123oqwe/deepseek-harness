# Agent Note: harness 能力基准真跑出厂产品

Status: implemented

[English](2026-09-28-the-harness-benchmark-runs-the-shipped-product.md) | 中文

## 问题

P0-08 的基准在 runner 进程里跑四个伪随机「世界」。没有一条 trial 起过产品，只有任务成功率有计数，其余标准指标只有名字没有数值，而且不管不变量怎样，runner 都以 0 退出。第 18 题 (a) 要求 deterministic、security、fault 三条 lane 在不配模型 API 的情况下真跑出厂产品，每项标准指标都从这些运行算出，或写明原因声明不适用（BLOCKED-325、BLOCKED-335）。

## 决策

- keyless lane 的每条 trial 都在全新的工作目录和 `$DSH_HOME` 里从源码起 `dsh --profile headless`，除基准自己的之外不配模型 API，并取回这次运行持久化的会话日志（`benchmarks/harness-capability/product.ts`）。报告列出每份日志规范化投影的 sha256（用录制会话快照的规范化函数）和原文的 sha256。
- deterministic lane 经回放 provider 回放 `snapshots/session/` 里录制的 headless 会话，补丁层与快照回放用的相同。run seed 从 12 份能原样回放、且至少有一条工具结果的录制里抽 8 条 trial；最后一个回合结束的原因、最后一段助手文本都与录制相同，并且每条工具结果规范化之后都与录制一致，这条 trial 才算成功。
- security lane 每条 trial 对出厂 headless 组合发起一次攻击，只加这次攻击要的补丁，由本地回环上的桩模型恰好请求这次攻击：写工作区之外的文件；在 `read-only` 下用 shell 写文件；请求 headless 无人能批准的提权；会话 token 过期之后由 `run_code` 发出的调用；Run 失败之后同一步里的写入。攻击的目标文件存在，或者它的调用报告成功，这条 trial 就算越过了策略。没有一次攻击依赖仍开着的 BLOCKED 单，所以它的 knownRed 为空，报告照写，并写明核对清单的日期。
- fault lane 回放五份会改动工作区的录制，每条 trial 在 trial seed 选定的一次模型调用上注入一次故障。进程故障让回放停在某次改动世界的调用之后，等产品把已写的内容持久化，再用 SIGKILL 杀掉它；Run 租约过期之后，经出厂 headless runner 的 `resumeSessionId` 恢复会话。恢复后的回放以原来的 call id 重发停顿之前最后一次改动世界的调用，动作账本不得再次施加它。模型故障让回放 provider 在某条录制回答之前以可重试的错误失败。最终工作区与录制的 `workspace.expected` 相同、且最后一个回合正常完成，这条 trial 才算成功；故障还要在会话日志里看得到、且没有调用被施加两次，才算恢复成功。重试策略与 Run 租约是基准自己的设置，由补丁叠在回放之上。
- duplicate_side_effect 从工具结果数出调用被施加不止一次的幂等键：没有真正执行工具就记下的结果（比如账本拒掉的重发）不算施加。
- 算出的指标写成 `{ value, n, source, ci }`：比率与计数用 Wilson 区间，均值用以种子定的 bootstrap 区间。lane 算不出的指标写成 `{ notApplicable }`，理由取自 `manifest.yml`。token_cost 用 `manifest.yml` 里的价格表给录下的用量定价，表里写明价格来源和读取日期。
- 在某张 BLOCKED 未关期间预期失败的场景，列在该 lane 的 `knownRed` 里，不计入它的指标。算出的不变量指标全为 0、且没有一个 knownRed 场景通过时，运行以 0 退出；否则以 1 退出；lane 没有场景或种子不合法时以 2 退出。
- 四个伪随机世界删掉了。把 CI 步骤挪到原生 addon 构建之后，另成一笔。

## 已考虑的替代方案

- **把伪随机世界留在产品 lane 旁边。** 它们量不到产品做的任何事，从它们来的绿会被当成产品的证据。
- **经构建好的 `lib/` 启动器回放。** 全量用例在 `pnpm run build` 之前跑，在那里观测的 lane 找不到构建产物；从源码启动不需要构建。
- **token_cost 只报 token 数。** 这项指标是花费；带来源与日期的价格表说明了测量那天这些 token 值多少钱。
- **security lane 的模型用录制回放来编排。** 回放组合把 sandbox 那一行换成直通的 runner，并默认 `danger-full-access`，在它上面攻击，测的是测试组合，不是出厂组合。
- **按动作清单数重复。** 每次重发都会追加一份清单，账本拒掉的重发也会被算成重复。
- **从停顿的那次调用恢复。** 那样什么都不会重发，这条 lane 分不出把重发的调用施加两次的产品和拒绝它的产品。
- **在持久化事件数到某个值时杀进程。** 杀在哪里会随调度变化；停在一次模型调用里，同一个种子就停在同一处。

## 后果

- 每条 trial 都要起一个产品进程，所以一条 lane 要跑几分钟，而不是几毫秒。
- `tests/benchmark/runner.spec.ts`、`tests/benchmark/lane-runner.spec.ts` 与 `tests/first100/fixtures/P0-08.composition.spec.ts` 里冻结的 P0-08 用例钉的是旧报告，随这次改动取代。
- 价格会变；报告里的 token_cost 写明价格表的读取日期。
- security lane 的模型是桩，它的 token_cost 给桩报告的用量定价；README 把这一点列为已知限制。
- fault lane 的重试策略与 Run 租约比出厂默认值短；README 把这一点列为已知限制，recovery_success 的 source 里写明了这套策略。
- 本 note 部分取代 [harness 基准命令跑完各条 lane 并写出两份报告](../bug-fix/2026-09-24-the-harness-benchmark-command-runs-and-writes-its-reports.zh.md)：不变量被违反的运行现在以 1 退出。
