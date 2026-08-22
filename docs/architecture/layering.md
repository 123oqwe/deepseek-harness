 # Layering Rules

 The Harness follows a strict layering order to prevent circular dependencies and uncontrolled coupling.

 ## Layer Order (top to bottom)

 1. **Surfaces/Apps** — CLI, Web, IDE, ACP, MCP, SDK clients
 2. **Orchestration/Runtime** — agent-loop, workflow, scheduler, taskboard
 3. **Capability Providers** — LLM adapters, shell, fs, sandbox, session persistence
 4. **Capability Definitions** — service definitions, types, protocol
 5. **Protocol/Types** — session events, SDK protocol, schema registry
 6. **Kernel** — trust kernel, identity, policy enforcement, audit
 7. **Utilities** — brand, invariants, home-paths (zero-dependency)

 ## Rules

 - Each layer may only depend on layers below it, never above.
 - Event types are a narrow shared dependency; they do not bypass layering.
 - No global singletons to circumvent the layer order.
 - The kernel layer never depends on product packages.
 - Capability providers never depend on apps or UI.
 - Consumers import from service definitions, not from provider implementations.
