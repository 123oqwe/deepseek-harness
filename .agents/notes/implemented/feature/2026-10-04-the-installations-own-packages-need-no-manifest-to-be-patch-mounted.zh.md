# Agent Note：安装自带的包经补丁挂载不需要 manifest

Status: implemented

[English](2026-10-04-the-installations-own-packages-need-no-manifest-to-be-patch-mounted.md) | 中文

## 问题

插件 manifest 执行为 `enforce` 时，用户补丁插入的行按其包自己的声明准入。安装自带的包大多没有 Manifest v2，补丁插入其中任何一个都会被拒：CENSUS-4（run 37218426287）记下的 sdk 快照，插入 `@deepseek-ai/dsh-code-runtime-worker-thread`、`@deepseek-ai/dsh-tool-bash-persistent`、`@deepseek-ai/dsh-session-title-first-prompt-llm` 的那几条，都因此失败（BLOCKED-360）。安装通配授予背后的身份判定，只在安装查找直接依赖的地方查名字，所以在源码树里，安装只经传递依赖带进来的包（例如 `@deepseek-ai/dsh-tool-lsp`）也拿不到授予。这个判定还调用了 `fs.realpathSync.native`，而 SEA 打包的可执行的虚拟文件系统不应答它。

## 决定

- `isInstallationPackage`（`@deepseek-ai/dsh-app-boot`）判定解析到的包是不是安装自己的那一份：安装的依赖闭包带有这个名字，且解析到的目录与闭包里那一份的真实路径相同。闭包从安装出发，沿依赖与 peer 依赖走。直接依赖在安装自己的边界内查找（其真实路径之上最外层的 `node_modules`，源码树里则是它自己的 `node_modules`）；其余依赖只在安装根之内的 `node_modules` 里查找，安装根是同时包含安装与其直接依赖的最深目录。只在根之上找得到的名字，不算安装带有。
- 模块代理只有在它这个名字的共享回退位置上才算数，那里是 `healProfilesModuleFallback` 写安装自己代理的地方；放进某个 profile 自己 `node_modules` 的代理，不是安装的那一份。
- 补丁行准入：包没有 Manifest v2（缺失或旧式）的行，若 `isInstallationPackage` 对该行解析到的目录成立，就准入。通配请求照旧判定。安装的通配授予（bundle 层与补丁行）用同一个身份判定。
- 真实路径取自 `fs.realpathSync`，pkg 的两种引导都在虚拟文件系统上应答它；SEA 引导没有给 `fs.realpathSync.native` 打补丁。
- 闭包在一个进程里按安装锚点只算一次。

## 考虑过的替代方案

- **给每个出厂包写 Manifest v2。** 已发布的包有好几百个，加上全部 vendored 包，而 vendored 包要改钉住的源码；安装是信任根，不是需要审查的插件。
- **按包名豁免。** 任何以出厂包名放进 profile 的包都会过。
- **每次依赖查找都以父包自己的 `node_modules` 为界。** pnpm 工作区会把一些依赖放在工作区根的 `node_modules` 里，不在任何包自己的 `node_modules` 之内。

## 后果

- 在 `enforce` 下，补丁可以插入安装带有的任何包。profile 里的同名副本、从 profile 指向安装之外副本的链接、只在安装之上找得到的包，仍因缺少 manifest 被拒。
- 共享模块回退仍链接 Node 无界查找找到的东西；它链接的任何东西，都只经这个身份判定准入。
- 普通门不启动 SEA 打包的可执行；它的虚拟文件系统路径只有 `narrow_python_runtime` 运行能证明。
