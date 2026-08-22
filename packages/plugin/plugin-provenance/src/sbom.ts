 /**
  * Software Bill of Materials (SBOM) for plugins.
  *
  * @module @deepseek-ai/dsh-plugin-provenance/sbom
  */

 /** An SBOM entry for a single dependency. */
 export interface SBOMEntry {
   readonly name: string
   readonly version: string
   readonly type: 'runtime' | 'dev' | 'peer' | 'optional'
   readonly digest?: string
   readonly license?: string
   readonly sourceUrl?: string
 }

 /** A complete SBOM for a plugin. */
 export interface SBOM {
   readonly pluginName: string
   readonly pluginVersion: string
   readonly generatedAt: string
   readonly entries: SBOMEntry[]
   readonly totalDependencies: number
 }

 /** Generate an SBOM from a package.json dependencies object. */
 export function generateSBOM(
   pkgName: string,
   pkgVersion: string,
   dependencies: Record<string, string>,
   devDependencies?: Record<string, string>,
   peerDependencies?: Record<string, string>,
 ): SBOM {
   const entries: SBOMEntry[] = []

   for (const [name, version] of Object.entries(dependencies)) {
     entries.push({ name, version, type: 'runtime' })
   }
   if (devDependencies) {
     for (const [name, version] of Object.entries(devDependencies)) {
       entries.push({ name, version, type: 'dev' })
     }
   }
   if (peerDependencies) {
     for (const [name, version] of Object.entries(peerDependencies)) {
       entries.push({ name, version, type: 'peer' })
     }
   }

   return {
     pluginName: pkgName,
     pluginVersion: pkgVersion,
     generatedAt: new Date().toISOString(),
     entries,
     totalDependencies: entries.length,
   }
 }

 /** Verify an SBOM against actual installed packages. */
 export function verifySBOM(sbom: SBOM, installedPackages: Set<string>): { verified: boolean; missing: string[]; unexpected: string[] } {
   const declared = new Set(sbom.entries.map(e => e.name))
   const missing: string[] = []
   const unexpected: string[] = []

   for (const entry of sbom.entries) {
     if (!installedPackages.has(entry.name) && entry.type === 'runtime') {
       missing.push(entry.name)
     }
   }

   for (const pkg of installedPackages) {
     if (!declared.has(pkg)) {
       unexpected.push(pkg)
     }
   }

   return { verified: missing.length === 0 && unexpected.length === 0, missing, unexpected }
 }
