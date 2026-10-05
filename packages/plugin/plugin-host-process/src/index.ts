/**
 * Epic P1-06 slice 2: the out-of-process Provider for the slice-1 plugin host
 * RPC seam. {@link spawnPluginHost} runs an untrusted plugin in its own Node
 * subprocess and attaches the host registration seam to its stdio, so the host
 * `Context`, services, credentials, and trust kernel are unreachable from the
 * plugin (process isolation plus a scrubbed environment); the plugin registers
 * tools only over the capability-scoped RPC, and its registrations are revoked
 * when its process exits. The companion `./child-runtime` module runs inside
 * that subprocess. Process-first isolates host capabilities, not the OS — OS
 * confinement of the child is the sandbox layer (P3-12 must[2]).
 * @module @deepseek-ai/dsh-plugin-host-process
 */

export { spawnPluginHost } from './host-process.ts'
export type { PluginHostProcessOptions } from './host-process.ts'
