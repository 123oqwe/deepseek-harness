/**
  * Plugin compatibility solver.
  *
  * Before boot, solves the entire plugin graph to detect conflicts.
  * Outputs a minimal unsat core when conflicts exist.
  *
  * @module @deepseek-ai/dsh-plugin-compat/solver
  */

/** A plugin's compatibility declaration. */
export interface PluginCompatDecl {
  readonly pluginId: string
  readonly runtimeApiRange: { readonly min: string; readonly max: string }
  readonly schemaRanges: Record<string, { readonly min: string; readonly max: string }>
  readonly requiredCapabilities: string[]
  readonly optionalCapabilities: string[]
  readonly providedCapabilities: string[]
  readonly providerConstraints: Record<string, string>
}

/** Result of solving the plugin graph. */
export interface SolveResult {
  readonly satisfiable: boolean
  readonly unsatCore: string[]
  readonly conflicts: Array<{ type: string; plugins: string[]; message: string }>
}

/** Compare two semver strings. */
function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const va = pa[i] ?? 0
    const vb = pb[i] ?? 0
    if (va !== vb) return va - vb
  }
  return 0
}

/** Solve a set of plugin compatibility declarations. */
export function solve(plugins: PluginCompatDecl[]): SolveResult {
  const conflicts: Array<{ type: string; plugins: string[]; message: string }> = []
  const unsatCore: string[] = []

  // Check runtime API range overlaps
  for (let i = 0; i < plugins.length; i++) {
    for (let j = i + 1; j < plugins.length; j++) {
      const a = plugins[i]
      const b = plugins[j]
      if (!a || !b) continue
      // Runtime API ranges must overlap
      if (compareSemver(a.runtimeApiRange.max, b.runtimeApiRange.min) < 0 ||
           compareSemver(b.runtimeApiRange.max, a.runtimeApiRange.min) < 0) {
        conflicts.push({
          type: 'runtime_api_mismatch',
          plugins: [a.pluginId, b.pluginId],
          message: `Runtime API ranges do not overlap: ${a.pluginId} [${a.runtimeApiRange.min}-${a.runtimeApiRange.max}] vs ${b.pluginId} [${b.runtimeApiRange.min}-${b.runtimeApiRange.max}]`,
        })
      }
    }
  }

  // Check schema range conflicts
  for (let i = 0; i < plugins.length; i++) {
    for (let j = i + 1; j < plugins.length; j++) {
      const a = plugins[i]
      const b = plugins[j]
      if (!a || !b) continue
      for (const [schemaId, rangeA] of Object.entries(a.schemaRanges)) {
        const rangeB = b.schemaRanges[schemaId]
        if (rangeB) {
          if (compareSemver(rangeA.max, rangeB.min) < 0 || compareSemver(rangeB.max, rangeA.min) < 0) {
            conflicts.push({
              type: 'schema_range_conflict',
              plugins: [a.pluginId, b.pluginId],
              message: `Schema '${schemaId}' ranges do not overlap: ${a.pluginId} vs ${b.pluginId}`,
            })
          }
        }
      }
    }
  }

  // Check required capabilities are provided
  const allProvided = new Set<string>()
  for (const p of plugins) {
    for (const cap of p.providedCapabilities) allProvided.add(cap)
  }
  for (const p of plugins) {
    for (const req of p.requiredCapabilities) {
      if (!allProvided.has(req)) {
        conflicts.push({
          type: 'missing_required_capability',
          plugins: [p.pluginId],
          message: `Plugin '${p.pluginId}' requires '${req}' but no plugin provides it`,
        })
        unsatCore.push(p.pluginId)
      }
    }
  }

  // Check provider constraints (e.g., only one provider per capability)
  const providerMap = new Map<string, string[]>()
  for (const p of plugins) {
    for (const [cap, providerId] of Object.entries(p.providerConstraints)) {
      const existing = providerMap.get(cap) ?? []
      existing.push(providerId)
      providerMap.set(cap, existing)
    }
  }
  for (const [cap, providers] of providerMap) {
    const unique = new Set(providers)
    if (unique.size > 1) {
      conflicts.push({
        type: 'provider_constraint_conflict',
        plugins: Array.from(unique),
        message: `Capability '${cap}' has conflicting providers: ${Array.from(unique).join(', ')}`,
      })
    }
  }

  const satisfiable = conflicts.length === 0
  if (satisfiable) {
    return { satisfiable: true, unsatCore: [], conflicts: [] }
  }

  // Compute minimal unsat core: plugins involved in conflicts
  const conflictPlugins = new Set<string>()
  for (const c of conflicts) {
    for (const p of c.plugins) conflictPlugins.add(p)
  }

  return {
    satisfiable: false,
    unsatCore: Array.from(conflictPlugins),
    conflicts,
  }
}
