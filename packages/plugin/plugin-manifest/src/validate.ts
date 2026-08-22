 /**
  * Plugin manifest validation.
  *
  * Validates that a manifest declares all required fields, that declared
  * capabilities match actual registrations, and that no wildcard permissions
  * are requested in production profiles.
  *
  * @module @deepseek-ai/dsh-plugin-manifest/validate
  */

 import type {
   PluginManifestV2,
   LegacyBundleV1,
   ManifestValidationResult,
   ManifestTool,
 } from './types.ts'

 /** Check if a package.json represents a legacy v1 bundle. */
 export function isLegacyBundle(pkg: { dsh?: { bundle?: string } }): pkg is LegacyBundleV1 {
   return pkg.dsh?.bundle !== undefined
 }

 /** Convert a legacy v1 bundle to a manifest v2 (marked as legacy-untrusted). */
 export function legacyToManifest(pkg: LegacyBundleV1): PluginManifestV2 {
   return {
     manifestVersion: 2,
     name: pkg.name,
     version: pkg.version,
     description: 'Legacy plugin converted from v1 bundle (legacy-untrusted)',
     services: [],
     tools: [],
     executionMode: 'in-process',
     compatibility: { minHarnessVersion: '0.0.0' },
   }
 }

 /** Validate a manifest v2 against the schema rules. */
 export function validateManifest(manifest: PluginManifestV2): ManifestValidationResult {
   const errors: string[] = []
   const warnings: string[] = []

   // Required fields
   if (manifest.manifestVersion !== 2) {
     errors.push(`manifestVersion must be 2, got ${manifest.manifestVersion}`)
   }
   if (!manifest.name) {
     errors.push('name is required')
   }
   if (!manifest.version) {
     errors.push('version is required')
   }
   if (!manifest.description) {
     errors.push('description is required')
   }
   if (!manifest.executionMode) {
     errors.push('executionMode is required')
   }
   if (!manifest.compatibility) {
     errors.push('compatibility is required')
   }

   // Wildcard permission checks
   if (manifest.filesystem) {
     for (const fs of manifest.filesystem) {
       if (fs.path === '*' || fs.path === '/*') {
         errors.push(`filesystem wildcard path '${fs.path}' is not allowed`)
       }
     }
   }
   if (manifest.network) {
     for (const net of manifest.network) {
       if (net.destinations.includes('*') || net.destinations.includes('**')) {
         errors.push('network wildcard destination is not allowed')
       }
     }
   }
   if (manifest.secrets) {
     for (const sec of manifest.secrets) {
       if (sec.requestedSecrets.includes('*')) {
         errors.push('secrets wildcard request is not allowed')
       }
     }
   }
   if (manifest.process?.allowedCommands?.includes('*')) {
     errors.push('process wildcard command is not allowed')
   }

   // MCP server checks
   if (manifest.mcpServers) {
     for (const mcp of manifest.mcpServers) {
       if (!mcp.transport) {
         errors.push(`MCP server '${mcp.name}' must declare transport`)
       }
       if (mcp.sideEffect === 'external' || mcp.sideEffect === 'irreversible') {
         if (!mcp.auth || mcp.auth === 'none') {
           errors.push(`MCP server '${mcp.name}' with ${mcp.sideEffect} side effect requires auth`)
         }
       }
       if (mcp.sideEffect === 'network' && !mcp.networkDestinations) {
         errors.push(`MCP server '${mcp.name}' with network side effect must declare destinations`)
       }
     }
   }

   // Tool checks
   for (const tool of manifest.tools) {
     if (!tool.sideEffect) {
       errors.push(`tool '${tool.name}' must declare sideEffect`)
     }
     if (!tool.dataClassification) {
       errors.push(`tool '${tool.name}' must declare dataClassification`)
     }
     if (tool.sideEffect === 'external' && !tool.authAudience) {
       errors.push(`tool '${tool.name}' with external side effect requires authAudience`)
     }
   }

   // Skill/MCP undeclared checks (would compare with actual registrations at runtime)

   const valid = errors.length === 0
   const trustLevel = valid ? 'L1-inspected' : 'L0-unknown'

   return { valid, errors, warnings, trustLevel, legacy: false }
 }

 /** Validate a legacy v1 bundle (always marks as legacy-untrusted). */
 export function validateLegacyBundle(pkg: LegacyBundleV1): ManifestValidationResult {
   const manifest = legacyToManifest(pkg)
   const result = validateManifest(manifest)
   return {
     ...result,
     trustLevel: 'L0-unknown',
     legacy: true,
     warnings: [...result.warnings, 'Legacy v1 bundle: marked as legacy-untrusted, rejected in production profile by default'],
   }
 }

 /**
  * Compare declared permissions against observed registrations.
  * Returns blocking violations if the plugin registers undeclared capabilities.
  */
 export function compareDeclaredVsObserved(
   manifest: PluginManifestV2,
   observedTools: string[],
   observedNetworkDestinations: string[],
 ): string[] {
   const violations: string[] = []
   const declaredTools = new Set(manifest.tools.map(t => t.name))

   for (const tool of observedTools) {
     if (!declaredTools.has(tool)) {
       violations.push(`Undeclared tool registered: ${tool}`)
     }
   }

   const declaredDestinations = new Set(
     manifest.network?.flatMap(n => n.destinations) ?? [],
   )

   for (const dest of observedNetworkDestinations) {
     if (!declaredDestinations.has(dest)) {
       violations.push(`Undeclared network destination accessed: ${dest}`)
     }
   }

   return violations
 }
