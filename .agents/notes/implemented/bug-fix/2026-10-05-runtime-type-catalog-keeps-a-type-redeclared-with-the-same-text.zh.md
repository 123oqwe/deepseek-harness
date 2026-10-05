# Agent Note: 运行时类型目录保留文本相同的重复声明

Status: implemented

[English](2026-10-05-runtime-type-catalog-keeps-a-type-redeclared-with-the-same-text.md) | 中文

## Problem

`cordis_inspect` 把服务与事件签名引用到的类型形状交给模型，数据来自 `gen-cordis-catalog` 写入的 `packages/extensions/tool-cordis/src/api-catalog.ts`。生成器把在不止一个包源文件里声明过的类型名一律判为有歧义并删掉。`@deepseek-ai/dsh-approval-store` 重新声明了 `SessionId`、`RunId`、`TenantId`、`PrincipalId` 这几个品牌类型，好让它的契约不依赖这些类型的属主包。它合入之后，目录里就没了这几条声明，而目录仍在提供的 `ServicePrincipal`、`ApprovalViewer` 等形状还在引用它们。`cordis-inspect-jsdoc` 录制会话发现了这一变化。

## Decision

- `runtimeTypes`（`packages/typert/generator/src/cordis-catalog.ts`）比较分析器去掉注释后打印的声明文本。同一个名字多次打印成相同文本，就是同一个类型，留在目录里；打印成不同文本，仍判为有歧义并删掉。
- `@deepseek-ai/dsh-approval-store` 保留它重新声明的品牌类型。
- 重新生成的目录加回九条声明，没有删掉任何一条：`ApprovalRequestId`、`ArtifactRef`、`PrincipalId`、`RunId`、`SessionId`、`SessionTitleProviderId`、`TenantId`、`TypertFace`、`WorkerId`。`cordis-inspect-jsdoc` 录制里 `Service.listService` 的结果因此还列出 `TenantId` 与 `WorkerId`，恢复的声明引用了它们。

## Alternatives considered

- **在 approval-store 里从属主包导入这些品牌类型。** 这会让一个本不该依赖它们的契约包依赖 `@deepseek-ai/dsh-session` 与 `@deepseek-ai/dsh-principal`；而且 `ApprovalRequestId` 不能从 `@deepseek-ai/dsh-user-approval` 导入，因为后者依赖 approval-store。
- **按缺了声明的输出重新录制快照。** 模型会继续看到引用了目录里没有声明的类型的形状。

## Consequences

- 一个包可以重新声明属主包声明的品牌类型，只要两处声明打印出的文本相同，`cordis_inspect` 就仍能看到这个品牌类型。
- 两个包导出同一个名字而形状不同时，这个名字仍不进目录。
