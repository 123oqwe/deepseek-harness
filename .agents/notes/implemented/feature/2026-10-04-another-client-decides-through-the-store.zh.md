# Agent Note：另一个客户端经由存储判定

Status: implemented

[English](2026-10-04-another-client-decides-through-the-store.md) | 中文

## 问题

Epic P2-07 的 validation[1] 要求两个客户端判定同一项审批时只留下一个终态。U1a 之后，另一个客户端经由存储判定了某项审批时，询问方仍在等待；它自己稍后的转移写的是转移前刚读到的修订号，所以一个迟到的 `cancelled` 可能撤销另一个客户端已经批准的审批。

## 决定

- **存储会宣布。** 每个 provider 在每次记录审批、每次接受转移之后都发出 `approval-store/changed`，被拒的转移不发；契约把它写成 provider 的义务。
- **询问方自己的转移写的是记录时的修订号。** 此后有别的转移时它会以 `stale-revision` 被拒，询问按存储中的状态结算：approved 为 `allowed-once`，denied 为 `rejected`，其余为 `cancelled`。判定方之间的竞争与至多一次的消费是两个独立的比较并交换（delegate 的裁定，2026-10-04）。
- **等待中的询问会被撤回。** `ApprovalService` 保留一个监听器，并按审批 id 记着等待中的询问；等待中的审批一旦被转移，它的应答者看到的信号就会中止，还显示在屏幕上的提示随之撤下。
- **只在进程内。** 另一个进程在共享存储中做出的转移在下次读取时才看得到；不做轮询。
- **SDK 以宿主用户身份列出与判定。** `approval/list` 与 `approval/decide` 使用 `manifestAttribution` 为服务端各会话所代表的宿主用户身份给出的查看者，与派发消耗时用的是同一个来源，所以以该用户重连的客户端能列出自己的待决审批；`sessionId` 只是收窄列表，不是访问边界。其他租户的审批答 `not-found`，绝不答 `other-tenant`。
- **`approval.changed` 需要申请。** 声明现有 `approval` 能力的客户端会收到本连接租户每一项被记录或转移的审批，`sessionId` 位于顶层，按会话订阅也能收到。两个方法与这个通知加入请求表、通知表和带指纹的协议面；审批类型不进 schema registry，与 `ShutdownRequest` 相同（delegate 的裁定，2026-10-04）。

## 考虑过的替代方案

- **询问等待期间轮询这一行。** 为进程内事件已经覆盖的情形给每次询问加一个定时器。
- **即使另一个客户端赢了也记录应答者的结果。** 会话日志会因此与存储不一致，只剩消费这一道防线。

## 后果

- 由于 SDK 服务端经由同一个存储判定，SDK 客户端的判定会结算进程内的询问。
- 协议指纹随之改变，P8-01 的黄金夹具钉上新值。
- dsh-base 的 Manifest v2 声明了它的审批服务所监听的事件。
