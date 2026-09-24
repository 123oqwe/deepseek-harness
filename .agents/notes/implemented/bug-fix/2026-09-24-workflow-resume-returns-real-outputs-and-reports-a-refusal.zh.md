# Agent Note：workflow 工具续跑被中断的运行，并返回子 agent 的真实输出

Status: implemented

[English](2026-09-24-workflow-resume-returns-real-outputs-and-reports-a-refusal.md) | 中文

## 问题

P4-08 acceptance[0] 要求：在 `agent()` 边界被杀掉的工作流，由重启后的宿主续跑，且不重复已完成的子 agent 工作；acceptance[1] 要求脚本改动后的续跑被明确拒绝。出厂 acp profile 上有四处缺口。其一，`workflow` 工具没有任何参数能调到 `engine.resume`；它的参数根接受未知键，所以带 `resume` 的调用会以新 id 另起一次运行。其二，journal 把每个已完成步骤的输出都记成占位串 `agent-result-<seq>`，续跑时交给脚本的是这个字符串，而不是子 agent 的值。其三，因 `script-digest-changed` 被拒的续跑会从第一步运行脚本，调用方得不到任何提示。其四，worker 一报告步骤完成，宿主就把它记入 journal，而此时子 agent 的 `turn/end` 可能还在会话后端的写入批次里：在这之间被杀，journal 写着一个已完成的步骤，子 agent 的日志却看不出来，续跑于是再次启动这个子 agent。

记录了真实输出之后，又暴露出三处缺口。worker 只按步骤编号复用记录的步骤，而步骤编号跟随 `agent()` 调用启动的先后：换了 `args` 的续跑，或者后面的调用随前面的调用完成而启动的脚本，会把一次调用记录的输出交给另一次调用，宿主还把该步骤标为已核验。因脚本改动被拒的续跑以同一个 id 重新开始运行，重新开始的运行第一次写 journal 就替换了被拒的 journal，被中断运行的记录随之丢失。此外，journal 现在保存着子 agent 的输出，写盘时用的却是进程 umask 给出的权限，而会话日志只对属主可读写。

## 决定

- **`workflow` 接受 `resume: "<runId>"`**，把本次调用的 `script`、`meta`、`args` 与父 agent 以该 id 交给 `engine.resume`。取值必须匹配 `^[\w-]+$`；`resume` 与 `detached: true` 同时给出时拒绝。
- **worker 把每个已完成的 `agent()` 值以 JSON 文本上报**，随 agent-end 消息发出：结构化值，或输出文本。宿主只把它交给 journal，从不交给 `workflow/agent-end` 监听器；journal 内联记录它，续跑的步骤返回解析后的值。
- **被拒的续跑报告在运行上，而不是抛出。** `Reconciled.refused` 带出 `admitResume` 的 `reason` 与 `detail`，`WorkflowRun.resumeRefused` 公开它们，工具封闭的输出 schema 新增可选字段 `resumeRefused`，模型读到的文本以 `resume refused (<reason>): the run started over from its first step.` 开头。
- **宿主在把已结束的进程内子 agent 的结果转发给 worker 之前，先刷写它的会话**，所用的 `ctx.sessions.flush` 调用与 `subagent/continuation-activation.ts` 相同。刷写失败记一条 warn，结果照常转发。
- **记录的步骤只复用给记录它的那次调用。** worker 为每个 `agent()` 调用计算身份 `callDigestOf`：对它的 prompt、`schema`、`provider` 与 `model` 取 SHA-256。journal 把它记为条目的 `call`，宿主把每个可复用步骤的身份交给 worker，身份不同时 worker 重新启动该步骤。
- **因脚本改动被拒的续跑先把 journal 移走**，移到 journal 目录下的 `refused/<runId>.<脚本摘要前 12 位十六进制>.json`（`setJournalAside`），重新开始的运行在它旁边另写一份新的 `<runId>.json`。
- **journal 目录以 0700 权限创建，每个 journal 文件以 0600 权限写入**，与会话日志一致。

## 考虑过的其他做法

- **在宿主侧推导输出（核验 V5）。** 未采用：宿主要复制一份 worker「`agent()` 返回什么」的规则，而已冻结的 `runtime.ts` 还得导出 `outputText` 并补上导出 JSDoc。输出由 worker 上报，与诊断的 B2 一致。
- **按诊断的写法（`&& event.output !== undefined`），把没有带输出上报的已完成调用记为没有输出。** 未采用：已冻结的 `journal-host.spec.ts` 有三条用例上报已完成调用时不带输出，并断言续跑时跳过该步骤。observer 对这类调用保留占位串。
- **在 `resume.ts` 判定可复用时拒绝占位串（A7）。** 未采用：已冻结的 `journal-resume.spec.ts` 以 `'agent-result-1'` 作为输出 fixture，并断言它可复用。回退放在 `runtime.ts`：记录的输出不是 JSON 时，该步骤重跑。
- **端到端用例改用 detached 运行（V4）。** 本次未采用：改动需要 delegate 裁定。用例使用前台运行，并从 journal 文件名读出它的 id。
- **给内联输出设大小上限（V8）。** 未做：写盘代价写在 `AgentEndEvent.output` 的 JSDoc 里，上限等待裁定。
- **照工单把模型给的 `resume` 值原样交给引擎。** 未采用：这个 id 会成为 journal 文件名（`join(directory, id + '.json')`，该文件还会被写入）和租约行的名字，不校验就能让模型在 journal 目录之外写 `.json` 文件。
- **桩模型的工具调用 id 固定为 `stub-<n>`。** 未采用：同一个会话先后经过两个桩时会两次遇到 `stub-1`，所以用 `StubToolCall.id` 让用例给调用命名；默认值不变。
- **把调用身份记在条目的 `inputs` 里**，即盲审指出的那个空槽。未采用：结算时的压缩会清空每个已核验步骤的 `inputs`，之后再续跑同一个运行时找不到身份，这些步骤会重新启动。
- **把 `args` 纳入续跑准入所用的摘要。** 未采用：它会拒绝参数改动后的续跑，但由完成先后决定的步骤编号仍会把一次调用的输出交给另一次调用；身份核对两者都能覆盖。
- **不看编号，按身份把记录的步骤匹配给调用。** 未采用：这需要在 journal 之上再建一个索引；按步骤编号取、再核对身份，是阻止返回错误输出的最小改动。
- **因脚本改动被拒的续跑不运行脚本。** 未采用：acceptance[1] 拒绝的是续跑，运行照上文从头开始；改为保留被拒的 journal。

## 后果

- 宿主在每个步骤边界重写整个 journal，所以每份内联输出在之后的每个边界各写一次；没有任何上限限制输出大小。
- 本次改动之前写成的 journal 保存的是占位串，也没有调用身份，续跑会重跑这些步骤。
- 被拒的续跑仍以同一个 id 从第一步运行脚本；`resumeRefused` 是调用方得知没有复用任何步骤的唯一途径。
- 若调用的启动顺序与被中断的运行不同，编号变了的步骤会重新启动它的子 agent，而不会按另一个编号去找它的记录。
- 没有任何代码删除 `refused/` 下留存的 journal；同一个运行之后若在同一个记录摘要下再次被拒，会替换之前留存的那份。
- 已存在的 journal 目录保持原有权限；只有 journal 写入方自己创建的目录是 0700。
- 不带调用身份构造的 `WorkflowExecution` 只按编号复用记录的步骤；宿主总会传入身份。
- 工具拒绝不匹配 `^[\w-]+$` 的 `resume` 值，例如含 `.` 的值；worker-thread 引擎生成的 UUID 都匹配。
- 工具从不显示前台运行的 id，崩溃的运行也不会返回结果，所以在出厂产品上没有任何途径把可续跑的 id 交给模型；端到端用例观测的是工具续跑一个交给它的运行（V4）。
- 子 agent 在结果转发之前已被处置时（例如运行仍有子 agent 在跑时调用 `dispose()`），刷写失败，宿主记一条 warn。
- `engine.resume` 先取该运行的租约；此后若对账抛出异常，或 `launch` 校验失败，租约不会释放，要等 30 秒后到期，期间以同一个 id 重试都会被拒。现在模型通过工具就能走到这条路径。
- 续跑会在同一个会话里为同一个运行 id 再写一条 `tool-workflow/run-start`，测试用的 invariant 会把它报告为重复运行（A8）。
- journal 只按运行 id 命名，不记录归属，所以任何知道某个运行 id 的会话，都能用自己的权限续跑那个运行。
- `stub-model.ts` 没有单元测试，覆盖率状态与改动前相同。
