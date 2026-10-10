/**
 * The out-of-process Provider for the P1-06 slice-1 RPC seam: spawn one
 * untrusted plugin in its own Node subprocess, wire its stdio to a
 * line-delimited JSON-RPC transport, and attach the host registration seam.
 * The child is a separate OS process, so the host `Context`, its services,
 * credentials, and the trust kernel are structurally unreachable from the
 * plugin (m2 by process boundary); the subprocess provider scrubs credentials
 * and `DSH_*` from the child's environment on top of that. When the child
 * exits — normally, on crash, or on termination — the session's registrations
 * are revoked (m3 / RF4), since a plugin's tools must not outlive its process.
 * @module @deepseek-ai/dsh-plugin-host-process/host-process
 */

import process from 'node:process'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-subprocess'
import { JsonRpcLineTransport } from '@deepseek-ai/dsh-sdk-protocol'
import { attachPluginRpcHost } from '@deepseek-ai/dsh-plugin-host-rpc'
import type { FrameLimits, PluginSessionId } from '@deepseek-ai/dsh-plugin-host-rpc'

/** Everything the out-of-process host needs for one plugin session. */
export interface PluginHostProcessOptions {
  /** Absolute path (or resolvable specifier) of the plugin's entry module the child imports. */
  readonly pluginEntry: string
  /** The tool names the plugin's trusted, locked manifest declares — never anything the plugin itself influences. */
  readonly declaredTools: readonly string[]
  /** The manifest digest `host.hello` must present to be admitted. */
  readonly expectedManifestDigest: string
  /** The plugin-session id the host minted for this plugin process. */
  readonly sessionId: PluginSessionId
  /** Working directory for the child. */
  readonly cwd: string
  /** Termination grace for the child, in milliseconds. */
  readonly graceMs: number
  /** Inbound-frame and registration bounds. */
  readonly limits: FrameLimits
}

/** True when this module runs from source (`.ts`), so the child must be launched through tsx. */
const FROM_SOURCE = import.meta.url.endsWith('.ts')

/**
 * The argv to spawn the child runtime: through tsx from source, under plain
 * Node when built. The child reads `[…, pluginEntry, manifestDigest]`.
 */
function childArgv(pluginEntry: string, manifestDigest: string): readonly string[] {
  if (!FROM_SOURCE) {
    return [process.execPath, fileURLToPath(new URL('./child-runtime.js', import.meta.url)), pluginEntry, manifestDigest]
  }
  return [
    process.execPath,
    '--import',
    import.meta.resolve('tsx/esm'),
    fileURLToPath(new URL('./child-runtime.ts', import.meta.url)),
    pluginEntry,
    manifestDigest,
  ]
}

/**
 * Spawn the plugin's subprocess and attach the host RPC seam to it.
 * @param ctx - the host context providing `subprocess` and `tools`.
 * @param options - the plugin entry, the trusted manifest facts, the session id, and the frame limits.
 * @returns a disposer that revokes the session's registrations and terminates the child; idempotent.
 * @throws when the host composes no `subprocess` service, or the provider did not pipe the child's stdio.
 */
export function spawnPluginHost(ctx: Context, options: PluginHostProcessOptions): () => void {
  const subprocess = ctx.get('subprocess')
  if (subprocess === undefined) {
    throw new Error('@deepseek-ai/dsh-plugin-host-process requires the subprocess service')
  }
  const handle = subprocess.spawn({
    argv: childArgv(options.pluginEntry, options.expectedManifestDigest),
    cwd: options.cwd,
    stdio: { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' },
    graceMs: options.graceMs,
  })
  const { stdin, stdout } = handle
  if (stdin === undefined || stdout === undefined) {
    handle.terminate()
    throw new Error('@deepseek-ai/dsh-plugin-host-process: the subprocess provider did not pipe the child stdio')
  }
  const transport = new JsonRpcLineTransport(stdout, stdin)
  const disposeHost = attachPluginRpcHost(ctx, {
    transport,
    declaredTools: options.declaredTools,
    expectedManifestDigest: options.expectedManifestDigest,
    sessionId: options.sessionId,
    limits: options.limits,
  })
  transport.start()
  return () => {
    disposeHost()
    handle.terminate()
  }
}
