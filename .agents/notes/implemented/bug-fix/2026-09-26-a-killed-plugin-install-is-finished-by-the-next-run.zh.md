# Agent Note：被杀的 `dsh plugin` 安装由下一次运行做完

Status: implemented

[English](2026-09-26-a-killed-plugin-install-is-finished-by-the-next-run.md) | 中文

## 问题

BLOCKED-342，P1-10 acceptance[0] 的 CLI 路径：`runUnderLease` 只把 profile 安装前的 `package.json` 与 `pnpm-lock.yaml` 放在内存里。`dsh plugin add` 在 pnpm 装好新代码之后被杀（在迁移模块导入时、在 `migrate` 里或在 `validate` 里），留下的是新代码配旧数据。重跑时它以新的 `package.json` 为基线，找不到版本变化，什么也不迁移，也什么都不放回。lane A 的 A-447 量了这三个被杀点：每次重跑都退出 0，代码是 2.0.0，数据停在版本 1。

## 决定

- **安装在 pnpm 运行前记下它起步时的代码。** profile 目录里的 `.dsh-install-in-flight.json` 保存安装前 `package.json` 与 `pnpm-lock.yaml` 的字节，原子写入。安装以代码与数据处在同一版本结束后删掉它：插件 lock 提交之后、迁移失败而代码回滚之后，或被拒的安装撤销之后。
- **下一次运行把安装做完，而不是撤销。** 找到这份记录的运行，以记录里的清单而不是当前清单为基线读版本变化，于是被中断的升级的数据迁移会在数据恢复留下的状态上执行；迁移失败则还原记录的字节。运行结束时要么新版本完整，要么在迁移失败时旧版本完整。
- 选择做完，是因为操作者要的是新版本。数据这一半本来就能续上：恢复把做了一半的数据放回，迁移会跳过已经处在新版本的数据。

## 考虑过的替代方案

- **下一次运行时撤销。** 先还原记录的字节、重装旧代码，同样能得到一个完整版本，但同一条命令随后又会装一次新代码，多出的这次安装不增加任何安全性。
- **把记录放在 harness home，和数据升级记录放在一起。** 那些记录按插件分，而代码回滚目标按 profile 分；profile 目录里放着它要还原的文件。

## 后果

- 运行在 pnpm 移动代码之后、记录删除之前死掉的安装，由该 profile 里的下一条 `dsh plugin` 命令做完，不论那是哪条命令。那次运行会打印 `finishing an install an earlier run began and did not complete`。
- pnpm 自身失败时记录保留，下一次运行从同一个基线开始。
- 验证：A-447（`apps/cli/tests/plugin-migration-cli-crash.spec.ts`）与 `apps/cli/tests/plugin-install-record.spec.ts`。
