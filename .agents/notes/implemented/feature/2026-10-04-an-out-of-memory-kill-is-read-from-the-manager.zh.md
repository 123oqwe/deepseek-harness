# Agent Note：内存耗尽的终止从管理器读取

Status: implemented

[English](2026-10-04-an-out-of-memory-kill-is-read-from-the-manager.md) | 中文

## 问题

Epic P3-03 要求把 `resource_exhausted` 与普通失败区分开来记录类型。在 Linux 上，命令撞到内存上限时会被内核的 OOM killer 终止，表面上只是一个 `SIGKILL`，所以 U1 把它记成了 `tool_failed`。容纳这条命令的 scope 其实知道得更多，但启动时带了 `--collect`，systemd 在 scope 停下的那一刻就把它连同 `Result=oom-kill` 一起卸载了。

## 决定

- **scope 保留它的结果**（delegate 的裁定 Q-U3；探针 run 37213379099，systemd 255）。启动去掉 `--collect`。停下的 scope 于是一直显示 `failed/oom-kill`，直到 `reset-failed`；只有命令的子进程被终止、命令本身存活时也是如此。
- **由管理器与内核来读，从不由进程来读。** 进程没有正常退出时，subprocess-local 读一次 scope：已停下就读它的 `Result`，仍处于 active 就读其 cgroup 的 `memory.events` 中的 `oom_kill` 计数。若 cgroup 在两次读取之间消失，说明 scope 已停下，就再读一次。正常退出不读：它不记录结局。读取失败时这个事实保持未知；这是类型，不是安全判定。
- **owner 先记录，再重置。** owner 的轮询看到失败的 scope 时，记下它的 `Result` 并执行 `reset-failed`，失败的 scope 因而不会累积。内存耗尽读取发现单元已经不在时，使用这份记录。
- **这个事实随退出事实传递。** `SubprocessOutcome.resourceExhausted` 与 `ShellRunResult.resourceExhausted` 携带 `memory`；bash 与 pwsh 工具把它保留在自己的值里，`shellRunOutcome` 把它映射为 `limit: memory` 的 `resource_exhausted`，排在中止与执行器截止时间之后、它所引起的信号之前。

## 考虑过的替代方案

- **轮询 scope 直到离开 `active` 再读 `Result`。** 留下后代进程继续运行的命令会把结果拖到整个时限；而 scope 存活期间，cgroup 的 `memory.events` 能立刻给出答案。
- **只在 `SIGKILL` 之后读取。** 这会漏掉子进程被终止、而命令随后以自己的退出码失败的情形。

## 后果

- Linux 上每个通过 scope 运行、没有正常退出的进程，都会多一次 `systemctl show`。
- 终端会话同样不带 `--collect` 启动；它们的 owner 以同样方式重置失败的 scope，但不报告这个事实。
- 其他平台以及 Linux 上的 PGID 回退路径不报告 `resourceExhausted`：它们的内存终止仍是带信号的 `tool_failed`。
