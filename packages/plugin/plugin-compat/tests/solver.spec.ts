 import { describe, it, expect } from 'vitest'
 import { solve, type PluginCompatDecl } from '../src/index.ts'

 const compatiblePlugin: PluginCompatDecl = {
   pluginId: 'plugin-a',
   runtimeApiRange: { min: '0.1.0', max: '1.0.0' },
   schemaRanges: { 'session-event': { min: '0.1.0', max: '1.0.0' } },
   requiredCapabilities: [],
   optionalCapabilities: [],
   providedCapabilities: ['fs:read'],
   providerConstraints: {},
 }

 describe('P1-08 Plugin Compatibility Solver', () => {
   it('solves a compatible set', () => {
     const result = solve([compatiblePlugin])
     expect(result.satisfiable).toBe(true)
     expect(result.conflicts).toHaveLength(0)
   })

   it('detects runtime API mismatch', () => {
     const result = solve([
       compatiblePlugin,
       { ...compatiblePlugin, pluginId: 'plugin-b', runtimeApiRange: { min: '2.0.0', max: '3.0.0' } },
     ])
     expect(result.satisfiable).toBe(false)
     expect(result.conflicts.some(c => c.type === 'runtime_api_mismatch')).toBe(true)
   })

   it('detects missing required capability', () => {
     const result = solve([
       { ...compatiblePlugin, pluginId: 'plugin-b', requiredCapabilities: ['nonexistent:cap'] },
     ])
     expect(result.satisfiable).toBe(false)
     expect(result.unsatCore).toContain('plugin-b')
   })

   it('detects provider constraint conflict', () => {
     const result = solve([
       { ...compatiblePlugin, pluginId: 'plugin-a', providerConstraints: { 'fs:read': 'provider-a' } },
       { ...compatiblePlugin, pluginId: 'plugin-b', providerConstraints: { 'fs:read': 'provider-b' } },
     ])
     expect(result.satisfiable).toBe(false)
     expect(result.conflicts.some(c => c.type === 'provider_constraint_conflict')).toBe(true)
   })

   it('detects schema range conflict', () => {
     const result = solve([
       { ...compatiblePlugin, pluginId: 'plugin-a', schemaRanges: { 'session-event': { min: '0.1.0', max: '0.5.0' } } },
       { ...compatiblePlugin, pluginId: 'plugin-b', schemaRanges: { 'session-event': { min: '1.0.0', max: '2.0.0' } } },
     ])
     expect(result.satisfiable).toBe(false)
     expect(result.conflicts.some(c => c.type === 'schema_range_conflict')).toBe(true)
   })

   it('provides minimal unsat core', () => {
     const result = solve([
       { ...compatiblePlugin, pluginId: 'good-plugin' },
       { ...compatiblePlugin, pluginId: 'bad-plugin', requiredCapabilities: ['nonexistent'] },
     ])
     expect(result.satisfiable).toBe(false)
     expect(result.unsatCore).toContain('bad-plugin')
     expect(result.unsatCore).not.toContain('good-plugin')
   })
 })
