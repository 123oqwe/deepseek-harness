# Agent Note：出厂 profile 挂上已保存 workflow 的加载器，定义只有签名核验通过才加载

Status: implemented

[English](2026-10-03-saved-workflows-load-only-when-signed.md) | 中文

## 问题

没有任何出厂 profile 挂 `@deepseek-ai/dsh-workflow-filesystem`，而这个加载器是引擎 `registerDefinition` 在出厂代码里唯一的调用方，所以在出厂产品上 `workflow({ name, digest })` 什么都解析不到，P4-09 的保存、加载、嵌套只有包级的证据。加载器还会登记它读到的每个文件：digest 从文件本身算，signer 记它自己，没有任何东西核验定义是谁写的。用户在 2026-10-03 选了第 31 题的 (a)：在出厂 base 层挂上这个加载器，加载时核签名与 digest（acceptance[0]「保存/加载不会执行未验证代码」）。

## 决定

- `packages/bundle/base/cordis.patch.yml` 在工作流引擎之后挂上加载器；base bundle、CLI 应用与 Python SDK 运行时都把它声明为依赖。cordis、ptc、standard 三个预设也把它挂在各自的引擎旁边，放在隔离 `workflowEngine` 的那一组里；Web 应用的宿主补丁像关掉引擎那一行一样，关掉 base 里的这一行。
- 每个定义文件旁边放 `<file>.sig.json`，内容是定义的 digest、签名密钥的指纹，以及对 digest 的 UTF-8 字节做的签名（base64）。以下情况加载器都拒绝：签名文件缺失（`unsigned`）；它写明的 digest 不是读到的字节算出的那个（`digest-mismatch`）；没有钉住 Trust Kernel，或者 kernel 的 offline-signed 锚里没有那个指纹（`no-trust-anchor`）；文件不是签名，或者签名用那个锚的公钥核验不过（`signature-invalid`）。拒绝会记在 `ctx.savedWorkflows.refused` 上、写进日志，并指向包的 README。核验通过的定义登记时把锚的 owner 记为 signer。
- 锚就是 profile 的 `dsh.trustAnchors`，启动时本来就交给了 Trust Kernel；加载器用 `configuredTrustAnchors` 读它们。
- 签名核验用的是 P1-02 的 `checkOfflineSignature`，现在从 `@deepseek-ai/dsh-plugin-provenance` 导出，参数从包声明改成被签的字节，所以仓库里只有一份离线核验。

## 考虑过的替代方案

- **用 Trust Kernel 自己的密钥签名。** 这把密钥每个进程现生成，这次启动保存的定义下次启动就核验不了。
- **在 Trust Kernel 里加一个核验函数。** P0-02 冻结的 runtime-surface 用例列死了 kernel 的值导出，加一个就要写取代，而 P1-02 的函数已经能做这件事。
- **不挂加载器，把 P4-09 的主语收窄为发布的包（第 31 题 (b)）。** 用户选了 (a)。

## 后果

- 出厂 profile 在运维配置 offline-signed 锚并给定义签名之前，不会加载任何已保存的 workflow；每个被拒的定义都写进日志。
- 冻结的加载器用例（P4-09 U，`saved-workflows.spec.ts`）标题与断言不变；夹具改为给每个定义签名，并钉住一个锚里有测试密钥的 kernel。
- Sigstore 锚不能核验已保存的定义。
