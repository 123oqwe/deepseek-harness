---
description: "harness home 所属宿主用户的稳定标识符，使 harness 记录下的每个 action 命名一个真实行动者，而不是一个在使用点临时合成的行动者。"
kind: "package-reference"
---

# @deepseek-ai/dsh-host-user-id

[English](README.md) | 中文

## 概述

每一个 harness home 都有一个宿主用户——这个 `$DSH_HOME` 属于的那个人——本包提供命名他的标识符。出货启动会把它作为会话的 `UserPrincipal` 附着上去，于是 harness 记录的每个 action 都归属于那个人，工作区信任升级也才有一个"代其授权"的对象。这个值是一个随机 UUID，存放在 `$DSH_HOME/.host-user-id`（默认 `~/.dsh`）；首次使用时出现，跨重启保持稳定，删除文件则下次启动重新铸造。它**刻意不是**匿名遥测 id：那一个会被发送给接收方系统，这一个用来授权变更，正是为此分成两个文件。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

没有任何东西需要安装或配置：出货启动会解析并附着这个 id，值在 harness 第一次启动时出现。当你在写一条必须说明"谁在行动"的启动路径，或一个必须追问"当前行动者是不是宿主用户"的特性时，使用本包。

### 这个 id 为你做什么

- **每个 action 都命名一个行动者。** action manifest 记录它在哪个 principal 下运行。没有附着身份时，派发路径会合成一个以会话 id 命名的匿名 principal，而一份由这种记录组成的日志无法追溯到人。
- **信任升级有了授权者。** `/trust-skills` 与项目 instruction 的信任提问都会拒绝非宿主 principal，因此没有这个 id 时它们每次都拒绝。
- **记录跨启动对得上。** 同一个 home 明天仍是同一个宿主用户，于是上周授权的一次变更与今天授权的一次命名同一个人。

### 观察与重置

id 位于 `$DSH_HOME/.host-user-id`（默认 `~/.dsh`），是一个纯 UUID 文本文件。删除它，下次启动就成为一个新的宿主用户；正在运行的进程在退出前保持当前 id。不同的 harness home 是不同的宿主用户，且不会有任何机器或账户细节进入这个值。

### 在你自己的包里使用

```ts
import { getOrCreateHostUserId } from '@deepseek-ai/dsh-host-user-id'

const id = getOrCreateHostUserId() // stable for the process lifetime
```

该值在进程内稳定。即便 home 不可写，它对本次运行仍然可用，因此只读 home 上的启动不会被挡住——它只是作为一个每次启动都换 id 的宿主用户在跑。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内幕——点击展开</summary>

### 为什么这不是那个匿名遥测 id

`@deepseek-ai/dsh-anonymous-user-id` 在同一个 home 里铸造同一种值，复用它本是显而易见的做法。它基于测量被否决：那个 id 作为 `user` 字段搭在模型请求上、作为 OTel `user.id` 资源属性被导出、并被 `/feedback` 当面打印为 *"Anonymous user"*。它是一个**遥测主体**。这里的值是一个**授权主体**——信任升级据以授予的 `UserPrincipal.id`，以及审计轨迹所命名的行动者。一个 uuid 同时充当两者，就意味着一个部署发往遥测后端的值，正是它的审计轨迹用来指称"授权了这次变更的那个人"的值。同一机制、同一 home、两个文件、两种角色。

### 设计取向

- **随机，绝不派生。** `crypto.randomUUID()`；绝不取自 OS 用户名、主机名、网络地址或 git remote。OS 用户名属于展示范畴，不属于一个必须跨 home 不碰撞的标识符。
- **同步且记忆化。** 启动期消费者只用一套 API，一个进程只碰一次磁盘。
- **尽力持久化，并把后果说出来。** 不可写的 home 仍然产出可用的 id，启动因此继续；那次运行的 action 在运行内可追溯，但无法跨运行关联。
- **库，不是插件。** 没有 Cordis 入口、没有 config。不发布运行时不变量伴随包：本包只拥有一个私有 memo 与一个尽力而为的文件，没有独立观测可供比对——除非把创建 id 本身当作副作用。

### 源码地图

| 文件 | 角色 |
|---|---|
| [`src/index.ts`](src/index.ts) | 库入口：`getOrCreateHostUserId`、文件持久化、按路径记忆化 |
| — | 不发布运行时不变量伴随包，理由见上方设计取向。 |
| [`tests/host-user-id.spec.ts`](tests/host-user-id.spec.ts) | 被检验的行为：铸造、持久化、损坏、并发、记忆化，以及与遥测 id 的分离 |

### 存储契约

一行裸 UUID，文件名由 `HOST_USER_ID_FILE_NAME` 给出，读取时按 UUID 模式校验。首个写入者使用独占创建（`wx`）；并发的失败方重读并采纳胜者。损坏或不可读的文件落入"铸造并覆写"路径。记忆化以解析后的文件路径为键，因此不同的 home 永不共享 id。

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [identity 分组地图](../README.zh.md)——同组包与分组范围。
- [dsh-principal](../principal/README.zh.md)——`UserPrincipal`、委托链与 `isHostUserPrincipal`。
- [dsh-anonymous-user-id](../anonymous-user-id/README.zh.md)——本包刻意与之分离的那个遥测 id。
- [dsh-home-paths](../../util/home-paths/README.zh.md)——拥有 `$DSH_HOME` 与 `~/.dsh` 的解析。
- [dsh-workspace-trust-local](../../workspace/workspace-trust-local/README.zh.md)——把这个 principal 的授权持久化的 provider。

-----

<a id="model-experience"></a>
## 模型体验

### 宿主用户的标识符

#### 模型看到什么

什么也看不到。这个 id 不注册工具、不注入提示词、不进入任何请求字段。它改变的是记录在模型动作旁边的行动者——每条 `ActionManifest` 上的 `actor`，以及 `identity/attached` 会话事件——而模型从不读取它。

#### Token 影响

没有。本包产出的东西一样也不进入请求。

#### KV Cache 影响

没有。该值不在模型可见前缀里，因此无法使其失效。

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **删除后无法找回**——按设计，丢失文件会让下次启动成为另一个宿主用户；要能找回就需要稳定的派生素材，那会把标识符绑到机器上。
- **每个 home 一个宿主用户，而非每个 OS 账户**——共用一个 `$DSH_HOME` 的两个 OS 账户在这里是一个宿主用户，而一个账户配两个 home 就是两个。以 home 为作用域，是因为 home 才是 harness 所拥有的东西。
- **没有展示名**——这个值是 uuid，没有任何东西在它旁边渲染人类可读的名字。需要展示用户的界面需要一个，而本包不去发明它：一个没有读者的展示字段是一个无人维护的字段。
- **并发是尽力而为**——恰好落在另一进程"独占创建已成功、写入尚未完成"这段窄窗里的读者，本次运行会用另一个内存中的 uuid；之后的启动收敛到已持久化的值。
- **home 不可写不会被报告**——启动会带着一个仅限本次运行的 id 继续，而不是拒绝，并且没有任何东西告诉运维：这次运行的行动者与下次运行的不会是同一个。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>面向维护者的工作上下文——点击展开</summary>

本开发备注是面向维护者的工作上下文：尚未决定的开放问题。已出货行为与被接受的理由在上方各节。

#### 开放：哪些 root 附着

出货启动为本机宿主用户真正驱动的那一族 launcher 附着这个 id。ACP、SDK server 与 webhook ingress 刻意不附着：一个经由 socket 到达的请求不是本机的宿主用户，在那里附着会让远端调用方冒称他。那几条路径是否要有自己的身份、来自何处，不在这里裁定。

#### 开放：home 不可写大概应当出声

持久化是尽力而为，这对"不挡住启动"是对的，对"保持沉默"是错的。那条警告该落在哪里——本包、启动胶水、还是某个设置项诊断——尚未决定。

</details>
