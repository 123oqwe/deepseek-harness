# Agent Note: The runtime type catalog keeps a type redeclared with the same text

Status: implemented

English | [中文](2026-10-05-runtime-type-catalog-keeps-a-type-redeclared-with-the-same-text.zh.md)

## Problem

`cordis_inspect` gives the model the type shapes its service and event signatures reference, from the catalog `gen-cordis-catalog` writes to `packages/extensions/tool-cordis/src/api-catalog.ts`. The generator dropped every type name declared in more than one package source file as ambiguous. `@deepseek-ai/dsh-approval-store` redeclares the `SessionId`, `RunId`, `TenantId` and `PrincipalId` brands so that its contract depends on none of their owning packages. Once it landed, the catalog lost those declarations while `ServicePrincipal`, `ApprovalViewer` and other shapes it still served referenced them. The `cordis-inspect-jsdoc` recorded session caught the change.

## Decision

- `runtimeTypes` (`packages/typert/generator/src/cordis-catalog.ts`) compares the declaration text the analyzer prints with comments removed. A name printed to the same text more than once is one type and stays in the catalog; a name printed to different texts is still ambiguous and dropped.
- `@deepseek-ai/dsh-approval-store` keeps its redeclared brands.
- The regenerated catalog adds nine declarations and removes none: `ApprovalRequestId`, `ArtifactRef`, `PrincipalId`, `RunId`, `SessionId`, `SessionTitleProviderId`, `TenantId`, `TypertFace` and `WorkerId`. The `cordis-inspect-jsdoc` recording's `Service.listService` result now also lists `TenantId` and `WorkerId`, which the restored declarations reference.

## Alternatives considered

- **Import the brands in approval-store from their owners.** It makes a contract package meant to depend on neither depend on `@deepseek-ai/dsh-session` and `@deepseek-ai/dsh-principal`, and `ApprovalRequestId` cannot come from `@deepseek-ai/dsh-user-approval`, which depends on approval-store.
- **Re-record the snapshot with the declarations missing.** The model would keep seeing shapes that reference types the catalog does not declare.

## Consequences

- A package may redeclare a brand its owner declares without hiding the brand from `cordis_inspect`, as long as both declarations print to the same text.
- When two packages export one name with different shapes, the name still stays out of the catalog.
