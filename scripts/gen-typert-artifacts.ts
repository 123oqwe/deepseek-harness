import { WorkspaceTypertGenerator } from '../packages/typert/generator/src/workspace.ts'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const generator = new WorkspaceTypertGenerator(root)

try {
  const packages = generator.discover()
    .filter((candidate) => {
      try {
        // eslint-disable-next-line no-unsafe-assignment
        const manifest = JSON.parse(readFileSync(join(root, candidate.root, 'package.json'), 'utf8'))
        // eslint-disable-next-line no-unsafe-member-access
        return manifest.exports && (manifest.exports['./typert'] || manifest.exports['./remote'] || manifest.exports['./client/typert'])
      } catch { return false }
    })
    .map(candidate => candidate.package)

  console.log(`Discovered ${packages.length} typert packages: ${packages.join(', ')}`)

  for (const artifact of generator.generate(packages)) {
    const output = join(root, artifact.packageRoot, 'lib')
    mkdirSync(output, { recursive: true })
    writeFileSync(join(output, `typert.${artifact.face}.js`), artifact.js)
    writeFileSync(join(output, `typert.${artifact.face}.d.ts`), artifact.dts)
    if (artifact.remote !== undefined) {
      writeFileSync(join(output, 'typert.remote-client.js'), artifact.remote.js)
      writeFileSync(join(output, 'typert.remote-client.d.ts'), artifact.remote.dts)
      writeFileSync(join(output, 'typert.remote-client.d.ts.map'), artifact.remote.dtsMap)
    }
    console.log(`Generated typert artifacts for ${artifact.package} (${artifact.face})`)
  }
} catch (e) {
  console.error('Error:', e instanceof Error ? e.message : String(e))
  process.exit(1)
}
