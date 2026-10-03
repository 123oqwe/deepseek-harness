# Agent Note：受限命令不能写 harness 主目录

Status: implemented

[English](2026-10-03-a-confined-command-cannot-write-the-harness-home.md) | 中文

## 问题

`workspace-write` 授权写工作区根目录、`/tmp` 与 `os.tmpdir()`，没有任何东西把 harness 主目录排除在外。默认主目录 `~/.dsh` 位于任何在 `~` 或其上层的工作区之内，所以模型的 `write`、`edit` 与 `bash` 不经批准就能在那里新建、改动文件（B-713；A-597 ① 与 ② 在出厂的 headless 启动上观测到）。主目录保存 harness 自己的配置与状态：profile 及其补丁层、强制执行的策略集所来自的设置文档（P2-05）、信任锚、已保存的 workflow、action ledger 目录（P4-12）与凭证存储。被工作区里的文字引导的模型因此能改写评判它下一次调用的策略、按路径挂上插件，或改动 ledger。

## 决定

- **唯一出处。** `@deepseek-ai/dsh-sandbox` 里与 `writableRoots` 并列的 `protectedRoots(policy)`，在 `workspace-write` 下返回规范化后的 `$DSH_HOME`，在 `read-only` 下什么都不返回。`@deepseek-ai/dsh-sandbox` 因此新依赖 `@deepseek-ai/dsh-home-paths`，用它解析主目录。
- **fs 围栏。** `@deepseek-ai/dsh-fs-sandbox` 在可写根目录包含检查之后，对新规范化的目标落在受保护根目录下的写入或编辑，以 `FS_SANDBOX_DENIED` 拒绝。
- **bwrap。** 在工作区的可写 bind 之后，把位于工作区内的受保护根目录以只读方式 bind。宿主 `/tmp` 下的主目录已被 `/tmp` 的 tmpfs 遮住；不存在的主目录不 bind，因为 bwrap 不能 bind 不存在的路径。
- **Seatbelt。** 在可写根目录的授权之后加 `(deny file-write* (subpath $DSH_HOME))`。在 SBPL 中，两条都匹配的规则以后写的为准；现有 profile 的授权写在 `(deny file-write*)` 之后，本来就依赖这一点；在 macOS 上用 `sandbox-exec` 实测过一次，后写的 subpath deny 盖过先写的 subpath allow。
- **Landlock 与 Windows ACL runner。** 两者都只能授予可写根目录。当受保护根目录位于任一可写根目录（工作区、`/tmp` 或 `os.tmpdir()`）之下时，`confine` 以 `SANDBOX_UNAVAILABLE` 拒绝执行命令，并写明主目录与改法：在不包含 `$DSH_HOME` 的工作区中启动，或移动 `DSH_HOME`。

## 已考虑的替代方案

- **把主目录放进 `SandboxExecutionPolicy`，由 `@deepseek-ai/dsh-sandbox-policy` 填写。** 那个包同样不解析主目录，而且每个构造 policy 的字面量都要改。与 `writableRoots` 并列的一个 helper，让每个后端只有一个出处。
- **Landlock 只在工作区包含主目录时拒绝。** 主目录在 `/tmp` 或 `os.tmpdir()` 之下，对这些后端是同一个缺口，所以拒绝覆盖每个可写根目录。
- **只排除已知要紧的文件（策略设置、补丁层）。** 主目录的布局会增长；新加在下面的文件会重新打开这个缺口。

## 后果

- 受限命令，以及 `workspace-write` 下的 `write`、`edit` 工具，再也不能改 harness 主目录。模型要改它，需要逐调用批准的 `danger-full-access`。这也堵住了模型改写 P2-05 策略集与 P4-12 ledger 目录的路。
- 在 Landlock 或 Windows 主机上，只要工作区或某个临时区域包含 `$DSH_HOME`，每个受限命令都会被拒绝；错误信息说明如何移开。
- 不涵盖：对主目录的读取不变（B-717 拒绝读取凭证文件）；出网不变（B-719′）；`run_code` 根本不在 OS 沙箱里（第 34 题）；Seatbelt 规则只在开发者 Mac 上观测、Windows 的拒绝只由单元测试覆盖，因为没有 CI 作业运行这两个平台的后端。
