# Agent Note：受限命令证明自己已经启动

Status: implemented

[English](2026-10-04-a-confined-command-proves-it-started.md) | 中文

## 问题

Epic P3-03 的 must[1] 要求程序的输出永远不能决定它的结局。沙箱化的 shell 却有两件事凭输出判定。一是 runner 失败，即沙箱 runner 在启动命令之前就拒绝：它按各后端的致命签名从 stderr 匹配（`bwrap: `、`sandbox-exec: `、退出码 125 加 `landlock-run: `、退出码 127 加 `windows-acl-run: `）。命令只要打印其中一条并以对应退出码退出，就会被报告为 `SANDBOX_UNAVAILABLE`，它的类型是 `policy_denied`，还会招来升权。退出码门控也无济于事：每个 runner 都会 exec 命令，所以启动成功之后，退出码就是命令自己的。二是文件访问拒绝：它同样凭输出匹配，显示的却是文件系统隔离为 harness 自己判定的拒绝所用的那个标记。

## 决定

- **启动标记是证明命令已启动的唯一带外事实**（delegate 的裁定 Q-U2a 与 Q-U2c）。在 `LaunchMarker`（`dsh-sandbox`）中，宿主侧的 `/bin/sh` 在 `$DSH_HOME/cache/launch` 下打开一个状态文件作为描述符 9，再 exec runner；沙箱内的 `/bin/sh` 写入标记、关闭描述符 9，再 exec 命令。没有标记：runner 失败，调用 fail closed。有标记：任何失败都归命令自己。命令既写不了也删不掉这个标记：它不持有该文件的描述符，而任何受限模式都不允许它写 harness 主目录。一次 CI 探针在 bwrap 下证实了全部四条性质；窄跑够不着 Landlock 与 Seatbelt，它们在真实 runner 上的检查留到签字时做。
- **由消费方包装，提供方不包装。** `dsh-bash-sandbox` 与 `dsh-pwsh-sandbox` 每次运行打开一个标记，把放在沙箱内包装层之后的命令交给提供方，再把结果放在宿主侧包装层之后 spawn。`confine()` 不变，所以终端会话不会多一层 shell，也不会多一个状态目录。
- **删去 stderr 规则**：`RunnerFailureRule`、`ConfinedArgv.runnerFailureRules`、本地提供方的各后端规则及其 `runnerFailureSignatures` 配置。`runnerCommand` 配置的 runner 必须 exec 包装后的 argv。
- **Windows 没有标记**（Q-U2b）。受限令牌 runner 没有可用于包装的 POSIX shell，所以标记是无标记形式，只有 spawn 失败才算；runner 的退出码 127 那一行是给运维人员看的。
- **从输出读出的拒绝只是提示**（Q-U2d）。`ShellSandboxInfo.denied` 仍是 stderr 与后端拒绝方言的匹配，bash 与 pwsh 把它渲染为 `[the command's output reads like a sandbox file-access denial under <mode> mode; the sandbox did not report it]`。文件系统隔离为自己判定的拒绝保留 `[sandbox: file access denied under <mode> mode]`。这样一次运行的结局是 `tool_failed`（U1）。

## 考虑过的替代方案

- **bwrap 的 `--json-status-fd`。** 它只覆盖一个后端，还需要一个子进程 spawn 规格传不进去的描述符。
- **退出码门控。** 可以伪造，因为 runner 会 exec 命令。
- **把标记放进 `confine()`。** 这个 seam 的每个调用方（包括终端）每次调用都会多出包装层和一个状态目录。

## 后果

- 对模型可见：bash 与 pwsh 的工具说明及其拒绝结果都带上新提示；显示其中任一者的录制会随一次快照刷新改变。
- 真实的 shell 拒绝（内核给出的 EROFS、EACCES 或 EPERM）在任何后端上都没有带外报告，所以它是带提示的 `tool_failed`，绝不是 `policy_denied`。P3-03 acceptance[1] 的这一收窄是否接受，由用户决定（Q-U2e）。
- Seatbelt 会检查写操作，而状态文件在可写根目录之外。如果它的 profile 拒绝往描述符 9 写，每次运行都会 fail closed；修法是在签字前用管道代替文件。
