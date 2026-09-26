# Agent Note：webhook 创建的会话以其集成的 service principal 身份行事

Status: implemented

[English](2026-09-26-webhook-sessions-act-as-their-integration.md) | 中文

## 问题

BLOCKED-340；P2-01 acceptance[0] 要求任何 action 都能经完整委托链追溯到 root user 或租户。`dsh-webhook` 创建 Agent 时不带身份，于是 action 的 manifest 记的是一个匿名 actor（`anonymous:webhook-<uuid>`），也没有记录 `identity/attached`。lane A 的 A-421 经文档中的 GitHub review 补丁在 `web` profile 上量过（run 36198814967）。

## 决定

- **集成就是 principal。** Agent 以一个 `ServicePrincipal` 行事，其 id 为 `webhook:<kind>:<source>`。运行时只分派已验证的投递，而适配器用为该 source 配置的密钥验证每一次投递，所以 kind 与 source 指明了 HMAC 密钥所代表的集成；`kind` 用来区分两个提供方同名的 source。
- **不是提供方账号。** 触发事件的账号等载荷字段不参与：签名认证的是集成，而不是那个账号。
- **宿主用户的租户。** principal 在 `dsh-host-user-id` 的 `resolveTenantId` 返回的租户里签发（`$DSH_TENANT`，否则为 `local`），该包现在导出这个函数。因此，宿主用户恢复一个由 webhook 创建的会话时，给出的租户与会话记录的一致，这正是 `dsh-agent-loop` 的 `resolveSessionIdentity` 所要求的。
- **每个 Agent 一个 run。** 每个创建出的 Agent 都有新的 run id，以及一条以该 principal 为根的一跳委托链。会话只记录一次 kind 为 `service` 的 `identity/attached`，每个 action manifest 都以该 principal 为 actor。
- **只有宿主用户会被问是否信任工作区。** `dsh-agent-instructions` 曾为任何已挂载的 principal 提出工作区信任问题，而只有宿主用户能授予信任（`dsh-workspace-trust` 的 `isHostUserPrincipal`）。挂上集成之后，webhook 会话的第一步就停在这个问题上，无人作答（A-421 的修复轮，run 36227006417）。现在只为宿主用户提问，因此 webhook 会话不经询问、保持工作区未信任，与它没有身份时一样。

## 考虑过的替代方案

- **挂上宿主用户。** 请求来自经 HMAC 认证的远端发送方，而不是这台机器的用户（BLOCKED-291 (c)）。
- **按载荷里的提供方账号建 principal。** 那样会由未经认证的数据选定 actor。
- **每条规则一个 principal。** 规则是操作者安装的受信代码，不是凭据；认证该请求的密钥属于 source。

## 后果

- webhook 创建的会话，其 manifest 与审计记录中的 actor 是 `webhook:<kind>:<source>`，不再是匿名 actor。
- 在某个租户中运行的部署只需设置一次 `$DSH_TENANT`，宿主用户与其 webhook 集成都用它。
- 验证：lane A 的 A-421（`apps/cli/tests/profiles/web/tests/webhook-actor.e2e.ts`）、`dsh-webhook` 的 session spec、`dsh-host-user-id` 的 spec 与 `dsh-agent-instructions` 的 trust-ask spec。去掉身份挂载的变异 M-606-1 会让 A-421 的那条用例重新变红。
