/**
 * The in-subprocess runtime for an untrusted plugin (P1-06 slice 2, β). It is
 * deliberately NOT the harness boot: it builds a bare `Context` that exposes
 * ONLY a `tools` service whose `register` forwards over the capability-scoped
 * RPC, then loads the plugin entry and hands it that context. No filesystem,
 * shell, subprocess, credential, or trust-kernel service is mounted, so a
 * plugin running here has zero ambient host authority — its only channel to the
 * host is the RPC, where the host-side seam enforces every decision. The host
 * process launches this module (built under plain Node, from source through
 * tsx) with argv `[…, pluginEntry, manifestDigest]`.
 * @module @deepseek-ai/dsh-plugin-host-process/child-runtime
 */

import process from 'node:process'
import { Context, type Plugin } from '@deepseek-ai/cordis'
import { JsonRpcLineTransport } from '@deepseek-ai/dsh-sdk-protocol'
import { HOST_TO_PLUGIN, PLUGIN_TO_HOST, PROTOCOL_VERSION } from '@deepseek-ai/dsh-plugin-host-rpc'
import type { ToolRegistrationResult } from '@deepseek-ai/dsh-plugin-host-rpc'
import type { ToolDefinition, ToolRunContext, ToolRuntime } from '@deepseek-ai/dsh-tools'

const pluginEntry = process.argv[process.argv.length - 2] ?? ''
const manifestDigest = process.argv[process.argv.length - 1] ?? ''

const transport = new JsonRpcLineTransport(process.stdin, process.stdout)
const registeredTools = new Map<string, ToolDefinition>()
const inFlight = new Map<string, AbortController>()

/**
 * The only service the plugin's context exposes: a `register` that forwards the
 * tool as serializable data to the host and keeps the plugin's `execute`
 * locally to run when the host dispatches it back. Shaped as a `ToolRuntime`
 * for the plugin's typing; a plugin that calls any other `ToolRuntime` method
 * is outside slice 2's contract (§10c Known Limitation).
 */
const toolsService = {
  register(def: ToolDefinition): () => void {
    const registering = transport.request(PLUGIN_TO_HOST.registerTool, {
      name: def.name,
      description: def.description,
      parameters: def.parameters,
      outputSchema: def.output.schema,
      // A render function cannot cross the process boundary; the host renders
      // the plugin's canonical value with its own fixed projection (§10c).
      render: 'json',
      ...def.timeoutMs === undefined ? {} : { timeoutMs: def.timeoutMs },
      ...def.riskDomainTags === undefined ? {} : { riskDomainTags: def.riskDomainTags },
    }).then((result) => {
      const id = String((result as ToolRegistrationResult).registrationId)
      registeredTools.set(id, def)
      return id
    })
    return () => {
      void registering.then((id) => {
        registeredTools.delete(id)
        transport.notify(PLUGIN_TO_HOST.unregisterTool, { registrationId: id })
      })
    }
  },
}

transport.onRequest(async (method, params): Promise<unknown> => {
  if (method === HOST_TO_PLUGIN.invokeTool) {
    const registrationId = String(params.registrationId)
    const callId = String(params.callId)
    const def = registeredTools.get(registrationId)
    if (def === undefined) throw new Error(`plugin received tool.invoke for an unknown registration: ${registrationId}`)
    const controller = new AbortController()
    inFlight.set(callId, controller)
    // The plugin's execute runs here, in the child; it receives the model
    // arguments and a cancellation signal, never the host-stamped identity
    // (that is the host's and stays host-side).
    const exec = { callId, name: def.name, arguments: params.args, signal: controller.signal } as unknown as ToolRunContext
    try {
      return await def.execute(params.args, exec)
    } finally {
      inFlight.delete(callId)
    }
  }
  if (method === HOST_TO_PLUGIN.shutdown) {
    process.exit(0)
  }
  throw new Error(`plugin received an unexpected host-to-plugin method: ${method}`)
})

transport.onNotification((method, params): void => {
  if (method === HOST_TO_PLUGIN.cancelTool) inFlight.get(String(params.callId))?.abort()
})

async function main(): Promise<void> {
  transport.start()
  await transport.request(PLUGIN_TO_HOST.hello, {
    protocolVersion: PROTOCOL_VERSION,
    pluginName: 'untrusted-plugin',
    pluginVersion: '0.0.0',
    manifestDigest,
  })
  const childCtx = new Context()
  childCtx.provide('tools', toolsService as unknown as ToolRuntime)
  const loaded = await import(pluginEntry) as { readonly default?: unknown }
  await childCtx.plugin((loaded.default ?? loaded) as Plugin)
}

void main()
