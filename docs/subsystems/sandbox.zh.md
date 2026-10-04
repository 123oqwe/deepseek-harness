# 进程沙箱

[English](sandbox.md) | 中文

[dsh-sandbox](../../packages/sandbox/sandbox) 的进程沙箱 seam 将与宿主共享文件系统和内核的子进程 argv 包装在文件效果策略中，而不将消费方耦合到特定平台运行器。[dsh-sandbox-local](../../packages/sandbox/sandbox-local) 提供 Linux bwrap/Landlock、macOS Seatbelt 与 Windows ACL 受限令牌后端；[dsh-bash-sandbox](../../packages/shell/bash-sandbox) 和 [dsh-pwsh-sandbox](../../packages/shell/pwsh-sandbox) 是其消费方。容器、microVM 和远程执行是完整能力 seam 的同级实现，而非 `ctx.sandbox` 的提供方。

源码：[`packages/sandbox/sandbox/src/index.ts`](../../packages/sandbox/sandbox/src/index.ts)

## 模式与强制执行

`SandboxMode` 仅管控文件系统效果。`read-only` 要求后端拒绝写入——POSIX runner 还会授予其 shell 所需的 `/dev/null` 接收器，而 Windows ACL runner 不授予任何显式可写根目录，并因环境 ACL 缺口报告部分强制执行；`workspace-write` 允许在工作区根目录及后端承诺的临时区域下写入，但 harness 主目录（`$DSH_HOME`）除外：bwrap、Seatbelt 与进程内的 fs 隔离让它保持只读，只能授予可写根目录的 Landlock 与 Windows ACL runner 在可写根目录包含它时拒绝执行命令；`danger-full-access` 绕过隔离。网络与进程可见性不在此处的定义范围内。读取也不受限，dsh 自己的凭证库除外（Landlock 与 Windows 主机上的 bash 例外）；完整情况见[模型能读到什么](credentials.zh.md#what-the-model-can-read)。Unix-domain socket 也不是一种模式：两种受限模式都在后端做得到时拒绝它们，哪些后端做得到由[本地提供方](../../packages/sandbox/sandbox-local/README.zh.md)说明。

```ts type-equiv
/**
 * File-effect policy for confined processes. `read-only` permits only required
 * sinks such as `/dev/null`; `workspace-write` also permits the workspace and a
 * backend-defined temp area; `danger-full-access` bypasses confinement. Network
 * and process visibility are outside this vocabulary. Both confining modes also
 * refuse Unix-domain sockets where the backend can
 * ({@link ConfinedArgv.reachableSockets}).
 */
type SandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access'
```

只有前两种模式可以发送给提供方。`danger-full-access` 的消费方直接 spawn 原始 argv，不调用 `ctx.sandbox`。

```ts type-equiv
/** A confining (non-`danger-full-access`) mode — the modes a {@link SandboxPolicy} can carry. */
type ConfinedSandboxMode = Exclude<SandboxMode, 'danger-full-access'>
```

强制执行完整性是后端报告的事实。`full` 表示后端管控了该模式承诺的所有文件效果；`partial` 表示活跃后端或较旧的内核 ABI 仅管控其中一个子集，或后端无法拒绝 Unix-domain socket，因此要求绝对保证的消费方必须拒绝或向上暴露这一区别。当前的部分强制执行情形包括较旧的 Landlock ABI、Windows ACL runner 的 Everyone 与硬链接边界，以及所有无法拒绝 Unix-domain socket 的后端（Landlock、Windows ACL runner 与操作者配置的 runner）。

```ts type-equiv
/**
 * Enforcement completeness for this host. `partial` means an active backend or
 * older kernel ABI cannot govern every promised file effect, or cannot refuse
 * Unix-domain sockets; callers requiring an absolute boundary must not treat it
 * as `full`.
 */
type SandboxEnforcement = 'full' | 'partial'
```

## 逐调用策略

完整执行策略会按每次能力调用解析并携带。它包括 `danger-full-access`，因此消费方可以只解析一次策略，再决定是否绕过约束。普通工具调用从调用会话的不可变 cwd 派生 `workspaceRoot`；部署配置是没有 agent（智能体）时的回退值。root 会先按文件系统语义规范化，再做词法规范化，因此包含 `symlink/..` 的 cwd 会标识 spawn 出的进程实际运行的目录。

```ts type-equiv
/**
 * The complete file-effect policy resolved for one capability call. The root
 * is carried even under modes that do not consume it so callers can resolve
 * policy once before choosing the enforcement path.
 */
interface SandboxExecutionPolicy {
  /** The file-effect mode this execution runs under. */
  mode: SandboxMode
  /** Absolute root directory `workspace-write` may write under. */
  workspaceRoot: string
  /**
   * Opaque identity of the calling session (the branded `dsh-session`
   * SessionId). Backends key per-session state off it (e.g. windows-acl gives
   * each live session/workspace pair a random private temp directory and SID,
   * while the workspace SID and standing grant remain per-workspace); absent
   * for agentless calls, which fall back to per-call backend state.
   */
  sessionId?: SessionId
}
```

`ctx.sandboxPolicy.resolve()` 接收活跃会话；对于已批准的重试，还接收显式模式。该服务拥有优先级与 root 回退规则，使 bash 和 fs 不必重复实现。

```ts type-equiv
/** Inputs that select the sandbox policy for one capability call. */
interface SandboxPolicyRequest {
  /** Calling session; its immutable cwd becomes the workspace boundary. */
  session?: Session
  /** Explicit approved mode override, which outranks session policy. */
  mode?: SandboxMode
}
```

只有受约束的执行会到达 `ctx.sandbox`；传给提供方的策略在保留同一 root 的同时收窄模式。这使并发会话、消费方与一次性提权重试可以向同一提供方请求不同边界，而无需改变提供方状态。

```ts type-equiv
/**
 * What one confined execution is allowed to touch — carried PER CALL, not
 * fixed on the provider: two consumers may confine under different policies
 * at the same instant (bash under `read-only` while a confined child agent
 * needs its state directory writable), and an approved escalated retry is a
 * new call with a wider policy. Defaulting/resolution is an explicit step at
 * the consumer boundary; the provider treats the policy as fully specified.
 */
interface SandboxPolicy extends SandboxExecutionPolicy {
  /** The file-effect mode this execution runs under. */
  mode: ConfinedSandboxMode
}
```

<a id="wrapped-argv-and-classification-dialects"></a>

## 包装后的 argv 与分类方言

`ConfinedArgv` 是消费方实际 spawn 的内容。除了替换后的 argv，它还给出后端名称，携带后端的强制执行事实与它留下可连的已知宿主 socket，以及后端的拒绝方言。`denialSignatures` 匹配的是命令自己写出的 stderr，所以命中只是给模型看的提示，从不作为安全判定。runner 有没有启动命令不从输出读取：POSIX runner 会 exec 调用方的 argv，消费方用 `LaunchMarker`（见下文）包住命令与 runner，并在进程结束后读取标记。

```ts type-equiv
/**
 * A {@link SandboxProvider.confine} result: the argv to spawn in place of
 * the caller's own, plus the enforcement completeness the selected backend
 * achieves for it.
 */
interface ConfinedArgv {
  /**
   * The wrapped argv (runner, profile, separator, then the caller's argv). A
   * POSIX runner execs the caller's argv once confinement is in place, so a
   * consumer can learn that it started from a {@link LaunchMarker}.
   */
  argv: string[]
  /**
   * The backend that confines this execution: `bwrap`, `landlock`,
   * `seatbelt`, `windows-acl`, or `runner-command` for an operator-configured
   * runner.
   */
  backend: string
  /** How completely the selected backend enforces the policy's file effects and its refusal of Unix-domain sockets. */
  enforcement: SandboxEnforcement
  /**
   * Host daemon and agent sockets (the Docker daemon's, the SSH agent's, and
   * others the provider knows to look for) that exist on this host and that
   * this backend leaves the command able to connect to, named as a client
   * names them. Empty when the backend refuses Unix-domain sockets; when
   * non-empty, `enforcement` is `partial`. The provider lists only sockets it
   * knows to look for, so a list is never evidence that no other socket is
   * reachable.
   */
  reachableSockets: readonly string[]
  /**
   * The selected backend's denial DIALECT: the case-insensitive stderr
   * substrings a file effect denied by THIS backend produces (EROFS text
   * under bwrap's read-only binds, EACCES under Landlock, EPERM under
   * Seatbelt). A consumer that infers denials from a failed run's stderr
   * matches against exactly these rather than a cross-backend union — the
   * union claims denials a given backend never produces. The stderr is the
   * command's own and any program can print these, so a match is a hint,
   * never a security judgement (Epic P3-03 U2).
   */
  denialSignatures: readonly string[]
}
```

[本地提供方](../../packages/sandbox/sandbox-local/README.zh.md)拥有运维配置。[沙箱化 bash 消费方](../../packages/shell/bash-sandbox/README.zh.md)拥有 spawn 与结果归因。

## 启动标记

`LaunchMarker` 判定 runner 失败（Epic P3-03 U2）。宿主侧的 `/bin/sh` 在 `$DSH_HOME/cache/launch` 下打开一个状态文件作为描述符 9，再 exec runner；沙箱内的 `/bin/sh` 写入标记、关闭描述符 9，再 exec 命令。没有标记的运行是 runner 失败；有标记的运行已经启动了命令，任何失败都归命令自己。命令伪造不了这两种状态：它不持有状态文件的描述符，而任何受限模式都不允许它写 harness 主目录。Windows 没有可用于这两层包装的 POSIX shell，所以那里的标记是无标记形式，只有 spawn 失败才认定为 runner 失败。

## 提供方与 fail-closed 错误

`ctx.sandbox.confine(argv, policy)` 返回一个 `ConfinedArgv`，或在没有可用后端时抛出 `SandboxUnavailableError`（错误码 `SANDBOX_UNAVAILABLE`）。消费方也可以在 spawn 或观察所返回的 argv 时对失败进行分类；该归因属于消费方约定。对于受限策略，静默的无隔离透传永远不合法。

提供方选择、探测、缓存和后端特定的强制执行报告归[本地提供方](../../packages/sandbox/sandbox-local/README.zh.md)所有。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxsandbox--sandboxprovider-abstract-seam"></a>

### `ctx.sandbox` — `SandboxProvider` (abstract seam)

Abstract process-sandbox service. confine must return enforcing argv or fail closed at wrap or runner-execution time; silent unconfined passthrough is forbidden. Functional probes arbitrate multi-runner chains and may be skipped for a sole candidate, whose own refusal remains the fail-closed end.

```ts cordis-catalog
/**
 * Wrap `argv` so it executes confined under `policy` on this host; the
 * caller spawns the returned argv in place of its own.
 * @param argv - the exact argv the caller is about to spawn (program plus
 *   arguments), NOT a shell string — a shell-shaped consumer passes
 *   `['bash', '-c', command]`.
 * @param policy - the file-effect policy this execution runs under,
 *   carried per call (see {@link SandboxPolicy}).
 * @returns the argv to spawn instead, plus the enforcement completeness
 *   the selected backend achieves for it.
 */
abstract confine(argv: readonly string[], policy: SandboxPolicy): ConfinedArgv
```

Source: [`packages/sandbox/sandbox/src/index.ts`](../../packages/sandbox/sandbox/src/index.ts)

<a id="ctxsandboxpolicy--sandboxpolicyservice"></a>

### `ctx.sandboxPolicy` — `SandboxPolicyService`

The sandbox-policy service (`ctx.sandboxPolicy`). Owns the deployment default mode, fallback workspace root, and current request-time policy section. Tool layers call resolve for each execution so a session's mode log and immutable cwd travel together to every enforcing capability.

```ts cordis-catalog
/**
 * Resolve the complete policy for one capability call. An approved explicit
 * mode outranks the session's last `sandbox/mode` event, which outranks the
 * deployment default. A session cwd is its workspace-write boundary; the
 * configured root is the fallback for agentless calls and sessions without a
 * cwd.
 * @param request - optional session and approved mode override.
 * @returns the fully resolved per-call mode and absolute workspace root.
 */
resolve(request: SandboxPolicyRequest = {}): SandboxExecutionPolicy

/**
 * Read the session override without applying the deployment default.
 * @param session - session whose log supplies the override.
 * @returns the last logged mode, or `undefined` without one.
 */
overrideOf(session: Session): SandboxMode | undefined
```

Types: [Session](session.zh.md)

Source: [`packages/sandbox/sandbox-policy/src/index.ts`](../../packages/sandbox/sandbox-policy/src/index.ts)
<!-- END GENERATED cordis-surface -->
