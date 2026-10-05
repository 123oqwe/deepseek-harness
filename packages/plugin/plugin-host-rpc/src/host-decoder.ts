/**
 * The Provider role: bind one plugin's transport, decode and validate every
 * inbound frame at the process boundary, and drive the session lifecycle. A
 * fail-closed refusal (version/manifest mismatch, an undeclared tool, or an
 * invalid payload) closes the session rather than continue with a plugin whose
 * declared and actual behavior disagree. Every accepted `tools.register`
 * becomes a host registration whose disposer this host holds; the returned
 * disposer revokes them all and closes the transport, so the plugin session's
 * teardown (slice 2 binds it to the session scope) leaves no live registration.
 * @module @deepseek-ai/dsh-plugin-host-rpc/host-decoder
 */

import type { Context } from '@deepseek-ai/cordis'
import { FAIL_CLOSED_CODES, PLUGIN_TO_HOST, PluginRpcError, validateHello, validateToolRegistration } from './protocol.ts'
import { registerProxyTool } from './registration-consumer.ts'
import type { PluginHostState, PluginRpcHostOptions, RegistrationId, ToolRegistrationResult } from './types.ts'

/**
 * Attach the host to one plugin session's transport and return the session
 * disposer.
 * @param ctx - the host context providing the `tools` service.
 * @param options - the transport, the installed manifest facts, the session id, and the stamped identity.
 * @returns a disposer that revokes every registration this session made and closes the transport; idempotent.
 */
export function attachPluginRpcHost(ctx: Context, options: PluginRpcHostOptions): () => void {
  const { transport, declaredTools, expectedManifestDigest, sessionId, principal, capability, limits } = options
  let state: PluginHostState = 'handshaking'
  let nextRegistration = 0
  const disposers = new Map<RegistrationId, () => void>()

  const close = (): void => {
    if (state === 'exited') return
    state = 'exited'
    for (const dispose of disposers.values()) dispose()
    disposers.clear()
    transport.close()
  }

  const handle = (method: string, params: Record<string, unknown>): unknown => {
    switch (method) {
      case PLUGIN_TO_HOST.hello: {
        if (state !== 'handshaking') throw new PluginRpcError('INVALID_PAYLOAD', 'host.hello already completed')
        validateHello(params, expectedManifestDigest)
        state = 'ready'
        return { sessionId, grantedTools: declaredTools, grantedEvents: [] }
      }
      case PLUGIN_TO_HOST.registerTool: {
        if (state !== 'ready') throw new PluginRpcError('HOST_UNAVAILABLE', 'tools.register before the host is ready')
        if (disposers.size >= limits.maxRegistrations) throw new PluginRpcError('INVALID_PAYLOAD', 'tools.register exceeds the registration limit')
        const registration = validateToolRegistration(params, declaredTools, limits.maxFrameBytes)
        const registrationId = `reg_${nextRegistration++}` as RegistrationId
        const dispose = registerProxyTool(ctx, registration, { transport, registrationId, principal, capability })
        disposers.set(registrationId, dispose)
        const result: ToolRegistrationResult = { registrationId }
        return result
      }
      case PLUGIN_TO_HOST.unregisterTool: {
        const { registrationId } = params
        if (typeof registrationId !== 'string') throw new PluginRpcError('INVALID_PAYLOAD', 'tools.unregister requires a registrationId')
        const dispose = disposers.get(registrationId as RegistrationId)
        if (dispose === undefined) throw new PluginRpcError('INVALID_PAYLOAD', 'tools.unregister cites an unknown registration')
        dispose()
        disposers.delete(registrationId as RegistrationId)
        return {}
      }
      default:
        // Slice 1's plugin→host allow-list is the handshake and tool methods;
        // events and UI are later slices. Any other method is a protocol
        // violation, which is fail-closed.
        throw new PluginRpcError('INVALID_PAYLOAD', `method is not in the plugin-to-host allow-list: ${method}`)
    }
  }

  transport.onRequest((method, params): Promise<unknown> => {
    try {
      return Promise.resolve(handle(method, params))
    } catch (error) {
      if (error instanceof PluginRpcError && FAIL_CLOSED_CODES.has(error.data.code)) {
        // Close after the refusal response is written: `close()` detaches the
        // input listeners and disposes registrations but never destroys the
        // output stream, so the transport still writes this error frame.
        queueMicrotask(close)
      }
      return Promise.reject(error instanceof Error ? error : new Error(String(error)))
    }
  })

  transport.onNotification((method): void => {
    // Slice 1 accepts only `log` as a notification, and it reaches the host log
    // alone — plugin text never decides a control-flow outcome. Any other
    // notification is dropped (a notification has no response channel to refuse on).
    if (method !== PLUGIN_TO_HOST.log) return
  })

  return close
}
