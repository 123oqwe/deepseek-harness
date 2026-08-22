import { randomUUID } from 'node:crypto'
import type { PluginHostConfig } from '../../plugin-host-protocol/src/types.ts'

interface HostedPlugin {
  readonly processId: string
  readonly config: PluginHostConfig
  readonly state: 'starting' | 'running' | 'crashed' | 'terminated'
  readonly startedAt: string
}

const plugins = new Map<string, HostedPlugin>()

export function spawnPlugin(config: PluginHostConfig): HostedPlugin {
  const plugin: HostedPlugin = {
    processId: randomUUID(),
    config,
    state: 'running',
    startedAt: new Date().toISOString(),
  }
  plugins.set(config.pluginId, plugin)
  return plugin
}

export function crashPlugin(pluginId: string, _reason: string): HostedPlugin {
  const plugin = plugins.get(pluginId)
  if (!plugin) throw new Error(`Plugin not found: ${pluginId}`)
  const crashed: HostedPlugin = { ...plugin, state: 'crashed' }
  plugins.set(pluginId, crashed)
  return crashed
}

export function terminatePlugin(pluginId: string): HostedPlugin | undefined {
  const plugin = plugins.get(pluginId)
  if (!plugin) return undefined
  const terminated: HostedPlugin = { ...plugin, state: 'terminated' }
  plugins.set(pluginId, terminated)
  return terminated
}

export function getPlugin(pluginId: string): HostedPlugin | undefined {
  return plugins.get(pluginId)
}

export function isIsolated(pluginId: string): boolean {
  return plugins.get(pluginId)?.config.isolated ?? false
}

export function clearPlugins(): void {
  plugins.clear()
}
