# Agent Note：沙箱中的命令无法打开 Unix-domain socket

Status: implemented

[English](2026-09-26-sandboxed-commands-cannot-open-unix-sockets.md) | 中文

## 问题

BLOCKED-346，1 档安全问题；P3-05 must[1]。出厂的本地沙箱原先只约束文件影响，所以在 `workspace-write` 下运行的命令能连上 Docker 守护进程的 socket，启动一个挂载宿主根目录的容器，或者连上 SSH agent，用用户的密钥签名。两者都远远超出该模式承诺的工作区范围。lane A 的 A-476 第二部分与 A-483 在出厂组合上量过：沙箱中的命令连上了 Docker socket，也连上了在 `/tmp` 之外启动的 SSH agent。

## 决定

- **bwrap 用 seccomp 过滤器拒绝 Unix-domain socket。** 在 x86_64 与 AArch64 主机上，bwrap 的 argv 带 `--seccomp 3`。过滤器让 `socket(AF_UNIX, …)` 与三个 io_uring 调用以 `EPERM` 失败（`IORING_OP_SOCKET` 不经 `socket` 调用也能创建 socket），并杀死经由其他 ABI（32 位 x86、x32、AArch32）发起调用的进程，因为这些 ABI 经 `socketcall` 访问 socket，而过滤器读不到它的参数。管道、`socketpair` 以及 TCP 与 UDP socket 照常可用。
- **规则集来自 sandbox-runtime，在这里装配。** 它就是 Anthropic 的 sandbox-runtime（Apache-2.0）用 libseccomp 生成的程序。`src/seccomp.ts` 自己装配同一段 classic BPF 程序（在 x86_64 上是十三条指令），而不依赖 libseccomp：为一段小而固定的程序引入原生构建或按平台分发的二进制并不值得；它的单元测试用一个 BPF 解释器运行这段程序。
- **过滤器从不落盘。** 一段很短的 `/bin/sh` 脚本把过滤器的字节经文件描述符 3 管道送入 bwrap，并把标准输入交还给命令，因此在写入与读取之间，后来的命令无法替换过滤器。功能探测也经同一段脚本运行，所以 bwrap 装不上它的主机不会被选中。
- **Seatbelt 在 profile 里拒绝它们。** profile 拒绝对任何绝对路径 Unix-domain socket 的 `network-outbound`，再放行 `/var/run` 与 `/private/var/run` 下的 mDNSResponder 与 syslog socket，因此主机名解析与日志照常可用。该规则在一台开发者 Mac 上验证过：绝对路径与相对路径的连接都以 `EPERM` 被拒，主机名解析照常可用；没有 macOS CI 作业运行它。
- **其他后端报告自己拒绝不了的东西。** Landlock、Windows ACL runner、其他架构上的 bwrap 以及操作者配置的 `runnerCommand` 都无法拒绝这些 socket。它们的包装报告 `partial` 强制执行与 `reachableSockets`：宿主上存在的已知守护进程与 agent socket，按指向它们的变量与固定位置按名称找出。提供方还会向 stderr 写一行，点名后端与这些 socket，因为 headless 运行看不到 logger（BLOCKED-336）。
- **事实随结果一起传递。** `ConfinedArgv` 携带 `backend` 与 `reachableSockets`；bash 与 pwsh 执行器把它们抄到 `ShellSandboxInfo` 上；bash 与 pwsh 工具把它们保留在规范结果里，并对受限的前台运行持久化为 `tool/result` 的 `meta.sandbox`。`ToolOutputDefinition.presentationMeta` 现在可以返回 `undefined`，表示不持久化 `meta`。
- **模型知道症状与出路。** bash 工具的描述说明沙箱可能拒绝 Unix-domain socket，这时打开 socket 会以 `Operation not permitted` 失败，而只有 `danger-full-access` 能解除；已有的逐次调用升权会把这一请求交给用户。

## 考虑过的替代方案

- **只隐藏已知的 socket，而不是全部拒绝。** 覆盖挂载或拒绝一张路径列表，会让列表漏掉的每个 socket 都仍可连，而 SSH agent 可以在 `$SSH_AUTH_SOCK` 指向的任何地方监听。这张列表只用来报告拒绝不了的后端留下了什么。
- **网络命名空间（`bwrap --unshare-net`）。** 路径形式的 Unix socket 经文件系统访问，网络命名空间隔不开它；而且这会同时切断 TCP 与 UDP 访问，而这些模式有意不去限制它们。
- **依赖 libseccomp。** 见上文：为一段十三条指令的固定程序引入原生依赖。

## 后果

- 经 socket 访问本地守护进程或 agent 的工具在沙箱内都会失败：Docker CLI、`ssh-add` 与基于 agent 的 `ssh` 认证、`gpg`、D-Bus 客户端、经 socket 连接的 PostgreSQL 客户端、Linux 上 Python 3.14 的 `multiprocessing`，以及监听 Unix socket 的测试服务器。每一个都需要一次经批准的 `danger-full-access` 调用。
- 在 Seatbelt 下，被拒绝的 socket 也会被判为文件拒绝，因为 Seatbelt 的文件拒绝方言同样是 `Operation not permitted`；在 bwrap 下由命令自己的错误说明。
- bash 工具的描述多了一句，因此录制的工具 schema 与系统提示词 fixture 变了一次。快照规范化会丢弃 `meta.sandbox`，因为其中记着录制主机的后端。
- 不涵盖：过滤器只为 x86_64 与 AArch64 构建，`runnerCommand` 没有过滤器，已知 socket 列表天然不完整且不含 Windows 命名管道，Seatbelt 规则没有 CI 运行。
- 验证：lane A 的 A-476 第二部分与 A-483 v2（先红）；`dsh-sandbox-local` 的单元用例（用解释器运行过滤器、经 `sh` 运行脚本、在真实 socket 上查找）及其 bwrap、Landlock 与 Seatbelt e2e 用例；`dsh-bash-sandbox` 的 e2e 用例；以及 `dsh-tool-bash` 的 `socket-escalation.e2e.ts`，其中被拒的 socket 在一次经批准的 `danger-full-access` 重试后连上。
