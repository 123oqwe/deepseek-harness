 # Plugin Manifest v2

 A manifest declares what a plugin can access, expose, and modify before it is loaded. This enables installers, policy engines, and administrators to make production-grade least-privilege decisions.

 ## Schema

 | Field | Type | Required | Description |
 | --- | --- | --- | --- |
 | manifestVersion | 2 | yes | Must be 2 |
 | name | string | yes | Plugin name |
 | version | string | yes | Plugin version |
 | description | string | yes | Human-readable description |
 | services | ManifestService[] | yes | Declared services |
 | tools | ManifestTool[] | yes | Declared tools with side-effect and data classification |
 | mcpServers | ManifestMCPServer[] | no | MCP server declarations with transport and auth |
 | filesystem | FilesystemPermission[] | no | File access paths (no wildcards) |
 | network | NetworkPermission[] | no | Network destinations (no wildcards) |
 | process | ProcessPermission | no | Process permissions (no wildcards) |
 | secrets | SecretsPermission[] | no | Secret access (no wildcards) |
 | executionMode | ExecutionMode | yes | in-process, worker-thread, or out-of-process |
 | compatibility | object | yes | minHarnessVersion, maxHarnessVersion |

 ## Side-Effect Classification

 | Class | Description |
 | --- | --- |
 | none | Read-only, no external state change |
 | local-write | Writes to local filesystem within workspace |
 | network | Makes network requests |
 | process | Spawns or manages processes |
 | external | Modifies external systems (APIs, databases, payments) |
 | irreversible | Cannot be undone (e.g., real payment) |

 ## Legacy v1 Compatibility

 Old `dsh.bundle` plugins are read as legacy-untrusted. Production profiles reject them by default.

 ## Validation

 - Wildcard permissions (`*`, `/*`, `**`) are rejected
 - Tools must declare sideEffect and dataClassification
 - External/irreversible tools must declare authAudience
 - MCP servers must declare transport
 - MCP servers with external/irreversible side effects require auth
 - Declared vs observed comparison detects undeclared tools and network destinations
