# Plugin Manifest v2

Declares capabilities, permissions, and side effects for plugins.

## Usage

```ts
import { validateManifest, compareDeclaredVsObserved } from '@deepseek-ai/dsh-plugin-manifest'

const result = validateManifest(manifest)
if (!result.valid) {
  console.error(result.errors)
}

const violations = compareDeclaredVsObserved(manifest, observedTools, observedNetwork)
```

## Validation Rules

- No wildcard permissions
- Tools must declare sideEffect and dataClassification
- External/irreversible tools require authAudience
- MCP servers require transport and auth for high-risk side effects
- Legacy v1 bundles marked as legacy-untrusted
