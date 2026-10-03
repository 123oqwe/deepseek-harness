# Agent Note：受限调用读不到凭证库

Status: implemented

[English](2026-10-03-a-sandboxed-call-cannot-read-the-credential-store.md) | 中文

## 问题

沙箱只管写。模型的 `read`、`grep` 与 `bash` 不经批准就能读到 harness 自己的凭证库：`@deepseek-ai/dsh-credentials-local` 保存的 `$DSH_HOME/.credentials.yaml`，以及 `@deepseek-ai/dsh-app-boot` 作为凭证来源层读取的主目录 `$DSH_HOME/.env`（B-716；A-598 在出厂的 headless 启动上观测到这三条路）。密钥放在模型读得到、读完还能送出去的明文文件里，Trust Kernel 持有的 secret broker 就被绕过了。

## 决定

- **一份清单。** `@deepseek-ai/dsh-sandbox` 里与 `protectedRoots` 并列的 `unreadableFiles()`，返回规范化主目录下的这两个文件，不论它们是否已存在。文件名写在这里而不是导入，因为两个所有者都是 provider，这个能力定义包不能依赖它们。
- **fs 围栏。** `@deepseek-ai/dsh-fs-sandbox` 对清单中文件的 `readText`、`streamText`、`readBytes`、`readByteRange` 以 `FS_SANDBOX_DENIED` 拒绝，除非会话模式是 `danger-full-access`。`stat` 与 `listDir` 只透露存在与元数据，不改。
- **搜索工具。** `grep` 与 `glob` 直接起 ripgrep，不经 fs 层。任何模式下，它们都会去掉文件属于清单的结果，按设备号与 inode 比，与文件名无关，所以换了名的符号链接或指向凭证库的硬链接也认得出；ripgrep 在 OS 沙箱之外运行，会跟随它被指向的符号链接。凭证库的内容与位置都到不了模型，指向文件本身的搜索什么都不返回。
- **bwrap。** 两种受限模式下，在其余所有 mount 之后，把 `/dev/null` bind 到清单中每个已存在的文件上。
- **Seatbelt。** 两种受限模式下，为清单中每个文件加 `(deny file-read* (literal <文件>))`。

## 已考虑的替代方案

- **用 `--glob` 模式让 ripgrep 排除这些文件。** 否定 glob 对显式文件路径与隐藏文件怎样生效，是本包掌控不了的 ripgrep 行为；按基名的模式还会把每个项目自己的 `.env` 也藏起来。按文件身份过滤结果是精确的。
- **在 Landlock 与 Windows 主机上，只要凭证库存在就拒绝受限命令。** 凭证库总是存在，那里的每个受限命令都会被拒绝。这两类主机改记为 Known Limitation。
- **按项授予 Landlock 的读取，跳过凭证库。** 得在 confine 时把 `$DSH_HOME` 沿路每一级的兄弟目录都列出来，之后新建在这些目录里的文件就读不到了。

## 后果

- 在 `read-only` 与 `workspace-write` 下，模型的工具以及 bubblewrap、Seatbelt 约束的命令都读不到凭证库；用户以 `danger-full-access` 批准的调用读得到。
- 不涵盖：在 Landlock 或 Windows 主机上，受限命令仍读得到凭证库（P3-05、P3-06）；`path` 配置到 `$DSH_HOME` 之外的凭证提供方不覆盖；项目自己的 `.env` 以及用户读得到的其他文件照样可读，出网也不变。
