# Execution World

First-class ExecutionWorld Capability Seam.

## World Types
- local: Local sandbox
- container: Container-based execution
- microvm: MicroVM-based execution
- remote: Remote execution provider
- browser: Browser-based execution

## Lifecycle
uninitialized -> created -> running <-> frozen -> destroyed

## Policy Dimensions
- FS: read/write paths
- Net: allowed destinations and ports
- Proc: allowed commands and shell
- IPC: allowed namespaces
- Device: allowed devices
