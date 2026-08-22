// Type declarations for check-capability-seams.mjs
export interface Violation {
  rule: string
  package?: string
  file?: string
  import?: string
  message: string
}

export interface AllowlistEntry {
  package: string
  removalDate: string
  owner: string
  reason: string
}

export interface LayerDef {
  description: string
  packages: string[]
  can_depend_on?: string[]
  cannot_be_imported_by?: string[]
  definition?: string
  providers?: string[]
  consumers?: string[]
  rule?: string
  allowlist?: AllowlistEntry[]
}

export interface ArchitectureLayers {
  layers: Record<string, LayerDef>
  rules: Record<string, unknown>
  allowlist?: AllowlistEntry[]
}

export function loadLayers(): ArchitectureLayers
export function check(): Violation[]
