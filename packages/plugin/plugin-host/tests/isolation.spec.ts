import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { spawnPlugin, crashPlugin, terminatePlugin, getPlugin, isIsolated, clearPlugins, sendRequest, clearPending, type PluginHostConfig } from '../src/index.ts'

const config: PluginHostConfig = { pluginId: 'test-plugin', maxMemory: 128, maxCpu: 50, timeout: 30000, isolated: true }

describe('P1-06 Out-of-Process Plugin Host', () => {
  beforeEach(() => { clearPlugins(); clearPending() })
  afterEach(() => { clearPlugins(); clearPending() })

  it('spawns an isolated plugin', () => {
    const plugin = spawnPlugin(config)
    expect(plugin.state).toBe('running')
    expect(isIsolated('test-plugin')).toBe(true)
  })

  it('crashes a plugin', () => {
    spawnPlugin(config)
    const crashed = crashPlugin('test-plugin', 'segfault')
    expect(crashed.state).toBe('crashed')
  })

  it('terminates a plugin', () => {
    spawnPlugin(config)
    const terminated = terminatePlugin('test-plugin')
    expect(terminated?.state).toBe('terminated')
  })

  it('getPlugin returns the plugin', () => {
    spawnPlugin(config)
    const plugin = getPlugin('test-plugin')
    expect(plugin).toBeDefined()
    expect(plugin!.config.maxMemory).toBe(128)
  })

  it('sendRequest returns response', async () => {
    const resp = await sendRequest({ id: 'req-1', type: 'call', method: 'test', args: [] })
    expect(resp.ok).toBe(true)
    expect(resp.result).toBeDefined()
  })

  it('crash does not affect other plugins', () => {
    spawnPlugin(config)
    spawnPlugin({ ...config, pluginId: 'plugin-2' })
    crashPlugin('test-plugin', 'crash')
    const other = getPlugin('plugin-2')
    expect(other?.state).toBe('running')
  })
})
