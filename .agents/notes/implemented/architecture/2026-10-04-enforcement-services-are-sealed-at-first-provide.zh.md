# Agent Note：执行点据以决策的服务在首次 provide 时被封存

Status: implemented

[English](2026-10-04-enforcement-services-are-sealed-at-first-provide.md) | 中文

## 问题

`pinTrustKernel` 原先只钉住 `trustKernel`。执行点从 `ctx.get('policy')` 取得决策，Cedar 引擎读取 `ctx.policySet`，风险闸门读取 `ctx.get('permissionPresets')`；这三者都是在钉住之后才挂载的普通插件。插件可以改写它们的 store 槽位、修改已提供的记录、删除槽位后再次提供该名字、遮蔽该属性，或卸载 provider 后在原处提供伪造品。kernel 会背书伪造引擎给出的 `permit`，而被伪造或被移除的风险策略会撤掉 hard-deny 区间与每一次审批（B-728；P2-05 acceptance[2]，P2-04 acceptance[1]-[2]）。

## 决定

- vendored Cordis 本地修改 23 增加一张按树划分的封存表。调用 `Fiber.sealOnProvide(names)` 之后，被封存的名字只从这张表解析：在 `ReflectService._getImpl` 中如此，在代理 `get` trap 中也如此，且先于自有属性、`props` accessor、fiber store 或 `internal/get` 监听器。它的首次 provide 会冻结并记录 `Impl`，之后的任何 provide 都会抛错。provider 卸载后，该名字变成墓碑，在进程重启之前解析为空。`Fiber.sealedServiceState` 在首次 provide 之前报告 `awaiting`，卸载之后报告 `tombstone`。
- `pinTrustKernel` 的最后一步是封存 `KERNEL_SEALED_SERVICES`（`policy`、`policySet`、`permissionPresets`），早于任何条目挂载。这份清单是固定的，因为哪些服务不许插件替换属于安全不变式。
- 若被封存的服务由 include 树中其 profile 行（`policy-engine`、`policy-language`、`permission`）之外的插件提供，`boot()` 会拒绝该树。行按 id 而不是按包匹配，因此部署仍可更改某一行的包或配置。
- 墓碑一律 fail closed。`enforceAction` 回答 `policy-unavailable`，并在审计 diagnostics 中写入 `POLICY_ROW_CHANGED`；引擎因所读的已封存策略集已卸载而抛错时也是如此。模型读到的拒绝会说明宿主必须重启。`permissionPresets` 为墓碑期间，`gateActionRisk` 以 `policy-row-changed` 拒绝每个调用；从未挂载它的组合仍然没有闸门。

## 考虑过的替代方案

- **像钉住 `trustKernel` 那样钉住这三个名字。** 它们的 provider 在钉住之后才从配置行挂载，钉住发生时还没有可钉的值。
- **每次决策时核对 provider 的身份。** 这一核对读取的正是它要保护的那个 store。
- **provider 卸载后重新接受 provide。** 插件就可以卸载真实行的 fiber，并在空档中提供伪造品。
- **把已卸载的 `permissionPresets` 当作从未挂载。** 权限插件只要重启一次，闸门就会 fail open。

## 后果

- 在线重载 `policy-engine`、`policy-language` 或 `permission` 行，或重载 `permission` 行注入的服务（`shell`、`approval`、`sessions`、`sessionProjections`），只在宿主重启后生效；在此之前每个动作都会被拒绝，并写明需要重启。不在线重载这些行的 profile 不受影响。在 `settings.yaml` 中编辑策略集只改变 `policySet.current()` 的返回值，不会再次提供任何服务，因此仍然在线生效。
- 被封存的名字未被提供时，用属性访问读取它会抛错，与不注入就读取未封存服务时一样。
- 未覆盖：同一 realm 中的插件仍可原地修改已提供的引擎对象或其原型。让插件之间彼此隔离对象属于 P1-06 的范围。
- 未覆盖：启动检查读取 `Fiber.entry`，这是一个可写字段，插件可以在提供被封存名字之前在自己的 fiber 上设置它。这同样属于 realm 内的修改，也在 P1-06 的范围之内。
