# P1-01: Plugin Manifest v2

## Problem
The CLI installer forwards to pnpm and only checks dsh.bundle. Community entries have name/category/description but no permission declarations for production-grade least-privilege.

## Contract
- manifestVersion=2 with services, tools, skills, MCP, events, filesystem, network, process, secrets, UI, data stores, migrations, executionMode, compatibility
- Each tool declares sideEffect class, authAudience, allowedDestinations, dataClassification
- MCP servers declare transport, auth, networkDestinations, sideEffect
- Manifest must be static data (no code generation)
- Legacy v1 bundles read but marked legacy-untrusted, rejected in production

## Failure Semantics
- Missing manifest: install fails or enters quarantine
- Wildcard permissions: validation rejects
- Undeclared tool/network: blocking violation
- Missing transport/auth for MCP: validation rejects

## Compatibility
- New package: @deepseek-ai/dsh-plugin-manifest under packages/plugin/
- No existing packages modified
