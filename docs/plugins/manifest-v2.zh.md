# Plugin Manifest v2

[English](manifest-v2.md) | 中文

Plugin Manifest v2(Epic P1-01)是插件包在 `package.json` 的 `dsh` 字段下携带的静态能力声明,让安装器、Policy 引擎或管理员在插件执行前就知道它能访问什么、暴露什么、修改什么。本页说明该格式的字段与规则;类型契约与校验逻辑位于 [`@deepseek-ai/dsh-plugin-manifest`](../../packages/plugin/plugin-manifest/README.zh.md),线上 schema 为 [`spec/capability-manifest.schema.json`](../../spec/capability-manifest.schema.json)(JSON Schema,draft 2020-12)。

## manifest 存放位置

`package.json` 的 `dsh` 字段已经携带两种形态:`dsh.profile`(一个 profile 的组合包列表)与 `dsh.bundle`(组合包的 `cordis.patch.yml` 指针——参见 [`architecture.md#profiles-and-bundles`](../architecture.zh.md#profiles-and-bundles))。Plugin Manifest v2 声明是第三种形态,`dsh.manifestVersion === 2`,是对前两者的附加(而非替代):一个包可以在拥有组合包 patch 的同时携带 manifest。

```jsonc
{
  "dsh": {
    "manifestVersion": 2,
    "tools": [ /* … */ ],
    "executionMode": "in-process",
    "compatibility": { "dshVersionRange": ">=0.1.0 <1.0.0" }
  }
}
```

## 字段

`executionMode` 与 `compatibility` 始终存在;其余每个字段都是插件只在自己确实拥有该类能力时才包含的数组或对象——字段缺失意味着"未声明此类能力",而非"未知"。

| 字段 | 声明内容 |
|---|---|
| `services` | 本插件提供或依赖的 Cordis Service Definition/Provider/Consumer,以 `ctx` 键表示 |
| `tools` | 本插件注册的模型侧或用户侧工具,各自携带下文的副作用字段 |
| `skills` | 本插件贡献的 skill,按 `@deepseek-ai/dsh-skill` 的 `SKILL_NAME` 语法以 kebab-case 命名 |
| `mcp` | 本插件连接的 MCP server,以及各 server 的 resource 与 prompt |
| `events` | 本插件发出或拦截的 Cordis 事件,使用 `@deepseek-ai/cordis` 自身的 `DispatchMode` |
| `filesystem` | 本插件读写的路径模式,独立于任何单个 tool 自身的声明 |
| `network` | 本插件可达的主机模式,独立于任何单个 tool/MCP 声明 |
| `process` | 本插件可能启动的命令模式,独立于任何单个 tool 声明 |
| `secrets` | 本插件申请的凭据,含 key 与申请理由 |
| `uiSurfaces` | 本插件贡献的宿主渲染 UI 界面 |
| `dataStores` | 本插件拥有的具名存储域 |
| `migrations` | 本插件数据存储所需的 schema 迁移步骤 |
| `executionMode` | 本插件自身代码的执行方式:`'in-process'`、`'worker-thread'`、`'process'` 或 `'container'` |
| `compatibility` | 本 manifest 适用的 harness 版本范围 |

## 每个 Tool/MCP capability 声明四个副作用字段

`tools` 中的每一项、`mcp.servers` 中的每个 MCP server,以及 `skills[].remoteProvider` 中每个远程来源的条目,都声明:

- **`sideEffectClass`**——`'none'`、`'read'`、`'write'`、`'network'`、`'process'` 或 `'destructive'`,取适用的最高影响等级。
- **`authAudience`**——谁可以在不经过额外逐次调用确认的情况下调用它:`'model'`(自主工具调用)、`'user'`(必须由人类发起或确认)、`'service'`(仅限 harness 内部)。至少一个 audience。
- **`allowedDestinations`**——它可能触达的文件系统路径、网络主机或进程命令。Tool 的列表可以为空(纯计算不触达任何目标);MCP server 或远程 Skill Provider 的列表不可为空——远程 provider 总会连接到某处,因此空列表本身就是未声明网络目标。
- **`dataClassification`**——`'public'`、`'internal'`、`'confidential'` 或 `'secret'`,它可能读取、产生或传输的数据敏感度。

MCP server 与远程来源的 skill provider 还额外声明 `transport`(`'stdio'` 或 `'streamable-http'`,对照 `@deepseek-ai/dsh-mcp-client` 真实的 transport 联合类型)与 `authMechanism`(`'none'`、`'header-credential'`、`'oauth'` 或 `'mtls'`)。

## 必须是静态数据,而非生成的代码

manifest 是嵌入在 `package.json` 中的字面 JSON;读取它的过程不会 import、`require`,或以任何方式执行插件包自身的代码。`@deepseek-ai/dsh-plugin-manifest` 的校验器会拒绝携带函数、`symbol`,或数组内嵌 `undefined` 的值——这三种情况都无法在 `JSON.parse` 中幸存,它们的出现证明该值是通过执行代码构建的,而非解析文件得到。

## 旧版 `dsh.bundle` 兼容

只携带既有 `dsh.bundle` 格式(没有 `dsh.manifestVersion`)的包仍会被读取,但分类为 `'legacy-untrusted'`:旧格式完全不声明任何能力,只有一个 patch 文件指针,因此没有可信任的声明权限面。生产 profile 默认拒绝 `'legacy-untrusted'` 或 `'missing'` 声明。

## 通配权限

目标模式若精确等于 `'*'`、`'**'` 或 `'/'`,即对其种类而言是最大化的宽泛授权,会被标记为通配权限申请——这是安装器"缺失、通配或声明/观测不一致即隔离"这一门禁中,schema/类型表面可检测的那一半;安装器决策本身是后续阶段的运行时职责。
