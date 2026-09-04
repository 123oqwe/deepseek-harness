# Agent Note: Each workspace trust transition performs only its own direction

Status: implemented

[English](2026-09-04-workspace-trust-transition-direction.md) | 中文

## 问题

`@deepseek-ai/dsh-workspace-trust` 把 registry epic P1-07 命名的两个信任转换拆成两个函数:`requestTrustUpgrade` 在 must[2] 的宿主用户闸门下抬升 workspace 的 `TrustState`,并产出 must[2] 要求的审计记录;`downgradeTrust` 降低它,并算出这次降级究竟撤销了哪些 `ProjectContentKind`(acceptance[2])。两个函数都没有检查自己被要求执行的是哪个方向,而这两处遗漏组合起来,构成了一条完全绕开 must[2] 授权、抵达 `'trusted-execute'` 的路径。

`downgradeTrust` 原样写入 `target`。传入一个抬升方向的 `target` 时,它返回一条处于 `'trusted-execute'` 的记录,没有 `Principal`、没有 `isHostUserPrincipal` 检查、也没有 `TrustUpgradeAuditRecord` —— must[2] 的授权被 acceptance[2] 自己的入口绕过 —— 并且在这样做的同时报告 `revokedKinds: []`,这句话是真的,读起来却像无害。

`requestTrustUpgrade` 有镜像对称的同一处缺口,而正是这一半让前一半变得可用。它只闸住请求者是否宿主用户,随后同样原样写入 `target`,于是一个降低方向的 `target` 会产出 `upgraded: true`、一条描述降级的审计记录,以及最关键的一点:把 `grantedBy` 盖在一条 `'untrusted'` 记录上,而 `types.ts` 明确写着这种记录不携带授予者。那条记录恰好就是抬升方向的 `downgradeTrust` 调用随后提升到 `'trusted-execute'` 时所携带的陈旧授予者,于是最终状态看上去像是被一位真实宿主用户授权的 —— 而那位用户授权的是另一件事。

可达性,如实写明,使读者既不会得出"已存在实际利用"、也不会得出"纯属假想"。缺陷被发现时 `downgradeTrust` 没有任何生产调用方,因此不存在实际利用;这个修复关闭的是一个已发布的导出,而不是一起观测到的事故。`requestTrustUpgrade` 的降低路径当时可达、现在也可达:`WorkspaceEntity.upgradeTrust`(`packages/workspace/workspace/src/entity.ts`)把 `target` 原样透传,所以 `upgradeTrust(ws, 'untrusted', hostUser)` 确实会铸出那条"untrusted 却带授予者"的记录。一个不需要 principal、不做宿主用户检查、也不写审计记录就能抬升信任的状态机转换,无论今天谁调用它,都是已发布导出中的缺陷;而这个组合正是为什么单看任何一半都不构成这项发现。

## 决策

一个内部的 `TRUST_STATE_RANK`(`'untrusted'` 0、`'trusted-read'` 1、`'trusted-execute'` 2)为三个状态定序,使一个转换能与它的反方向区分开。`requestTrustUpgrade` 用新增的 `TrustUpgradeDenialReason` 成员 `'not-an-upgrade'` 拒绝任何不抬升 `current.state` 的 `target`。`downgradeTrust` 在 `target` 高于 `current.state` 时抛错。同状态的 `downgradeTrust` 调用仍被接受:它不授予任何能力,也不撤销任何东西。宿主用户检查仍排在最前,因此非 `'user'` principal 无论请求哪个方向,依旧以 `'non-host-principal'` 被拒。

两个函数都不是对方转换的第二个入口。抬升 workspace 的信任只属于 `requestTrustUpgrade` 这一个转换,并且不可能绕过 must[2] 的宿主用户检查与审计记录发生。

### 为什么两处拒绝的形态不同

`downgradeTrust` 抛错而 `requestTrustUpgrade` 返回拒绝;本仓库自己那条"并列值之间不得存在无解释的不对称"的规则意味着,这个理由必须在两个函数处都读得到,而不能只写在这份 Agent Note 里 —— 两个函数的 JSDoc 都写了它。

这处不对称是既有冻结面的后果,不是设计偏好。`TrustUpgradeResult` 本就是可辨识联合,其拒绝分支只是多一个 reason,通过返回值拒绝不付出任何代价。`TrustDowngradeResult` 则是一条普通记录,调用方直接读它的 `record` 与 `revokedKinds`;给它加拒绝分支意味着把它加宽成可辨识联合,而这会改变每个既有调用方所解构的类型。那是一次 Contract 变更,需要它自己的 re-freeze,不是一个 fault 阶段的缺陷修复可以不声明就拿走的。按相反方向消除这处不对称的选项仍然成立,代价即是上述这一项。

## 测试

`packages/workspace/workspace-trust/tests/trust.spec.ts` 覆盖两个方向:两条用例断言抬升方向的 `downgradeTrust` target 被拒 —— 其中一条呈递的正是另一半过去所铸造的"untrusted 却带授予者"记录,于是这个组合本身被钉住 —— 另有一条断言降低方向的 `requestTrustUpgrade` target 被拒,而不是被报告成一次升级。

真正承重的是第四条:任何一次拒绝都既不返回 `record` 也不返回 `audit`,并且是对每一个 `TrustUpgradeDenialReason` 断言,而不只对本次修复新增的那一个。前三条用例都能被"只修好自己点名的那个转换"的单点实现满足;这一条才是让日后新增的某个 reason 无法重新引入那条使组合成立的记录的原因。

两个方向都由变异证明。从 `downgradeTrust` 删去方向检查,恰好使它那两条用例变红,升级方向的用例保持绿;从 `requestTrustUpgrade` 删去方向检查,恰好使降低那条与"每一个 reason"那条变红,降级方向的用例保持绿。所有用例都是在手工构造的 `WorkspaceIdentity` 值上做纯计算 —— 没有 `fs.stat`、没有 `realpath`、没有临时目录 —— 因此没有任何一条会在 APFS 上通过而在 ext4 上为假,而本 epic 已经被这种分歧咬过一次。

## 已考虑的替代方案

**把 `TrustDowngradeResult` 加宽成拒绝联合,让两个函数以同样的方式拒绝。** 单就形态而言对称的那个更好,而且读到这处抛错的人第一反应就会想要它。它输在代价上,也输在对改动范围的诚实上:已冻结的 Contract 阶段用例直接读 `result.record.state` 与 `result.revokedKinds`,加宽会打断它们;一个 fault 阶段的修复若悄悄改写这些用例,就把一次缺陷修复变成了一次未经声明的 Contract 变更。此处与两个调用点都记下了这一点,以免下一位读者在没有支付 re-freeze 代价的情况下把它改成对称的。

**为抬升方向的降级抛错引入具名错误类,对齐兄弟包中 `WorkspaceMoveInvalidError` 的先例。** 作为无消费者的表面积驳回。这处抛错除消息外不携带任何调用方可分支的数据,也不存在正当的捕获—处理路径:要求 `downgradeTrust` 抬升信任是调用方的 bug,不是调用方可以从中恢复的策略结果。具名类会招来那种选择性捕获,而对一个"本不该发生"的不变量破坏来说,那是错误的信号。

**夹逼而非拒绝 —— 把抬升方向的降级静默当作空操作。** 直接驳回。它会让调用方以为转换发生过;更糟的是,它恰好在一个以撤销为目的的位置上,把与安全相关的失败变成不可见的。本仓库要求配置错误必须响亮地失败,而没有哪里比这里更需要如此。

**把方向检查排在宿主用户检查之前。** 保留既有顺序,驳回此项。非 `'user'` principal 无论请求哪个转换都因"它是谁"而被拒,这个事实无论它换成什么 `target` 重试都成立;先告诉它方向错了,只会诱使它重试一次,再被那条一直成立的理由拒掉。

## 后果

`requestTrustUpgrade` 的调用方要多处理一个 `TrustUpgradeDenialReason`。今天除该联合自己的测试外没有任何地方对它做穷尽 switch,且该成员是追加式的,因此没有既有调用方需要改动。

`downgradeTrust` 现在会抛错,而它的调用方此前可以假定它从不抛。它没有生产调用方,所以今天不发生任何变化,JSDoc 也带上了 `@throws`。日后若有调用方从自己并不掌控的状态机算出 `target`,就必须在调用之前而不是之后决定方向 —— 而这正是要点。

包的 README 曾把这个缺陷本身写作 Known Limitation(*"`requestTrustUpgrade` does not check that `target` raises trust… a host user may pass any `TrustState`"*),已在同一次改动中替换为现在被强制执行的规则。README 断言与代码相反的内容,正是本仓库"文档随代码一起更新"这条规则所要防的失效模式,而这一处描述的还是一项安全属性。

must[2] 余下的两半未被触碰,也不在本修复的覆盖范围内:宿主用户**交互**的接缝仍然不存在,`TrustUpgradeAuditRecord` 仍是无人追加的普通数据,等待 vendored Cordis `Fiber` 结构性修复([trust-kernel 边界](../../../../docs/architecture/trust-kernel-boundary.zh.md))。本修复让授权检查无法被绕过;它并没有让那份授权成为真的。
