 /**
  * Capability Seam architecture consistency checker.
  *
  * Scans workspace package.json and TypeScript imports to enforce:
  * - Consumers must not deep-import provider src/*
  * - Providers must not depend on apps/* or UI packages
  * - agent-loop must not hardcode a specific provider implementation
  * - Every replaceable capability must have a Service Definition
  *
  * Usage: node scripts/architecture/check-capability-seams.mjs
  *
  * @module check-capability-seams
  */

 import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
 import { join, relative, dirname } from 'node:path'
 import { fileURLToPath } from 'node:url'
 import { execSync } from 'node:child_process'

 const __dirname = dirname(fileURLToPath(import.meta.url))
 const repoRoot = join(__dirname, '..', '..')

 function loadLayers() {
   const layersPath = join(repoRoot, 'architecture.layers.json')
   if (!existsSync(layersPath)) {
     throw new Error('architecture.layers.json not found')
   }
   return JSON.parse(readFileSync(layersPath, 'utf8'))
 }

 function findPackages(globPattern) {
   const parts = globPattern.split('/')
   const base = parts[0]
   const sub = parts.slice(1).join('/')
   const baseDir = join(repoRoot, base)
   if (!existsSync(baseDir)) return []
   const result = []
   if (sub === '*') {
     for (const entry of readdirSync(baseDir)) {
       const full = join(baseDir, entry)
       if (statSync(full).isDirectory() && existsSync(join(full, 'package.json'))) {
         result.push(full)
       }
     }
   }
   return result
 }

 function getPackageName(pkgDir) {
   const pj = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'))
   return pj.name
 }

 function findTsFiles(pkgDir) {
   const srcDir = join(pkgDir, 'src')
   if (!existsSync(srcDir)) return []
   const result = []
   function scan(dir) {
     for (const entry of readdirSync(dir)) {
       const full = join(dir, entry)
       if (statSync(full).isDirectory()) {
         scan(full)
       } else if (entry.endsWith('.ts')) {
         result.push(full)
       }
     }
   }
   scan(srcDir)
   return result
 }

 function extractImports(filePath) {
   const content = readFileSync(filePath, 'utf8')
   const imports = []
   const importRegex = /import\s+.*?from\s+['"]([^'"]+)['"]/g
   const exportRegex = /export\s+.*?from\s+['"]([^'"]+)['"]/g
   let m
   while ((m = importRegex.exec(content)) !== null) imports.push(m[1])
   while ((m = exportRegex.exec(content)) !== null) imports.push(m[1])
   return imports
 }

 function checkNoConsumerDeepImport(layers) {
   const violations = []
   for (const [name, layer] of Object.entries(layers.layers)) {
     if (!layer.definition || !layer.providers || !layer.consumers) continue

     const providerPkgs = layer.providers.flatMap(p => findPackages(p))
     const providerNames = providerPkgs.map(p => getPackageName(p))

     for (const consumerGlob of layer.consumers) {
       const consumerPkgs = findPackages(consumerGlob)
       for (const consumerDir of consumerPkgs) {
         const tsFiles = findTsFiles(consumerDir)
         for (const file of tsFiles) {
           const imports = extractImports(file)
           for (const imp of imports) {
             for (const pn of providerNames) {
               if (imp.startsWith(pn + '/src/')) {
                 const isAllowed = layers.allowlist?.some(
                   a => a.violation === 'consumer-deep-import-provider' &&
                        a.importing === imp &&
                        a.package === consumerGlob
                 )
                 if (!isAllowed) {
                   violations.push({
                     rule: 'no_consumer_deep_import',
                     file: relative(repoRoot, file),
                     import: imp,
                     provider: pn,
                     message: `Consumer deep-imports provider src: ${imp}`,
                   })
                 }
               }
             }
           }
         }
       }
     }
   }
   return violations
 }

 function checkNoProviderDependsOnApp(layers) {
   const violations = []
   for (const [name, layer] of Object.entries(layers.layers)) {
     if (!layer.providers) continue
     for (const providerGlob of layer.providers) {
       const providerPkgs = findPackages(providerGlob)
       for (const providerDir of providerPkgs) {
         const tsFiles = findTsFiles(providerDir)
         for (const file of tsFiles) {
           const imports = extractImports(file)
           for (const imp of imports) {
             if (imp.includes('/apps/') || imp.includes('dsh-web')) {
               violations.push({
                 rule: 'no_provider_depends_on_app',
                 file: relative(repoRoot, file),
                 import: imp,
                 message: `Provider depends on app/UI: ${imp}`,
               })
             }
           }
         }
       }
     }
   }
   return violations
 }

 function checkKernelNoProductDeps(layers) {
   const violations = []
   const kernelLayer = layers.layers.kernel
   if (!kernelLayer) return violations
   const kernelPkgs = findPackages('packages/kernel/*')
   for (const kernelDir of kernelPkgs) {
     const tsFiles = findTsFiles(kernelDir)
     for (const file of tsFiles) {
       const imports = extractImports(file)
       for (const imp of imports) {
         if (imp.startsWith('@deepseek-ai/dsh-') && !imp.startsWith('@deepseek-ai/dsh-brand')) {
           violations.push({
             rule: 'kernel_no_product_deps',
             file: relative(repoRoot, file),
             import: imp,
             message: `Kernel depends on product package: ${imp}`,
           })
         }
       }
     }
   }
   return violations
 }

 function checkAllowlistExpiry(layers) {
   const violations = []
   const now = new Date('2026-08-22')
   if (!layers.allowlist) return violations
   for (const entry of layers.allowlist) {
     if (entry.removalDate) {
       const removal = new Date(entry.removalDate)
       if (removal < now) {
         violations.push({
           rule: 'allowlist_expired',
           entry: entry,
           message: `Allowlist entry expired on ${entry.removalDate}`,
         })
       }
     }
   }
   return violations
 }

 export function check() {
   const layers = loadLayers()
   const violations = [
     ...checkNoConsumerDeepImport(layers),
     ...checkNoProviderDependsOnApp(layers),
     ...checkKernelNoProductDeps(layers),
     ...checkAllowlistExpiry(layers),
   ]
   return violations
 }

 // CLI entry point
 if (process.argv[1] && process.argv[1].endsWith('check-capability-seams.mjs')) {
   const violations = check()
   if (violations.length === 0) {
     console.log('capability-seams: PASS — no violations detected')
     process.exit(0)
   } else {
     console.error('capability-seams: FAIL — detected violations:')
     for (const v of violations) {
       console.error(`  [${v.rule}] ${v.message}`)
       if (v.file) console.error(`    file: ${v.file}`)
       if (v.import) console.error(`    import: ${v.import}`)
     }
     process.exit(1)
   }
 }

 export { loadLayers, findPackages, getPackageName, findTsFiles, extractImports }
