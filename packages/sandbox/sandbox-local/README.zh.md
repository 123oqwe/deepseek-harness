---
description: "面向 Linux、macOS 或 Windows 上选择、配置或排查进程隔离的用户与维护者的本地各平台沙箱后端。"
kind: "package-reference"
---

# @deepseek-ai/dsh-sandbox-local

[English](README.md) | 中文

## 概述

`dsh-sandbox-local` 在共享宿主内核和文件系统的同时，限制 Linux、macOS 与 Windows 上的命令及其派生进程。它自动选择受支持的平台 runner；没有可用 runner 时以 `SANDBOX_UNAVAILABLE` 失败，因此命令绝不会静默无限制运行。每次执行都会报告 `full` 或 `partial` 强制执行，以及拒绝和 runner 失败签名，让调用方能区分不可用或损坏的沙箱与策略拒绝。在后端做得到时，两种受限模式还会拒绝 Unix-domain socket，因此命令连不上 Docker 守护进程或 SSH agent；做不到的后端报告 `partial`，并列出它留下可连的已知 socket。宿主本地 bash 或 pwsh 执行适合选择它；进程需要隔离环境时应改用容器或远程执行器。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在 `ctx.sandbox` 后挂载此提供方并配一个受限执行器，执行器 spawn 的每条命令都会在你解析的策略下受限运行。随附的[基础组合包](../../bundle/base/cordis.patch.yml)拥有默认策略与执行器接线。

### 何时选择

当命令必须在宿主机上受限运行时选择它：它是挂载 `ctx.sandbox` 的 Linux、macOS 与 Windows 组合的默认后端。当进程必须在隔离环境中运行时请另选机制——容器或远程执行器会替换整个能力，而此提供方与宿主共享内核和文件系统。

### 最小配置

加载沙箱服务并挂载提供方；以下默认值即选择策略。

```yaml
- id: sandbox
  name: '@deepseek-ai/dsh-sandbox-local'
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `runnerCommand` | `[]` | 自定义 runner argv；会追加 bwrap 兼容的 profile 参数，并跳过内置选择与探测；因为不安装 Unix socket 过滤器，强制执行报告为 `partial` |
| `runnerFailureSignatures` | `[]` | 识别自定义 runner 自身失败方言的不区分大小写 stderr 子串；与 `runnerCommand` 搭配必需 |
| `probeTimeoutMs` | `5,000` | 每次竞争 runner 候选功能探测的超时时间 |

生成的[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-sandbox-local)是每个受支持字段及其 JSDoc 的穷尽式真源。

### 受限执行与强制执行

挂载提供方后，命令在你逐调用解析的模式下运行。强制执行是报告的事实，而非承诺：`full` 表示后端管辖模式承诺的每个文件操作并拒绝 Unix-domain socket，`partial` 表示它只管辖子集或无法拒绝这些 socket——Landlock、Windows ACL 档（还有 Everyone 与硬链接边界）与 `runnerCommand` runner 是当前的部分强制执行情形，因此需要绝对边界的消费方可以拒绝或向上暴露它们。被拒绝的文件操作通过后端的拒绝方言呈现，执行命令前失败的 runner 会报告结构化的 runner 失败签名。

<a id="unix-domain-sockets"></a>
### Unix-domain socket

守护进程或 agent 的 socket 能让命令获得沙箱不给的权限：Docker 守护进程启动的容器可以挂载任意宿主路径，SSH agent 会用用户的密钥签名。因此在后端做得到时，两种受限模式都拒绝 Unix-domain socket。

| 后端 | Unix-domain socket |
|---|---|
| x86_64 或 AArch64 上的 bwrap | 拒绝：seccomp 过滤器让 `socket(AF_UNIX, …)` 与三个 io_uring 调用以 `EPERM` 失败，并杀死经由其他 ABI（32 位 x86、x32、AArch32）发起调用的进程 |
| Seatbelt | 拒绝：连接 socket 以 `EPERM` 失败，mDNSResponder 与 syslog 的 socket 除外，因此主机名解析与日志照常可用 |
| 其他架构上的 bwrap、Landlock、Windows ACL 档、`runnerCommand` | 不拒绝：强制执行为 `partial`，`reachableSockets` 列出下表中宿主上存在的已知 socket |

被拒绝的命令会看到 `Operation not permitted`。管道、`socketpair` 以及 TCP 与 UDP socket 照常可用，所以命令自己的进程之间仍能通信，网络访问也不受影响。经 socket 访问本地守护进程或 agent 的工具在沙箱内无法工作：Docker CLI、`ssh-add` 与基于 agent 的 `ssh` 认证、`gpg`、D-Bus 客户端、经 socket 连接的 PostgreSQL 客户端、Linux 上 Python 3.14 的 `multiprocessing`（其默认的 `forkserver` 启动方式使用 socket），以及监听 Unix socket 的测试服务器。模型可以带 `sandbox_permissions: danger-full-access` 把这样的调用重试一次，由用户只为这一次调用批准。

后端做不到拒绝时，提供方会向 stderr 写一行，点名该后端与它找到的已知 socket；只有后端或列表变化时才再写。写到 stderr，是因为 headless 运行看不到 logger。

已知 socket 是提供方能按名称找到的那些；每一项在列，都是因为它给出沙箱不给的权限。

| 位置 | 列入原因 |
|---|---|
| `$SSH_AUTH_SOCK` | 会话指定的 SSH agent，它用用户的密钥签名 |
| `$DOCKER_HOST`（`unix://` 端点）与 Docker CLI 的当前 context | Docker CLI 会使用的守护进程 |
| `/var/run/docker.sock`、`/run/docker.sock`、`/run/podman/podman.sock` | 系统 Docker 守护进程与 rootful Podman |
| `/var/snap/lxd/common/lxd/unix.socket`、`/var/lib/lxd/unix.socket`、`/var/lib/incus/unix.socket` | LXD 与 Incus，其实例可以挂载宿主路径 |
| `/var/run/libvirt/libvirt-sock`、`/run/libvirt/libvirt-sock`、`/run/libvirt/virtqemud-sock` | libvirt 的读写 socket，可以定义挂载宿主磁盘的虚拟机 |
| `$XDG_RUNTIME_DIR` 下的 `docker.sock`、`podman/podman.sock`、`libvirt/libvirt-sock`、`libvirt/virtqemud-sock` | rootless Docker、rootless Podman 与会话 libvirt |
| `$XDG_RUNTIME_DIR` 下的 `ssh-agent.socket`、`gnupg/S.gpg-agent.ssh`、`keyring/ssh` | systemd、GnuPG 与 GNOME Keyring 的 SSH agent |
| `~/.docker/run/docker.sock`、`~/.docker/desktop/docker.sock`、`~/.colima/default/docker.sock`、`~/.orbstack/run/docker.sock`、`~/.rd/docker.sock` | Docker Desktop、Colima、OrbStack 与 Rancher Desktop |
| `~/.gnupg/S.gpg-agent.ssh`、`~/.1password/agent.sock`，以及 macOS 上 1Password 与 Secretive 的 agent socket | GnuPG、1Password 与 Secretive 的 SSH agent |
| `/tmp`、`/private/tmp` 与 `$TMPDIR` 下的 `ssh-*/agent.*` 和 `com.apple.launchd.*/Listeners` | OpenSSH 的默认 agent socket（包括该用户其他登录会话的），以及 macOS 经 launchd 启动的 SSH agent |

刻意不列：containerd 的 socket，只有 root 能打开；libvirt 的只读 socket（`libvirt-sock-ro`），无法定义或启动虚拟机；Incus 的用户 socket（`unix.socket.user`），它把每个用户限制在受限 project 内；以及只在 `~/.ssh/config` 的 `IdentityAgent` 中指定的 agent，提供方不解析该文件。对会拒绝 socket 的后端，这些都无关紧要：每个 Unix-domain socket 都被拒绝，列没列都一样。

### 失败与恢复

不受支持的平台或不可用的 runner 会拒绝执行：`confine()` 抛出 `SANDBOX_UNAVAILABLE` 并列出该平台的 runner 选项，消费方会呈现该错误，而不是让命令不受限制地运行。启动后拒绝自身 profile 的 runner 由其致命 stderr 签名与退出码识别，因此损坏的沙箱不会被误认为被拒绝的命令。`runnerCommand` 覆盖是操作方断言：它跳过功能探测，并假定配置的 runner 诚实实现与 bwrap 兼容的 profile。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

本节解释 runner 选择、各平台 profile 与失败方言；可观察行为已在[使用本包](#use-this-package)中完整说明。

### runner 选择

选择按平台优先、探测其次：每个平台都有 runner 链（`linux`：`bwrap` 再 Landlock；`darwin`：Seatbelt；`win32`：ACL 受限令牌 runner）。唯一候选直接选择、不探测；竞争候选按链序各执行一次功能探测，首个可用结论在提供方生命周期内缓存。没有链的平台、或链上所有探测都失败时，平台不可用，`confine()` 会拒绝执行。

### 平台 profile

bwrap profile 组合只读宿主根目录、全新 `/dev` 与私有 PID 命名空间中的 `/proc`——命令可管理其后代，但看不到宿主进程，因此 procfs 魔法链接无法绕过挂载；`workspace-write` 另加临时的 `/tmp` 与可写工作区绑定挂载。[私有 PID 笔记](../../../.agents/notes/implemented/bug-fix/2026-08-06-bwrap-private-pid-namespace.zh.md)记录该边界。在 x86_64 与 AArch64 上，argv 还带 `--seccomp 3`，由一段很短的 `/bin/sh` 脚本把过滤器的字节经文件描述符 3 管道送入 bwrap，因此过滤器从不落盘；功能探测也经同一段脚本运行。[`src/seccomp.ts`](src/seccomp.ts) 按 sandbox-runtime 用 libseccomp 生成的规则集装配该过滤器。

`@deepseek-ai/node-addon-system/landlock-run` API 提供平台 launcher、功能探测与授权词汇；此提供方只做模式到授权的映射，把路径解析与探测解析保留在带版本的 binary 中。

Seatbelt profile 默认允许，带 `(deny file-write*)` 与来自共享 `writableRoots` 辅助函数的写入 allow-list，因此恰好管辖模式承诺的文件操作；每个根目录都经过规范化，因为 Seatbelt 匹配解析后的路径（`/tmp` 就是 `/private/tmp`）。它还拒绝对 Unix-domain socket 的 `network-outbound`，再放行 `/var/run` 与 `/private/var/run` 下的 mDNSResponder 与 syslog socket。

Windows 档为每个工作区保留一个确定性写入 SID 和常驻 ACE，同时为每个活跃的会话/工作区对分配一个随机私有临时目录，以及不同的 SID 和可撤销 ACE——共享工作区的会话共享其预期写权限，却不会继承彼此的临时目录权限。新的提供方总会选择新的临时路径和 SID，因此崩溃残留既无法阻止恢复的会话，也无法向其授权。该档报告 `partial` 强制执行，因为受限令牌必须保留 Everyone，且 NTFS 硬链接会把同一文件对象别名为多个路径。

### 拒绝与 runner 失败方言

每个 runner 的内核都有自己的拒绝方言，随每次包装以 `denialSignatures` 携带，`runnerFailureRules` 则给出每个 runner 的致命签名，因此消费方先分类 runner 拒绝，再检查拒绝签名。精确的字符串与退出码位于 [`src/index.ts`](src/index.ts)。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：runner 链选择、功能探测、逐调用包装、ACL 授权生命周期 |
| [`src/profiles.ts`](src/profiles.ts) | 各平台 profile 构建器：bwrap 挂载、Landlock 授权、Seatbelt SBPL |
| [`src/seccomp.ts`](src/seccomp.ts) | bwrap 用来拒绝 Unix-domain socket 的 seccomp 过滤器，以及经文件描述符 3 传入它的脚本 |
| [`src/sockets.ts`](src/sockets.ts) | 无法拒绝 Unix-domain socket 的后端所报告的已知宿主守护进程与 agent socket |
| — | 不发布运行时不变式伴生入口；除所属 seam 强制执行的约定外，本包不公开独立的事件序列或可变数据关系。 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

先从子系统参考文档了解共享词汇，再看 seam 约定、消费方与 win32 档。

- [进程沙箱子系统](../../../docs/subsystems/sandbox.zh.md)——模式、逐调用策略与分类方言。
- [沙箱 seam 包](../sandbox/README.zh.md)——本提供方实现的服务约定。
- [Bash 沙箱执行器](../../shell/bash-sandbox/README.zh.md)——受限的 bash 消费方。
- [Windows ACL 受限令牌档](../sandbox-windows-acl/README.zh.md)——本提供方挂载的 win32 后端。
- [子进程沙箱决策](../../../.agents/notes/implemented/feature/2026-07-06-sandbox.zh.md)——能力边界与 runner 选择语义。

-----

<a id="model-experience"></a>
## 模型体验

通过 [`dsh-bash-sandbox`](../../shell/bash-sandbox/README.zh.md) 和 [`dsh-tool-bash`](../../shell/tool-bash/README.zh.md) 间接影响；它们渲染此提供方的强制执行与拒绝事实，而 [`dsh-sandbox`](../sandbox/README.zh.md) seam 拥有 `SANDBOX_UNAVAILABLE` 文本、本提供方拥有 runner 选择，profile 不进入上下文。bash 工具的描述说明沙箱可能拒绝 Unix-domain socket；被拒绝的调用在命令自己的 stderr 中把 `Operation not permitted` 带给模型。

#### KV Cache 影响

不会直接使 KV Cache 失效；请求前缀变更由上述消费方负责。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制说明提供方何时不合适，或何时需要特别运维。它们是当前包约束，不是通用平台对比或任务积压。

- **Windows ACL 只能实现部分强制执行**——受限令牌必须保留 Everyone 以完成进程初始化，因此授予 Everyone 写访问的外部对象仍可写；NTFS 硬链接也会使工作区路径与外部路径指向同一个文件对象。提供方报告 `enforcement: 'partial'`，而不会把该边界夸大为完整强制执行。它也不拒绝 Unix-domain socket，已知 socket 列表不含 Windows 命名管道。
- **Landlock 只实现部分强制执行**——它无法拒绝 Unix-domain socket，较旧且受支持的内核 ABI 还只能限制自身公开的访问类别；提供方报告 `enforcement: 'partial'`，不会把两者之一夸大为完整强制执行。
- **拒绝 socket 需要 x86_64 或 AArch64 上的 bwrap，或 Seatbelt**——seccomp 过滤器只为这两种架构构建。其余后端报告 `partial` 并列出找到的已知 socket，而该列表天然不完整：监听在别处的守护进程仍可连，且不会被点名。
- **拒绝 socket 会让基于 socket 的本地工具失效**——[Unix-domain socket](#unix-domain-sockets) 一节列出的工具在沙箱内都会失败，只有逐次批准的 `danger-full-access` 能运行它们。
- **Seatbelt 的 socket 规则只在开发者 Mac 上验证过**——没有 macOS CI 作业运行 `tests/seatbelt.e2e.ts`。
- **Seatbelt 依赖已弃用的 `sandbox-exec`**——macOS 仍会提供它，但若 Apple 移除该私有策略引擎，该提供方无法替换或探测。
- **runner 选择在提供方生命周期内缓存**——安装、移除或修复 runner 后，必须重载插件才能改变选择。
- **`runnerCommand` 是操作方断言**——配置的自定义 runner 会跳过功能探测，并假定它诚实实现与 bwrap 兼容的 profile；如果它本身是 Bash 脚本，其解释器启动发生在该脚本施加约束之前。它不会被装入 Unix socket 过滤器，因此其包装报告 `partial`。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

本开发备注是维护者的工作上下文：未决方向与开放问题。它明确不具权威性——已交付的行为、限制与既定理由以上文、包代码和相关 Agent Note 为准。

#### 未来：环境一致的能力组

[沙箱决策](../../../.agents/notes/implemented/feature/2026-07-06-sandbox.zh.md)把环境一致的能力组示例（例如 bash 加 fs 针对同一个容器）列为延期阶段；该方向尚未决定。

</details>
