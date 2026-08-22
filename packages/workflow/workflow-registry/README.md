# @deepseek-ai/dsh-workflow-registry

Detached, saved, versioned, and nested workflow definitions registry.

## Overview

The Workflow Registry manages workflow definitions as signed artifacts:
- **Register**: Workflow definitions with version, script digest, budget limits
- **Bind**: Associate runs with specific definition versions
- **Nested**: Track nested workflow calls with recursion depth and budget attenuation
- **Cancel**: Propagate cancellation to all nested workflows
- **Resolve**: Find compatible versions by major version compatibility

## Key Invariants

- Circular workflow references are detected and rejected
- Child budget cannot exceed parent budget (attenuation)
- Recursion depth limited to MAX_RECURSION_DEPTH (10)
- Total agents and tokens across nested calls are bounded
- Definitions are content-addressed by SHA-256 digest

## Non-Goals

- No vertical domain logic
- No arbitrary code execution
- No direct workflow runtime execution
